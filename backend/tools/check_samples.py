"""Verify pocket-camera reference samples before building color profiles.

Scans backend/camera_samples/<camera>/<scene>/*.jpg and checks each image is a
genuine straight-out-of-camera (SOOC) JPEG from the expected camera, using EXIF.
Flags edited images (via the Software tag) and reports per-scene coverage.

Usage (from backend/):
    python tools/check_samples.py            # check every camera
    python tools/check_samples.py g7x        # check one camera
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ExifTags

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "camera_samples"
SCENES = ["skin", "daylight", "indoor", "flash"]
MIN_PER_SCENE = 3
MIN_TOTAL = 8

# EXIF Model substrings that identify each camera (matched lowercased).
EXPECTED_MODELS = {
    "g7x": ["g7 x mark iii", "g7x mark iii"],
    "rx100": ["rx100", "dsc-rx100"],
    "gr": ["gr iii", "ricoh gr"],
    "x100": ["x100"],
    "ccd": [],  # any vintage compact CCD — skip strict model check
    "powershot": ["powershot"],
}

EDIT_SOFTWARE = [
    "photoshop", "lightroom", "gimp", "snapseed", "vsco", "pixelmator",
    "affinity", "capture one", "luminar", "darktable", "acdsee",
]

_TAG = {name: tag for tag, name in ExifTags.TAGS.items()}


def _exif(img: Image.Image) -> dict:
    ex = img.getexif()

    def g(name: str) -> str:
        value = ex.get(_TAG.get(name))
        return str(value).strip() if value is not None else ""

    return {"make": g("Make"), "model": g("Model"), "software": g("Software")}


def check_camera(camera: str) -> bool:
    root = SAMPLES_DIR / camera
    expected = EXPECTED_MODELS.get(camera, [])
    print(f"\n=== {camera} ===")
    if not root.exists():
        print(f"  (no folder yet: {root})")
        return False

    total_ok = 0
    ready = True
    for scene in SCENES:
        sdir = root / scene
        imgs = [p for p in sdir.iterdir() if p.suffix.lower() in (".jpg", ".jpeg")] if sdir.exists() else []
        ok = 0
        issues: list[str] = []
        for p in imgs:
            try:
                with Image.open(p) as im:
                    w, h = im.size
                    ex = _exif(im)
            except Exception as exc:  # noqa: BLE001
                issues.append(f"{p.name}: cannot open ({exc})")
                continue

            model = ex["model"].lower()
            software = ex["software"].lower()
            if not ex["model"]:
                issues.append(f"{p.name}: no EXIF model — likely edited or stripped")
            elif expected and not any(m in model for m in expected):
                issues.append(f"{p.name}: model '{ex['model']}' is not {camera}")
            elif any(s in software for s in EDIT_SOFTWARE):
                issues.append(f"{p.name}: edited in '{ex['software']}' — use SOOC only")
            elif min(w, h) < 1000:
                issues.append(f"{p.name}: low-res {w}x{h} — prefer full resolution")
            else:
                ok += 1

        total_ok += ok
        mark = "OK " if ok >= MIN_PER_SCENE else "LOW"
        rejected = len(imgs) - ok
        suffix = f"  ({rejected} rejected)" if rejected > 0 else ""
        print(f"  [{mark}] {scene:9s} {ok} valid{suffix}")
        for msg in issues:
            print(f"          - {msg}")
        if ok < MIN_PER_SCENE:
            ready = False

    verdict = (
        "READY to build a profile"
        if ready and total_ok >= MIN_TOTAL
        else f"need more (>= {MIN_PER_SCENE}/scene, >= {MIN_TOTAL} total)"
    )
    print(f"  total valid: {total_ok}  ->  {verdict}")
    return ready and total_ok >= MIN_TOTAL


def main() -> None:
    cameras = [c.lower() for c in sys.argv[1:]] or list(EXPECTED_MODELS.keys())
    for camera in cameras:
        check_camera(camera)
    print()


if __name__ == "__main__":
    main()
