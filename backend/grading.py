"""Advanced AI color grading engine.
Techniques from: color-matcher (Reinhard transfer), RapidRAW (HSL mixer, 3-way grading, skin-aware vibrance)."""

from io import BytesIO
import numpy as np
from PIL import Image, ImageStat, ImageEnhance, ImageFilter

# ─── Film Presets with advanced parameters ─────────────────────────────────────

PRESETS = {
    "kodak_gold": {
        "name": "Kodak Gold 200",
        "temperature": 15, "tint": 3,
        "contrast": 6, "exposure": 0.0,
        "shadows": {"hue": 30, "sat": 12, "lum": 5},
        "midtones": {"hue": 35, "sat": 5, "lum": 0},
        "highlights": {"hue": 45, "sat": 8, "lum": -3},
        "hsl": {"orange_sat": 10, "green_sat": -15, "blue_sat": -10},
        "vibrance": 10, "saturation": 12,
        "grain": 8, "vignette": 15, "fade": 0, "black_point": 10,
    },
    "fuji_400h": {
        "name": "Fuji Pro 400H",
        "temperature": -6, "tint": 4,
        "contrast": -4, "exposure": 0.05,
        "shadows": {"hue": 160, "sat": 10, "lum": 3},
        "midtones": {"hue": 140, "sat": 4, "lum": 0},
        "highlights": {"hue": 50, "sat": 3, "lum": 2},
        "hsl": {"orange_sat": -5, "green_sat": 8, "blue_sat": 5},
        "vibrance": -8, "saturation": -12,
        "grain": 5, "vignette": 10, "fade": 8, "black_point": 5,
    },
    "portra_400": {
        "name": "Portra 400",
        "temperature": 5, "tint": 2,
        "contrast": -3, "exposure": 0.0,
        "shadows": {"hue": 20, "sat": 8, "lum": 4},
        "midtones": {"hue": 25, "sat": 3, "lum": 0},
        "highlights": {"hue": 40, "sat": 5, "lum": 2},
        "hsl": {"orange_sat": 8, "green_sat": -10, "blue_sat": -5},
        "vibrance": -5, "saturation": -7,
        "grain": 6, "vignette": 8, "fade": 5, "black_point": 8,
    },
    "cinestill": {
        "name": "CineStill 800T",
        "temperature": -14, "tint": -3,
        "contrast": 12, "exposure": -0.1,
        "shadows": {"hue": 230, "sat": 18, "lum": -3},
        "midtones": {"hue": 210, "sat": 6, "lum": 0},
        "highlights": {"hue": 30, "sat": 12, "lum": 3},
        "hsl": {"orange_sat": 15, "green_sat": -20, "blue_sat": 10},
        "vibrance": 8, "saturation": 5,
        "grain": 12, "vignette": 20, "fade": 0, "black_point": 5,
    },
    "tri_x": {
        "name": "Tri-X 400",
        "temperature": 0, "tint": 0,
        "contrast": 25, "exposure": 0.0,
        "shadows": {"hue": 0, "sat": 0, "lum": -5},
        "midtones": {"hue": 0, "sat": 0, "lum": 0},
        "highlights": {"hue": 0, "sat": 0, "lum": 5},
        "hsl": {"orange_sat": 0, "green_sat": 0, "blue_sat": 0},
        "vibrance": 0, "saturation": -100,
        "grain": 18, "vignette": 18, "fade": 0, "black_point": 12,
    },
    "ektar": {
        "name": "Ektar 100",
        "temperature": 10, "tint": 0,
        "contrast": 10, "exposure": 0.0,
        "shadows": {"hue": 15, "sat": 6, "lum": -2},
        "midtones": {"hue": 20, "sat": 8, "lum": 0},
        "highlights": {"hue": 45, "sat": 10, "lum": -2},
        "hsl": {"orange_sat": 15, "green_sat": 10, "blue_sat": 12},
        "vibrance": 25, "saturation": 30,
        "grain": 3, "vignette": 12, "fade": 0, "black_point": 6,
    },
    "disposable": {
        "name": "Disposable",
        "temperature": 8, "tint": 5,
        "contrast": 2, "exposure": 0.05,
        "shadows": {"hue": 40, "sat": 15, "lum": 8},
        "midtones": {"hue": 30, "sat": 8, "lum": 0},
        "highlights": {"hue": 50, "sat": 10, "lum": -5},
        "hsl": {"orange_sat": 8, "green_sat": 5, "blue_sat": -5},
        "vibrance": 5, "saturation": 5,
        "grain": 22, "vignette": 30, "fade": 10, "black_point": 15,
    },
    "polaroid": {
        "name": "Polaroid 600",
        "temperature": 6, "tint": 3,
        "contrast": -6, "exposure": 0.05,
        "shadows": {"hue": 25, "sat": 10, "lum": 10},
        "midtones": {"hue": 30, "sat": 5, "lum": 0},
        "highlights": {"hue": 45, "sat": 6, "lum": 5},
        "hsl": {"orange_sat": 5, "green_sat": -8, "blue_sat": -5},
        "vibrance": -10, "saturation": -10,
        "grain": 4, "vignette": 25, "fade": 15, "black_point": 18,
    },
}


