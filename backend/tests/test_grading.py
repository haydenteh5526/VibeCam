"""Tests for the point-and-shoot camera emulation grading path.

Covers GET /cameras, POST /grade with the X-Camera header (explicit id, auto,
missing, and unknown), plus unit coverage of grade_image() and pick_best_camera().
"""

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
import grading


@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    uploads_dir = data_dir / "uploads"
    db_path = data_dir / "vibecam.db"

    monkeypatch.setattr(main, "DATA_DIR", data_dir)
    monkeypatch.setattr(main, "UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(main, "DB_PATH", db_path)
    main._initialize_storage()

    with TestClient(main.app) as test_client:
        yield test_client


def _jpeg(color=(130, 120, 95), size=(96, 72)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


# ─── GET /cameras ───────────────────────────────────────────────────────────

def test_cameras_endpoint_lists_all_emulations(client: TestClient) -> None:
    response = client.get("/cameras")

    assert response.status_code == 200
    cameras = response.json()

    # One entry per emulation, in the documented order.
    ids = [c["id"] for c in cameras]
    assert ids == grading.CAMERA_ORDER
    assert "g7x" in ids and "ccd" in ids

    for cam in cameras:
        assert cam["id"] and isinstance(cam["id"], str)
        assert cam["name"] and isinstance(cam["name"], str)
        assert cam["description"] and isinstance(cam["description"], str)


# ─── POST /grade with X-Camera ────────────────────────────────────────────────

@pytest.mark.parametrize("camera_id", grading.CAMERA_ORDER)
def test_grade_applies_explicit_camera(client: TestClient, camera_id: str) -> None:
    response = client.post(
        "/grade",
        content=_jpeg(),
        headers={"content-type": "application/octet-stream", "X-Camera": camera_id},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    # The exact requested camera look is applied and echoed back.
    assert response.headers["X-Grade-Preset-Id"] == camera_id
    assert response.headers["X-Grade-Preset-Name"] == grading.CAMERAS[camera_id]["name"]
    assert len(response.content) > 0
    # Output is a valid, decodable JPEG.
    assert Image.open(BytesIO(response.content)).format == "JPEG"


def test_grade_auto_resolves_to_a_camera(client: TestClient) -> None:
    response = client.post(
        "/grade",
        content=_jpeg(),
        headers={"content-type": "application/octet-stream", "X-Camera": "auto"},
    )

    assert response.status_code == 200
    assert response.headers["X-Grade-Preset-Id"] in grading.CAMERA_ORDER


def test_grade_without_header_defaults_to_a_camera(client: TestClient) -> None:
    response = client.post(
        "/grade",
        content=_jpeg(),
        headers={"content-type": "application/octet-stream"},
    )

    assert response.status_code == 200
    assert response.headers["X-Grade-Preset-Id"] in grading.CAMERA_ORDER


def test_grade_unknown_camera_falls_back_to_auto(client: TestClient) -> None:
    response = client.post(
        "/grade",
        content=_jpeg(),
        headers={"content-type": "application/octet-stream", "X-Camera": "nikon-d850"},
    )

    assert response.status_code == 200
    # Unknown ids never 500 — they degrade gracefully to an auto-picked camera.
    assert response.headers["X-Grade-Preset-Id"] in grading.CAMERA_ORDER


def test_grade_rejects_wrong_content_type(client: TestClient) -> None:
    response = client.post(
        "/grade",
        content=_jpeg(),
        headers={"content-type": "text/plain", "X-Camera": "g7x"},
    )

    assert response.status_code == 415


# ─── Unit: grade_image + pick_best_camera ─────────────────────────────────────

def test_grade_image_honors_explicit_id() -> None:
    graded, resolved_id, name = grading.grade_image(_jpeg(), "rx100")

    assert resolved_id == "rx100"
    assert name == grading.CAMERAS["rx100"]["name"]
    assert Image.open(BytesIO(graded)).format == "JPEG"


def test_grade_image_auto_picks_a_camera() -> None:
    _, resolved_id, _ = grading.grade_image(_jpeg())
    assert resolved_id in grading.CAMERA_ORDER


@pytest.mark.parametrize(
    "analysis, expected",
    [
        ({"brightness": 0.10, "warmth": 0.00, "is_portrait": False}, "ccd"),    # dark
        ({"brightness": 0.50, "warmth": 0.00, "is_portrait": True}, "g7x"),     # portrait
        ({"brightness": 0.50, "warmth": 0.20, "is_portrait": False}, "g7x"),    # warm
        ({"brightness": 0.70, "warmth": 0.00, "is_portrait": False}, "rx100"),  # bright
        ({"brightness": 0.40, "warmth": 0.00, "is_portrait": False}, "gr"),     # default
    ],
)
def test_pick_best_camera(analysis: dict, expected: str) -> None:
    assert grading.pick_best_camera(analysis) == expected
