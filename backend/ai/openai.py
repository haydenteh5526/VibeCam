"""OpenAI provider stub. Implement when switching to OpenAI."""

from . import AIProvider, GradeResult, GuideResult


class OpenAIProvider(AIProvider):
    async def grade_photo(self, image_bytes: bytes) -> GradeResult:
        raise NotImplementedError("OpenAI provider not yet implemented. Set AI_PROVIDER=gemini")

    async def guide_composition(self, image_bytes: bytes) -> GuideResult:
        raise NotImplementedError("OpenAI provider not yet implemented. Set AI_PROVIDER=gemini")
