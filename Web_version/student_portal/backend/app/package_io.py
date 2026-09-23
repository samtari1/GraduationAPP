from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path
from typing import Optional


PACKAGE_FORMAT = "gradvoice-portal-package"
PACKAGE_VERSION = 1


def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()

def build_package(students: list[dict], audio_dir: Path, ceremony: Optional[dict] = None) -> bytes:
    files: dict[str, bytes] = {}
    manifest_students = []
    for student in students:
        student_id = student["student_id"]
        profile = {key: student.get(key) for key in (
            "student_id", "display_name", "native_name", "language", "phonetic_spelling",
            "program", "announcement_text",
        )}
        audio_filename = student.get("current_audio_filename")
        audio_path = audio_dir / audio_filename if audio_filename else None
        if audio_path and audio_path.is_file():
            audio_name = f"students/{student_id}/audio/{student_id}{audio_path.suffix.lower()}"
            files[audio_name] = audio_path.read_bytes()
            profile["audio"] = {"path": audio_name, "source": "portal", "approved": True}
        profile_name = f"students/{student_id}/profile.json"
        files[profile_name] = json.dumps(profile, ensure_ascii=False, indent=2).encode("utf-8")
        manifest_students.append({"student_id": student_id, "profile": profile_name})

    manifest = {
        "format": PACKAGE_FORMAT,
        "version": PACKAGE_VERSION,
        "package_id": __import__("uuid").uuid4().hex,
        "package_type": "portal_roster",
        "ceremony": ceremony or {},
        "students": manifest_students,
        "files": [{"path": name, "sha256": _digest(content), "size": len(content)} for name, content in files.items()],
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
        raise ValueError("The uploaded file is not a valid GradVoice package") from error
    with archive:
        names = set(archive.namelist())
        if "manifest.json" not in names:
            raise ValueError("Package is missing manifest.json")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("format") != PACKAGE_FORMAT or manifest.get("version") != PACKAGE_VERSION:
            raise ValueError("Unsupported GradVoice package format")
        contents: dict[str, bytes] = {}
        for metadata in manifest.get("files", []):
            name = metadata.get("path")
            if not name or name not in names or not name.startswith("students/") or ".." in Path(name).parts:
                raise ValueError(f"Package contains an invalid or missing file: {name}")
            content = archive.read(name)
            if metadata.get("sha256") != _digest(content) or metadata.get("size") != len(content):
                raise ValueError(f"Package checksum does not match: {name}")
            contents[name] = content
        profiles = {}
        for item in manifest.get("students", []):
            student_id, profile_name = item.get("student_id"), item.get("profile")
            if not student_id or profile_name not in contents:
                raise ValueError("Package contains an invalid student profile")
            profile = json.loads(contents[profile_name])
            if profile.get("student_id") != student_id:
                raise ValueError(f"Profile student ID does not match: {profile_name}")
            profiles[student_id] = profile
        return manifest, profiles, contents
