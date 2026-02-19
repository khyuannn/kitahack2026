"""
Agent Graph (Phase 1.5 - Optional RAG Integration)
Phase 1: Simple 2-turn loop with optional law retrieval
Phase 2: Extended state tracking for turn-based negotiation
"""
import os
from typing import TypedDict, List, Annotated
from firebase_admin import firestore
from google import genai
from typing import Optional

# Import M1's prompts
from backend.prompts.plaintiff import build_plaintiff_prompt
from backend.prompts.defendant import build_defendant_prompt
from backend.prompts.mediator import build_mediator_prompt  # For Phase 2

# Import M2's RAG 
try:
    from backend.rag.retrieval import retrieve_law
    RAG_AVAILABLE = True
    print("✅ RAG module loaded successfully")
except ImportError:
    RAG_AVAILABLE = False
    print("⚠️  RAG module not available - using mock mode")
    
    # Mock fallback for Phase 1
    def retrieve_law(query: str) -> List[dict]:
        return [{
            "law": "Contracts Act 1950",
            "section": "75",
            "excerpt": "When a contract has been broken, compensation is due."
        }]

# Initialize Gemini
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
MODEL = os.getenv("GEMINI_MODEL", "gemini-3-pro-preview")


# =============================================================================
# State Definition (phase2 extended)
# =============================================================================
class NegotiationState(TypedDict):
    """
    State that gets passed between nodes.
    Phase 1.5: Basic fields for simple negotiation
    Phase 2: Extended with game state tracking and validation
    """
    # Core fields (Phase 1.5)
    case_id: str
    case_title: str
    case_type: str
    evidence_context: str
    law_context: str
    messages: List[dict]
    round: int
    max_rounds: int
    
    # Phase 2 extensions
    floor_price: int  # Minimum acceptable settlement
    counter_offer: Optional[int]  # Current offer amount
    game_state: str  # "active" | "settled" | "deadlock" | "pending_decision"
    auditor_passed: bool  # Whether last response passed validation
    auditor_warning: Optional[str]  # Auditor warning message if failed
    audio_url: Optional[str]  # Audio file URL from TTS


# =============================================================================
# Helper Functions
# =============================================================================
def get_db():
    """Get Firestore client."""
    return firestore.client()


def retrieve_laws_for_case(case_title: str, evidence: str, history: List[dict] = None) -> str:
    """
    Phase 1.5: Retrieve relevant laws using M2's RAG.
    Phase 2: Supports conversation history for better retrieval.
    Args:
        case_title: Case title
        evidence: Evidence text
        history: Optional conversation history
        
    Returns:
        Formatted law text for prompt injection
    """
    if not RAG_AVAILABLE:
        print("⚠️  Using mock law retrieval (RAG not available)")
        return "Section 75 of Contracts Act 1950: Compensation for breach."
    
    # Construct search query
    query = f"{case_title} {evidence}"
    
    # Call M2's retrieve_law function (with history if available)
    if history:
        results = retrieve_law(query, history=history, use_agentic=True)
    else:
        results = retrieve_law(query, use_agentic=False)
    
    # Format as readable text for prompt
    formatted_laws = []
    for result in results:
        law_text = f"""
Law: {result['law']}
Section: {result['section']}
Content: {result['excerpt']}
"""
        formatted_laws.append(law_text.strip())
    
    return "\n\n".join(formatted_laws) if formatted_laws else "No relevant laws found."


# =============================================================================
# Agent Nodes
# =============================================================================
def plaintiff_node(state: NegotiationState) -> NegotiationState:
    """
    Plaintiff agent generates opening argument.
    Phase 1.5: Uses law context from RAG.
    Phase 2: Uses M1's build_plaintiff_prompt with full context.
    """
    db = get_db()
    case_ref = db.collection("cases").document(state["case_id"])
    messages_ref = case_ref.collection("messages")
    
    print(f"[Graph] Plaintiff speaking (Round {state['round']})...")
    
    # Build case data dict for M1's prompt builder
    case_data_dict = {
        "case_title": state["case_title"],
        "case_type": state.get("case_type", "tenancy_deposit"),
        "incident_date": "",
        "dispute_amount": 0,
        "short_description": state["case_title"],
        "case_facts": f"Case: {state['case_title']}",
        "evidence_summary": state["evidence_context"],
        "floor_price": state.get("floor_price", 0),
        "legal_context": state["law_context"],
    }
    # Use M1's prompt builder
    prompt = build_plaintiff_prompt(
        case_data=case_data_dict,
        current_round=state["round"]
    )

