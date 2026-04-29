ALTER TABLE theme_catalog_items
  ADD COLUMN IF NOT EXISTS source_slug text,
  ADD COLUMN IF NOT EXISTS source_asset_id text;

-- statement-break
ALTER TABLE theme_catalog_changes
  ADD COLUMN IF NOT EXISTS source_slug text,
  ADD COLUMN IF NOT EXISTS source_change_id text;

-- statement-break
CREATE UNIQUE INDEX IF NOT EXISTS theme_catalog_items_source_key
  ON theme_catalog_items (source_slug, source_asset_id)
  WHERE source_slug IS NOT NULL
    AND source_asset_id IS NOT NULL;

-- statement-break
CREATE UNIQUE INDEX IF NOT EXISTS theme_catalog_changes_source_key
  ON theme_catalog_changes (theme_id, source_change_id)
  WHERE source_change_id IS NOT NULL;
