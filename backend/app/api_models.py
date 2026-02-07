from pydantic import BaseModel
from typing import Literal, Optional

class StartCaseRequest(BaseModel):
    title: str
    caseType: Literal["tenancy_deposit"]

class StartCaseResponse(BaseModel):
    caseId: str

class CaseEvidenceRequest(BaseModel):
    fileType: Literal["text","image", "pdf","audio"]
    storageUrl: str
    text: Optional[str] = None

class CaseEvidenceResponse(BaseModel):
    evidenceId: str

class RunCaseRequest(BaseModel):
    mode: Literal["mvp", "full"]

class RunCaseResponse(BaseModel):
    status: Literal["running"]

class GetCaseResultResponse(BaseModel):
    status: Literal["running", "done"]
    settlement: Optional[dict] = None

#  add at phase2
# class Settlement(BaseModel):
#     summary: str
#     recommended_settlement_rm: float
#     confidence: float

