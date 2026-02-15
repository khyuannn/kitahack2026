"""
List all available Gemini models for your API key
"""
import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

print("Fetching available models...\n")

try:
    models = client.models.list()
    
    print("Available models:")
    print("="*60)
    
    for model in models:
        print(f"✅ {model.name}")
        if hasattr(model, 'display_name'):
            print(f"   Display Name: {model.display_name}")
        if hasattr(model, 'description'):
            print(f"   Description: {model.description[:100]}...")
        print()
    
except Exception as e:
    print(f"❌ Error listing models: {e}")