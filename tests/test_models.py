"""
Test Phase 2 API models
"""
from backend.app.api_models import (
    TurnRequest,
    TurnResponse,
    ValidateEvidenceResponse,
    ChipOptions,
    ChipOption,
    Settlement,
    Citation
)

def test_turn_request():
    """Test turn request with evidence URIs."""
    request = TurnRequest(
        caseId="test-123",
        user_message="I have new evidence",
        current_round=2,
        evidence_uris=["https://generativelanguage.googleapis.com/v1beta/files/abc"],
        floor_price=1500
    )
    print("✅ TurnRequest:", request.dict())


def test_turn_response():
    """Test turn response with all Phase 2 fields."""
    response = TurnResponse(
        agent_message="I reject your claim",
        audio_url="https://storage.googleapis.com/bucket/audio.mp3",
        auditor_passed=False,
        auditor_warning="Citation mismatch detected",
        chips={
            "question": "What's your response?",
            "options": [
                {"label": "Demand proof"},
                {"label": "Counter with evidence"}
            ]
        },
        game_state="active",
        counter_offer_rm=1200
    )
    print("✅ TurnResponse:", response.dict())


def test_settlement():
    """Test settlement model."""
    settlement = Settlement(
        summary="Agreed to split deposit 50/50",
        recommended_settlement_rm=1250.00,
        confidence=0.85,
        citations=[
            Citation(
                law="Contracts Act 1950",
                section="75",
                excerpt="Compensation for breach..."
            )
        ],
        final_round=3,
        plaintiff_final_offer=1500,
        defendant_final_offer=1000
    )
    print("✅ Settlement:", settlement.dict())


if __name__ == "__main__":
    test_turn_request()
    test_turn_response()
    test_settlement()
    print("\n🎉 All Phase 2 models validated!")