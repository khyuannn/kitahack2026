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

# Import agent graph (Phase 1.5)
try:
    from backend.graph.agent_graph import run_negotiation_with_rag
    GRAPH_AVAILABLE = True
except ImportError:
    GRAPH_AVAILABLE = False

# Initialize Gemini client
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


# Phase 2 Constants
MAX_ROUNDS = 4
MAX_AUDITOR_RETRIES = 2

def get_db():
    """Get Firestore client."""
    return firestore.client()

def call_gemini_with_retry(prompt: str, max_retries: int = 5) -> str:
    """Call Gemini API with retry + exponential backoff for rate limits."""
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt
            )
            return response.text
        except Exception as e:
            error_str = str(e)
            if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                wait_time = (2 ** attempt) * 20  # 10s, 20s, 40s
                print(f"⏳ Rate limited (attempt {attempt+1}/{max_retries}). Waiting {wait_time}s...")
                time.sleep(wait_time)
            else:
                raise e
    raise Exception(f"Gemini API failed after {max_retries} retries (rate limited).")


# =============================================================================
# Phase 2: Turn-Based Negotiation
# =============================================================================
def inject_mediator_guidance(case_id: str) -> None:
    """
    After Round 2, inject mediator guidance message.
    This is NOT the final settlement, just neutral advice.
    Called at the start of Round 3.
    """
    db = get_db()
    case_ref = db.collection("cases").document(case_id)
    
    try:
        print(f"⚖️  Injecting mediator guidance (Round 2.5)")
        
        # Get case data
        case_data = case_ref.get().to_dict()
        case_title = case_data.get("title")
        
        # Get recent messages
        messages_ref = case_ref.collection("messages")
        recent_messages = messages_ref.order_by("createdAt", direction=firestore.Query.DESCENDING).limit(4).stream()
        
        history = []
        for msg_doc in recent_messages:
            msg_data = msg_doc.to_dict()
            history.append(f"{msg_data.get('role').upper()}: {msg_data.get('content')[:150]}...")
        
        history.reverse()  # Chronological order
        conversation_summary = "\n".join(history)
        
        # Simple mediator guidance (not using LLM to save quota)
        guidance_text = f"""⚖️ **Mediator Guidance**

I've reviewed the arguments from both parties. Here's my neutral assessment:

**Key Points:**
- Both parties have presented valid concerns
- The dispute centers on: {case_title}
- Consider finding middle ground

**Recommendation:**
- Focus on facts and evidence
- Be willing to compromise
- Remember: Going to court costs time and money

This is Round 3. Please make a reasonable counter-offer to move toward settlement.

_Note: This is AI-generated guidance, not legal advice._"""
        
        # Save to Firestore
        case_ref.collection("messages").add({
            "role": "mediator",
            "content": guidance_text,
            "round": 2.5,  # Between Round 2 and 3
            "createdAt": firestore.SERVER_TIMESTAMP,
            "is_guidance": True
        })
        
        print(f"✅ Mediator guidance injected")
        
    except Exception as e:
        print(f"⚠️  Failed to inject mediator guidance: {e}")

