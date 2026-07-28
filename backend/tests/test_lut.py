"""Tests for 3D LUT baking.

The important test here is fidelity: a baked LUT must reproduce the colour transform the
backend applies, otherwise the on-device preview would show a different look than the
developed photo.
"""

import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import lut  # noqa: E402
from grading import CAMERA_ORDER, apply_grade  # noqa: E402


def _photo(size=(96, 72), seed=3) -> Image.Image:
    """A deterministic pseudo-photo spanning a wide range of colours."""
    rng = np.random.default_rng(seed)
    base = rng.integers(15, 240, (size[1], size[0], 3), dtype=np.uint8)
    img = Image.fromarray(base)
    # Smooth it so it behaves like photographic content rather than pure noise.
    return img.resize((size[0] * 2, size[1] * 2)).resize(size)


# ─── Grid + format ──────────────────────────────────────────────────────────────

def test_identity_grid_shape_and_bounds():
    g = lut.identity_grid(17)
    assert g.shape == (17**3, 3)
    assert g.min() == 0.0 and g.max() == 255.0


def test_identity_grid_orders_red_fastest():
    """The .cube spec requires red to vary fastest; a wrong order scrambles the LUT."""
    g = lut.identity_grid(4)
    # First four entries: red climbs, green and blue stay at 0.
    assert list(g[0]) == [0, 0, 0]
    assert g[1][0] > g[0][0]
    assert g[1][1] == 0 and g[1][2] == 0
    # After `size` entries, green has advanced.
    assert g[4][1] > g[0][1]


def test_grid_image_round_trip_is_stable():
    """The cube is carried through an 8-bit image, so sample points quantise.

    With size 17 the sample spacing is 255/16 = 15.9375, which isn't an integer, so a
    round-trip rounds by up to half a level. That's a sub-quantisation-step error on the
    LUT's *sample positions* and is visually irrelevant; asserting exact equality would
    be asserting something the format can't provide.
    """
    g = lut.identity_grid(17)
    back = lut.image_to_grid(lut.grid_to_image(g, 17))
    assert np.abs(g - back).max() <= 1.0


def test_identity_lut_leaves_an_image_unchanged():
    """Sanity check on the interpolator itself."""
    g = lut.identity_grid(17)
    src = _photo()
    out = lut.apply_lut(src, g, 17)
    diff = np.abs(np.asarray(out, np.float32) - np.asarray(src, np.float32))
    # Trilinear interpolation of an identity table is exact to within rounding.
    assert diff.max() <= 2.0


def test_write_and_read_cube_round_trip(tmp_path):
    g = lut.identity_grid(9)
    p = tmp_path / "t.cube"
    lut.write_cube(p, g, 9, "Test LUT")
    grid, size = lut.read_cube(p)
    assert size == 9
    assert grid.shape == g.shape
    assert np.abs(grid - g).max() < 0.6   # 6-decimal text precision


def test_cube_file_has_required_headers(tmp_path):
    p = tmp_path / "t.cube"
    lut.write_cube(p, lut.identity_grid(5), 5, "My Look")
    text = p.read_text(encoding="utf-8")
    assert 'TITLE "My Look"' in text
    assert "LUT_3D_SIZE 5" in text
    assert "DOMAIN_MIN 0.0 0.0 0.0" in text
    assert "DOMAIN_MAX 1.0 1.0 1.0" in text


def test_read_cube_rejects_a_file_without_size(tmp_path):
    p = tmp_path / "bad.cube"
    p.write_text("0.0 0.0 0.0\n", encoding="utf-8")
    with pytest.raises(ValueError):
        lut.read_cube(p)


def test_read_cube_rejects_truncated_data(tmp_path):
    p = tmp_path / "short.cube"
    p.write_text("LUT_3D_SIZE 4\n0.0 0.0 0.0\n", encoding="utf-8")
    with pytest.raises(ValueError):
        lut.read_cube(p)


# ─── Baking ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("camera", CAMERA_ORDER)
def test_bake_produces_a_valid_grid_for_every_camera(camera):
    g = lut.bake_camera_lut(camera, 9)
    assert g.shape == (9**3, 3)
    assert np.isfinite(g).all()
    assert g.min() >= 0 and g.max() <= 255


def test_bake_rejects_unknown_camera():
    with pytest.raises(ValueError):
        lut.bake_camera_lut("hasselblad", 9)


def test_baked_luts_differ_between_cameras():
    a = lut.bake_camera_lut("ccd", 9)
    b = lut.bake_camera_lut("gr", 9)
    assert np.abs(a - b).mean() > 1.0


def test_baked_lut_is_not_the_identity():
    g = lut.bake_camera_lut("ccd", 9)
    assert np.abs(g - lut.identity_grid(9)).mean() > 1.0


def test_bake_is_deterministic():
    a = lut.bake_camera_lut("x100", 9)
    b = lut.bake_camera_lut("x100", 9)
    assert np.array_equal(a, b)


def test_build_all_writes_every_camera(tmp_path):
    written = lut.build_all(size=9, out_dir=tmp_path)
    assert set(written) == set(CAMERA_ORDER)
    for camera, path in written.items():
        assert path.exists(), camera
        grid, size = lut.read_cube(path)
        assert size == 9
        assert grid.shape == (9**3, 3)


