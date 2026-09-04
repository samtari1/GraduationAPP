"""Google Cloud adapter, adapted from the coworker prototypes.

Clients are created only on explicit preparation requests, never at startup or scan time.
Credentials use Google's server-side Application Default Credentials mechanism.
"""
from fastapi import HTTPException


def get_client():
    try:
        from google.cloud import texttospeech
        from google.auth.exceptions import DefaultCredentialsError
    except ImportError:
        raise HTTPException(503, "Install requirements-integrations.txt to enable Google speech generation.")
    try:
        return texttospeech.TextToSpeechClient()
    except DefaultCredentialsError:
        raise HTTPException(503, "Google credentials are not configured. See README: Google Cloud setup.")


def provider_error(error):
    # Do not return raw SDK errors: they can contain account or request details.
    from google.api_core import exceptions
    if isinstance(error, exceptions.InvalidArgument):
        return HTTPException(422, "Google rejected these settings. Check language, voice, and speaking rate; some voices do not support speed changes.")
    if isinstance(error, (exceptions.PermissionDenied, exceptions.Unauthenticated)):
        return HTTPException(503, "Google authentication failed. Check credentials, project permissions, billing, and API enablement.")
    if isinstance(error, exceptions.ResourceExhausted):
        return HTTPException(429, "Google speech quota was exceeded. Try again later or review the project quota.")
    return HTTPException(502, "Google speech is unavailable. Check internet access and retry. Existing local audio is unchanged.")


def list_voices(language_code):
    client = get_client()
    from google.cloud import texttospeech
    try:
        response = client.list_voices(request={"language_code": language_code}, timeout=20, retry=None)
        return sorted([
            {"name": voice.name, "language_codes": list(voice.language_codes),
             "gender": texttospeech.SsmlVoiceGender(voice.ssml_gender).name}
            for voice in response.voices
            # Google currently returns some bare display-name aliases (for
            # example "Achernar") alongside synthesizable identifiers such as
            # "en-US-Chirp3-HD-Achernar". The bare aliases are rejected by
            # synthesize_speech, so never offer them in the selector.
            if any(voice.name.casefold().startswith(f"{code}-".casefold())
                   for code in voice.language_codes)
        ], key=lambda voice: voice["name"])
    except Exception as error:
        raise provider_error(error) from None
    finally:
        client.transport.close()


def synthesize(text, language_code, voice_name, speaking_rate):
    client = get_client()
    from google.cloud import texttospeech
    try:
        response = client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=text),
            voice=texttospeech.VoiceSelectionParams(language_code=language_code, name=voice_name),
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3, speaking_rate=speaking_rate),
            timeout=45, retry=None,
        )
        if not response.audio_content:
            raise HTTPException(502, "Google returned empty audio. No candidate was saved.")
        return response.audio_content
    except HTTPException:
        raise
    except Exception as error:
        raise provider_error(error) from None
    finally:
        client.transport.close()
