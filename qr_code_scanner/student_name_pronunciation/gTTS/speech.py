from gtts import gTTS
import os

name = input("Enter a name: ")

tts = gTTS(text=name, lang="en")

tts.save("name.mp3")

os.system("afplay name.mp3")