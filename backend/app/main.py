"""
FastAPI backend for BYP case management.
Integrates with Firebase, orchestrator, and frontend per contract.md.
Phase 1: basic api, firestore integration, dump loop
phase 2: turn-based negotiation with RAG, auditor, and TTS
"""
import sys
import io
import os

# Fix Windows Unicode encoding for emoji in print() statements
if sys.stdout and hasattr(sys.stdout, 'encoding') and sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
import json
import queue
import time
from dotenv import load_dotenv
from fastapi import FastAPI, Request, status, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
import firebase_admin
from firebase_admin import credentials, firestore
import uuid
from typing import Optional, Dict, Any
from backend.core.orchestrator import run_dumb_loop, get_case_result, run_case as orchestrator_run_case
import threading
from backend.prompts.court_filing import COURT_FILING_PROMPT
from backend.prompts.settlement_agreement import SETTLEMENT_AGREEMENT_PROMPT, DEADLOCK_COURT_FILING_HTML_PROMPT
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
    PvpTurnRequest,
    JoinCaseRequest,
    UpdateParticipantRequest,
    DefendantRespondRequest,
)

load_dotenv()

db = None
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

    # Option 1: JSON content stored as env variable (for Render/production)
    sa_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    if sa_json:
        try:
            sa_dict = json.loads(sa_json)
            cred = credentials.Certificate(sa_dict)
            storage_bucket = os.getenv("FIREBASE_STORAGE_BUCKET", "")
            options = {"storageBucket": storage_bucket} if storage_bucket else {}
            firebase_admin.initialize_app(cred, options)
            print("Firebase initialized from FIREBASE_SERVICE_ACCOUNT_JSON env var")
            return
        except Exception as e:
            print(f"Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: {e}")

    # Option 2: File path (local development, backward-compatible)
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env_path = os.getenv("FIREBASE_SERVICE_ACCOUNT")
    if not env_path or not env_path.strip():
        service_account_path = os.path.join(base_dir, "backend", "serviceAccountKey.json")
    else:
        service_account_path = env_path.strip()

    if service_account_path and os.path.isfile(service_account_path):
        cred = credentials.Certificate(service_account_path)
        storage_bucket = os.getenv("FIREBASE_STORAGE_BUCKET", "")
        options = {"storageBucket": storage_bucket} if storage_bucket else {}
        firebase_admin.initialize_app(cred, options)
        print(f"Firebase initialized with service account: {service_account_path}")
    else:
        print(f"Firebase credentials not found at {service_account_path}. Running in mock mode.")


def _ensure_db_initialized() -> None:
    """Best-effort lazy initialization for Firebase/Firestore."""
    global db
    if db is not None:
        return
    try:
        _init_firebase()
        db = firestore.client() if firebase_admin._apps else None
    except Exception as exc:
        print(f"Failed to initialize Firestore lazily: {exc}")
        db = None


def _write_case_with_retry(case_id: str, case_doc: Dict[str, Any], retries: int = 3) -> None:
    """Write case document with retries to handle transient Firestore cold-start failures."""
    global db
    if not db:
        return

    last_error = None
    for attempt in range(1, retries + 1):
        try:
            db.collection("cases").document(case_id).set(case_doc)
            return
        except Exception as exc:
            last_error = exc
            print(f"Firestore write failed (attempt {attempt}/{retries}): {exc}")
            db = None
            _ensure_db_initialized()
            if attempt < retries:
                time.sleep(0.4 * attempt)

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=f"Failed to persist case after retries: {last_error}",
    )

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

