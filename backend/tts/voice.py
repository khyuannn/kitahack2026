import json
import os
from google.cloud import texttospeech
from google.oauth2 import service_account

VOICE_BY_ROLE = {
    "plaintiff": ("en-US-Neural2-D", texttospeech.SsmlVoiceGender.MALE),
    "defendant": ("en-US-Neural2-E", texttospeech.SsmlVoiceGender.FEMALE),
    "mediator":  ("en-US-Neural2-C", texttospeech.SsmlVoiceGender.FEMALE),
}


def _get_tts_client() -> texttospeech.TextToSpeechClient:
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if creds_json:
        creds_info = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        return texttospeech.TextToSpeechClient(credentials=creds)
    return texttospeech.TextToSpeechClient()  # Falls back to ADC


def get_voice_for_role(role: str) -> str:
    return VOICE_BY_ROLE.get((role or "").lower().strip(), VOICE_BY_ROLE["mediator"])[0]


def synthesize_audio_bytes(text: str, role: str) -> bytes:
    safe_text = (text or "").strip()
    if not safe_text:
        return b""
    role_key = (role or "").lower().strip()
    voice_name, gender = VOICE_BY_ROLE.get(role_key, VOICE_BY_ROLE["mediator"])
    try:
        client = _get_tts_client()
        response = client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=safe_text),
            voice=texttospeech.VoiceSelectionParams(
                language_code="en-US",
                name=voice_name,
                ssml_gender=gender,
            ),
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
            ),
        )
        return response.audio_content
    except Exception as e:
        print(f"[TTS] ERROR role={role!r} voice={voice_name!r}: {type(e).__name__}: {e}")
        raise
