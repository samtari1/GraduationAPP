from google.cloud import texttospeech
import subprocess
import os

# ----------------------------------------
# Google Cloud TTS
# ----------------------------------------

client = texttospeech.TextToSpeechClient()


# ----------------------------------------
# Speak a pronunciation
# ----------------------------------------

def speak(pronunciation, speed=1.0):

    synthesis_input = texttospeech.SynthesisInput(
        text=pronunciation
    )

    voice = texttospeech.VoiceSelectionParams(
        language_code="en-US",
        name="en-US-Neural2-C"
    )

    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate=speed
    )

    response = client.synthesize_speech(
        input=synthesis_input,
        voice=voice,
        audio_config=audio_config
    )

    filename = "pronunciation.mp3"

    with open(filename, "wb") as audio_file:
        audio_file.write(response.audio_content)

    subprocess.run(["afplay", filename])


# ----------------------------------------
# Main program
# ----------------------------------------

print("=" * 55)
print("             NAME PRONUNCIATION")
print("=" * 55)

while True:

    print()

    name = input("Enter the person's name (Q to quit): ").strip()

    if name.lower() == "q":
        break

    pronunciation = input(
        "How should it sound? "
    ).strip()

    print()
    print("Name:", name)
    print("Pronunciation:", pronunciation)
    print()

    speak(pronunciation)

print()
print("Program ended.")