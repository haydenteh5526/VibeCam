"""Tests for the optical/sensor character layer.

Colour transfer alone reads as a filter; these assert the *physical* traits
(vignette falloff, highlight bloom, sensor noise, per-camera differentiation)
actually land on the image.
"""

import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import character  # noqa: E402


def _flat(color=(128, 128, 128), size=(240, 180)) -> Image.Image:
    return Image.new("RGB", size, color)


def _with_highlight() -> Image.Image:
    img = Image.new("RGB", (240, 180), (40, 40, 40))
    arr = np.asarray(img).copy()
    arr[70:110, 100:140] = 255  # blown highlight patch
    return Image.fromarray(arr)


def _mean(img: Image.Image) -> np.ndarray:
    return np.asarray(img, dtype=np.float64).reshape(-1, 3).mean(axis=0)


def test_every_camera_has_character():
    from grading import CAMERA_ORDER

    for cam in CAMERA_ORDER:
        assert character.has_character(cam), f"{cam} has no character profile"


def test_unknown_camera_passes_through_unchanged():
    src = _flat()
    out = character.apply_character(src, "not_a_camera")
    assert np.array_equal(np.asarray(src), np.asarray(out))


def test_zero_strength_is_a_no_op():
    src = _flat()
    out = character.apply_character(src, "ccd", strength=0)
    assert np.array_equal(np.asarray(src), np.asarray(out))


def test_output_shape_and_mode_preserved():
    src = _flat(size=(200, 150))
    out = character.apply_character(src, "g7x")
    assert out.size == src.size
    assert out.mode == "RGB"


def test_vignette_darkens_corners_more_than_centre():
    src = _flat((160, 160, 160))
    out = np.asarray(character.apply_character(src, "ccd"), dtype=np.float64).mean(axis=2)
    h, w = out.shape
    centre = out[h // 2 - 8 : h // 2 + 8, w // 2 - 8 : w // 2 + 8].mean()
    corners = np.concatenate([
        out[:12, :12].ravel(), out[:12, -12:].ravel(),
        out[-12:, :12].ravel(), out[-12:, -12:].ravel(),
    ]).mean()
    assert corners < centre, "corners should fall off relative to the centre"


def test_grain_adds_variation_to_a_flat_frame():
    src = _flat((120, 120, 120))
    before = np.asarray(src, dtype=np.float64).std()
    after = np.asarray(character.apply_character(src, "ccd"), dtype=np.float64).std()
    assert before < 0.01  # flat by construction
    assert after > 1.5, "sensor noise should introduce variation"


def test_ccd_is_noisier_than_rx100():
    """The Y2K digicam should be visibly grittier than the clean 1-inch Sony."""
    src = _flat((110, 110, 110))
    ccd = np.asarray(character.apply_character(src, "ccd"), dtype=np.float64).std()
    rx = np.asarray(character.apply_character(src, "rx100"), dtype=np.float64).std()
    assert ccd > rx * 1.3


def test_halation_blooms_around_highlights():
    src = _with_highlight()
    out = np.asarray(character.apply_character(src, "ccd"), dtype=np.float64).mean(axis=2)
    base = np.asarray(src, dtype=np.float64).mean(axis=2)
    # A ring just outside the blown patch should gain light from the bloom.
    ring_out = out[60:70, 100:140].mean()
    ring_base = base[60:70, 100:140].mean()
    assert ring_out > ring_base + 1.0


def test_cameras_produce_distinguishable_results():
    src = _flat((130, 125, 120))
    means = {}
    for cam in ("g7x", "rx100", "gr", "x100", "ccd", "powershot"):
        means[cam] = _mean(character.apply_character(src, cam))
    # No two cameras should land on effectively the same rendering.
    keys = list(means)
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            d = np.abs(means[keys[i]] - means[keys[j]]).sum()
            assert d > 0.5, f"{keys[i]} and {keys[j]} are nearly identical"


@pytest.mark.parametrize("scene", ["skin", "daylight", "indoor", "flash", "overall", None])
def test_scene_modifiers_are_accepted(scene):
    out = character.apply_character(_flat(), "g7x", scene=scene)
    assert out.size == (240, 180)


def test_indoor_is_noisier_than_daylight():
    """Dim scenes mean more sensor gain, so more noise."""
    src = _flat((100, 100, 100))
    indoor = np.asarray(character.apply_character(src, "g7x", "indoor"), dtype=np.float64).std()
    day = np.asarray(character.apply_character(src, "g7x", "daylight"), dtype=np.float64).std()
    assert indoor > day


def test_highlight_rolloff_compresses_bright_values():
    bright = _flat((250, 250, 250))
    out = _mean(character.apply_character(bright, "ccd"))
    # Rolloff should pull near-clipped values down rather than leaving them pinned.
    assert out.mean() < 250
