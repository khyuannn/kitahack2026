import requests
import time
import json
import sys

# ==========================================
# 🔧 CONFIGURATION
# ==========================================
BASE_URL = "http://localhost:8005/api" 

def run_test():
    print(f"🚀 STARTING INTEGRATION TEST against {BASE_URL}")
    print("========================================")

    # 1. START CASE (Mimics clicking "Start Case" on UI)
    print("\n🔹 [STEP 1] Starting Case...")
    try:
        res = requests.post(f"{BASE_URL}/cases/start", json={
            "title": "Test Dispute", 
            "caseType": "tenancy_deposit"
        })
        if res.status_code in [200, 201]:
            case_id = res.json().get("caseId")
            print(f"✅ API SUCCESS: Created Case ID: {case_id}")
            print(f"👉 OPEN THIS IN BROWSER: http://localhost:3000/negotiation/{case_id}")
        else:
            print(f"❌ API FAIL: {res.text}")
            return
    except Exception as e:
        print(f"❌ CONNECTION FAIL: Is the backend running? ({e})")
        return

    # 2. TRIGGER AI (Mimics the backend starting the loop)
    print("\n🔹 [STEP 2] Triggering AI Agent...")
    requests.post(f"{BASE_URL}/cases/{case_id}/run", json={"mode": "mvp"})
    print("✅ Signal sent to Agent.")

if __name__ == "__main__":
    run_test()