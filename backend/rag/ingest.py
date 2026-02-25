import os
import re
import time
from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pinecone import Pinecone, ServerlessSpec

# Load environment variables
load_dotenv()
if os.getenv("GEMINI_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.getenv("GEMINI_API_KEY")

INDEX_NAME = "lexsuluh-index"
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
EMBEDDING_MODEL = "models/gemini-embedding-001"

# --- CONFIGURATION ---
FILES_TO_INGEST = [
    #{ "path": "backend/data/Sale-of-Goods-Act-1957.pdf", "source": "Sale of Goods Act 1957", "category": "buying_goods", "type": "pdf" },
    #{ "path": "backend/data/CONSUMER PROTECTION ACT 1999.pdf", "source": "Consumer Protection Act 1999", "category": "consumer_rights", "type": "pdf" },
    #{ "path": "backend/data/limitation-act-1953.pdf", "source": "Limitation Act 1953", "category": "time_limits", "type": "pdf" },
    #{ "path": "backend/data/ORDER 93.txt", "source": "Rules of Court Order 93", "category": "procedure", "type": "txt" },
    #{ "path": "backend/data/tenancy_snippets.txt", "source": "Tenancy Snippets", "category": "tenancy_specific", "type": "txt" }
    { "path": "backend/data/Contracts-Act-1950.pdf", "source": "Contracts Act 1950", "category": "contracts", "type": "pdf" }
]

def clean_pdf_noise(text):
    """Removes headers, footers, and page numbers that interrupt sentences."""
    text = re.sub(r'--- PAGE \d+ ---', '', text)
    text = re.sub(r'(?i)laws of malaysia', '', text)
    text = re.sub(r'(?i)act \d+', '', text)
    # Remove floating page numbers on their own lines
    text = re.sub(r'^\s*\d+\s*$', '', text, flags=re.MULTILINE)
    # Fix broken paragraphs caused by page breaks
    text = re.sub(r'\n\s*\n', '\n\n', text).strip()
    return text

def smart_legal_chunking(raw_text, source_name, category):
    """Splits text by Legal Section (e.g., '12. ') and extracts the section number."""
    documents = []
    
    # 🛡️ THE CIRCUIT BREAKER: A safety splitter for dangerously large chunks
    safety_splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=200)
    
    # Check if this document has standard numbered sections (like 1. , 2. , 15. )
    if re.search(r'\n\d+\.\s', raw_text):
        # Split using lookahead so we KEEP the "15. " at the start of the chunk
        chunks = re.split(r'(?=\n\d+\.\s)', raw_text)
        
        for chunk in chunks:
            chunk = chunk.strip()
            if len(chunk) < 50: continue # Skip tiny fragments
            
            # Extract the section number for metadata
            match = re.search(r'^(\d+)\.', chunk)
            section_num = match.group(1) if match else "Intro_or_Misc"
            
            # 🚨 THE FIX: Prevent giant chunks (like TOCs) from breaking the embeddings
            if len(chunk) > 2000:
                sub_chunks = safety_splitter.split_text(chunk)
                for sub_idx, sub_chunk in enumerate(sub_chunks):
                    injected_text = f"[Document: {source_name} | Section: {section_num} (Part {sub_idx+1})]\n{sub_chunk}"
                    doc = Document(
                        page_content=injected_text,
                        metadata={"source": source_name, "category": category, "section": section_num}
                    )
                    documents.append(doc)
            else:
                injected_text = f"[Document: {source_name} | Section: {section_num}]\n{chunk}"
                doc = Document(
                    page_content=injected_text,
                    metadata={"source": source_name, "category": category, "section": section_num}
                )
                documents.append(doc)
            
    elif re.search(r'(?im)^\s*SECTION\s+\d+[A-Za-z0-9()\-]*\s*:', raw_text):
        # Structured text style: LAW: ... then SECTION X: ...
        current_law = "Unknown Law"
        law_sections = []
        current_section_num = None
        current_section_title = ""
        current_section_lines = []

        def flush_current_section():
            if not current_section_num:
                return
            section_body = "\n".join(current_section_lines).strip()
            if len(section_body) < 30:
                return

            full_section_text = f"LAW: {current_law}\nSECTION {current_section_num}: {current_section_title}\n{section_body}".strip()
            law_sections.append((current_section_num, full_section_text))

        for line in raw_text.splitlines():
            law_match = re.match(r'^\s*LAW:\s*(.+?)\s*$', line, flags=re.IGNORECASE)
            if law_match:
                flush_current_section()
                current_section_num = None
                current_section_title = ""
                current_section_lines = []
                current_law = law_match.group(1).strip()
                continue

            section_match = re.match(
                r'^\s*SECTION\s+([A-Za-z0-9()\-]+)\s*:\s*(.*)$',
                line,
                flags=re.IGNORECASE,
            )
            if section_match:
                flush_current_section()
                current_section_num = section_match.group(1).strip()
                current_section_title = section_match.group(2).strip()
                current_section_lines = []
                continue

            if current_section_num:
                current_section_lines.append(line)

        flush_current_section()

        for section_num, section_text in law_sections:
            if len(section_text) > 2000:
                sub_chunks = safety_splitter.split_text(section_text)
                for sub_idx, sub_chunk in enumerate(sub_chunks):
                    injected_text = f"[Document: {source_name} | Section: {section_num} (Part {sub_idx+1})]\n{sub_chunk}"
                    doc = Document(
                        page_content=injected_text,
                        metadata={"source": source_name, "category": category, "section": section_num}
                    )
                    documents.append(doc)
            else:
                injected_text = f"[Document: {source_name} | Section: {section_num}]\n{section_text}"
                doc = Document(
                    page_content=injected_text,
                    metadata={"source": source_name, "category": category, "section": section_num}
                )
                documents.append(doc)

    else:
        # FALLBACK: For non-numbered text like tenancy_snippets.txt
        docs = safety_splitter.create_documents(
            [raw_text], 
            metadatas=[{"source": source_name, "category": category, "section": "Snippet"}]
        )
        for doc in docs:
            doc.page_content = f"[Document: {source_name}]\n{doc.page_content}"
            documents.append(doc)
            
    return documents