def run_negotiation_turn(
    case_id: str,
    user_message: str,
    current_round: int,
    user_role: str = "plaintiff",  # NEW: User plays as plaintiff
    evidence_uris: Optional[List[str]] = None,
    floor_price: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Phase 2: Execute one negotiation turn.
    
    Flow:
    1. Retrieve case context (messages, evidence, case facts)
    2. Search for relevant laws (RAG with conversation history)
    3. Build prompt with all context variables
    4. Generate AI response (defendant role)
    5. Parse JSON response
    6. Validate with Auditor (with retry logic)
    7. Save to Firestore (if passed auditor)
    8. Determine game state (settled/deadlock/active)
    9. Return response
    
    Args:
        case_id: The case ID
        user_message: User's input (plaintiff's argument)
        current_round: Current round number (1-4)
        user_role: User's role (default: plaintiff)
        evidence_uris: List of Gemini File API URIs (for mid-game evidence)
        floor_price: User's minimum acceptable amount (for neurosymbolic check)
        
    Returns:
        Dict containing:
        - agent_message: AI response text
        - audio_url: Firebase Storage URL (None for now)
        - auditor_passed: bool
        - auditor_warning: str | None
        - counter_offer_rm: int | None
        - game_state: "active" | "settled" | "deadlock" | "pending_decision"
        - citations_found: List of citations
    """
    db = get_db()
    case_ref = db.collection("cases").document(case_id)
    messages_ref = case_ref.collection("messages")
    
    try:
        # =====================================================================
        # Step 1: Retrieve case context
        # =====================================================================
        print(f"\n{'='*60}")
        print(f"🎮 [Turn {current_round}] Starting negotiation turn for case {case_id}")
        print(f"{'='*60}")
        
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
        
        # Get evidence context
        evidence_docs = case_ref.collection("evidence").stream()
        evidence_texts = []
        for doc in evidence_docs:
            evidence_data = doc.to_dict()
            extracted = evidence_data.get("extractedText")
            if extracted:
                evidence_texts.append(extracted)
        
        evidence_context = "\n".join(evidence_texts) if evidence_texts else "No evidence provided."
        
        # Build case facts summary
        case_facts = f"Case Type: {case_type}\nTitle: {case_title}\nEvidence Summary: {evidence_context}"
        # =====================================================================
        # Special: Inject mediator guidance at Round 3
        # =====================================================================
        if current_round == 3:
            inject_mediator_guidance(case_id)
        # =====================================================================
        # Step 2: Save user's message first
        # =====================================================================
        print(f"💬 Saving user message...")
        messages_ref.add({
            "role": user_role,
            "content": user_message,
            "round": current_round,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
        
        # Update history with user message
        history.append({
            "role": user_role,
            "content": user_message,
            "round": current_round,
        })
        
        # =====================================================================
        # Step 3: RAG - Search for relevant laws (Agentic)
        # =====================================================================
        print(f"🔎 [Turn {current_round}] Searching laws with agentic RAG...")
        legal_docs = retrieve_law(
            query=f"{case_title} {user_message}",
            history=history,
            use_agentic=True  # M2's agentic RAG, use False to test non-agentic retrieval
        )
        
        if legal_docs:
            legal_context = "\n".join([
                f"- {doc['law']} Section {doc['section']}: {doc['excerpt'][:300]}..."
                for doc in legal_docs
            ])
            print(f"📚 Retrieved {len(legal_docs)} legal references")
        else:
            legal_context = "No specific laws retrieved. Rely on general contract principles."
            print(f"⚠️  No laws retrieved from RAG")
        
        # =====================================================================
        # Step 4: Determine agent role and build prompt
        # =====================================================================
        # User is plaintiff, so AI plays defendant
        agent_role = "defendant" if user_role == "plaintiff" else "plaintiff"
        
        print(f"🤖 [Turn {current_round}] Generating {agent_role} response...")
        
        # Format conversation history for prompt
        conversation_history = "\n".join([
            f"[{msg['role'].upper()}]: {msg['content']}"
            for msg in history[-6:]  # Last 6 messages for context
        ])

        # ✅ Build prompt using M1's function
        case_data_dict = {
            "case_title": case_title,
            "case_type": case_type,
            "case_facts": case_facts,
            "evidence_summary": evidence_context,
            "floor_price": floor_price or 0,
            "legal_context": legal_context,
        }

        # Call M1's build function
        if agent_role == "defendant":
            system_prompt = build_defendant_prompt(
                case_data=case_data_dict,
                current_round=current_round
            )
        else:
            system_prompt = build_plaintiff_prompt(
                case_data=case_data_dict,
                current_round=current_round
            )
        
        full_prompt = f"""{system_prompt}

=== CONVERSATION HISTORY ===
{conversation_history}

=== CURRENT SITUATION ===
Round {current_round} of {MAX_ROUNDS}
The {user_role} just said: "{user_message}"

