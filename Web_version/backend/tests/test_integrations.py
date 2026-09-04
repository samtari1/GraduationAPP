import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from backend.scanner_bridge import ScanFrames


def student(client, sid="007", name="Nguyễn Minh Anh"):
    response = client.post("/api/students", json={"student_id": sid, "display_name": name})
    assert response.status_code == 201
    return response.json()


def generate(client, monkeypatch, person):
    from backend.app import google_speech
    monkeypatch.setattr(google_speech, "synthesize", lambda *args: b"ID3-test-audio")
    response = client.post(f"/api/students/{person['id']}/speech", json={
        "text": person["display_name"], "language_code": "vi-VN",
        "voice_name": "vi-VN-Standard-A", "speaking_rate": 1.0,
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_candidate_generation_approval_and_offline_playback(client, monkeypatch):
    person = student(client)
    first = generate(client, monkeypatch, person)
    assert not first["approved"]
    assert json.loads(first["generation_input"])["language_code"] == "vi-VN"
    assert client.get("/api/students").json()[0]["active_audio_id"] is None
    assert client.post(f"/api/students/{person['id']}/audio/{first['id']}/approve").status_code == 200
    second = generate(client, monkeypatch, person)
    assert second["filename"] != first["filename"]
    assert client.get("/api/students").json()[0]["active_audio_id"] == first["id"]
    assert len(client.get(f"/api/students/{person['id']}/audio").json()) == 2
    from backend.app import google_speech
    def unavailable(*args):
        raise HTTPException(502, "Provider unavailable")
    monkeypatch.setattr(google_speech, "synthesize", unavailable)
    assert client.get(first["url"]).content == b"ID3-test-audio"
    response = client.post(f"/api/students/{person['id']}/speech", json={
        "text": "Retry", "language_code": "vi-VN", "voice_name": "test", "speaking_rate": 1,
    })
    assert response.status_code == 502
    assert client.get("/api/students").json()[0]["active_audio_id"] == first["id"]
    assert len(client.get(f"/api/students/{person['id']}/audio").json()) == 2


def test_changed_pronunciation_invalidates_approval(client, monkeypatch):
    person = student(client)
    candidate = generate(client, monkeypatch, person)
    approve = f"/api/students/{person['id']}/audio/{candidate['id']}/approve"
    assert client.post(approve).status_code == 200
    changed = client.patch(f"/api/students/{person['id']}", json={
        "display_name": "Updated pronunciation", "pronunciation_status": "approved"})
    assert changed.json()["pronunciation_status"] == "needs_review"
    assert client.post(approve).status_code == 409
    another = student(client, "008")
    assert client.post(f"/api/students/{another['id']}/audio/{candidate['id']}/approve").status_code == 404


def test_repeat_scans_are_idempotent_and_do_not_call_google(client, monkeypatch):
    from backend.app import google_speech
    monkeypatch.setattr(google_speech, "get_client", lambda: pytest.fail("Scan must not contact Google"))
    person = student(client)
    ceremony = client.post("/api/ceremonies", json={"name": "Graduation", "event_date": "2027-05-01"}).json()
    client.post(f"/api/ceremonies/{ceremony['id']}/students", json={"student_id": person["id"]})
    endpoint = f"/api/ceremonies/{ceremony['id']}/scan"
    first = client.post(endpoint, json={"token": person["qr_token"]}).json()
    client.post(f"/api/entries/{first['id']}/action", json={"action": "queue"})
    repeated = client.post(endpoint, json={"token": "007\r\n"}).json()
    assert repeated["checked_in_at"] == first["checked_in_at"]
    assert repeated["status"] == "queued"
    scans = [event for event in client.get("/api/audit").json() if event["event_type"] == "ceremony.scanned"]
    assert len(scans) == 1


def test_coworker_csv_and_qr_token(client, monkeypatch):
    import qrcode
    original_make = qrcode.make
    payloads = []
    def capture(data, **kwargs):
        payloads.append(data)
        return original_make(data, **kwargs)
    monkeypatch.setattr(qrcode, "make", capture)
    csv = "StudentID,FirstName,LastName,Pronunciation\n001,Minh,Nguyễn,meen ngwin\n"
    response = client.post("/api/students/import", files={"file": ("roster.csv", csv.encode(), "text/csv")})
    assert response.json()["created"] == 1
    person = client.get("/api/students").json()[0]
    assert person["student_id"] == "001"
    assert person["display_name"] == "Minh Nguyễn"
    assert person["phonetic_spelling"] == "meen ngwin"
    qr = client.get(f"/api/students/{person['id']}/qr.svg")
    assert qr.status_code == 200
    assert "<svg" in qr.text
    assert payloads == [person["qr_token"]]
    assert person["student_id"] != person["qr_token"]


def test_print_cards_escape_names(client):
    person = student(client, name='<script>alert("x")</script>')
    ceremony = client.post("/api/ceremonies", json={"name": "A & B", "event_date": "2027-05-01"}).json()
    client.post(f"/api/ceremonies/{ceremony['id']}/students", json={"student_id": person["id"]})
    page = client.get(f"/api/ceremonies/{ceremony['id']}/qr-cards")
    assert page.status_code == 200
    assert "<script>" not in page.text
    assert "&lt;script&gt;" in page.text
    assert "A &amp; B" in page.text


def test_serial_frames():
    frames = ScanFrames()
    assert frames.feed(b"00") == []
    assert frames.feed(b"1\r\n002\n003\r") == ["001", "002", "003"]
    assert frames.feed(b"x" * 300 + b"\r004\r") == ["004"]
    assert frames.feed(b"\xff\r005\r") == ["005"]


def test_google_adapter_passes_voice_language_and_speed(monkeypatch):
    from backend.app import google_speech
    client = MagicMock()
    client.synthesize_speech.return_value.audio_content = b"MP3"
    monkeypatch.setattr(google_speech, "get_client", lambda: client)
    assert google_speech.synthesize("Nguyễn", "vi-VN", "vi-VN-Standard-A", .85) == b"MP3"
    args = client.synthesize_speech.call_args.kwargs
    assert args["input"].text == "Nguyễn"
    assert args["voice"].language_code == "vi-VN"
    assert args["audio_config"].speaking_rate == .85
    assert args["retry"] is None
    client.transport.close.assert_called_once()


def test_google_adapter_filters_bare_voice_aliases(monkeypatch):
    from backend.app import google_speech
    from google.cloud import texttospeech

    client = MagicMock()
    bare = SimpleNamespace(name="Achernar", language_codes=["en-US"],
                           ssml_gender=texttospeech.SsmlVoiceGender.FEMALE)
    full = SimpleNamespace(name="en-US-Chirp3-HD-Achernar", language_codes=["en-US"],
                           ssml_gender=texttospeech.SsmlVoiceGender.FEMALE)
    client.list_voices.return_value.voices = [bare, full]
    monkeypatch.setattr(google_speech, "get_client", lambda: client)

    voices = google_speech.list_voices("en-US")

    assert [voice["name"] for voice in voices] == ["en-US-Chirp3-HD-Achernar"]
    client.transport.close.assert_called_once()
