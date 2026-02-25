# LexSuluh

**AI-Powered Dispute Resolution for Malaysian Small Claims**

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?logo=fastapi)
![Gemini](https://img.shields.io/badge/Gemini-2.5_Flash-4285F4?logo=google)
![Firebase](https://img.shields.io/badge/Firebase-Firestore%20%2B%20Storage-FFCA28?logo=firebase)
![Pinecone](https://img.shields.io/badge/Pinecone-Vector_DB-00B796)

---

## Project Description

LexSuluh ("Suluh" = torch/light in Malay) is an AI-powered dispute resolution platform that lets two parties resolve small claims disputes in under 15 minutes — without lawyers, without courts, and without legal expertise. Each party commands their own AI legal agent via strategy directives; the agents argue the case using real Malaysian statute citations, guided by a neutral Mediator AI. Disputes end in either a legally-formatted settlement agreement or a ready-to-file court form.

### The Justice Gap

Malaysia's Small Claims Court handles disputes up to RM5,000 — but **Order 93, Rule 7 of the Rules of Court 2012 explicitly bars lawyer representation**. Claimants must navigate the legal process alone, yet:

- Legal consultation costs RM500+ per session (RM150–600/hr), often **exceeding the disputed amount itself**
- Ordinary Malaysians — especially B40 and M40 communities — lack knowledge of their rights under the Contracts Act 1950, Consumer Protection Act, or Sale of Goods Act
- Knowledge asymmetry systematically disadvantages the less legally literate party

LexSuluh closes this gap by giving every party an AI legal agent that knows Malaysian law.

### Solution

In **PvP mode** (the primary mode), both parties join the same case via an invite link. Each person acts as a "commander" — they provide strategic direction via chips or text directives, while their AI agent handles the actual legal argumentation, citing real Malaysian statutes retrieved via RAG. A neutral Mediator AI intervenes at round 3 to facilitate convergence. Disputes resolve in 4 rounds or less.

**AI mode** is available for single-user testing: the user commands the Plaintiff AI while the system auto-plays the Defendant AI.

Currently supported dispute categories:

- **Tenancy and Rental Disputes** — security deposit refunds, unpaid rent, property damage claims
- **Consumer and E-Commerce Disputes** — defective goods, items not as described, fake products (e.g., Shopee, Carousell)
- **Freelance and Unpaid Services** — unpaid invoices, breach of service agreement, failure to deliver

### SDG Alignment

| SDG | Relevance |
|-----|-----------|
| **SDG 16.3** — Access to Justice | LexSuluh is a zero-cost AI legal advisor for small claims, making dispute resolution accessible to anyone with a phone |
| **SDG 10** — Reduced Inequalities | Bridges the knowledge asymmetry that disadvantages B40/M40 Malaysians against more legally literate counterparties |

---

## Key Features

- **Adversarial AI Negotiation** — Plaintiff AI and Defendant AI argue opposing positions across up to 4 rounds, with BATNA and game-theory prompting for realistic negotiation dynamics
- **PvP Mode (Primary)** — Two humans each command their own AI agent via strategy chips and text directives; humans provide strategy, AI provides legal expertise (human-in-the-loop)
- **RAG on Malaysian Statutes** — Pinecone vector DB with Gemini Embedding-001 covering Contracts Act 1950, Consumer Protection Act 1999, Sale of Goods Act 1957, Limitation Act 1953, Order 93 (Rules of Court 2012), and tenancy law snippets; agentic self-querying generates 3–5 legal search queries per turn
- **Legal Citation Auditor** — Regex extraction + Pinecone score validation on every generated message; invalid citations trigger regeneration (max 2 retries) or surface an `auditor_warning` to the user
- **Google Cloud TTS** — Distinct Neural2 voices per role (plaintiff, defendant, mediator)
- **Settlement Agreement PDF** — Auto-generated legally-formatted document on successful resolution
- **Form 206 Court Filing Template** — Auto-generated on deadlock; ready to submit to Small Claims Court
- **Strategy Chips** — Contextual AI-suggested directives generated fresh each turn
- **Settlement Meter** — Visual ZOPA (Zone of Possible Agreement) tracker updated in real time
- **Evidence Upload** — Supports PDFs and images; analyzed via Gemini Files API multipart calls

---

## Technical Implementation

### Architecture Overview

```
User (Browser) ──── Next.js Frontend ──── FastAPI Backend (port 8005)
                         │                        │
                    Firebase Auth          Gemini 2.5 Flash
                    Firestore (RT)         Gemini Embedding-001
                    Firebase Storage       Google Cloud TTS
                                           Pinecone (RAG)
                                           Gemini Files API
```

The Next.js frontend proxies all `/api/*` requests to the FastAPI backend. Firestore provides real-time case state sync between PvP parties. Firebase Storage holds evidence files and generated TTS audio.

---

### Google Tools Used

| Tool | Usage |
|------|-------|
| Gemini 2.5 Flash | Primary LLM for all agent reasoning, turn generation, strategy chip generation |
| Gemini 2.5 Flash Lite | Fallback on timeout or rate limit |
| Gemini Embedding-001 | Generates 768-dim embeddings for Pinecone RAG index |
| Gemini Files API | Multipart evidence analysis — PDFs and images passed directly into LLM calls |
| Google Cloud TTS (Neural2) | Voice synthesis: en-US-Neural2-D (plaintiff), -E (defendant), -C (mediator) |
| Firebase Auth | Google OAuth for plaintiffs; anonymous auth for defendants (zero-friction join) |
| Firestore | Real-time case data, chat messages, evidence metadata, turn-lock state |
| Firebase Storage | Evidence file storage + generated TTS audio hosting |

---

### Full Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, TypeScript, Tailwind CSS, React 18 |
| Backend | FastAPI (Python), Uvicorn |
| AI / ML | LangChain (document loaders, embeddings), LangGraph (Phase 2 roadmap) |
| Vector DB | Pinecone (serverless, dotproduct metric, 768-dim) |
| Law Data | Contracts Act 1950, Consumer Protection Act 1999, Sale of Goods Act 1957, Limitation Act 1953, Order 93 (Rules of Court 2012), tenancy law snippets — all ingested into Pinecone |
| PDF Export | html2pdf.js (settlement agreement + court filing) |

---

### Implementation Details

#### Agentic Negotiation Pipeline

Each turn triggers a 10-step orchestration sequence in `backend/core/orchestrator.py`:

1. Load case context (parties, claim amount, history) and evidence metadata from Firestore
2. **RAG**: Gemini generates 3–5 domain-specific legal queries → Pinecone dense+sparse hybrid search → top-5 results (score threshold 0.23) injected into agent system prompts
3. Generate Plaintiff AI response (structured JSON: `message` + `counter_offer_rm`)
4. **Citation Auditor**: regex extracts legal citations from generated text → validates each against Pinecone; if invalid, regenerate (max 2 retries) or attach `auditor_warning`
5. Generate TTS audio (Google Cloud TTS Neural2) → upload to Firebase Storage → save URL in Firestore message document
6. Generate Defendant AI response with updated conversation context and Plaintiff's position
7. Run Defendant Citation Auditor (same validation pipeline)
8. Evaluate game state: `settled` / `active` / `deadlock`
9. Generate strategy chips for the next human turn (contextual suggestions based on current positions)
10. Write full turn result to Firestore; frontend real-time listeners pick up changes for both parties

#### RAG Flow

```
User Turn
  └── Orchestrator calls Gemini to generate 3–5 legal search queries
        └── Each query → Pinecone hybrid search (dense + sparse)
              └── Top-5 chunks (score > 0.23) → injected into agent prompt
                    └── Agent cites real statute sections in its argument
```

#### Anti-Hallucination Citation Auditor

LLMs frequently invent section numbers. The Citation Auditor addresses this:

1. Regex extraction: identifies all legal citation patterns in generated text (e.g., "Section 14(1) of the Contracts Act 1950")
2. Each citation is embedded and queried against Pinecone
3. If similarity score falls below threshold — citation is flagged as unverifiable
4. Message is regenerated (up to 2 retries)
5. If still failing after retries — message is delivered with an `auditor_warning` flag visible to the user

#### BATNA and Negotiation Structure

The 4-round structure is fixed and procedural:

- **Round 1 — Opening**: Plaintiff AI anchors high; Defendant AI establishes its defensive position
- **Round 2 — Assert/Counter**: Both agents make strategic counter-offers backed by statute citations
- **Round 2.5 — Mediator injection**: After round 2 completes, the Mediator AI is auto-injected without requiring user input. It analyses both positions, evaluates argument strength against the RAG legal context, and outputs a neutral settlement recommendation with a specific RM amount (`recommended_settlement_rm`). This recommendation is advisory — both parties can ignore it.
- **Round 3 — Post-mediator**: Agents respond to mediator guidance; round-specific prompts push toward compromise
- **Round 4 — BATNA**: Both agents invoke BATNA framing in their prompts — citing court costs, time, and outcome uncertainty — as a final-round pressure tactic. No further rounds are possible; the UI forces an accept/reject decision.

**Price constraints**: Plaintiff sets a floor price (minimum acceptable settlement); defendant's maximum offer defaults to 50% of the claim amount, or a custom ceiling in PvP mode. Agents are instructed never to propose outside their respective bound.

**Commander Directive override**: Users can explicitly command their AI agent with a specific offer amount (e.g., "offer RM1,500"). This is injected as a `[COMMANDER DIRECTIVE — MUST FOLLOW]` block and overrides the agent's autonomous judgment, subject to the floor/ceiling bound.

#### PvP Human-in-the-Loop

Each human "commander" directs their AI agent via:
- **Strategy Chips**: pre-generated contextual suggestions (e.g., "Cite the contract clause", "Propose a partial settlement")
- **Text Directives**: free-form instructions typed by the user

The AI agent receives the human directive as a `[COMMANDER DIRECTIVE]` block prepended to its system prompt. Turn alternation is enforced via a `currentTurn` field in the Firestore case document. Both parties use Firestore real-time listeners with 3-retry exponential backoff to stay in sync without polling.

---

### Innovation Highlights

1. **Human-in-the-Loop Adversarial AI**: LexSuluh is not a chatbot. Each party has their own AI legal agent that they direct. Humans provide strategy and context; AI provides legal expertise and argumentation. This collaborative model is more effective and more trusted than a fully-autonomous AI.

2. **Zero-Hallucination Legal Citations**: Every legal claim generated by the AI is validated against real statute text before it reaches the user. This is non-trivial — standard LLM outputs for legal text routinely fabricate section numbers and case citations.

3. **Dual Output Paths**: The system doesn't just "resolve" disputes — it produces actionable documents. A settlement produces a signed-ready PDF; a deadlock produces a pre-filled Form 206 court filing template, making the Small Claims Court process concrete and accessible.

4. **Frictionless Defendant Onboarding**: Defendants join via a share link with zero-friction anonymous Firebase auth — no account required. Removing this friction barrier is critical for adoption; requiring registration would cause the opposing party to simply not participate.

---

### Challenges and Solutions

| Challenge | Solution |
|-----------|----------|
| Gemini API timeouts on complex prompts (evidence + long history) | 30s per-call timeout, 2 retries, automatic fallback to Gemini 2.5 Flash Lite |
| edge-tts library failure on Render (serverless environment) | Migrated to Google Cloud TTS Neural2 — server-side synthesis, no subprocess dependencies |
| Race conditions on PvP turn alternation | Firestore turn-lock state field + real-time listeners; UI blocks input while `currentTurn` does not match the user's role |
| LLMs fabricating Malaysian statute section numbers | Built Pinecone-backed Citation Auditor with regex extraction and score-threshold validation |

---

## Quick Setup

### Prerequisites

- Node.js 18+ and npm
- Python 3.10+
- Firebase project with Auth, Firestore, and Storage enabled
- Google Cloud project with Text-to-Speech API enabled
- Gemini API key ([Google AI Studio](https://aistudio.google.com))
- Pinecone account (free tier is sufficient)

### Environment Variables

Two `.env` files are required.

**Root `.env`** (frontend + shared backend config):

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=

GEMINI_API_KEY=
PINECONE_API_KEY=
FIREBASE_SERVICE_ACCOUNT_JSON=
FIREBASE_STORAGE_BUCKET=
```

**`backend/.env`** (Google Cloud TTS credentials):

```
GOOGLE_CREDENTIALS_JSON=
```

See `.env_template` in the project root for the full variable list with descriptions.

### Running Locally

```bash
# Backend (port 8005)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8005

# Frontend (port 3000) — in a separate terminal
cd ..
npm install
npm run dev
```

The Next.js dev server proxies `/api/*` to `http://127.0.0.1:8005` automatically via `next.config.js`.

### Ingesting Malaysian Law Data

Before running the app, index the Contracts Act 1950 into Pinecone:

```bash
cd backend
python rag/ingest.py
```

This reads the PDF, chunks it, generates Gemini Embedding-001 embeddings, and upserts into Pinecone. Only needs to run once.

---

## Project Structure

```
kitahack2026/
├── app/                          # Next.js frontend
│   ├── negotiation/[caseId]/     # Main negotiation UI (chat, chips, evidence)
│   ├── case/[caseId]/respond/    # Defendant onboarding page
│   └── components/               # EvidenceSidebar, EvidenceModal, etc.
├── backend/
│   ├── app/main.py               # FastAPI routes
│   ├── core/orchestrator.py      # 10-step negotiation pipeline
│   ├── tts/voice.py              # Google Cloud TTS voice config
│   └── rag/                      # Pinecone ingestion + retrieval
└── README.md
```

---

## Competition Context

Built for **KitaHack 2026** — Google-powered hackathon track.

Primary Google technologies: Gemini 2.5 Flash, Gemini Embedding-001, Gemini Files API, Google Cloud TTS, Firebase (Auth, Firestore, Storage).

SDGs addressed: **16.3** (Access to Justice) and **10** (Reduced Inequalities).
