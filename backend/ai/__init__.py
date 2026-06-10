"""Abstract AI provider interface. Swap implementations by changing AI_PROVIDER env var."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
import os


@dataclass
class GradeResult:
    temperature: float  # -100 to 100 (negative=cool, positive=warm)
    tint: float         # -100 to 100 (negative=green, positive=magenta)
    exposure: float     # -2 to 2
    contrast: float     # -100 to 100
    highlights: float   # -100 to 100
    shadows: float      # -100 to 100
    saturation: float   # -100 to 100
    vibrance: float     # -100 to 100
    grain: float        # 0 to 50
    vignette: float     # 0 to 100
    style_name: str     # e.g. "Warm Cinematic"


@dataclass
class GuideResult:
    instructions: list[str]  # 1-3 short instructions
    composition_tip: str     # e.g. "Use rule of thirds"


class AIProvider(ABC):
    @abstractmethod
    async def grade_photo(self, image_bytes: bytes) -> GradeResult:
        """Analyze photo and return professional grading parameters."""
        ...

    @abstractmethod
    async def guide_composition(self, image_bytes: bytes) -> GuideResult:
        """Analyze camera frame and return pose/composition guidance."""
        ...


def get_provider() -> AIProvider:
    provider = os.getenv("AI_PROVIDER", "g4f").lower()
    if provider == "gemini":
        from .gemini import GeminiProvider
        return GeminiProvider()
    elif provider == "openai":
        from .openai import OpenAIProvider
        return OpenAIProvider()
    elif provider == "g4f":
        from .g4f import G4FProvider
        return G4FProvider()
    else:
        raise ValueError(f"Unknown AI_PROVIDER: {provider}")
