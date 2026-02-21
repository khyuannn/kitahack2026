def generate_chips_prompt(conversation_history: str, case_context: dict) -> str:
    # M1 Architecture: This prompt analyzes the heat of the battle 
    # and gives the user 3 specific 'weapons' (chips) to choose from.
    # Now round-aware for more contextual chip generation.
    
    current_round = case_context.get('current_round', 1)
    counter_offer = case_context.get('counter_offer')
    
    # Round-specific chip guidance
    if current_round == 1:
        round_guidance = """Round 1 (Opening): Generate opening strategy chips.
- Option 1 (Evidence): Lead with presenting evidence or demanding proof.
- Option 2 (Legal Opening): Start with a strong legal position citing a specific Act.
- Option 3 (Diplomatic): Open with a reasonable tone to set cooperative negotiation."""
    elif current_round == 2:
        round_guidance = """Round 2 (Attack/Counter): Generate attack strategy chips.
- Option 1 (Aggressive): Challenge opponent's claims or demand evidence.
- Option 2 (Compromise): Offer a specific RM concession to show good faith.
- Option 3 (Legal): Cite a specific section from Malaysian law to counter the opponent."""
    elif current_round == 3:
        round_guidance = f"""Round 3 (Post-Mediator Negotiation): Generate negotiation chips that respond to the mediator's guidance.
- Option 1 (Hold Firm): Maintain position and push for better terms.
- Option 2 (Compromise): Accept mediator's recommendation or offer adjusted amount.
- Option 3 (Legal Pressure): Cite a final legal argument to strengthen negotiation position.
NOTE: The opponent's last counter-offer was RM {counter_offer}. Factor this into the options."""
    else:
        round_guidance = f"""Round 4 (Final Round): Generate final-round strategy chips.
- Option 1 (Final Demand): Make a take-it-or-leave-it offer with legal backing.
- Option 2 (Accept Counter): Consider accepting the opponent's offer of RM {counter_offer}.
- Option 3 (Walk Away): Reject and prepare for court/formal dispute resolution."""
    
    return f"""
You are the Lex-Machina Strategy Engine. 
Review the conversation history and the legal context for this Malaysian dispute.

Current Case: {case_context.get('case_title')}
Current Round: {current_round} of 4
History: {conversation_history}

[TASK]
Generate 1 central question and 3 concise "Action Chips" (options) for the user.
{round_guidance}

Each chip label should be SHORT (2-6 words), specific to the current situation, and actionable.
The question should reflect the current state of negotiation and the opponent's latest move.

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