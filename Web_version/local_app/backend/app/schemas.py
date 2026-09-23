from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class AudioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    original_filename: str
    source: str
    voice: Optional[str] = None
    language_code: Optional[str] = None
    approved: bool
    created_at: datetime
    url: str = ""
    generation_input: Optional[str] = None


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    text_source: str = Field(default="custom text", max_length=80)
    language_code: str = Field(pattern=r"^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})+$", max_length=35)
    voice_name: str = Field(min_length=1, max_length=100)
    speaking_rate: float = Field(default=1.0, ge=0.25, le=2.0)


class StudentBase(BaseModel):
    student_id: str = Field(min_length=1, max_length=80)
    display_name: str = Field(min_length=1, max_length=255)
    native_name: Optional[str] = None
    language: Optional[str] = None
    phonetic_spelling: Optional[str] = None
    program: str = ""
    announcement_text: str = ""
    pronunciation_status: str = "pending"
    notes: Optional[str] = None


class StudentCreate(StudentBase):
    pass


class StudentUpdate(BaseModel):
    student_id: Optional[str] = Field(default=None, min_length=1, max_length=80)
    display_name: Optional[str] = None
    native_name: Optional[str] = None
    language: Optional[str] = None
    phonetic_spelling: Optional[str] = None
    program: Optional[str] = None
    announcement_text: Optional[str] = None
    pronunciation_status: Optional[str] = None
    notes: Optional[str] = None


class StudentOut(StudentBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    qr_token: str
    active_audio_id: Optional[int] = None
    active_audio: Optional[AudioOut] = None
    portal_updated_fields: list[str] = []
    created_at: datetime
    updated_at: datetime


class CeremonyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    event_date: str
    location: str = ""


class CeremonyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    event_date: Optional[str] = None
    location: Optional[str] = None


class CeremonyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    event_date: str
    location: str
    status: str
    created_at: datetime
    student_count: int = 0


class EntryStudent(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: str
    display_name: str
    native_name: Optional[str]
    phonetic_spelling: Optional[str]
    program: str
    announcement_text: str
    pronunciation_status: str
    active_audio_id: Optional[int]
    active_audio: Optional[AudioOut] = None
    portal_updated_fields: list[str] = []


class EntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ceremony_id: int
    position: int
    line_position: Optional[int]
    status: str
    checked_in_at: Optional[datetime]
    announced_at: Optional[datetime]
    play_count: int
    student: EntryStudent


class CeremonyDetail(CeremonyOut):
    entries: list[EntryOut]


class AssignStudent(BaseModel):
    student_id: int


class ScanRequest(BaseModel):
    token: str


class ScannerConnect(BaseModel):
    port: str = Field(min_length=1, max_length=255)
    baud: int = Field(default=9600, ge=300, le=921600)
    ceremony_id: int
    mode: str = Field(default="stage", pattern="^(checkin|stage)$")


class EntryAction(BaseModel):
    action: str


class QueueReorder(BaseModel):
    entry_ids: list[int] = Field(min_length=1, max_length=500)


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    event_type: str
    message: str
    entity_type: Optional[str]
    entity_id: Optional[int]
    created_at: datetime
