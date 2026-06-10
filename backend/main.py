from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import sqlite3
from typing import Literal
from uuid import uuid4
import hashlib

from fastapi import Body, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["vibecam-backend"]
    timestamp_utc: str


def _read_env_int(name: str, default: int, min_value: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value < min_value:
        raise ValueError(f"{name} must be >= {min_value}")
    return value


MAX_UPLOAD_BYTES = _read_env_int("VIBECAM_MAX_UPLOAD_BYTES", 50 * 1024 * 1024, 1)
UPLOAD_INIT_TTL_MINUTES = _read_env_int("VIBECAM_UPLOAD_TTL_MINUTES", 15, 1)

DATA_DIR = Path(__file__).resolve().parent / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "vibecam.db"


class UploadSession(BaseModel):
    upload_id: str
    file_name: str
    mime_type: str
    size_bytes: int
    expires_at_utc: datetime
    status: Literal["initialized", "partial", "ingested"] = "initialized"
    bytes_received: int = 0
    ingested_at_utc: datetime | None = None
    payload_hash: str | None = None


class UploadInitRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=3, max_length=128)
    size_bytes: int = Field(gt=0, le=MAX_UPLOAD_BYTES)

    @field_validator("mime_type")
    @classmethod
    def validate_mime_type(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized.count("/") != 1:
            raise ValueError("mime_type must be in type/subtype format")
        media_type, subtype = normalized.split("/")
        if not media_type or not subtype:
            raise ValueError("mime_type must be in type/subtype format")
        return normalized


class UploadInitResponse(BaseModel):
    status: Literal["accepted"]
    upload_id: str
    max_size_bytes: int
    expires_at_utc: str


class UploadIngestResponse(BaseModel):
    status: Literal["ingested"]
    upload_id: str
    file_name: str
    mime_type: str
    expected_size_bytes: int
    bytes_received: int
    ingested_at_utc: str
    payload_hash: str


class UploadChunkIngestResponse(BaseModel):
    status: Literal["partial", "ingested"]
    upload_id: str
    expected_size_bytes: int
    bytes_received: int
    remaining_bytes: int
    next_offset: int
    ingested_at_utc: str | None = None
    payload_hash: str | None = None


class UploadStatusResponse(BaseModel):
    status: Literal["initialized", "partial", "ingested"]
    upload_id: str
    file_name: str
    mime_type: str
    expected_size_bytes: int
    bytes_received: int
    remaining_bytes: int
    expires_at_utc: str
    ingested_at_utc: str | None = None
    payload_hash: str | None = None


class UploadHashResponse(BaseModel):
    upload_id: str
    status: Literal["initialized", "partial", "ingested"]
    payload_hash: str | None = None


app = FastAPI(title="VibeCam API", version="0.1.0")

local_origins = [
    "http://localhost",
    "http://localhost:8081",
    "http://localhost:19006",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:19006",
    "http://127.0.0.1:3000",
    "http://10.0.2.2",
    "http://10.0.2.2:8000",
    "https://vibecam-backend.onrender.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=local_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


def _initialize_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS upload_sessions (
                upload_id TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                expires_at_utc TEXT NOT NULL,
                status TEXT NOT NULL,
                bytes_received INTEGER NOT NULL,
                ingested_at_utc TEXT,
                payload_hash TEXT
            )
            """
        )
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(upload_sessions)")
        }
        if "payload_hash" not in columns:
            connection.execute(
                "ALTER TABLE upload_sessions ADD COLUMN payload_hash TEXT"
            )
        connection.commit()


_initialize_storage()


def _get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _upload_payload_path(upload_id: str) -> Path:
    return UPLOADS_DIR / f"{upload_id}.bin"


def _calculate_sha256(file_path: Path) -> str:
    hasher = hashlib.sha256()
    with file_path.open("rb") as payload_file:
        for chunk in iter(lambda: payload_file.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _parse_utc_datetime(iso_value: str | None) -> datetime | None:
    if iso_value is None:
        return None
    return datetime.fromisoformat(iso_value)


def _row_to_upload_session(row: sqlite3.Row) -> UploadSession:
    return UploadSession(
        upload_id=row["upload_id"],
        file_name=row["file_name"],
        mime_type=row["mime_type"],
        size_bytes=row["size_bytes"],
        expires_at_utc=datetime.fromisoformat(row["expires_at_utc"]),
        status=row["status"],
        bytes_received=row["bytes_received"],
        ingested_at_utc=_parse_utc_datetime(row["ingested_at_utc"]),
        payload_hash=(row["payload_hash"] if "payload_hash" in row.keys() else None),
    )


def _delete_upload_session(upload_id: str) -> None:
    with _get_connection() as connection:
        connection.execute("DELETE FROM upload_sessions WHERE upload_id = ?", (upload_id,))
        connection.commit()

    payload_path = _upload_payload_path(upload_id)
    if payload_path.exists():
        payload_path.unlink()


def _save_upload_session(upload_session: UploadSession) -> None:
    with _get_connection() as connection:
        connection.execute(
            """
            UPDATE upload_sessions
            SET status = ?, bytes_received = ?, ingested_at_utc = ?, payload_hash = ?
            WHERE upload_id = ?
            """,
            (
                upload_session.status,
                upload_session.bytes_received,
                (
                    upload_session.ingested_at_utc.isoformat()
                    if upload_session.ingested_at_utc is not None
                    else None
                ),
                upload_session.payload_hash,
                upload_session.upload_id,
            ),
        )
        connection.commit()


def _get_upload_session(upload_id: str) -> UploadSession:
    with _get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM upload_sessions WHERE upload_id = ?",
            (upload_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="upload_id not found",
        )

    upload_session = _row_to_upload_session(row)
    if datetime.now(timezone.utc) > upload_session.expires_at_utc:
        _delete_upload_session(upload_id)
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="upload session expired",
        )

    return upload_session


def _create_upload_session(payload: UploadInitRequest) -> UploadSession:
    upload_id = str(uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=UPLOAD_INIT_TTL_MINUTES)

    upload_session = UploadSession(
        upload_id=upload_id,
        file_name=payload.file_name,
        mime_type=payload.mime_type,
        size_bytes=payload.size_bytes,
        expires_at_utc=expires_at,
    )

    with _get_connection() as connection:
        connection.execute(
            """
            INSERT INTO upload_sessions (
                upload_id,
                file_name,
                mime_type,
                size_bytes,
                expires_at_utc,
                status,
                bytes_received,
                ingested_at_utc,
                payload_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                upload_session.upload_id,
                upload_session.file_name,
                upload_session.mime_type,
                upload_session.size_bytes,
                upload_session.expires_at_utc.isoformat(),
                upload_session.status,
                upload_session.bytes_received,
                None,
                None,
            ),
        )
        connection.commit()

    return upload_session


def _validate_binary_content_type(request: Request) -> None:
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type and content_type != "application/octet-stream":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="content-type must be application/octet-stream",
        )


