import os
import re
from typing import Any, Dict, List

from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from pinecone import Pinecone

load_dotenv()

INDEX_NAME = "lex-machina-index"
EMBEDDING_MODEL = "models/gemini-embedding-001"
MIN_SCORE = 0.23

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

if GEMINI_API_KEY:
    os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY

# Module-level singletons — initialized once on first use
_auditor_index = None
_auditor_embeddings = None

def _get_auditor_clients():
    global _auditor_index, _auditor_embeddings
    if _auditor_index is None:
        pc = Pinecone(api_key=PINECONE_API_KEY)
        _auditor_index = pc.Index(INDEX_NAME)
    if _auditor_embeddings is None:
        _auditor_embeddings = GoogleGenerativeAIEmbeddings(
            model=EMBEDDING_MODEL,
            google_api_key=GEMINI_API_KEY,
        )
    return _auditor_index, _auditor_embeddings


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _canonical_law_title(raw_law: str) -> str:
    cleaned = re.sub(r"\s+", " ", raw_law).strip(" .,;:\n\t")
    cleaned = re.sub(r"(?i)^(under|pursuant to|according to|based on)\s+", "", cleaned).strip()
    cleaned = re.sub(r"(?i)\bthe\b\s+", "", cleaned).strip()
    return cleaned


def extract_citations_with_regex(agent_text: str) -> List[Dict[str, str]]:
    """
    Extract legal citations from free text.
    Supported examples:
    - Limitation Act 1953 section 10
    - section 15 of Sale of Goods Act 1957
    - Order 93 rule 6
    """
    citations: List[Dict[str, str]] = []
    seen = set()

    act_then_section = re.finditer(
        r"(?P<law>[A-Z][A-Za-z\-\s()]+?\s+Act\s+\d{4})\s*(?:,|\(|\))?\s*\b(?:section|sec\.?|s\.?)\b\s*(?P<section>\d[A-Za-z0-9()\-]*)",
        agent_text,
        flags=re.IGNORECASE,
    )
    for match in act_then_section:
        law = _canonical_law_title(match.group("law"))
        section = match.group("section").strip()
        key = (law.lower(), section.lower(), "act")
        if key in seen:
            continue
        seen.add(key)
        citations.append(
            {
                "raw": match.group(0).strip(),
                "type": "act_section",
                "law": law,
                "section": section,
            }
        )

    section_of_act = re.finditer(
        r"\b(?:section|sec\.?|s\.?)\b\s*(?P<section>\d[A-Za-z0-9()\-]*)\s+of\s+(?P<law>[A-Z][A-Za-z\-\s()]+?\s+Act\s+\d{4})",
        agent_text,
        flags=re.IGNORECASE,
    )
    for match in section_of_act:
        law = _canonical_law_title(match.group("law"))
        section = match.group("section").strip()
        key = (law.lower(), section.lower(), "act")
        if key in seen:
            continue
        seen.add(key)
        citations.append(
            {
                "raw": match.group(0).strip(),
                "type": "act_section",
                "law": law,
                "section": section,
            }
        )

    order_rule = re.finditer(
        r"\border\s+(?P<order>\d+)\s*(?:,\s*)?(?:rule|r\.?)\s*(?P<rule>\d[A-Za-z0-9()\-]*)",
        agent_text,
        flags=re.IGNORECASE,
    )
    for match in order_rule:
        order_num = match.group("order").strip()
        rule_num = match.group("rule").strip()
        key = (order_num, rule_num, "order")
        if key in seen:
            continue
        seen.add(key)
        citations.append(
            {
                "raw": match.group(0).strip(),
                "type": "order_rule",
                "law": f"Order {order_num}",
                "section": rule_num,
            }
        )

    return citations


def _build_search_query(citation: Dict[str, str]) -> str:
    if citation["type"] == "order_rule":
        return f"Rules of Court {citation['law']} rule {citation['section']}"
    return f"{citation['law']} section {citation['section']}"


def _match_citation_against_record(citation: Dict[str, str], match: Dict[str, Any]) -> bool:
    score = float(match.get("score", 0.0))
    if score < MIN_SCORE:
        return False

    metadata = match.get("metadata", {})
    source = _normalize(str(metadata.get("source", "")))
    section = _normalize(str(metadata.get("section", "")))
    text = _normalize(str(metadata.get("text", "")))

    citation_law = _normalize(citation["law"])
    citation_section = _normalize(citation["section"])

    if citation["type"] == "order_rule":
        if "order 93" in source and section == citation_section:
            return True
        return "order 93" in text and (f"rule {citation_section}" in text or f"r. {citation_section}" in text)

    source_match = citation_law in source
    section_match = section == citation_section

    text_law_match = citation_law in text
    text_sec_match = (
        f"section {citation_section}" in text
        or f"sec {citation_section}" in text
        or f"s.{citation_section}" in text
        or f"s {citation_section}" in text
    )

    return (source_match and section_match) or (text_law_match and text_sec_match)


def check_rag_for_law(citation: Dict[str, str]) -> bool:
    """
    Validate one citation against Pinecone records.
    Returns True only when the matched record confirms both law/order and section/rule.
    """
    if not PINECONE_API_KEY or not GEMINI_API_KEY:
        return False

    try:
        index, embeddings = _get_auditor_clients()
        query_text = _build_search_query(citation)
        query_vector = embeddings.embed_query(query_text)
        if len(query_vector) > 768:
            query_vector = query_vector[:768]

        results = index.query(
            vector=query_vector,
            top_k=5,
            include_metadata=True,
        )

        matches = results.get("matches", [])
        return any(_match_citation_against_record(citation, match) for match in matches)
    except Exception:
        return False


def validate_turn(agent_text: str) -> Dict[str, Any]:
    """
    M3 should call this function.
    Output contract kept compatible with existing flow.
    """
    citations_found = extract_citations_with_regex(agent_text)

    if not citations_found:
        return {
            "is_valid": True,
            "flagged_law": None,
            "citations_found": [],
        }

    for citation in citations_found:
        if not check_rag_for_law(citation):
            raw = citation.get("raw") or f"{citation['law']} s.{citation['section']}"
            return {
                "is_valid": False,
                "flagged_law": raw,
                "citations_found": citations_found,
                "auditor_warning": f"Auditor Intercept: '{raw}' is not found in Small Claims database.",
            }

    return {
        "is_valid": True,
        "flagged_law": None,
        "citations_found": citations_found,
    }


if __name__ == "__main__":
    print("=" * 60)
    print("AUDITOR SELF-TEST")
    print("=" * 60)

    sample_turns = [
        "Under Limitation Act 1953 section 10, the claim may be time-barred.",
        "Based on section 15 of Sale of Goods Act 1957, this is sale by description.",
        "Order 93 rule 6 says defendant may file defence in Form 199.",
        "Section 999 of Fake Act 2099 clearly applies.",
    ]

    for idx, text in enumerate(sample_turns, 1):
        print(f"\n[TEST {idx}] {text}")
        extracted = extract_citations_with_regex(text)
        print(f"Extracted: {extracted}")

        result = validate_turn(text)
        print(f"Validation: {result}")

    print("\nTip: ensure PINECONE_API_KEY and GEMINI_API_KEY are set for live DB validation.")