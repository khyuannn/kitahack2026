"""
FastAPI backend for BYP case management.
Integrates with Firebase, orchestrator, and frontend per contract.md.
Phase 1: basic api, firestore integration, dump loop
phase 2: turn-based negotiation with RAG, auditor, and TTS
"""
import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, Request, status, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import firebase_admin
from firebase_admin import credentials, firestore
import uuid
from typing import Optional, Dict, Any
from backend.core.orchestrator import run_dumb_loop, get_case_result, run_case as orchestrator_run_case
import threading
from backend.prompts.court_filing import COURT_FILING_PROMPT
from backend.core.orchestrator import call_gemini_with_retry
#phase 2
from backend.logic.evidence import validate_evidence 
from backend.core.auditor import validate_turn
# from backend.tts import voice   #add later if need

from backend.prompts.plaintiff import build_plaintiff_prompt
from backend.prompts.defendant import build_defendant_prompt

from backend.app.api_models import (
    CaseEvidenceRequest,
    CaseEvidenceResponse,
    GetCaseResultResponse,
    RunCaseRequest,
    RunCaseResponse,
    StartCaseRequest,
    StartCaseResponse,
    TurnRequest,  #phase2
    TurnResponse,
    ValidateEvidenceRequest,
    ValidateEvidenceResponse,
    ChipOptions,
    CourtFilingRequest,
    CourtFilingResponse,
)

load_dotenv()
# -----------------------------------------------------------------------------
# Firebase Admin SDK initialization (placeholder)
# -----------------------------------------------------------------------------
def _init_firebase() -> None:
    """
    Initialize Firebase Admin SDK using credentials from .env or service account JSON.
    Set FIREBASE_SERVICE_ACCOUNT to either:
    - Path to service account JSON file
    - Or leave empty if using GOOGLE_APPLICATION_CREDENTIALS
    """

    if firebase_admin._apps:
        return

    # Helper to resolve absolute path relative to project root
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    # Get from env, but if empty, fall back to default
    env_path = os.getenv("FIREBASE_SERVICE_ACCOUNT")
    if not env_path or not env_path.strip():
        service_account_path = os.path.join(base_dir, "backend", "serviceAccountKey.json")
    else:
        service_account_path = env_path.strip()

    if service_account_path and os.path.isfile(service_account_path):
        cred = credentials.Certificate(service_account_path)
        firebase_admin.initialize_app(cred)
        print(f"Firebase initialized with service account: {service_account_path}")
    else:
        print(f"Firebase credentials not found at {service_account_path}. running in mock mode.")

# debug purpose
print(f"debug: current dir: {os.getcwd()}")
path = os.getenv("FIREBASE_SERVICE_ACCOUNT") 
print(f"debug: path from env: {path}")
print(f"debug: file exists? {os.path.isfile(path) if path else 'N/A'}")       
# -----------------------------------------------------------------------------
# App setup
# -----------------------------------------------------------------------------
app = FastAPI(
    title="Lex Machina API",
    description="AI-powered dispute mediation system",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"], # Frontend origin for local dev
    allow_credentials=True,
    allow_methods=["*"], # allow all HTTP methods
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event() -> None:
    """Initialize Firebase on startup."""
    _init_firebase()
    global db
    db = firestore.client() if firebase_admin._apps else None

# -----------------------------------------------------------------------------
# Error handling
# -----------------------------------------------------------------------------
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    """Handle 422 validation errors with a consistent JSON response."""
    errors = exc.errors()
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Validation error",
            "errors": [
                {
                    "loc": err.get("loc", []),
                    "msg": err.get("msg", ""),
                    "type": err.get("type", ""),
                }
                for err in errors
            ],
        },
    )


# -----------------------------------------------------------------------------
# Endpoints (placeholder logic — will call orchestrator.py)
# -----------------------------------------------------------------------------
@app.post("/api/cases/start", response_model=StartCaseResponse, status_code=201)
async def start_case(request: StartCaseRequest) -> StartCaseResponse:
    """
    Create a new case.
    phase1: write to firestore and return caseId
    """
    case_id = str(uuid.uuid4())
    if db:
        db.collection("cases").document(case_id).set({
            "status": "created",
            "title": request.title,
            "caseType": request.caseType,
            "description": request.description or "",
            "amount": request.amount or 0,
            "incidentDate": request.incidentDate or "",
            "floorPrice": request.floorPrice or 0,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "createdBy": "mock-user-id",
        })
    return StartCaseResponse(caseId=case_id)


