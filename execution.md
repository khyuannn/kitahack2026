LexSuluh: Phase 2 Master Execution Plan
Goal: Transform the Phase 1 skeleton into a Turn-Based Cognitive Architecture featuring Evidence Validation, a "Human-in-the-Loop" Auditor, Strategic Chips, and Real-Time Multiplayer UI.
Core Philosophy: "The Commander's Console" + "Safe Auditor."
Commander's Console: The user is the Commander. The AI is the weapon. The user can upload evidence mid-battle and give direct orders that the AI must obey.
Safe Auditor: We keep the Auditor (M2) but surface warnings to the UI (M4) to prevent infinite loops.
1. Target File Structure & Ownership
Legend:
[NEW] = File does not exist, needs creation.
[MOD] = Existing file, needs major logic update.
[M1] = AI Architect (Prompts & Persona) - Teammate
[M2] = Intelligence & Tools (Evidence, Voice, Auditor) - You
[M3] = Orchestrator (State Machine & API) - Teammate
[M4] = Frontend (UI & Realtime) - Teammate
kitahack2026/
├── .env                  [MOD] Add EDGE_TTS settings, GEMINI_API_KEY
├── CONTRACT.md
├── backend/
│   ├── app/
│   │   ├── main.py       [MOD] [M3] Endpoints: /next-turn, /validate-evidence, /export-pdf
│   │   └── api_models.py [MOD] [M3] Add AuditorResponse, ChipOptions, EvidenceResponse, 'audioUrl' in schema, Update to include 'auditor_feedback', 'chips'
│   ├── core/
│   │   ├── orchestrator.py [MOD] [M3] The "Brain" wiring M1 prompts + M2 tools
│   │   └── auditor.py      [MOD] [M2] The "Safe" Validator (Input: Draft / Output: Warning/Pass)
│   ├── graph/
│   │   └── agent_graph.py  [MOD] [M3] The 4.5-Round State Machine
│   ├── logic/
│   │   ├── evidence.py       [NEW] [M2] Gemini Vision (Image -> JSON Facts)
│   │   ├── neurosymbolic.py  [NEW] [M2] Regex parsers for money & game state
│   │   └── voice.py          [NEW] [M2] Edge-TTS Wrapper (Text -> Audio Bytes)
│   ├── prompts/
│   │   ├── plaintiff.py      [MOD] [M1] Implement build_plaintiff_prompt() logic
│   │   ├── defendant.py      [MOD] [M1] Implement build_defendant_prompt() logic
│   │   ├── mediator.py       [MOD] [M1] Logic for Round 3 intervention
│   │   ├── chips.py          [NEW] [M1] "Commander's Console" option generation
│   │   └── court_filing.py   [NEW] [M1] "Sad Path" Form 198 JSON Generator
│   └── rag/
│       ├── ingest.py         [MOD] [M2] Completed
│       └── retrieval.py      [MOD] [M2] RAG Search Logic
└── app/
    └── negotiation/
        └── [caseId]/
            ├── page.tsx             [MOD] [M4] Deadlock Modal & Printable View Trigger
            ├── StrategyConsole.tsx  [NEW] [M4] The Fixed Footer (Command Input + Chips)
            ├── components/
            │   ├── AgentAudioPlayer.tsx [NEW] [M4] Listen to Firestore audioUrl
            │   ├── EvidenceModal.tsx    [NEW] [M4] Mid-game Evidence Upload
            │   ├── SettlementMeter.tsx  [NEW] [M4] Visual Confidence Bar
            │   └── InviteModal.tsx      [NEW] [M4] Multiplayer Link Sharing
    ├── page.tsx                     [MOD] [M4] Landing Page (Initial Evidence Upload)


