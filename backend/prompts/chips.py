def generate_chips_prompt(conversation_history: str, case_context: dict) -> str:
    # M1 Architecture: This prompt analyzes the heat of the battle 
    # and gives the user 3 specific 'weapons' (chips) to choose from.
    
    return f"""
You are the Lex-Machina Strategy Engine. 
Review the conversation history and the legal context for this Malaysian dispute.

Current Case: {case_context.get('case_title')}
History: {conversation_history}

[TASK]
Generate 1 central question and 3 concise "Action Chips" (options) for the user.
- Option 1 (Aggressive): Push for evidence or deny claims.
- Option 2 (Compromise): Suggest a middle-ground RM amount.
- Option 3 (Legal): Use a specific section from the Contracts Act 1950.

[OUTPUT - ONLY VALID JSON]
{{
  "question": "The opponent is being stubborn about the cleaning fee. What is your next move?",
  "options": [
    {{ "label": "Demand Repair Receipts", "strategy_id": "demand_proof" }},
    {{ "label": "Offer RM100 Discount", "strategy_id": "concede_small" }},
    {{ "label": "Cite 'Fair Wear & Tear'", "strategy_id": "cite_legal" }}
  ]
}}
"""