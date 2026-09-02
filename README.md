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

## Local setup

Requirements: Python 3.9+, Node.js 20+, npm, and FFmpeg for future audio normalization.

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

## Production-style local build

```bash
cd frontend
npm run build
cd ..
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

FastAPI serves the compiled React application at [http://localhost:8000](http://localhost:8000). Audio and database files remain local under `storage/` and `data/`.

## CSV format

See `sample-data/students.csv`. Required columns are `student_id` and `display_name`; other recognized columns are `native_name`, `language`, `phonetic_spelling`, `program`, and `announcement_text`.

## Current boundary

This MVP intentionally does not yet include student login, institutional SSO, AI text-to-speech generation, QR-code printing, or signed ceremony-package synchronization. The provider-independent audio workflow and approval data are in place for those additions.
