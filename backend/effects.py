"""Point-and-shoot effects layer: date stamp, film frame, light leak, dust and scratches.

These are the *signatures* of a cheap camera rather than properties of its sensor:
the orange LED date burned into the corner, the printed border, the light that crept
past a worn door seal, the dust on a scanner platen. `character.py` handles the physics
of the lens and sensor; this module handles the artefacts of the era.

Everything is deterministic: pass a `seed` and the same photo yields the same leak and
the same dust, so re-developing a shot doesn't reshuffle it.

Pure numpy + Pillow — no new dependencies, no font files (digits are drawn as real
seven-segment shapes, which is what those cameras actually used).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# Which segments light up for each character, in the classic seven-segment order:
#   a = top, b = top-right, c = bottom-right, d = bottom, e = bottom-left,
#   f = top-left, g = middle
_SEGMENTS: dict[str, str] = {
    "0": "abcdef",
    "1": "bc",
    "2": "abdeg",
    "3": "abcdg",
    "4": "bcfg",
    "5": "acdfg",
    "6": "acdefg",
    "7": "abc",
    "8": "abcdefg",
    "9": "abcdfg",
    " ": "",
    "'": "f",
}

# Per-camera date-stamp colour. Canon compacts burned a warm orange; the Y2K digicams
# skewed more yellow; Fuji leaned amber.
_STAMP_COLORS: dict[str, tuple[int, int, int]] = {
    "g7x": (255, 138, 42),
    "powershot": (255, 122, 30),
    "ccd": (255, 196, 62),
    "x100": (255, 168, 70),
    "rx100": (255, 148, 58),
    "gr": (255, 130, 48),
}
_DEFAULT_STAMP = (255, 140, 45)


@dataclass
class EffectOptions:
    """Which effects to apply. All default off so callers opt in explicitly."""

    date_stamp: bool = False
    date_text: str | None = None      # defaults to "'YY MM DD" of `when`
    when: datetime | None = None
    frame: str | None = None          # None | "white" | "black" | "print"
    light_leak: float = 0.0           # 0-1
    dust: float = 0.0                 # 0-1
    seed: int = 0

    def any_enabled(self) -> bool:
        return bool(self.date_stamp or self.frame or self.light_leak > 0 or self.dust > 0)


def _draw_segment(d: ImageDraw.ImageDraw, seg: str, x: float, y: float, w: float, h: float, t: float, color) -> None:
    """Draw one seven-segment bar. (x, y) is the digit's top-left; w/h its extent."""
    half = h / 2
    if seg == "a":
        d.rounded_rectangle([x + t, y, x + w - t, y + t], radius=t / 2, fill=color)
    elif seg == "b":
        d.rounded_rectangle([x + w - t, y + t, x + w, y + half - t / 2], radius=t / 2, fill=color)
    elif seg == "c":
        d.rounded_rectangle([x + w - t, y + half + t / 2, x + w, y + h - t], radius=t / 2, fill=color)
    elif seg == "d":
        d.rounded_rectangle([x + t, y + h - t, x + w - t, y + h], radius=t / 2, fill=color)
    elif seg == "e":
        d.rounded_rectangle([x, y + half + t / 2, x + t, y + h - t], radius=t / 2, fill=color)
    elif seg == "f":
        d.rounded_rectangle([x, y + t, x + t, y + half - t / 2], radius=t / 2, fill=color)
    elif seg == "g":
        d.rounded_rectangle([x + t, y + half - t / 2, x + w - t, y + half + t / 2], radius=t / 2, fill=color)


def _render_stamp_text(size: tuple[int, int], text: str, color, scale: float) -> Image.Image:
    """Render seven-segment text onto a transparent layer, bottom-right aligned."""
    w, h = size
    layer = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(layer)

    digit_h = max(10.0, min(w, h) * 0.045 * scale)
    digit_w = digit_h * 0.58
    thick = max(1.5, digit_h * 0.14)
    gap = digit_w * 0.42
    margin = min(w, h) * 0.045

    total_w = 0.0
    for ch in text:
        total_w += (digit_w if ch != " " else digit_w * 0.5) + gap
    total_w -= gap

    x = w - margin - total_w
    y = h - margin - digit_h
    for ch in text:
        if ch == " ":
            x += digit_w * 0.5 + gap
            continue
        for seg in _SEGMENTS.get(ch, ""):
            _draw_segment(d, seg, x, y, digit_w, digit_h, thick, color)
        x += digit_w + gap
    return layer


