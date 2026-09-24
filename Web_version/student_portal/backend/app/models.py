from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class StaffUser(Base):
    __tablename__ = "staff_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class PortalSetting(Base):
    __tablename__ = "portal_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(String(20), default="false")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class PortalCeremony(Base):
    __tablename__ = "portal_ceremonies"

    id: Mapped[int] = mapped_column(primary_key=True)
    local_id: Mapped[Optional[int]] = mapped_column(nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), default="Unnamed ceremony")
    event_date: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PortalCeremonyStudent(Base):
    __tablename__ = "portal_ceremony_students"
    __table_args__ = (UniqueConstraint("ceremony_id", "student_id", name="uq_portal_ceremony_student"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ceremony_id: Mapped[int] = mapped_column(ForeignKey("portal_ceremonies.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("portal_students.id", ondelete="CASCADE"), index=True)


class PortalStudent(Base):
    __tablename__ = "portal_students"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    native_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    language: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    phonetic_spelling: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    program: Mapped[str] = mapped_column(String(255), default="")
    announcement_text: Mapped[str] = mapped_column(String(500), default="")
    invitation_token_hash: Mapped[str] = mapped_column(String(64), index=True)
    invitation_token: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    current_audio_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    baseline_profile_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    baseline_audio_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    submissions: Mapped[list["PronunciationSubmission"]] = relationship(
        back_populates="student", cascade="all, delete-orphan"
    )


class PronunciationSubmission(Base):
    __tablename__ = "pronunciation_submissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("portal_students.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30), default="upload")
    filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    original_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    requested_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    student: Mapped[PortalStudent] = relationship(back_populates="submissions")


class PortalAudioCandidate(Base):
    __tablename__ = "portal_audio_candidates"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("portal_students.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(30), default="google-cloud")
    voice: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    language_code: Mapped[Optional[str]] = mapped_column(String(35), nullable=True)
    generation_input: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approved: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    student: Mapped[PortalStudent] = relationship()
