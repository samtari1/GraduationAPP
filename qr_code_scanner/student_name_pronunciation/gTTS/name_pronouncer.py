from gtts import gTTS
import os
import csv

DATABASE = "name_pronunciations.csv"


# -----------------------------------------
# Load saved names
# -----------------------------------------
def load_names():

    names = {}

    if os.path.exists(DATABASE):

        with open(DATABASE, "r", newline="", encoding="utf-8") as file:

            reader = csv.reader(file)

            for row in reader:

                if len(row) == 2:
                    names[row[0].lower()] = row[1]

    return names


# -----------------------------------------
# Save a new name
# -----------------------------------------
def save_name(name, pronunciation):

    with open(DATABASE, "a", newline="", encoding="utf-8") as file:

        writer = csv.writer(file)

        writer.writerow([name, pronunciation])


# -----------------------------------------
# Speak the pronunciation
# -----------------------------------------
def speak(text):

    tts = gTTS(text=text, lang="en")

    filename = "pronunciation.mp3"

    tts.save(filename)

    os.system(f"afplay '{filename}'")


# -----------------------------------------
# Main program
# -----------------------------------------

names = load_names()

print("=" * 50)
print("        STUDENT NAME PRONUNCIATION")
print("=" * 50)

while True:

    print()
    name = input("Enter a name (or Q to quit): ").strip()

    if name.lower() == "q":
        break

    # Check whether we already know the name
    if name.lower() in names:

        pronunciation = names[name.lower()]

        print(f"Saved pronunciation: {pronunciation}")

        answer = input("Use this pronunciation? (Y/N): ")

        if answer.lower() == "n":

            pronunciation = input(
                "Enter the correct pronunciation: "
            )

            save_name(name, pronunciation)

            names[name.lower()] = pronunciation

    else:

        print("I don't have a pronunciation for this name.")

        pronunciation = input(
            "Enter the pronunciation phonetically: "
        )

        save_name(name, pronunciation)

        names[name.lower()] = pronunciation

    print()
    print(f"Speaking: {name}")

    speak(pronunciation)

print()
print("Goodbye!")