"""
For testing purposes only
Standalone test for orchestrator.py
Run this to test without running the full FastAPI server
"""
import os
import sys
from dotenv import load_dotenv

# Add parent directory to path so imports work
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

load_dotenv()
print(f"API key: {os.getenv('GEMINI_API_KEY')[:10]}...")
# Initialize Firebase manually
import firebase_admin
from firebase_admin import credentials, firestore

if not firebase_admin._apps:
    cred_path = os.getenv("FIREBASE_SERVICE_ACCOUNT")
    # Option 2: If not in .env, try relative to current file
    if not cred_path or not os.path.isfile(cred_path):
        # Get the directory where this script is located
        script_dir = os.path.dirname(os.path.abspath(__file__))
        cred_path = os.path.join(script_dir, "serviceAccountKey.json")
    
    # Debug output
    print(f"🔍 Looking for credentials at: {cred_path}")
    print(f"🔍 File exists: {os.path.isfile(cred_path)}")
    
    if cred_path and os.path.isfile(cred_path):
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
        print("✅ Firebase initialized")
    else:
        print("❌ Firebase credentials not found")
        print(f"❌ Tried path: {cred_path}")
        print(f"❌ Current working directory: {os.getcwd()}")
        sys.exit(1)

# Import and test orchestrator
from backend.core.orchestrator import run_negotiation_turn

#below is phase 1 testing:
# def test_orchestrator():
#     """Test the orchestrator with a real case."""
    
#     # Step 1: Create a test case in Firestore
#     db = firestore.client()
    
#     test_case_id = "test-case-001"
    
#     print(f"\n📝 Creating test case: {test_case_id}")
#     db.collection("cases").document(test_case_id).set({
#         "status": "created",
#         "title": "Test Tenancy Deposit Dispute",
#         "caseType": "tenancy_deposit",
#         "createdAt": firestore.SERVER_TIMESTAMP,
#         "createdBy": "test_user"
#     })
    
#     # Optional: Add test evidence
#     print("📎 Adding test evidence...")
#     db.collection("cases").document(test_case_id).collection("evidence").add({
#         "fileType": "text",
#         "storageUrl": "https://example.com/contract.pdf",
#         "extractedText": "Deposit amount: RM2500. Tenant moved in Jan 2024.",
#         "createdAt": firestore.SERVER_TIMESTAMP
#     })
    
#     # Step 2: Run the orchestrator
#     print(f"\n🚀 Running orchestrator for case: {test_case_id}")
#     run_dumb_loop(test_case_id, mode="mvp")
    
#     # Step 3: Check results
#     print("\n✅ Orchestrator completed! Checking results...")
#     case_data = db.collection("cases").document(test_case_id).get().to_dict()
#     print(f"Case status: {case_data.get('status')}")
    
#     # Get messages
#     messages = db.collection("cases").document(test_case_id).collection("messages").order_by("createdAt").stream()
    
#     print("\n💬 Messages generated:")
#     for i, msg in enumerate(messages, 1):
#         msg_data = msg.to_dict()
#         print(f"\n--- Message {i} ---")
#         print(f"Role: {msg_data.get('role')}")
#         print(f"Round: {msg_data.get('round')}")
#         print(f"Content: {msg_data.get('content')[:200]}...")
    
#     print("\n✅ Test completed successfully!")

# if __name__ == "__main__":
#     test_orchestrator()

#here is phase 2 testing

db = firestore.client()
test_case_id = "phase2-test-001"

db.collection("cases").document(test_case_id).set({
    "status": "created",
    "title": "Tenancy Deposit Dispute - Phase 2 Test",
    "caseType": "tenancy_deposit",
    "createdAt": firestore.SERVER_TIMESTAMP,
})

# Add test evidence
db.collection("cases").document(test_case_id).collection("evidence").add({
    "fileType": "text",
    "extractedText": "Deposit: RM2500. Move-in: Jan 2024. Tenant claims unfair deductions.",
    "createdAt": firestore.SERVER_TIMESTAMP,
})

print(f"✅ Test case created: {test_case_id}")
print("model: ", os.getenv("GEMINI_MODEL"))

# Run Turn 1
print("\n" + "="*60)
print("Testing Turn 1")
print("="*60)

result = run_negotiation_turn(
    case_id=test_case_id,
    user_message="I demand my full deposit back. The property was in perfect condition.",
    current_round=1,
    user_role="plaintiff",
    floor_price=2000,
)

print(f"\n✅ Turn 1 Complete:")
print(f"Game State: {result['game_state']}")
print(f"Auditor Passed: {result['auditor_passed']}")
print(f"Counter Offer: RM{result['counter_offer_rm']}")
print(f"Agent Message: {result['agent_message'][:200]}...")

if result['auditor_warning']:
    print(f"⚠️  Auditor Warning: {result['auditor_warning']}")