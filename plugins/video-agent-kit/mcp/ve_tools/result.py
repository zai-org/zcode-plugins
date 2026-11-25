from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from .public_surface import public_data, public_text_preserving, source_fragments


@dataclass
class ToolResult:
    text: str
    data: dict[str, Any] = field(default_factory=dict)
    artifacts: list[str] = field(default_factory=list)
    image_paths: list[str] = field(default_factory=list)
    video_paths: list[str] = field(default_factory=list)
    is_error: bool = False

    protected_texts: list[str] = field(default_factory=list)

    def __post_init__(self):
        self.protected_texts = list(dict.fromkeys(self.protected_texts + source_fragments(self.data)))
        self.text = public_text_preserving(self.text, self.protected_texts)
        self.data = public_data(self.data)

    @property
    def failed(self) -> bool:
        # Adapter for existing handlers while they move to explicit errors.
        return self.is_error or self.text.startswith("[ERROR]") or self.data.get("ok") is False

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": "error" if self.failed else "ok",
            "text": public_text_preserving(self.text, self.protected_texts),
            "data": public_data(self.data),
            "artifacts": self.artifacts,
            "image_paths": self.image_paths,
            "video_paths": self.video_paths,
        }
