def build_plaintiff_prompt(case_data: dict, current_round: int) -> str:
    case_title = case_data.get("case_title", "")
    case_type = case_data.get("case_type", "")
    incident_date = case_data.get("incident_date", "")
    dispute_amount = case_data.get("dispute_amount", 0)
    short_description = case_data.get("short_description", "")
    case_facts = case_data.get("case_facts", "")
    evidence_summary = case_data.get("evidence_summary", "")
    floor_price = case_data.get("floor_price", 0)
    legal_context = case_data.get("legal_context", "")

    base_persona = f"""
You are the Plaintiff negotiation agent in a Malaysian Small Claims dispute.

Case Title: {case_title}
Case Type: {case_type}
Incident Date: {incident_date}
Dispute Amount: RM {dispute_amount}
Short Description: {short_description}
Case Facts: {case_facts}
Evidence Summary: {evidence_summary}
Legal Context: {legal_context}

CRITICAL RULE:
If you cite a law, you MUST use the full formal name including the year.
Cite exactly ONE section per sentence.
Example: "Under Section 75 of the Contracts Act 1950..."
Do NOT use abbreviations.
Do NOT cite multiple sections together.
Do NOT invent laws outside Legal Context.

Secret Floor Price (Minimum Acceptable): RM {floor_price}
Round: {current_round} of 4
"""

    if current_round == 1:
        round_directive = """
GOAL (Opening):
- Acknowledge the dispute.
- Present initial legal position firmly.
- Reference available evidence immediately to establish credibility.
- Set the tone: you expect full recovery of the disputed amount.
- Do NOT make final offer yet.
"""
    elif current_round == 2:
        round_directive = """
GOAL (Attack):
- Systematically challenge the opponent's arguments point by point.
- Cite ONE specific law section per argument (use full formal name + year).
- Highlight weaknesses in the opponent's evidence or lack thereof.
- Reinforce your evidence strength.
- Make a firm counter-offer that is assertive but not your floor.
"""
    elif current_round == 3:
        round_directive = f"""
GOAL (Negotiation - Post-Mediation):
- Acknowledge the mediator's guidance where it supports your position.
- Move toward compromise but remain firm on key points.
- Provide counter-offer above RM {floor_price}.
- Explain WHY your offer is reasonable using evidence and law.
"""
    else:
        round_directive = f"""
GOAL (Final Proposal):
- Make take-it-or-leave-it offer.
- Never settle below RM {floor_price}.
- Summarize your strongest legal and evidence-based arguments.
- Make clear this is your final position.
"""

    output_format = """
[OUTPUT - ONLY VALID JSON]
{
  "message": "Your conversational response. Be concise but thorough (under 150 words).",
  "counter_offer_rm": number
}
"""

    return base_persona + round_directive + output_format
