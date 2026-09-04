from __future__ import annotations

import csv
import io
import json
from html import escape
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .database import AUDIO_DIR, BACKUP_DIR, Base, DATA_DIR, engine, get_db
from .models import AudioAsset, AuditEvent, Ceremony, CeremonyEntry, Student
from . import google_speech
from .schemas import (
    AssignStudent,
    AuditOut,
    CeremonyCreate,
    CeremonyDetail,
    CeremonyOut,
    EntryAction,
    EntryOut,
    ScanRequest,
    StudentCreate,
    StudentOut,
    StudentUpdate,
    AudioOut,
    SpeechRequest,
)


Base.metadata.create_all(bind=engine)

app = FastAPI(title="GradVoice", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/media", StaticFiles(directory=AUDIO_DIR), name="media")


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def audit(db: Session, event_type: str, message: str, entity_type: str | None = None, entity_id: int | None = None):
    db.add(AuditEvent(event_type=event_type, message=message, entity_type=entity_type, entity_id=entity_id))


def student_query():
    return select(Student).options(selectinload(Student.active_audio))


def serialize_student(student: Student) -> StudentOut:
    result = StudentOut.model_validate(student)
    if result.active_audio:
        result.active_audio.url = f"/media/{result.active_audio.filename}"
    return result


@app.get("/api/health")
def health():
    return {"status": "ok", "offline_ready": True, "database": "sqlite"}


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)):
    total = db.scalar(select(func.count(Student.id))) or 0
    approved = db.scalar(select(func.count(Student.id)).where(Student.pronunciation_status == "approved")) or 0
    with_audio = db.scalar(select(func.count(Student.id)).where(Student.active_audio_id.is_not(None))) or 0
    ceremonies = db.scalar(select(func.count(Ceremony.id))) or 0
    return {
        "students": total,
        "approved": approved,
        "with_audio": with_audio,
        "ceremonies": ceremonies,
        "needs_attention": total - approved,
    }


@app.get("/api/students", response_model=list[StudentOut])
def list_students(search: str = "", db: Session = Depends(get_db)):
    statement = student_query().order_by(Student.display_name)
    if search:
        pattern = f"%{search}%"
        statement = statement.where(
            or_(Student.display_name.ilike(pattern), Student.student_id.ilike(pattern), Student.program.ilike(pattern))
        )
    return [serialize_student(student) for student in db.scalars(statement).all()]


@app.post("/api/students", response_model=StudentOut, status_code=201)
def create_student(payload: StudentCreate, db: Session = Depends(get_db)):
    values = payload.model_dump()
    if not values["announcement_text"]:
        values["announcement_text"] = values["display_name"]
    student = Student(**values, qr_token=uuid.uuid4().hex)
    db.add(student)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A student with that student ID already exists")
    audit(db, "student.created", f"Added {student.display_name}", "student", student.id)
    db.commit()
    db.refresh(student)
    return serialize_student(student)


@app.patch("/api/students/{student_pk}", response_model=StudentOut)
def update_student(student_pk: int, payload: StudentUpdate, db: Session = Depends(get_db)):
    student = db.scalar(student_query().where(Student.id == student_pk))
    if not student:
        raise HTTPException(404, "Student not found")
    updates = payload.model_dump(exclude_unset=True)
    audio_sensitive = {"display_name", "native_name", "language", "phonetic_spelling", "announcement_text"}
    pronunciation_changed = any(getattr(student, key) != updates[key] for key in audio_sensitive.intersection(updates))
    for key, value in updates.items():
        setattr(student, key, value)
    if pronunciation_changed and student.active_audio_id:
        student.pronunciation_status = "needs_review"
    audit(db, "student.updated", f"Updated {student.display_name}", "student", student.id)
    db.commit()
    db.refresh(student)
    return serialize_student(student)


