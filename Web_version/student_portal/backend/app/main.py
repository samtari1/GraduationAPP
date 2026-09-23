from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import uuid
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import AUDIO_DIR, Base, engine, get_db
from .models import PortalAudioCandidate, PortalStudent, PronunciationSubmission, utcnow
from .package_io import read_package
from .schemas import ReviewRequest, SpeechRequest, StudentProfileUpdate, TTSRequest
from . import google_speech


Base.metadata.create_all(bind=engine)
app = FastAPI(title="GradVoice Student Portal", version="0.1.0")
PORTAL_ENV = os.getenv("PORTAL_ENV", "development")
STAFF_TOKEN = os.getenv("PORTAL_STAFF_TOKEN") or ("dev-staff-token" if PORTAL_ENV == "development" else None)
ALLOWED_AUDIO = {".mp3", ".wav", ".m4a", ".ogg", ".webm"}


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def require_staff(x_portal_staff_token: Optional[str] = Header(default=None)):
    if not STAFF_TOKEN:
        raise HTTPException(503, "PORTAL_STAFF_TOKEN is not configured")
    if not x_portal_staff_token or not hmac.compare_digest(x_portal_staff_token, STAFF_TOKEN):
        raise HTTPException(401, "Staff authentication is required")


def current_student(authorization: Optional[str], db: Session) -> PortalStudent:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Student authentication is required")
    student = db.scalar(select(PortalStudent).where(PortalStudent.invitation_token_hash == token_hash(authorization[7:])))
    if not student:
        raise HTTPException(401, "Invalid student invitation token")
    return student


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "student-portal", "authentication": "development-token"}


@app.post("/api/staff/rosters/import")
async def import_roster(
    file: UploadFile = File(...),
    _: None = Depends(require_staff),
    db: Session = Depends(get_db),
):
    try:
        manifest, profiles, contents = read_package(await file.read())
    except (ValueError, KeyError, TypeError, UnicodeDecodeError) as error:
        raise HTTPException(400, str(error)) from error
    invites = []
    imported = 0
    for student_id, profile in profiles.items():
        student = db.scalar(select(PortalStudent).where(PortalStudent.student_id == student_id))
        invitation = secrets.token_urlsafe(32)
        if not student:
            student = PortalStudent(student_id=student_id, invitation_token_hash=token_hash(invitation))
            db.add(student)
        else:
            student.invitation_token_hash = token_hash(invitation)
        for key in ("display_name", "native_name", "language", "phonetic_spelling", "program", "announcement_text"):
            if key in profile:
                setattr(student, key, profile[key])
        audio = profile.get("audio") or {}
        audio_path = audio.get("path")
        if audio_path and audio_path in contents:
            suffix = Path(audio_path).suffix.lower()
            if suffix not in ALLOWED_AUDIO:
                raise HTTPException(400, f"Unsupported audio format for {student_id}")
            filename = f"baseline-{uuid.uuid4().hex}{suffix}"
            (AUDIO_DIR / filename).write_bytes(contents[audio_path])
            student.current_audio_filename = filename
        db.flush()
        invites.append({"student_id": student_id, "token": invitation})
        imported += 1
    db.commit()
    return {"imported": imported, "ceremony": manifest.get("ceremony"), "invites": invites}


