export type UploadInitResponse = {
  status: 'accepted';
  upload_id: string;
  max_size_bytes: number;
  expires_at_utc: string;
};

export type UploadChunkResponse = {
  status: 'partial' | 'ingested';
  upload_id: string;
  expected_size_bytes: number;
  bytes_received: number;
  remaining_bytes: number;
  next_offset: number;
  ingested_at_utc: string | null;
  payload_hash?: string | null;
};

export type GalleryItem = {
  upload_id: string;
  file_name: string;
  mime_type: string;
  status: string;
  size_bytes: number;
  bytes_received: number;
  ingested_at_utc: string | null;
};

export type SelectedFile = {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
};

export type CaptureMode = 'photo' | 'video';
export type AppScreen = 'camera' | 'preview' | 'uploading' | 'done' | 'gallery';