@app.post("/api/students/import")
async def import_students(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(400, "Please upload a CSV file")
    text = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    required = {"student_id", "display_name"}
    columns = set(reader.fieldnames or [])
    coworker_format = {"StudentID", "FirstName", "LastName"}.issubset(columns)
    if not required.issubset(columns) and not coworker_format:
        raise HTTPException(400, "CSV requires student_id/display_name or StudentID/FirstName/LastName columns")
    created = updated = skipped = 0
    errors: list[str] = []
    for line, row in enumerate(reader, start=2):
        if coworker_format:
            row = {**row, "student_id": row.get("StudentID"),
                   "display_name": " ".join(filter(None, [(row.get("FirstName") or "").strip(), (row.get("LastName") or "").strip()])),
                   "phonetic_spelling": row.get("Pronunciation") or row.get("pronunciation")}
        sid, name = (row.get("student_id") or "").strip(), (row.get("display_name") or "").strip()
        if not sid or not name:
            skipped += 1
            errors.append(f"Line {line}: missing student_id or display_name")
            continue
        student = db.scalar(select(Student).where(Student.student_id == sid))
        values = {
            "display_name": name,
            "native_name": (row.get("native_name") or "").strip() or None,
            "language": (row.get("language") or "").strip() or None,
            "phonetic_spelling": (row.get("phonetic_spelling") or "").strip() or None,
            "program": (row.get("program") or "").strip(),
            "announcement_text": (row.get("announcement_text") or "").strip() or name,
        }
        if student:
            for key, value in values.items():
                setattr(student, key, value)
            student.pronunciation_status = "needs_review"
            updated += 1
        else:
            db.add(Student(student_id=sid, qr_token=uuid.uuid4().hex, **values))
            created += 1
        db.flush()
    audit(db, "students.imported", f"CSV import: {created} created, {updated} updated, {skipped} skipped")
    db.commit()
    return {"created": created, "updated": updated, "skipped": skipped, "errors": errors[:20]}


@app.post("/api/students/{student_pk}/audio", response_model=StudentOut)
async def upload_audio(
    student_pk: int,
    file: UploadFile = File(...),
    source: str = Form("upload"),
    approve: bool = Form(False),
    db: Session = Depends(get_db),
):
    student = db.get(Student, student_pk)
    if not student:
        raise HTTPException(404, "Student not found")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".mp3", ".wav", ".m4a", ".ogg", ".webm"}:
        raise HTTPException(400, "Supported formats: MP3, WAV, M4A, OGG, and WebM")
    filename = f"{student.id}-{uuid.uuid4().hex}{suffix}"
    destination = AUDIO_DIR / filename
    with destination.open("wb") as output:
        shutil.copyfileobj(file.file, output)
    asset = AudioAsset(
        student_id=student.id,
        filename=filename,
        original_filename=file.filename or filename,
        source=source,
        approved=approve,
    )
    db.add(asset)
    db.flush()
    if approve:
        student.active_audio_id = asset.id
        student.pronunciation_status = "approved"
    audit(db, "audio.uploaded", f"Uploaded pronunciation for {student.display_name}", "student", student.id)
    db.commit()
    return serialize_student(db.scalar(student_query().where(Student.id == student.id)))


@app.get("/api/ceremonies", response_model=list[CeremonyOut])
def list_ceremonies(db: Session = Depends(get_db)):
    ceremonies = db.scalars(select(Ceremony).order_by(Ceremony.event_date.desc())).all()
    return [
        CeremonyOut.model_validate(ceremony).model_copy(update={"student_count": len(ceremony.entries)})
        for ceremony in ceremonies
    ]


@app.post("/api/ceremonies", response_model=CeremonyOut, status_code=201)
def create_ceremony(payload: CeremonyCreate, db: Session = Depends(get_db)):
    ceremony = Ceremony(**payload.model_dump())
    db.add(ceremony)
    db.flush()
    audit(db, "ceremony.created", f"Created {ceremony.name}", "ceremony", ceremony.id)
    db.commit()
    db.refresh(ceremony)
    return CeremonyOut.model_validate(ceremony)


def ceremony_detail(db: Session, ceremony_id: int) -> Ceremony:
    ceremony = db.scalar(
        select(Ceremony)
        .options(selectinload(Ceremony.entries).selectinload(CeremonyEntry.student).selectinload(Student.active_audio))
        .execution_options(populate_existing=True)
        .where(Ceremony.id == ceremony_id)
    )
    if not ceremony:
        raise HTTPException(404, "Ceremony not found")
    return ceremony