# Case Title: {state['case_title']}
# Evidence: {state['evidence_context']}

# Relevant Malaysian Laws:
# {state['law_context']}

# Based on the above laws and evidence, make your opening argument as the landlord.
# Keep your response under 300 words."""

    # Generate response
    response = client.models.generate_content(
        model=MODEL,
        contents=prompt
    )
    
    plaintiff_text = response.text
     # Parse JSON if available
    try:
        import json
        cleaned = plaintiff_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned.split("```json")[1].split("```")[0].strip()
        response_json = json.loads(cleaned)
        plaintiff_text = response_json.get("message", plaintiff_text)
    except:
        pass

    # Save to Firestore
    messages_ref.add({
        "role": "plaintiff",
        "content": plaintiff_text,
        "round": state["round"],
        "createdAt": firestore.SERVER_TIMESTAMP
    })
    
    # Update state
    state["messages"].append({
        "role": "plaintiff",
        "content": plaintiff_text
    })
    
    print(f"[Graph] Plaintiff: {plaintiff_text[:100]}...")
    
    return state


def defendant_node(state: NegotiationState) -> NegotiationState:
    """
    Defendant agent responds to plaintiff.
    Phase 1.5: Uses law context from RAG.
    Phase 2: Uses M1's build_defendant_prompt with validation.
    """
    db = get_db()
    case_ref = db.collection("cases").document(state["case_id"])
    messages_ref = case_ref.collection("messages")
    
    print(f"[Graph] Defendant responding (Round {state['round']})...")
    
    # Get plaintiff's last message
    plaintiff_msg = state["messages"][-1]["content"] if state["messages"] else "No previous message"
    
    # Build case data dict for M1's prompt builder
    case_data_dict = {
        "case_title": state["case_title"],
        "case_type": state.get("case_type", "tenancy_deposit"),
        "case_facts": f"Case: {state['case_title']}",
        "evidence_summary": state["evidence_context"],
        "floor_price": state.get("floor_price", 0),
        "legal_context": state["law_context"],
    }
    
    # Use M1's prompt builder
    prompt = build_defendant_prompt(
        case_data=case_data_dict,
        current_round=state["round"]
    )
    # Add conversation context
    full_prompt = f"""{prompt}

The plaintiff argued:
"{plaintiff_msg}"

Respond to their argument."""

    # Generate response
    response = client.models.generate_content(
        model=MODEL,
        contents=full_prompt
    )
    
    defendant_text = response.text

    # Parse JSON if available
    try:
        import json
        cleaned = defendant_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned.split("```json")[1].split("```")[0].strip()
        response_json = json.loads(cleaned)
        defendant_text = response_json.get("message", defendant_text)
        state["counter_offer"] = response_json.get("counter_offer_rm")
    except:
        state["counter_offer"] = None

    # Save to Firestore
    messages_ref.add({
        "role": "defendant",
        "content": defendant_text,
        "round": state["round"],
        "counter_offer_rm": state.get("counter_offer"),
        "createdAt": firestore.SERVER_TIMESTAMP
    })
    
    # Update state
    state["messages"].append({
        "role": "defendant",
        "content": defendant_text
    })
    
    print(f"[Graph] Defendant: {defendant_text[:100]}...")
    
    return state


# =============================================================================
# Phase 2 Node: Determine Stage
# =============================================================================
def determine_stage_node(state: NegotiationState) -> NegotiationState:
    """
    Phase 2: Determine which stage we're in based on round count.
    
    Round 1-2: EARLY (opening arguments)
    Round 3: NEGOTIATION (after mediator intervention)
    Round 4: FINAL (last chance)
    After Round 4: PENDING_DECISION (Round 4.5)
    """
    current_round = state["round"]
    
    if current_round <= 2:
        state["game_state"] = "active"  # EARLY stage
    elif current_round == 3:
        state["game_state"] = "active"  # NEGOTIATION stage
        # Note: Mediator guidance is injected by orchestrator
    elif current_round == 4:
        state["game_state"] = "active"  # FINAL stage
    else:
        state["game_state"] = "pending_decision"  # Round 4.5
    
    return state