_cors_origins = ["http://localhost:3000"]
_frontend_url = os.getenv("FRONTEND_URL")
if _frontend_url:
    _cors_origins.append(_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",  # covers all preview + production *.vercel.app
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event() -> None:
    """Initialize Firebase on startup."""
    _ensure_db_initialized()

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
    _ensure_db_initialized()
    case_id = str(uuid.uuid4())
    if db:
        case_doc = {
            "status": "created",
            "title": request.title,
            "caseType": request.caseType,
            "description": request.description or "",
            "amount": request.amount or 0,
            "incidentDate": request.incidentDate or "",
            "floorPrice": request.floorPrice or 0,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "createdBy": request.createdBy or "mock-user-id",
            "mode": request.mode,  # "ai" or "pvp"
        }
        # For PvP mode, add participant tracking and turn management
        if request.mode == "pvp":
            case_doc.update({
                "plaintiffUserId": request.createdBy or "mock-user-id",
                "defendantUserId": None,
                "plaintiffDisplayName": None,
                "defendantDisplayName": None,
                "defendantIsAnonymous": None,
                "currentTurn": "plaintiff",
                "turnStatus": "waiting",
                "pvpRound": 1,
                "plaintiffSubmitted": False,
                "defendantSubmitted": False,
            })
        _write_case_with_retry(case_id, case_doc)
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
@app.post("/api/cases/{caseId}/next-turn")
async def next_turn(caseId: str, request: TurnRequest):
    """Phase 2: Handle one negotiation turn with streaming progress."""
    
    # Import the new function
    from backend.core.orchestrator import run_negotiation_turn
    
    # Validate case
    if db:
        case_ref = db.collection("cases").document(caseId)
        case_doc = case_ref.get()
        
        if not case_doc.exists:
            raise HTTPException(status_code=404, detail="Case not found")
        
        case_status = case_doc.to_dict().get("status", "")
        # Only block truly final states, not active negotiation cases
        if case_status == "done" and case_doc.to_dict().get("game_state") in ("settled", "deadlock"):
            raise HTTPException(status_code=400, detail="Case already completed")
    
    # Use streaming NDJSON to keep connection alive and show progress
    progress_queue = queue.Queue()
    result_holder = [None]
    error_holder = [None]
    
    def progress_callback(step, message):
        progress_queue.put(json.dumps({"type": "progress", "step": step, "message": message}) + "\n")
    
    def run_in_thread():
        try:
            result = run_negotiation_turn(
                case_id=caseId,
                user_message=request.user_message,
                user_role="plaintiff",
                evidence_uris=request.evidence_uris,
                floor_price=request.floor_price,
                progress_callback=progress_callback,
            )
            result_holder[0] = result
        except Exception as e:
            print(f"❌ Turn thread error: {str(e)}")
            import traceback
            traceback.print_exc()
            error_holder[0] = str(e)
        finally:
            progress_queue.put(None)  # Sentinel to end stream
    
    import threading
    thread = threading.Thread(target=run_in_thread, daemon=True)
    thread.start()
    request_started_at = time.monotonic()
    hard_timeout_sec = 260
    heartbeat_interval_sec = 8
    
    def event_generator():
        last_heartbeat_at = 0.0
        while True:
            elapsed = time.monotonic() - request_started_at
            if elapsed > hard_timeout_sec and thread.is_alive():
                error_holder[0] = f"Turn timed out after {hard_timeout_sec}s. Please retry."
                progress_queue.put(None)

            try:
                item = progress_queue.get(timeout=2)
                if item is None:
                    break
                yield item
            except queue.Empty:
                if thread.is_alive():
                    now = time.monotonic()
                    if now - last_heartbeat_at >= heartbeat_interval_sec:
                        elapsed_int = int(now - request_started_at)
                        mins = elapsed_int // 60
                        secs = elapsed_int % 60
                        yield json.dumps({
                            "type": "progress",
                            "step": "heartbeat",
                            "message": f"Still processing... ({mins}:{secs:02d})"
                        }) + "\n"
                        last_heartbeat_at = now
                    continue
                break
        
        # Send final result or error
        if error_holder[0]:
            yield json.dumps({"type": "error", "message": error_holder[0]}) + "\n"
        elif result_holder[0]:
            r = result_holder[0]
            # Sanitize chips for JSON serialization
            chips_data = r.get("chips")
            if chips_data and isinstance(chips_data, dict):
                chips_data = {
                    "question": chips_data.get("question", ""),
                    "options": chips_data.get("options", [])
                }
            
            yield json.dumps({"type": "result", "data": {
                "agent_message": r.get("agent_message", ""),
                "plaintiff_message": r.get("plaintiff_message"),
                "current_round": r.get("current_round", 1),
                "audio_url": r.get("audio_url"),
                "auditor_passed": r.get("auditor_passed", True),
                "auditor_warning": r.get("auditor_warning"),
                "chips": chips_data,
                "game_state": r.get("game_state", "active"),
                "counter_offer_rm": r.get("counter_offer_rm"),
            }}) + "\n"
        else:
            yield json.dumps({"type": "error", "message": "No result returned"}) + "\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    _ensure_db_initialized()
    return {"status": "ok", "firebase": db is not None}


# =============================================================================
# PvP Invite System Endpoints
# =============================================================================

@app.post("/api/cases/{caseId}/join")
async def join_case(caseId: str, request: JoinCaseRequest):
    """
    Defendant joins a PvP case via invite link.
    Validates case is PvP mode and defendant slot is empty.
    """
    if not db:
        raise HTTPException(status_code=500, detail="Database unavailable")

    case_ref = db.collection("cases").document(caseId)
    case_doc = case_ref.get()

    if not case_doc.exists:
        raise HTTPException(status_code=404, detail="Case not found")

    case_data = case_doc.to_dict()

    if case_data.get("mode") != "pvp":
        raise HTTPException(status_code=400, detail="This case is not a PvP negotiation")

    # Check if defendant already joined
    existing_defendant = case_data.get("defendantUserId")
    if existing_defendant and existing_defendant != request.userId:
        raise HTTPException(status_code=400, detail="Another defendant has already joined this case")

    # Check plaintiff isn't joining as defendant
    if case_data.get("plaintiffUserId") == request.userId:
        raise HTTPException(status_code=400, detail="You cannot join your own case as defendant")

    # Assign defendant
    case_ref.update({
        "defendantUserId": request.userId,
        "defendantIsAnonymous": request.isAnonymous,
        "defendantDisplayName": request.displayName,
    })

    # Add system message
    case_ref.collection("messages").add({
        "role": "system",
        "content": f"Defendant has joined the negotiation.{' (' + request.displayName + ')' if request.displayName else ''}",
        "round": 0,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })

    return {
        "status": "joined",
        "caseId": caseId,
        "role": "defendant",
        "title": case_data.get("title"),
        "caseType": case_data.get("caseType"),
        "amount": case_data.get("amount"),
    }


@app.post("/api/cases/{caseId}/defendant-respond")
async def defendant_respond(caseId: str, request: DefendantRespondRequest):
    """
    Defendant onboarding: reviews case, provides description, uploads evidence, sets offers.
    Joins the case and saves defendant-specific fields.
    """
    if not db:
        raise HTTPException(status_code=500, detail="Database unavailable")

    case_ref = db.collection("cases").document(caseId)
    case_doc = case_ref.get()

    if not case_doc.exists:
        raise HTTPException(status_code=404, detail="Case not found")

    case_data = case_doc.to_dict()

    if case_data.get("mode") != "pvp":
        raise HTTPException(status_code=400, detail="This case is not a PvP negotiation")

    # Check if defendant already responded
    if case_data.get("defendantResponded"):
        # If same user, allow re-entry
        if case_data.get("defendantUserId") == request.userId:
            return {
                "status": "already_responded",
                "caseId": caseId,
                "role": "defendant",
            }
        raise HTTPException(status_code=400, detail="A defendant has already responded to this case")

    # Check plaintiff isn't joining as defendant
    if case_data.get("plaintiffUserId") == request.userId:
        raise HTTPException(status_code=400, detail="You cannot join your own case as defendant")

    # Check if another defendant already joined (but hasn't responded)
    existing_defendant = case_data.get("defendantUserId")
    if existing_defendant and existing_defendant != request.userId:
        raise HTTPException(status_code=400, detail="Another defendant has already joined this case")

    # Save defendant fields
    update_data = {
        "defendantUserId": request.userId,
        "defendantIsAnonymous": request.isAnonymous,
        "defendantDisplayName": request.displayName,
        "defendantDescription": request.defendantDescription,
        "defendantResponded": True,
    }
    if request.defendantCeilingPrice is not None:
        update_data["defendantCeilingPrice"] = request.defendantCeilingPrice
    if request.defendantStartingOffer is not None:
        update_data["defendantStartingOffer"] = request.defendantStartingOffer

    case_ref.update(update_data)

    # Add system message
    case_ref.collection("messages").add({
        "role": "system",
        "content": f"Defendant has joined the negotiation and provided their response.{' (' + request.displayName + ')' if request.displayName else ''}",
        "round": 0,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })

    # Add defendant's opening response so it appears in negotiation history immediately
    opening_text = (request.defendantDescription or "").strip()
    if opening_text:
        case_ref.collection("messages").add({
            "role": "defendant",
            "content": opening_text,
            "round": 0,
            "counter_offer_rm": request.defendantStartingOffer,
            "audio_url": None,
            "auditor_passed": None,
            "auditor_warning": None,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })

    return {
        "status": "joined",
        "caseId": caseId,
        "role": "defendant",
        "title": case_data.get("title"),
        "caseType": case_data.get("caseType"),
        "amount": case_data.get("amount"),
    }


@app.patch("/api/cases/{caseId}/update-participant")
async def update_participant(caseId: str, request: UpdateParticipantRequest):
    """
    Update participant UID after anonymous-to-Google auth upgrade.
    """
    if not db:
        raise HTTPException(status_code=500, detail="Database unavailable")

    case_ref = db.collection("cases").document(caseId)
    case_doc = case_ref.get()

    if not case_doc.exists:
        raise HTTPException(status_code=404, detail="Case not found")

    case_data = case_doc.to_dict()

    if request.role == "plaintiff":
        if case_data.get("plaintiffUserId") != request.oldUserId:
            raise HTTPException(status_code=403, detail="Old UID does not match plaintiff")
        case_ref.update({
            "plaintiffUserId": request.newUserId,
            "plaintiffDisplayName": request.displayName,
            "createdBy": request.newUserId,
        })
    elif request.role == "defendant":
        if case_data.get("defendantUserId") != request.oldUserId:
            raise HTTPException(status_code=403, detail="Old UID does not match defendant")
        case_ref.update({
            "defendantUserId": request.newUserId,
            "defendantDisplayName": request.displayName,
            "defendantIsAnonymous": False,
        })

    return {"status": "updated", "role": request.role}


@app.post("/api/cases/{caseId}/pvp-turn")
async def pvp_turn(caseId: str, request: PvpTurnRequest):
    """
    PvP: Handle one side's turn.
    Only the user whose turn it is can submit.
    Runs only the AI agent for that user's role, then flips the turn.
    """
    from backend.core.orchestrator import run_pvp_negotiation_turn

    if not db:
        raise HTTPException(status_code=500, detail="Database unavailable")

    case_ref = db.collection("cases").document(caseId)
    case_doc = case_ref.get()

    if not case_doc.exists:
        raise HTTPException(status_code=404, detail="Case not found")

    case_data = case_doc.to_dict()

    if case_data.get("mode") != "pvp":
        raise HTTPException(status_code=400, detail="This case is not PvP mode")

    # Validate it's this user's turn
    current_turn = case_data.get("currentTurn", "plaintiff")
    if current_turn != request.user_role:
        raise HTTPException(
            status_code=400,
            detail=f"It's not your turn. Current turn: {current_turn}"
        )

    # Validate the user is actually the correct participant
    if request.user_role == "plaintiff":
        if request.userId and case_data.get("plaintiffUserId") and request.userId != case_data.get("plaintiffUserId"):
            raise HTTPException(status_code=403, detail="You are not the plaintiff for this case")
    elif request.user_role == "defendant":
        if request.userId and case_data.get("defendantUserId") and request.userId != case_data.get("defendantUserId"):
            raise HTTPException(status_code=403, detail="You are not the defendant for this case")

    # Check defendant has joined
    if not case_data.get("defendantUserId"):
        raise HTTPException(status_code=400, detail="Waiting for defendant to join")

    case_status = case_data.get("status", "")
    if case_status == "done" and case_data.get("game_state") in ("settled", "deadlock"):
        raise HTTPException(status_code=400, detail="Case already completed")
    if case_status == "pending_decision" or case_data.get("game_state") == "pending_decision":
        raise HTTPException(status_code=400, detail="Final offer decision pending. Plaintiff must accept or reject.")

    # Use streaming NDJSON (same pattern as AI mode)
    progress_queue = queue.Queue()
    result_holder = [None]
    error_holder = [None]

    def progress_callback(step, message):
        progress_queue.put(json.dumps({"type": "progress", "step": step, "message": message}) + "\n")

    def run_in_thread():
        try:
            result = run_pvp_negotiation_turn(
                case_id=caseId,
                user_message=request.user_message,
                user_role=request.user_role,
                evidence_uris=request.evidence_uris,
                floor_price=request.floor_price,
                progress_callback=progress_callback,
            )
            result_holder[0] = result
        except Exception as e:
            print(f"❌ PvP turn thread error: {str(e)}")
            import traceback
            traceback.print_exc()
            error_holder[0] = str(e)
        finally:
            progress_queue.put(None)

    thread = threading.Thread(target=run_in_thread, daemon=True)
    thread.start()
    request_started_at = time.monotonic()
    hard_timeout_sec = 260
    heartbeat_interval_sec = 8

    def event_generator():
        last_heartbeat_at = 0.0
        while True:
            elapsed = time.monotonic() - request_started_at
            if elapsed > hard_timeout_sec and thread.is_alive():
                error_holder[0] = f"Turn timed out after {hard_timeout_sec}s. Please retry."
                progress_queue.put(None)

            try:
                item = progress_queue.get(timeout=2)
                if item is None:
                    break
                yield item
            except queue.Empty:
                if thread.is_alive():
                    now = time.monotonic()
                    if now - last_heartbeat_at >= heartbeat_interval_sec:
                        elapsed_int = int(now - request_started_at)
                        mins = elapsed_int // 60
                        secs = elapsed_int % 60
                        yield json.dumps({
                            "type": "progress",
                            "step": "heartbeat",
                            "message": f"Still processing... ({mins}:{secs:02d})"
                        }) + "\n"
                        last_heartbeat_at = now
                    continue
                break

        if error_holder[0]:
            yield json.dumps({"type": "error", "message": error_holder[0]}) + "\n"
        elif result_holder[0]:
            r = result_holder[0]
            chips_data = r.get("chips")
            if chips_data and isinstance(chips_data, dict):
                chips_data = {
                    "question": chips_data.get("question", ""),
                    "options": chips_data.get("options", [])
                }

            yield json.dumps({"type": "result", "data": {
                "agent_message": r.get("agent_message", ""),
                "plaintiff_message": r.get("plaintiff_message"),
                "current_round": r.get("current_round", 1),
                "audio_url": r.get("audio_url"),
                "auditor_passed": r.get("auditor_passed", True),
                "auditor_warning": r.get("auditor_warning"),
                "chips": chips_data,
                "game_state": r.get("game_state", "active"),
                "counter_offer_rm": r.get("counter_offer_rm"),
                "current_turn": r.get("current_turn", "plaintiff"),
            }}) + "\n"
        else:
            yield json.dumps({"type": "error", "message": "No result returned"}) + "\n"

    return StreamingResponse(
        event_generator(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

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
    request: Request,
    caseId: str,
    file: UploadFile = File(...),
    user_claim: str = Form(""),
    uploaded_by: str = Form("plaintiff"),
):
    """
    Upload evidence file directly (multipart/form-data).
    Saves to a temp file, uploads to Gemini File API, returns URI.
    """
    # Query param takes priority — proxy-safe since it's in the URL, not the body
    uploaded_by = request.query_params.get("uploaded_by", uploaded_by)
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
            detail="Only images (JPG/PNG), PDF, and text (TXT/MD) files are supported",
        )

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Missing GEMINI_API_KEY")

    client = genai.Client(api_key=api_key)
    try:
        file_uri = _upload_to_gemini_file_api(
            client, file.filename or "upload", file_bytes, mime_type
        )

        evidence_id = None
        if db:
            case_ref = db.collection("cases").document(caseId)
            _ts, doc_ref = case_ref.collection("evidence").add({
                "fileType": mime_type,
                "storageUrl": file_uri,
                "fileName": file.filename or "upload",
                "extractedText": user_claim or f"Evidence file uploaded: {file.filename or 'upload'}",
                "file_uri": file_uri,
                "uploadedBy": uploaded_by,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })
            evidence_id = doc_ref.id

        return {
            "is_relevant": True,
            "file_uri": file_uri,
            "evidence_id": evidence_id,
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


# ---- Auditor retry & dismiss endpoints ----

@app.post("/api/cases/{caseId}/messages/{messageId}/audit-retry")
async def audit_retry(caseId: str, messageId: str):
    """Regenerate a failed agent message with safer citations, then re-audit and update Firestore."""
    if not db:
        raise HTTPException(status_code=500, detail="Database unavailable")

    case_ref = db.collection("cases").document(caseId)
    msg_ref = db.collection("cases").document(caseId).collection("messages").document(messageId)
    msg_doc = msg_ref.get()
    if not msg_doc.exists:
        raise HTTPException(status_code=404, detail="Message not found")

    msg_data = msg_doc.to_dict()
    role = msg_data.get("role")
    if role not in ["defendant", "plaintiff"]:
        raise HTTPException(status_code=400, detail="Only agent messages can be audited")

    original_content = msg_data.get("content", "")
    current_round = int(msg_data.get("round") or 1)

    # Build case + evidence context
    case_data = case_ref.get().to_dict() or {}
    case_title = case_data.get("title", "Dispute")
    case_type = case_data.get("caseType", "tenancy_deposit")
    claim_amount = case_data.get("amount", 0) or 0
    floor_price = int(case_data.get("floorPrice", 0) or 0)
    defendant_max_offer = int(claim_amount * 0.5) if claim_amount > 0 else floor_price

    evidence_docs = case_ref.collection("evidence").stream()
    evidence_texts = []
    for edoc in evidence_docs:
        extracted = (edoc.to_dict() or {}).get("extractedText")
        if extracted:
            evidence_texts.append(str(extracted)[:600])
    evidence_summary = "\n".join(evidence_texts[:8]) if evidence_texts else "No evidence provided."

    # Pull minimal legal context from indexed DB to guide rewrite
    from backend.rag.retrieval import retrieve_law
    retrieval_query = f"{case_type} {case_title} {original_content[:300]}"
    legal_docs = retrieve_law(retrieval_query, use_agentic=False)
    legal_context = "\n".join([
        f"- {d.get('law', 'Unknown')} Section {d.get('section', '?')}: {str(d.get('excerpt', ''))[:220]}"
        for d in legal_docs[:5]
    ]) or "No specific laws retrieved."

    case_data_dict = {
        "case_title": case_title,
        "case_type": case_type,
        "case_facts": f"Case Type: {case_type}\nTitle: {case_title}",
        "evidence_summary": evidence_summary,
        "floor_price": floor_price,
        "dispute_amount": claim_amount,
        "defendant_max_offer": defendant_max_offer,
        "legal_context": legal_context,
    }

    # Build role-specific rewrite prompt
    if role == "plaintiff":
        base_prompt = build_plaintiff_prompt(case_data=case_data_dict, current_round=current_round)
    else:
        base_prompt = build_defendant_prompt(case_data=case_data_dict, current_round=current_round)

    rewrite_prompt = f"""{base_prompt}

You are revising a previously failed response after an auditor intercept.
Previous response:
\"\"\"
{original_content}
\"\"\"

Rules for this retry:
1) Keep the same negotiation stance and intent.
2) Remove or replace any law citation not supported by the provided Legal Context.
3) If unsure about a section, avoid specific section numbers and rely on evidence-based reasoning.
4) Output ONLY valid JSON in the required schema.
"""

    # Regenerate and parse
    regenerated_text = original_content
    regenerated_offer = msg_data.get("counter_offer_rm")
    try:
        raw = call_gemini_with_retry(rewrite_prompt, max_retries=2, per_call_timeout=25)
        cleaned = raw.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned.split("```json")[1].split("```")[0].strip()
        elif cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1].split("```")[0].strip()

        try:
            parsed = json.loads(cleaned)
            regenerated_text = parsed.get("message", cleaned)
            if parsed.get("counter_offer_rm") is not None:
                regenerated_offer = parsed.get("counter_offer_rm")
        except json.JSONDecodeError:
            regenerated_text = raw
    except Exception as e:
        # Keep previous text if regeneration fails; return fresh audit result for visibility
        print(f"⚠️ Audit retry regeneration failed for {messageId}: {e}")

    result = validate_turn(regenerated_text)

    msg_ref.update({
        "content": regenerated_text,
        "counter_offer_rm": regenerated_offer,
        "auditor_passed": result["is_valid"],
        "auditor_warning": result.get("auditor_warning") if not result["is_valid"] else None,
        "auditor_retry_count": int(msg_data.get("auditor_retry_count", 0) or 0) + 1,
        "auditor_retried_at": firestore.SERVER_TIMESTAMP,
    })

    return {
        "is_valid": result["is_valid"],
        "auditor_warning": result.get("auditor_warning"),
        "updated": True,
    }


@app.patch("/api/cases/{caseId}/messages/{messageId}/audit-dismiss")
async def audit_dismiss(caseId: str, messageId: str):
    """Mark a failed audit as dismissed (proceed anyway)."""
    if not db:
        raise HTTPException(status_code=500, detail="Database unavailable")

    msg_ref = db.collection("cases").document(caseId).collection("messages").document(messageId)
    msg_doc = msg_ref.get()
    if not msg_doc.exists:
        raise HTTPException(status_code=404, detail="Message not found")

    msg_ref.update({
        "auditor_passed": True,
        "auditor_warning": None,
    })

    return {"status": "dismissed"}


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
            f"[Round {m.get('round')}] {(m.get('role') or 'unknown').upper()}: {m.get('content') or ''}"
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
        
        # Generate filing (sync call — run in thread to avoid blocking event loop)
        import asyncio
        loop = asyncio.get_event_loop()
        raw_response = await loop.run_in_executor(None, call_gemini_with_retry, filing_prompt)
        
        # Parse JSON
        try:
            cleaned = raw_response.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned.split("```json")[1].split("```")[0].strip()
            elif cleaned.startswith("```"):
                cleaned = cleaned.split("```")[1].split("```")[0].strip()

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
            print(f"❌ Court filing JSON parse error: {e}")
            print(f"   Raw response: {raw_response[:300] if raw_response else 'None'}")
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
        
        # Generate final settlement (sync function — run in thread to avoid blocking event loop)
        from backend.core.orchestrator import generate_mediator_settlement
        import asyncio

        try:
            loop = asyncio.get_event_loop()
            settlement = await loop.run_in_executor(None, generate_mediator_settlement, caseId)

            return {
                "status": "settled",
                "settlement": settlement,
                "message": "Offer accepted. Settlement generated."
            }
        except Exception as e:
            print(f"❌ Settlement generation error: {e}")
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(e))
    
    raise HTTPException(status_code=500, detail="Firebase not available")


