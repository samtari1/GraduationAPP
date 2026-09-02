from google.cloud import texttospeech
import subprocess

# Create the Google TTS client
client = texttospeech.TextToSpeechClient()

# Ask for the name
name = input("Enter a name to pronounce: ")

# Ask for speaking speed
speed = 1.0 #float(input("Speaking speed (0.25 - 2.0, 1.0 = normal): "))

# Create the text input
synthesis_input = texttospeech.SynthesisInput(text=name)

# Select the voice
voice = texttospeech.VoiceSelectionParams(
    language_code="en-US",
    ssml_gender=texttospeech.SsmlVoiceGender.FEMALE
)

# Configure the audio
audio_config = texttospeech.AudioConfig(
    audio_encoding=texttospeech.AudioEncoding.MP3,
    speaking_rate=speed
)

# Generate speech
response = client.synthesize_speech(
    input=synthesis_input,
    voice=voice,
    audio_config=audio_config
)

# Save the audio
filename = "name.mp3"

with open(filename, "wb") as out:
    out.write(response.audio_content)

print("Playing:", name)

# Play the MP3 on your Mac
subprocess.run(["afplay", filename])