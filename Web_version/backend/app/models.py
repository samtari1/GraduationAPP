from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    """Return a naive UTC value for SQLite without using deprecated utcnow()."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    qr_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255), index=True)
    native_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    language: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    phonetic_spelling: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    program: Mapped[str] = mapped_column(String(255), default="")
    announcement_text: Mapped[str] = mapped_column(String(500), default="")
    pronunciation_status: Mapped[str] = mapped_column(String(30), default="pending")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    active_audio_id: Mapped[Optional[int]] = mapped_column(ForeignKey("audio_assets.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    audio_assets: Mapped[list["AudioAsset"]] = relationship(
        back_populates="student", foreign_keys="AudioAsset.student_id", cascade="all, delete-orphan"
    )
    active_audio: Mapped[Optional["AudioAsset"]] = relationship(foreign_keys=[active_audio_id], post_update=True)
    ceremony_entries: Mapped[list["CeremonyEntry"]] = relationship(back_populates="student")


class AudioAsset(Base):
    __tablename__ = "audio_assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    original_filename: Mapped[str] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(30), default="upload")
    voice: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    generation_input: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    student: Mapped[Student] = relationship(back_populates="audio_assets", foreign_keys=[student_id])


class Ceremony(Base):
    __tablename__ = "ceremonies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    event_date: Mapped[str] = mapped_column(String(40))
    location: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(30), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    entries: Mapped[list["CeremonyEntry"]] = relationship(
        back_populates="ceremony", cascade="all, delete-orphan", order_by="CeremonyEntry.position"
    )


class CeremonyEntry(Base):
    __tablename__ = "ceremony_entries"
    __table_args__ = (UniqueConstraint("ceremony_id", "student_id", name="uq_ceremony_student"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ceremony_id: Mapped[int] = mapped_column(ForeignKey("ceremonies.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30), default="expected")
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    announced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    play_count: Mapped[int] = mapped_column(Integer, default=0)

    ceremony: Mapped[Ceremony] = relationship(back_populates="entries")
    student: Mapped[Student] = relationship(back_populates="ceremony_entries")


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    message: Mapped[str] = mapped_column(String(500))
    entity_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