Now respond as the {agent_role}. Remember to output ONLY valid JSON."""

        # =====================================================================
        # Step 5: Generate response with auditor retry logic
        # =====================================================================
        auditor_passed = False
        auditor_warning = None
        agent_text = None
        counter_offer = None
        retry_count = 0
        game_eval = {"has_offer": False, "offer_amount": None, "meets_floor": False}  
        
        while retry_count <= MAX_AUDITOR_RETRIES and not auditor_passed:
            # Generate AI response
            raw_response = call_gemini_with_retry(full_prompt)
            
            # Parse JSON
            try:
                # Clean markdown if present
                cleaned = raw_response.strip()
                if cleaned.startswith("```json"):
                    cleaned = cleaned.split("```json")[1].split("```")[0].strip()
                elif cleaned.startswith("```"):
                    cleaned = cleaned.split("```")[1].split("```")[0].strip()
                
                response_json = json.loads(cleaned)
                agent_text = response_json.get("message", cleaned)
                game_eval = evaluate_game_state(response_json, floor_price or 0)
                counter_offer = game_eval["offer_amount"]
                
                print(f"✅ JSON parsed successfully")
                print(f"💰 Neurosymbolic eval: offer={counter_offer}, meets_floor={game_eval['meets_floor']}")
            except json.JSONDecodeError:
                print(f"⚠️  JSON parse failed, using raw text")
                agent_text = raw_response
                counter_offer = None
                game_eval = {"has_offer": False, "offer_amount": None, "meets_floor": False}
            
            # Run auditor validation
            print(f"🛡️  [Auditor] Validating response (attempt {retry_count + 1}/{MAX_AUDITOR_RETRIES + 1})...")
            audit_result = validate_turn(agent_text)
            
            auditor_passed = audit_result["is_valid"]
            
            if not auditor_passed:
                auditor_warning = audit_result.get("auditor_warning", "Citation validation failed")
                flagged_law = audit_result.get("flagged_law")
                
                print(f"❌ [Auditor] Validation failed: {auditor_warning}")
                
                # If max retries reached, accept with warning
                if retry_count >= MAX_AUDITOR_RETRIES:
                    print(f"⚠️  Max retries reached. Returning with warning.")
                    auditor_passed = False  # Keep as failed but return anyway
                    break
                
                # Retry: Add feedback to prompt
                print(f"🔄 Retrying with auditor feedback...")
                full_prompt += f"\n\n[AUDITOR FEEDBACK - RETRY {retry_count + 1}]:\n{auditor_warning}\nPlease fix this and regenerate your response."
                retry_count += 1
                time.sleep(2)  # Brief pause before retry
                
            else:
                print(f"✅ [Auditor] Validation passed")
                citations_found = audit_result.get("citations_found", [])
        
        # =====================================================================
        # Step 6: Generate audio (TODO - after M2 updates voice.py)
        # =====================================================================
        audio_url = None
        # TODO: Implement after M2 adds generate_audio_bytes()
        # try:
        #     from backend.tts.voice import generate_audio_bytes
        #     audio_bytes = generate_audio_bytes(agent_text, agent_role)
        #     audio_url = upload_audio_to_storage(case_id, current_round, agent_role, audio_bytes)
        #     print(f"🔊 Audio generated: {audio_url}")
        # except Exception as e:
        #     print(f"⚠️  Audio generation failed: {e}")
        
        # =====================================================================
        # Step 7: Save to Firestore (if auditor passed OR max retries reached)
        # =====================================================================
        if auditor_passed or retry_count > MAX_AUDITOR_RETRIES:
            print(f"💾 Saving {agent_role} message to Firestore...")
            messages_ref.add({
                "role": agent_role,
                "content": agent_text,
                "round": current_round,
                "counter_offer_rm": counter_offer,
                "audio_url": audio_url,
                "auditor_passed": auditor_passed,
                "auditor_warning": auditor_warning if not auditor_passed else None,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })
        else:
            print(f"⏸️  Message NOT saved (auditor failed and will retry)")
        
        # =====================================================================
        # Step 8: Determine game state (Neurosymbolic logic)
        # =====================================================================
      
        game_state = "active"
        
        if game_eval.get("meets_floor"):
                game_state = "settled"
                case_ref.update({"status": "done"})
                print(f"🎉 Settlement reached! Offer ({counter_offer}) meets floor ({floor_price})")
        
        # Check if max rounds reached → Round 4.5 (pending user decision)
        if current_round >= MAX_ROUNDS:
            if game_state != "settled":
                game_state = "pending_decision"  # User must accept/reject
                print(f"⏰ Max rounds reached. Awaiting user decision...")
        
        # Check for potential deadlock (no progress in offers)
        # TODO: Add more sophisticated deadlock detection
        
        # =====================================================================
        # Step 9: Generate chips 
        # =====================================================================
        chips = None
        try:
            #prepeare context for chips 
            conversation_history_str = "\n".join([
                f"[{msg['role'].upper()}]: {msg['content'][:100]}..."
                for msg in history[-4:]  # Last 4 messages for chips context
            ])
            case_context_dict = {
                "case_title": case_title,
                "current_round": current_round,
                "counter_offer": counter_offer,
            }
            #generate chips prompt
            chips_prompt = generate_chips_prompt(
                conversation_history=conversation_history_str,
                case_context=case_context_dict
            )
            # Call Gemini to get chips
            print(f"🎮 Generating strategy chips...")
            chips_response = call_gemini_with_retry(chips_prompt)

            # Parse chips JSON
            try:
                chips_cleaned = chips_response.strip()
                if chips_cleaned.startswith("```json"):
                    chips_cleaned = chips_cleaned.split("```json")[1].split("```")[0].strip()
                elif chips_cleaned.startswith("```"):
                    chips_cleaned = chips_cleaned.split("```")[1].split("```")[0].strip()
                
                chips = json.loads(chips_cleaned)
                print(f"✅ Chips generated: {chips.get('question', '')}")
            except json.JSONDecodeError:
                print(f"⚠️  Failed to parse chips JSON")
                chips = None
        except Exception as e:
            print(f"⚠️  Chips generation skipped: {e}")
        
        # =====================================================================
        # Step 10: Return response
        # =====================================================================
        print(f"✅ [Turn {current_round}] Complete - Game state: {game_state}")
        print(f"{'='*60}\n")
        
        return {
            "agent_message": agent_text,
            "audio_url": audio_url,
            "auditor_passed": auditor_passed,
            "auditor_warning": auditor_warning,
            "counter_offer_rm": counter_offer,
            "game_state": game_state,
            "citations_found": audit_result.get("citations_found", []) if auditor_passed else [],
            "chips": chips,
        }
        
    except Exception as e:
        print(f"❌ [Orchestrator] Turn error: {str(e)}")
        import traceback
        traceback.print_exc()
        
        # Return error response
        return {
            "agent_message": f"System error: {str(e)}",
            "audio_url": None,
            "auditor_passed": False,
            "auditor_warning": f"System error: {str(e)}",
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
            conversation_history.append(
                f"[Round {msg_data.get('round')}] {msg_data.get('role').upper()}: {msg_data.get('content')}"
            )
        
        history_text = "\n".join(conversation_history)
        
        # Get legal context
        legal_docs = retrieve_law(case_title, use_agentic=False)
        legal_context = "\n".join([
            f"- {doc['law']} Section {doc['section']}: {doc['excerpt'][:200]}"
            for doc in legal_docs
        ])
        
        # Build mediator prompt
        case_data_dict = {
            "legal_context": legal_context,
            "case_title": case_title,
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
            print(f"❌ Failed to parse mediator JSON")
            # Return fallback settlement
            return {
                "summary": "Unable to generate settlement. Please consult a legal professional.",
                "recommended_settlement_rm": 0,
                "confidence": 0.0,
                "citations": []
            }
    
    except Exception as e:
        print(f"❌ Mediator settlement error: {str(e)}")
        raise e

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
        # Inject legal_context_str into the prompt format
        # Use replace() instead of format() to avoid issues with JSON braces {} in the prompt
        # system_instruction = build_plaintiff_prompt(
        #     legal_context=legal_context_str,
        #     evidence_facts=evidence_context
        # )

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