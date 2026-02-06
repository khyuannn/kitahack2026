from pydantic import BaseModel
from typing import Literal

class StartCaseRequest(BaseModel):
    title: str
    caseType: Literal["tenancy_deposit"]