@app.post("/api/cases/{caseId}/continue-negotiation")
async def continue_negotiation(caseId: str):
    """User declines the favorable offer — game resumes as active."""
    if not db:
        raise HTTPException(status_code=500, detail="Firebase not available")

    case_ref = db.collection("cases").document(caseId)
    case_doc = case_ref.get()
    if not case_doc.exists:
        raise HTTPException(status_code=404, detail="Case not found")

    case_data = case_doc.to_dict()
    pending_role = case_data.get("pendingDecisionRole")

    update = {
        "game_state": "active",
        "pendingDecisionRole": None,
        "status": "active",
    }
    if case_data.get("mode") == "pvp" and pending_role:
        update["currentTurn"] = pending_role
        update["turnStatus"] = "waiting"

    case_ref.update(update)
    return {"status": "active", "message": "Negotiation continues."}


@app.post("/api/cases/{caseId}/generate-settlement-pdf")
async def generate_settlement_pdf(caseId: str):
    """
    Generate settlement agreement HTML using Gemini.
    Returns { html } for frontend PdfPreviewModal.
    """
    if not db:
        raise HTTPException(status_code=500, detail="Database unavailable")

    case_ref = db.collection("cases").document(caseId)
    case_doc = case_ref.get()

    if not case_doc.exists:
        raise HTTPException(status_code=404, detail="Case not found")

    case_data = case_doc.to_dict()

    # Get messages
    messages = []
    messages_ref = case_ref.collection("messages").order_by("createdAt").stream()
    for msg_doc in messages_ref:
        msg_data = msg_doc.to_dict()
        messages.append({
            "role": msg_data.get("role"),
            "content": msg_data.get("content"),
            "round": msg_data.get("round"),
            "counter_offer_rm": msg_data.get("counter_offer_rm"),
        })

    messages_history = "\n".join([
        f"[Round {m.get('round')}] {(m.get('role') or 'unknown').upper()}: {(m.get('content') or '')[:300]}"
        for m in messages
    ])

    negotiation_summary = "\n".join([
        f"- {(m.get('role') or 'unknown').capitalize()} (Round {m.get('round')}): Offered RM {m.get('counter_offer_rm', 'N/A')}"
        for m in messages if m.get("counter_offer_rm") is not None
    ])

    # Determine settlement amount
    settlement = case_data.get("settlement", {})
    settlement_amount = settlement.get("recommended_settlement_rm", 0) if settlement else 0
    if not settlement_amount:
        # Use last defendant offer
        defendant_offers = [m.get("counter_offer_rm") for m in messages if m.get("role") == "defendant" and m.get("counter_offer_rm")]
        settlement_amount = defendant_offers[-1] if defendant_offers else 0

    prompt = SETTLEMENT_AGREEMENT_PROMPT.replace(
        "{case_title}", case_data.get("title", "Dispute")
    ).replace(
        "{case_type}", case_data.get("caseType", "")
    ).replace(
        "{plaintiff_name}", case_data.get("plaintiffDisplayName") or "Claimant"
    ).replace(
        "{defendant_name}", case_data.get("defendantDisplayName") or "Respondent"
    ).replace(
        "{claim_amount}", str(case_data.get("amount", 0))
    ).replace(
        "{settlement_amount}", str(settlement_amount)
    ).replace(
        "{negotiation_summary}", negotiation_summary
    ).replace(
        "{messages_history}", messages_history
    )

    import asyncio
    try:
        loop = asyncio.get_event_loop()
        html_response = await loop.run_in_executor(None, call_gemini_with_retry, prompt)

        # Clean up: strip markdown fencing if present
        html_clean = html_response.strip()
        if html_clean.startswith("```html"):
            html_clean = html_clean.split("```html", 1)[1].rsplit("```", 1)[0].strip()
        elif html_clean.startswith("```"):
            html_clean = html_clean.split("```", 1)[1].rsplit("```", 1)[0].strip()

        return {"html": html_clean}
    except Exception as e:
        print(f"❌ Settlement PDF generation error: {e}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


@app.post("/api/cases/{caseId}/generate-deadlock-pdf")
async def generate_deadlock_pdf(caseId: str):
    """
    Generate Form 206-style court filing HTML for deadlock cases.
    Returns { html } for frontend PdfPreviewModal.
    """
    if not db:
        raise HTTPException(status_code=500, detail="Database unavailable")

    case_ref = db.collection("cases").document(caseId)
    case_doc = case_ref.get()

    if not case_doc.exists:
        raise HTTPException(status_code=404, detail="Case not found")

    case_data = case_doc.to_dict()

    # Get messages
    messages = []
    messages_ref = case_ref.collection("messages").order_by("createdAt").stream()
    for msg_doc in messages_ref:
        msg_data = msg_doc.to_dict()
        messages.append({
            "role": msg_data.get("role"),
            "content": msg_data.get("content"),
            "round": msg_data.get("round"),
            "counter_offer_rm": msg_data.get("counter_offer_rm"),
        })

    messages_history = "\n".join([
        f"[Round {m.get('round')}] {(m.get('role') or 'unknown').upper()}: {(m.get('content') or '')[:300]}"
        for m in messages
    ])

    negotiation_summary = "\n".join([
        f"- {(m.get('role') or 'unknown').capitalize()} (Round {m.get('round')}): Offered RM {m.get('counter_offer_rm', 'N/A')}"
        for m in messages if m.get("counter_offer_rm") is not None
    ])

    # Get final offers
    plaintiff_offers = [m.get("counter_offer_rm") for m in messages if m.get("role") == "plaintiff" and m.get("counter_offer_rm")]
    defendant_offers = [m.get("counter_offer_rm") for m in messages if m.get("role") == "defendant" and m.get("counter_offer_rm")]

    # Get legal context
    from backend.rag.retrieval import retrieve_law
    legal_docs = retrieve_law(case_data.get("title", ""), use_agentic=False)
    legal_context = "\n".join([
        f"- {d['law']} s.{d['section']}: {d['excerpt'][:200]}"
        for d in legal_docs
    ]) if legal_docs else "No specific laws retrieved."

    prompt = DEADLOCK_COURT_FILING_HTML_PROMPT.replace(
        "{case_title}", case_data.get("title", "Dispute")
    ).replace(
        "{case_type}", case_data.get("caseType", "")
    ).replace(
        "{plaintiff_name}", case_data.get("plaintiffDisplayName") or "Claimant"
    ).replace(
        "{defendant_name}", case_data.get("defendantDisplayName") or "Respondent"
    ).replace(
        "{claim_amount}", str(case_data.get("amount", 0))
    ).replace(
        "{plaintiff_final_offer}", str(plaintiff_offers[-1] if plaintiff_offers else 0)
    ).replace(
        "{defendant_final_offer}", str(defendant_offers[-1] if defendant_offers else 0)
    ).replace(
        "{negotiation_summary}", negotiation_summary
    ).replace(
        "{messages_history}", messages_history
    ).replace(
        "{legal_context}", legal_context
    )

    import asyncio
    try:
        loop = asyncio.get_event_loop()
        html_response = await loop.run_in_executor(None, call_gemini_with_retry, prompt)

        html_clean = html_response.strip()
        if html_clean.startswith("```html"):
            html_clean = html_clean.split("```html", 1)[1].rsplit("```", 1)[0].strip()
        elif html_clean.startswith("```"):
            html_clean = html_clean.split("```", 1)[1].rsplit("```", 1)[0].strip()

        return {"html": html_clean}
    except Exception as e:
        print(f"❌ Deadlock PDF generation error: {e}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


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