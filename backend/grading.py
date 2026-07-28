"""Point-and-shoot pocket camera emulation + color grading engine.

Reproduces the in-camera JPEG "look" of popular compact cameras (Canon G7X III,
Sony RX100, Ricoh GR III, Fuji X100, Y2K CCD digicams, Canon PowerShot) plus a set
of film-stock looks. Deterministic and offline-friendly.
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


# ─── Point-and-shoot pocket camera emulations ──────────────────────────────────
# Each entry reproduces the in-camera JPEG "look" (color science) of a popular
# compact camera. Same parameter schema as the film PRESETS above, so they flow
# through the identical grading pipeline. Tuned to be deterministic and offline.

CAMERAS = {
    "g7x": {
        "name": "Canon G7X III",
        "desc": "Canon color science — warm, punchy, flattering skin tones",
        "temperature": 12, "tint": 2,
        "contrast": 10, "exposure": 0.03,
        "shadows": {"hue": 30, "sat": 8, "lum": 3},
        "midtones": {"hue": 35, "sat": 4, "lum": 0},
        "highlights": {"hue": 45, "sat": 6, "lum": 2},
        "hsl": {"orange_sat": 12, "green_sat": 6, "blue_sat": 4},
        "vibrance": 16, "saturation": 8,
        "grain": 2, "vignette": 6, "fade": 0, "black_point": 4,
    },
    "rx100": {
        "name": "Sony RX100 VII",
        "desc": "Sony color — crisp, neutral, true-to-life with high micro-contrast",
        "temperature": -3, "tint": 0,
        "contrast": 13, "exposure": 0.0,
        "shadows": {"hue": 220, "sat": 5, "lum": -2},
        "midtones": {"hue": 210, "sat": 2, "lum": 0},
        "highlights": {"hue": 50, "sat": 3, "lum": 1},
        "hsl": {"orange_sat": 4, "green_sat": 2, "blue_sat": 8},
        "vibrance": 12, "saturation": 6,
        "grain": 2, "vignette": 4, "fade": 0, "black_point": 3,
    },
    "gr": {
        "name": "Ricoh GR III",
        "desc": "High-contrast street look — deep crushed blacks, rich but restrained color",
        "temperature": 3, "tint": -1,
        "contrast": 24, "exposure": -0.05,
        "shadows": {"hue": 210, "sat": 4, "lum": -6},
        "midtones": {"hue": 30, "sat": 3, "lum": 0},
        "highlights": {"hue": 40, "sat": 4, "lum": -2},
        "hsl": {"orange_sat": 6, "green_sat": -6, "blue_sat": 6},
        "vibrance": 6, "saturation": -2,
        "grain": 6, "vignette": 12, "fade": 0, "black_point": 2,
    },
    "x100": {
        "name": "Fuji X100 Chrome",
        "desc": "Classic Chrome film simulation — muted, documentary, amber shadows",
        "temperature": 2, "tint": -3,
        "contrast": 6, "exposure": 0.0,
        "shadows": {"hue": 45, "sat": 10, "lum": -2},
        "midtones": {"hue": 40, "sat": 3, "lum": 0},
        "highlights": {"hue": 50, "sat": 2, "lum": 1},
        "hsl": {"orange_sat": 2, "green_sat": -14, "blue_sat": -10},
        "vibrance": -6, "saturation": -18,
        "grain": 5, "vignette": 8, "fade": 6, "black_point": 6,
    },
    "ccd": {
        "name": "CCD Digicam",
        "desc": "Y2K compact CCD — nostalgic cool-green cast, contrasty, sensor noise",
        "temperature": -6, "tint": 5,
        "contrast": 14, "exposure": 0.05,
        "shadows": {"hue": 150, "sat": 10, "lum": 2},
        "midtones": {"hue": 160, "sat": 4, "lum": 0},
        "highlights": {"hue": 190, "sat": 6, "lum": 3},
        "hsl": {"orange_sat": 6, "green_sat": 10, "blue_sat": 8},
        "vibrance": 8, "saturation": 14,
        "grain": 16, "vignette": 16, "fade": 0, "black_point": 10,
    },
    "powershot": {
        "name": "Canon PowerShot",
        "desc": "Retro Canon compact — warm party flash, punchy reds, blown highlights",
        "temperature": 9, "tint": 4,
        "contrast": 8, "exposure": 0.08,
        "shadows": {"hue": 30, "sat": 12, "lum": 6},
        "midtones": {"hue": 30, "sat": 6, "lum": 0},
        "highlights": {"hue": 45, "sat": 8, "lum": 4},
        "hsl": {"orange_sat": 10, "green_sat": 4, "blue_sat": -4},
        "vibrance": 10, "saturation": 12,
        "grain": 10, "vignette": 18, "fade": 4, "black_point": 8,
    },
}

# Ordered ids for stable listing / default cycling in the UI.
CAMERA_ORDER = ["g7x", "rx100", "gr", "x100", "ccd", "powershot"]

# Merged lookup so a single pipeline can resolve either a camera or a film look.
_LOOKS = {**PRESETS, **CAMERAS}


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
    """Add film grain. Seeded from the image content so a re-grade reproduces exactly."""
    if amount <= 0: return arr
    import zlib
    seed = zlib.crc32(np.ascontiguousarray(arr[::37, ::37]).astype(np.float32).tobytes())
    rng = np.random.default_rng(seed)
    noise = (rng.standard_normal(arr.shape) * amount).astype(np.float32)
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

def _lab_color_transfer(source: np.ndarray, ref_mean: tuple, ref_std: tuple) -> np.ndarray:
    """LAB color space transfer (from EasyPhoto). Matches source color distribution to reference stats."""
    import cv2
    src = cv2.cvtColor(source, cv2.COLOR_RGB2LAB).astype(np.float32)
    s_mean = src.mean(axis=(0, 1))
    s_std = src.std(axis=(0, 1)) + 1e-6
    for i in range(3):
        src[:, :, i] = ((src[:, :, i] - s_mean[i]) * (ref_std[i] / s_std[i])) + ref_mean[i]
    src = np.clip(src, 0, 255).astype(np.uint8)
    return cv2.cvtColor(src, cv2.COLOR_LAB2RGB)


def face_quality_score(image_bytes: bytes) -> dict:
    """Face quality check: blur detection + basic pose (from DeepCamera). Returns quality info."""
    import cv2
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return {"quality": "unknown", "blur_score": 0, "suggestion": ""}
    # Laplacian variance — higher = sharper
    blur_score = cv2.Laplacian(img, cv2.CV_64F).var()
    if blur_score < 50:
        return {"quality": "blurry", "blur_score": round(blur_score, 1), "suggestion": "Hold steadier or improve lighting"}
    elif blur_score < 200:
        return {"quality": "acceptable", "blur_score": round(blur_score, 1), "suggestion": ""}
    else:
        return {"quality": "sharp", "blur_score": round(blur_score, 1), "suggestion": ""}


# Pre-computed LAB reference stats for film looks (mean L/a/b, std L/a/b)
LAB_REFS = {
    "kodak_gold": ((145, 135, 155), (45, 8, 12)),
    "fuji_400h": ((140, 125, 128), (48, 6, 8)),
    "portra_400": ((142, 130, 135), (46, 7, 10)),
    "cinestill": ((110, 128, 118), (50, 10, 15)),
    "ektar": ((148, 138, 152), (42, 12, 14)),
}


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


def pick_best_camera(analysis: dict) -> str:
    """Auto-select the pocket-camera emulation that best fits the scene.

    - Dark scenes    -> CCD digicam (nostalgic noisy low-light / flash look)
    - Portraits/warm -> Canon G7X III (flattering warm skin tones)
    - Very bright    -> Sony RX100 (crisp, clean, true-to-life)
    - Everything else-> Ricoh GR III (punchy high-contrast street look)
    """
    b, w, p = analysis["brightness"], analysis["warmth"], analysis["is_portrait"]
    if b < 0.22: return "ccd"
    if p: return "g7x"
    if w > 0.08: return "g7x"
    if b > 0.62: return "rx100"
    return "gr"


# ─── Main Pipeline ─────────────────────────────────────────────────────────────

def apply_grade(img: Image.Image, preset_id: str, spatial: bool = True) -> Image.Image:
    """Apply a look to an image.

    spatial=False skips effects that depend on pixel position or randomness (grain,
    vignette), leaving a pure per-pixel colour mapping. That mode is what LUT baking
    needs: a 3D LUT maps one input colour to one output colour, so anything positional
    has to be excluded and applied separately.
    """
    p = _LOOKS[preset_id]
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

    # 8. Grain — spatial/random, so excluded when baking a LUT
    if spatial:
        arr = _add_grain(arr, p["grain"])

    # 9. Vignette — depends on pixel position, so excluded when baking a LUT
    if spatial:
        arr = _add_vignette(arr, p["vignette"])

    arr = np.clip(arr, 0, 255).astype(np.uint8)
    result = Image.fromarray(arr)

    # 10. Skin-aware vibrance
    result = _apply_skin_vibrance(result, p["vibrance"])

    # 11. Saturation
    sat = p["saturation"]
    if sat != 0:
        result = ImageEnhance.Color(result).enhance(1 + sat / 100)

    # 12. LAB color transfer — match film stock color distribution
    if preset_id in LAB_REFS:
        ref_mean, ref_std = LAB_REFS[preset_id]
        result_arr = _lab_color_transfer(np.array(result), ref_mean, ref_std)
        # Blend 30% LAB transfer with 70% parametric result for natural look
        orig_arr = np.array(result, dtype=np.float32)
        blended = (orig_arr * 0.7 + result_arr.astype(np.float32) * 0.3)
        result = Image.fromarray(np.clip(blended, 0, 255).astype(np.uint8))

    return result


def grade_image(
    image_bytes: bytes,
    preset_id: str | None = None,
    character_strength: float = 1.0,
    fx=None,
) -> tuple[bytes, str, str]:
    """Grade an image with a specific camera/film look, or auto-pick a camera.

    preset_id:
      - a known camera id (e.g. "g7x") or film id (e.g. "kodak_gold") -> that look
      - None / "" / "auto" / unknown  -> analyze the pixels and auto-pick a camera
    character_strength: scales the optical/sensor character layer (0 disables it).
    fx: optional effects.EffectOptions for date stamp / frame / leak / dust.
    Returns (jpeg_bytes, resolved_id, display_name).
    """
    img = Image.open(BytesIO(image_bytes))
    key = (preset_id or "").strip().lower()
    if key not in _LOOKS:
        key = pick_best_camera(analyze_image(img))
    graded = apply_grade(img, key)

    # Layer the camera's optical/sensor character on top of the colour grade, so the
    # parametric path gets the same physicality as the reference path.
    try:
        from character import apply_character, has_character

        if has_character(key) and character_strength > 0:
            graded = apply_character(graded, key, None, strength=character_strength)
    except Exception:
        pass  # character is an enhancement, never a hard dependency

    if fx is not None:
        try:
            from effects import apply_effects

            graded = apply_effects(graded, key, fx)
        except Exception:
            pass

    output = BytesIO()
    graded.save(output, format="JPEG", quality=92)
    return output.getvalue(), key, _LOOKS[key]["name"]