# =============================================================================
# Main Execution Function (replaces orchestrator.run_dumb_loop)
# =============================================================================
def run_negotiation_with_rag(case_id: str, mode: str = "mvp") -> None:
    """
    Phase 1.5: Run negotiation WITH law retrieval.
    
    Flow:
    1. Retrieve case data and evidence from Firestore
    2. Search for relevant laws using M2's RAG
    3. Plaintiff argues (with law context)
    4. Defendant responds (with law context)
    5. End (status → "done")
    
    Phase 2 will expand this to:
    - Multiple rounds   
    - Planner nodes         # orchestrator already do
    - Mediator settlement   # orchestrator already do - inject_mediator_guidance()
    Note: Phase 2's /next-turn endpoint uses orchestrator.run_negotiation_turn()
          This function is only used for /run endpoint (mode="full")
    """
    db = get_db()
    case_ref = db.collection("cases").document(case_id)
    
    try:
        # Update status
        case_ref.update({"status": "running"})
        
        # =====================================================================
        # Step 1: Retrieve case data
        # =====================================================================
        case_data = case_ref.get().to_dict()
        case_title = case_data.get("title", "Tenancy Deposit Dispute")
        case_type = case_data.get("case_type", "tenancy_deposit")
        
        # Get evidence
        evidence_docs = case_ref.collection("evidence").stream()
        evidence_texts = []
        for doc in evidence_docs:
            evidence_data = doc.to_dict()
            extracted = evidence_data.get("extractedText")
            if extracted:
                evidence_texts.append(extracted)
        
        evidence_context = "\n".join(evidence_texts) if evidence_texts else "No evidence provided."
        
        # =====================================================================
        # Step 2: Retrieve relevant laws (M2's RAG) 🆕
        # =====================================================================
        print(f"[Graph] Retrieving laws for case: {case_title}")
        law_context = retrieve_laws_for_case(case_title, evidence_context)
        print(f"[Graph] Retrieved {len(law_context)} characters of law text")
        
        # =====================================================================
        # Step 3: Initialize state
        # =====================================================================
        state: NegotiationState = {
            # Core fields
            "case_id": case_id,
            "case_title": case_title,
            "case_type": case_type,
            "evidence_context": evidence_context,
            "law_context": law_context,
            "messages": [],
            "round": 1,
            "max_rounds": 1,  # Phase 1.5: Only 1 round
            
            # Phase 2 extensions
            "floor_price": 0,
            "counter_offer": None,
            "game_state": "active",
            "auditor_passed": True,
            "auditor_warning": None,
            "audio_url": None,
        }
        
        # =====================================================================
        # Step 4: Run the graph (Phase 1: Simple sequence)
        # =====================================================================
        # In Phase 2, this will be replaced with LangGraph's graph.invoke()
        
        state = plaintiff_node(state)
        state = defendant_node(state)
        
        # =====================================================================
        # Step 5: Mark as done
        # =====================================================================
        case_ref.update({"status": "done"})
        print(f"✅ [Graph] Negotiation completed for case {case_id}")
        
    except Exception as e:
        print(f"❌ [Graph] Error in case {case_id}: {str(e)}")
        case_ref.update({"status": "error"})
        
        # Save error message
        case_ref.collection("messages").add({
            "role": "system",
            "content": f"Error occurred: {str(e)}",
            "round": 0,
            "createdAt": firestore.SERVER_TIMESTAMP
        })


# =============================================================================
# Phase 2 Preview: Multi-round graph (NOT USED YET)
# =============================================================================
def build_negotiation_graph():
    """
    Phase 2: Full LangGraph implementation.
    This is just a preview - NOT USED in current implementation.
    """
    try:
        from langgraph.graph import StateGraph, END
        
        graph = StateGraph(NegotiationState)
        
        # Add nodes
        graph.add_node("determine_stage", determine_stage_node)
        graph.add_node("plaintiff", plaintiff_node)
        graph.add_node("defendant", defendant_node)
        # Phase 2 will add: planner_node, mediator_node
        
        # Add edges
        graph.add_edge("determine_stage", "plaintiff")
        graph.add_edge("plaintiff", "defendant")
        graph.add_edge("defendant", END)
        # Phase 2 will add: conditional routing based on game_state
        
        graph.set_entry_point("determine_stage")
    
        return graph.compile()
    except ImportError:
        print("⚠️  LangGraph not available. Use orchestrator.run_negotiation_turn() instead.")
        return None


# =============================================================================
# Testing
# =============================================================================
if __name__ == "__main__":
    print("\n" + "="*50)
    print("🧪 Testing Agent Graph with RAG (Phase 1.5 → Phase 2)")
    print("="*50)
    
    # Test law retrieval
    test_query = "tenant deposit dispute"
    laws = retrieve_laws_for_case("Deposit Dispute", "RM2500 deposit")
    print(f"\n📚 Retrieved Laws:\n{laws[:200]}...\n")
    
    print("✅ Agent graph module ready!")
    print("="*50)