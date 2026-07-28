"""Tests for reference-based camera color matching (camera_match.py).

Uses synthetic SOOC-style samples (with EXIF Model) written to a temp dir, so the
full pipeline — profile build, MKL transfer, and /grade wiring — is exercised
without any real camera photos.
"""

from io import BytesIO

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ExifTags

import main
import camera_match

_TAG = {name: tag for tag, name in ExifTags.TAGS.items()}
_G7X_MODEL = "Canon PowerShot G7 X Mark III"


def _write_sample(path, color, model=_G7X_MODEL, size=(400, 300), seed=0):
    """Write a JPEG with a color cast + texture (non-degenerate covariance) and EXIF."""
    rng = np.random.default_rng(seed)
    base = np.zeros((size[1], size[0], 3), dtype=np.float64) + np.asarray(color, dtype=np.float64)
    base += np.linspace(-30, 30, size[0])[None, :, None]  # horizontal gradient
    base += rng.normal(0, 8, base.shape)                   # sensor-like noise
    arr = np.clip(base, 0, 255).astype(np.uint8)
    exif = Image.Exif()
    exif[_TAG["Model"]] = model
    exif[_TAG["Make"]] = "Canon"
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(path, "JPEG", exif=exif.tobytes())


def _jpeg_bytes(color, size=(320, 240), seed=1):
    rng = np.random.default_rng(seed)
    base = np.zeros((size[1], size[0], 3), dtype=np.float64) + np.asarray(color, dtype=np.float64)
    base += rng.normal(0, 8, base.shape)
    buf = BytesIO()
    Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def warm_profile(tmp_path, monkeypatch):
    """Build a G7X profile from warm synthetic samples in a temp workspace."""
    samples = tmp_path / "camera_samples"
    profiles = tmp_path / "camera_profiles"
    monkeypatch.setattr(camera_match, "SAMPLES_DIR", samples)
    monkeypatch.setattr(camera_match, "PROFILES_DIR", profiles)

    warm = (185, 120, 80)  # strong orange/warm cast
    for scene in camera_match.SCENES:
        for i in range(2):
            _write_sample(samples / "g7x" / scene / f"{scene}_{i}.jpg", warm, seed=i + 1)

    profile = camera_match.build_profile("g7x")
    return profile


# ─── Profile building ─────────────────────────────────────────────────────────

def test_build_profile_produces_scene_stats(warm_profile):
    assert warm_profile["camera"] == "g7x"
    assert warm_profile["method"] == "mkl"
    assert "overall" in warm_profile["scenes"]
    for scene in camera_match.SCENES:
        assert scene in warm_profile["scenes"]
        stat = warm_profile["scenes"][scene]
        assert len(stat["mean"]) == 3 and np.array(stat["cov"]).shape == (3, 3)
        # Warm samples -> R mean clearly greater than B mean.
        assert stat["mean"][0] > stat["mean"][2] + 40


def test_build_profile_rejects_wrong_model(tmp_path, monkeypatch):
    samples = tmp_path / "camera_samples"
    profiles = tmp_path / "camera_profiles"
    monkeypatch.setattr(camera_match, "SAMPLES_DIR", samples)
    monkeypatch.setattr(camera_match, "PROFILES_DIR", profiles)
    # Wrong camera model in EXIF -> rejected -> no usable samples.
    _write_sample(samples / "g7x" / "skin" / "wrong.jpg", (185, 120, 80), model="Apple iPhone 15 Pro")
    with pytest.raises(ValueError):
        camera_match.build_profile("g7x")


def test_build_profile_no_verify_accepts_any(tmp_path, monkeypatch):
    samples = tmp_path / "camera_samples"
    profiles = tmp_path / "camera_profiles"
    monkeypatch.setattr(camera_match, "SAMPLES_DIR", samples)
    monkeypatch.setattr(camera_match, "PROFILES_DIR", profiles)
    for i in range(2):
        _write_sample(samples / "g7x" / "daylight" / f"x{i}.jpg", (185, 120, 80), model="Whatever Cam", seed=i)
    profile = camera_match.build_profile("g7x", verify_model=False)
    assert "daylight" in profile["scenes"]