@app.get("/health", response_model=HealthResponse, tags=["health"])
def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="vibecam-backend",
        timestamp_utc=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/grade", tags=["grading"])
async def grade_photo(
    request: Request,
    payload: bytes = Body(
        ...,
        media_type="application/octet-stream",
        min_length=1,
        max_length=MAX_UPLOAD_BYTES,
    ),
):
    from grading import grade_image, apply_grade, PRESETS
    from ai import get_provider
    import os

    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type and content_type != "application/octet-stream":
        raise HTTPException(status_code=415, detail="content-type must be application/octet-stream")

    # Try AI-powered grading first, fall back to preset-based
    if os.getenv("AI_PROVIDER") == "g4f" or os.getenv("GOOGLE_AI_API_KEY") or os.getenv("OPENAI_API_KEY"):
        try:
            provider = get_provider()
            result = await provider.grade_photo(payload)
            # Apply AI-determined values using grading engine
            from PIL import Image, ImageEnhance
            from io import BytesIO
            import numpy as np

            img = Image.open(BytesIO(payload)).convert("RGB")
            arr = np.array(img, dtype=np.float32)

            # Exposure
            arr = arr * (2 ** result.exposure)
            # Temperature (warm/cool shift)
            arr[:, :, 0] += result.temperature * 0.5
            arr[:, :, 2] -= result.temperature * 0.5
            # Contrast
            arr = (arr - 128) * (1 + result.contrast / 100) + 128
            # Shadows (lift darks)
            shadow_mask = (1.0 - arr / 255.0) ** 2
            arr += shadow_mask * result.shadows * 0.3
            # Highlights (pull brights)
            hl_mask = (arr / 255.0) ** 2
            arr -= hl_mask * result.highlights * 0.3

            arr = np.clip(arr, 0, 255).astype(np.uint8)
            img = Image.fromarray(arr)

            # Saturation + Vibrance
            if result.saturation != 0:
                img = ImageEnhance.Color(img).enhance(1 + result.saturation / 100)
            # Grain
            if result.grain > 0:
                arr2 = np.array(img, dtype=np.float32)
                noise = np.random.normal(0, result.grain, arr2.shape)
                arr2 = np.clip(arr2 + noise, 0, 255).astype(np.uint8)
                img = Image.fromarray(arr2)
            # Vignette
            if result.vignette > 0:
                arr3 = np.array(img, dtype=np.float32)
                h, w = arr3.shape[:2]
                y, x = np.ogrid[:h, :w]
                dist = np.sqrt((x - w/2)**2 + (y - h/2)**2)
                v = 1.0 - (result.vignette / 100) * (dist / np.sqrt((w/2)**2 + (h/2)**2))**2
                arr3 = np.clip(arr3 * v[:, :, np.newaxis], 0, 255).astype(np.uint8)
                img = Image.fromarray(arr3)

            output = BytesIO()
            img.save(output, format="JPEG", quality=92)
            from fastapi.responses import Response
            return Response(content=output.getvalue(), media_type="image/jpeg", headers={"X-Grade-Preset-Id": "ai", "X-Grade-Preset-Name": result.style_name})
        except Exception:
            pass  # Fall through to preset-based grading

    # Fallback: preset-based grading
    try:
        graded_bytes, preset_id, preset_name = grade_image(payload)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not process image: {exc}")

    from fastapi.responses import Response
    return Response(content=graded_bytes, media_type="image/jpeg", headers={"X-Grade-Preset-Id": preset_id, "X-Grade-Preset-Name": preset_name})


