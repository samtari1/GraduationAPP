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


def test_duplicate_student_id_is_rejected(client):
    payload = {"student_id": "S-200", "display_name": "First Student"}
    assert client.post("/api/students", json=payload).status_code == 201
    assert client.post("/api/students", json=payload).status_code == 409


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
