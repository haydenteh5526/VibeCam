"""Tests for the point-and-shoot effects layer and its /grade header wiring."""

import io
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import effects  # noqa: E402
import main  # noqa: E402


def _img(color=(90, 90, 90), size=(320, 240)) -> Image.Image:
    return Image.new("RGB", size, color)


def _jpeg(color=(90, 90, 90), size=(320, 240)) -> bytes:
    buf = io.BytesIO()
    _img(color, size).save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _mean(img: Image.Image) -> float:
    return float(np.asarray(img, dtype=np.float64).mean())


# ─── EffectOptions ──────────────────────────────────────────────────────────────

def test_no_effects_by_default():
    assert effects.EffectOptions().any_enabled() is False


def test_any_enabled_detects_each_effect():
    assert effects.EffectOptions(date_stamp=True).any_enabled()
    assert effects.EffectOptions(frame="white").any_enabled()
    assert effects.EffectOptions(light_leak=0.2).any_enabled()
    assert effects.EffectOptions(dust=0.2).any_enabled()


def test_apply_effects_noop_returns_equivalent_image():
    src = _img()
    out = effects.apply_effects(src, "g7x", effects.EffectOptions())
    assert np.array_equal(np.asarray(src), np.asarray(out))


# ─── Date stamp ─────────────────────────────────────────────────────────────────

def test_date_stamp_brightens_bottom_right_only():
    src = _img((60, 60, 60))
    out = np.asarray(
        effects.add_date_stamp(src, "ccd", when=datetime(2003, 8, 14)), dtype=np.float64
    ).mean(axis=2)
    h, w = out.shape
    br = out[int(h * 0.80):, int(w * 0.55):].mean()
    tl = out[: int(h * 0.4), : int(w * 0.4)].mean()
    assert br > 60.5, "stamp should light up the bottom-right corner"
    assert abs(tl - 60) < 0.5, "top-left should be untouched"


def test_date_stamp_is_warm():
    """Real LED stamps are orange: red must dominate blue."""
    src = _img((40, 40, 40))
    out = np.asarray(effects.add_date_stamp(src, "ccd", when=datetime(2001, 1, 1)), dtype=np.float64)
    h, w = out.shape[:2]
    region = out[int(h * 0.75):, int(w * 0.5):]
    assert region[:, :, 0].mean() > region[:, :, 2].mean() + 1.0


def test_date_stamp_custom_text_and_size_preserved():
    src = _img()
    out = effects.add_date_stamp(src, "g7x", text="'99 12 31")
    assert out.size == src.size


def test_date_stamp_handles_unknown_characters():
    """Unmapped characters must not raise — they just render blank."""
    out = effects.add_date_stamp(_img(), "g7x", text="XY!@")
    assert out.size == (320, 240)


# ─── Frames ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("style", ["white", "black", "print"])
def test_frame_grows_the_canvas(style):
    src = _img()
    out = effects.add_frame(src, style)
    assert out.size[0] > src.size[0] and out.size[1] > src.size[1]


def test_print_frame_has_a_wider_base():
    """A lab print leaves extra room at the bottom."""
    src = _img(size=(300, 300))
    out = effects.add_frame(src, "print")
    # Taller growth than wide growth means the base is deeper than the side margins.
    assert (out.size[1] - 300) > (out.size[0] - 300)


def test_black_frame_is_dark_and_white_frame_is_light():
    src = _img((128, 128, 128))
    black = np.asarray(effects.add_frame(src, "black"), dtype=np.float64)
    white = np.asarray(effects.add_frame(src, "white"), dtype=np.float64)
    assert black[0, 0].mean() < 40
    assert white[0, 0].mean() > 200


# ─── Light leak + dust ──────────────────────────────────────────────────────────

def test_light_leak_adds_light_and_is_warm():
    src = _img((70, 70, 70))
    out = effects.add_light_leak(src, 0.7, seed=3)
    assert _mean(out) > _mean(src)
    arr = np.asarray(out, dtype=np.float64)
    assert arr[:, :, 0].mean() > arr[:, :, 2].mean()