2. Role-Based Execution Plan
M1: AI Architect (Teammate)
Focus: The Script, Dynamic Variables, and "Sad Path" Logic.
Goal: Implement the "Smart Prompt Builder" to handle the 4.5-Round Limit and Strict Citation Rules.
Task 1: The Smart Prompt Builder Functions
Files: backend/prompts/plaintiff.py, backend/prompts/defendant.py
Method: Do not just write a string. Write a python function: build_prompt(case_data, current_round).
Step 1: The Base Persona & Critical Rules
Define the base identity string including M2's Critical Regex Rule:
"CRITICAL RULE: If you cite a law, you MUST use the full formal name including the year, and cite exactly one section per sentence. (Example: 'Under Section 15 of the Sale of Goods Act 1957...'). Do not use abbreviations like 'SGA' or list multiple sections at once."
Variables to Inject: {case_title}, {case_type}, {incident_date}, {dispute_amount}, {short_description}, {case_facts}, {evidence_summary}, {floor_price}.
Step 2: The Round Directive (If/Else Logic)
Round 1 (Opening): "GOAL: Acknowledge dispute, state initial defense, mention evidence. Do NOT make final offer."
Round 2 (Attack): "GOAL: Attack the previous argument. Rely heavily on citing specific laws and sections to intimidate."
Round 3 (Negotiation): "GOAL: The Mediator has spoken. Make a counter-offer closer to the middle, but stay firm on key facts."
Round 4 (Final Proposal): "GOAL: This is your final chance. Make a 'take-it-or-leave-it' offer. Your absolute floor price is RM {floor_price}. Do not offer more than this."
Task 2: The Output Format (JSON for Speed)
Instruction: Append this strictly to the end of every prompt:
[OUTPUT - ONLY VALID JSON]
{
  "message": "Your conversational text response. Keep under 100 words.",
  "counter_offer_rm": 1500
}


Task 3: Context-Aware Chip Generation
File: backend/prompts/chips.py [NEW]
Method: generate_chips_prompt(conversation_history, case_context)
Output:
{
  "question": "The landlord claims damages...",
  "options": [{"label": "Demand proof"}, {"label": "Cite Wear & Tear"}, {"label": "Offer Split"}]
}


Task 4: The "Sad Path" Court Filing (JSON Pivot)
File: backend/prompts/court_filing.py [NEW]
Goal: Summarize the failed negotiation into a strict JSON Object (not PDF text) containing the 'Statement of Claim' details.
Output Format:
{
  "plaintiff_details": "Name, ID...",
  "defendant_details": "Name, ID...",
  "statement_of_claim": "The Plaintiff claims...",
  "amount_claimed": "RM 1,500",
  "facts_list": ["Fact 1", "Fact 2"]
}


M2: Intelligence & Tools Engineer (You)
Focus: The "Black Box" Modules (Vision, Voice, Auditor).
Goal: Deliver robust Python functions that M3 can simply import and call without worrying about the implementation.
Task 1: Evidence Validator (Gemini Vision)
File: backend/logic/evidence.py
Method: validate_evidence(image_url: str, user_claim: str) -> dict
Integration Logic:
Input: Accepts a Firebase Storage URL (from M4) and the user's initial claim text.
Action: Uses the .env model (gemini-3-pro) to analyze the image/PDF against the claim.
Output (Strict JSON):
{
  "is_relevant": true,
  "summary_for_agent": "Photo shows a cracked tile. Date stamp Jan 2024 is visible.",
  "confidence_score": 0.95
}


