import os
import time
import json
import requests
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from pinecone import Pinecone

# Load env variables
load_dotenv()

INDEX_NAME = "lex-machina-index"
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

if GEMINI_API_KEY:
    os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY

# Standard embedding model
EMBEDDING_MODEL = "models/gemini-embedding-001" 
# Use env-configurable generation model for reasoning
GENERATION_MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash")

# Module-level singletons — initialized once on first use
_retrieval_index = None
_retrieval_embeddings = None

def _get_retrieval_clients():
    global _retrieval_index, _retrieval_embeddings
    if _retrieval_index is None:
        pc = Pinecone(api_key=PINECONE_API_KEY)
        _retrieval_index = pc.Index(INDEX_NAME)
    if _retrieval_embeddings is None:
        _retrieval_embeddings = GoogleGenerativeAIEmbeddings(
            model=EMBEDDING_MODEL,
            google_api_key=GEMINI_API_KEY,
        )
    return _retrieval_index, _retrieval_embeddings

def call_gemini_with_backoff(prompt: str) -> str:
    """
    Call Gemini for agentic query generation with 20s timeout.
    Retries with fallback model on failure before giving up.
    """
    if not GEMINI_API_KEY:
        print("❌ Missing GEMINI_API_KEY/GOOGLE_API_KEY for query generation.")
        return ""

    def _try_model(model_name: str, max_attempts: int = 2) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"
        payload = {"contents": [{"parts": [{"text": prompt}]}]}
        for i in range(max_attempts):
            try:
                response = requests.post(url, json=payload, timeout=20)
                if response.status_code == 200:
                    return response.json().get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', "")
                elif response.status_code == 429:
                    wait_time = min(2 ** i, 4)
                    print(f"⚠️ Quota hit on {model_name}. Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                else:
                    print(f"❌ API Error on {model_name}: {response.status_code}")
                    return ""
            except Exception as e:
                print(f"❌ Error on {model_name}: {e}")
                if i < max_attempts - 1:
                    time.sleep(min(2 ** i, 4))
        return ""

    result = _try_model(GENERATION_MODEL, max_attempts=2)
    if result:
        return result
    print(f"⚠️ Primary model failed for RAG query generation. Trying fallback: {FALLBACK_MODEL}")
    return _try_model(FALLBACK_MODEL, max_attempts=1)

def format_history_for_prompt(history: List[Dict[str, Any]]) -> str:
    if not history:
        return "No prior history."
    formatted = ""
    for msg in history:
        role = msg.get("role", "unknown").upper()
        content = msg.get("content", "")
        formatted += f"{role}: {content}\n"
    return formatted

def generate_legal_queries(user_input: str, history: List[Dict[str, Any]]) -> List[str]:
    """
    Generates 3-5 specific search queries based on the conversation context.
    """
    history_text = format_history_for_prompt(history)
    
    prompt = f"""
    You are a specialized Legal Research Agent for Malaysian Small Claims.
    
    === CASE CONTEXT ===
    {history_text}
    
    === CURRENT USER INPUT ===
    "{user_input}"
    
    === TASK ===
    Generate 3 to 5 specific, diverse search queries to find the relevant laws in our vector database.
    
    Your queries must cover:
    1. The core facts (e.g., "Landlord seized TV", "Fake Gucci Bag").
    2. The legal principle (e.g., "Distress Act warrant", "Implied condition of quality").
    3. The specific Act/Section if inferred (e.g., "Civil Law Act Section 28 double rent").
    
    OUTPUT FORMAT:
    Return ONLY the search queries, one per line. Do not number them.
    """
    
    print(f"🧠 Agentic Brain is reasoning...")
    raw_text = call_gemini_with_backoff(prompt)
    
    queries = [q.strip() for q in raw_text.split('\n') if q.strip()]
    
    print(f"🤖 Generated {len(queries)} Search Queries:")
    for q in queries:
        print(f"   -> {q}")
        
    return queries

def retrieve_law(
    query: str,
    history: Optional[List[Dict[str, Any]]] = None,
    category_filter: Optional[str] = None,
    use_agentic: bool = True
) -> List[Dict[str, str]]:
    """
    Executes Agentic RAG.
    """
    history = history or []

    try:
        # 1. Agentic Step
        search_queries = [query]
        if use_agentic:
            generated_queries = generate_legal_queries(query, history)
            if generated_queries:
                search_queries = generated_queries
            else:
                print("⚠️ Agentic query generation returned empty. Falling back to direct query.")
                search_queries = [query]

        all_matches = []
        seen_ids = set()

        # 2. Get reusable Pinecone + embeddings clients
        index, embeddings = _get_retrieval_clients()

        # 3. Execute Searches
        print(f"🔎 Executing searches against Pinecone...")
        
        for q in search_queries:
            try:
                query_vector = embeddings.embed_query(q)
                
                # M2 Safety Slice
                if len(query_vector) > 768:
                    query_vector = query_vector[:768]

                filter_dict = {}
                if category_filter:
                    filter_dict["category"] = category_filter

                results = index.query(
                    vector=query_vector,
                    top_k=3, 
                    include_metadata=True,
                    filter=filter_dict
                )
                
                for match in results.get("matches", []):
                    match_id = match.get("id")
                    if match_id in seen_ids:
                        continue
                    seen_ids.add(match_id)
                    all_matches.append(match)
            except Exception as search_err:
                print(f"⚠️ Single search failed: {search_err}")
                continue

        # 4. Sort and Limit
        all_matches.sort(key=lambda x: x.get("score", 0.0), reverse=True)
        final_matches = all_matches[:5]

        # 5. Format Output
        structured_results = []
        for match in final_matches:
            meta = match.get("metadata", {})
            raw_text = meta.get("text", "")
            
            # Fallback for text
            if not raw_text and match.get("metadata"):
                raw_text = f"Section {meta.get('section')} of {meta.get('source')}"

            law_entry = {
                "law": str(meta.get("source", "Unknown Law")),
                "section": str(meta.get("section", "?")),
                "excerpt": raw_text[:800] + "..." if len(raw_text) > 800 else raw_text,
                "score": float(match.get("score", 0.0))
            }
            structured_results.append(law_entry)

        return structured_results

    except Exception as e:
        print(f"❌ RAG Critical Error: {e}")
        return []

# ==========================================
# 🧪 RICH SCENARIO TESTING
# ==========================================
if __name__ == "__main__":
    
    print("\n" + "="*60)
    print("🚀 STARTING RICH CONTEXT DIAGNOSTICS")
    print("="*60)

    # --- SCENARIO 1: The "Holding Over" Tenant (Tenancy Dispute) ---
    print("\n🧪 SCENARIO 1: Tenancy - Holding Over & Double Rent")
    history_A = [
        {"role": "system", "content": "Case: Tenancy Dispute. Monthly Rent: RM 1500."},
        {"role": "plaintiff", "content": "I am the Landlord. My tenant's contract expired on Jan 31st 2024."},
        {"role": "defendant", "content": "I haven't found a new place yet. I'm staying for another month. I won't pay extra."},
        {"role": "plaintiff", "content": "You are holding over illegally. I will charge you double rent."}
    ]
    user_input_A = "Is it true I can charge double rent? Which law allows this?"
    
    # NOTE: No category_filter passed! We trust the Agent to find the 'tenancy_specific' snippets.
    results_A = retrieve_law(user_input_A, history=history_A, category_filter=None)
    
    if results_A:
        print(f"✅ Found {len(results_A)} laws.")
        for i, result in enumerate(results_A, 1):
            print(f"   [{i}] {result['law']} (Sec {result['section']}) | Score: {result['score']:.4f}")
            print(f"       Excerpt: {result['excerpt'][:150]}...")
    else:
        print("❌ No results.")

    print("-" * 60)

    # --- SCENARIO 2: The Fake Gucci Bag (Consumer Rights) ---
    print("\n🧪 SCENARIO 2: E-Commerce - Counterfeit Goods")
    history_B = [
        {"role": "system", "content": "Case: Consumer Claim. Item: Gucci Handbag. Price: RM 3500."},
        {"role": "plaintiff", "content": "I bought this bag on Carousell. The seller listed it as '100% Authentic'."},
        {"role": "defendant", "content": "Sold as is. No refunds. You saw the photos."},
        {"role": "plaintiff", "content": "I took it to a shop and they confirmed it is PVC plastic, not leather."}
    ]
    user_input_B = "He lied about the description. I want my money back under the law."
    
    # NOTE: No category_filter passed!
    results_B = retrieve_law(user_input_B, history=history_B, category_filter=None)
    
    if results_B:
        print(f"✅ Found {len(results_B)} laws.")
        for i, result in enumerate(results_B, 1):
            print(f"   [{i}] {result['law']} (Sec {result['section']}) | Score: {result['score']:.4f}")
            print(f"       Excerpt: {result['excerpt'][:150]}...")
    else:
        print("❌ No results.")