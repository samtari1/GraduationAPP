from __future__ import annotations

import uuid

from sqlalchemy import select

from .database import Base, SessionLocal, engine
from .models import AuditEvent, Ceremony, CeremonyEntry, Student


SAMPLE_STUDENTS = [
    ("100001", "Aaliyah Johnson", None, "English", "uh-LEE-uh JON-sun", "Associate in Arts"),
    ("100002", "Nguyễn Minh Anh", "Nguyễn Minh Anh", "Vietnamese", "ngwin meen ahn", "Associate in Science"),
    ("100003", "Ximena Rodríguez", None, "Spanish (Mexico)", "hee-MEH-nah roh-DREE-gez", "Nursing"),
    ("100004", "Mohammed Al-Khatib", "محمد الخطيب", "Arabic", "moo-HAM-mad al-kha-TEEB", "Information Technology"),
    ("100005", "Chiamaka Okafor", None, "Igbo", "chee-ah-MAH-kah oh-KAH-for", "Business Administration"),
]


def seed():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if db.scalar(select(Student.id).limit(1)):
            print("Database already contains students; seed skipped.")
            return
        students = []
        for sid, name, native, language, phonetic, program in SAMPLE_STUDENTS:
            student = Student(
                student_id=sid,
                qr_token=uuid.uuid4().hex,
                display_name=name,
                native_name=native,
                language=language,
                phonetic_spelling=phonetic,
                program=program,
                announcement_text=name,
                pronunciation_status="pending",
            )
            db.add(student)
            students.append(student)
        db.flush()
        ceremony = Ceremony(name="Spring Commencement", event_date="2027-05-15", location="Main Auditorium")
        db.add(ceremony)
        db.flush()
        for position, student in enumerate(students, start=1):
            db.add(CeremonyEntry(ceremony_id=ceremony.id, student_id=student.id, position=position))
        db.add(AuditEvent(event_type="sample.seeded", message="Loaded sample graduation data"))
        db.commit()
        print("Sample data created.")


if __name__ == "__main__":
    seed()

