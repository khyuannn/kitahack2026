This document defines the frozen integration contract between frontend (next.js + firebase) and backend (fastapi)

As long as this contract remains unchanged:
- Frontend implementation will not break
- Backend internal logic may change freely

## firestore schema (frozen)
### collection: cases/{caseId}
Fields:
- status: "created" | "running" | "done" | "error"
- title: string
- caseType: "tenancy_deposit"
- createdAt: timestamp
- createdBy: uid

### Subcollection: cases/{caseId}/messages/{messageId}
Fields:
- role: "plaintiff" | "defendant" | "mediator" | "system"
- content: string
- round: number
- createdAt: timestamp

### Subcollection: cases/{caseId}/evidence/{evidenceId}
Fields:
- fileType: "text" | "image" | "pdf" | "audio"
- storageUrl: string
- extractedText: string (optional)
- createdAt: timestamp


## API endpoints (frozen)
### POST /api/cases/start
Request:
{
    "title": string,
    "caseType": "tenancy_deposit"
}

Response:
{
    "caseId": string
}

---
### POST /api/cases/{caseId}/evidence
Request:
{
    "type": "text" | "image" | "pdf" | "audio",
    "storageUrl": string,
    "text"?: string
}

Response:
{
    "evidenceId": string
}

---
### POST /api/cases/{caseId}/run
Request:
{
    "mode": "mvp" | "full"
}

Response:
{
    "status": "running"
}

---
### GET /api/cases/{caseId}/result
Response:
{
    "status": "done" | "running"
    "settlement": SettlementJSON | null
}

## Settlement JSON (frozen)
{
    "summary": string,
    "recommended_settlement_rm": number,
    "confidence": number, 
    "citations": [
        {
            "law": string,
            "section": string,
            "excerpt": string
        }
    ]
}

Rules:
recommended_settlement_rm must always exist
confidence is between 0–1
citations can be empty but must be an array

## Result JSON (freeze)
Example:
{
  "case_id": "xxx",
  "status": "running" | "done",
  "settlement": SettlementJSON | null
}

## Non-Goals (Not Part of Contract)

The following are NOT guaranteed and may change:
- Internal agent architecture (LangGraph vs loop)
- Prompt wording
- RAG implementation (Pinecone vs mock)
- Streaming mechanism (SSE vs Firestore polling)
- Number of negotiation rounds

Only the data contracts above are guaranteed.
