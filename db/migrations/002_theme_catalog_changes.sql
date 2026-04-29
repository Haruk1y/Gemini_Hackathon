CREATE TABLE IF NOT EXISTS theme_catalog_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id uuid NOT NULL REFERENCES theme_catalog_items(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending_review' CHECK (
    status IN ('pending_review', 'approved', 'rejected', 'disabled')
  ),
  edit_prompt text NOT NULL CHECK (length(trim(edit_prompt)) > 0),
  changed_blob_url text NOT NULL CHECK (length(trim(changed_blob_url)) > 0),
  changed_blob_path text NOT NULL CHECK (length(trim(changed_blob_path)) > 0),
  answer_box jsonb NOT NULL,
  change_summary text NOT NULL CHECK (length(trim(change_summary)) > 0),
  weight integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  last_used_at timestamptz,
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  disabled_reason text,
  feedback_ok_count integer NOT NULL DEFAULT 0 CHECK (feedback_ok_count >= 0),
  feedback_low_quality_count integer NOT NULL DEFAULT 0 CHECK (feedback_low_quality_count >= 0),
  feedback_report_count integer NOT NULL DEFAULT 0 CHECK (feedback_report_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    jsonb_typeof(answer_box) = 'object'
    AND answer_box ? 'x'
    AND answer_box ? 'y'
    AND answer_box ? 'width'
    AND answer_box ? 'height'
  )
);

-- statement-break
CREATE TABLE IF NOT EXISTS theme_catalog_change_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_change_id uuid NOT NULL REFERENCES theme_catalog_changes(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ok', 'low_quality', 'report')),
  room_id text,
  round_id text,
  uid_hash text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- statement-break
CREATE UNIQUE INDEX IF NOT EXISTS theme_catalog_changes_changed_blob_path_key
  ON theme_catalog_changes (changed_blob_path);

-- statement-break
CREATE INDEX IF NOT EXISTS theme_catalog_changes_theme_idx
  ON theme_catalog_changes (theme_id, status, created_at DESC);

-- statement-break
CREATE INDEX IF NOT EXISTS theme_catalog_changes_review_queue_idx
  ON theme_catalog_changes (status, created_at DESC);

-- statement-break
CREATE INDEX IF NOT EXISTS theme_catalog_changes_approved_pick_idx
  ON theme_catalog_changes (theme_id, weight, usage_count, created_at DESC)
  WHERE status = 'approved';

-- statement-break
CREATE INDEX IF NOT EXISTS theme_catalog_change_feedback_change_idx
  ON theme_catalog_change_feedback (theme_change_id, created_at DESC);

-- statement-break
CREATE UNIQUE INDEX IF NOT EXISTS theme_catalog_change_feedback_once_per_round_idx
  ON theme_catalog_change_feedback (theme_change_id, room_id, round_id, uid_hash, kind)
  WHERE room_id IS NOT NULL
    AND round_id IS NOT NULL
    AND uid_hash IS NOT NULL;
