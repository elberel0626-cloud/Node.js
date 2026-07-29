BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  name text NOT NULL, password_hash text, active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE role (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE);
CREATE TABLE permission (code text PRIMARY KEY);
CREATE TABLE user_role (user_id uuid REFERENCES app_user(id) ON DELETE CASCADE, role_id uuid REFERENCES role(id) ON DELETE CASCADE, PRIMARY KEY(user_id,role_id));
CREATE TABLE role_permission (role_id uuid REFERENCES role(id) ON DELETE CASCADE, permission_code text REFERENCES permission(code), PRIMARY KEY(role_id,permission_code));
CREATE TABLE app_session (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash char(64) NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, created_at timestamptz NOT NULL,
 last_seen_at timestamptz NOT NULL, idle_expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL,
 revoked_at timestamptz, created_ip inet, user_agent varchar(512), csrf_token_hash char(64)
);
CREATE INDEX app_session_user_active_idx ON app_session(user_id) WHERE revoked_at IS NULL;
CREATE TABLE security_audit_log (
 event_id uuid PRIMARY KEY, timestamp timestamptz NOT NULL DEFAULT now(), request_id uuid NOT NULL,
 user_id uuid REFERENCES app_user(id), session_id_hash char(64), action varchar(80) NOT NULL,
 entity_type varchar(80), entity_id text, result varchar(20) NOT NULL, reason text,
 source_ip inet, user_agent varchar(512), metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'security audit records are append-only'; END $$;
CREATE TRIGGER security_audit_immutable BEFORE UPDATE OR DELETE ON security_audit_log FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();
COMMIT;
