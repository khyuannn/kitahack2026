import google.generativeai as genai

# M1 Role: Defining how the AI 'sees' legal evidence
def analyze_legal_evidence(file_path):
    model = genai.GenerativeModel('gemini-1.5-pro')
    
    # This prompt turns an image into "Legal Facts"
    prompt = """
    You are a Legal Evidence Analyzer. Look at this image/PDF and:
    1. Determine if it is a Receipt, Contract, or Photo of Damage.
    2. Extract the 'Hard Facts': Dates, RM Amounts, Names.
    3. Evaluate Credibility: Is the document clear or blurry?
    Return ONLY a JSON object:
    {"type": "...", "facts": {"amount": 0, "date": "..."}, "summary": "..."}
    """
    
    # Logic to process the file (M3 will call this function)
    response = model.generate_content([prompt, file_path])
    return response.text