Connection: M3 calls this on the /validate-evidence endpoint. The summary_for_agent string is saved to Firestore and later injected into M1's plaintiff.py prompt as {initial_evidence_summary}.
Task 2: The "Safe" Auditor (Regex + RAG)
File: backend/core/auditor.py
Method: audit_response(draft_text: str) -> dict
Integration Logic:
Input: The raw text generated by the LLM (before it's sent to the user).
Action:
Extract citations using your Strict Regex Rule.
Verify existence against your RAG Knowledge Base (backend/rag/retrieval.py).
Output:
{
  "passed": false,
  "warning_message": "Citation Mismatch: Section 15 refers to 'implied condition', not 'refunds'."
}


Connection: M3 calls this before saving the message. If passed is false, M4 displays the warning_message in the UI with a "Retry" button, keeping the human in the loop.
Task 3: Voice Module (Edge-TTS)
File: backend/logic/voice.py
Method: generate_audio_bytes(text: str, voice_id: str) -> bytes
Integration Logic:
Action: Uses edge-tts to generate high-quality speech without Cloud API keys.
Connection: M3 calls this internally within the graph execution, uploads the result to Firebase Storage, and saves the URL.
Task 4: Neurosymbolic Logic (Regex Parser)
File: backend/logic/neurosymbolic.py [NEW]
Methods:
extract_monetary_offer(text: str) -> Optional[int]
evaluate_game_state(agent_text: str, floor_price: int) -> Dict[str, Any]
Integration Logic:
Purpose: Reliably detect if the Opponent AI has met the User's floor price without relying on another LLM call.
Input: The extracted counter_offer_rm from M1's JSON and the hidden {floor_price}.
Output:
{
  "has_offer": true,
  "offer_amount": 1500,
  "meets_floor": true
}


Connection: M3 calls this after every Defendant turn. If meets_floor is True, M3 triggers the "Settlement Success" state instead of continuing the loop.
M3: Backend Orchestrator
Focus: The "Brain" & API integration.
Goal: Wire M1's prompts and M2's tools into a strict State Machine that manages the 4.5-Round flow, Mid-Game Evidence Injection, and Deadlocks.
Task 1: The API Models
File: backend/app/api_models.py [MOD]    – done
Action: Update schemas to support the new "Hybrid" features and File API.
Code Structure:
class TurnRequest(BaseModel):
    case_id: str
    user_message: str
    current_round: int
    evidence_uris: Optional[list[str]] = [] # [NEW] Array of Gemini File API URIs
    # ... other context fields like floor_price

class TurnResponse(BaseModel):
    agent_message: str
    audio_url: Optional[str] = None # M3: Added for Firebase Audio URL
    auditor_warning: Optional[str] = None
    auditor_passed: bool = True
    chips: Optional[dict] = None
    game_state: str
    counter_offer_rm: Optional[int] = None


Task 2: The 4.5-Round State Machine
File: backend/graph/agent_graph.py [MOD]
Reference: Refactor existing StateGraph to enforce limits and parse JSON.
Logic Flow:
Node: determine_stage:
If messages count implies Round 1-2: Stage = EARLY
After Round 2 ends: Trigger "Middle Round" Mediator Intervention.
If messages count implies Round 3-4: Stage = NEGOTIATION
If Round 4 ends: Transition to Stage = PENDING_DECISION (Round 4.5).
Node: defendant_agent:
Import: from backend.prompts.defendant import build_defendant_prompt
[MODIFIED] Action: Call Gemini API using the .env model (gemini-3-pro). Pass the build_defendant_prompt string AND the array of evidence_uris directly into the contents payload so the AI reads the raw documents natively.
Parsing:
Parse JSON: data = json.loads(llm_response)
Extract: message_text = data["message"], counter_offer = data.get("counter_offer_rm")
Audio Pipeline:
Call voice_bytes = voice.generate_audio_bytes(message_text, ...)
Upload: Upload voice_bytes to Firebase Storage -> Get audio_url.
Integration (M2): Call neurosymbolic.evaluate_game_state using the extracted counter_offer.
Integration (M2): Call auditor.audit_response(message_text).
Output: Return state dict with message_text, audio_url, auditor_result, counter_offer.
Edge Logic (The "Router"):
If neurosymbolic says meets_floor == True -> Transition to End (Settled).
If auditor says passed == False -> Pause & Return Warning (Do not save to DB yet).
If current_round == 2 (End) -> Transition to "Middle Round" (Mediator guidance injected).
If current_round == 4 (End) -> Transition to End (Wait for User Accept/Reject - Round 4.5).
Task 3: The Orchestrator "Brain"
File: backend/core/orchestrator.py [MOD]
Goal: The central function calling the Graph.
Method: run_negotiation_turn(...)
Workflow:
Input: Receive User Message.
Graph Execution: Run agent_graph.invoke(...).
Result Processing: Extract audio_url from the graph final state and include it in TurnResponse.
Handling "Auditor Fail":
If the Graph returns an Auditor Warning, do not save the AI message to the messages list in Firestore effectively.
Return the draft message + warning to Frontend.
Chips Generation (M1):
Call: prompts.chips.generate_chips_prompt using the Result message from the AI.
Action: Attach the generated chips to the TurnResponse.
Task 4: Main Endpoints
File: backend/app/main.py [MOD]
Endpoint: /next-turn
Calls orchestrator.run_negotiation_turn.
Returns TurnResponse (Message + Chips + Warning + AudioURL).
Endpoint: /validate-evidence
Calls M2's logic.evidence.validate_evidence (which auto-detects mime-type and enforces the 5MB limit).
[MODIFIED] Action: If valid, M3 uploads the file to the Gemini File API to get the lightweight URI.
[MODIFIED] Output: Returns the JSON validation facts + the file_uri back to the frontend.
Endpoint: /export-pdf
Trigger: User clicks "Export Court Form" on Deadlock screen.
Action: Calls M1's prompts.court_filing.generate_filing_summary.
Output: Returns Structured JSON directly to the frontend. No file generation.
M4: Frontend Lead
Focus: UI Layout, Real-time State, & The "Commander" Experience.
Goal: A "No-Crash" Frontend that handles the Auditor Warnings and 4.5-Round visuals.
Task 1: The "Commander's Console" (Fixed Footer)
File: app/negotiation/[caseId]/StrategyConsole.tsx [NEW]
UI States:
State A (User Turn): Shows Text Input + 3 Chips.
State B (AI Turn): Input Locked. Show "Opponent is typing...".
State C (Auditor Warning): Show yellow alert box with [Retry] | [Proceed].
Task 2: Evidence Upload & Animation
File: components/EvidenceModal.tsx [NEW]
Trigger: Paperclip icon in chat. File input must accept .jpg, .png, .pdf (Max 5MB).
Flow: Upload -> /validate-evidence -> Show Result.
[MODIFIED] UI Render: If the file is an image, show a small thumbnail in the chat bubble. If it is a PDF, do not build a viewer; just render a simple 📄 document icon with the file name (e.g., "📄 Tenancy_Agreement.pdf").
[NEW] State Management: Store the returned file_uri in the frontend state and attach it to the TurnRequest when the user clicks "Send".
Task 3: The Settlement Meter
File: components/SettlementMeter.tsx [NEW]
Logic:
Listen to counter_offer_rm from M3.
Calculate (Current Offer / Floor Price) * 100.
Visual: A progress bar (Red -> Yellow -> Green).
Task 4: The "Deadlock" & Printable View
File: app/negotiation/[caseId]/page.tsx [MOD]
Logic:
If game_state === "deadlock": Show "Negotiation Failed" + [Export Small Claims Form] button.
Action: Call /export-pdf. Receive JSON.
Render: Display a clean, professional HTML "Court Form" modal.
Print: User clicks "Print Official Copy", triggering browser's window.print().
Task 5: Real-Time Audio Player
File: components/AgentAudioPlayer.tsx [NEW]
Logic:
Listen to the audioUrl field in the Firestore message document.
When a new message arrives with audioUrl, auto-play it.
Fallback: Keep window.speechSynthesis as a backup.
Integration Checklist
Pre-Game: M4 collects case_facts -> M3 initializes DB.
Evidence: M4 uploads image/PDF -> M3 calls M2 validate_evidence (File API Upload) -> Saves summary & returns URI.
Round 1: M3 calls M1 plaintiff_prompt (injecting evidence summary).
Turn Loop:
AI generates JSON (M1) (reading Raw Files injected via URI).
M3 Parses -> Generates Audio -> Checks Auditor.
Orchestrator (M3) returns Response with AudioURL to Frontend (M4).
Audio Playback: M4 plays audio from Firestore URL.
End Game:
Success: M2 Neurosymbolic sees Offer >= Floor Price.
Fail: Round 4 ends, User rejects final offer -> PDF Export (JSON -> HTML Print).