# ─── Fidelity: the LUT must match the server-side look ──────────────────────────

@pytest.mark.parametrize("camera", CAMERA_ORDER)
def test_lut_reproduces_the_colour_transform(camera):
    """A LUT-rendered photo must closely match the backend's colour-only grade.

    Compared against apply_grade(spatial=False): grain and vignette depend on pixel
    position or randomness, so they cannot live in a LUT and are applied separately by
    the shader. If this drifts, the on-device preview stops matching the developed photo.
    """
    src = _photo()
    expected = np.asarray(apply_grade(src, camera, spatial=False), dtype=np.float32)

    grid = lut.bake_camera_lut(camera, 17)
    actual = np.asarray(lut.apply_lut(src, grid, 17), dtype=np.float32)

    mean_err = np.abs(expected - actual).mean()
    assert mean_err < 2.0, f"{camera}: mean channel error {mean_err:.2f}/255 is too high"


def test_png_strip_round_trip_is_exact(tmp_path):
    """PNG is lossless, so the strip the app loads must match the baked grid exactly."""
    grid = lut.bake_camera_lut("g7x", 17)
    p = tmp_path / "g7x.png"
    lut.write_png_strip(p, grid, 17)
    back = lut.read_png_strip(p, 17)
    assert np.array_equal(np.clip(grid, 0, 255).astype(np.uint8), back.astype(np.uint8))


def test_png_strip_dimensions(tmp_path):
    p = tmp_path / "t.png"
    lut.write_png_strip(p, lut.identity_grid(17), 17)
    with Image.open(p) as img:
        assert img.size == (17 * 17, 17)


def test_png_strip_rejects_wrong_size(tmp_path):
    p = tmp_path / "t.png"
    lut.write_png_strip(p, lut.identity_grid(9), 9)
    with pytest.raises(ValueError):
        lut.read_png_strip(p, 17)


def test_build_all_can_emit_png_strips(tmp_path):
    cubes = tmp_path / "cube"
    pngs = tmp_path / "png"
    lut.build_all(size=9, out_dir=cubes, png_dir=pngs)
    for camera in CAMERA_ORDER:
        assert (cubes / f"{camera}.cube").exists()
        assert (pngs / f"{camera}.png").exists()


def test_shipped_luts_match_the_current_looks():
    """The committed app assets must match what the code bakes today.

    If a camera's colour parameters change without re-running tools/build_luts.py, the
    on-device preview silently drifts from the backend render. This test fails loudly
    instead.
    """
    shipped = Path(__file__).resolve().parents[2] / "mobile" / "assets" / "luts"
    if not shipped.exists():
        pytest.skip("LUT assets not built")
    for camera in CAMERA_ORDER:
        path = shipped / f"{camera}.png"
        assert path.exists(), f"missing shipped LUT for {camera}"
        expected = np.clip(lut.bake_camera_lut(camera, lut.DEFAULT_SIZE), 0, 255).astype(np.uint8)
        actual = lut.read_png_strip(path, lut.DEFAULT_SIZE).astype(np.uint8)
        assert np.array_equal(expected, actual), (
            f"{camera}.png is stale — re-run: cd backend && python tools/build_luts.py"
        )


def test_lut_error_is_bounded_not_just_small_on_average():
    """Guard against a look that matches on average but breaks in one colour region."""
    src = _photo()
    expected = np.asarray(apply_grade(src, "ccd", spatial=False), dtype=np.float32)
    grid = lut.bake_camera_lut("ccd", 17)
    actual = np.asarray(lut.apply_lut(src, grid, 17), dtype=np.float32)
    # 99th percentile keeps a handful of rounding outliers from failing the run.
    assert np.percentile(np.abs(expected - actual), 99) < 6.0


def test_larger_lut_is_at_least_as_accurate():
    """More sample points should not make the approximation worse."""
    src = _photo()
    expected = np.asarray(apply_grade(src, "ccd", spatial=False), dtype=np.float32)

    def err(size: int) -> float:
        grid = lut.bake_camera_lut("ccd", size)
        got = np.asarray(lut.apply_lut(src, grid, size), dtype=np.float32)
        return float(np.abs(expected - got).mean())

    assert err(17) <= err(5) + 0.5


def test_spatial_flag_removes_grain_and_vignette():
    """The flag LUT baking depends on must actually change behaviour.

    Grain is measured on a flat frame: on photographic content, removing the vignette
    also changes global spread, so overall std can't isolate grain.
    """
    flat = Image.new("RGB", (96, 72), (120, 120, 120))
    with_grain = np.asarray(apply_grade(flat, "ccd", spatial=True), dtype=np.float32)
    without = np.asarray(apply_grade(flat, "ccd", spatial=False), dtype=np.float32)
    assert not np.array_equal(with_grain, without)

    # A flat frame graded without spatial effects stays spatially flat. Measured
    # per channel, since the grade shifts each channel to a different level and
    # cross-channel spread would mask the thing being tested.
    assert without.std(axis=(0, 1)).max() < 1.0
    # With grain and vignette it varies across the frame.
    assert with_grain.std(axis=(0, 1)).max() > 2.0

    # Vignette darkens corners; without it, corners are brighter.
    h, w = without.shape[:2]
    assert without[: h // 6, : w // 6].mean() > with_grain[: h // 6, : w // 6].mean()
