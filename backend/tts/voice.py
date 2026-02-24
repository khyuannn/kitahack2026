import asyncio
import os
from pathlib import Path

import edge_tts

VOICE_BY_ROLE = {
    "plaintiff": "en-US-GuyNeural",
    "defendant": "en-US-JennyNeural",
    "mediator": "en-US-AriaNeural",
}


def get_voice_for_role(role: str) -> str:
    role_key = (role or "").lower().strip()
    return VOICE_BY_ROLE.get(role_key, VOICE_BY_ROLE["mediator"])


async def synthesize_audio_bytes_async(text: str, role: str) -> bytes:
    safe_text = (text or "").strip()
    if not safe_text:
        return b""

    communicate = edge_tts.Communicate(safe_text, get_voice_for_role(role))
    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            chunks.append(chunk["data"])
    return b"".join(chunks)


def synthesize_audio_bytes(text: str, role: str) -> bytes:
    import sys
    if sys.platform == "win32":
        loop = asyncio.SelectorEventLoop()
    else:
        loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(synthesize_audio_bytes_async(text, role))
    finally:
        loop.close()
        asyncio.set_event_loop(None)


async def _generate_audio_async(text: str, role: str, output_filename: str):
    audio = await synthesize_audio_bytes_async(text, role)
    with open(output_filename, "wb") as output_file:
        output_file.write(audio)


def test_local_audio(text: str, role: str, output_filename: str):
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