def serialize_detail(ceremony: Ceremony) -> CeremonyDetail:
    result = CeremonyDetail.model_validate(ceremony).model_copy(update={"student_count": len(ceremony.entries)})
    for entry in result.entries:
        if entry.student.active_audio:
            entry.student.active_audio.url = f"/media/{entry.student.active_audio.filename}"
    return result


@app.get("/api/ceremonies/{ceremony_id}", response_model=CeremonyDetail)
def get_ceremony(ceremony_id: int, db: Session = Depends(get_db)):
    return serialize_detail(ceremony_detail(db, ceremony_id))


@app.post("/api/ceremonies/{ceremony_id}/students", response_model=CeremonyDetail)
def assign_student(ceremony_id: int, payload: AssignStudent, db: Session = Depends(get_db)):
    ceremony = ceremony_detail(db, ceremony_id)
    student = db.get(Student, payload.student_id)
    if not student:
        raise HTTPException(404, "Student not found")
    existing = db.scalar(
        select(CeremonyEntry).where(
            CeremonyEntry.ceremony_id == ceremony_id, CeremonyEntry.student_id == payload.student_id
        )
    )
    if existing:
        raise HTTPException(409, "Student is already assigned to this ceremony")
    next_position = (db.scalar(select(func.max(CeremonyEntry.position)).where(CeremonyEntry.ceremony_id == ceremony_id)) or 0) + 1
    entry = CeremonyEntry(ceremony_id=ceremony_id, student_id=student.id, position=next_position)
    db.add(entry)
    db.flush()
    audit(db, "ceremony.student_assigned", f"Assigned {student.display_name} to {ceremony.name}", "ceremony", ceremony.id)
    db.commit()
    return serialize_detail(ceremony_detail(db, ceremony_id))


@app.post("/api/ceremonies/{ceremony_id}/scan", response_model=EntryOut)
def scan_student(ceremony_id: int, payload: ScanRequest, db: Session = Depends(get_db)):
    token = payload.token.strip()
    student = db.scalar(select(Student).where(or_(Student.qr_token == token, Student.student_id == token)))
    if not student:
        raise HTTPException(404, "No student matches that scan")
    entry = db.scalar(
        select(CeremonyEntry)
        .options(selectinload(CeremonyEntry.student).selectinload(Student.active_audio))
        .where(CeremonyEntry.ceremony_id == ceremony_id, CeremonyEntry.student_id == student.id)
    )
    if not entry:
        raise HTTPException(409, "Student is not assigned to this ceremony")
    if entry.status == "announced":
        raise HTTPException(409, "Student has already been announced")
    if entry.status not in {"checked_in", "queued"}:
        entry.status = "checked_in"
        entry.checked_in_at = utcnow()
        audit(db, "ceremony.scanned", f"Checked in {student.display_name}", "ceremony_entry", entry.id)
    db.commit()
    db.refresh(entry)
    result = EntryOut.model_validate(entry)
    if result.student.active_audio:
        result.student.active_audio.url = f"/media/{result.student.active_audio.filename}"
    return result