@app.post("/api/student/login")
def student_login(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    student = current_student(authorization, db)
    return {"student_id": student.student_id, "display_name": student.display_name}


@app.get("/api/student/me")
def student_profile(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    student = current_student(authorization, db)
    submissions = db.scalars(
        select(PronunciationSubmission)
        .where(PronunciationSubmission.student_id == student.id)
        .order_by(PronunciationSubmission.created_at.desc())
    ).all()
    return {
        "student_id": student.student_id,
        "display_name": student.display_name,
        "native_name": student.native_name,
        "language": student.language,
        "phonetic_spelling": student.phonetic_spelling,
        "program": student.program,
        "announcement_text": student.announcement_text,
        "current_audio_url": f"/media/{student.current_audio_filename}" if student.current_audio_filename else None,
        "submissions": [{"id": item.id, "kind": item.kind, "status": item.status, "note": item.review_note} for item in submissions],
        "candidates": [candidate_out(item) for item in db.scalars(select(PortalAudioCandidate).where(PortalAudioCandidate.student_id == student.id).order_by(PortalAudioCandidate.id.desc())).all()],
    }


def candidate_out(candidate: PortalAudioCandidate):
    return {"id": candidate.id, "source": candidate.source, "voice": candidate.voice,
            "language_code": candidate.language_code, "generation_input": candidate.generation_input,
            "approved": candidate.approved, "url": f"/media/{candidate.filename}"}


@app.patch("/api/student/me/profile")
def update_profile(payload: StudentProfileUpdate, authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    student = current_student(authorization, db)
    for key, value in payload.model_dump().items():
        setattr(student, key, value)
    db.commit()
    return {"student_id": student.student_id, "display_name": student.display_name}


@app.get("/api/student/speech/languages")
def speech_languages(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    current_student(authorization, db)
    return google_speech.list_languages()


@app.get("/api/student/speech/voices")
def speech_voices(language_code: str, authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    current_student(authorization, db)
    return google_speech.list_voices(language_code)


@app.get("/api/student/me/candidates")
def list_candidates(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    student = current_student(authorization, db)
    return [candidate_out(item) for item in db.scalars(select(PortalAudioCandidate).where(PortalAudioCandidate.student_id == student.id).order_by(PortalAudioCandidate.id.desc())).all()]


@app.post("/api/student/me/candidates")
def generate_candidate(payload: SpeechRequest, authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    student = current_student(authorization, db)
    content = google_speech.synthesize(payload.text, payload.language_code, payload.voice_name, payload.speaking_rate)
    filename = f"candidate-{uuid.uuid4().hex}.mp3"
    destination = AUDIO_DIR / filename
    try:
        destination.write_bytes(content)
        candidate = PortalAudioCandidate(student_id=student.id, filename=filename, source="google-cloud",
                                         voice=payload.voice_name, language_code=payload.language_code,
                                         generation_input=json.dumps({**payload.model_dump(), "student_id": student.student_id}, ensure_ascii=False))
        db.add(candidate)
        db.commit()
        db.refresh(candidate)
    except Exception:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise
    return candidate_out(candidate)


@app.post("/api/student/me/candidates/{candidate_id}/approve")
def approve_candidate(candidate_id: int, authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    student = current_student(authorization, db)
    candidate = db.get(PortalAudioCandidate, candidate_id)
    if not candidate or candidate.student_id != student.id:
        raise HTTPException(404, "Audio candidate not found")
    if not (AUDIO_DIR / candidate.filename).is_file():
        raise HTTPException(409, "Audio file is missing")
    for existing in db.scalars(select(PortalAudioCandidate).where(PortalAudioCandidate.student_id == student.id)).all():
        existing.approved = False
    candidate.approved = True
    student.current_audio_filename = candidate.filename
    db.commit()
    return candidate_out(candidate)


@app.delete("/api/student/me/candidates/{candidate_id}")
def delete_candidate(candidate_id: int, authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    student = current_student(authorization, db)
    candidate = db.get(PortalAudioCandidate, candidate_id)
    if not candidate or candidate.student_id != student.id:
        raise HTTPException(404, "Audio candidate not found")
    if student.current_audio_filename == candidate.filename:
        raise HTTPException(409, "The selected pronunciation cannot be deleted. Select another candidate first.")
    path = AUDIO_DIR / candidate.filename
    db.delete(candidate)
    db.commit()
    path.unlink(missing_ok=True)
    return {"deleted": candidate_id}


@app.post("/api/student/me/submissions")
async def submit_audio(
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    student = current_student(authorization, db)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_AUDIO:
        raise HTTPException(400, "Supported formats: MP3, WAV, M4A, OGG, and WebM")
    filename = f"submission-{uuid.uuid4().hex}{suffix}"
    (AUDIO_DIR / filename).write_bytes(await file.read())
    submission = PronunciationSubmission(student_id=student.id, filename=filename, original_filename=file.filename, kind="upload")
    db.add(submission)
    db.commit()
    db.refresh(submission)
    return {"id": submission.id, "status": submission.status}


@app.post("/api/student/me/tts-requests")
def request_tts(payload: TTSRequest, authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    student = current_student(authorization, db)
    submission = PronunciationSubmission(student_id=student.id, kind="tts_request", requested_text=payload.text)
    db.add(submission)
    db.commit()
    db.refresh(submission)
    return {"id": submission.id, "status": submission.status}


@app.get("/api/staff/submissions")
def list_submissions(status: Optional[str] = None, _: None = Depends(require_staff), db: Session = Depends(get_db)):
    statement = select(PronunciationSubmission).order_by(PronunciationSubmission.created_at.desc())
    if status:
        statement = statement.where(PronunciationSubmission.status == status)
    return [
        {
            "id": item.id,
            "student_id": item.student.student_id,
            "display_name": item.student.display_name,
            "kind": item.kind,
            "status": item.status,
            "requested_text": item.requested_text,
        }
        for item in db.scalars(statement).all()
    ]


@app.post("/api/staff/submissions/{submission_id}/review")
def review_submission(
    submission_id: int,
    payload: ReviewRequest,
    _: None = Depends(require_staff),
    db: Session = Depends(get_db),
):
    submission = db.get(PronunciationSubmission, submission_id)
    if not submission:
        raise HTTPException(404, "Submission not found")
    submission.status = payload.status
    submission.review_note = payload.note
    submission.reviewed_at = utcnow()
    if payload.status == "approved" and submission.filename:
        submission.student.current_audio_filename = submission.filename
    db.commit()
    return {"id": submission.id, "status": submission.status}


FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")
app.mount("/media", StaticFiles(directory=AUDIO_DIR), name="media")


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str = ""):
    candidate = (FRONTEND_DIR / path).resolve()
    if not candidate.is_relative_to(FRONTEND_DIR.resolve()) or not candidate.is_file():
        candidate = FRONTEND_DIR / "index.html"
    return FileResponse(candidate)
