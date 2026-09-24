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
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from .database import AUDIO_DIR, Base, SessionLocal, engine, get_db
from .models import PortalAudioCandidate, PortalCeremony, PortalCeremonyStudent, PortalSetting, PortalStudent, PronunciationSubmission, StaffUser, utcnow
from .package_io import build_package, read_package
from .schemas import ReviewRequest, SpeechRequest, StaffLoginRequest, StaffPasswordChangeRequest, StudentProfileUpdate, TTSRequest
from . import google_speech


Base.metadata.create_all(bind=engine)
PROFILE_FIELDS = (
    "display_name", "native_name", "language", "phonetic_spelling",
    "program", "announcement_text",
)
portal_inspector = inspect(engine)
for column, definition in (("invitation_token", "VARCHAR(255)"), ("last_login_at", "DATETIME"), ("baseline_profile_json", "TEXT"), ("baseline_audio_sha256", "VARCHAR(64)")):
    if portal_inspector.has_table("portal_students") and column not in {item["name"] for item in portal_inspector.get_columns("portal_students")}:
        with engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE portal_students ADD COLUMN {column} {definition}"))
app = FastAPI(title="GradVoice Student Portal", version="0.1.0")
PORTAL_ENV = os.getenv("PORTAL_ENV", "development")
STAFF_TOKEN = os.getenv("PORTAL_STAFF_TOKEN") or ("dev-staff-token" if PORTAL_ENV == "development" else None)
STAFF_SESSIONS: dict[str, str] = {}
ALLOWED_AUDIO = {".mp3", ".wav", ".m4a", ".ogg", ".webm"}
RECORDING_SETTING = "student_recording_enabled"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def password_hash(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    rounds = 210_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)
    return f"pbkdf2_sha256${rounds}${salt.hex()}${digest.hex()}"


