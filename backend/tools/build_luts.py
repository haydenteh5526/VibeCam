"""Bake camera looks into 3D LUTs.

    cd backend && python tools/build_luts.py

Writes:
  backend/luts/<camera>.cube            portable text LUT (Lightroom, Resolve, ffmpeg)
  mobile/assets/luts/<camera>.png       LUT strip the app uploads as a GPU texture

Re-run whenever a camera's colour parameters change, otherwise the on-device preview
drifts away from what the backend produces.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import lut  # noqa: E402

MOBILE_LUTS = Path(__file__).resolve().parents[2] / "mobile" / "assets" / "luts"


def main() -> int:
    size = lut.DEFAULT_SIZE
    written = lut.build_all(size=size, png_dir=MOBILE_LUTS)
    print(f"Baked {len(written)} LUTs at size {size} ({size ** 3} entries each)\n")
    for camera, path in sorted(written.items()):
        png = MOBILE_LUTS / f"{camera}.png"
        cube_kb = path.stat().st_size / 1024
        png_kb = png.stat().st_size / 1024 if png.exists() else 0.0
        print(f"  {camera:<10} {cube_kb:6.1f} KB cube   {png_kb:5.1f} KB png")
    print(f"\ncube -> {lut.LUTS_DIR}")
    print(f"png  -> {MOBILE_LUTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
