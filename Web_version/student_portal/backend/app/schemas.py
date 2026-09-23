from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class ReviewRequest(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")
    note: Optional[str] = Field(default=None, max_length=2000)


class StudentProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)
    native_name: Optional[str] = Field(default=None, max_length=255)
    language: Optional[str] = Field(default=None, max_length=80)
    phonetic_spelling: Optional[str] = Field(default=None, max_length=255)
    program: str = Field(default="", max_length=255)
    announcement_text: str = Field(min_length=1, max_length=500)


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    language_code: str = Field(pattern=r"^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})+$", max_length=35)
    voice_name: str = Field(min_length=1, max_length=120)
    speaking_rate: float = Field(default=1.0, ge=0.25, le=2.0)
