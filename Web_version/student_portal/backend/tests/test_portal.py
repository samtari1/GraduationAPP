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
    from backend.app import database, main, models
    import importlib
    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(main)
    with TestClient(main.app) as client:
        imported = client.post(
            "/api/staff/rosters/import",
            headers={"X-Portal-Staff-Token": "dev-staff-token"},
            files={"file": ("roster.zip", make_package(), "application/zip")},
        )
        assert imported.status_code == 200
        ceremony_id = imported.json()["ceremony"]["id"]
        ceremonies = client.get("/api/staff/ceremonies", headers={"X-Portal-Staff-Token": "dev-staff-token"})
        assert ceremonies.status_code == 200
        assert ceremonies.json()[0]["student_count"] == 1
        progress = client.get(
            f"/api/staff/students/progress?ceremony_id={ceremony_id}",
            headers={"X-Portal-Staff-Token": "dev-staff-token"},
        )
        assert progress.status_code == 200
        assert progress.json()[0]["student_id"] == "S-901"
        token = imported.json()["invites"][0]["token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/student/me", headers=headers).json()["student_id"] == "S-901"
        stats = client.get("/api/staff/ceremonies/1/stats", headers={"X-Portal-Staff-Token": "dev-staff-token"})
        assert stats.status_code == 200
        assert stats.json()["students"] == 1
        assert stats.json()["logged_in"] == 0
        login = client.post("/api/student/login", headers=headers)
        assert login.status_code == 200
        assert client.get("/api/staff/ceremonies/1/stats", headers={"X-Portal-Staff-Token": "dev-staff-token"}).json()["logged_in"] == 1
        regenerated = client.post("/api/staff/students/S-901/invitation-token", headers={"X-Portal-Staff-Token": "dev-staff-token"})
        assert regenerated.status_code == 200
        assert regenerated.json()["token"] == token
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
        profile_after_update = client.get("/api/student/me", headers=headers).json()
        assert profile_after_update["display_name"] == "Portal Student"
        assert profile_after_update["program"] == ""
        assert profile_after_update["announcement_text"] == "Portal Student"
        assert profile_after_update["native_name"] == "Native Student"
        assert profile_after_update["phonetic_spelling"] == "up-DAY-ted"
        assert client.get("/api/student/me", headers=headers).json()["recording_enabled"] is False
        submission = client.post(
            "/api/student/me/submissions",
            headers=headers,
            files={"file": ("voice.wav", b"audio", "audio/wav")},
        )
        assert submission.status_code == 403
        enabled = client.patch(
            "/api/staff/settings?student_recording_enabled=true",
            headers={"X-Portal-Staff-Token": "dev-staff-token"},
        )
        assert enabled.status_code == 200
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
        staff_login = client.post("/api/staff/login", json={"username": "admin", "password": "admin"})
        assert staff_login.status_code == 200
        staff_headers = {"X-Portal-Staff-Token": staff_login.json()["token"]}
        changed = client.post(
            "/api/staff/password",
            headers=staff_headers,
            json={"current_password": "admin", "new_password": "admin-password"},
        )
        assert changed.status_code == 200
        approved = client.post(
            f"/api/staff/submissions/{submission.json()['id']}/review",
            headers=staff_headers,
            json={"status": "approved", "note": "Ready for ceremony"},
        )
        assert approved.status_code == 200
        exported = client.get(f"/api/staff/portal-package/export?ceremony_id={ceremony_id}", headers=staff_headers)
        assert exported.status_code == 200
        from backend.app.package_io import read_package
        _, profiles, contents = read_package(exported.content)
        assert profiles["S-901"]["display_name"] == "Portal Student"
        assert profiles["S-901"]["audio"]["path"] in contents


def test_reimport_preserves_selected_portal_audio_and_marks_changes(tmp_path, monkeypatch):
    monkeypatch.setenv("PORTAL_DATABASE_URL", f"sqlite:///{tmp_path / 'portal.sqlite3'}")
    monkeypatch.setenv("PORTAL_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("PORTAL_STORAGE_DIR", str(tmp_path / "storage"))
    from backend.app import database, main, models
    from backend.app import google_speech
    import importlib
    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(main)
    monkeypatch.setattr(google_speech, "synthesize", lambda *args: b"portal-audio")
    with TestClient(main.app) as client:
        headers = {"X-Portal-Staff-Token": "dev-staff-token"}
        imported = client.post("/api/staff/rosters/import", headers=headers,
                               files={"file": ("roster.zip", make_package(), "application/zip")})
        token = imported.json()["invites"][0]["token"]
        from backend.app.models import PortalStudent
        with main.SessionLocal() as db:
            db.query(PortalStudent).filter(PortalStudent.student_id == "S-901").update(
                {PortalStudent.baseline_audio_sha256: "baseline-hash"})
            db.commit()
        student_headers = {"Authorization": f"Bearer {token}"}
        candidate = client.post("/api/student/me/candidates", headers=student_headers, json={
            "text": "Portal pronunciation", "language_code": "en-US",
            "voice_name": "en-US-Standard-A", "speaking_rate": 1,
        })
        assert candidate.status_code == 200
        assert client.post(f"/api/student/me/candidates/{candidate.json()['id']}/approve",
                            headers=student_headers).status_code == 200
        exported = client.get("/api/staff/portal-package/export", headers=headers)
        assert exported.status_code == 200
        from backend.app.package_io import read_package
        _, profiles, contents = read_package(exported.content)
        profile = profiles["S-901"]
        assert profile["audio"]["source"] == "portal"
        assert profile["audio"]["changed"] is True
        assert profile["audio"]["path"] in contents
