CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- statement-break
CREATE TABLE IF NOT EXISTS theme_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending_review' CHECK (
    status IN ('pending_review', 'approved', 'rejected', 'disabled')
  ),
  game_mode text NOT NULL DEFAULT 'classic' CHECK (
    game_mode IN ('classic', 'memory', 'change', 'impostor')
  ),
  image_model text NOT NULL DEFAULT 'gemini' CHECK (
    image_model IN ('gemini', 'flux')
  ),
  aspect_ratio text NOT NULL DEFAULT '1:1' CHECK (
    aspect_ratio IN ('1:1', '16:9', '9:16')
  ),
  prompt text NOT NULL CHECK (length(trim(prompt)) > 0),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  tags text[] NOT NULL DEFAULT '{}',
  difficulty smallint NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  blob_url text NOT NULL CHECK (length(trim(blob_url)) > 0),
  blob_path text NOT NULL CHECK (length(trim(blob_path)) > 0),
  thumb_blob_url text,
  thumb_blob_path text,
  style_preset_id text,
  change_blob_url text,
  change_blob_path text,
  answer_box jsonb,
  change_summary text,
  source text NOT NULL DEFAULT 'generated' CHECK (
    source IN ('generated', 'manual', 'imported')
  ),
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  disabled_reason text,
  feedback_ok_count integer NOT NULL DEFAULT 0 CHECK (feedback_ok_count >= 0),
  feedback_low_quality_count integer NOT NULL DEFAULT 0 CHECK (feedback_low_quality_count >= 0),
  feedback_report_count integer NOT NULL DEFAULT 0 CHECK (feedback_report_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- statement-break
CREATE TABLE IF NOT EXISTS theme_catalog_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id uuid NOT NULL REFERENCES theme_catalog_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ok', 'low_quality', 'report')),
  room_id text,
  round_id text,
  uid_hash text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- statement-break
CREATE UNIQUE INDEX IF NOT EXISTS theme_catalog_items_blob_path_key
  ON theme_catalog_items (blob_path);

-- statement-break
CREATE INDEX IF NOT EXISTS theme_catalog_items_review_queue_idx
  ON theme_catalog_items (status, created_at DESC);

-- statement-break
CREATE INDEX IF NOT EXISTS theme_catalog_items_approved_pick_idx
  ON theme_catalog_items (game_mode, image_model, aspect_ratio, difficulty, created_at DESC)
  WHERE status = 'approved';

-- statement-break
CREATE INDEX IF NOT EXISTS theme_catalog_items_tags_idx
  ON theme_catalog_items USING gin (tags);

-- statement-break
CREATE INDEX IF NOT EXISTS theme_catalog_feedback_theme_idx
  ON theme_catalog_feedback (theme_id, created_at DESC);

-- statement-break
CREATE UNIQUE INDEX IF NOT EXISTS theme_catalog_feedback_once_per_round_idx
  ON theme_catalog_feedback (theme_id, room_id, round_id, uid_hash, kind)
  WHERE room_id IS NOT NULL
    AND round_id IS NOT NULL
    AND uid_hash IS NOT NULL;
