from __future__ import annotations

import hashlib
import io
import json
import uuid
import zipfile
from pathlib import Path


PACKAGE_FORMAT = "gradvoice-portal-package"
PACKAGE_VERSION = 1


def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _profile(student, audio_path: Path | None, audio_asset) -> tuple[dict, bytes | None, str | None]:
    profile = {
        "student_id": student.student_id,
        "display_name": student.display_name,
        "native_name": student.native_name,
        "language": student.language,
        "phonetic_spelling": student.phonetic_spelling,
        "program": student.program,
        "announcement_text": student.announcement_text,
        "pronunciation_status": student.pronunciation_status,
    }
    profile["baseline"] = dict(profile)
    profile["changes"] = []
    if not audio_path or not audio_asset or not audio_path.is_file():
        return profile, None, None
    audio_content = audio_path.read_bytes()
    audio_name = f"students/{student.student_id}/audio/{student.student_id}{audio_path.suffix.lower()}"
    profile["audio"] = {
        "path": audio_name,
        "source": audio_asset.source,
        "approved": audio_asset.approved,
        "original_filename": audio_asset.original_filename,
        "voice": audio_asset.voice,
        "language_code": audio_asset.language_code,
        "generation_input": audio_asset.generation_input,
        "sha256": _digest(audio_content),
        "baseline_sha256": _digest(audio_content),
        "changed": False,
    }
    return profile, audio_content, audio_name


def build_package(ceremony, entries, audio_dir: Path) -> bytes:
    files: dict[str, bytes] = {}
    students = []
    for entry in entries:
        student = entry.student
        audio_asset = student.active_audio
        audio_path = audio_dir / audio_asset.filename if audio_asset else None
        profile, audio_content, audio_name = _profile(student, audio_path, audio_asset)
        profile_name = f"students/{student.student_id}/profile.json"
        files[profile_name] = json.dumps(profile, ensure_ascii=False, indent=2).encode("utf-8")
        if audio_content is not None and audio_name:
            files[audio_name] = audio_content
        students.append({"student_id": student.student_id, "profile": profile_name})

    manifest = {
        "format": PACKAGE_FORMAT,
        "version": PACKAGE_VERSION,
        "package_id": uuid.uuid4().hex,
        "package_type": "portal_roster",
        "ceremony": {
            "local_id": ceremony.id,
            "name": ceremony.name,
            "event_date": ceremony.event_date,
            "location": ceremony.location,
        },
        "students": students,
        "files": [
            {"path": name, "sha256": _digest(content), "size": len(content)}
            for name, content in files.items()
        ],
    }
    files["manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return output.getvalue()


def read_package(raw: bytes) -> tuple[dict, dict[str, dict], dict[str, bytes]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as error:
        raise ValueError("The uploaded file is not a valid package") from error
    with archive:
        names = set(archive.namelist())
        if "manifest.json" not in names:
            raise ValueError("Package is missing manifest.json")
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Package manifest is not valid JSON") from error
        if manifest.get("format") != PACKAGE_FORMAT or manifest.get("version") != PACKAGE_VERSION:
            raise ValueError("Unsupported GradVoice package format")
        if not isinstance(manifest.get("students"), list) or not isinstance(manifest.get("files"), list):
            raise ValueError("Package manifest has an invalid structure")
        expected = {item.get("path"): item for item in manifest["files"]}
        profiles: dict[str, dict] = {}
        contents: dict[str, bytes] = {}
        for name, metadata in expected.items():
            if not name or name == "manifest.json" or name not in names:
                raise ValueError(f"Package file is missing: {name}")
            if not name.startswith("students/") or ".." in Path(name).parts:
                raise ValueError("Package contains an unsafe file path")
            content = archive.read(name)
            if metadata.get("sha256") != _digest(content) or metadata.get("size") != len(content):
                raise ValueError(f"Package checksum does not match: {name}")
            contents[name] = content
        for item in manifest["students"]:
            student_id = item.get("student_id")
            profile_name = item.get("profile")
            if not student_id or not profile_name or profile_name not in contents:
                raise ValueError("Package contains an invalid student profile")
            profile = json.loads(contents[profile_name])
            if profile.get("student_id") != student_id:
                raise ValueError(f"Profile student ID does not match: {profile_name}")
            profiles[student_id] = profile
        return manifest, profiles, contents