@app.post(
    "/api/cases/{caseId}/evidence",
    response_model=CaseEvidenceResponse,
    status_code=201,
)
async def add_evidence(
    caseId: str,
    request: CaseEvidenceRequest,
) -> CaseEvidenceResponse:
    """
    Add evidence to a case.
    phase1: store evidence metadata in Firestore
    TODO: Call orchestrator.add_evidence() or equivalent.
    Phase1: store evidence metadata in Firestore if available
    """
    # TODO: orchestrator.add_evidence(case_id=case_id, ...)
    if db:
        case_ref = db.collection("cases").document(caseId)
        if not case_ref.get().exists:
            raise HTTPException(
                status_code=404,
                detail=f"Case with ID {caseId} not found.",
            )
    evidence_id = str(uuid.uuid4())
    if db:
        evidence_data = {
            "fileType": request.fileType,
            "storageUrl": request.storageUrl,
            "createdAt": firestore.SERVER_TIMESTAMP,
        }
        if request.text:
            evidence_data["extractedText"] = request.text
        db.collection("cases").document(caseId).collection("evidence").document(evidence_id).set(evidence_data)
    # orchestrator.add_evidence(case_id=caseId, file_type=request.fileType, storage_url=request.storageUrl, text=request.text)
    return CaseEvidenceResponse(evidenceId=evidence_id)


@app.post(
    "/api/cases/{caseId}/run",
    response_model=RunCaseResponse,status_code=202,
)
async def start_case_run(
    caseId: str,
    request: RunCaseRequest,
) -> RunCaseResponse:
    """
    Start the mediation run for a case.
    phase1: call the dummy loop
    TODO: Call orchestrator.run_case() or equivalent.
    """
    # TODO: orchestrator.run_case(case_id=case_id, mode=request.mode)/ orchestrator.run_dumb_loop(caseId) 
    
    if db:
        case_ref = db.collection("cases").document(caseId)
        case_doc = case_ref.get()
        if not case_doc.exists:
            raise HTTPException(
                status_code=404,
                detail=f"Case with ID {caseId} not found.",
            )
        current_status = case_doc.to_dict().get("status", "created")
        if current_status == "running":
            raise HTTPException(
                status_code=400,
                detail=f"Case with ID {caseId} is already running.",
            )
    thread = threading.Thread(target=orchestrator_run_case, args=(caseId, request.mode)) #changed from run_dumb_loop (phase1) to run_case (phase 1.5)
    thread.daemon = True
    thread.start()
    return RunCaseResponse(status="running")


@app.get(
    "/api/cases/{caseId}/result",
    response_model=GetCaseResultResponse,
)
async def get_case_result(caseId: str) -> GetCaseResultResponse:
    """
    Get the result (status and settlement) for a case.
    phase 1: return status from firestore if available
    """
    # TODO: orchestrator.get_case_result(case_id=caseId)  phase2
    if db:
        case_ref = db.collection("cases").document(caseId)
        case_doc = case_ref.get()

        if not case_doc.exists:
            raise HTTPException(
                status_code=404,
                detail=f"Case with ID {caseId} not found.",
            )
        case_data = case_doc.to_dict()
        return GetCaseResultResponse(
            status=case_data.get("status", "running"),
            settlement=case_data.get("settlement", None),
        )
    # orchestrator_result = orchestrator.get_case_result(caseId)
    return GetCaseResultResponse(
        status="running",
        settlement=None,
    )
