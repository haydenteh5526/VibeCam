"""Reference-based camera color matching.

Learns a camera's *real* color/tone from straight-out-of-camera (SOOC) sample
JPEGs and maps a photo toward it using a Monge-Kantorovich Linear (MKL) optimal
transport of the RGB mean + covariance (Pitié et al.). This grounds the
emulation in real camera output instead of hand-tuned parameters.

Workflow:
  1. Drop SOOC samples in  backend/camera_samples/<camera>/<scene>/*.jpg
  2. Build a profile:       python tools/build_profile.py <camera>
     -> writes backend/camera_profiles/<camera>.json (small, derived stats)
  3. POST /grade with X-Camera=<camera> applies the matched look (scene-aware),
     falling back to the parametric preset when no profile exists.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ExifTags

BACKEND_DIR = Path(__file__).resolve().parent
SAMPLES_DIR = BACKEND_DIR / "camera_samples"
PROFILES_DIR = BACKEND_DIR / "camera_profiles"

SCENES = ["skin", "daylight", "indoor", "flash"]
_STATS_THUMB = 384  # downsample long side before computing color statistics
_EPS = 1e-4         # covariance regularization

# EXIF Model substrings that identify each camera (matched lowercased).
EXPECTED_MODELS = {
    "g7x": ["g7 x mark iii", "g7x mark iii"],
    "rx100": ["rx100", "dsc-rx100"],
    "gr": ["gr iii", "ricoh gr"],
    "x100": ["x100"],
    "ccd": [],  # any vintage compact CCD
    "powershot": ["powershot"],
}

_TAG = {name: tag for tag, name in ExifTags.TAGS.items()}


# ─── Scene classification ──────────────────────────────────────────────────────

def scene_of(analysis: dict) -> str:
    """Map an image analysis (from grading.analyze_image) to a reference scene."""
    b, w, p = analysis["brightness"], analysis["warmth"], analysis["is_portrait"]
    if p:
        return "skin"
    if b < 0.28:
        return "flash"          # dark -> flash / night
    if w > 0.06 or b > 0.55:
        return "daylight"       # warm or bright -> outdoor daylight
    return "indoor"


# ─── Profile building (offline) ────────────────────────────────────────────────

def _model_matches(model: str, camera: str) -> bool:
    expected = EXPECTED_MODELS.get(camera, [])
    if not expected:
        return True
    return any(m in model.lower() for m in expected)


def _read_model(img: Image.Image) -> str:
    value = img.getexif().get(_TAG.get("Model"))
    return str(value).strip() if value is not None else ""


def _thumb_pixels(img: Image.Image) -> np.ndarray:
    """Downsample and return an (N, 3) float64 array of RGB pixels."""
    im = img.convert("RGB")
    w, h = im.size
    scale = _STATS_THUMB / max(w, h)
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))))
    return np.asarray(im, dtype=np.float64).reshape(-1, 3)


def _finalize(acc: dict) -> dict | None:
    n = acc["n"]
    if n < 2 or acc["files"] == 0:
        return None
    mean = acc["sum"] / n
    cov = acc["outer"] / n - np.outer(mean, mean)
    return {
        "files": acc["files"],
        "pixels": int(n),
        "mean": mean.tolist(),
        "cov": cov.tolist(),
    }


def _new_acc() -> dict:
    return {"n": 0, "sum": np.zeros(3), "outer": np.zeros((3, 3)), "files": 0}


def build_profile(camera: str, verify_model: bool = True) -> dict:
    """Scan camera_samples/<camera>/<scene>/ and write a color profile JSON.

    Returns the profile dict. Raises ValueError if no usable samples are found.
    """
    root = SAMPLES_DIR / camera
    per_scene = {scene: _new_acc() for scene in SCENES}
    overall = _new_acc()
    rejected: list[str] = []

    for scene in SCENES:
        sdir = root / scene
        if not sdir.exists():
            continue
        for path in sorted(sdir.iterdir()):
            if path.suffix.lower() not in (".jpg", ".jpeg"):
                continue
            try:
                with Image.open(path) as img:
                    if verify_model and not _model_matches(_read_model(img), camera):
                        rejected.append(f"{scene}/{path.name}: EXIF model not {camera}")
                        continue
                    px = _thumb_pixels(img)
            except Exception as exc:  # noqa: BLE001
                rejected.append(f"{scene}/{path.name}: {exc}")
                continue
            for acc in (per_scene[scene], overall):
                acc["n"] += px.shape[0]
                acc["sum"] += px.sum(axis=0)
                acc["outer"] += px.T @ px
                acc["files"] += 1

    scenes_out: dict[str, dict] = {}
    for scene in SCENES:
        stat = _finalize(per_scene[scene])
        if stat:
            scenes_out[scene] = stat
    overall_stat = _finalize(overall)
    if overall_stat:
        scenes_out["overall"] = overall_stat

    if not scenes_out:
        raise ValueError(
            f"No usable samples for '{camera}'. Add SOOC JPEGs under "
            f"{root}/<scene>/ and retry. Rejected: {rejected or 'none'}"
        )

    profile = {
        "camera": camera,
        "method": "mkl",
        "built_at": datetime.now(timezone.utc).isoformat(),
        "scenes": scenes_out,
        "rejected": rejected,
    }
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    (PROFILES_DIR / f"{camera}.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    return profile


# ─── Matching (per request) ────────────────────────────────────────────────────

def load_profile(camera: str) -> dict | None:
    path = PROFILES_DIR / f"{camera}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def has_profile(camera: str) -> bool:
    return (PROFILES_DIR / f"{camera}.json").exists()


def _sym_eig_pow(mat: np.ndarray, power: float) -> np.ndarray:
    """Matrix power of a symmetric PSD matrix via eigendecomposition."""
    vals, vecs = np.linalg.eigh(mat)
    vals = np.clip(vals, 0.0, None)
    if power < 0:
        safe = np.where(vals > 1e-12, vals ** power, 0.0)
    else:
        safe = vals ** power
    return (vecs * safe) @ vecs.T


def _mkl_transfer_matrix(cov_src: np.ndarray, cov_ref: np.ndarray) -> np.ndarray:
    """Optimal-transport map T s.t. T·cov_src·Tᵀ = cov_ref (Monge-Kantorovich)."""
    cs_half = _sym_eig_pow(cov_src, 0.5)
    cs_inv_half = _sym_eig_pow(cov_src, -0.5)
    middle = _sym_eig_pow(cs_half @ cov_ref @ cs_half, 0.5)
    return cs_inv_half @ middle @ cs_inv_half


def match_to_stat(img: Image.Image, stat: dict, blend: float = 0.9) -> Image.Image:
    """Map an image's colors toward a reference (mean, cov) via MKL, then blend."""
    rgb = img.convert("RGB")
    arr = np.asarray(rgb, dtype=np.float64)
    h, w, _ = arr.shape
    flat = arr.reshape(-1, 3)

    # Source statistics from a thumbnail (robust + fast).
    src_px = _thumb_pixels(rgb)
    mu_src = src_px.mean(axis=0)
    cov_src = np.cov(src_px.T) + _EPS * np.eye(3)

    mu_ref = np.asarray(stat["mean"], dtype=np.float64)
    cov_ref = np.asarray(stat["cov"], dtype=np.float64) + _EPS * np.eye(3)

    # If the source is nearly flat, covariance transport is unstable — mean-shift.
    if np.linalg.det(cov_src) < 1e-6:
        matched = flat - mu_src + mu_ref
    else:
        transfer = _mkl_transfer_matrix(cov_src, cov_ref)
        matched = (flat - mu_src) @ transfer.T + mu_ref

    out = flat * (1.0 - blend) + matched * blend
    out = np.clip(out, 0, 255).reshape(h, w, 3).astype(np.uint8)
    return Image.fromarray(out)


def grade_with_reference(image_bytes: bytes, camera: str, blend: float = 0.9):
    """Apply the reference-matched camera look.

    Returns (jpeg_bytes, camera_id, scene, "reference") or None when there is no
    profile for the camera (caller should fall back to the parametric preset).
    """
    profile = load_profile(camera)
    if not profile or not profile.get("scenes"):
        return None

    from grading import analyze_image  # local import to avoid cycles

    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    scene = scene_of(analyze_image(img))
    stat = profile["scenes"].get(scene) or profile["scenes"].get("overall")
    if not stat:
        return None

    matched = match_to_stat(img, stat, blend=blend)
    output = BytesIO()
    matched.save(output, format="JPEG", quality=92)
    return output.getvalue(), camera, scene, "reference"
