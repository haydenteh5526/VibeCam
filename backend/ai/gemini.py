"""Google Gemini AI provider for photo grading and composition guidance."""

import base64
import json
import os
import httpx
from . import AIProvider, GradeResult, GuideResult

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

GRADE_PROMPT = """You are a professional film photographer and color grader. Analyze this photo and determine the best color grading to make it look stunning and professional.

Return ONLY a JSON object with these exact fields (no markdown, no explanation):
{
  "temperature": <-100 to 100, negative=cooler blue, positive=warmer orange>,
  "tint": <-100 to 100, negative=green shift, positive=magenta shift>,
  "exposure": <-2.0 to 2.0>,
  "contrast": <-100 to 100>,
  "highlights": <-100 to 100>,
  "shadows": <-100 to 100>,
  "saturation": <-100 to 100>,
  "vibrance": <-100 to 100>,
  "grain": <0 to 50, amount of film grain>,
  "vignette": <0 to 100, edge darkening>,
  "style_name": "<short name like 'Warm Cinematic' or 'Cool Editorial'>"
}

Consider: lighting, subject, mood, skin tones, background. Grade it like a professional would in Lightroom."""

GUIDE_PROMPT = """You are a professional portrait and lifestyle photographer directing a photoshoot. Analyze this camera frame showing the current scene and subject.

Give practical, specific guidance to improve the photo. Consider:
- Subject positioning and pose
- Camera angle (higher/lower/left/right)
- Background (is it clean or cluttered?)
- Lighting direction
- Composition (rule of thirds, leading lines, framing)

Return ONLY a JSON object (no markdown):
{
  "instructions": ["<instruction 1>", "<instruction 2>"],
  "composition_tip": "<one short composition tip>"
}

Keep instructions to 1-2 sentences each, max 2 instructions. Be specific and actionable."""


class GeminiProvider(AIProvider):
    def __init__(self):
        self.api_key = os.getenv("GOOGLE_AI_API_KEY", "")

    async def _call(self, image_bytes: bytes, prompt: str) -> str:
        if not self.api_key:
            raise RuntimeError("GOOGLE_AI_API_KEY not set")

        b64 = base64.b64encode(image_bytes).decode()
        payload = {
            "contents": [{
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": "image/jpeg", "data": b64}}
                ]
            }],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 500}
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{GEMINI_API_URL}?key={self.api_key}",
                json=payload,
            )
            resp.raise_for_status()

        data = resp.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        # Strip markdown code fences if present
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        return text.strip()

    async def grade_photo(self, image_bytes: bytes) -> GradeResult:
        raw = await self._call(image_bytes, GRADE_PROMPT)
        d = json.loads(raw)
        return GradeResult(
            temperature=float(d.get("temperature", 0)),
            tint=float(d.get("tint", 0)),
            exposure=float(d.get("exposure", 0)),
            contrast=float(d.get("contrast", 0)),
            highlights=float(d.get("highlights", 0)),
            shadows=float(d.get("shadows", 0)),
            saturation=float(d.get("saturation", 0)),
            vibrance=float(d.get("vibrance", 0)),
            grain=float(d.get("grain", 0)),
            vignette=float(d.get("vignette", 0)),
            style_name=d.get("style_name", "Custom"),
        )

    async def guide_composition(self, image_bytes: bytes) -> GuideResult:
        raw = await self._call(image_bytes, GUIDE_PROMPT)
        d = json.loads(raw)
        return GuideResult(
            instructions=d.get("instructions", []),
            composition_tip=d.get("composition_tip", ""),
        )
