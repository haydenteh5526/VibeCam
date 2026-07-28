"""Optical + sensor character layer.

Color science alone makes a look feel like a filter. What actually reads as "shot on a
pocket camera" is the *physical* behaviour of a small sensor behind a cheap zoom lens:
highlights that clip early and bloom, noise that lives in the shadows, corner falloff
and softness, colour fringing, and aggressive in-camera JPEG sharpening.

This module layers that character on top of a colour-matched image. It runs after
either grading path (reference match or parametric preset), so every camera gets both
its colour *and* its physicality.

Pure numpy + Pillow — no new dependencies.
"""

from __future__ import annotations

import zlib

import numpy as np
from PIL import Image, ImageFilter

# Per-camera character. Values are deliberately restrained: these stack on top of a
# colour transform, and the goal is "recognisably that camera", not "obviously an app".
#
#   grain_shadow / grain_high : luminance noise sigma in shadows / highlights (0-255 scale)
#   chroma_noise              : per-channel colour speckle (CCDs are notably chroma-noisy)
#   vignette                  : corner light falloff, percent
#   halation                  : glow bleed around clipped highlights, 0-1
#   halation_warmth           : how orange/red the glow is, 0-1
#   ca                        : lateral chromatic aberration in pixels at the frame edge
#   corner_soft               : corner defocus blur radius in px at the extreme corner
#   sharpen                   : in-camera unsharp-mask strength, 0-1
#   highlight_rolloff         : early highlight compression, 0-1 (small sensors clip sooner)
#   black_lift                : raised black floor (cheap lens flare / sensor bias), 0-255
#   bloom_threshold           : luminance above which highlights bloom, 0-255
CHARACTER: dict[str, dict] = {
    # 1" sensor, decent lens: clean, mild character, punchy JPEG sharpening.
    "g7x": {
        "grain_shadow": 2.6, "grain_high": 0.8, "chroma_noise": 0.5,
        "vignette": 12.0, "halation": 0.22, "halation_warmth": 0.7,
        "ca": 0.6, "corner_soft": 0.5, "sharpen": 0.45,
        "highlight_rolloff": 0.30, "black_lift": 2.0, "bloom_threshold": 205,
    },
    # 1" Sony: the cleanest of the set, very neutral, strong detail.
    "rx100": {
        "grain_shadow": 2.0, "grain_high": 0.6, "chroma_noise": 0.35,
        "vignette": 9.0, "halation": 0.14, "halation_warmth": 0.45,
        "ca": 0.45, "corner_soft": 0.4, "sharpen": 0.55,
        "highlight_rolloff": 0.24, "black_lift": 1.0, "bloom_threshold": 212,
    },
    # APS-C prime: biggest sensor here. Low noise, crisp corners, deep blacks,
    # but grain is coarser and more filmic when it does show.
    "gr": {
        "grain_shadow": 3.2, "grain_high": 1.0, "chroma_noise": 0.3,
        "vignette": 16.0, "halation": 0.18, "halation_warmth": 0.35,
        "ca": 0.3, "corner_soft": 0.25, "sharpen": 0.6,
        "highlight_rolloff": 0.20, "black_lift": 0.0, "bloom_threshold": 215,
    },
    # APS-C Fuji: smooth tonality, gentle highlight rolloff, notable halation.
    "x100": {
        "grain_shadow": 3.0, "grain_high": 1.2, "chroma_noise": 0.3,
        "vignette": 14.0, "halation": 0.30, "halation_warmth": 0.8,
        "ca": 0.35, "corner_soft": 0.45, "sharpen": 0.4,
        "highlight_rolloff": 0.34, "black_lift": 3.0, "bloom_threshold": 200,
    },
    # Y2K CCD digicam: the whole point is the artefacts. Blooming highlights,
    # heavy chroma noise, soft corners, visible fringing, low dynamic range.
    "ccd": {
        "grain_shadow": 6.5, "grain_high": 2.4, "chroma_noise": 2.6,
        "vignette": 26.0, "halation": 0.55, "halation_warmth": 0.55,
        "ca": 1.8, "corner_soft": 1.5, "sharpen": 0.30,
        "highlight_rolloff": 0.55, "black_lift": 7.0, "bloom_threshold": 178,
    },
    # Small-sensor Canon compact with a hard flash: blown highlights, soft edges.
    "powershot": {
        "grain_shadow": 5.0, "grain_high": 1.8, "chroma_noise": 1.7,
        "vignette": 22.0, "halation": 0.42, "halation_warmth": 0.75,
        "ca": 1.2, "corner_soft": 1.1, "sharpen": 0.35,
        "highlight_rolloff": 0.46, "black_lift": 5.0, "bloom_threshold": 188,
    },
}

