import os
import re
import time
from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_core.documents import Document
from pinecone import Pinecone, ServerlessSpec

# Load environment variables
load_dotenv()

# Force the library to find the key
if os.getenv("GEMINI_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.getenv("GEMINI_API_KEY")

# Configuration
PDF_PATH = "backend/data/Contracts-Act-1950.pdf"
INDEX_NAME = "lex-machina-index"
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
GOOGLE_API_KEY = os.getenv("GEMINI_API_KEY")
EMBEDDING_MODEL = "models/gemini-embedding-001"

def clean_text(text):
    text = re.sub(r'LAWS OF MALAYSIA', '', text)
    text = re.sub(r'Act 136', '', text)
    text = re.sub(r'CONTRACTS ACT 1950', '', text)
    text = re.sub(r'--- PAGE \d+ ---', '', text)
    text = re.sub(r'\n\s*\n', '\n\n', text).strip()
    return text

def semantic_chunking(raw_text):
    chunks = re.split(r'(?=\n\d+\.\s)', raw_text)
    documents = []
    for chunk in chunks:
        chunk = chunk.strip()
        if len(chunk) < 50: continue
        match = re.search(r'^(\d+)\.', chunk)
        section_num = match.group(1) if match else "Unknown"
        doc = Document(
            page_content=chunk,
            metadata={"source": "Contracts Act 1950", "section": section_num, "type": "statute"}
        )
        documents.append(doc)
    return documents

def ingest_data():
    if not os.path.exists(PDF_PATH):
        print(f"❌ Error: PDF not found at {PDF_PATH}")
        return

    print(f"📄 Loading PDF from {PDF_PATH}...")
    loader = PyPDFLoader(PDF_PATH)
    raw_pages = loader.load()
    
    # --- CRITICAL FIX: Trim Head (TOC) and Tail (Appendix) ---
    # Start: Page 13 (Index 12) -> Start of "PART I"
    # End: Page 87 (Index 86) -> Start of "APPENDIX"
    print("✂️  Trimming Document: Using Pages 13 to 87 only...")
    real_law_pages = raw_pages[12:87] 
    
    full_text = "\n".join([page.page_content for page in real_law_pages])
    cleaned_text = clean_text(full_text)
    
    print("✂️  Chunking text by Section...")
    docs = semantic_chunking(cleaned_text)
    print(f"   -> Created {len(docs)} legal chunks.")
    
    print("🌲 Connecting to Pinecone...")
    pc = Pinecone(api_key=PINECONE_API_KEY)
    
    existing_indexes = [i.name for i in pc.list_indexes()]
    if INDEX_NAME not in existing_indexes:
        print(f"   -> Creating new index: {INDEX_NAME}")
        pc.create_index(
            name=INDEX_NAME,
            dimension=768, 
            metric="dotproduct",
            spec=ServerlessSpec(cloud="aws", region="us-east-1")
        )
        while not pc.describe_index(INDEX_NAME).status['ready']:
            time.sleep(1)
        print("   -> Index is ready!")
    
    print(f"🧠 Generating Embeddings using {EMBEDDING_MODEL}...")
    try:
        embeddings = GoogleGenerativeAIEmbeddings(model=EMBEDDING_MODEL)
    except Exception as e:
        print(f"\n❌ CRITICAL ERROR: Could not access {EMBEDDING_MODEL}")
        return
    
    print("🚀 Uploading vectors (Super Safe Mode)...")
    
    BATCH_SIZE = 5 
    SLEEP_TIME = 5
    
    total_docs = len(docs)
    
    for i in range(0, total_docs, BATCH_SIZE):
        batch = docs[i : i + BATCH_SIZE]
        print(f"   -> Processing batch {i // BATCH_SIZE + 1}/{(total_docs // BATCH_SIZE) + 1}...")
        
        max_retries = 5
        for attempt in range(max_retries):
            try:
                PineconeVectorStore.from_documents(
                    documents=batch,
                    embedding=embeddings,
                    index_name=INDEX_NAME,
                    pinecone_api_key=PINECONE_API_KEY
                )
                print(f"      ...success (sleeping {SLEEP_TIME}s)...")
                time.sleep(SLEEP_TIME) 
                break 
            except Exception as e:
                print(f"      ❌ Failed attempt {attempt+1}/{max_retries}: {e}")
                wait_time = 30 * (attempt + 1)
                print(f"      ...hitting limits, cooling down for {wait_time}s...")
                time.sleep(wait_time)
        else:
            print("❌ CRITICAL: Batch failed after 5 retries. Skipping.")

    print("✅ Ingestion Complete! The Law is now accessible.")

if __name__ == "__main__":
    ingest_data()