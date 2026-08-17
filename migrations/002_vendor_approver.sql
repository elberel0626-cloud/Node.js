-- Persist the vendor-level default by user ID; names remain sourced from app_user.
DO $$
BEGIN
  IF to_regclass('vendor') IS NOT NULL THEN
    ALTER TABLE vendor ADD COLUMN IF NOT EXISTS approver_user_id uuid;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_approver_user_fk') THEN
      ALTER TABLE vendor ADD CONSTRAINT vendor_approver_user_fk
        FOREIGN KEY (approver_user_id) REFERENCES app_user(id);
    END IF;
  END IF;
END $$;
