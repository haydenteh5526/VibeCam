"""AI color grading engine with real film simulation: grain, vignette, halation, color curves."""

from io import BytesIO
import numpy as np
from PIL import Image, ImageStat, ImageEnhance, ImageFilter

PRESETS = {
    "kodak_gold": {
        "name": "Kodak Gold 200",
        "warmth": 1.15, "saturation": 1.12, "contrast": 1.06,
        "shadows_tint": (12, 5, -8), "highlights_tint": (6, 3, -10),
        "grain": 8, "vignette": 0.15, "halation": 0,
        "black_point": 10, "fade": 0,
    },
    "fuji_400h": {
        "name": "Fuji Pro 400H",
        "warmth": 0.94, "saturation": 0.88, "contrast": 0.96,
        "shadows_tint": (-4, 6, 10), "highlights_tint": (0, 3, -3),
        "grain": 5, "vignette": 0.1, "halation": 0,
        "black_point": 5, "fade": 8,
    },
    "portra_400": {
        "name": "Portra 400",
        "warmth": 1.04, "saturation": 0.93, "contrast": 0.97,
        "shadows_tint": (6, 3, -2), "highlights_tint": (4, 1, -6),
        "grain": 6, "vignette": 0.08, "halation": 0,
        "black_point": 8, "fade": 5,
    },
    "cinestill": {
        "name": "CineStill 800T",
        "warmth": 0.86, "saturation": 1.08, "contrast": 1.12,
        "shadows_tint": (-6, -3, 15), "highlights_tint": (10, -2, -6),
        "grain": 12, "vignette": 0.2, "halation": 15,
        "black_point": 5, "fade": 0,
    },
    "tri_x": {
        "name": "Tri-X 400",
        "warmth": 1.0, "saturation": 0.0, "contrast": 1.25,
        "shadows_tint": (0, 0, 0), "highlights_tint": (0, 0, 0),
        "grain": 18, "vignette": 0.18, "halation": 0,
        "black_point": 12, "fade": 0,
    },
    "ektar": {
        "name": "Ektar 100",
        "warmth": 1.1, "saturation": 1.3, "contrast": 1.1,
        "shadows_tint": (4, -3, -6), "highlights_tint": (6, 4, -4),
        "grain": 3, "vignette": 0.12, "halation": 0,
        "black_point": 6, "fade": 0,
    },
    "disposable": {
        "name": "Disposable",
        "warmth": 1.08, "saturation": 1.05, "contrast": 1.02,
        "shadows_tint": (5, 8, -3), "highlights_tint": (8, 5, -5),
        "grain": 22, "vignette": 0.3, "halation": 5,
        "black_point": 15, "fade": 10,
    },
    "polaroid": {
        "name": "Polaroid 600",
        "warmth": 1.06, "saturation": 0.9, "contrast": 0.94,
        "shadows_tint": (8, 4, 2), "highlights_tint": (5, 3, -4),
        "grain": 4, "vignette": 0.25, "halation": 3,
        "black_point": 18, "fade": 15,
    },
}


def analyze_image(img: Image.Image) -> dict:
    stat = ImageStat.Stat(img)
    r, g, b = stat.mean[:3]
    brightness = (r + g + b) / 3 / 255
    warmth = (r - b) / 255
    w, h = img.size
    center = img.crop((w // 4, h // 4, 3 * w // 4, 3 * h // 4))
    center_stat = ImageStat.Stat(center)
    center_brightness = sum(center_stat.mean[:3]) / 3 / 255
    is_portrait = center_brightness > brightness * 1.05
    return {"brightness": brightness, "warmth": warmth, "is_portrait": is_portrait}


def pick_best_preset(analysis: dict) -> str:
    b, w, p = analysis["brightness"], analysis["warmth"], analysis["is_portrait"]
    if b < 0.25: return "cinestill"
    if w > 0.1: return "kodak_gold"
    if p and w < 0.03: return "portra_400"
    if p: return "fuji_400h"
    if b > 0.6: return "ektar"
    return "portra_400"


def _add_grain(arr: np.ndarray, amount: int) -> np.ndarray:
    if amount <= 0: return arr
    noise = np.random.normal(0, amount, arr.shape).astype(np.float32)
    return np.clip(arr + noise, 0, 255)


def _add_vignette(arr: np.ndarray, strength: float) -> np.ndarray:
    if strength <= 0: return arr
    h, w = arr.shape[:2]
    y, x = np.ogrid[:h, :w]
    cy, cx = h / 2, w / 2
    dist = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    max_dist = np.sqrt(cx ** 2 + cy ** 2)
    vignette = 1.0 - strength * (dist / max_dist) ** 2
    vignette = vignette[:, :, np.newaxis]
    return np.clip(arr * vignette, 0, 255)


def _add_halation(img: Image.Image, amount: int) -> Image.Image:
    if amount <= 0: return img
    blurred = img.filter(ImageFilter.GaussianBlur(radius=amount))
    return Image.blend(img, blurred, alpha=0.15)


def apply_grade(img: Image.Image, preset_id: str) -> Image.Image:
    preset = PRESETS[preset_id]
    img = img.convert("RGB")
    arr = np.array(img, dtype=np.float32)

    # Raise black point (lifted blacks = film look)
    bp = preset["black_point"]
    if bp > 0:
        arr = arr * (1 - bp / 255) + bp

    # Contrast
    c = preset["contrast"]
    if c != 1.0:
        arr = (arr - 128) * c + 128

    # Warmth
    w = preset["warmth"]
    if w != 1.0:
        arr[:, :, 0] *= w
        arr[:, :, 2] *= (2.0 - w)

    # Shadow tint
    s = preset["shadows_tint"]
    shadow_mask = (1.0 - arr / 255.0) ** 2
    for i in range(3):
        arr[:, :, i] += shadow_mask[:, :, i] * s[i]

    # Highlight tint
    hl = preset["highlights_tint"]
    hl_mask = (arr / 255.0) ** 2
    for i in range(3):
        arr[:, :, i] += hl_mask[:, :, i] * hl[i]

    # Fade (raise shadows, lower highlights)
    fade = preset["fade"]
    if fade > 0:
        arr = arr * (1 - fade / 128) + fade / 2

    # Grain
    arr = _add_grain(arr, preset["grain"])

    # Vignette
    arr = _add_vignette(arr, preset["vignette"])

    arr = np.clip(arr, 0, 255).astype(np.uint8)
    result = Image.fromarray(arr)

    # Halation (light bleed around highlights)
    result = _add_halation(result, preset["halation"])

    # Saturation
    sat = preset["saturation"]
    if sat != 1.0:
        result = ImageEnhance.Color(result).enhance(sat)

    return result


def grade_image(image_bytes: bytes) -> tuple[bytes, str, str]:
    img = Image.open(BytesIO(image_bytes))
    analysis = analyze_image(img)
    preset_id = pick_best_preset(analysis)
    graded = apply_grade(img, preset_id)
    output = BytesIO()
    graded.save(output, format="JPEG", quality=92)
    return output.getvalue(), preset_id, PRESETS[preset_id]["name"]
