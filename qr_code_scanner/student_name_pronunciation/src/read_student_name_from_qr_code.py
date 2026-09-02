import serial
from google.cloud import texttospeech
import subprocess
import csv

FILE_PATH = '../files/student_roster.csv'

# Create Google TTS client
client = texttospeech.TextToSpeechClient()

ser = serial.Serial('/dev/cu.usbmodemA_000001', 9600)   


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


#function to pronounce the student name using Google TTS
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
       name= "en-US-Studio-O", #"en-US-Standard-J",  # or "en-US-Wavenet-C", "en-US-Standard-C"
       ssml_gender=texttospeech.SsmlVoiceGender.FEMALE,

    )
#
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate=1.1
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

#while loop to continuously read student IDs from the serial port and pronounce their names
while True:
    print("Waiting for scan...") #print("Waiting for scan...")
    #while loop to wait for the serial port to have data
    while ser.in_waiting == 0:
        pass

    #capture the data from the serial port and decode it to a string
    studentID = ser.read_until(b'\r').decode('utf-8').strip()
    read_csv_file(studentID, FILE_PATH)
    print("Student ID Scanned:", studentID)
