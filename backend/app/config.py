from dataclasses import dataclass
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    ollama_url: str
    ollama_model: str
    max_upload_bytes: int = 1_000_000

    @classmethod
    def from_environment(cls) -> "Settings":
        backend_dir = Path(__file__).resolve().parents[1]
        return cls(
            data_dir=Path(os.getenv("DATA_DIR", backend_dir / "data")),
            ollama_url=os.getenv("OLLAMA_URL", "http://127.0.0.1:11434"),
            ollama_model=os.getenv("OLLAMA_MODEL", "qwen2.5:3b"),
            max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", "1000000")),
        )
