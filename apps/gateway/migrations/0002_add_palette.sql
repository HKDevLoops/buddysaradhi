-- 0002_add_palette.sql — add palette selection to settings (new design: 8-palette theme system)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS palette TEXT NOT NULL DEFAULT 'aurora-cosmic';
