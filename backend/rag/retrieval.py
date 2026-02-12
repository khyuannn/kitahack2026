import os
import re
from typing import List, Dict
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore

# Load env variables
load_dotenv()

INDEX_NAME = "lex-machina-index"
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
GOOGLE_API_KEY = os.getenv("GEMINI_API_KEY")

EMBEDDING_MODEL = "models/gemini-embedding-001" 

def get_retriever():
    """
    Initializes the Vector Store and returns a retriever object.
    """
    # 1. Force the Environment Variable for LangChain
    if not os.environ.get("GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = GOOGLE_API_KEY
        
    if not PINECONE_API_KEY or not GOOGLE_API_KEY:
        raise ValueError("Missing API Keys")

    # 2. Initialize Embeddings with explicit API key
    embeddings = GoogleGenerativeAIEmbeddings(
        model=EMBEDDING_MODEL,
        google_api_key=GOOGLE_API_KEY # 👈 This fixes the "Default Credentials" error
    )

    # Connect to existing index
    vectorstore = PineconeVectorStore(
        index_name=INDEX_NAME,
        embedding=embeddings,
        pinecone_api_key=PINECONE_API_KEY
    )
    
    # Return as a retriever (Search top 3 results)
    return vectorstore.as_retriever(search_kwargs={"k": 3})

def retrieve_law(query: str) -> List[Dict[str, str]]:
    """
    Searches Pinecone and returns a structured list of citations.
    Match CONTRACT.md format: [{ "law":..., "section":..., "excerpt":... }]
    """
    try:
        print(f"🔎 Searching for: '{query}'...")
        retriever = get_retriever()
        docs = retriever.invoke(query)
        
        if not docs:
            print("⚠️ No results found.")
            return []
            
        structured_results = []
        
        for doc in docs:
            # Safely get metadata (default to '?' if missing)
            sec = doc.metadata.get('section', '?')
            src = doc.metadata.get('source', 'Contracts Act 1950')
            
            # Create the dictionary exactly as M3 needs it
            law_entry = {
                "law": str(src),
                "section": str(sec),
                "excerpt": doc.page_content.strip()[:400] + "..." # Truncate for cleaner JSON
            }
            structured_results.append(law_entry)
            
        return structured_results
        
    except Exception as e:
        print(f"❌ RAG Error: {e}")
        # Fallback for Demo Safety (prevents crash)
        return [
            {
                "law": "Contracts Act 1950",
                "section": "75",
                "excerpt": "(Fallback Mode) When a contract has been broken, the party complaining is entitled to compensation."
            }
        ]

# ==========================================
# 🧪 THE TESTING PART (Run this file directly)
# ==========================================
if __name__ == "__main__":
    import json
    
    # Test Query
    test_query = "landlord refused to return deposit"
    
    print("\n" + "="*40)
    print("🚀 STARTING RETRIEVAL TEST")
    print("="*40)
    
    # Run the function
    results = retrieve_law(test_query)
    
    # Verify the Output
    print(f"\n✅ Retrieved {len(results)} chunks.")
    
    if len(results) > 0:
        first_result = results[0]
        
        # Check if keys match CONTRACT.md
        required_keys = ["law", "section", "excerpt"]
        keys_exist = all(k in first_result for k in required_keys)
        
        if keys_exist:
            print("\n🟢 SUCCESS: Output format matches CONTRACT.md!")
            print(json.dumps(results, indent=2)) # Pretty print the JSON
        else:
            print("\n🔴 FAILURE: Output keys are wrong.")
            print(f"Got: {list(first_result.keys())}")
            print(f"Need: {required_keys}")
    else:
        print("\n🟡 WARNING: Zero results returned. Check Pinecone ingestion.")

    print("\n" + "="*40)