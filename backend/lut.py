"""Bake each camera's colour transform into a 3D LUT.

Why: grading currently requires a round-trip to this backend, so the viewfinder can't
show the real look and capture waits on the network. A 3D LUT is a lookup table over RGB
space that a GPU shader can apply in a single pass, which makes the look available live
on device and offline.

What a LUT can and cannot carry:
  - CAN: the colour/tone transform — white balance, per-channel curves, contrast,
    saturation, the reference match. All of these map one input colour to one output
    colour, which is exactly what a LUT expresses.
  - CANNOT: anything spatial. Vignette, grain, halation, chromatic aberration and corner
    softness depend on *where* a pixel is or on its neighbours, so they are not
    representable and must be applied separately in the shader.

Output is the standard Adobe `.cube` format, so the tables are also usable in Lightroom,
Resolve, ffmpeg and similar tools.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

LUTS_DIR = Path(__file__).resolve().parent / "luts"

# 17 points per axis = 4,913 entries: small enough to ship and upload as a texture,
# fine enough that trilinear interpolation between points is visually lossless for
# the smooth transforms these looks apply.
DEFAULT_SIZE = 17


def identity_grid(size: int = DEFAULT_SIZE) -> np.ndarray:
    """Build an (size**3, 3) array of RGB samples spanning the colour cube.

    Ordering matches the .cube spec: red varies fastest, then green, then blue.
    """
    axis = np.linspace(0.0, 255.0, size, dtype=np.float32)
    # indexing='ij' over (b, g, r) then stacking as RGB gives red-fastest ordering.
    b, g, r = np.meshgrid(axis, axis, axis, indexing="ij")
    return np.stack([r.ravel(), g.ravel(), b.ravel()], axis=1)


def grid_to_image(grid: np.ndarray, size: int = DEFAULT_SIZE) -> Image.Image:
    """Lay the grid out as an image so existing colour code can process it unchanged.

    The transform functions operate on images, so the LUT is baked by pushing the
    identity cube through the very same code path a photo takes. That guarantees the LUT
    matches the server-side look rather than reimplementing it.
    """
    n = size**3
    width = size * size
    height = size
    if n != width * height:
        raise ValueError("grid size mismatch")
    return Image.fromarray(np.clip(grid, 0, 255).astype(np.uint8).reshape(height, width, 3))


def image_to_grid(img: Image.Image) -> np.ndarray:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    return arr.reshape(-1, 3)


def write_cube(path: Path, grid: np.ndarray, size: int, title: str) -> None:
    """Write an Adobe .cube 3D LUT. Values are normalised to 0–1."""
    path.parent.mkdir(parents=True, exist_ok=True)
    norm = np.clip(grid, 0, 255) / 255.0
    lines = [
        f'TITLE "{title}"',
        f"LUT_3D_SIZE {size}",
        "DOMAIN_MIN 0.0 0.0 0.0",
        "DOMAIN_MAX 1.0 1.0 1.0",
        "",
    ]
    lines.extend(f"{r:.6f} {g:.6f} {b:.6f}" for r, g, b in norm)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def read_cube(path: Path) -> tuple[np.ndarray, int]:
    """Parse a .cube file back into (grid, size). Used by the tests as a round-trip check."""
    size = 0
    values: list[list[float]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.upper().startswith("LUT_3D_SIZE"):
            size = int(line.split()[-1])
            continue
        if line.upper().startswith(("TITLE", "DOMAIN_MIN", "DOMAIN_MAX", "LUT_1D_SIZE")):
            continue
        parts = line.split()
        if len(parts) == 3:
            try:
                values.append([float(p) for p in parts])
            except ValueError:
                continue
    if size == 0:
        raise ValueError(f"{path} has no LUT_3D_SIZE")
    grid = np.asarray(values, dtype=np.float32) * 255.0
    if grid.shape[0] != size**3:
        raise ValueError(f"{path}: expected {size ** 3} entries, found {grid.shape[0]}")
    return grid, size


def bake_camera_lut(camera: str, size: int = DEFAULT_SIZE) -> np.ndarray:
    """Push the identity colour cube through a camera's colour-only pipeline.

    Deliberately bakes the **parametric** preset, not the reference match.

    The reference match derives its transform from the *input image's own* mean and
    spread, so it is adaptive: two different photos get two different transforms. A 3D
    LUT is a fixed table, so an adaptive transform cannot be represented in one. Baking
    it from the identity cube would capture a transform fitted to the cube's statistics,
    which corresponds to no real photo at all.

    So the LUT carries the camera's static colour signature — correct for live preview
    and offline capture — while the backend keeps applying the adaptive reference match
    and the spatial character layer when it is reachable. On-device output is therefore a
    close approximation, not a byte-identical match.
    """
    from grading import CAMERAS, apply_grade

    if camera not in CAMERAS:
        raise ValueError(f"unknown camera '{camera}'")

    grid = identity_grid(size)
    img = grid_to_image(grid, size)
    return image_to_grid(apply_grade(img, camera, spatial=False))


def write_png_strip(path: Path, grid: np.ndarray, size: int) -> None:
    """Write the LUT as a PNG strip for upload as a GPU texture.

    Layout is (size*size) x size: each of the `size` blue slices is a size x size tile of
    red (x) by green (y), laid out left to right. This is the conventional LUT-strip
    format shaders expect, and a 17-point table is only 289x17 pixels — a few kilobytes,
    versus ~130 KB for the equivalent .cube text.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    img = grid_to_image(grid, size)
    img.save(path, format="PNG", optimize=True)


