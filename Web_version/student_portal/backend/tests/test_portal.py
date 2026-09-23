import hashlib
import io
import json
import zipfile

from fastapi.testclient import TestClient


def make_package():
    profile = {"student_id": "S-901", "display_name": "Portal Student", "announcement_text": "Portal Student"}
    profile_bytes = json.dumps(profile).encode()
    manifest = {
        "format": "gradvoice-portal-package",
        "version": 1,
        "ceremony": {"name": "Test Ceremony", "event_date": "2027-05-01"},
        "students": [{"student_id": "S-901", "profile": "students/S-901/profile.json"}],
        "files": [{"path": "students/S-901/profile.json", "sha256": hashlib.sha256(profile_bytes).hexdigest(), "size": len(profile_bytes)}],
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("students/S-901/profile.json", profile_bytes)
    return output.getvalue()


def test_roster_import_and_student_submission(tmp_path, monkeypatch):
    monkeypatch.setenv("PORTAL_DATABASE_URL", f"sqlite:///{tmp_path / 'portal.sqlite3'}")
    monkeypatch.setenv("PORTAL_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("PORTAL_STORAGE_DIR", str(tmp_path / "storage"))
    from backend.app import database, main
    import importlib
    importlib.reload(database)
    importlib.reload(main)
    with TestClient(main.app) as client:
        imported = client.post(
            "/api/staff/rosters/import",
            headers={"X-Portal-Staff-Token": "dev-staff-token"},
            files={"file": ("roster.zip", make_package(), "application/zip")},
        )
        assert imported.status_code == 200
        token = imported.json()["invites"][0]["token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/student/me", headers=headers).json()["student_id"] == "S-901"
        updated = client.patch(
            "/api/student/me/profile",
            headers=headers,
            json={
                "display_name": "Updated Student",
                "native_name": "Native Student",
                "language": "Vietnamese",
                "phonetic_spelling": "up-DAY-ted",
                "program": "Arts",
                "announcement_text": "Updated Student",
            },
        )
        assert updated.status_code == 200
        assert client.get("/api/student/me", headers=headers).json()["program"] == "Arts"
        submission = client.post(
            "/api/student/me/submissions",
            headers=headers,
            files={"file": ("voice.wav", b"audio", "audio/wav")},
        )
        assert submission.status_code == 200
        staff_submissions = client.get(
            "/api/staff/submissions", headers={"X-Portal-Staff-Token": "dev-staff-token"}
        )
        assert staff_submissions.json()[0]["status"] == "pending"