@app.post("/quality", tags=["guidance"])
def check_quality(
    payload: bytes = Body(..., media_type="application/octet-stream", min_length=1, max_length=MAX_UPLOAD_BYTES),
):
    """Check photo quality (blur detection). Returns quality score and suggestion."""
    from grading import face_quality_score
    return face_quality_score(payload)


@app.post("/grade/vibe", tags=["grading"])
async def grade_with_vibe(
    request: Request,
    payload: bytes = Body(
        ...,
        media_type="application/octet-stream",
        min_length=1,
        max_length=MAX_UPLOAD_BYTES,
    ),
):
    """Grade a photo based on a user-described vibe/mood."""
    from ai import get_provider
    from PIL import Image, ImageEnhance
    from io import BytesIO
    import os
    import json
    import numpy as np

    vibe = request.headers.get("X-Vibe", "cinematic and moody")

    if not (os.getenv("AI_PROVIDER") == "g4f" or os.getenv("GOOGLE_AI_API_KEY") or os.getenv("OPENAI_API_KEY")):
        raise HTTPException(status_code=503, detail="AI not configured. Set AI_PROVIDER=g4f or GOOGLE_AI_API_KEY in .env")

    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type and content_type != "application/octet-stream":
        raise HTTPException(status_code=415, detail="content-type must be application/octet-stream")

    try:
        provider = get_provider()
        # Custom prompt with user's vibe
        import base64
        import httpx
        b64 = base64.b64encode(payload).decode()

        vibe_prompt = f"""You are a professional color grader. The user wants this vibe/mood: "{vibe}"

Analyze this photo and return color grading parameters that achieve the requested vibe.

Return ONLY a JSON object (no markdown):
{{"temperature": <-100 to 100>, "tint": <-100 to 100>, "exposure": <-2.0 to 2.0>, "contrast": <-100 to 100>, "highlights": <-100 to 100>, "shadows": <-100 to 100>, "saturation": <-100 to 100>, "vibrance": <-100 to 100>, "grain": <0 to 50>, "vignette": <0 to 100>, "style_name": "<short name describing the result>"}}"""

        api_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
        api_key = os.getenv("GOOGLE_AI_API_KEY", "")
        req_payload = {
            "contents": [{"parts": [{"text": vibe_prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": b64}}]}],
            "generationConfig": {"temperature": 0.4, "maxOutputTokens": 300}
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{api_url}?key={api_key}", json=req_payload)
            resp.raise_for_status()

        text = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        d = json.loads(text)

        # Apply the AI-determined values
        img = Image.open(BytesIO(payload)).convert("RGB")
        arr = np.array(img, dtype=np.float32)

        arr = arr * (2 ** float(d.get("exposure", 0)))
        arr[:, :, 0] += float(d.get("temperature", 0)) * 0.5
        arr[:, :, 2] -= float(d.get("temperature", 0)) * 0.5
        arr = (arr - 128) * (1 + float(d.get("contrast", 0)) / 100) + 128
        shadow_mask = (1.0 - arr / 255.0) ** 2
        arr += shadow_mask * float(d.get("shadows", 0)) * 0.3
        hl_mask = (arr / 255.0) ** 2
        arr -= hl_mask * float(d.get("highlights", 0)) * 0.3
        arr = np.clip(arr, 0, 255).astype(np.uint8)
        img = Image.fromarray(arr)

        sat_val = float(d.get("saturation", 0))
        if sat_val != 0:
            img = ImageEnhance.Color(img).enhance(1 + sat_val / 100)

        grain_val = float(d.get("grain", 0))
        if grain_val > 0:
            a = np.array(img, dtype=np.float32)
            a = np.clip(a + np.random.normal(0, grain_val, a.shape), 0, 255).astype(np.uint8)
            img = Image.fromarray(a)

        vignette_val = float(d.get("vignette", 0))
        if vignette_val > 0:
            a = np.array(img, dtype=np.float32)
            h, w = a.shape[:2]
            y, x = np.ogrid[:h, :w]
            dist = np.sqrt((x - w/2)**2 + (y - h/2)**2)
            v = 1.0 - (vignette_val / 100) * (dist / np.sqrt((w/2)**2 + (h/2)**2))**2
            a = np.clip(a * v[:, :, np.newaxis], 0, 255).astype(np.uint8)
            img = Image.fromarray(a)

        output = BytesIO()
        img.save(output, format="JPEG", quality=92)
        from fastapi.responses import Response
        return Response(content=output.getvalue(), media_type="image/jpeg", headers={"X-Grade-Preset-Id": "vibe", "X-Grade-Preset-Name": d.get("style_name", "Custom Vibe")})

    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Vibe grading failed: {exc}")


@app.post("/guide", tags=["guidance"])
async def guide_composition(
    request: Request,
    payload: bytes = Body(
        ...,
        media_type="application/octet-stream",
        min_length=1,
        max_length=MAX_UPLOAD_BYTES,
    ),
):
    from ai import get_provider
    import os

    if not (os.getenv("AI_PROVIDER") == "g4f" or os.getenv("GOOGLE_AI_API_KEY") or os.getenv("OPENAI_API_KEY")):
        raise HTTPException(status_code=503, detail="AI not configured. Set AI_PROVIDER=g4f or GOOGLE_AI_API_KEY in .env")

    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type and content_type != "application/octet-stream":
        raise HTTPException(status_code=415, detail="content-type must be application/octet-stream")

    try:
        provider = get_provider()
        result = await provider.guide_composition(payload)
        return {"instructions": result.instructions, "composition_tip": result.composition_tip}
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Guide failed: {exc}")


@app.post("/uploads/init", response_model=UploadInitResponse, tags=["uploads"])
def initialize_upload(payload: UploadInitRequest) -> UploadInitResponse:
    upload_session = _create_upload_session(payload)

    return UploadInitResponse(
        status="accepted",
        upload_id=upload_session.upload_id,
        max_size_bytes=MAX_UPLOAD_BYTES,
        expires_at_utc=upload_session.expires_at_utc.isoformat(),
    )


class UploadListItem(BaseModel):
    upload_id: str
    file_name: str
    mime_type: str
    status: Literal["initialized", "partial", "ingested"]
    size_bytes: int
    bytes_received: int
    ingested_at_utc: str | None = None


@app.get("/uploads", response_model=list[UploadListItem], tags=["uploads"])
def list_uploads(
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
) -> list[UploadListItem]:
    with _get_connection() as connection:
        if status_filter:
            rows = connection.execute(
                "SELECT * FROM upload_sessions WHERE status = ? ORDER BY rowid DESC LIMIT ?",
                (status_filter, limit),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM upload_sessions ORDER BY rowid DESC LIMIT ?",
                (limit,),
            ).fetchall()

    items: list[UploadListItem] = []
    for row in rows:
        items.append(
            UploadListItem(
                upload_id=row["upload_id"],
                file_name=row["file_name"],
                mime_type=row["mime_type"],
                status=row["status"],
                size_bytes=row["size_bytes"],
                bytes_received=row["bytes_received"],
                ingested_at_utc=row["ingested_at_utc"],
            )
        )
    return items


@app.get("/uploads/{upload_id}", response_model=UploadStatusResponse, tags=["uploads"])
def get_upload_status(upload_id: str) -> UploadStatusResponse:
    upload_session = _get_upload_session(upload_id)
    remaining_bytes = upload_session.size_bytes - upload_session.bytes_received

    return UploadStatusResponse(
        status=upload_session.status,
        upload_id=upload_session.upload_id,
        file_name=upload_session.file_name,
        mime_type=upload_session.mime_type,
        expected_size_bytes=upload_session.size_bytes,
        bytes_received=upload_session.bytes_received,
        remaining_bytes=remaining_bytes,
        expires_at_utc=upload_session.expires_at_utc.isoformat(),
        ingested_at_utc=(
            upload_session.ingested_at_utc.isoformat()
            if upload_session.ingested_at_utc is not None
            else None
        ),
        payload_hash=upload_session.payload_hash,
    )


@app.get("/uploads/{upload_id}/hash", response_model=UploadHashResponse, tags=["uploads"])
def get_upload_hash(upload_id: str) -> UploadHashResponse:
    upload_session = _get_upload_session(upload_id)
    return UploadHashResponse(
        upload_id=upload_session.upload_id,
        status=upload_session.status,
        payload_hash=upload_session.payload_hash,
    )


@app.put("/uploads/{upload_id}/chunks", response_model=UploadChunkIngestResponse, tags=["uploads"])
def ingest_upload_chunk(
    upload_id: str,
    request: Request,
    offset: int = Query(..., ge=0),
    payload: bytes = Body(
        ...,
        media_type="application/octet-stream",
        min_length=1,
        max_length=MAX_UPLOAD_BYTES,
    ),
) -> UploadChunkIngestResponse:
    upload_session = _get_upload_session(upload_id)

    if upload_session.status == "ingested":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="upload already ingested",
        )

    _validate_binary_content_type(request)

    # Allow idempotent retries and overlapping writes.
    # If the incoming payload lies entirely before or equal to current bytes_received,
    # treat it as a duplicate and return the current session state without writing.
    # If the incoming payload overlaps the already-written region, verify the overlap
    # matches the existing bytes, then append only the new trailing bytes.

    current = upload_session.bytes_received

    if offset > current:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"offset {offset} does not match expected offset {current}; "
                "there is a gap in uploaded data"
            ),
        )

    payload_path = _upload_payload_path(upload_id)

    # Reject writes that would exceed declared size
    if offset + len(payload) > upload_session.size_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"chunk would exceed initialized size {upload_session.size_bytes}; "
                f"attempted total {offset + len(payload)}"
            ),
        )

    # If no payload file exists yet
    if not payload_path.exists():
        if offset > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="payload file missing; restart upload at offset 0",
            )
        # Fresh write
        with payload_path.open("wb") as payload_file:
            payload_file.write(payload)
        upload_session.bytes_received = len(payload)
    else:
        # File exists; handle duplicate/overlap/append semantics
        if offset + len(payload) <= current:
            # Entire payload already present on disk; no-op
            pass
        else:
            # There is some new data to append beyond `current`.
            # First, if offset < current, verify the overlapping bytes match.
            if offset < current:
                overlap_len = current - offset
                with payload_path.open("rb") as payload_file:
                    payload_file.seek(offset)
                    existing_overlap = payload_file.read(overlap_len)

                if existing_overlap != payload[0:overlap_len]:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            "overlapping payload bytes do not match existing upload;"
                            " possible corruption or mismatched retry"
                        ),
                    )

                new_data = payload[overlap_len:]
            else:
                # offset == current, append whole payload
                new_data = payload

            if new_data:
                with payload_path.open("ab") as payload_file:
                    payload_file.write(new_data)

                upload_session.bytes_received = current + len(new_data)
            else:
                # No new data appended; bytes_received remains the same
                upload_session.bytes_received = current

    ingested_at_utc: str | None = None
    if upload_session.bytes_received == upload_session.size_bytes:
        ingested_at = datetime.now(timezone.utc)
        upload_session.status = "ingested"
        upload_session.ingested_at_utc = ingested_at
        try:
            upload_session.payload_hash = _calculate_sha256(payload_path)
        except Exception:
            upload_session.payload_hash = None
        response_status: Literal["partial", "ingested"] = "ingested"
        ingested_at_utc = ingested_at.isoformat()
    else:
        upload_session.status = "partial"
        response_status = "partial"

    _save_upload_session(upload_session)

    return UploadChunkIngestResponse(
        status=response_status,
        upload_id=upload_session.upload_id,
        expected_size_bytes=upload_session.size_bytes,
        bytes_received=upload_session.bytes_received,
        remaining_bytes=upload_session.size_bytes - upload_session.bytes_received,
        next_offset=upload_session.bytes_received,
        ingested_at_utc=ingested_at_utc,
        payload_hash=upload_session.payload_hash,
    )


