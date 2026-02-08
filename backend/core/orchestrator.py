"""
Orchestrator for Phase 1: Dumb Loop
Implements basic 2-turn negotiation: Plaintiff -> Defendant -> End
No LangGraph yet - just a simple Python loop.
"""
import os
from typing import Optional
from firebase_admin import firestore
from google import genai
from google.genai import types

# =====================================================================
# Import M1's Prompts (M3 NEVER edits these - just imports)
# =====================================================================
from backend.prompts.plaintiff import PLAINTIFF_SYS_PROMPT
from backend.prompts.defendant import DEFENDANT_SYS_PROMPT
from backend.prompts.mediator import MEDIATOR_SYS_PROMPT  # For Phase 2

# Initialize Gemini client
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Use Gemini model as specified in the plan
# model = genai.GenerativeModel("gemini-2.0-flash-exp")
model = "gemini-2.5-flash"


def get_db():
    """Get Firestore client."""
    return firestore.client()


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
        
        plaintiff_prompt = f"""{PLAINTIFF_SYS_PROMPT}

Case Title: {case_title}
Available Evidence: {evidence_context}

Make your opening argument."""

        plaintiff_response = client.models.generate_content(
            model=model,
            contents=plaintiff_prompt
        )
        plaintiff_text = plaintiff_response.text
        
        # Write to Firestore (M4's UI will show this immediately via onSnapshot)
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
        
        defendant_prompt = f"""{DEFENDANT_SYS_PROMPT}

Case Title: {case_title}
Available Evidence: {evidence_context}

The landlord argued:
"{plaintiff_text}"

Respond to their argument."""

        defendant_response = client.models.generate_content(
            model=model,
            contents=defendant_prompt
        )
        defendant_text = defendant_response.text
        
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