"""
FastAPI backend for BYP case management.
Integrates with Firebase, orchestrator, and frontend per contract.md.
Phase 1: basic api, firestore integration, dump loop
"""
import os
from dotenv import load_dotenv
from fastapi import FastAPI, Request, status, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import firebase_admin
from firebase_admin import credentials, firestore
import uuid
from typing import Optional
from backend.core import orchestrator
from backend.core.orchestrator import run_dumb_loop, get_case_result, run_case
import threading

from backend.app.api_models import (
    CaseEvidenceRequest,
    CaseEvidenceResponse,
    GetCaseResultResponse,
    RunCaseRequest,
    RunCaseResponse,
    StartCaseRequest,
    StartCaseResponse,
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

    service_account_path = os.getenv("FIREBASE_SERVICE_ACCOUNT", "backend/serviceAccountKey.json").strip()
    # google_app_creds = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()

    if service_account_path and os.path.isfile(service_account_path):
        cred = credentials.Certificate(service_account_path)
        firebase_admin.initialize_app(cred)
        print("Firebase initialized with service account.")
    else:
        print("Firebase credentials not found or invalid. running in mock mode.")

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
    # TODO: orchestrator.create_case(title=request.title, case_type=request.caseType)
    case_id = str(uuid.uuid4())
    if db:
        db.collection("cases").document(case_id).set({
            "status": "created",
            "title": request.title,
            "caseType": request.caseType,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "createdBy": "mock-user-id",  # To be replaced with actual user ID

        })
        # Return the document ID as caseId
    # phase 2
    # orchestrator.create_case(title=request.title, case_type=request.caseType, case_id=case_id)
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
async def run_case(
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
    thread = threading.Thread(target=run_case, args=(caseId, request.mode)) #changed from run_dumb_loop (phase1) to run_case (phase 1.5)
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

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "firebase": db is not None}