@app.put("/uploads/{upload_id}/content", response_model=UploadIngestResponse, tags=["uploads"])
def ingest_upload_content(
    upload_id: str,
    request: Request,
    payload: bytes = Body(
        ...,
        media_type="application/octet-stream",
        min_length=1,
        max_length=MAX_UPLOAD_BYTES,
    ),
) -> UploadIngestResponse:
    upload_session = _get_upload_session(upload_id)

    if upload_session.status == "partial":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="upload already has chunk data; continue via /uploads/{upload_id}/chunks",
        )

    if upload_session.status == "ingested":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="upload already ingested",
        )

    _validate_binary_content_type(request)

    bytes_received = len(payload)
    if bytes_received != upload_session.size_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"payload size {bytes_received} does not match initialized size "
                f"{upload_session.size_bytes}"
            ),
        )

    payload_path = _upload_payload_path(upload_id)
    with payload_path.open("wb") as payload_file:
        payload_file.write(payload)

    ingested_at = datetime.now(timezone.utc)
    upload_session.bytes_received = bytes_received
    upload_session.status = "ingested"
    upload_session.ingested_at_utc = ingested_at
    upload_session.payload_hash = hashlib.sha256(payload).hexdigest()
    _save_upload_session(upload_session)

    return UploadIngestResponse(
        status="ingested",
        upload_id=upload_session.upload_id,
        file_name=upload_session.file_name,
        mime_type=upload_session.mime_type,
        expected_size_bytes=upload_session.size_bytes,
        bytes_received=bytes_received,
        ingested_at_utc=ingested_at.isoformat(),
        payload_hash=upload_session.payload_hash,
    )
