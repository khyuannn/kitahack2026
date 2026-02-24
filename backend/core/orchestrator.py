"""
Orchestrator for Phase 1: Dumb Loop
Implements basic 2-turn negotiation: Plaintiff -> Defendant -> End
Phase 1.5: RAG-enabled negotiation
Phase 2: Turn-based negotiation with auditor, TTS, and multi-round support
Model using Gemini 2.5 Flash due to queries timing out with Gemini 3 Pro Preview (likely due to model size and complexity of Phase 2)
"""
import os
import time
from typing import Optional, Dict, Any, List
from firebase_admin import firestore, storage
from google import genai
from google.genai import types
import json
from backend.logic.neurosymbolic import evaluate_game_state

# =====================================================================
# Import M1's Prompts 
# =====================================================================
from backend.prompts.plaintiff import build_plaintiff_prompt
from backend.prompts.defendant import build_defendant_prompt
from backend.prompts.mediator import build_mediator_prompt  # For Phase 2
from backend.rag.retrieval import retrieve_law
from backend.core.auditor import validate_turn
from backend.logic.evidence import validate_evidence
from backend.prompts.chips import generate_chips_prompt
from backend.tts.voice import synthesize_audio_bytes
import concurrent.futures

# Import agent graph (Phase 1.5)
try:
    from backend.graph.agent_graph import run_negotiation_with_rag
    GRAPH_AVAILABLE = True
except ImportError:
    GRAPH_AVAILABLE = False

# Initialize Gemini client
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
PRIMARY_MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash")


# Phase 2 Constants
MAX_ROUNDS = 4
MAX_AUDITOR_RETRIES = 2
TURN_TOTAL_TIMEOUT_SEC = 240

def get_db():
    """Get Firestore client."""
    return firestore.client()


def _clip_text(value: str, limit: int) -> str:
    if not value:
        return ""
    if len(value) <= limit:
        return value
    return value[:limit] + "..."


def _call_gemini_once(prompt: str, model_name: str, file_parts: Optional[List[tuple]] = None) -> str:
    """Single Gemini API call (used inside thread for timeout).

    Args:
        prompt: The text prompt
        model_name: Gemini model ID
        file_parts: Optional list of (file_uri, mime_type) tuples from Gemini Files API
    """
    if file_parts:
        parts = [types.Part.from_text(text=prompt)]
        for uri, mime in file_parts:
            try:
                parts.append(types.Part.from_uri(file_uri=uri, mime_type=mime))
            except Exception as e:
                print(f"⚠️  Failed to attach URI {uri[:60]}: {e}, skipping")
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[types.Content(role="user", parts=parts)],
            )
            return response.text
        except Exception as e:
            if "400" in str(e) or "INVALID_ARGUMENT" in str(e):
                print(f"⚠️  Multipart call failed ({e}), falling back to text-only")
                # Fall through to text-only call below
            else:
                raise
    response = client.models.generate_content(
        model=model_name,
        contents=prompt
    )
    return response.text


def _build_directive_section(user_message: str, role: str = "plaintiff") -> str:
    """Build the commander directive block injected into the LLM prompt."""
    if not user_message or not user_message.strip():
        return ""
    limit_phrase = "your floor price" if role == "plaintiff" else "your maximum offer"
    return (
        f"\n\n[COMMANDER DIRECTIVE — MUST FOLLOW]: {user_message.strip()}\n"
        f"This is a direct order from the user commanding you. You MUST follow this directive exactly. "
        f"If the user specifies a counter-offer amount (e.g. 'offer 1500'), you MUST use that exact amount "
        f"as your counter_offer_rm unless it violates {limit_phrase}. "
        f"The user's strategy overrides your own judgement."
    )


def call_gemini_with_retry(prompt: str, max_retries: int = 2, per_call_timeout: int = 30, progress_callback=None, file_parts: Optional[List[tuple]] = None) -> str:
    """Call Gemini API with retry + exponential backoff for rate limits.
    Each individual call is capped at per_call_timeout seconds."""
    def _emit(msg):
        if progress_callback:
            progress_callback("gemini_retry", msg)
        print(msg)

    active_model = PRIMARY_MODEL
    fallback_used = False

    for attempt in range(max_retries):
        try:
            if attempt > 0:
                _emit(f"⏳ Retrying AI call (attempt {attempt+1}/{max_retries})...")
            pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            future = pool.submit(_call_gemini_once, prompt, active_model, file_parts)
            try:
                return future.result(timeout=per_call_timeout)
            finally:
                pool.shutdown(wait=False, cancel_futures=True)
        except concurrent.futures.TimeoutError:
            if not fallback_used and active_model != FALLBACK_MODEL:
                fallback_used = True
                active_model = FALLBACK_MODEL
                _emit(f"⚠ AI call timed out. Switching to fallback model: {FALLBACK_MODEL}")
                continue
            _emit(f"⚠ AI call timed out after {per_call_timeout}s (attempt {attempt+1}/{max_retries}), retrying...")
        except Exception as e:
            error_str = str(e)
            if not fallback_used and active_model != FALLBACK_MODEL:
                fallback_used = True
                active_model = FALLBACK_MODEL
                _emit(f"⚠ AI error ({error_str[:80]}). Switching to fallback model: {FALLBACK_MODEL}")
                continue
            if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                wait_time = (2 ** attempt) * 5  # 5s, 10s
                _emit(f"⚠ Rate limited on fallback (attempt {attempt+1}/{max_retries}). Waiting {wait_time}s...")
                time.sleep(wait_time)
            else:
                raise e
    raise Exception(f"Gemini API failed after {max_retries} retries (rate limited / timed out).")


def _default_chips(role: str, current_round: int) -> Dict[str, Any]:
    """Return contextual default chips by role + round instead of None."""
    if role == "defendant":
        if current_round == 1:
            return {
                "question": "How should your AI agent respond to the claim?",
                "options": [
                    {"label": "Challenge Evidence", "strategy_id": "challenge_evidence"},
                    {"label": "Propose Counter-Offer", "strategy_id": "counter_offer"},
                    {"label": "Request More Details", "strategy_id": "request_details"},
                ],
            }
        elif current_round == 2:
            return {
                "question": "How should your agent counter the plaintiff's arguments?",
                "options": [
                    {"label": "Rebut Claims", "strategy_id": "rebut_claims"},
                    {"label": "Cite Legal Defense", "strategy_id": "legal_defense"},
                    {"label": "Make Counter-Offer", "strategy_id": "counter_offer"},
                ],
            }
        elif current_round == 3:
            return {
                "question": "The mediator has weighed in. What's your next move?",
                "options": [
                    {"label": "Hold Position", "strategy_id": "hold_position"},
                    {"label": "Adjust Offer", "strategy_id": "adjust_offer"},
                    {"label": "Legal Pressure", "strategy_id": "legal_pressure"},
                ],
            }
        else:
            return {
                "question": "Final round. What's your closing strategy?",
                "options": [
                    {"label": "Best & Final Offer", "strategy_id": "best_final"},
                    {"label": "Accept Demand", "strategy_id": "accept_demand"},
                    {"label": "Walk Away", "strategy_id": "walk_away"},
                ],
            }
    else:  # plaintiff
        if current_round == 1:
            return {
                "question": "How should your AI agent open the negotiation?",
                "options": [
                    {"label": "Present Evidence First", "strategy_id": "evidence_first"},
                    {"label": "Strong Legal Opening", "strategy_id": "legal_opening"},
                    {"label": "Diplomatic Approach", "strategy_id": "diplomatic"},
                ],
            }
        elif current_round == 2:
            return {
                "question": "How should your agent press the attack?",
                "options": [
                    {"label": "Challenge Response", "strategy_id": "challenge_response"},
                    {"label": "Offer Compromise", "strategy_id": "compromise"},
                    {"label": "Cite Legal Precedent", "strategy_id": "cite_legal"},
                ],
            }
        elif current_round == 3:
            return {
                "question": "The mediator has weighed in. What's your strategy?",
                "options": [
                    {"label": "Hold Firm", "strategy_id": "hold_firm"},
                    {"label": "Accept Recommendation", "strategy_id": "accept_recommendation"},
                    {"label": "Legal Pressure", "strategy_id": "legal_pressure"},
                ],
            }
        else:
            return {
                "question": "Final round. How do you want to close?",
                "options": [
                    {"label": "Final Demand", "strategy_id": "final_demand"},
                    {"label": "Accept Counter", "strategy_id": "accept_counter"},
                    {"label": "Walk Away", "strategy_id": "walk_away"},
                ],
            }


