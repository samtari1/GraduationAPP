#voice 195,196 is pretty good!

from google.cloud import texttospeech
import subprocess

# Create Google TTS client
client = texttospeech.TextToSpeechClient()

# ---------------------------------------
# Get available English voices
# ---------------------------------------

voices_response = client.list_voices()

voices = []

for voice in voices_response.voices:

    # Only include English voices
    if any(code.startswith("en-") for code in voice.language_codes):
        voices.append(voice)


# ---------------------------------------
# Display voices
# ---------------------------------------

print("=" * 70)
print("              GOOGLE TEXT-TO-SPEECH VOICES")
print("=" * 70)

for number, voice in enumerate(voices):
    languages = ", ".join(voice.language_codes)

    gender = texttospeech.SsmlVoiceGender(
        voice.ssml_gender
    ).name

    print(f"{number}: {voice.name}")
    print(f"    Gender: {gender}")
    print(f"    Languages: {languages}")
    print()


# ---------------------------------------
# Select voice
# ---------------------------------------

while True:

    try:
        voice_number = int(
            input("Choose a voice number: ")
        )

        if 0 <= voice_number < len(voices):
            break

        print("Invalid voice number.")

    except ValueError:
        print("Please enter a number.")


selected_voice = voices[voice_number]

print()
print("Selected voice:", selected_voice.name)


# ---------------------------------------
# Get name
# ---------------------------------------

name = input("\nEnter a name to pronounce: ")


# ---------------------------------------
# Get speaking speed
# ---------------------------------------

print("\nSpeaking speed:")
print("0.50 = Very slow")
print("0.75 = Slow")
print("1.00 = Normal")
print("1.25 = Fast")
print("1.50 = Very fast")
print("2.00 = Maximum")

while True:

    try:
        speed = float(
            input("\nEnter speaking speed: ")
        )

        if 0.25 <= speed <= 2.0:
            break

        print("Please enter a value between 0.25 and 2.0.")

    except ValueError:
        print("Please enter a number.")


# ---------------------------------------
# Create speech
# ---------------------------------------

synthesis_input = texttospeech.SynthesisInput(
    text=name
)

voice = texttospeech.VoiceSelectionParams(
    language_code="en-US",
    name=selected_voice.name
)

audio_config = texttospeech.AudioConfig(
    audio_encoding=texttospeech.AudioEncoding.MP3,
    speaking_rate=speed
)


# ---------------------------------------
# Send request to Google
# ---------------------------------------

response = client.synthesize_speech(
    input=synthesis_input,
    voice=voice,
    audio_config=audio_config
)


# ---------------------------------------
# Save MP3
# ---------------------------------------

filename = "name.mp3"

with open(filename, "wb") as audio_file:
    audio_file.write(response.audio_content)


# ---------------------------------------
# Play on Mac
# ---------------------------------------

print("\nPlaying:", name)

subprocess.run(["afplay", filename])

print("\nDone!")