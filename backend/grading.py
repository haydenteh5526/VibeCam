"""AI color grading engine. Analyzes photos and applies professional LUT-style grading."""

from io import BytesIO
import numpy as np
from PIL import Image, ImageStat, ImageEnhance

# ─── LUT Presets (color curve adjustments simulating real film stocks) ────────

PRESETS = {
    "kodak_gold": {
        "name": "Kodak Gold 200",
        "warmth": 1.15,
        "saturation": 1.1,
        "contrast": 1.05,
        "shadows_tint": (10, 5, -5),    # warm shadows
        "highlights_tint": (5, 2, -8),   # golden highlights
    },
    "fuji_400h": {
        "name": "Fuji Pro 400H",
        "warmth": 0.95,
        "saturation": 0.92,
        "contrast": 0.97,
        "shadows_tint": (-3, 5, 8),      # cool green shadows
        "highlights_tint": (0, 2, -2),   # neutral highlights
    },
    "portra_400": {
        "name": "Portra 400",
        "warmth": 1.05,
        "saturation": 0.95,
        "contrast": 0.98,
        "shadows_tint": (5, 3, 0),       # slightly warm shadows
        "highlights_tint": (3, 0, -5),   # warm highlights
    },
    "cinestill": {
        "name": "CineStill 800T",
        "warmth": 0.88,
        "saturation": 1.05,
        "contrast": 1.1,
        "shadows_tint": (-5, -2, 12),    # blue shadows
        "highlights_tint": (8, -2, -5),  # halation warmth
    },
    "tri_x": {
        "name": "Tri-X 400",
        "warmth": 1.0,
        "saturation": 0.0,              # B&W
        "contrast": 1.2,
        "shadows_tint": (0, 0, 0),
        "highlights_tint": (0, 0, 0),
    },
    "ektar": {
        "name": "Ektar 100",
        "warmth": 1.08,
        "saturation": 1.25,
        "contrast": 1.08,
        "shadows_tint": (3, -2, -5),     # punchy shadows
        "highlights_tint": (5, 3, -3),   # vivid highlights
    },
}


def analyze_image(img: Image.Image) -> dict:
    """Analyze image characteristics for AI grading selection."""
    stat = ImageStat.Stat(img)
    r, g, b = stat.mean[:3]
    brightness = (r + g + b) / 3 / 255
    warmth = (r - b) / 255  # positive = warm, negative = cool

    # Detect if image is portrait-like (center-weighted brightness)
    w, h = img.size
    center = img.crop((w // 4, h // 4, 3 * w // 4, 3 * h // 4))
    center_stat = ImageStat.Stat(center)
    center_brightness = sum(center_stat.mean[:3]) / 3 / 255
    is_portrait = center_brightness > brightness * 1.05  # subject brighter than edges

    return {
        "brightness": brightness,
        "warmth": warmth,
        "is_portrait": is_portrait,
        "dominant_r": r / 255,
        "dominant_g": g / 255,
        "dominant_b": b / 255,
    }


def pick_best_preset(analysis: dict) -> str:
    """AI logic: pick the best LUT based on scene analysis."""
    brightness = analysis["brightness"]
    warmth = analysis["warmth"]
    is_portrait = analysis["is_portrait"]

    # Low light → cinematic blue tones
    if brightness < 0.3:
        return "cinestill"

    # Already very warm (golden hour) → Kodak Gold enhances it
    if warmth > 0.08:
        return "kodak_gold"

    # Cool/neutral + portrait → Portra (flattering skin tones)
    if is_portrait and warmth < 0.05:
        return "portra_400"

    # Portrait + normal → Fuji (soft, editorial)
    if is_portrait:
        return "fuji_400h"

    # Bright + saturated scene → Ektar (vivid landscape)
    if brightness > 0.6:
        return "ektar"

    # Default → Portra (versatile)
    return "portra_400"


def apply_grade(img: Image.Image, preset_id: str) -> Image.Image:
    """Apply a LUT-style color grade to an image."""
    preset = PRESETS[preset_id]
    img = img.convert("RGB")
    arr = np.array(img, dtype=np.float32)

    # Apply contrast
    contrast = preset["contrast"]
    if contrast != 1.0:
        mid = 128.0
        arr = (arr - mid) * contrast + mid

    # Apply warmth (shift R/B balance)
    warmth = preset["warmth"]
    if warmth != 1.0:
        arr[:, :, 0] = arr[:, :, 0] * warmth          # R
        arr[:, :, 2] = arr[:, :, 2] * (2.0 - warmth)  # B inverse

    # Apply shadow tint (affects dark pixels more)
    shadows = preset["shadows_tint"]
    shadow_mask = (1.0 - arr / 255.0) ** 2  # stronger in darks
    for i in range(3):
        arr[:, :, i] += shadow_mask[:, :, i] * shadows[i]

    # Apply highlight tint (affects bright pixels more)
    highlights = preset["highlights_tint"]
    highlight_mask = (arr / 255.0) ** 2  # stronger in brights
    for i in range(3):
        arr[:, :, i] += highlight_mask[:, :, i] * highlights[i]

    # Clamp
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    result = Image.fromarray(arr)

    # Apply saturation
    saturation = preset["saturation"]
    if saturation != 1.0:
        enhancer = ImageEnhance.Color(result)
        result = enhancer.enhance(saturation)

    return result


def grade_image(image_bytes: bytes) -> tuple[bytes, str, str]:
    """Full pipeline: analyze → pick preset → apply grade → return JPEG bytes + metadata."""
    img = Image.open(BytesIO(image_bytes))
    analysis = analyze_image(img)
    preset_id = pick_best_preset(analysis)
    graded = apply_grade(img, preset_id)

    output = BytesIO()
    graded.save(output, format="JPEG", quality=92)
    return output.getvalue(), preset_id, PRESETS[preset_id]["name"]
