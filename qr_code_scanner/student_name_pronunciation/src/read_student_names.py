#this program reads a csv file and returns a list of student names and their pronunciations
import csv
from google.cloud import texttospeech
import subprocess

# Create Google TTS client
client = texttospeech.TextToSpeechClient()

#constant variable for the file path to the csv file
FILE_PATH = '../files/student_roster.csv'

#function to process the student roster and pronounce the student name based on the student ID
def read_csv_file(studentID,file_path):
    student_names = []
    pronunciations = []
    
    #open the csv file and read the student names and pronunciations
    with open(file_path, mode='r', newline='', encoding='utf-8') as csvfile:
        reader = csv.reader(csvfile)
        next(reader)  # Skip the header row
        for row in reader:
            if(row[0] == studentID):
                print("pronounce studnet name: ", row[1] + " " + row[2])
                if(len(row) > 3):
                    pronounce_student_name(row[3])
                else:
                    pronounce_student_name(row[1] + " " + row[2])
                break
    
    return   


def pronounce_student_name(student_name):
    voices = []
    voices_response = client.list_voices()

    #only use English voices
    for voice in voices_response.voices:
        # Only include English voices
        if any(code.startswith("en-") for code in voice.language_codes):
          voices.append(voice)

    # Set the text input to be synthesized
    synthesis_input = texttospeech.SynthesisInput(
        text=student_name
    )

    selected_voice = voices[0]

    # Build the voice request, select the language code ("en-US") and the voice name
    #voice = texttospeech.VoiceSelectionParams(
    #    language_code="en-US",
    #    name=voices[200].name
    #)

    voice = texttospeech.VoiceSelectionParams(
       language_code="en-US",
       name="en-US-Standard-J",  # or "en-US-Wavenet-C", "en-US-Standard-C"
       #ssml_gender=texttospeech.SsmlVoiceGender.FEMALE,

    )
#
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate=1.0
    )   
#   
    response = client.synthesize_speech(
        input=synthesis_input,
        voice=voice,
        audio_config=audio_config
    )   

    filename = "../files/recordings/" + studentID + ".mp3"

    with open(filename, "wb") as audio_file:
        audio_file.write(response.audio_content)

    subprocess.run(["afplay", filename])

#this will ultimately use a IR scanner to get the student ID, but for now we will just use input
studentID = input("Enter student ID: ")
#call the function to read the csv file and get the student name and pronunciation
student_info = read_csv_file(studentID, FILE_PATH)