# Scenes change how a sensor behaves: dim light means more gain (noise), flash means
# blown near-field highlights. Multipliers applied to the base character.
SCENE_MODIFIERS: dict[str, dict[str, float]] = {
    "indoor": {"grain_shadow": 1.7, "grain_high": 1.4, "chroma_noise": 1.6, "halation": 1.1},
    "flash": {"halation": 1.45, "highlight_rolloff": 1.25, "vignette": 1.2, "grain_shadow": 1.2},
    "daylight": {"grain_shadow": 0.85, "chroma_noise": 0.8},
    "skin": {"sharpen": 0.8, "grain_shadow": 0.9},
    "overall": {},
}


def _radial(h: int, w: int) -> np.ndarray:
    """Normalised 0..1 distance from frame centre (1.0 at the corners)."""
    y, x = np.ogrid[:h, :w]
    cy, cx = (h - 1) / 2.0, (w - 1) / 2.0
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    return (d / np.sqrt(cx**2 + cy**2 + 1e-6)).astype(np.float32)


def _luma(arr: np.ndarray) -> np.ndarray:
    return (0.2126 * arr[:, :, 0] + 0.7152 * arr[:, :, 1] + 0.0722 * arr[:, :, 2]).astype(np.float32)


def _highlight_rolloff(arr: np.ndarray, amount: float) -> np.ndarray:
    """Compress the top of the range so highlights round off instead of clipping flat.

    Small sensors run out of headroom early; this is what makes phone photos look
    'too clean' by comparison. Applied smoothly above ~60% luminance.
    """
    if amount <= 0:
        return arr
    x = arr / 255.0
    knee = 0.6
    over = np.clip((x - knee) / (1.0 - knee), 0.0, 1.0)
    # Soft shoulder: pull compressed highlights toward the knee.
    compressed = knee + (1.0 - knee) * (1.0 - (1.0 - over) ** (1.0 + 2.2 * amount))
    out = np.where(x > knee, knee + (compressed - knee), x)
    return (out * 255.0).astype(np.float32)


