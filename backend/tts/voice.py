# backend/tts/voice.py
import asyncio
from pathlib import Path
import os
import edge_tts

VOICE_BY_ROLE = {
    "plaintiff": "en-US-GuyNeural",
    "defendant": "en-US-JennyNeural",
    "mediator": "en-US-AriaNeural",
}


async def _generate_audio_async(text: str, role: str, output_filename: str):
    """Asynchronously generates audio using Microsoft Edge's free TTS service."""

    role_key = role.lower().strip()
    voice = VOICE_BY_ROLE.get(role_key, VOICE_BY_ROLE["mediator"])

    # The library handles the WebSocket connection securely without keys
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_filename)

def test_local_audio(text: str, role: str, output_filename: str):
    """Synchronous wrapper so you don't have to fight AsyncIO."""
    asyncio.run(_generate_audio_async(text, role, output_filename))
    print(f"[{role}] Audio saved to: {output_filename}")


def generate_role_voice_tests(output_dir: str = "backend/tts/samples", auto_open: bool = False):
    """Generate test clips for plaintiff, defendant, and mediator voices."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    samples = [
        (
            "plaintiff",
            "Your Honour, I request a fair return of my tenancy deposit based on the documented evidence.",
            out / "plaintiff_sample.mp3",
        ),
        (
            "defendant",
            "I acknowledge the claim, but deductions were made due to repair costs and unpaid utilities.",
            out / "defendant_sample.mp3",
        ),
        (
            "mediator",
            "Both parties, please focus on facts and propose a practical settlement amount to resolve this dispute.",
            out / "mediator_sample.mp3",
        ),
    ]

    for role, text, file_path in samples:
        test_local_audio(text, role, str(file_path))
        if auto_open and os.name == "nt":
            os.startfile(str(file_path))

    print("\nVoice test generation complete.")
    print(f"Output folder: {out.resolve()}")

if __name__ == "__main__":
    print("Generating role voice test clips...")
    generate_role_voice_tests(auto_open=True)