def test_light_leak_is_deterministic_per_seed():
    src = _img()
    a = np.asarray(effects.add_light_leak(src, 0.5, seed=42))
    b = np.asarray(effects.add_light_leak(src, 0.5, seed=42))
    c = np.asarray(effects.add_light_leak(src, 0.5, seed=43))
    assert np.array_equal(a, b), "same seed must reproduce the same leak"
    assert not np.array_equal(a, c), "different seed should differ"


def test_zero_strength_effects_are_noops():
    src = _img()
    assert np.array_equal(np.asarray(effects.add_light_leak(src, 0.0)), np.asarray(src))
    assert np.array_equal(np.asarray(effects.add_dust(src, 0.0)), np.asarray(src))


def test_dust_adds_specks_without_shifting_overall_exposure_much():
    src = _img((100, 100, 100))
    out = effects.add_dust(src, 0.8, seed=5)
    assert np.asarray(out, dtype=np.float64).std() > 0.5   # specks introduce variance
    assert abs(_mean(out) - 100) < 6                       # but it stays subtle


def test_dust_is_deterministic_per_seed():
    src = _img()
    a = np.asarray(effects.add_dust(src, 0.6, seed=9))
    b = np.asarray(effects.add_dust(src, 0.6, seed=9))
    assert np.array_equal(a, b)


def test_combined_effects_apply_all_of_them():
    src = _img((80, 80, 80))
    out = effects.apply_effects(
        src,
        "powershot",
        effects.EffectOptions(date_stamp=True, frame="white", light_leak=0.4, dust=0.4, seed=11),
    )
    assert out.size[0] > src.size[0]      # frame added
    assert _mean(out) > _mean(src)        # leak/stamp added light


# ─── /grade header wiring ───────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    monkeypatch.setattr(main, "DATA_DIR", data_dir)
    monkeypatch.setattr(main, "UPLOADS_DIR", data_dir / "uploads")
    monkeypatch.setattr(main, "DB_PATH", data_dir / "vibecam.db")
    main._initialize_storage()
    return TestClient(main.app)


def _post(client, **extra):
    headers = {"Content-Type": "application/octet-stream", "X-Camera": "g7x"}
    headers.update(extra)
    return client.post("/grade", content=_jpeg(), headers=headers)


def test_grade_without_effect_headers_succeeds(client):
    r = _post(client)
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"


def test_frame_header_enlarges_the_output(client):
    plain = Image.open(io.BytesIO(_post(client).content))
    framed = Image.open(io.BytesIO(_post(client, **{"X-Frame": "print"}).content))
    assert framed.size[0] > plain.size[0]


def test_invalid_frame_value_is_ignored(client):
    plain = Image.open(io.BytesIO(_post(client).content))
    bogus = Image.open(io.BytesIO(_post(client, **{"X-Frame": "; rm -rf /"}).content))
    assert bogus.size == plain.size


def test_date_stamp_header_changes_the_image(client):
    plain = np.asarray(Image.open(io.BytesIO(_post(client).content)), dtype=np.float64)
    stamped = np.asarray(
        Image.open(io.BytesIO(_post(client, **{"X-Date-Stamp": "1"}).content)), dtype=np.float64
    )
    assert stamped.mean() > plain.mean()


def test_character_strength_zero_is_gentler_than_full(client):
    """X-Character: 0 should skip the character layer, leaving less added noise."""
    off = np.asarray(
        Image.open(io.BytesIO(_post(client, **{"X-Character": "0"}).content)), dtype=np.float64
    )
    on = np.asarray(
        Image.open(io.BytesIO(_post(client, **{"X-Character": "1"}).content)), dtype=np.float64
    )
    assert off.std() < on.std()


def test_malformed_numeric_headers_fall_back_to_defaults(client):
    r = _post(client, **{"X-Light-Leak": "banana", "X-Dust": "", "X-Seed": "nope", "X-Character": "abc"})
    assert r.status_code == 200


def test_seed_header_makes_leaks_reproducible(client):
    a = _post(client, **{"X-Light-Leak": "0.6", "X-Seed": "77"}).content
    b = _post(client, **{"X-Light-Leak": "0.6", "X-Seed": "77"}).content
    assert a == b