def ingest_data():
    print("🌲 Connecting to Pinecone...")
    pc = Pinecone(api_key=PINECONE_API_KEY)
    
    if INDEX_NAME not in [i.name for i in pc.list_indexes()]:
        print(f"   -> Creating index: {INDEX_NAME}")
        pc.create_index(name=INDEX_NAME, dimension=768, metric="dotproduct", spec=ServerlessSpec(cloud="aws", region="us-east-1"))
        while not pc.describe_index(INDEX_NAME).status['ready']: time.sleep(1)

    embeddings = GoogleGenerativeAIEmbeddings(model=EMBEDDING_MODEL)

    for file_config in FILES_TO_INGEST:
        file_path = file_config["path"]
        if not os.path.exists(file_path):
            print(f"⚠️ Skipping: File not found at {file_path}")
            continue

        print(f"\n📄 Processing {file_config['source']}...")
        
        # Load File
        if file_config["type"] == "pdf":
            raw_pages = PyPDFLoader(file_path).load()
            full_text = "\n".join([page.page_content for page in raw_pages])
            full_text = clean_pdf_noise(full_text) # Clean the PDF noise!
        else:
            full_text = TextLoader(file_path, encoding='utf-8').load()[0].page_content

        # Chunk intelligently
        chunked_docs = smart_legal_chunking(full_text, file_config["source"], file_config["category"])
        print(f"   -> Created {len(chunked_docs)} chunks.")

        print("🚀 Uploading vectors (Super Safe Mode)...")
        BATCH_SIZE = 5 
        SLEEP_TIME = 5
        total_docs = len(chunked_docs)
        
        # Connect directly to the Pinecone index, bypassing the Langchain wrapper
        index = pc.Index(INDEX_NAME)
        
        for i in range(0, total_docs, BATCH_SIZE):
            batch_docs = chunked_docs[i : i + BATCH_SIZE]
            
            print(f"   -> Processing batch {i // BATCH_SIZE + 1}/{(total_docs // BATCH_SIZE) + 1}...")
            
            max_retries = 5
            for attempt in range(max_retries):
                try:
                    # 1. Manually get texts and metadata
                    texts = [doc.page_content for doc in batch_docs]
                    metas = [doc.metadata for doc in batch_docs]
                    
                    # 2. Embed via Google
                    vecs = embeddings.embed_documents(texts)
                    
                    # 3. 🚨 FAILSAFE: Un-flatten the Pydantic bug if it happens
                    if len(vecs) > 0 and not isinstance(vecs[0], list):
                        # The wrapper merged them into a single list of floats! Re-split them by 768.
                        flat_vec = vecs
                        vecs = [flat_vec[k*768 : (k+1)*768] for k in range(len(texts))]
                    elif len(vecs) == 1 and len(vecs[0]) > 768 and len(texts) > 1:
                        # Variant of the flattening bug
                        flat_vec = vecs[0]
                        vecs = [flat_vec[k*768 : (k+1)*768] for k in range(len(texts))]

                    # 4. Prepare records for Pinecone
                    records = []
                    for idx, (vec, meta) in enumerate(zip(vecs, metas)):
                        safe_source = re.sub(r'[^a-zA-Z0-9]', '_', meta.get("source", "doc"))
                        safe_sec = re.sub(r'[^a-zA-Z0-9]', '_', str(meta.get("section", "0")))
                        doc_id = f"{safe_source}_Sec_{safe_sec}_b{i}_i{idx}"
                        doc_text = texts[idx]
                        
                        # Absolute guarantee that Pinecone won't crash
                        clean_vec = vec[:768] if len(vec) > 768 else vec
                        if len(clean_vec) < 768:
                            clean_vec.extend([0.0] * (768 - len(clean_vec)))
                            
                        record_metadata = {**meta, "text": doc_text}
                        records.append({"id": doc_id, "values": clean_vec, "metadata": record_metadata})
                        
                    # 5. Native Pinecone Upload (Bypasses Langchain completely)
                    index.upsert(vectors=records)
                    
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

    print("\n✅ All Laws Ingested Successfully!")

if __name__ == "__main__":
    ingest_data()