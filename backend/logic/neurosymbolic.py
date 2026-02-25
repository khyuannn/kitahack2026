from typing import Dict, Any, Optional


def _to_int_offer(value: Any) -> Optional[int]:
    if value is None:
        return None

    if isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        amount = int(value)
        return amount if amount >= 0 else None

    if isinstance(value, str):
        cleaned = value.replace(",", "").strip()
        if cleaned.isdigit():
            amount = int(cleaned)
            return amount if amount >= 0 else None

    return None


def evaluate_game_state(agent_output: Dict[str, Any], floor_price: int, current_round: int = 1, max_rounds: int = 4) -> Dict[str, Any]:
    """
    Evaluates offer state using structured model output, e.g.:
    {
      "message": "...",
      "counter_offer_rm": 1500
    }
    
    At the final round (current_round >= max_rounds), always report
    has_offer=True so the accept/reject UI is shown regardless of
    whether the offer meets the floor price.
    """
    offer = _to_int_offer(agent_output.get("counter_offer_rm"))

    if offer is None:
        # Even with no numeric offer at the final round, signal that
        # the negotiation must end so the decision screen appears.
        if current_round >= max_rounds:
            return {"has_offer": False, "offer_amount": None, "meets_floor": False, "final_round": True}
        return {"has_offer": False, "offer_amount": None, "meets_floor": False, "final_round": False}

    return {
        "has_offer": True,
        "offer_amount": offer,
        "meets_floor": offer >= floor_price,
        "final_round": current_round >= max_rounds,
    }


if __name__ == "__main__":
    test_outputs = [
        {"message": "Can settle at RM1500", "counter_offer_rm": 1500},
        {"message": "Final offer", "counter_offer_rm": "2,000"},
        {"message": "No offer now", "counter_offer_rm": None},
    ]

    print("--- NEUROSYMBOLIC STRUCTURED OFFER TEST ---")
    floor_price = 1000
    for output in test_outputs:
        result = evaluate_game_state(output, floor_price)
        print(f"Output: {output}")
        print(f"Result: {result}\n")