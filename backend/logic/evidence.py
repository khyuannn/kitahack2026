import os
import mimetypes
import tempfile
import requests
from google import genai
from typing import Dict, Any

MAX_FILE_SIZE_MB = 5
MAX_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
ALLOWED_EXACT_MIME_TYPES = {
    "application/pdf",
    "text/plain",
    "text/markdown",
}
_FILE_URI_CACHE: dict[str, str] = {}


def _normalize_mime_type(content_type: str) -> str:
    return content_type.split(";")[0].strip().lower()


def _guess_mime_type_from_url(file_url: str) -> str:
    guessed, _ = mimetypes.guess_type(file_url)
    return (guessed or "application/octet-stream").lower()


def _is_supported_mime_type(mime_type: str) -> bool:
    return mime_type.startswith("image/") or mime_type in ALLOWED_EXACT_MIME_TYPES


def _download_file_with_limit(file_url: str) -> tuple[bytes, str]:
    response = requests.get(file_url, stream=True, timeout=20)
    response.raise_for_status()

    mime_type = _normalize_mime_type(response.headers.get("Content-Type", ""))
    if not mime_type or mime_type == "application/octet-stream":
        mime_type = _guess_mime_type_from_url(file_url)

    if not _is_supported_mime_type(mime_type):
        raise ValueError("Evidence rejected: Only TXT, MD, PDF, and image files are supported.")

    content_length = response.headers.get("Content-Length")
    if content_length:
        try:
            if int(content_length) > MAX_BYTES:
                raise ValueError(f"Evidence rejected: File exceeds the {MAX_FILE_SIZE_MB}MB limit.")
        except ValueError:
            if content_length.isdigit() and int(content_length) > MAX_BYTES:
                raise ValueError(f"Evidence rejected: File exceeds the {MAX_FILE_SIZE_MB}MB limit.")

    chunks = bytearray()
    for chunk in response.iter_content(chunk_size=8192):
        if not chunk:
            continue
        chunks.extend(chunk)
        if len(chunks) > MAX_BYTES:
            raise ValueError(f"Evidence rejected: File exceeds the {MAX_FILE_SIZE_MB}MB limit.")

    return bytes(chunks), mime_type


def _upload_to_gemini_file_api(client: genai.Client, file_url: str, file_bytes: bytes, mime_type: str) -> str:
    cached_uri = _FILE_URI_CACHE.get(file_url)
    if cached_uri:
        return cached_uri

    suffix = mimetypes.guess_extension(mime_type) or ""
    temp_file_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(file_bytes)
            temp_file_path = temp_file.name

        uploaded = client.files.upload(file=temp_file_path, config={"mime_type": mime_type})
        file_uri = uploaded.uri
        _FILE_URI_CACHE[file_url] = file_uri
        return file_uri
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)

def validate_evidence(file_url: str, user_claim: str) -> Dict[str, Any]:
    """
    Validates file safety/type constraints and uploads to Gemini File API once.
    Returns URI-first metadata for downstream orchestrator usage.
    """
    _ = user_claim

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return {
            "is_relevant": False,
            "confidence_score": 0.0,
            "file_uri": None,
            "mime_type": None,
            "error": "System configuration error: Missing GEMINI_API_KEY/GOOGLE_API_KEY."
        }

    try:
        file_bytes, mime_type = _download_file_with_limit(file_url)
    except ValueError as e:
        return {
            "is_relevant": False,
            "confidence_score": 0.0,
            "file_uri": None,
            "mime_type": None,
            "error": str(e)
        }
    except Exception as e:
        return {
            "is_relevant": False,
            "confidence_score": 0.0,
            "file_uri": None,
            "mime_type": None,
            "error": f"System failed to load the file URL: {str(e)}"
        }

    client = genai.Client(api_key=api_key)

    try:
        file_uri = _upload_to_gemini_file_api(client, file_url, file_bytes, mime_type)
        return {
            "is_relevant": True,
            "confidence_score": 1.0,
            "file_uri": file_uri,
            "mime_type": mime_type,
            "error": None,
        }
    except Exception:
        return {
            "is_relevant": False,
            "confidence_score": 0.0,
            "file_uri": None,
            "mime_type": mime_type,
            "error": "Evidence upload failed when creating Gemini File API URI."
        }