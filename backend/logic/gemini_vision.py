import google.genai as genai
from google.genai import types

def extract_evidence_facts(file_path):
    client = genai.Client(api_key="YOUR_API_KEY")
    
    # M1 Logic: The "Vision Prompt"
    # We ask for JSON so M3 (Backend) can save it easily to Firestore.
    prompt = """
    Analyze this Malaysian legal document/evidence photo. 
    1. Identify the Document Type (Tenancy Agreement, Receipt, NRIC, WhatsApp).
    2. Extract Key Facts:
       - Amounts (RM)
       - Dates (DD/MM/YYYY)
       - Parties involved (Names)
    3. If this is a photo of damage, describe the severity neutrally.
    
    Return ONLY a JSON object:
    {
      "doc_type": "string",
      "facts": {
        "total_amount_rm": number,
        "date": "string",
        "involved_parties": ["name1", "name2"]
      },
      "description": "2-sentence summary of the evidence"
    }
    """
    
    # Load the image/PDF
    with open(file_path, "rb") as f:
        image_data = f.read()
        
    response = client.models.generate_content(
        model="gemini-1.5-pro", # Use Pro for complex legal docs
        contents=[
            types.Part.from_bytes(data=image_data, mime_type="image/jpeg"), 
            prompt
        ]
    )
    
    return json.loads(response.text)
