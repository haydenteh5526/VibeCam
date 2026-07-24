"""Build a camera color profile from SOOC reference samples.

Usage (from backend/):
    python tools/build_profile.py g7x
    python tools/build_profile.py g7x --no-verify   # skip EXIF model check

Reads backend/camera_samples/<camera>/<scene>/*.jpg and writes
backend/camera_profiles/<camera>.json (small, derived stats — safe to commit).
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make the backend package importable when run as `python tools/build_profile.py`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import camera_match  # noqa: E402


def main() -> int:
    args = [a for a in sys.argv[1:]]
    verify = "--no-verify" not in args
    cameras = [a for a in args if not a.startswith("--")]
    if not cameras:
        print("usage: python tools/build_profile.py <camera> [--no-verify]")
        print("cameras:", ", ".join(camera_match.EXPECTED_MODELS.keys()))
        return 2

    for camera in cameras:
        try:
            profile = camera_match.build_profile(camera, verify_model=verify)
        except ValueError as exc:
            print(f"[{camera}] {exc}")
            continue
        scenes = profile["scenes"]
        print(f"[{camera}] profile written -> camera_profiles/{camera}.json")
        for scene, stat in scenes.items():
            mean = ", ".join(f"{v:.0f}" for v in stat["mean"])
            print(f"    {scene:9s} files={stat['files']:<3d} mean RGB=({mean})")
        if profile.get("rejected"):
            print(f"    rejected {len(profile['rejected'])}:")
            for msg in profile["rejected"]:
                print(f"      - {msg}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