def generate_strategy_chips(
    case_title: str,
    current_round: int,
    counter_offer: Optional[int],
    history: List[Dict[str, Any]],
    progress_callback=None,
    role: str = "plaintiff",
) -> Optional[Dict[str, Any]]:
    """Generate validated strategy chips with timeout-safe fallbacks."""
    def _extract_json_payload(raw_text: str) -> Optional[str]:
        text = (raw_text or "").strip()
        if not text:
            return None

        if text.startswith("```json"):
            text = text.split("```json", 1)[1].split("```", 1)[0].strip()
        elif text.startswith("```"):
            text = text.split("```", 1)[1].split("```", 1)[0].strip()

        if text.startswith("{") and text.endswith("}"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    return text
            except Exception:
                pass

        start_positions = [idx for idx, ch in enumerate(text) if ch == "{"]
        for start in start_positions:
            depth = 0
            in_string = False
            escape = False

            for idx in range(start, len(text)):
                ch = text[idx]
                if in_string:
                    if escape:
                        escape = False
                    elif ch == "\\":
                        escape = True
                    elif ch == '"':
                        in_string = False
                    continue

                if ch == '"':
                    in_string = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        candidate = text[start:idx + 1].strip()
                        try:
                            parsed = json.loads(candidate)
                            if isinstance(parsed, dict):
                                return candidate
                        except Exception:
                            break
        return None

    def emit(step, message):
        if progress_callback:
            progress_callback(step, message)

    chips = None
    try:
        emit("chips", "Generating strategic options...")
        conversation_history_str = "\n".join([
            f"[{msg['role'].upper()}]: {msg['content'][:100]}..."
            for msg in history[-4:]
        ])
        case_context_dict = {
            "case_title": case_title,
            "current_round": current_round,
            "counter_offer": counter_offer,
            "role": role,
        }
        chips_prompt = generate_chips_prompt(
            conversation_history=conversation_history_str,
            case_context=case_context_dict
        )
        print(f"🎮 Generating strategy chips...")
        chips_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        chips_future = chips_executor.submit(
            call_gemini_with_retry,
            chips_prompt,
            2,
            35,
            progress_callback,
        )
        try:
            chips_response = chips_future.result(timeout=60)
        finally:
            chips_executor.shutdown(wait=False, cancel_futures=True)

        try:
            chips_cleaned = _extract_json_payload(chips_response)
            if not chips_cleaned:
                print(f"⚠️  Failed to find JSON object in chips response. Raw: {chips_response[:200] if chips_response else 'None'}")
                return _default_chips(role, current_round)

            chips = json.loads(chips_cleaned)
            if not isinstance(chips, dict) or "question" not in chips or "options" not in chips:
                print(f"⚠️  Chips missing required fields. Parsed: {chips}")
                return _default_chips(role, current_round)
            if not isinstance(chips["options"], list) or len(chips["options"]) == 0:
                print(f"⚠️  Chips options invalid")
                return _default_chips(role, current_round)

            valid_options = []
            for opt in chips["options"]:
                if isinstance(opt, dict) and "label" in opt:
                    valid_options.append({"label": opt["label"], "strategy_id": opt.get("strategy_id")})
                elif isinstance(opt, str):
                    valid_options.append({"label": opt})

            if valid_options:
                chips["options"] = valid_options
                print(f"✅ Chips generated: {chips.get('question', '')}")
                return chips
            return _default_chips(role, current_round)
        except json.JSONDecodeError as jde:
            print(f"⚠️  Failed to parse chips JSON: {jde}. Raw: {chips_response[:200] if chips_response else 'None'}")
            return _default_chips(role, current_round)
    except concurrent.futures.TimeoutError:
        print(f"⚠️  Chips generation timed out, using contextual defaults")
        emit("chips_warn", "⚠ Strategy options timed out — using defaults")
        return _default_chips(role, current_round)
    except Exception as e:
        print(f"⚠️  Chips generation failed: {e}")
        return _default_chips(role, current_round)


# =============================================================================
# Phase 2: Turn-Based Negotiation
# =============================================================================
def inject_mediator_guidance(case_id: str, case_data_dict: dict, history: list) -> None:
    """
    After Round 2, inject LLM-powered mediator guidance message.
    Uses build_mediator_prompt for context-aware neutral guidance.
    """
    db = get_db()
    case_ref = db.collection("cases").document(case_id)
    
    try:
        print(f"⚖️  Injecting LLM mediator guidance (Round 2.5)")
        
        # Build conversation history string for mediator
        conversation_summary = "\n".join([
            f"[{msg['role'].upper()}]: {msg['content'][:200]}"
            for msg in history[-6:]
        ])
        
        mediator_prompt = build_mediator_prompt(
            case_data=case_data_dict,
            conversation_history=conversation_summary
        )
        
        raw_mediator = call_gemini_with_retry(mediator_prompt, per_call_timeout=50)
        
        # Parse mediator JSON
        try:
            cleaned = raw_mediator.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned.split("```json")[1].split("```")[0].strip()
            elif cleaned.startswith("```"):
                cleaned = cleaned.split("```")[1].split("```")[0].strip()
            
            mediator_json = json.loads(cleaned)
            guidance_text = mediator_json.get("summary", raw_mediator)
            recommended_rm = mediator_json.get("recommended_settlement_rm")
            confidence = mediator_json.get("confidence")
            
            # Format nicely
            formatted_guidance = f"⚖️ **Mediator Guidance**\n\n{guidance_text}"
            if recommended_rm:
                formatted_guidance += f"\n\n**Recommended Settlement:** RM {recommended_rm:,.0f}"
            formatted_guidance += "\n\n_Note: This is AI-generated guidance, not legal advice._"
            
        except json.JSONDecodeError:
            formatted_guidance = f"⚖️ **Mediator Guidance**\n\n{raw_mediator}\n\n_Note: This is AI-generated guidance, not legal advice._"
        
        mediator_audio_url = generate_and_upload_role_audio(
            case_id=case_id,
            round_num=2.5,
            role="mediator",
            text=formatted_guidance,
        )

        # Save to Firestore
        case_ref.collection("messages").add({
            "role": "mediator",
            "content": formatted_guidance,
            "round": 2.5,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "is_guidance": True,
            "audio_url": mediator_audio_url,
        })
        
        print(f"✅ Mediator guidance injected (LLM)")
        
    except Exception as e:
        print(f"⚠️  Failed to inject mediator guidance: {e}")
        # Save a fallback so mediator_already_injected=True on next call
        fallback_text = (
            "⚖️ **Mediator Guidance**\n\n"
            "Both parties have presented their positions. "
            "The mediator encourages both sides to consider the other's perspective and move toward a reasonable settlement. "
            "Please review the evidence and make your next strategic decision.\n\n"
            "_Note: This is fallback guidance. The AI mediator was temporarily unavailable._"
        )
        case_ref.collection("messages").add({
            "role": "mediator",
            "content": fallback_text,
            "round": 2.5,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "is_guidance": True,
            "audio_url": None,
        })

def run_negotiation_turn(
    case_id: str,
    user_message: str = "",
    current_round: int = 1,  # Ignored — backend derives from message count
    user_role: str = "plaintiff",
    evidence_uris: Optional[List[str]] = None,
    floor_price: Optional[int] = None,
    progress_callback=None,
) -> Dict[str, Any]:
    """
    Phase 2: Execute one negotiation turn (AI vs AI).
    
    The user is the Commander — their input is an optional strategic directive.
    Both Plaintiff AI and Defendant AI generate responses each turn.
    
    Flow:
    1. Retrieve case context & derive round from message count
    2. Save user directive (if any) 
    3. Inject mediator at Round 3
    4. RAG search for relevant laws
    5. Generate Plaintiff AI response (guided by user directive)
    6. Generate Defendant AI response (with auditor retry)
    7. Evaluate game state (neurosymbolic)
    8. Generate strategy chips
    9. Return both messages
    """
    def emit(step, message):
        if progress_callback:
            progress_callback(step, message)
    
    db = get_db()
    case_ref = db.collection("cases").document(case_id)
    messages_ref = case_ref.collection("messages")
    
    try:
        turn_started_at = time.monotonic()

        # =====================================================================
        # Step 1: Retrieve case context & derive round
        # =====================================================================
        emit("context", "Analyzing case context...")
        
        case_data = case_ref.get().to_dict()
        case_title = case_data.get("title", "Dispute")
        case_type = case_data.get("caseType", "tenancy_deposit")
        
        # Get conversation history
        history = []
        messages_docs = messages_ref.order_by("createdAt").stream()
        for msg_doc in messages_docs:
            msg_data = msg_doc.to_dict()
            history.append({
                "role": msg_data.get("role"),
                "content": msg_data.get("content"),
                "round": msg_data.get("round"),
            })
        
        # Derive round from plaintiff message count (authoritative)
        plaintiff_count = sum(1 for m in history if m["role"] == "plaintiff")
        derived_round = plaintiff_count + 1  # 0 plaintiff msgs → round 1, etc.
        if derived_round > MAX_ROUNDS:
            derived_round = MAX_ROUNDS
        
        print(f"\n{'='*60}")
        print(f"🎮 [Round {derived_round}] AI vs AI turn for case {case_id}")
        print(f"   Commander directive: {user_message[:80] if user_message else '(none)'}")
        print(f"   Evidence URIs: {len(evidence_uris) if evidence_uris else 0}")
        print(f"{'='*60}")
        
        # Get evidence context + file parts for Gemini multipart
        evidence_docs = case_ref.collection("evidence").stream()
        evidence_texts = []
        evidence_file_parts = []  # (file_uri, mime_type) tuples for Gemini
        for edoc in evidence_docs:
            evidence_data = edoc.to_dict()
            extracted = evidence_data.get("extractedText")
            if extracted:
                evidence_texts.append(extracted)
            # Collect Gemini File API URIs with their mime types
            furi = evidence_data.get("file_uri")
            fmime = evidence_data.get("fileType")
            if furi and fmime:
                evidence_file_parts.append((furi, fmime))

        # Keep prompt size bounded to reduce model timeouts/failures
        clipped_evidence = [_clip_text(text, 700) for text in evidence_texts[:8] if text]
        evidence_context = "\n".join(clipped_evidence) if clipped_evidence else "No evidence provided."

        # Cap file parts at 5 to avoid oversized requests
        evidence_file_parts = evidence_file_parts[:5] if evidence_file_parts else None
        print(f"   Evidence file parts: {len(evidence_file_parts) if evidence_file_parts else 0}")

        # =====================================================================
        # Step 2: Save user directive (if provided)
        # =====================================================================
        if user_message and user_message.strip():
            print(f"📝 Saving commander directive...")
            messages_ref.add({
                "role": "directive",
                "content": user_message.strip(),
                "round": derived_round,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })

        # =====================================================================
        # Step 3: Inject mediator guidance at Round 3
        # =====================================================================
        # Compute claim amount and defendant max offer (separate from plaintiff floor)
        claim_amount = case_data.get("amount", 0) or 0
        # Defendant max offer: ~50% of claim amount, distinct from plaintiff's floor price
        defendant_max_offer = int(claim_amount * 0.5) if claim_amount > 0 else (floor_price or 0)

        case_description = case_data.get("description", "")
        defendant_description = case_data.get("defendantDescription", "")

        case_data_dict = {
            "case_title": case_title,
            "case_type": case_type,
            "case_description": case_description,
            "evidence_summary": evidence_context,
            "floor_price": floor_price or 0,
            "dispute_amount": claim_amount,
            "defendant_max_offer": defendant_max_offer,
            "defendant_description": defendant_description,
            "legal_context": "",  # Will be filled after RAG
        }
        
        mediator_already_injected = any(m.get("role") == "mediator" for m in history)
        if derived_round == 3 and not mediator_already_injected:
            emit("mediator", "⚖️ Mediator is reviewing the case...")
            inject_mediator_guidance(case_id, case_data_dict, history)

            # Round 2 -> mediator intervention step (no user chips/input in between)
            if not (user_message and user_message.strip()):
                intervention_history = history + [{"role": "mediator", "content": "Mediator guidance injected.", "round": 2.5}]
                chips = generate_strategy_chips(
                    case_title=case_title,
                    current_round=3,
                    counter_offer=None,
                    history=intervention_history,
                    progress_callback=progress_callback,
                )
                if not chips:
                    chips = _default_chips("plaintiff", 3)
                emit("complete", "Mediator intervention complete.")
                print("✅ Mediator-only intervention complete. Awaiting user strategy for Round 3.")
                return {
                    "agent_message": "Mediator guidance has been posted. Review it and choose your next strategy.",
                    "plaintiff_message": None,
                    "current_round": 3,
                    "audio_url": None,
                    "auditor_passed": True,
                    "auditor_warning": None,
                    "counter_offer_rm": None,
                    "game_state": "active",
                    "citations_found": [],
                    "chips": chips,
                }
        
        # =====================================================================
        # Step 4: RAG - Search for relevant laws
        # =====================================================================
        emit("rag", "Searching legal database for relevant laws...")
        # Build RAG query — history is already passed to agentic LLM which extracts citations itself
        rag_parts = [case_type, case_title]
        if user_message:
            rag_parts.append(user_message)
        rag_query = " ".join(rag_parts)
        legal_docs = []
        try:
            executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            future = executor.submit(
                retrieve_law,
                query=rag_query,
                history=history,
                use_agentic=True,
            )
            try:
                legal_docs = future.result(timeout=45)  # 45s hard limit
            finally:
                executor.shutdown(wait=False, cancel_futures=True)
        except concurrent.futures.TimeoutError:
            print(f"\u23f0 RAG search timed out after 45s, proceeding without legal context")
            emit("rag_warn", "\u26a0 Legal search timed out — proceeding without case law")
            legal_docs = []
        except Exception as e:
            print(f"\u26a0\ufe0f  RAG search error: {e}, proceeding without legal context")
            emit("rag_warn", f"\u26a0 Legal search failed: {str(e)[:80]} — proceeding anyway")
            legal_docs = []
        
        if legal_docs:
            legal_context = "\n".join([
                f"- {doc['law']} Section {doc['section']}: {doc['excerpt'][:300]}..."
                for doc in legal_docs
            ])
            print(f"📚 Retrieved {len(legal_docs)} legal references")
        else:
            legal_context = "No specific laws retrieved. Rely on general contract principles."
            print(f"⚠️  No laws retrieved from RAG")
        
        case_data_dict["legal_context"] = legal_context

        if time.monotonic() - turn_started_at > TURN_TOTAL_TIMEOUT_SEC:
            raise TimeoutError(f"Turn exceeded {TURN_TOTAL_TIMEOUT_SEC}s during legal retrieval")
        
        # Format conversation history for prompts (exclude directives from shared history)
        conversation_history = "\n".join([
            f"[{msg['role'].upper()}]: {msg['content']}"
            for msg in history[-6:]
            if msg['role'] != 'directive'
        ])
        
        # =====================================================================
        # Step 5: Generate PLAINTIFF AI response (with auditor retry)
        # =====================================================================
        emit("plaintiff", "Your agent is building legal arguments...")
        print(f"🤖 [Round {derived_round}] Generating plaintiff response...")
        
        plaintiff_prompt = build_plaintiff_prompt(
            case_data=case_data_dict,
            current_round=derived_round
        )
    
        directive_section = _build_directive_section(user_message, role="plaintiff")

        full_plaintiff_prompt = f"""{plaintiff_prompt}

=== CONVERSATION HISTORY ===
{conversation_history}
{directive_section}

=== CURRENT SITUATION ===
Round {derived_round} of {MAX_ROUNDS}

Now argue as the Plaintiff. Remember to output ONLY valid JSON."""

        # Plaintiff Auditor retry loop
        plaintiff_auditor_passed = False
        plaintiff_auditor_warning = None
        plaintiff_text = None
        plaintiff_offer = None
        plaintiff_audit_result = {"is_valid": True, "citations_found": []}
        
        try:
            plaintiff_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            plaintiff_future = plaintiff_executor.submit(
                call_gemini_with_retry,
                full_plaintiff_prompt,
                2,
                30,
                progress_callback,
                evidence_file_parts,
            )
            try:
                raw_plaintiff = plaintiff_future.result(timeout=90)
            finally:
                plaintiff_executor.shutdown(wait=False, cancel_futures=True)
            
            # Parse plaintiff JSON
            try:
                cleaned = raw_plaintiff.strip()
                if cleaned.startswith("```json"):
                    cleaned = cleaned.split("```json")[1].split("```")[0].strip()
                elif cleaned.startswith("```"):
                    cleaned = cleaned.split("```")[1].split("```")[0].strip()
                
                plaintiff_json = json.loads(cleaned)
                plaintiff_text = plaintiff_json.get("message", cleaned)
                plaintiff_offer = plaintiff_json.get("counter_offer_rm")
                print(f"✅ Plaintiff JSON parsed. Offer: {plaintiff_offer}")
            except json.JSONDecodeError:
                print(f"⚠️  Plaintiff JSON parse failed, using raw text")
                plaintiff_text = raw_plaintiff
                plaintiff_offer = None
        except concurrent.futures.TimeoutError:
            print("⚠️  Plaintiff generation hard-timeout reached, using fallback response")
            plaintiff_text = "I need a moment to review the evidence and legal points. I maintain my current position for now."
            plaintiff_offer = None
        except Exception as e:
            print(f"❌ Plaintiff generation failed: {e}")
            plaintiff_text = "I need a moment to review the case details. I maintain my current position for now."
            plaintiff_offer = None
                
        # Save plaintiff immediately — TTS and audit run in parallel with defendant generation
        print(f"💾 Saving plaintiff message...")
        plaintiff_msg_ref = messages_ref.add({
            "role": "plaintiff",
            "content": plaintiff_text,
            "round": derived_round,
            "counter_offer_rm": plaintiff_offer,
            "audio_url": None,  # Updated async below
            "auditor_passed": None,
            "auditor_warning": None,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })[1]

        # Launch plaintiff TTS and auditor in background — parallel with defendant LLM
        p_tts_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        p_tts_future = p_tts_pool.submit(
            generate_and_upload_role_audio, case_id, derived_round, "plaintiff", plaintiff_text
        )
        p_audit_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        p_audit_future = p_audit_pool.submit(validate_turn, plaintiff_text)

        # Add to history immediately so defendant prompt includes plaintiff's message
        history.append({
            "role": "plaintiff",
            "content": plaintiff_text,
            "round": derived_round,
        })
        
        # =====================================================================
        # Step 6: Generate DEFENDANT AI response
        # =====================================================================
        if time.monotonic() - turn_started_at > TURN_TOTAL_TIMEOUT_SEC:
            raise TimeoutError(f"Turn exceeded {TURN_TOTAL_TIMEOUT_SEC}s before defendant response")

        emit("defendant", "Opponent is preparing counter-arguments...")
        print(f"🤖 [Round {derived_round}] Generating defendant response...")
        
        defendant_prompt = build_defendant_prompt(
            case_data=case_data_dict,
            current_round=derived_round
        )
        
        # Rebuild conversation history including plaintiff's new message (exclude directives from defendant view)
        conversation_history_updated = "\n".join([
            f"[{msg['role'].upper()}]: {msg['content']}"
            for msg in history[-6:]
            if msg['role'] != 'directive'
        ])
        
        full_defendant_prompt = f"""{defendant_prompt}

=== CONVERSATION HISTORY ===
{conversation_history_updated}

=== CURRENT SITUATION ===
Round {derived_round} of {MAX_ROUNDS}
The plaintiff just said: "{plaintiff_text[:200]}"

Now respond as the Defendant. Remember to output ONLY valid JSON."""

        auditor_passed = False
        auditor_warning = None
        agent_text = None
        counter_offer = None
        game_eval = {"has_offer": False, "offer_amount": None, "meets_floor": False}
        audit_result = {"is_valid": True, "citations_found": []}
        
        try:
            defender_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            defender_future = defender_executor.submit(
                call_gemini_with_retry,
                full_defendant_prompt,
                2,
                30,
                progress_callback,
                evidence_file_parts,
            )
            try:
                raw_response = defender_future.result(timeout=90)
            finally:
                defender_executor.shutdown(wait=False, cancel_futures=True)
            
            # Parse JSON
            try:
                cleaned = raw_response.strip()
                if cleaned.startswith("```json"):
                    cleaned = cleaned.split("```json")[1].split("```")[0].strip()
                elif cleaned.startswith("```"):
                    cleaned = cleaned.split("```")[1].split("```")[0].strip()
                
                response_json = json.loads(cleaned)
                agent_text = response_json.get("message", cleaned)
                game_eval = evaluate_game_state(response_json, floor_price or 0)
                counter_offer = game_eval["offer_amount"]
                
                print(f"✅ Defendant JSON parsed. Offer: {counter_offer}, meets_floor: {game_eval['meets_floor']}")
            except json.JSONDecodeError:
                print(f"⚠️  Defendant JSON parse failed, using raw text")
                agent_text = raw_response
                counter_offer = None
                game_eval = {"has_offer": False, "offer_amount": None, "meets_floor": False}
        except concurrent.futures.TimeoutError:
            emit("defendant_warn", "⚠ Opponent response timed out — proceeding with fallback")
            print("⚠️  Defendant generation hard-timeout reached, using fallback response")
            raw_response = json.dumps({
                "message": "I need a moment to review your points. I maintain my current position for now.",
                "counter_offer_rm": None,
            })
            try:
                response_json = json.loads(raw_response)
                agent_text = response_json.get("message", raw_response)
                game_eval = evaluate_game_state(response_json, floor_price or 0)
                counter_offer = game_eval["offer_amount"]
            except Exception:
                agent_text = "I need a moment to review your points. I maintain my current position for now."
                counter_offer = None
                game_eval = {"has_offer": False, "offer_amount": None, "meets_floor": False}
        except Exception as e:
            emit("defendant_error", f"❌ Defendant agent failed: {str(e)[:100]}")
            print(f"❌ Defendant generation failed: {e}")
            agent_text = "I need a moment to review your latest points. I maintain my current position for now."
            counter_offer = None
            game_eval = {"has_offer": False, "offer_amount": None, "meets_floor": False}
        
        # =====================================================================
        # Step 7: Collect plaintiff async results, save defendant message
        # =====================================================================
        # Defendant LLM took ~15-45s — plaintiff TTS and audit should be done
        try:
            plaintiff_audio_url = p_tts_future.result(timeout=25)
        except Exception:
            plaintiff_audio_url = None
        finally:
            p_tts_pool.shutdown(wait=False)

        try:
            plaintiff_audit_result = p_audit_future.result(timeout=10)
            plaintiff_auditor_passed = plaintiff_audit_result["is_valid"]
            if not plaintiff_auditor_passed:
                plaintiff_auditor_warning = plaintiff_audit_result.get("auditor_warning", "Citation validation failed")
                print(f"❌ [Plaintiff Auditor] Failed: {plaintiff_auditor_warning}")
                emit("auditor_warn", f"⚠ Plaintiff Audit failed: {plaintiff_auditor_warning[:80]}")
            else:
                print(f"✅ [Plaintiff Auditor] Validation passed")
                plaintiff_auditor_warning = None
        except Exception:
            plaintiff_auditor_passed = True
            plaintiff_auditor_warning = None
        finally:
            p_audit_pool.shutdown(wait=False)

        plaintiff_msg_ref.update({
            "audio_url": plaintiff_audio_url,
            "auditor_passed": plaintiff_auditor_passed,
            "auditor_warning": plaintiff_auditor_warning,
        })

        # Save defendant immediately, run TTS and auditor in parallel with each other
        print(f"💾 Saving defendant message...")
        defendant_msg_ref = messages_ref.add({
            "role": "defendant",
            "content": agent_text,
            "round": derived_round,
            "counter_offer_rm": counter_offer,
            "audio_url": None,  # Updated async below
            "auditor_passed": None,
            "auditor_warning": None,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })[1]

        # Add defendant response to history so chips reflect the latest exchange
        history.append({
            "role": "defendant",
            "content": agent_text,
            "round": derived_round,
        })

        # Run defendant TTS in background while auditor runs in main thread
        d_tts_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        d_tts_future = d_tts_pool.submit(
            generate_and_upload_role_audio, case_id, derived_round, "defendant", agent_text
        )
        emit("auditor", "Validating legal citations...")
        print(f"🛡️  [Auditor] Validating...")
        audit_result = validate_turn(agent_text)

        try:
            audio_url = d_tts_future.result(timeout=25)
        except Exception:
            audio_url = None
        finally:
            d_tts_pool.shutdown(wait=False)

        auditor_passed = audit_result["is_valid"]
        if not auditor_passed:
            auditor_warning = audit_result.get("auditor_warning", "Citation validation failed")
            print(f"❌ [Auditor] Failed: {auditor_warning}")
            emit("auditor_warn", f"⚠ Audit failed: {auditor_warning[:80]}")
        else:
            print(f"✅ [Auditor] Validation passed")

        # Update Firestore with audit results and audio_url
        defendant_msg_ref.update({
            "audio_url": audio_url,
            "auditor_passed": auditor_passed,
            "auditor_warning": auditor_warning if not auditor_passed else None,
        })

        # =====================================================================
        # Step 8: Determine game state
        # =====================================================================
        game_state = "active"

        if game_eval.get("meets_floor"):
            game_state = "pending_accept"
            case_ref.update({"game_state": "pending_accept", "pendingDecisionRole": "plaintiff"})
            print(f"⏳ Plaintiff decision required! Offer ({counter_offer}) meets floor ({floor_price})")

        if derived_round >= MAX_ROUNDS:
            if game_state != "settled" and game_state != "pending_accept":
                game_state = "pending_decision"
                print(f"⏰ Max rounds reached. Awaiting user decision...")

        # =====================================================================
        # Step 9: Generate chips (sequential — avoids Gemini rate limits)
        # =====================================================================
        chips = None
        if game_state == "active":
            chips = generate_strategy_chips(
                case_title=case_title,
                current_round=derived_round,
                counter_offer=counter_offer,
                history=history,
                progress_callback=progress_callback,
            )
            if not chips:
                chips = _default_chips("plaintiff", derived_round)

        if time.monotonic() - turn_started_at > TURN_TOTAL_TIMEOUT_SEC:
            raise TimeoutError(f"Turn exceeded {TURN_TOTAL_TIMEOUT_SEC}s before completion")
        
        # =====================================================================
        # Step 10: Return response
        # =====================================================================
        emit("complete", "Turn complete!")
        print(f"✅ [Round {derived_round}] Complete - Game state: {game_state}")
        print(f"{'='*60}\n")
        
        return {
            "agent_message": agent_text,
            "plaintiff_message": plaintiff_text,
            "current_round": derived_round,
            "audio_url": audio_url,
            "auditor_passed": auditor_passed,
            "auditor_warning": auditor_warning,
            "counter_offer_rm": counter_offer,
            "game_state": game_state,
            "citations_found": audit_result.get("citations_found", []) if auditor_passed else [],
            "chips": chips,
            "pending_decision_role": "plaintiff" if game_state == "pending_accept" else None,
        }
        
    except Exception as e:
        error_msg = str(e)
        print(f"\u274c [Orchestrator] Turn error: {error_msg}")
        import traceback
        traceback.print_exc()
        
        emit("error", f"\u274c Error: {error_msg[:150]}")
        
        return {
            "agent_message": f"System error: {error_msg}",
            "plaintiff_message": None,
            "current_round": current_round,
            "audio_url": None,
            "auditor_passed": False,
            "auditor_warning": f"System error: {error_msg}",
            "counter_offer_rm": None,
            "game_state": "error",
            "citations_found": [],
            "chips": None,
        }


def upload_audio_to_storage(
    case_id: str,
    round_num: int,
    role: str,
    audio_bytes: bytes
) -> Optional[str]:
    """
    Upload audio bytes to Firebase Storage.
    
    Args:
        case_id: Case ID
        round_num: Round number
        role: Speaker role (plaintiff/defendant/mediator)
        audio_bytes: Audio file bytes
        
    Returns:
        Public URL of uploaded audio, or None if failed
    """
    try:
        bucket = storage.bucket()
        blob_path = f"audio/{case_id}/round_{round_num}_{role}.mp3"
        blob = bucket.blob(blob_path)
        
        print(f"📤 Uploading audio to: {blob_path}")
        
        blob.upload_from_string(
            audio_bytes,
            content_type="audio/mpeg"
        )
        
        # Make public
        blob.make_public()
        
        public_url = blob.public_url
        print(f"✅ Audio uploaded: {public_url}")
        
        return public_url
        
    except Exception as e:
        print(f"❌ Audio upload failed: {e}")
        return None


def generate_and_upload_role_audio(
    case_id: str,
    round_num: int,
    role: str,
    text: Optional[str],
) -> Optional[str]:
    if role not in {"plaintiff", "defendant", "mediator"}:
        return None
    if not text or not text.strip():
        return None

    try:
        audio_bytes = synthesize_audio_bytes(text=text, role=role)
        if not audio_bytes:
            return None
        return upload_audio_to_storage(
            case_id=case_id,
            round_num=round_num,
            role=role,
            audio_bytes=audio_bytes,
        )
    except Exception as e:
        print(f"⚠️  TTS generation failed for {role}: {e}")
        return None


def generate_mediator_settlement(case_id: str) -> Dict[str, Any]:
    """
    Phase 2: Generate final settlement using mediator prompt.
    Called when negotiation reaches deadlock or Round 4 ends.
    
    Args:
        case_id: The case ID
        
    Returns:
        Settlement dict matching Settlement model from api_models.py
    """
    db = get_db()
    case_ref = db.collection("cases").document(case_id)
    
    try:
        print(f"\n{'='*60}")
        print(f"⚖️  Generating mediator settlement for case {case_id}")
        print(f"{'='*60}")
        
        # Retrieve case data
        case_data = case_ref.get().to_dict()
        case_title = case_data.get("title")
        
        # Get full conversation history
        messages_ref = case_ref.collection("messages")
        messages = messages_ref.order_by("createdAt").stream()
        
        conversation_history = []
        for msg_doc in messages:
            msg_data = msg_doc.to_dict()
            role = msg_data.get('role') or 'unknown'
            content = msg_data.get('content') or ''
            conversation_history.append(
                f"[Round {msg_data.get('round')}] {role.upper()}: {content}"
            )

        history_text = "\n".join(conversation_history)

        # Get legal context
        legal_docs = retrieve_law(case_title or "dispute", use_agentic=False)
        legal_context = "\n".join([
            f"- {doc['law']} Section {doc['section']}: {doc['excerpt'][:200]}"
            for doc in legal_docs
        ])

        # Get evidence summary
        evidence_docs = case_ref.collection("evidence").stream()
        evidence_texts = []
        for edoc in evidence_docs:
            edata = edoc.to_dict()
            extracted = edata.get("extractedText")
            if extracted:
                evidence_texts.append(_clip_text(extracted, 500))
        evidence_summary = "\n".join(evidence_texts[:6]) if evidence_texts else "No evidence provided."

        # Build mediator prompt with full case data
        claim_amount = case_data.get("amount", 0) or 0
        case_data_dict = {
            "legal_context": legal_context,
            "case_title": case_title or "Dispute",
            "case_type": case_data.get("caseType", ""),
            "dispute_amount": claim_amount,
            "evidence_summary": evidence_summary,
            "floor_price": case_data.get("floorPrice", 0) or 0,
        }
        mediator_prompt = build_mediator_prompt(
            case_data=case_data_dict,
            conversation_history=history_text,
        )
        
        # Generate settlement
        print(f"🤖 Calling Gemini for mediator settlement...")
        raw_response = call_gemini_with_retry(mediator_prompt)
        
        # Parse JSON
        try:
            cleaned = raw_response.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned.split("```json")[1].split("```")[0].strip()
            elif cleaned.startswith("```"):
                cleaned = cleaned.split("```")[1].split("```")[0].strip()
            
            settlement_json = json.loads(cleaned)
            print(f"✅ Settlement generated successfully")
            
            # Save to Firestore
            case_ref.update({
                "status": "done",
                "settlement": settlement_json
            })
            
            return settlement_json
            
        except json.JSONDecodeError:
            print(f"❌ Failed to parse mediator JSON, raw: {raw_response[:300]}")
            # Return fallback settlement
            fallback = {
                "summary": raw_response[:500] if raw_response else "Unable to generate settlement. Please consult a legal professional.",
                "recommended_settlement_rm": 0,
                "confidence": 0.0,
                "citations": []
            }
            case_ref.update({"status": "done", "settlement": fallback})
            return fallback
    
    except Exception as e:
        print(f"❌ Mediator settlement error: {str(e)}")
        raise e

# =============================================================================
# PvP: Single-Side Negotiation Turn
# =============================================================================
def run_pvp_negotiation_turn(
    case_id: str,
    user_message: str = "",
    user_role: str = "plaintiff",
    evidence_uris: Optional[List[str]] = None,
    floor_price: Optional[int] = None,
    progress_callback=None,
) -> Dict[str, Any]:
    """
    PvP Mode: Execute ONE side's turn (plaintiff OR defendant, not both).
    
    The human commander sends a directive, the AI agent for that role responds.
    Then the turn flips to the other side.
    
    Flow:
    1. Retrieve case context & derive round
    2. Save user directive
    3. RAG search for relevant laws
    4. Generate AI response for the user's role only
    5. Auditor validation
    6. Check if mediator should be injected (after both sides complete round 2)
    7. Evaluate game state
    8. Generate strategy chips for the NEXT player
    9. Flip turn to opposite role
    10. Return result
    """
    def emit(step, message):
        if progress_callback:
            progress_callback(step, message)

    db = get_db()
    case_ref = db.collection("cases").document(case_id)
    messages_ref = case_ref.collection("messages")

    try:
        turn_started_at = time.monotonic()

        # =====================================================================
        # Step 1: Retrieve case context
        # =====================================================================
        emit("context", "Analyzing case context...")

        case_data = case_ref.get().to_dict()
        case_title = case_data.get("title", "Dispute")
        case_type = case_data.get("caseType", "tenancy_deposit")
        claim_amount = case_data.get("amount", 0) or 0
        pvp_round = case_data.get("pvpRound", 1)

        # Get conversation history
        history = []
        messages_docs = messages_ref.order_by("createdAt").stream()
        for msg_doc in messages_docs:
            msg_data = msg_doc.to_dict()
            history.append({
                "role": msg_data.get("role"),
                "content": msg_data.get("content"),
                "round": msg_data.get("round"),
            })

        print(f"\n{'='*60}")
        print(f"🎮 [PvP Round {pvp_round}] {user_role.upper()} turn for case {case_id}")
        print(f"   Commander directive: {user_message[:80] if user_message else '(none)'}")
        print(f"   Evidence URIs: {len(evidence_uris) if evidence_uris else 0}")
        print(f"{'='*60}")

        # Get evidence context + file parts for Gemini multipart
        evidence_docs = case_ref.collection("evidence").stream()
        evidence_texts = []
        evidence_file_parts = []  # (file_uri, mime_type) tuples for Gemini
        for edoc in evidence_docs:
            evidence_data = edoc.to_dict()
            extracted = evidence_data.get("extractedText")
            if extracted:
                evidence_texts.append(extracted)
            furi = evidence_data.get("file_uri")
            fmime = evidence_data.get("fileType")
            if furi and fmime:
                evidence_file_parts.append((furi, fmime))

        clipped_evidence = [_clip_text(text, 700) for text in evidence_texts[:8] if text]
        evidence_context = "\n".join(clipped_evidence) if clipped_evidence else "No evidence provided."
        case_facts = f"Case Type: {case_type}\nTitle: {case_title}\nEvidence Summary: {evidence_context}"

        # Cap file parts at 5 to avoid oversized requests
        evidence_file_parts = evidence_file_parts[:5] if evidence_file_parts else None
        print(f"   Evidence file parts: {len(evidence_file_parts) if evidence_file_parts else 0}")

        # =====================================================================
        # Step 2: Save user directive
        # =====================================================================
        if user_message and user_message.strip():
            print(f"📝 Saving {user_role} commander directive...")
            messages_ref.add({
                "role": "directive",
                "content": f"[{user_role.upper()}] {user_message.strip()}",
                "round": pvp_round,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })

        # =====================================================================
        # Step 3: Set turn status to processing
        # =====================================================================
        case_ref.update({"turnStatus": "processing"})

        # =====================================================================
        # Step 4: RAG - Search for relevant laws
        # =====================================================================
        emit("rag", "Searching legal database for relevant laws...")
        rag_parts = [case_type, case_title]
        if user_message:
            rag_parts.append(user_message)
        rag_query = " ".join(rag_parts)
        legal_docs = []
        try:
            executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            future = executor.submit(retrieve_law, query=rag_query, history=history, use_agentic=True)
            try:
                legal_docs = future.result(timeout=45)
            finally:
                executor.shutdown(wait=False, cancel_futures=True)
        except concurrent.futures.TimeoutError:
            print(f"⏰ RAG search timed out")
            emit("rag_warn", "⚠ Legal search timed out — proceeding without case law")
        except Exception as e:
            print(f"⚠️  RAG search error: {e}")
            emit("rag_warn", f"⚠ Legal search failed — proceeding anyway")

        if legal_docs:
            legal_context = "\n".join([
                f"- {doc['law']} Section {doc['section']}: {doc['excerpt'][:300]}..."
                for doc in legal_docs
            ])
        else:
            legal_context = "No specific laws retrieved. Rely on general contract principles."

        # Compute floor/ceiling prices — use defendant's own ceiling if provided
        defendant_ceiling_from_case = case_data.get("defendantCeilingPrice")
        if defendant_ceiling_from_case is not None and defendant_ceiling_from_case > 0:
            defendant_max_offer = int(defendant_ceiling_from_case)
        else:
            defendant_max_offer = int(claim_amount * 0.5) if claim_amount > 0 else (floor_price or 0)

        case_description = case_data.get("description", "")
        defendant_description = case_data.get("defendantDescription", "")

        case_data_dict = {
            "case_title": case_title,
            "case_type": case_type,
            "case_description": case_description,
            "evidence_summary": evidence_context,
            "floor_price": floor_price or 0,
            "dispute_amount": claim_amount,
            "defendant_max_offer": defendant_max_offer,
            "legal_context": legal_context,
            "defendant_description": defendant_description,
        }

        if time.monotonic() - turn_started_at > TURN_TOTAL_TIMEOUT_SEC:
            raise TimeoutError(f"Turn exceeded {TURN_TOTAL_TIMEOUT_SEC}s")

        # Format conversation history for prompts (exclude directives)
        conversation_history = "\n".join([
            f"[{msg['role'].upper()}]: {msg['content']}"
            for msg in history[-6:]
            if msg['role'] != 'directive'
        ])

        # =====================================================================
        # Step 5: Generate AI response for this role
        # =====================================================================
        agent_text = None
        counter_offer = None
        game_eval = {"has_offer": False, "offer_amount": None, "meets_floor": False}

        if user_role == "plaintiff":
            emit("plaintiff", "Your agent is building legal arguments...")
            print(f"🤖 [PvP Round {pvp_round}] Generating plaintiff response...")

            plaintiff_prompt = build_plaintiff_prompt(
                case_data=case_data_dict,
                current_round=pvp_round
            )
            directive_section = _build_directive_section(user_message, role="plaintiff")

            full_prompt = f"""{plaintiff_prompt}

=== CONVERSATION HISTORY ===
{conversation_history}
{directive_section}

=== CURRENT SITUATION ===
Round {pvp_round} of {MAX_ROUNDS}

Now argue as the Plaintiff. Remember to output ONLY valid JSON."""

        else:  # defendant
            emit("defendant", "Your agent is preparing defense...")
            print(f"🤖 [PvP Round {pvp_round}] Generating defendant response...")

            defendant_prompt = build_defendant_prompt(
                case_data=case_data_dict,
                current_round=pvp_round
            )
            directive_section = _build_directive_section(user_message, role="defendant")

            # Get last plaintiff message for context
            last_plaintiff = next((m for m in reversed(history) if m["role"] == "plaintiff"), None)
            plaintiff_context = f'\nThe plaintiff just said: "{last_plaintiff["content"][:200]}"' if last_plaintiff else ""

            full_prompt = f"""{defendant_prompt}

=== CONVERSATION HISTORY ===
{conversation_history}
{directive_section}

=== CURRENT SITUATION ===
Round {pvp_round} of {MAX_ROUNDS}
{plaintiff_context}

Now respond as the Defendant. Remember to output ONLY valid JSON."""

        # Generate response
        try:
            gen_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            gen_future = gen_executor.submit(
                call_gemini_with_retry, full_prompt, 2, 30, progress_callback, evidence_file_parts
            )
            try:
                raw_response = gen_future.result(timeout=90)
            finally:
                gen_executor.shutdown(wait=False, cancel_futures=True)

            try:
                cleaned = raw_response.strip()
                if cleaned.startswith("```json"):
                    cleaned = cleaned.split("```json")[1].split("```")[0].strip()
                elif cleaned.startswith("```"):
                    cleaned = cleaned.split("```")[1].split("```")[0].strip()

                response_json = json.loads(cleaned)
                agent_text = response_json.get("message", cleaned)
                if user_role == "defendant":
                    game_eval = evaluate_game_state(response_json, floor_price or 0)
                    counter_offer = game_eval["offer_amount"]
                else:
                    counter_offer = response_json.get("counter_offer_rm")
                print(f"✅ {user_role.capitalize()} JSON parsed. Offer: {counter_offer}")
            except json.JSONDecodeError:
                agent_text = raw_response
                counter_offer = None
        except concurrent.futures.TimeoutError:
            agent_text = "I need a moment to review the case details. I maintain my current position."
            counter_offer = None
        except Exception as e:
            print(f"❌ {user_role} generation failed: {e}")
            raise

        # =====================================================================
        # Step 6: Save message & audit
        # =====================================================================
        print(f"💾 Saving {user_role} message...")
        msg_ref = messages_ref.add({
            "role": user_role,
            "content": agent_text,
            "round": pvp_round,
            "counter_offer_rm": counter_offer,
            "audio_url": None,  # Updated async below
            "auditor_passed": None,
            "auditor_warning": None,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })[1]

        # =====================================================================
        # Step 7: Determine turn flip + round advancement
        # =====================================================================
        opposite_role = "defendant" if user_role == "plaintiff" else "plaintiff"

        # After plaintiff submits → turn goes to defendant (same round)
        # After defendant submits → round advances, turn goes to plaintiff
        if user_role == "plaintiff":
            next_turn = "defendant"
            next_round = pvp_round
        else:
            next_round = pvp_round + 1
            next_turn = "plaintiff"

        # Run TTS in background while auditor runs in main thread
        pvp_tts_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        pvp_tts_future = pvp_tts_pool.submit(
            generate_and_upload_role_audio, case_id, pvp_round, user_role, agent_text
        )
        emit("auditor", f"Validating {user_role} legal citations...")
        audit_result = validate_turn(agent_text)
        auditor_passed = audit_result["is_valid"]
        auditor_warning = None

        if not auditor_passed:
            auditor_warning = audit_result.get("auditor_warning", "Citation validation failed")
            emit("auditor_warn", f"⚠ Audit failed: {auditor_warning[:80]}")

        try:
            audio_url = pvp_tts_future.result(timeout=25)
        except Exception:
            audio_url = None
        finally:
            pvp_tts_pool.shutdown(wait=False)

        msg_ref.update({
            "audio_url": audio_url,
            "auditor_passed": auditor_passed,
            "auditor_warning": auditor_warning if not auditor_passed else None,
        })

        # =====================================================================
        # Step 8: Inject mediator after round 2 completes (both sides done)
        # =====================================================================
        mediator_already_injected = any(m.get("role") == "mediator" for m in history)
        if user_role == "defendant" and pvp_round == 2 and not mediator_already_injected:
            emit("mediator", "⚖️ Mediator is reviewing the case...")
            mediator_history = history + [{"role": user_role, "content": agent_text, "round": pvp_round}]
            inject_mediator_guidance(case_id, case_data_dict, mediator_history)

        # =====================================================================
        # Step 9: Evaluate game state
        # =====================================================================
        game_state = "active"

        if user_role == "defendant" and game_eval.get("meets_floor"):
            game_state = "pending_accept"
            case_ref.update({"game_state": "pending_accept", "pendingDecisionRole": "plaintiff"})
            print(f"⏳ PvP: Plaintiff decision required! Offer ({counter_offer}) meets floor ({floor_price})")

        if user_role == "plaintiff" and counter_offer is not None and game_state == "active":
            defendant_ceiling = int(case_data_dict.get("defendantCeilingPrice") or 0)
            if defendant_ceiling > 0 and counter_offer <= defendant_ceiling:
                game_state = "pending_accept"
                case_ref.update({"game_state": "pending_accept", "pendingDecisionRole": "defendant"})
                print(f"⏳ PvP: Defendant decision required! Plaintiff offer ({counter_offer}) within ceiling ({defendant_ceiling})")

        if next_round > MAX_ROUNDS:
            if game_state != "settled" and game_state != "pending_accept":
                game_state = "pending_decision"
                next_round = MAX_ROUNDS
                print(f"⏰ Max rounds reached. Awaiting user decision...")

        case_status = "active"
        if game_state == "settled":
            case_status = "done"
        elif game_state == "pending_decision":
            case_status = "pending_decision"
        elif game_state == "pending_accept":
            case_status = "pending_accept"

        # =====================================================================
        # Step 10: Generate chips for the NEXT player (sequential)
        # =====================================================================
        chips = None
        if game_state == "active":
            updated_history = history + [{"role": user_role, "content": agent_text, "round": pvp_round}]
            chips = generate_strategy_chips(
                case_title=case_title,
                current_round=next_round if next_round <= MAX_ROUNDS else MAX_ROUNDS,
                counter_offer=counter_offer,
                history=updated_history,
                progress_callback=progress_callback,
                role=next_turn,
            )

        # =====================================================================
        # Step 11: Update case doc — flip turn
        # =====================================================================
        case_ref.update({
            "currentTurn": next_turn,
            "turnStatus": "waiting",
            "pvpRound": next_round,
            "status": case_status,
            "game_state": game_state,
            "nextChips": chips if game_state == "active" else None,
        })

        emit("complete", "Turn complete!")
        print(f"✅ [PvP Round {pvp_round}] {user_role} turn complete. Next: {next_turn}, Round: {next_round}")

        pending_decision_role = None
        if game_state == "pending_accept":
            pending_decision_role = case_data_dict.get("pendingDecisionRole") or (
                "plaintiff" if user_role == "defendant" else "defendant"
            )

        return {
            "agent_message": agent_text,
            "plaintiff_message": agent_text if user_role == "plaintiff" else None,
            "current_round": pvp_round,
            "audio_url": audio_url,
            "auditor_passed": auditor_passed,
            "auditor_warning": auditor_warning,
            "counter_offer_rm": counter_offer,
            "game_state": game_state,
            "citations_found": audit_result.get("citations_found", []),
            "chips": chips,
            "current_turn": next_turn,
            "pending_decision_role": pending_decision_role,
        }

    except Exception as e:
        error_msg = str(e)
        print(f"❌ [PvP Orchestrator] Turn error: {error_msg}")
        import traceback
        traceback.print_exc()

        # Reset turn status so the player can retry
        try:
            case_ref.update({"turnStatus": "waiting"})
        except Exception:
            pass

        emit("error", f"❌ Error: {error_msg[:150]}")

        return {
            "agent_message": f"System error: {error_msg}",
            "plaintiff_message": None,
            "current_round": case_data.get("pvpRound", 1) if 'case_data' in dir() else 1,
            "audio_url": None,
            "auditor_passed": False,
            "auditor_warning": f"System error: {error_msg}",
            "counter_offer_rm": None,
            "game_state": "error",
            "citations_found": [],
            "chips": None,
            "current_turn": user_role,
        }


# phase 1 & 1.5: basic dumb loop (no RAG)
def run_dumb_loop(case_id: str, mode: str = "mvp") -> None:
    """
    Phase 1: Basic 2-turn conversation loop.
    
    Flow:
    1. Plaintiff makes opening argument (Round 1)
    2. Defendant responds to plaintiff (Round 1)
    3. End (status → "done")
    
    Args:
        case_id: The case ID from Firestore
        mode: "mvp" or "full" (not used in Phase 1, but accepted for contract compliance)
    
    Note:
        - This function runs in a background thread (called from main.py)
        - Messages are written to Firestore in real-time
        - M4's frontend listens via onSnapshot and displays them live
    """
    db = get_db()
    case_ref = db.collection("cases").document(case_id)
    messages_ref = case_ref.collection("messages")
    
    try:
        # Update status to running
        case_ref.update({"status": "running"})
        
        # =====================================================================
        # Retrieve case details and evidence
        # =====================================================================
        case_data = case_ref.get().to_dict()
        case_title = case_data.get("title", "Tenancy Deposit Dispute")
        
        # Retrieve evidence (if M4 uploaded any)
        evidence_docs = case_ref.collection("evidence").stream()
        evidence_texts = []
        for doc in evidence_docs:
            evidence_data = doc.to_dict()
            extracted = evidence_data.get("extractedText")
            if extracted:
                evidence_texts.append(extracted)
        
        evidence_context = "\n".join(evidence_texts) if evidence_texts else "No evidence provided yet."
        
        # =====================================================================
        # ROUND 1: Plaintiff Turn
        # =====================================================================
        print(f"[Orchestrator] Case {case_id}: Plaintiff speaking...")
        
        # Search for relevant laws using the case title
        print(f"🔎 Retrieving laws for: {case_title}")
        legal_docs = retrieve_law(case_title) 
        legal_context_str = "\n".join([f"- {d['law']} s.{d['section']}: {d['excerpt']}" for d in legal_docs])

        # ✅ Build plaintiff prompt using M1's function (Phase 1 simplified)
        case_data_dict = {
            "case_title": case_title,
            "case_type": "tenancy_deposit",
            "incident_date": "",
            "dispute_amount": 0,
            "short_description": case_title,
            "case_facts": f"Case: {case_title}",
            "evidence_summary": evidence_context,
            "floor_price": 0,
            "legal_context": legal_context_str,
        }
        plaintiff_prompt = build_plaintiff_prompt(
            case_data=case_data_dict,
            current_round=1
        )
        plaintiff_text = call_gemini_with_retry(plaintiff_prompt)

        # Try to parse JSON
        try:
            cleaned = plaintiff_text.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned.split("```json")[1].split("```")[0].strip()
            response_json = json.loads(cleaned)
            plaintiff_text = response_json.get("message", plaintiff_text)
        except:
            pass  # Use raw text if JSON parse fails
        
        messages_ref.add({
            "role": "plaintiff",
            "content": plaintiff_text,
            "round": 1,
            "createdAt": firestore.SERVER_TIMESTAMP
        })
        
        print(f"[Orchestrator] Plaintiff: {plaintiff_text[:100]}...")
        
        # =====================================================================
        # ROUND 1: Defendant Turn
        # =====================================================================
        print(f"[Orchestrator] Case {case_id}: Defendant responding...")
        
        defendant_prompt = f"""{build_defendant_prompt(
            case_data=case_data_dict,
            current_round=1
        )}

# Case Title: {case_title}
# Available Evidence: {evidence_context}

# The landlord argued:
# "{plaintiff_text}"

# Respond to their argument."""

        defendant_text = call_gemini_with_retry(defendant_prompt)
        
        # Try to parse JSON
        try:
            cleaned = defendant_text.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned.split("```json")[1].split("```")[0].strip()
            response_json = json.loads(cleaned)
            defendant_text = response_json.get("message", defendant_text)
        except:
            pass
        # Write to Firestore
        messages_ref.add({
            "role": "defendant",
            "content": defendant_text,
            "round": 1,
            "createdAt": firestore.SERVER_TIMESTAMP
        })
        
        print(f"[Orchestrator] Defendant: {defendant_text[:100]}...")
        
        # =====================================================================
        # End of Phase 1 Loop
        # =====================================================================
        # Update case status to done
        case_ref.update({"status": "done"})
        
        print(f"✅ [Orchestrator] Dumb loop completed for case {case_id}")
        
    except Exception as e:
        # Error handling: Update case status to error
        print(f"❌ [Orchestrator] Error in case {case_id}: {str(e)}")
        case_ref.update({
            "status": "error",
        })
        
        # Write error message to messages collection
        messages_ref.add({
            "role": "system",
            "content": f"Error occurred: {str(e)}",
            "round": 0,
            "createdAt": firestore.SERVER_TIMESTAMP
        })

# phase 1.5+: RAG-enabled negotiation
def run_case(case_id: str, mode: str = "mvp") -> None:
    """
    Smart routing function:
    - If mode="mvp" → Use simple dumb loop (Phase 1)
    - If mode="full" → Use agent graph with RAG (Phase 1.5)
    
    This allows gradual migration to Phase 2.
    """
    if mode == "full" and GRAPH_AVAILABLE:
        print(f"[Orchestrator] Running FULL mode with RAG for case {case_id}")
        run_negotiation_with_rag(case_id, mode)
    else:
        print(f"[Orchestrator] Running MVP mode (simple loop) for case {case_id}")
        run_dumb_loop(case_id, mode)
        
# =============================================================================
# Optional: Helper function for getting case results
# =============================================================================
def get_case_result(case_id: str) -> dict:
    """
    Retrieve case result from Firestore.
    
    Phase 1: Just returns status
    Phase 2: Will return settlement JSON
    
    Args:
        case_id: The case ID
        
    Returns:
        dict with status and settlement (if available)
    """
    db = get_db()
    case_ref = db.collection("cases").document(case_id)
    case_doc = case_ref.get()
    
    if not case_doc.exists:
        return {"status": "error", "settlement": None}
    
    case_data = case_doc.to_dict()
    
    return {
        "status": case_data.get("status", "created"),
        "settlement": case_data.get("settlement"),  # Will be None in Phase 1
    }