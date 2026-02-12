"""
Agent Graph (Phase 1.5 - Optional RAG Integration)
Phase 1: Simple 2-turn loop with optional law retrieval
Phase 2: Full multi-round negotiation with planner nodes
"""
import os
from typing import TypedDict, List, Annotated
from firebase_admin import firestore
from google import genai

# Import M1's prompts
from backend.prompts.plaintiff import PLAINTIFF_SYS_PROMPT
from backend.prompts.defendant import DEFENDANT_SYS_PROMPT
from backend.prompts.mediator import MEDIATOR_SYS_PROMPT

# Import M2's RAG (optional for Phase 1)
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
MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash-exp")


# =============================================================================
# State Definition
# =============================================================================
class NegotiationState(TypedDict):
    """State that gets passed between nodes."""
    case_id: str
    case_title: str
    evidence_context: str
    law_context: str
    messages: List[dict]
    round: int
    max_rounds: int


# =============================================================================
# Helper Functions
# =============================================================================
def get_db():
    """Get Firestore client."""
    return firestore.client()


def retrieve_laws_for_case(case_title: str, evidence: str) -> str:
    """
    Phase 1.5: Retrieve relevant laws using M2's RAG.
    Phase 2: Will be called by planner node.
    """
    if not RAG_AVAILABLE:
        print("⚠️  Using mock law retrieval (RAG not available)")
        return "Section 75 of Contracts Act 1950: Compensation for breach."
    
    # Construct search query
    query = f"{case_title} {evidence}"
    
    # Call M2's retrieve_law function
    results = retrieve_law(query)
    
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
    """
    db = get_db()
    case_ref = db.collection("cases").document(state["case_id"])
    messages_ref = case_ref.collection("messages")
    
    print(f"[Graph] Plaintiff speaking (Round {state['round']})...")
    
    # Build prompt with law context
    prompt = f"""{PLAINTIFF_SYS_PROMPT}

Case Title: {state['case_title']}
Evidence: {state['evidence_context']}

Relevant Malaysian Laws:
{state['law_context']}

Based on the above laws and evidence, make your opening argument as the landlord.
Keep your response under 300 words."""

    # Generate response
    response = client.models.generate_content(
        model=MODEL,
        contents=prompt
    )
    
    plaintiff_text = response.text
    
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
    """
    db = get_db()
    case_ref = db.collection("cases").document(state["case_id"])
    messages_ref = case_ref.collection("messages")
    
    print(f"[Graph] Defendant responding (Round {state['round']})...")
    
    # Get plaintiff's last message
    plaintiff_msg = state["messages"][-1]["content"]
    
    # Build prompt
    prompt = f"""{DEFENDANT_SYS_PROMPT}

Case Title: {state['case_title']}
Evidence: {state['evidence_context']}

Relevant Malaysian Laws:
{state['law_context']}

The landlord argued:
"{plaintiff_msg}"

Based on the laws above, respond to their argument as the tenant.
Keep your response under 300 words."""

    # Generate response
    response = client.models.generate_content(
        model=MODEL,
        contents=prompt
    )
    
    defendant_text = response.text
    
    # Save to Firestore
    messages_ref.add({
        "role": "defendant",
        "content": defendant_text,
        "round": state["round"],
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
    - Planner nodes
    - Mediator settlement
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
            "case_id": case_id,
            "case_title": case_title,
            "evidence_context": evidence_context,
            "law_context": law_context,  # 🆕 Laws from RAG
            "messages": [],
            "round": 1,
            "max_rounds": 1  # Phase 1: Only 1 round
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
    This is just a preview - NOT USED in Phase 1.
    """
    from langgraph.graph import StateGraph, END
    
    graph = StateGraph(NegotiationState)
    
    # Add nodes
    graph.add_node("plaintiff", plaintiff_node)
    graph.add_node("defendant", defendant_node)
    # Phase 2 will add: planner_node, mediator_node
    
    # Add edges
    graph.add_edge("plaintiff", "defendant")
    graph.add_edge("defendant", END)
    # Phase 2 will add: conditional routing based on round count
    
    graph.set_entry_point("plaintiff")
    
    return graph.compile()


# =============================================================================
# Testing
# =============================================================================
if __name__ == "__main__":
    print("\n" + "="*50)
    print("🧪 Testing Agent Graph with RAG")
    print("="*50)
    
    # Test law retrieval
    test_query = "tenant deposit dispute"
    laws = retrieve_laws_for_case("Deposit Dispute", "RM2500 deposit")
    print(f"\n📚 Retrieved Laws:\n{laws[:200]}...\n")
    
    print("✅ Agent graph module ready!")
    print("="*50)