import io
import json
import zipfile


def test_student_ceremony_and_scan_workflow(client):
    response = client.post(
        "/api/students",
        json={"student_id": "S-100", "display_name": "Test Student", "program": "Arts"},
    )
    assert response.status_code == 201
    student = response.json()

    response = client.post(
        "/api/ceremonies",
        json={"name": "Test Ceremony", "event_date": "2027-05-01", "location": "Hall"},
    )
    assert response.status_code == 201
    ceremony = response.json()

    response = client.post(f"/api/ceremonies/{ceremony['id']}/students", json={"student_id": student["id"]})
    assert response.status_code == 200
    assert len(response.json()["entries"]) == 1

    response = client.post(f"/api/ceremonies/{ceremony['id']}/scan", json={"token": "S-100"})
    assert response.status_code == 200
    assert response.json()["status"] == "checked_in"

    entry_id = response.json()["id"]
    response = client.post(f"/api/entries/{entry_id}/action", json={"action": "announce"})
    assert response.status_code == 409
    assert response.json()["detail"] == "No approved audio is available"


def test_portal_package_round_trip_preserves_ceremony_state(client):
    student = client.post(
        "/api/students", json={"student_id": "S-350", "display_name": "Portal Student"}
    ).json()
    ceremony = client.post(
        "/api/ceremonies", json={"name": "Portal Ceremony", "event_date": "2027-05-01"}
    ).json()
    assert client.post(
        f"/api/ceremonies/{ceremony['id']}/students", json={"student_id": student["id"]}
    ).status_code == 200
    uploaded = client.post(
        f"/api/students/{student['id']}/audio",
        files={"file": ("portal.wav", b"audio bytes", "audio/wav")},
        data={"approve": "true"},
    )
    assert uploaded.status_code == 200

    checked_in = client.post(
        f"/api/ceremonies/{ceremony['id']}/scan", json={"token": "S-350"}
    )
    assert checked_in.status_code == 200

    package = client.get(f"/api/ceremonies/{ceremony['id']}/portal-package/export")
    assert package.status_code == 200
    with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["format"] == "gradvoice-portal-package"
        assert manifest["version"] == 1
        assert any(item["path"].endswith("/profile.json") for item in manifest["files"])
        assert any(item["path"].endswith(".wav") for item in manifest["files"])

    preview = client.post(
        f"/api/ceremonies/{ceremony['id']}/portal-package/preview",
        files={"file": ("package.zip", package.content, "application/zip")},
    )
    assert preview.status_code == 200
    assert preview.json()["students"][0]["audio"] == "included"

    client.patch(f"/api/students/{student['id']}", json={"display_name": "Changed Locally"})
    imported = client.post(
        f"/api/ceremonies/{ceremony['id']}/portal-package/import",
        files={"file": ("package.zip", package.content, "application/zip")},
    )
    assert imported.status_code == 200
    assert imported.json()["audio_imported"] == 1
    assert client.get(f"/api/students").json()[0]["display_name"] == "Portal Student"
    assert client.get(f"/api/ceremonies/{ceremony['id']}").json()["entries"][0]["status"] == "checked_in"


def test_duplicate_student_id_is_rejected(client):
    payload = {"student_id": "S-200", "display_name": "First Student"}
    assert client.post("/api/students", json=payload).status_code == 201
    assert client.post("/api/students", json=payload).status_code == 409


def test_student_delete_removes_ceremony_entry(client):
    student = client.post(
        "/api/students", json={"student_id": "S-250", "display_name": "Delete Student"}
    ).json()
    ceremony = client.post(
        "/api/ceremonies", json={"name": "Delete Ceremony", "event_date": "2027-05-01"}
    ).json()
    assert client.post(
        f"/api/ceremonies/{ceremony['id']}/students", json={"student_id": student["id"]}
    ).status_code == 200

    deleted = client.delete(f"/api/students/{student['id']}")

    assert deleted.status_code == 200
    assert client.get(f"/api/ceremonies/{ceremony['id']}").json()["entries"] == []
    assert client.get("/api/students").json() == []


def test_csv_import_supports_native_names(client):
    csv_data = (
        "student_id,display_name,native_name,language,phonetic_spelling,program\n"
        "S-300,Mohammed Al-Khatib,محمد الخطيب,Arabic,moo-HAM-mad,Technology\n"
    )
    response = client.post(
        "/api/students/import",
        files={"file": ("students.csv", csv_data.encode("utf-8"), "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["created"] == 1
    students = client.get("/api/students").json()
    assert students[0]["native_name"] == "محمد الخطيب"


def test_frontend_routes_support_direct_navigation(client):
    for path in ("/", "/students", "/ceremonies", "/stage-control"):
        response = client.get(path)
        assert response.status_code == 200
        assert '<div id="root"></div>' in response.text
