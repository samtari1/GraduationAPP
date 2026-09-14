# GradVoice

An offline-first graduation pronunciation and stage-queue application for Sandhills Community College. The first release uses React, FastAPI, and SQLite so one ceremony laptop can run the entire system without internet access.

## Included in the MVP

- Student records with Unicode native names, language, phonetic guidance, and exact announcement text
- CSV import with update and validation reporting
- Local pronunciation audio upload and approval
- Multiple ceremonies and student rosters
- Scanner/card-reader input through the ceremony check-in screen
- Operator-controlled announcement queue with announce, replay, skip, and duplicate protection
- Readiness reporting, audit events, and local SQLite backups
- Responsive React interfaces for administration and stage operation
- Google Cloud TTS voice selection, language, speaking rate, and saved MP3 candidates
- Explicit selection of a reviewed pronunciation without overwriting older candidates
- Student QR images and printable ceremony cards, using opaque tokens
- Optional local serial-scanner bridge (CR, LF, and CRLF framing)

## Local setup

Requirements: Python 3.9+, Node.js 20+, npm, and FFmpeg for future audio normalization.

Run these commands from `Web_version`. If using the existing repository-root environment, use `source ../.venv/bin/activate` rather than creating a new one here.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd frontend && npm install && cd ..
python3 -m backend.app.seed
```

Run the backend and frontend in separate terminals:

```bash
uvicorn backend.app.main:app --reload
```

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). API documentation is available at [http://localhost:8000/docs](http://localhost:8000/docs).

### One-command launcher

After completing the initial setup once, start the complete platform from the repository root with:

```bash
./Web_version/start.sh
```

The launcher finds the project virtual environment, verifies the required tools, builds the React interface, and starts FastAPI at [http://127.0.0.1:8012](http://127.0.0.1:8012). Press Ctrl+C in the terminal to stop it. It does not generate sample data or contact Google automatically.

To use a different local port:

```bash
GRADVOICE_PORT=8000 ./Web_version/start.sh
```

## Production-style local build

```bash
cd frontend
npm run build
cd ..
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

FastAPI serves the compiled React application at [http://localhost:8000](http://localhost:8000). Audio and database files remain local under `storage/` and `data/`.

## CSV format

See `sample-data/students.csv`. Required columns are `student_id` and `display_name`; other recognized columns are `native_name`, `language`, `phonetic_spelling`, `program`, and `announcement_text`.

The coworker's `StudentID,FirstName,LastName` roster is also accepted, with an optional `Pronunciation` column. IDs retain leading zeros. Imports update matching IDs and mark existing pronunciations for review; do not import a roster during a live ceremony.

## Google Cloud setup

Install the optional integrations in the same Python environment as FastAPI:

```bash
pip install -r requirements-integrations.txt
```

Use a college-approved Google Cloud project with billing and the Cloud Text-to-Speech API enabled. Configure Application Default Credentials on the **backend computer**, not in React:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Alternatively, use an institution-provided credential setup via `GOOGLE_APPLICATION_CREDENTIALS`. Keep credential files outside the repository, frontend, audio directories, and any publicly served directory. Never paste credentials into the browser or commit them. This app does not read `.env` files automatically: export variables into the backend's shell when needed. See [Google's authentication instructions](https://docs.cloud.google.com/text-to-speech/docs/authentication).

In **Ceremonies → select a ceremony → Review → Google pronunciation studio**:

1. Save record changes first, then reopen Review.
2. Choose a language code (for example `en-US` or `vi-VN`) and click **Load Google voices**.
3. Select a voice, pronunciation text, and speaking rate. The native-name and phonetic buttons copy those saved fields into the speech text.
4. Click **Generate new candidate**. This explicitly sends the displayed text to Google and may incur charges. It does not send the entire student record.
5. Listen to the saved candidate and click **Use this pronunciation**. Generate again with different text, voice, or speed if necessary.

Each generation creates a separate local MP3 and records its voice, language, speed, input, and student pronunciation snapshot. Existing selected audio is unchanged until approval. Candidates generated before a pronunciation-field change cannot be approved: regenerate from the new details. Phonetic text is sent as plain text, not interpreted as IPA or SSML. Voice-conversion from a student recording is not implemented. Some Google voice families do not support all speed settings; try rate `1.0` or another voice when Google rejects a setting.

Google's SDK is loaded only when you request voices or generation. No Google account, credentials, or internet connection is needed for scan lookup or playback of previously saved audio. Live provider calls are not part of the automated tests.

## QR cards and scanners

Open a student's QR image from their review dialog under **Ceremonies**, or select **Open printable QR cards** for the ceremony. Print using the browser after all images load. QR content contains a random token, not the student's name or ID. The scanner endpoint also accepts existing ID-only cards generated by the coworker's scripts. A QR token is a check-in identifier, not a login credential.

**Keyboard-style USB scanner:** Focus the Stage control scan box and configure the scanner to send Enter after each scan. Without hardware, type a student ID and press Enter.

**Serial scanner:** The coworker's device communicates over a serial port at 9600 baud. Run this bridge on the same computer as FastAPI, with the ceremony ID displayed on Stage control:

```bash
python -m backend.scanner_bridge --list-ports
python -m backend.scanner_bridge --port /dev/cu.usbmodemA_000001 --baud 9600 --ceremony 1
```

Replace the sample port and ceremony ID with your actual values (`COM3` is an example Windows port). `--server http://127.0.0.1:8000` is the default; only loopback destinations are accepted. Press Ctrl+C to disconnect. The bridge uses timed reads, validates framing, and posts scans to the existing web queue; it does not play audio or generate speech. The stage screen refreshes from the local server every two seconds. Repeated scans leave an already-checked-in/queued student's timestamp and status unchanged. Unknown IDs and students from a different ceremony are rejected; announced students require deliberate operator action.

The source scripts in `../qr_code_scanner` were left unchanged. The web adapter replaces their interactive prompts, shared filenames, hardcoded serial port, busy-wait loop, and macOS-only `afplay` with API calls, versioned files, configurable serial settings, and browser audio. The unofficial `gTTS` and operating-system voice examples were not adopted; the integration uses the official Google Cloud SDK.

## Verification

```bash
pip install -r requirements.txt -r requirements-integrations.txt
npm --prefix frontend run build
python -m pytest backend/tests -q
```

Tests use temporary databases and mock Google responses; they do not spend credits or transmit real student records. Rehearse live voice quality, QR print scanning, speaker output, and the physical serial reader before ceremony use.

## Current boundary

This is still a trusted-local prototype: it does not yet include authentication, student login, institutional SSO, or signed ceremony-package synchronization. Keep it bound to `127.0.0.1`; do not expose it publicly or to an untrusted network. Access to the API currently permits student-data changes and Google generation charges. Use one stage operator; cross-device playback locking and full ceremony recovery are not implemented. Audio normalization and student reference recording/voice conversion remain future work.
