"""g4f.dev free AI provider — unlimited, no API key needed, OpenAI-compatible."""

import base64
import json
import httpx
from . import AIProvider, GradeResult, GuideResult

G4F_API_URL = "https://api.g4f.dev/v1/chat/completions"

GRADE_PROMPT = """You are a professional film photographer and color grader. Analyze this photo and determine the best color grading.

Return ONLY a JSON object (no markdown, no explanation):
{"temperature": <-100 to 100>, "tint": <-100 to 100>, "exposure": <-2.0 to 2.0>, "contrast": <-100 to 100>, "highlights": <-100 to 100>, "shadows": <-100 to 100>, "saturation": <-100 to 100>, "vibrance": <-100 to 100>, "grain": <0 to 50>, "vignette": <0 to 100>, "style_name": "<short name>"}"""

GUIDE_PROMPT = """You are a professional photographer directing a photoshoot. Analyze this scene and give practical guidance.

Return ONLY a JSON object (no markdown):
{"instructions": ["<instruction 1>", "<instruction 2>"], "composition_tip": "<one tip>"}

Keep instructions short and specific."""


class G4FProvider(AIProvider):
    async def _call(self, image_bytes: bytes, prompt: str) -> str:
        b64 = base64.b64encode(image_bytes).decode()
        payload = {
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
                    ]
                }
            ],
            "max_tokens": 500,
            "temperature": 0.3,
        }

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(G4F_API_URL, json=payload, headers={"Content-Type": "application/json"})
            resp.raise_for_status()

        data = resp.json()
        text = data["choices"][0]["message"]["content"].strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        return text

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