def add_date_stamp(
    img: Image.Image,
    camera: str = "",
    text: str | None = None,
    when: datetime | None = None,
    scale: float = 1.0,
) -> Image.Image:
    """Burn an LED-style date into the bottom-right corner.

    Added with a screen/glow blend rather than drawn flat, because the real thing was
    light leaking onto the film or sensor — it brightens what's underneath and bleeds
    slightly into it.
    """
    stamp = (when or datetime.now())
    label = text if text is not None else f"'{stamp:%y} {stamp:%m} {stamp:%d}"
    color = _STAMP_COLORS.get(camera, _DEFAULT_STAMP)

    base = img.convert("RGB")
    layer = _render_stamp_text(base.size, label, color, scale)
    if not np.asarray(layer).any():
        return base

    arr = np.asarray(base, dtype=np.float32)
    lit = np.asarray(layer, dtype=np.float32)
    # Bleed: a soft copy of the digits glowing into the surrounding pixels.
    radius = max(1.5, min(base.size) / 260.0)
    glow = np.asarray(layer.filter(ImageFilter.GaussianBlur(radius=radius)), dtype=np.float32)

    out = arr + lit * 0.92 + glow * 0.45
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def add_frame(img: Image.Image, style: str = "white") -> Image.Image:
    """Wrap the photo in a border. 'print' mimics a photo lab print with a wide base."""
    base = img.convert("RGB")
    w, h = base.size
    short = min(w, h)

    if style == "print":
        pad = int(short * 0.055)
        bottom = int(short * 0.16)   # wide base, like a print with room for a caption
        color = (246, 243, 236)
    elif style == "black":
        pad = int(short * 0.045)
        bottom = pad
        color = (12, 12, 12)
    else:  # "white"
        pad = int(short * 0.045)
        bottom = pad
        color = (250, 249, 245)

    canvas = Image.new("RGB", (w + pad * 2, h + pad + bottom), color)
    canvas.paste(base, (pad, pad))
    return canvas


def add_light_leak(img: Image.Image, strength: float = 0.5, seed: int = 0) -> Image.Image:
    """Bleed warm light in from one edge, as a worn light seal would."""
    if strength <= 0:
        return img.convert("RGB")
    base = img.convert("RGB")
    arr = np.asarray(base, dtype=np.float32)
    h, w = arr.shape[:2]
    rng = np.random.default_rng(seed or 1)

    # Anchor the leak to a random edge, then fall off across the frame.
    edge = rng.integers(0, 4)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    if edge == 0:
        d = xx / w
    elif edge == 1:
        d = 1.0 - xx / w
    elif edge == 2:
        d = yy / h
    else:
        d = 1.0 - yy / h

    spread = float(rng.uniform(0.22, 0.42))
    mask = np.exp(-(d**2) / (2 * spread**2))
    # Off-centre hot spot along the edge, so it isn't a uniform band.
    centre = float(rng.uniform(0.2, 0.8))
    along = (yy / h) if edge in (0, 1) else (xx / w)
    mask *= np.exp(-((along - centre) ** 2) / (2 * 0.32**2))

    tint = np.array([1.0, float(rng.uniform(0.52, 0.72)), float(rng.uniform(0.22, 0.4))], dtype=np.float32)
    out = arr + mask[:, :, None] * tint[None, None, :] * (150.0 * float(np.clip(strength, 0, 1)))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def add_dust(img: Image.Image, amount: float = 0.5, seed: int = 0) -> Image.Image:
    """Sprinkle dust specks and hair-thin scratches, like a scanned print."""
    if amount <= 0:
        return img.convert("RGB")
    base = img.convert("RGB")
    w, h = base.size
    rng = np.random.default_rng(seed or 7)
    a = float(np.clip(amount, 0, 1))

    layer = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    scale = min(w, h)

    for _ in range(int(28 * a) + 4):
        r = rng.uniform(scale * 0.0012, scale * 0.0045)
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        v = int(rng.uniform(90, 220))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(v, v, v))

    for _ in range(int(4 * a) + 1):
        x0, y0 = rng.uniform(0, w), rng.uniform(0, h)
        length = rng.uniform(scale * 0.05, scale * 0.28)
        angle = rng.uniform(0, np.pi)
        x1, y1 = x0 + np.cos(angle) * length, y0 + np.sin(angle) * length
        v = int(rng.uniform(70, 150))
        d.line([x0, y0, x1, y1], fill=(v, v, v), width=1)

    speck = np.asarray(layer.filter(ImageFilter.GaussianBlur(radius=0.6)), dtype=np.float32)
    arr = np.asarray(base, dtype=np.float32)
    return Image.fromarray(np.clip(arr + speck * 0.55, 0, 255).astype(np.uint8))


def apply_effects(img: Image.Image, camera: str, opts: EffectOptions) -> Image.Image:
    """Apply the enabled effects in physically sensible order.

    Leak and dust happen at the film/sensor plane, the date stamp is burned in by the
    camera, and the frame is added last because it's the print, not the photograph.
    """
    if not opts.any_enabled():
        return img.convert("RGB")

    out = img.convert("RGB")
    if opts.light_leak > 0:
        out = add_light_leak(out, opts.light_leak, opts.seed)
    if opts.dust > 0:
        out = add_dust(out, opts.dust, opts.seed)
    if opts.date_stamp:
        out = add_date_stamp(out, camera, opts.date_text, opts.when)
    if opts.frame:
        out = add_frame(out, opts.frame)
    return out
