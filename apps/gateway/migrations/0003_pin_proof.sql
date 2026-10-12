-- 0003_pin_proof.sql — add BR-SEC-04 edge-verifiable HMAC PIN proof to settings (nullable TEXT; live DDL already heals it via ensureColumn in apps/gateway/lib/schema.ts; FORWARD-ONLY, never edit 0001 — AGENTS.md §3.4 / AP-8)
-- Rerun fails closed (duplicate-column error) per Rule 9; apply-check: SELECT column_name FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'pin_proof';
ALTER TABLE settings ADD COLUMN pin_proof TEXT;
