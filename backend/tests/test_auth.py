"""Tests for the optional shared-secret (X-API-Key) gate.

The gate is read from VIBECAM_API_KEY at import time, so these tests reload the
app module with the env var set/unset rather than mutating a live app.
"""

import importlib
import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _load_app(monkeypatch, key: str | None):
    """Import a fresh copy of main with VIBECAM_API_KEY set to `key`."""
    if key is None:
        monkeypatch.delenv("VIBECAM_API_KEY", raising=False)
    else:
        monkeypatch.setenv("VIBECAM_API_KEY", key)
    sys.modules.pop("main", None)
    return importlib.import_module("main")


def _jpeg_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (120, 110, 100)).save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _restore_main():
    yield
    # Leave a clean, unkeyed `main` for the other test modules.
    sys.modules.pop("main", None)


def test_open_when_key_unset(monkeypatch):
    main = _load_app(monkeypatch, None)
    client = TestClient(main.app)
    assert client.get("/health").status_code == 200
    assert client.get("/cameras").status_code == 200


def test_rejects_missing_key(monkeypatch):
    main = _load_app(monkeypatch, "s3cret")
    client = TestClient(main.app)
    r = client.get("/cameras")
    assert r.status_code == 401
    assert "X-API-Key" in r.json()["detail"]


def test_rejects_wrong_key(monkeypatch):
    main = _load_app(monkeypatch, "s3cret")
    client = TestClient(main.app)
    assert client.get("/cameras", headers={"X-API-Key": "nope"}).status_code == 401


def test_accepts_correct_key(monkeypatch):
    main = _load_app(monkeypatch, "s3cret")
    client = TestClient(main.app)
    assert client.get("/cameras", headers={"X-API-Key": "s3cret"}).status_code == 200


def test_health_stays_public_for_platform_checks(monkeypatch):
    """Render's health check can't send the key, so /health must stay open."""
    main = _load_app(monkeypatch, "s3cret")
    client = TestClient(main.app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "vibecam-backend"
    assert "timestamp_utc" in body


def test_grade_is_gated(monkeypatch):
    main = _load_app(monkeypatch, "s3cret")
    client = TestClient(main.app)
    img = _jpeg_bytes()
    unauth = client.post(
        "/grade", content=img, headers={"Content-Type": "application/octet-stream", "X-Camera": "g7x"}
    )
    assert unauth.status_code == 401

    ok = client.post(
        "/grade",
        content=img,
        headers={
            "Content-Type": "application/octet-stream",
            "X-Camera": "g7x",
            "X-API-Key": "s3cret",
        },
    )
    assert ok.status_code == 200
    assert ok.headers["content-type"] == "image/jpeg"


def test_uploads_are_gated(monkeypatch):
    main = _load_app(monkeypatch, "s3cret")
    client = TestClient(main.app)
    body = {"file_name": "a.jpg", "mime_type": "image/jpeg", "size_bytes": 10}
    assert client.post("/uploads/init", json=body).status_code == 401
    assert (
        client.post("/uploads/init", json=body, headers={"X-API-Key": "s3cret"}).status_code == 200
    )