# ─── Core processing (from RapidRAW techniques) ───────────────────────────────

def _apply_temperature_tint(arr: np.ndarray, temp: float, tint: float) -> np.ndarray:
    """White balance shift. Temp: positive=warm, negative=cool. Tint: positive=magenta, negative=green."""
    arr[:, :, 0] += temp * 0.6   # R
    arr[:, :, 2] -= temp * 0.6   # B
    arr[:, :, 1] += tint * 0.3   # G (tint axis)
    return arr


def _apply_3way_grading(arr: np.ndarray, shadows: dict, midtones: dict, highlights: dict) -> np.ndarray:
    """3-way color grading with smooth luminance masks (from RapidRAW's approach)."""
    lum = np.mean(arr, axis=2, keepdims=True) / 255.0
    # Smooth zone masks using smoothstep-like curves
    shadow_mask = np.clip(1.0 - lum * 3, 0, 1) ** 1.5
    highlight_mask = np.clip(lum * 3 - 2, 0, 1) ** 1.5
    midtone_mask = 1.0 - shadow_mask - highlight_mask
    midtone_mask = np.clip(midtone_mask, 0, 1)

    # Apply hue-based tinting per zone (convert hue to RGB offset)
    for mask, zone in [(shadow_mask, shadows), (midtone_mask, midtones), (highlight_mask, highlights)]:
        hue_rad = zone["hue"] * np.pi / 180
        intensity = zone["sat"] * 0.5
        arr[:, :, 0] += mask[:, :, 0] * np.cos(hue_rad) * intensity
        arr[:, :, 1] += mask[:, :, 0] * np.cos(hue_rad - 2.094) * intensity
        arr[:, :, 2] += mask[:, :, 0] * np.cos(hue_rad + 2.094) * intensity
        arr += mask * zone["lum"] * 0.5

    return arr


def _apply_hsl_mixer(arr: np.ndarray, hsl: dict) -> np.ndarray:
    """HSL color mixer — target specific hue ranges (from RapidRAW's HSL panel)."""
    # Convert to float HSV for hue-based operations
    from PIL import Image as PILImage
    img = PILImage.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    hsv = np.array(img.convert("HSV"), dtype=np.float32)

    # Orange hues (15-45°) → skin tones
    orange_mask = np.exp(-((hsv[:, :, 0] - 20) / 15) ** 2)[:, :, np.newaxis]
    arr[:, :, 1] += orange_mask[:, :, 0] * hsl.get("orange_sat", 0) * 0.5

    # Green hues (75-150°)
    green_mask = np.exp(-((hsv[:, :, 0] - 85) / 25) ** 2)[:, :, np.newaxis]
    arr[:, :, 1] += green_mask[:, :, 0] * hsl.get("green_sat", 0) * 0.3
    arr[:, :, 0] -= green_mask[:, :, 0] * hsl.get("green_sat", 0) * 0.1

    # Blue hues (150-210°)
    blue_mask = np.exp(-((hsv[:, :, 0] - 140) / 20) ** 2)[:, :, np.newaxis]
    arr[:, :, 2] += blue_mask[:, :, 0] * hsl.get("blue_sat", 0) * 0.4

    return arr


