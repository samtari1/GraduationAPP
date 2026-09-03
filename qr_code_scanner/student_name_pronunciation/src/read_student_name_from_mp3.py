import os
import subprocess
import serial

FILE_PATH = "../files/recordings/"

ser = serial.Serial('/dev/cu.usbmodemA_000001', 9600)  

studentID = None
previous_studentID = None

def read_mp3_file(studentID, file_path):

        FILE_NAME = studentID + ".mp3"
        full_path = os.path.join(file_path, FILE_NAME)
        #os.system(f'afplay "{file_path}/{FILE_NAME}"')
        try:
            # Use subprocess.run to play the audio file
             subprocess.run(
                 ["afplay", full_path],
                 check=True
             )
        
        except Exception as e:
            print(f"Error playing audio file: {e}")
            return  

#while loop to continuously read student IDs from the serial port and pronounce their names
while True:
    print("Waiting for scan...") #print("Waiting for scan...")
    #while loop to wait for the serial port to have data
    while ser.in_waiting == 0:
        pass

    
    #capture the data from the serial port and decode it to a string
    studentID = ser.read_until(b'\r').decode('utf-8').strip()
    #making sure if we get duplicate scans of the same student ID, we only pronounce the name once
    if studentID != previous_studentID:
        previous_studentID = studentID
        #read the mp3 file for the student ID and pronounce the name
        read_mp3_file(studentID, FILE_PATH)
        print("Student ID Scanned:", studentID)
    else:
        print("Duplicate scan detected. Ignoring.")
