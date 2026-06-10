from fastapi.testclient import TestClient
import hashlib
import pytest

import main


@pytest.fixture
def client(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    uploads_dir = data_dir / "uploads"
    db_path = data_dir / "vibecam.db"

    monkeypatch.setattr(main, "DATA_DIR", data_dir)
    monkeypatch.setattr(main, "UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(main, "DB_PATH", db_path)
    main._initialize_storage()

    with TestClient(main.app) as test_client:
        yield test_client


def test_health_endpoint_contract(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()

    assert payload["status"] == "ok"
    assert payload["service"] == "vibecam-backend"
    assert isinstance(payload["timestamp_utc"], str)


def test_upload_init_and_status(client: TestClient) -> None:
    init_response = client.post(
        "/uploads/init",
        json={
            "file_name": "clip-init.mp4",
            "mime_type": "video/mp4",
            "size_bytes": 4,
        },
    )

    assert init_response.status_code == 200
    init_payload = init_response.json()
    upload_id = init_payload["upload_id"]

    status_response = client.get(f"/uploads/{upload_id}")

    assert status_response.status_code == 200
    status_payload = status_response.json()

    assert status_payload["status"] == "initialized"
    assert status_payload["upload_id"] == upload_id
    assert status_payload["expected_size_bytes"] == 4
    assert status_payload["bytes_received"] == 0
    assert status_payload["remaining_bytes"] == 4
    assert status_payload["payload_hash"] is None


def test_chunk_ingest_flow(client: TestClient) -> None:
    init_response = client.post(
        "/uploads/init",
        json={
            "file_name": "clip-chunks.mp4",
            "mime_type": "video/mp4",
            "size_bytes": 4,
        },
    )
    upload_id = init_response.json()["upload_id"]

    first_chunk_response = client.put(
        f"/uploads/{upload_id}/chunks",
        params={"offset": 0},
        headers={"content-type": "application/octet-stream"},
        content=b"AB",
    )

    assert first_chunk_response.status_code == 200
    first_chunk_payload = first_chunk_response.json()

    assert first_chunk_payload["status"] == "partial"
    assert first_chunk_payload["bytes_received"] == 2
    assert first_chunk_payload["remaining_bytes"] == 2
    assert first_chunk_payload["next_offset"] == 2
    assert first_chunk_payload["payload_hash"] is None

    second_chunk_response = client.put(
        f"/uploads/{upload_id}/chunks",
        params={"offset": 2},
        headers={"content-type": "application/octet-stream"},
        content=b"CD",
    )

    assert second_chunk_response.status_code == 200
    second_chunk_payload = second_chunk_response.json()

    assert second_chunk_payload["status"] == "ingested"
    assert second_chunk_payload["bytes_received"] == 4
    assert second_chunk_payload["remaining_bytes"] == 0
    assert second_chunk_payload["next_offset"] == 4
    assert second_chunk_payload["ingested_at_utc"] is not None
    assert second_chunk_payload["payload_hash"] == hashlib.sha256(b"ABCD").hexdigest()

    status_response = client.get(f"/uploads/{upload_id}")
    status_payload = status_response.json()

    assert status_payload["status"] == "ingested"
    assert status_payload["bytes_received"] == 4
    assert status_payload["remaining_bytes"] == 0
    assert status_payload["payload_hash"] == hashlib.sha256(b"ABCD").hexdigest()

    payload_path = main._upload_payload_path(upload_id)
    assert payload_path.exists()
    assert payload_path.read_bytes() == b"ABCD"


def test_full_content_ingest_flow(client: TestClient) -> None:
    init_response = client.post(
        "/uploads/init",
        json={
            "file_name": "clip-full.mp4",
            "mime_type": "video/mp4",
            "size_bytes": 4,
        },
    )
    upload_id = init_response.json()["upload_id"]

    ingest_response = client.put(
        f"/uploads/{upload_id}/content",
        headers={"content-type": "application/octet-stream"},
        content=b"WXYZ",
    )

    assert ingest_response.status_code == 200
    ingest_payload = ingest_response.json()

    assert ingest_payload["status"] == "ingested"
    assert ingest_payload["upload_id"] == upload_id
    assert ingest_payload["bytes_received"] == 4
    assert ingest_payload["expected_size_bytes"] == 4
    assert ingest_payload["ingested_at_utc"] is not None
    assert ingest_payload["payload_hash"] == hashlib.sha256(b"WXYZ").hexdigest()

    status_response = client.get(f"/uploads/{upload_id}")
    status_payload = status_response.json()

    assert status_payload["status"] == "ingested"
    assert status_payload["bytes_received"] == 4
    assert status_payload["remaining_bytes"] == 0
    assert status_payload["payload_hash"] == hashlib.sha256(b"WXYZ").hexdigest()

    hash_response = client.get(f"/uploads/{upload_id}/hash")
    assert hash_response.status_code == 200
    hash_payload = hash_response.json()
    assert hash_payload["status"] == "ingested"
    assert hash_payload["payload_hash"] == hashlib.sha256(b"WXYZ").hexdigest()

    payload_path = main._upload_payload_path(upload_id)
    assert payload_path.exists()
    assert payload_path.read_bytes() == b"WXYZ"


def test_resumable_retry_behavior(client: TestClient) -> None:
    # Initialize for 4 bytes
    init_response = client.post(
        "/uploads/init",
        json={
            "file_name": "clip-resume.mp4",
            "mime_type": "video/mp4",
            "size_bytes": 4,
        },
    )
    upload_id = init_response.json()["upload_id"]

    # Send first two bytes
    r1 = client.put(
        f"/uploads/{upload_id}/chunks",
        params={"offset": 0},
        headers={"content-type": "application/octet-stream"},
        content=b"AB",
    )
    assert r1.status_code == 200

    # Retry the exact same chunk (duplicate) - should be a no-op and not double-append
    r2 = client.put(
        f"/uploads/{upload_id}/chunks",
        params={"offset": 0},
        headers={"content-type": "application/octet-stream"},
        content=b"AB",
    )
    assert r2.status_code == 200
    assert r2.json()["bytes_received"] == 2

    # Now send overlapping chunk starting at 0 with 3 bytes where first 2 match existing
    r3 = client.put(
        f"/uploads/{upload_id}/chunks",
        params={"offset": 0},
        headers={"content-type": "application/octet-stream"},
        content=b"ABC",
    )
    assert r3.status_code == 200
    # After appending only 'C', bytes_received should be 3
    assert r3.json()["bytes_received"] == 3

    # Finally send final byte at offset 3
    r4 = client.put(
        f"/uploads/{upload_id}/chunks",
        params={"offset": 3},
        headers={"content-type": "application/octet-stream"},
        content=b"D",
    )
    assert r4.status_code == 200
    assert r4.json()["status"] == "ingested"
    assert r4.json()["payload_hash"] == hashlib.sha256(b"ABCD").hexdigest()

    payload_path = main._upload_payload_path(upload_id)
    assert payload_path.exists()
    assert payload_path.read_bytes() == b"ABCD"
