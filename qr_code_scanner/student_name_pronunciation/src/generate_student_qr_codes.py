#this program reads a csv file and returns a list of student names and their pronunciations
import csv
from google.cloud import texttospeech
import subprocess
import qrcode

# Create Google TTS client
client = texttospeech.TextToSpeechClient()

#constant variable for the file path to the csv file
FILE_PATH = '../files/student_roster.csv'

#function to process the student roster and pronounce the student name based on the student ID
def read_csv_file(file_path):
    student_names = []
    pronunciations = []
    
    #open the csv file and read the student names and pronunciations
    with open(file_path, mode='r', newline='', encoding='utf-8') as csvfile:
        reader = csv.reader(csvfile) #read the csv file
        next(reader)  # Skip the header row

        #loop over the rows in the csv file and find the student name and pronunciation based on the student ID
        for row in reader:
            generate_qr_code(row[0]) #generate a QR code for the student ID
    return   

#function to generate a QR code for the student ID
def generate_qr_code(studentID):
    qr = qrcode.QRCode(
        version=1,
        box_size=10,
        border=4
    )

    qr.add_data(studentID)
    qr.make(fit=True)

    image = qr.make_image()

    filename = "../files/qr_codes/" + studentID + ".png"
    image.save(filename)

    print("QR code saved as " + filename)

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

    filename = "recordings/" + studentID + ".mp3"

    with open(filename, "wb") as audio_file:
        audio_file.write(response.audio_content)

    subprocess.run(["afplay", filename])

#call the function to read the csv file and get the student name and pronunciation
read_csv_file(FILE_PATH)
