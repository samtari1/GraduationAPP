from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path


PACKAGE_FORMAT = "gradvoice-portal-package"
PACKAGE_VERSION = 1


def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


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