@app.post("/api/entries/{entry_id}/action", response_model=EntryOut)
def entry_action(entry_id: int, payload: EntryAction, db: Session = Depends(get_db)):
    entry = db.scalar(
        select(CeremonyEntry)
        .options(selectinload(CeremonyEntry.student).selectinload(Student.active_audio))
        .where(CeremonyEntry.id == entry_id)
    )
    if not entry:
        raise HTTPException(404, "Queue entry not found")
    allowed = {"queue", "announce", "replay", "skip", "reset"}
    if payload.action not in allowed:
        raise HTTPException(400, f"Action must be one of: {', '.join(sorted(allowed))}")
    if payload.action == "queue":
        entry.status = "queued"
    elif payload.action == "announce":
        if entry.status == "announced":
            raise HTTPException(409, "Student has already been announced; use replay deliberately")
        if not playable_audio(entry.student):
            raise HTTPException(409, "No approved audio is available")
        entry.status = "announced"
        entry.announced_at = utcnow()
        entry.play_count += 1
    elif payload.action == "replay":
        if not playable_audio(entry.student):
            raise HTTPException(409, "No approved audio is available")
        entry.play_count += 1
    elif payload.action == "skip":
        entry.status = "skipped"
    else:
        entry.status = "expected"
        entry.checked_in_at = None
        entry.announced_at = None
        entry.play_count = 0
    audit(
        db,
        f"ceremony.{payload.action}",
        f"{payload.action.title()}: {entry.student.display_name}",
        "ceremony_entry",
        entry.id,
    )
    db.commit()
    db.refresh(entry)
    result = EntryOut.model_validate(entry)
    if result.student.active_audio:
        result.student.active_audio.url = f"/media/{result.student.active_audio.filename}"
    return result


@app.get("/api/ceremonies/{ceremony_id}/readiness")
def readiness(ceremony_id: int, db: Session = Depends(get_db)):
    ceremony = ceremony_detail(db, ceremony_id)
    issues = []
    for entry in ceremony.entries:
        student = entry.student
        if not student.active_audio_id:
            issues.append({"student_id": student.student_id, "name": student.display_name, "issue": "No approved audio"})
        elif not student.active_audio or not (AUDIO_DIR / student.active_audio.filename).is_file():
            issues.append({"student_id": student.student_id, "name": student.display_name, "issue": "Audio file missing"})
        elif student.pronunciation_status != "approved":
            issues.append({"student_id": student.student_id, "name": student.display_name, "issue": "Pronunciation not approved"})
    return {"ready": not issues, "total": len(ceremony.entries), "issue_count": len(issues), "issues": issues}


@app.get("/api/audit", response_model=list[AuditOut])
def list_audit(limit: int = 30, db: Session = Depends(get_db)):
    return db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(min(limit, 200))).all()


@app.post("/api/backup")
def create_backup(db: Session = Depends(get_db)):
    db.commit()
    source = DATA_DIR / "graduation.sqlite3"
    if not source.exists():
        raise HTTPException(404, "Database file not found")
    timestamp = utcnow().strftime("%Y%m%d-%H%M%S")
    destination = BACKUP_DIR / f"graduation-{timestamp}.sqlite3"
    shutil.copy2(source, destination)
    audit(db, "backup.created", f"Created backup {destination.name}")
    db.commit()
    return {"filename": destination.name, "path": str(destination)}


def playable_audio(student):
    return bool(student.active_audio and student.active_audio.approved
                and student.pronunciation_status == "approved"
                and (AUDIO_DIR / student.active_audio.filename).is_file())


def audio_out(asset):
    return AudioOut.model_validate(asset).model_copy(update={"url": f"/media/{asset.filename}"})


def pronunciation_snapshot(student):
    return {key: getattr(student, key) for key in
            ("display_name", "native_name", "language", "phonetic_spelling", "announcement_text")}


@app.get("/api/speech/voices")
def speech_voices(language_code: str = "en-US"):
    return google_speech.list_voices(language_code)


@app.get("/api/students/{student_pk}/audio", response_model=list[AudioOut])
def list_audio(student_pk: int, db: Session = Depends(get_db)):
    if not db.get(Student, student_pk):
        raise HTTPException(404, "Student not found")
    return [audio_out(asset) for asset in db.scalars(
        select(AudioAsset).where(AudioAsset.student_id == student_pk).order_by(AudioAsset.id.desc())).all()]