def password_matches(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = stored.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (TypeError, ValueError):
        return False


def seed_default_staff_user() -> None:
    with SessionLocal() as db:
        if not db.scalar(select(StaffUser).where(StaffUser.username == "admin")):
            db.add(StaffUser(username="admin", password_hash=password_hash("admin")))
            db.commit()


def require_staff(x_portal_staff_token: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    valid_legacy_token = bool(STAFF_TOKEN and x_portal_staff_token and hmac.compare_digest(x_portal_staff_token, STAFF_TOKEN))
    if not valid_legacy_token and (not x_portal_staff_token or x_portal_staff_token not in STAFF_SESSIONS):
        raise HTTPException(401, "Staff authentication is required")


def session_staff(x_portal_staff_token: Optional[str], db: Session) -> StaffUser:
    username = STAFF_SESSIONS.get(x_portal_staff_token or "")
    staff = db.scalar(select(StaffUser).where(StaffUser.username == username)) if username else None
    if not staff:
        raise HTTPException(401, "Staff authentication is required")
    return staff


def recording_enabled(db: Session) -> bool:
    setting = db.get(PortalSetting, RECORDING_SETTING)
    return bool(setting and setting.value == "true")


def ensure_settings(db: Session) -> None:
    if not db.get(PortalSetting, RECORDING_SETTING):
        db.add(PortalSetting(key=RECORDING_SETTING, value="false"))
        db.commit()


seed_default_staff_user()


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

@app.post("/api/staff/login")
def staff_login(payload: StaffLoginRequest, db: Session = Depends(get_db)):
    staff = db.scalar(select(StaffUser).where(StaffUser.username == payload.username))
    if not staff or not password_matches(payload.password, staff.password_hash):
        raise HTTPException(401, "Invalid staff username or password")
    session_token = secrets.token_urlsafe(32)
    STAFF_SESSIONS[session_token] = staff.username
    return {"token": session_token, "username": staff.username}

@app.post("/api/staff/logout")
def staff_logout(x_portal_staff_token: Optional[str] = Header(default=None)):
    if x_portal_staff_token:
        STAFF_SESSIONS.pop(x_portal_staff_token, None)
    return {"logged_out": True}


@app.post("/api/staff/password")
def change_staff_password(
    payload: StaffPasswordChangeRequest,
    x_portal_staff_token: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    staff = session_staff(x_portal_staff_token, db)
    if not password_matches(payload.current_password, staff.password_hash):
        raise HTTPException(401, "Current password is incorrect")
    staff.password_hash = password_hash(payload.new_password)
    db.commit()
    return {"updated": True}


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
    ceremony_data = manifest.get("ceremony") or {}
    local_id = ceremony_data.get("local_id")
    ceremony = db.scalar(select(PortalCeremony).where(PortalCeremony.local_id == local_id)) if local_id is not None else None
    if not ceremony:
        ceremony = PortalCeremony(local_id=local_id, name=ceremony_data.get("name") or "Unnamed ceremony", event_date=ceremony_data.get("event_date"), location=ceremony_data.get("location"))
        db.add(ceremony)
        db.flush()
    else:
        ceremony.name = ceremony_data.get("name") or ceremony.name
        ceremony.event_date = ceremony_data.get("event_date")
        ceremony.location = ceremony_data.get("location")
    for student_id, profile in profiles.items():
        student = db.scalar(select(PortalStudent).where(PortalStudent.student_id == student_id))
        invitation = student.invitation_token if student and student.invitation_token else secrets.token_urlsafe(32)
        if not student:
            student = PortalStudent(student_id=student_id, invitation_token=invitation, invitation_token_hash=token_hash(invitation))
            db.add(student)
        else:
            if not student.invitation_token:
                student.invitation_token = invitation
                student.invitation_token_hash = token_hash(invitation)
        incoming_baseline = profile.get("baseline") or {key: profile.get(key) for key in PROFILE_FIELDS}
        stored_baseline = json.loads(student.baseline_profile_json) if student.baseline_profile_json else None
        for key in PROFILE_FIELDS:
            if key in profile and (not stored_baseline or getattr(student, key) == stored_baseline.get(key)):
                setattr(student, key, profile[key])
        student.baseline_profile_json = json.dumps(incoming_baseline, ensure_ascii=False)
        audio = profile.get("audio") or {}
        audio_path = audio.get("path")
        if audio_path and audio_path in contents:
            suffix = Path(audio_path).suffix.lower()
            if suffix not in ALLOWED_AUDIO:
                raise HTTPException(400, f"Unsupported audio format for {student_id}")
            filename = f"baseline-{uuid.uuid4().hex}{suffix}"
            (AUDIO_DIR / filename).write_bytes(contents[audio_path])
            student.baseline_audio_sha256 = audio.get("sha256") or hashlib.sha256(contents[audio_path]).hexdigest()
            approved_candidate = db.scalar(select(PortalAudioCandidate).where(
                PortalAudioCandidate.student_id == student.id, PortalAudioCandidate.approved.is_(True)))
            approved_submission = db.scalar(select(PronunciationSubmission).where(
                PronunciationSubmission.student_id == student.id,
                PronunciationSubmission.status == "approved",
            ).order_by(PronunciationSubmission.reviewed_at.desc()))
            if approved_candidate:
                student.current_audio_filename = approved_candidate.filename
            elif approved_submission and approved_submission.filename:
                student.current_audio_filename = approved_submission.filename
            else:
                student.current_audio_filename = filename
        db.flush()
        if not db.scalar(select(PortalCeremonyStudent).where(PortalCeremonyStudent.ceremony_id == ceremony.id, PortalCeremonyStudent.student_id == student.id)):
            db.add(PortalCeremonyStudent(ceremony_id=ceremony.id, student_id=student.id))
        invites.append({"student_id": student_id, "token": invitation})
        imported += 1
    db.commit()
    return {"imported": imported, "ceremony": {"id": ceremony.id, **ceremony_data}, "invites": invites}


@app.post("/api/student/login")
def student_login(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    student = current_student(authorization, db)
    student.last_login_at = utcnow()
    db.commit()
    return {"student_id": student.student_id, "display_name": student.display_name}


@app.get("/api/student/me")
def student_profile(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    student = current_student(authorization, db)
    ensure_settings(db)
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
        "recording_enabled": recording_enabled(db),
    }


def candidate_out(candidate: PortalAudioCandidate):
    return {"id": candidate.id, "source": candidate.source, "voice": candidate.voice,
            "language_code": candidate.language_code, "generation_input": candidate.generation_input,
            "approved": candidate.approved, "url": f"/media/{candidate.filename}"}


@app.patch("/api/student/me/profile")
def update_profile(payload: StudentProfileUpdate, authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    student = current_student(authorization, db)
    for key, value in payload.model_dump(exclude_unset=True).items():
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
    content = google_speech.synthesize(payload.text, payload.language_code, payload.voice_name, 1.0)
    filename = f"candidate-{uuid.uuid4().hex}.mp3"
    destination = AUDIO_DIR / filename
    try:
        destination.write_bytes(content)
        candidate = PortalAudioCandidate(student_id=student.id, filename=filename, source="google-cloud",
                                         voice=payload.voice_name, language_code=payload.language_code,
                                         generation_input=json.dumps({**payload.model_dump(), "speaking_rate": 1.0, "student_id": student.student_id}, ensure_ascii=False))
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
    if not recording_enabled(db):
        raise HTTPException(403, "Student recording uploads are currently disabled by staff")
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


@app.get("/api/staff/ceremonies")
def list_ceremonies(_: None = Depends(require_staff), db: Session = Depends(get_db)):
    ceremonies = db.scalars(select(PortalCeremony).order_by(PortalCeremony.event_date.desc(), PortalCeremony.id.desc())).all()
    return [{"id": item.id, "local_id": item.local_id, "name": item.name, "event_date": item.event_date, "location": item.location,
             "student_count": db.query(PortalCeremonyStudent).filter(PortalCeremonyStudent.ceremony_id == item.id).count()} for item in ceremonies]


@app.get("/api/staff/settings")
def staff_settings(_: None = Depends(require_staff), db: Session = Depends(get_db)):
    ensure_settings(db)
    return {"student_recording_enabled": recording_enabled(db)}


@app.patch("/api/staff/settings")
def update_staff_settings(
    student_recording_enabled: bool,
    _: None = Depends(require_staff),
    db: Session = Depends(get_db),
):
    setting = db.get(PortalSetting, RECORDING_SETTING)
    if not setting:
        setting = PortalSetting(key=RECORDING_SETTING)
        db.add(setting)
    setting.value = "true" if student_recording_enabled else "false"
    db.commit()
    return {"student_recording_enabled": student_recording_enabled}


@app.get("/api/staff/students/progress")
def staff_student_progress(ceremony_id: Optional[int] = None, _: None = Depends(require_staff), db: Session = Depends(get_db)):
    statement = select(PortalStudent).order_by(PortalStudent.student_id)
    ceremony = db.get(PortalCeremony, ceremony_id) if ceremony_id else None
    if ceremony_id:
        statement = statement.join(PortalCeremonyStudent, PortalCeremonyStudent.student_id == PortalStudent.id).where(PortalCeremonyStudent.ceremony_id == ceremony_id)
    students = db.scalars(statement).all()
    result = []
    for student in students:
        submissions = db.scalars(select(PronunciationSubmission).where(PronunciationSubmission.student_id == student.id).order_by(PronunciationSubmission.created_at.desc())).all()
        candidates = db.scalars(select(PortalAudioCandidate).where(PortalAudioCandidate.student_id == student.id).order_by(PortalAudioCandidate.id.desc())).all()
        result.append({
            "student_id": student.student_id,
            "ceremony": {"id": ceremony.id, "name": ceremony.name, "event_date": ceremony.event_date} if ceremony else None,
            "display_name": student.display_name,
            "profile": {"display_name": student.display_name, "native_name": student.native_name, "language": student.language, "phonetic_spelling": student.phonetic_spelling, "program": student.program, "announcement_text": student.announcement_text},
            "selected_audio_url": f"/media/{student.current_audio_filename}" if student.current_audio_filename else None,
            "submissions": [{"id": item.id, "kind": item.kind, "status": item.status, "original_filename": item.original_filename, "url": f"/media/{item.filename}" if item.filename else None} for item in submissions],
            "candidates": [{"id": item.id, "source": item.source, "voice": item.voice, "language_code": item.language_code, "approved": item.approved, "url": f"/media/{item.filename}"} for item in candidates],
        })
    return result


@app.get("/api/staff/ceremonies/{ceremony_id}/stats")
def staff_ceremony_stats(ceremony_id: int, _: None = Depends(require_staff), db: Session = Depends(get_db)):
    students = db.scalars(
        select(PortalStudent)
        .join(PortalCeremonyStudent, PortalCeremonyStudent.student_id == PortalStudent.id)
        .where(PortalCeremonyStudent.ceremony_id == ceremony_id)
    ).all()
    stats = {"students": len(students), "logged_in": 0, "profile_edited": 0, "native_names_added": 0,
             "phonetic_guides_added": 0, "audio_generated": 0, "audio_selected": 0,
             "recordings_submitted": 0, "recordings_approved": 0}
    for student in students:
        if student.last_login_at:
            stats["logged_in"] += 1
        baseline = json.loads(student.baseline_profile_json) if student.baseline_profile_json else {}
        changed_fields = [field for field in PROFILE_FIELDS if str(getattr(student, field) or "") != str(baseline.get(field) or "")]
        if changed_fields:
            stats["profile_edited"] += 1
        if "native_name" in changed_fields:
            stats["native_names_added"] += 1
        if "phonetic_spelling" in changed_fields:
            stats["phonetic_guides_added"] += 1
        candidates = db.scalars(select(PortalAudioCandidate).where(PortalAudioCandidate.student_id == student.id)).all()
        stats["audio_generated"] += len(candidates)
        stats["audio_selected"] += sum(1 for candidate in candidates if candidate.approved)
        submissions = db.scalars(select(PronunciationSubmission).where(PronunciationSubmission.student_id == student.id)).all()
        stats["recordings_submitted"] += len(submissions)
        stats["recordings_approved"] += sum(1 for submission in submissions if submission.status == "approved")
    return stats


@app.post("/api/staff/students/{student_id}/invitation-token")
def regenerate_invitation_token(student_id: str, _: None = Depends(require_staff), db: Session = Depends(get_db)):
    student = db.scalar(select(PortalStudent).where(PortalStudent.student_id == student_id))
    if not student:
        raise HTTPException(404, "Student not found")
    if not student.invitation_token:
        student.invitation_token = secrets.token_urlsafe(32)
        student.invitation_token_hash = token_hash(student.invitation_token)
        db.commit()
    return {"student_id": student.student_id, "token": student.invitation_token}


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

@app.get("/api/staff/portal-package/export")
def export_portal_package(ceremony_id: Optional[int] = None, _: None = Depends(require_staff), db: Session = Depends(get_db)):
    statement = select(PortalStudent).order_by(PortalStudent.student_id)
    if ceremony_id:
        statement = statement.join(PortalCeremonyStudent, PortalCeremonyStudent.student_id == PortalStudent.id).where(PortalCeremonyStudent.ceremony_id == ceremony_id)
    students = db.scalars(statement).all()
    package_students = []
    for student in students:
        current_path = AUDIO_DIR / student.current_audio_filename if student.current_audio_filename else None
        if not student.baseline_audio_sha256 and current_path and current_path.is_file():
            student.baseline_audio_sha256 = hashlib.sha256(current_path.read_bytes()).hexdigest()
        if not student.baseline_profile_json:
            student.baseline_profile_json = json.dumps({key: getattr(student, key) for key in PROFILE_FIELDS}, ensure_ascii=False)
        approved_candidate = db.scalar(select(PortalAudioCandidate).where(
            PortalAudioCandidate.student_id == student.id, PortalAudioCandidate.approved.is_(True)))
        approved_submission = db.scalar(select(PronunciationSubmission).where(
            PronunciationSubmission.student_id == student.id,
            PronunciationSubmission.status == "approved",
        ).order_by(PronunciationSubmission.reviewed_at.desc()))
        if approved_candidate:
            student.current_audio_filename = approved_candidate.filename
            audio_metadata = {"audio_original_filename": f"Google pronunciation ({approved_candidate.voice or 'Automatic'}).mp3",
                              "audio_voice": approved_candidate.voice, "audio_language_code": approved_candidate.language_code,
                              "audio_generation_input": approved_candidate.generation_input}
        elif approved_submission and approved_submission.filename:
            student.current_audio_filename = approved_submission.filename
            audio_metadata = {"audio_original_filename": approved_submission.original_filename,
                              "audio_voice": None, "audio_language_code": None, "audio_generation_input": None}
        else:
            audio_metadata = {}
        package_students.append({
            "student_id": student.student_id, "display_name": student.display_name,
            "native_name": student.native_name, "language": student.language,
            "phonetic_spelling": student.phonetic_spelling, "program": student.program,
            "announcement_text": student.announcement_text,
            "current_audio_filename": student.current_audio_filename,
            "baseline_profile": json.loads(student.baseline_profile_json),
            "baseline_audio_sha256": student.baseline_audio_sha256,
            **audio_metadata,
        })
    package = build_package([
        student for student in package_students
    ], AUDIO_DIR, {"name": "Portal student updates"})
    db.commit()
    return Response(content=package, media_type="application/zip", headers={
        "Content-Disposition": "attachment; filename=gradvoice-portal-approved.zip",
    })


FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")
app.mount("/media", StaticFiles(directory=AUDIO_DIR), name="media")


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str = ""):
    candidate = (FRONTEND_DIR / path).resolve()
    if not candidate.is_relative_to(FRONTEND_DIR.resolve()) or not candidate.is_file():
        candidate = FRONTEND_DIR / "index.html"
    return FileResponse(candidate)