@app.post("/api/cases/{caseId}/next-turn", response_model=TurnResponse)
async def next_turn(caseId: str,request: TurnRequest) -> TurnResponse:
    """Phase 2: Handle one negotiation turn."""
    
    # Import the new function
    from backend.core.orchestrator import run_negotiation_turn
    
    # Validate case
    if db:
        case_ref = db.collection("cases").document(caseId)
        case_doc = case_ref.get()
        
        if not case_doc.exists:
            raise HTTPException(status_code=404, detail="Case not found")
        
        if case_doc.to_dict().get("status") == "done":
            raise HTTPException(status_code=400, detail="Case already completed")
    
    try:
        # Call the orchestrator
        result = run_negotiation_turn(
            case_id=caseId,
            user_message=request.user_message,
            current_round=request.current_round,
            user_role="plaintiff",  # User plays as plaintiff
            evidence_uris=request.evidence_uris,
            floor_price=request.floor_price,
        )
        
        # Map to TurnResponse
        return TurnResponse(
            agent_message=result["agent_message"],
            audio_url=result["audio_url"],
            auditor_passed=result["auditor_passed"],
            auditor_warning=result["auditor_warning"],
            chips=result["chips"],
            game_state=result["game_state"],
            counter_offer_rm=result["counter_offer_rm"],
        )
    
    except Exception as e:
        print(f"❌ Turn error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "firebase": db is not None}

# ---------------------------------------------
# Phase 2 endpoints 
# -----------------------------------------------

@app.post(
    "/api/cases/{caseId}/validate-evidence",
    response_model=ValidateEvidenceResponse,
    status_code=200,
)
async def validate_evidence_endpoint(
    caseId: str,
    request: ValidateEvidenceRequest,
) -> ValidateEvidenceResponse:
    """
    Phase 2: Validate evidence using M2's Gemini Vision.
    
    Flow:
    1. Check case exists
    2. Call M2's evidence.validate_evidence()
    3. Return validation result + Gemini File API URI
    """
    # Validate case exists
    if db:
        case_ref = db.collection("cases").document(caseId)
        if not case_ref.get().exists:
            raise HTTPException(
                status_code=404,
                detail=f"Case with ID {caseId} not found.",
            )
    
    # Call M2's evidence validator
    try:
        result = validate_evidence(
            file_url=request.image_url,
            user_claim=request.user_claim
        )
        
        # Check for errors from M2's module
        if result.get("error"):
            raise HTTPException(
                status_code=400,
                detail=result["error"]
            )
        
        # Map M2's output to our API model
        return ValidateEvidenceResponse(
            is_relevant=result["is_relevant"],
            summary_for_agent=request.user_claim,  # Simple pass-through for Phase 2
            confidence_score=result["confidence_score"],
            file_uri=result.get("file_uri")
        )
    
    except Exception as e:
        print(f"❌ Evidence validation error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Evidence validation failed: {str(e)}"
        )


@app.post(
    "/api/cases/{caseId}/upload-evidence",
    status_code=200,
)
async def upload_evidence_file(
    caseId: str,
    file: UploadFile = File(...),
    user_claim: str = "",
):
    """
    Upload evidence file directly (multipart/form-data).
    Saves to a temp file, uploads to Gemini File API, returns URI.
    """
    import tempfile
    from backend.logic.evidence import (
        _upload_to_gemini_file_api,
        _is_supported_mime_type,
        _normalize_mime_type,
        MAX_BYTES,
    )
    from google import genai

    # Validate case
    if db:
        case_ref = db.collection("cases").document(caseId)
        if not case_ref.get().exists:
            raise HTTPException(status_code=404, detail="Case not found")

    # Read file bytes
    file_bytes = await file.read()
    if len(file_bytes) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 5MB limit")

    mime_type = _normalize_mime_type(file.content_type or "application/octet-stream")
    if not _is_supported_mime_type(mime_type):
        raise HTTPException(
            status_code=400,
            detail="Only images (JPG/PNG) and PDF files are supported",
        )

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Missing GEMINI_API_KEY")

    client = genai.Client(api_key=api_key)
    try:
        file_uri = _upload_to_gemini_file_api(
            client, file.filename or "upload", file_bytes, mime_type
        )
        return {
            "is_relevant": True,
            "file_uri": file_uri,
            "mime_type": mime_type,
            "confidence_score": 1.0,
            "summary_for_agent": user_claim or f"Evidence: {file.filename}",
        }
    except Exception as e:
        print(f"❌ Evidence upload error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Evidence upload failed: {str(e)}",
        )


#this repeat with upside, but incase retain it for checking
# @app.post(
#     "/api/cases/{caseId}/next-turn",
#     response_model=TurnResponse,
#     status_code=200,
# )
# async def next_turn(
#     caseId: str,
#     request: TurnRequest,
# ) -> TurnResponse:
#     """
#     Phase 2: Handle one negotiation turn.
    
#     Flow:
#     1. Validate case exists and is active
#     2. Generate AI response (with RAG if mode=full)
#     3. Run auditor validation
#     4. Return response with chips and audio URL
    
#     NOTE: This is a simplified Phase 2 implementation.
#     Full implementation will use orchestrator.run_negotiation_turn().
#     """
#     # Validate case
#     if db:
#         case_ref = db.collection("cases").document(caseId)
#         case_doc = case_ref.get()
        
#         if not case_doc.exists:
#             raise HTTPException(
#                 status_code=404,
#                 detail=f"Case with ID {caseId} not found.",
#             )
        
#         case_data = case_doc.to_dict()
#         case_status = case_data.get("status", "created")
        
#         if case_status == "done":
#             raise HTTPException(
#                 status_code=400,
#                 detail="Case has already completed."
#             )
    
#     # TODO: Phase 2 - Implement full turn logic
#     # For now, return a placeholder response
    
#     try:
#         # Simplified response for Phase 2 initial integration
#         # Full implementation will:
#         # 1. Call orchestrator.run_negotiation_turn()
#         # 2. Generate audio with voice.generate_audio_bytes()
#         # 3. Upload audio to Firebase Storage
#         # 4. Generate chips with M1's chips.py
        
#         return TurnResponse(
#             agent_message="[Phase 2 TODO] AI response will be generated here",
#             audio_url=None,  # TODO: Generate audio
#             auditor_passed=True,
#             auditor_warning=None,
#             chips=None,  # TODO: Generate chips
#             game_state="active",
#             counter_offer_rm=None,
#         )
    
#     except Exception as e:
#         print(f"❌ Turn error: {str(e)}")
#         raise HTTPException(
#             status_code=500,
#             detail=f"Turn processing failed: {str(e)}"
#         )


@app.post(
    "/api/cases/{caseId}/auditor/validate",
    status_code=200,
)
async def auditor_validate_turn(
    caseId: str,
    agent_text: str,
) -> Dict[str, Any]:
    """
    Phase 2: Validate AI response with M2's auditor.
    
    This is an internal endpoint for testing.
    In production, auditor is called internally by orchestrator.
    """
    try:
        # Call M2's auditor
        result = validate_turn(agent_text)
        
        return {
            "is_valid": result["is_valid"],
            "flagged_law": result.get("flagged_law"),
            "auditor_warning": result.get("auditor_warning"),
            "citations_found": result.get("citations_found", []),
        }
    
    except Exception as e:
        print(f"❌ Auditor error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Auditor validation failed: {str(e)}"
        )


@app.post(
    "/api/cases/{caseId}/export-pdf",
    response_model=CourtFilingResponse,
    status_code=200,
)
async def export_court_filing(
    caseId: str,
) -> CourtFilingResponse:
    """
    Phase 2: Generate court filing JSON (Form 198).
    
    Flow:
    1. Retrieve case data and messages
    2. Generate structured summary
    3. Return JSON for frontend to render as printable HTML
    
    
    """
    # Validate case
    if db:
        case_ref = db.collection("cases").document(caseId)
        case_doc = case_ref.get()
        
        if not case_doc.exists:
            raise HTTPException(
                status_code=404,
                detail=f"Case with ID {caseId} not found.",
            )
        
        case_data = case_doc.to_dict()
        
        # Retrieve messages
        messages = []
        messages_ref = case_ref.collection("messages").order_by("createdAt").stream()
        for msg_doc in messages_ref:
            msg_data = msg_doc.to_dict()
            messages.append({
                "role": msg_data.get("role"),
                "content": msg_data.get("content"),
                "round": msg_data.get("round"),
            })
        
        conversation_history = "\n".join([
            f"[Round {m['round']}] {m['role'].upper()}: {m['content']}"
            for m in messages
        ])
        
        # Get legal context
        from backend.rag.retrieval import retrieve_law
        legal_docs = retrieve_law(case_data.get('title', ''))
        legal_context = "\n".join([
            f"- {d['law']} s.{d['section']}: {d['excerpt'][:200]}"
            for d in legal_docs
        ])
        
        # Build prompt
        filing_prompt = COURT_FILING_PROMPT.replace(
            "{case_facts}", f"Case: {case_data.get('title')}"
        ).replace(
            "{conversation_history}", conversation_history
        ).replace(
            "{legal_context}", legal_context
        ).replace(
            "{round_number}", str(len(messages))
        )
        
        # Generate filing
        raw_response = call_gemini_with_retry(filing_prompt)
        
        # Parse JSON
        try:
            cleaned = raw_response.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned.split("```json")[1].split("```")[0].strip()
            
            filing_json = json.loads(cleaned)
            return CourtFilingResponse(
                plaintiff_details=filing_json.get("plaintiff_details", "User (Plaintiff)"),
                defendant_details=filing_json.get("defendant_details", "Opponent (Defendant)"),
                statement_of_claim=filing_json.get("statement_of_claim", f"Dispute regarding: {case_data.get('title')}"),
                amount_claimed=f"RM {filing_json.get('claimed_amount_rm', 'TBD')}",
                facts_list=[
                    f"Plaintiff's final offer: RM {filing_json.get('final_plaintiff_offer_rm', 0)}",
                    f"Defendant's final offer: RM {filing_json.get('final_defendant_offer_rm', 0)}",
                    filing_json.get("disclaimer", ""),
                ],
                negotiation_summary=f"Status: {filing_json.get('negotiation_status', 'deadlock')}"
            )
        except Exception as e:
            #fallback
            return CourtFilingResponse(
                plaintiff_details="User",
                defendant_details="Opponent",
                statement_of_claim=f"Dispute regarding: {case_data.get('title')}",
                amount_claimed="RM [TBD]",
                facts_list=["Negotiation failed", "Please consult lawyer"],
                negotiation_summary="Deadlock reached"
            )
    raise HTTPException(
        status_code=500,
        detail="Firebase not available"
    )


# =============================================================================
# Phase 2 Helper Endpoints (Optional - for testing)
# =============================================================================

@app.get("/api/cases/{caseId}/messages")
async def get_messages(caseId: str):
    """
    Get all messages for a case (for debugging).
    Not part of the frozen contract.
    """
    if db:
        messages_ref = db.collection("cases").document(caseId).collection("messages")
        messages = messages_ref.order_by("createdAt").stream()
        
        return [
            {"id": msg.id, **msg.to_dict()}
            for msg in messages
        ]
    
    return {"message": "Firebase not initialized"}


@app.get("/api/debug/test-auditor")
async def test_auditor():
    """Test M2's auditor module."""
    test_text = "Under section 15 of Sale of Goods Act 1957, this is a sale by description."
    
    result = validate_turn(test_text)
    
    return {
        "test_text": test_text,
        "result": result
    }


@app.get("/api/debug/test-evidence")
async def test_evidence():
    """Test M2's evidence validator."""
    # This would need a real file URL
    return {
        "message": "Evidence validator requires a file URL. Use POST /api/cases/{id}/validate-evidence instead."
    }
# =============================================================================
# Phase 2: Round 4.5 - Accept/Reject Endpoints
# =============================================================================

@app.post("/api/cases/{caseId}/accept-offer")
async def accept_final_offer(caseId: str):
    """
    User accepts AI's final offer.
    Generate settlement and mark case as done.
    """
    if db:
        case_ref = db.collection("cases").document(caseId)
        case_doc = case_ref.get()
        
        if not case_doc.exists:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case_data = case_doc.to_dict()
        
        if case_data.get("status") == "done":
            # Already settled, return existing settlement
            return {
                "status": "settled",
                "settlement": case_data.get("settlement")
            }
        
        # Generate final settlement
        from backend.core.orchestrator import generate_mediator_settlement
        
        try:
            settlement = generate_mediator_settlement(caseId)
            
            return {
                "status": "settled",
                "settlement": settlement,
                "message": "Offer accepted. Settlement generated."
            }
        except Exception as e:
            print(f"❌ Settlement generation error: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    raise HTTPException(status_code=500, detail="Firebase not available")


@app.post("/api/cases/{caseId}/reject-offer")
async def reject_final_offer(caseId: str):
    """
    User rejects AI's final offer.
    Update to deadlock status and prepare for court filing export.
    """
    if db:
        case_ref = db.collection("cases").document(caseId)
        case_doc = case_ref.get()
        
        if not case_doc.exists:
            raise HTTPException(status_code=404, detail="Case not found")
        
        # Update case status to deadlock
        case_ref.update({
            "status": "deadlock",
            "game_state": "deadlock"
        })
        
        # Add system message
        case_ref.collection("messages").add({
            "role": "system",
            "content": "User rejected final offer. Negotiation ended in deadlock.",
            "round": 4.5,
            "createdAt": firestore.SERVER_TIMESTAMP
        })
        
        return {
            "status": "deadlock",
            "message": "Offer rejected. You can now export the court filing form.",
            "can_export": True
        }
    
    raise HTTPException(status_code=500, detail="Firebase not available")