def _apply_skin_vibrance(img: Image.Image, vibrance: float) -> Image.Image:
    """Skin-aware vibrance — boosts unsaturated areas, protects skin tones (from RapidRAW)."""
    if vibrance == 0:
        return img
    arr = np.array(img, dtype=np.float32)
    hsv = np.array(img.convert("HSV"), dtype=np.float32)

    # Saturation mask: boost less-saturated pixels more
    sat = hsv[:, :, 1] / 255.0
    boost_mask = (1.0 - sat) ** 2  # inverse saturation

    # Skin dampener: reduce effect on orange/skin hues (hue ~15-35)
    skin_mask = np.exp(-((hsv[:, :, 0] - 18) / 12) ** 2)
    dampener = 1.0 - skin_mask * 0.5  # 50% less effect on skin

    # Apply vibrance as saturation boost weighted by mask
    effective = boost_mask * dampener * vibrance * 0.01
    gray = np.mean(arr, axis=2, keepdims=True)
    arr = arr + (arr - gray) * effective[:, :, np.newaxis]

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def _add_grain(arr: np.ndarray, amount: float) -> np.ndarray:
    if amount <= 0: return arr
    noise = np.random.normal(0, amount, arr.shape).astype(np.float32)
    return arr + noise


def _add_vignette(arr: np.ndarray, strength: float) -> np.ndarray:
    if strength <= 0: return arr
    h, w = arr.shape[:2]
    y, x = np.ogrid[:h, :w]
    dist = np.sqrt((x - w/2) ** 2 + (y - h/2) ** 2)
    max_dist = np.sqrt((w/2)**2 + (h/2)**2)
    v = 1.0 - (strength / 100) * (dist / max_dist) ** 2
    return arr * v[:, :, np.newaxis]


# ─── Analysis + Selection ──────────────────────────────────────────────────────

def analyze_image(img: Image.Image) -> dict:
    stat = ImageStat.Stat(img)
    r, g, b = stat.mean[:3]
    brightness = (r + g + b) / 3 / 255
    warmth = (r - b) / 255
    w, h = img.size
    center = img.crop((w // 4, h // 4, 3 * w // 4, 3 * h // 4))
    center_brightness = sum(ImageStat.Stat(center).mean[:3]) / 3 / 255
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


# ─── Main Pipeline ─────────────────────────────────────────────────────────────

def apply_grade(img: Image.Image, preset_id: str) -> Image.Image:
    p = PRESETS[preset_id]
    img = img.convert("RGB")
    arr = np.array(img, dtype=np.float32)

    # 1. Exposure
    if p["exposure"] != 0:
        arr = arr * (2 ** p["exposure"])

    # 2. White balance
    arr = _apply_temperature_tint(arr, p["temperature"], p["tint"])

    # 3. Contrast (S-curve approximation)
    c = p["contrast"]
    if c != 0:
        arr = (arr - 128) * (1 + c / 100) + 128

    # 4. Black point (raise floor)
    bp = p["black_point"]
    if bp > 0:
        arr = arr * (1 - bp / 255) + bp

    # 5. Fade (lifted shadows, pulled highlights)
    fade = p["fade"]
    if fade > 0:
        arr = arr * (1 - fade / 128) + fade / 2

    # 6. 3-way color grading (shadows/midtones/highlights)
    arr = _apply_3way_grading(arr, p["shadows"], p["midtones"], p["highlights"])

    # 7. HSL mixer (target specific hues)
    arr = _apply_hsl_mixer(arr, p["hsl"])

    # 8. Grain
    arr = _add_grain(arr, p["grain"])

    # 9. Vignette
    arr = _add_vignette(arr, p["vignette"])

    arr = np.clip(arr, 0, 255).astype(np.uint8)
    result = Image.fromarray(arr)

    # 10. Skin-aware vibrance
    result = _apply_skin_vibrance(result, p["vibrance"])

    # 11. Saturation
    sat = p["saturation"]
    if sat != 0:
        result = ImageEnhance.Color(result).enhance(1 + sat / 100)

    return result


def grade_image(image_bytes: bytes) -> tuple[bytes, str, str]:
    img = Image.open(BytesIO(image_bytes))
    analysis = analyze_image(img)
    preset_id = pick_best_preset(analysis)
    graded = apply_grade(img, preset_id)
    output = BytesIO()
    graded.save(output, format="JPEG", quality=92)
    return output.getvalue(), preset_id, PRESETS[preset_id]["name"]
