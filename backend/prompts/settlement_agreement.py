SETTLEMENT_AGREEMENT_PROMPT = """
You are Lex-Machina's Legal Document Generator.

The negotiation has CONCLUDED with a settlement agreement.
Generate a formal settlement agreement in HTML format suitable for PDF printing.

[CASE DATA]
Case Title: {case_title}
Case Type: {case_type}
Plaintiff: {plaintiff_name}
Defendant: {defendant_name}
Original Claim Amount: RM {claim_amount}
Settlement Amount: RM {settlement_amount}

[NEGOTIATION SUMMARY]
{negotiation_summary}

[MESSAGES HISTORY]
{messages_history}

[TASK]
Generate a complete, formal settlement agreement in HTML with the following sections:

1. **Title**: "SETTLEMENT AGREEMENT" centered, formal
2. **Preamble**: Date, between [Plaintiff Name / IC: ___________] ("the Claimant") and [Defendant Name / IC: ___________] ("the Respondent")
3. **Recitals / WHEREAS clauses**: Background of the dispute based on the case data
4. **Payment Terms**:
   - Settlement amount: RM {settlement_amount}
   - Payment method: Bank transfer / cash (to be agreed)
   - Payment deadline: Within 14 days from execution
   - "Time is of the essence" clause
5. **Full & Final Settlement clause**: "This settlement constitutes full and final settlement of all claims..."
6. **Form 206 Bridge clause**: "In the event of non-compliance with the terms herein, the Claimant shall be entitled to enter Consent Judgment pursuant to Form 206 of the Subordinate Courts Rules 1980."
7. **Breakdown**:
   - Original claim: RM {claim_amount}
   - Settlement amount: RM {settlement_amount}
   - Brief description of what is being compensated
8. **Confidentiality clause**: Standard non-disclosure of terms
9. **Digital Signature blocks**:
   - Claimant signature line with name, date, timestamp placeholder
   - Respondent signature line with name, date, timestamp placeholder
   - Note: "Signed electronically pursuant to the Electronic Commerce Act 2006"
   - IP address placeholder: [IP Address]

[STYLE REQUIREMENTS]
- Use clean, professional HTML with inline CSS
- A4-proportioned layout (max-width: 210mm)
- Serif font (Georgia or Times New Roman)
- Proper margins, line-height 1.6
- Section numbers (1, 2, 3...)
- Bold headings, normal body text
- No markdown, only pure HTML
- The HTML should be self-contained (no external stylesheets)

[OUTPUT]
Output ONLY the raw HTML string. No markdown fencing. No extra text outside the HTML.
Start with <!DOCTYPE html> or <html> and end with </html>.
"""

DEADLOCK_COURT_FILING_HTML_PROMPT = """
You are Lex-Machina's Legal Document Generator.

The negotiation has ended in DEADLOCK. Generate a Form 206-style court filing document in HTML.

[CASE DATA]
Case Title: {case_title}
Case Type: {case_type}
Plaintiff: {plaintiff_name}
Defendant: {defendant_name}
Claim Amount: RM {claim_amount}
Final Plaintiff Offer: RM {plaintiff_final_offer}
Final Defendant Offer: RM {defendant_final_offer}

[NEGOTIATION SUMMARY]
{negotiation_summary}

[MESSAGES HISTORY]
{messages_history}

[LEGAL CONTEXT]
{legal_context}

[TASK]
Generate a formal court filing document (styled after Malaysian Small Claims Form 206) in HTML:

1. **Court Header**: "DALAM MAHKAMAH MAJISTRET DI ________" / "IN THE MAGISTRATE'S COURT AT ________"
2. **Case Number**: "[Case No: ___________]"
3. **Parties**: Claimant vs Respondent with placeholder IC numbers
4. **Statement of Claim**: Formal paragraph summarizing the dispute
5. **Negotiation History Summary**: Brief account of failed negotiation
6. **Amount Claimed**: RM {claim_amount}
7. **Final Offers**: Both parties' last offers
8. **Prayer/Relief**: What the plaintiff is asking the court for
9. **Declaration**: "I declare that the above is true..."
10. **Signature block** with date placeholder
11. **Disclaimer**: "This is an AI-generated draft for reference only. It is NOT legal advice and has NOT been filed with any court."

[STYLE REQUIREMENTS]
- Clean, professional HTML with inline CSS
- A4-proportioned layout
- Serif font
- Court document styling (centered headers, indented paragraphs)
- No markdown, only pure HTML

[OUTPUT]
Output ONLY the raw HTML string. Start with <html> and end with </html>.
"""