# ─── Matching ─────────────────────────────────────────────────────────────────

def test_scene_of_mapping():
    assert camera_match.scene_of({"brightness": 0.5, "warmth": 0.0, "is_portrait": True}) == "skin"
    assert camera_match.scene_of({"brightness": 0.10, "warmth": 0.0, "is_portrait": False}) == "flash"
    assert camera_match.scene_of({"brightness": 0.70, "warmth": 0.0, "is_portrait": False}) == "daylight"
    assert camera_match.scene_of({"brightness": 0.40, "warmth": 0.0, "is_portrait": False}) == "indoor"


def test_match_moves_toward_reference(warm_profile):
    # Neutral source should shift warm (toward the reference cast).
    src = (128, 128, 128)
    src_bytes = _jpeg_bytes(src)
    result = camera_match.grade_with_reference(src_bytes, "g7x")
    assert result is not None
    jpeg, cam_id, scene, method = result
    assert cam_id == "g7x" and method == "reference"

    out_mean = np.asarray(Image.open(BytesIO(jpeg)).convert("RGB"), dtype=np.float64).reshape(-1, 3).mean(axis=0)
    # Red should rise and blue should fall, moving toward the reference's warm cast.
    #
    # Thresholds are deliberately modest: the transfer is per-channel, blended (~0.72),
    # mean-shift capped and luminance-preserving, because full-strength covariance
    # transport produced colour casts on real photos. We assert the *direction* of the
    # match plus a meaningful magnitude, not a maximal one.
    assert out_mean[0] > src[0] + 8
    assert out_mean[2] < src[2] - 5
    # And the warm shift must be ordered: red pulled up more than blue.
    assert (out_mean[0] - src[0]) > (out_mean[2] - src[2])


def test_grade_with_reference_returns_none_without_profile(tmp_path, monkeypatch):
    monkeypatch.setattr(camera_match, "PROFILES_DIR", tmp_path / "camera_profiles")
    assert camera_match.grade_with_reference(_jpeg_bytes((128, 128, 128)), "g7x") is None


# ─── /grade wiring ──────────────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    monkeypatch.setattr(main, "DATA_DIR", data_dir)
    monkeypatch.setattr(main, "UPLOADS_DIR", data_dir / "uploads")
    monkeypatch.setattr(main, "DB_PATH", data_dir / "vibecam.db")
    main._initialize_storage()
    with TestClient(main.app) as c:
        yield c


def test_grade_uses_reference_when_profile_exists(client, warm_profile):
    # warm_profile already patched camera_match.PROFILES_DIR to the temp profile.
    resp = client.post(
        "/grade",
        content=_jpeg_bytes((128, 128, 128)),
        headers={"content-type": "application/octet-stream", "X-Camera": "g7x"},
    )
    assert resp.status_code == 200
    assert resp.headers["X-Grade-Method"] == "reference"
    assert resp.headers["X-Grade-Preset-Id"] == "g7x"
    assert resp.headers["X-Grade-Preset-Name"] == "Canon G7X III"
    assert resp.headers.get("X-Grade-Scene")


def test_grade_falls_back_to_preset_without_profile(client, tmp_path, monkeypatch):
    # Point profiles at an empty dir so no profile is found.
    monkeypatch.setattr(camera_match, "PROFILES_DIR", tmp_path / "empty_profiles")
    resp = client.post(
        "/grade",
        content=_jpeg_bytes((128, 120, 95)),
        headers={"content-type": "application/octet-stream", "X-Camera": "g7x"},
    )
    assert resp.status_code == 200
    assert resp.headers["X-Grade-Method"] == "preset"
    assert resp.headers["X-Grade-Preset-Id"] == "g7x"
