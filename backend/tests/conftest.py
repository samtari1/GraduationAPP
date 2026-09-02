import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'test.sqlite3'}")
    monkeypatch.setenv("GRAD_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GRAD_STORAGE_DIR", str(tmp_path / "storage"))
    import importlib
    import backend.app.database as database
    import backend.app.main as main

    importlib.reload(database)
    import backend.app.models as models
    importlib.reload(models)
    importlib.reload(main)
    with TestClient(main.app) as test_client:
        yield test_client

