import os
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from pinecone import Pinecone

# Load env variables
load_dotenv()

INDEX_NAME = "lex-machina-index"
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
GOOGLE_API_KEY = os.getenv("GEMINI_API_KEY")
# MUST match ingest.py model
EMBEDDING_MODEL = "models/gemini-embedding-001" 

def get_retriever():
    """
    Initializes the Vector Store and returns a retriever object.
    """
    if not PINECONE_API_KEY or not GOOGLE_API_KEY:
        raise ValueError("Missing API Keys")

    # Initialize Embeddings
    embeddings = GoogleGenerativeAIEmbeddings(model=EMBEDDING_MODEL)

    # Connect to existing index (No ingestion here, just reading)
    vectorstore = PineconeVectorStore(
        index_name=INDEX_NAME,
        embedding=embeddings,
        pinecone_api_key=PINECONE_API_KEY
    )
    
    # Return as a retriever (Search top 3 results)
    return vectorstore.as_retriever(search_kwargs={"k": 3})

def retrieve_law(query: str) -> str:
    """
    The main function M3 will call.
    Input: "landlord kept my deposit"
    Output: "Section 75: Compensation for breach..."
    """
    try:
        retriever = get_retriever()
        docs = retriever.invoke(query)
        
        if not docs:
            return "No relevant laws found in the database."
            
        # Format the output into a readable string
        result_text = ""
        for i, doc in enumerate(docs):
            result_text += f"\n--- LAW FRAGMENT {i+1} ---\n"
            result_text += f"Source: {doc.metadata.get('source', 'Unknown')} (Section {doc.metadata.get('section', '?')})\n"
            result_text += f"Content: {doc.page_content}\n"
            
        return result_text
        
    except Exception as e:
        return f"Error retrieving laws: {str(e)}"

# Quick Test Block
if __name__ == "__main__":
    test_query = "landlord refuse refund deposit"
    print(f"🔍 Testing Search for: '{test_query}'...")
    print(retrieve_law(test_query))