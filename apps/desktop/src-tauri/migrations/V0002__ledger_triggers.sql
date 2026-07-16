-- V0002__ledger_triggers.sql

CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only. Post a reversing entry.'); END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only. Post a VOID entry.'); END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only.'); END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only.'); END;

-- Note: we use lower(hex(sha256(...))) but if rusqlite doesn't bundle sha256 natively,
-- we might need to register the function in Rust.
-- CREATE TRIGGER IF NOT EXISTS trg_ledger_hash BEFORE INSERT ON ledger_entries
-- WHEN NEW.this_hash IS NOT NULL
-- BEGIN
--   SELECT CASE WHEN NEW.this_hash <> lower(hex(sha256(
--     COALESCE(NEW.prev_hash,'') || '|' ||
--     NEW.id || '|' || NEW.student_id || '|' || NEW.type || '|' ||
--     NEW.debit_paise || '|' || NEW.credit_paise || '|' ||
--     NEW.balance_after_paise || '|' || NEW.occurred_on || '|' ||
--     (SELECT tenant_secret FROM settings) || '|' || NEW.created_at
--   ))) THEN RAISE(ABORT, 'ledger_entries.this_hash invalid') END;
-- END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_balance BEFORE INSERT ON ledger_entries
BEGIN
  SELECT CASE WHEN NEW.balance_after_paise <>
    COALESCE((SELECT balance_after_paise FROM ledger_entries
              WHERE student_id = NEW.student_id ORDER BY created_at DESC LIMIT 1), 0)
    + NEW.debit_paise - NEW.credit_paise
    THEN RAISE(ABORT, 'balance_after_paise invariant violated') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_void_valid BEFORE INSERT ON ledger_entries
WHEN NEW.void_of_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.type <> 'VOID' THEN RAISE(ABORT, 'void_of_id can only be set on type=VOID')
    WHEN NOT EXISTS (SELECT 1 FROM ledger_entries
                     WHERE id = NEW.void_of_id AND type <> 'VOID' AND locked_at IS NULL)
      THEN RAISE(ABORT, 'void_of_id must point to a non-voided, non-locked entry')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_invoices_total BEFORE INSERT ON invoices
BEGIN
  SELECT CASE WHEN NEW.total <> NEW.subtotal - NEW.discount + NEW.extra_charges
    THEN RAISE(ABORT, 'invoices.total must equal subtotal - discount + extra_charges') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_students_touch AFTER UPDATE ON students
BEGIN UPDATE students SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_notif_cap AFTER INSERT ON notifications
BEGIN
  DELETE FROM notifications WHERE id IN (
    SELECT id FROM notifications WHERE tenant_id = NEW.tenant_id AND read_at IS NOT NULL
    ORDER BY created_at ASC LIMIT -1 OFFSET 200);
END;