def read_png_strip(path: Path, size: int) -> np.ndarray:
    with Image.open(path) as img:
        grid = image_to_grid(img)
    if grid.shape[0] != size**3:
        raise ValueError(f"{path}: expected {size ** 3} entries, found {grid.shape[0]}")
    return grid


def apply_lut(img: Image.Image, grid: np.ndarray, size: int) -> Image.Image:
    """Apply a 3D LUT with trilinear interpolation.

    This mirrors what the on-device shader does, so tests can verify that a baked LUT
    reproduces the server-side look rather than trusting that it does.
    """
    arr = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    h, w = arr.shape[:2]
    table = grid.reshape(size, size, size, 3)  # indexed [b, g, r]

    pos = np.clip(arr, 0.0, 1.0) * (size - 1)
    lo = np.floor(pos).astype(np.int32)
    hi = np.minimum(lo + 1, size - 1)
    frac = pos - lo

    r0, g0, b0 = lo[..., 0], lo[..., 1], lo[..., 2]
    r1, g1, b1 = hi[..., 0], hi[..., 1], hi[..., 2]
    fr, fg, fb = frac[..., 0:1], frac[..., 1:2], frac[..., 2:3]

    # Interpolate along red, then green, then blue.
    c00 = table[b0, g0, r0] * (1 - fr) + table[b0, g0, r1] * fr
    c01 = table[b0, g1, r0] * (1 - fr) + table[b0, g1, r1] * fr
    c10 = table[b1, g0, r0] * (1 - fr) + table[b1, g0, r1] * fr
    c11 = table[b1, g1, r0] * (1 - fr) + table[b1, g1, r1] * fr
    c0 = c00 * (1 - fg) + c01 * fg
    c1 = c10 * (1 - fg) + c11 * fg
    out = c0 * (1 - fb) + c1 * fb

    return Image.fromarray(np.clip(out.reshape(h, w, 3), 0, 255).astype(np.uint8))


def build_all(
    size: int = DEFAULT_SIZE,
    out_dir: Path | None = None,
    png_dir: Path | None = None,
) -> dict[str, Path]:
    """Bake a LUT for every camera.

    Writes a .cube (portable, works in Lightroom/Resolve/ffmpeg) and optionally a PNG
    strip for the app to upload as a GPU texture. Returns {camera: cube_path}.
    """
    from grading import CAMERA_ORDER, CAMERAS

    target = out_dir or LUTS_DIR
    written: dict[str, Path] = {}
    for camera in CAMERA_ORDER:
        grid = bake_camera_lut(camera, size)
        path = target / f"{camera}.cube"
        write_cube(path, grid, size, CAMERAS[camera]["name"])
        written[camera] = path
        if png_dir is not None:
            write_png_strip(png_dir / f"{camera}.png", grid, size)
    return written