@app.post("/api/students/{student_pk}/speech", response_model=AudioOut, status_code=201)
def generate_speech(student_pk: int, payload: SpeechRequest, db: Session = Depends(get_db)):
    student = db.get(Student, student_pk)
    if not student:
        raise HTTPException(404, "Student not found")
    if not payload.text.strip():
        raise HTTPException(422, "Speech text must not be blank")
    metadata = {**payload.model_dump(), "provider": "google-cloud", "student_snapshot": pronunciation_snapshot(student)}
    # Release the database read transaction before waiting on the external provider.
    db.rollback()
    content = google_speech.synthesize(payload.text, payload.language_code, payload.voice_name, payload.speaking_rate)
    filename = f"{student_pk}-{uuid.uuid4().hex}.mp3"
    destination = AUDIO_DIR / filename
    try:
        destination.write_bytes(content)
        asset = AudioAsset(student_id=student_pk, filename=filename,
                           original_filename=f"Google pronunciation ({payload.voice_name}).mp3",
                           source="google-cloud", voice=payload.voice_name,
                           generation_input=json.dumps(metadata, ensure_ascii=False), approved=False)
        db.add(asset)
        db.flush()
        audit(db, "audio.generated", f"Generated Google audio candidate for student record {student_pk}", "student", student_pk)
        db.commit()
    except Exception:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise
    return audio_out(asset)


@app.post("/api/students/{student_pk}/audio/{audio_id}/approve", response_model=StudentOut)
def approve_audio(student_pk: int, audio_id: int, db: Session = Depends(get_db)):
    student = db.scalar(student_query().where(Student.id == student_pk))
    asset = db.get(AudioAsset, audio_id)
    if not student or not asset or asset.student_id != student_pk:
        raise HTTPException(404, "Student audio candidate not found")
    if not (AUDIO_DIR / asset.filename).is_file():
        raise HTTPException(409, "Audio file is missing. Upload or generate a new candidate.")
    if asset.source == "google-cloud" and asset.generation_input:
        snapshot = json.loads(asset.generation_input).get("student_snapshot")
        if snapshot != pronunciation_snapshot(student):
            raise HTTPException(409, "Pronunciation details changed since generation. Generate a new candidate first.")
    asset.approved = True
    student.active_audio = asset
    student.pronunciation_status = "approved"
    audit(db, "audio.approved", f"Selected audio candidate {audio_id} for {student.display_name}", "student", student.id)
    db.commit()
    return serialize_student(student)


@app.get("/api/students/{student_pk}/qr.svg")
def student_qr(student_pk: int, db: Session = Depends(get_db)):
    student = db.get(Student, student_pk)
    if not student:
        raise HTTPException(404, "Student not found")
    try:
        import qrcode
        from qrcode.image.svg import SvgPathImage
    except ImportError:
        raise HTTPException(503, "Install requirements-integrations.txt to enable QR generation.")
    output = io.BytesIO()
    qrcode.make(student.qr_token, image_factory=SvgPathImage, border=4).save(output)
    return Response(output.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


@app.get("/api/ceremonies/{ceremony_id}/qr-cards", response_class=HTMLResponse)
def qr_cards(ceremony_id: int, db: Session = Depends(get_db)):
    ceremony = ceremony_detail(db, ceremony_id)
    cards = "".join(
        f'<article><img src="/api/students/{entry.student.id}/qr.svg" alt="QR code" />'
        f'<h2 dir="auto">{escape(entry.student.display_name)}</h2>'
        f'<p>{escape(entry.student.program)}</p><small>{escape(ceremony.name)} · #{entry.position}</small></article>'
        for entry in ceremony.entries)
    return HTMLResponse(f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
        <title>QR cards — {escape(ceremony.name)}</title><style>
        body {{ font-family: sans-serif; margin: 20px; }} .cards {{ display:grid; grid-template-columns:repeat(2,1fr); gap:18px; }}
        article {{ border:1px solid #aaa; text-align:center; padding:16px; break-inside:avoid; }}
        img {{ width:180px; height:180px; }} h2 {{ font-size:20px; overflow-wrap:anywhere; }}
        @media print {{ .instructions {{display:none}} }} </style></head><body>
        <p class="instructions">Use your browser's Print command. Confirm every QR image has loaded before printing.</p>
        <div class="cards">{cards}</div></body></html>''')


FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def serve_frontend(path: str):
        candidate = (FRONTEND_DIST / path).resolve()
        if not candidate.is_relative_to(FRONTEND_DIST.resolve()) or path.startswith("api/"):
            raise HTTPException(404, "Not found")
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
