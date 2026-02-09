ALTER TYPE tenant_role ADD VALUE IF NOT EXISTS 'admin_geral';
ALTER TYPE tenant_role ADD VALUE IF NOT EXISTS 'pastor_presidente';
ALTER TYPE tenant_role ADD VALUE IF NOT EXISTS 'pastor_rede';
ALTER TYPE tenant_role ADD VALUE IF NOT EXISTS 'lider_celula';
ALTER TYPE tenant_role ADD VALUE IF NOT EXISTS 'secretaria';

CREATE TABLE IF NOT EXISTS church_networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(120) NOT NULL,
  code VARCHAR(30) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS cells (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  network_id UUID NOT NULL REFERENCES church_networks(id),
  name VARCHAR(120) NOT NULL,
  code VARCHAR(30) NOT NULL,
  leader_user_id UUID REFERENCES users(id),
  phone VARCHAR(30),
  email VARCHAR(160),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS cells_tenant_network_idx
  ON cells (tenant_id, network_id);

CREATE TABLE IF NOT EXISTS user_network_scopes (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  network_id UUID NOT NULL REFERENCES church_networks(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id, network_id)
);

CREATE TABLE IF NOT EXISTS user_cell_scopes (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  cell_id UUID NOT NULL REFERENCES cells(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id, cell_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'participant_type'
  ) THEN
    CREATE TYPE participant_type AS ENUM ('member', 'congregated', 'visitor');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(160),
  phone_home VARCHAR(30),
  phone_mobile VARCHAR(30),
  birth_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS participants_tenant_name_idx
  ON participants (tenant_id, full_name);

CREATE TABLE IF NOT EXISTS participant_cell_links (
  participant_id UUID NOT NULL REFERENCES participants(id),
  cell_id UUID NOT NULL REFERENCES cells(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  type participant_type NOT NULL DEFAULT 'visitor',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (participant_id, cell_id)
);

CREATE INDEX IF NOT EXISTS participant_cell_links_tenant_cell_idx
  ON participant_cell_links (tenant_id, cell_id);

CREATE TABLE IF NOT EXISTS participant_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  participant_id UUID NOT NULL REFERENCES participants(id),
  from_type participant_type,
  to_type participant_type NOT NULL,
  changed_by_user_id UUID NOT NULL REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS transfer_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  source_cell_id UUID NOT NULL REFERENCES cells(id),
  destination_cell_id UUID NOT NULL REFERENCES cells(id),
  transferred_by_user_id UUID NOT NULL REFERENCES users(id),
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transfer_log_participants (
  transfer_log_id UUID NOT NULL REFERENCES transfer_logs(id),
  participant_id UUID NOT NULL REFERENCES participants(id),
  PRIMARY KEY (transfer_log_id, participant_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'meeting_type'
  ) THEN
    CREATE TYPE meeting_type AS ENUM ('gd', 'cell', 'worship');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS gd_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  network_id UUID REFERENCES church_networks(id),
  cell_id UUID REFERENCES cells(id),
  meeting_type meeting_type NOT NULL DEFAULT 'gd',
  leader_name VARCHAR(160) NOT NULL,
  meeting_date DATE NOT NULL,
  meeting_time TIME,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gd_controls_tenant_date_idx
  ON gd_controls (tenant_id, meeting_date DESC);

CREATE TABLE IF NOT EXISTS attendance_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  cell_id UUID NOT NULL REFERENCES cells(id),
  week_start DATE NOT NULL,
  total_attendance INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, cell_id, week_start)
);

CREATE TABLE IF NOT EXISTS finance_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entry_date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('in', 'out')),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS finance_entries_tenant_date_idx
  ON finance_entries (tenant_id, entry_date DESC);

CREATE TABLE IF NOT EXISTS module_name_defaults (
  code VARCHAR(60) PRIMARY KEY,
  default_label VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS module_name_overrides (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  code VARCHAR(60) NOT NULL REFERENCES module_name_defaults(code),
  custom_label VARCHAR(120) NOT NULL,
  updated_by_user_id UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  sent_by_user_id UUID NOT NULL REFERENCES users(id),
  target_group VARCHAR(60) NOT NULL,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  subject VARCHAR(200) NOT NULL,
  body_html TEXT NOT NULL,
  attachment_name VARCHAR(200),
  status VARCHAR(30) NOT NULL DEFAULT 'queued',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consolidation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  participant_id UUID NOT NULL REFERENCES participants(id),
  congregation_name VARCHAR(160),
  request_text TEXT,
  known_by VARCHAR(30) NOT NULL DEFAULT 'friends',
  known_by_other VARCHAR(120),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS consolidation_records_tenant_idx
  ON consolidation_records (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS consolidation_steps (
  consolidation_id UUID PRIMARY KEY REFERENCES consolidation_records(id),
  accepted_in_church BOOLEAN,
  accepted_in_church_date DATE,
  fono_visit_done BOOLEAN,
  fono_visit_done_date DATE,
  first_visit_done BOOLEAN,
  first_visit_done_date DATE,
  pre_encounter_done BOOLEAN,
  pre_encounter_done_date DATE,
  encounter_done BOOLEAN,
  encounter_done_date DATE,
  post_encounter_done BOOLEAN,
  post_encounter_done_date DATE,
  reenounter_done BOOLEAN,
  reenounter_done_date DATE,
  consolidation_done BOOLEAN,
  consolidation_done_date DATE,
  baptized BOOLEAN,
  baptized_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consolidation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consolidation_id UUID NOT NULL REFERENCES consolidation_records(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO module_name_defaults (code, default_label)
VALUES
  ('cells', 'Celulas'),
  ('discipleship', 'Discipulado'),
  ('consolidation', 'Consolidacao'),
  ('leadership_school', 'Escola de lideres'),
  ('gd_control', 'Controle GD'),
  ('network', 'Rede'),
  ('reports', 'Relatorios')
ON CONFLICT (code) DO NOTHING;

DROP TRIGGER IF EXISTS trg_church_networks_updated_at ON church_networks;
CREATE TRIGGER trg_church_networks_updated_at
BEFORE UPDATE ON church_networks
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_cells_updated_at ON cells;
CREATE TRIGGER trg_cells_updated_at
BEFORE UPDATE ON cells
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_participants_updated_at ON participants;
CREATE TRIGGER trg_participants_updated_at
BEFORE UPDATE ON participants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_participant_cell_links_updated_at ON participant_cell_links;
CREATE TRIGGER trg_participant_cell_links_updated_at
BEFORE UPDATE ON participant_cell_links
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_consolidation_records_updated_at ON consolidation_records;
CREATE TRIGGER trg_consolidation_records_updated_at
BEFORE UPDATE ON consolidation_records
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_consolidation_steps_updated_at ON consolidation_steps;
CREATE TRIGGER trg_consolidation_steps_updated_at
BEFORE UPDATE ON consolidation_steps
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