def _halation(arr: np.ndarray, amount: float, warmth: float, threshold: float) -> np.ndarray:
    """Bleed a warm glow out of clipped highlights (lens flare + sensor blooming)."""
    if amount <= 0:
        return arr
    lum = _luma(arr)
    mask = np.clip((lum - threshold) / max(255.0 - threshold, 1.0), 0.0, 1.0)
    if mask.max() <= 0.001:
        return arr
    radius = max(2.0, min(arr.shape[0], arr.shape[1]) / 110.0)
    glow_img = Image.fromarray((mask * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(radius=radius)
    )
    glow = np.asarray(glow_img, dtype=np.float32) / 255.0
    # Warm tint: red bleeds furthest, blue least — matches real halation.
    tint = np.array([1.0, 1.0 - 0.35 * warmth, 1.0 - 0.7 * warmth], dtype=np.float32)
    return arr + (glow[:, :, None] * tint[None, None, :]) * (95.0 * amount)


def _chromatic_aberration(arr: np.ndarray, pixels: float) -> np.ndarray:
    """Scale R and B channels slightly differently, so edges gain colour fringing.

    Lateral CA grows with distance from the optical axis, so the shifted channels are
    blended back in with a radial weight. Without that, the whole frame (including
    smooth skies) picks up a tint instead of just the edges showing fringes.
    """
    if pixels <= 0.05:
        return arr
    h, w = arr.shape[:2]
    # Convert an edge displacement in px into a scale factor.
    sr = 1.0 + (pixels / max(w, h)) * 2.0
    sb = 1.0 - (pixels / max(w, h)) * 2.0
    # Centre stays clean; fringing ramps up toward the corners.
    weight = (_radial(h, w) ** 2)[:, :, None]
    out = arr.copy()
    for ch, scale in ((0, sr), (2, sb)):
        layer = Image.fromarray(np.clip(arr[:, :, ch], 0, 255).astype(np.uint8))
        nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        scaled = layer.resize((nw, nh), Image.BILINEAR)
        # Centre-crop or pad back to the original size.
        left, top = (nw - w) // 2, (nh - h) // 2
        if scale >= 1.0:
            scaled = scaled.crop((left, top, left + w, top + h))
        else:
            canvas = Image.new("L", (w, h), 0)
            canvas.paste(scaled, (-left, -top))
            scaled = canvas
        shifted = np.asarray(scaled, dtype=np.float32)
        wch = weight[:, :, 0]
        out[:, :, ch] = arr[:, :, ch] * (1 - wch) + shifted * wch
    return out


def _corner_softness(arr: np.ndarray, radius: float) -> np.ndarray:
    """Blend in a blurred copy toward the corners — cheap zoom lenses lose the edges."""
    if radius <= 0.05:
        return arr
    base = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    blurred = np.asarray(base.filter(ImageFilter.GaussianBlur(radius=radius)), dtype=np.float32)
    r = _radial(*arr.shape[:2])
    # Sharp centre, softness ramping up in the outer half of the frame.
    w = np.clip((r - 0.45) / 0.55, 0.0, 1.0) ** 1.6
    return arr * (1 - w[:, :, None]) + blurred * w[:, :, None]


def _grain(arr: np.ndarray, shadow: float, high: float, chroma: float, seed: int) -> np.ndarray:
    """Luminance-dependent sensor noise: strongest in shadows, plus colour speckle.

    Seeded so that re-developing the same frame reproduces the same grain. Random noise
    would make every re-grade subtly different, which breaks before/after comparison and
    makes results impossible to reason about.
    """
    if shadow <= 0 and high <= 0 and chroma <= 0:
        return arr
    rng = np.random.default_rng(seed)
    h, w = arr.shape[:2]
    lum = _luma(arr) / 255.0
    # Noise gain falls off as the signal rises (shot noise is masked in highlights).
    gain = (shadow * (1.0 - lum) ** 1.5 + high * lum).astype(np.float32)
    mono = rng.standard_normal((h, w)).astype(np.float32) * gain
    out = arr + mono[:, :, None]
    if chroma > 0:
        out = out + (rng.standard_normal((h, w, 3)).astype(np.float32) * chroma)
    return out


def _stable_seed(arr: np.ndarray, camera: str) -> int:
    """Derive a seed from the image content, so identical input yields identical grain."""
    sample = np.ascontiguousarray(arr[::37, ::37]).tobytes()
    return zlib.crc32(sample) ^ zlib.crc32(camera.encode("utf-8"))


def _vignette(arr: np.ndarray, strength: float) -> np.ndarray:
    if strength <= 0:
        return arr
    r = _radial(*arr.shape[:2])
    return arr * (1.0 - (strength / 100.0) * r**2.2)[:, :, None]


def _sharpen(arr: np.ndarray, amount: float) -> np.ndarray:
    """In-camera JPEG sharpening — compacts oversharpen, leaving faint halos."""
    if amount <= 0:
        return arr
    base = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    radius = max(1.0, min(arr.shape[0], arr.shape[1]) / 900.0)
    sharp = base.filter(ImageFilter.UnsharpMask(radius=radius, percent=int(120 * amount), threshold=2))
    return np.asarray(sharp, dtype=np.float32)


def _params_for(camera: str, scene: str | None) -> dict | None:
    base = CHARACTER.get(camera)
    if base is None:
        return None
    p = dict(base)
    for key, mult in SCENE_MODIFIERS.get(scene or "overall", {}).items():
        if key in p:
            p[key] = p[key] * mult
    return p


def has_character(camera: str) -> bool:
    return camera in CHARACTER


def apply_character(
    img: Image.Image,
    camera: str,
    scene: str | None = None,
    strength: float = 1.0,
    seed: int | None = None,
) -> Image.Image:
    """Layer a camera's optical/sensor character over an already colour-graded image.

    `strength` scales the whole effect (0 = off, 1 = full) so it can be dialled back
    without re-tuning every parameter. Unknown cameras pass through untouched.
    `seed` fixes the grain; when omitted it is derived from the image content, so the
    same photo always develops identically.
    """
    p = _params_for(camera, scene)
    if p is None or strength <= 0:
        return img

    s = float(np.clip(strength, 0.0, 1.5))
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    grain_seed = _stable_seed(arr, camera) if seed is None else int(seed)

    # Order matters: optical effects belong to the lens (before the sensor), noise and
    # sharpening belong to the sensor and its JPEG engine (after).
    arr = _highlight_rolloff(arr, p["highlight_rolloff"] * s)
    arr = _halation(arr, p["halation"] * s, p["halation_warmth"], p["bloom_threshold"])
    arr = _chromatic_aberration(arr, p["ca"] * s)
    arr = _corner_softness(arr, p["corner_soft"] * s)
    arr = _vignette(arr, p["vignette"] * s)

    bl = p["black_lift"] * s
    if bl > 0:
        arr = arr * (1.0 - bl / 255.0) + bl

    arr = _sharpen(arr, p["sharpen"] * s)
    arr = _grain(arr, p["grain_shadow"] * s, p["grain_high"] * s, p["chroma_noise"] * s, grain_seed)

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
