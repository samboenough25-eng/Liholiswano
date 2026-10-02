create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email varchar(254) not null unique,
  password_hash text not null,
  role varchar(32) not null default 'customer' check (role in ('customer','admin','compliance','support')),
  status varchar(32) not null default 'active' check (status in ('active','suspended','pending')),
  country char(2) not null check (country in ('BW','SZ')),
  phone varchar(30),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  kyc_status varchar(32) not null default 'pending' check (kyc_status in ('pending','approved','rejected','needs_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  first_name varchar(80), last_name varchar(80),
  date_of_birth date, address text, city varchar(100),
  preferred_language varchar(16) not null default 'en',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  chain_id bigint not null default 97,
  address varchar(42) not null,
  label varchar(80),
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(chain_id,address),
  unique(user_id,id)
);

-- Backward-compatible wallet migrations for databases created by earlier Liholiswano versions.
-- CREATE TABLE IF NOT EXISTS does not modify an already-existing table.
alter table wallets add column if not exists chain_id bigint not null default 97;
alter table wallets add column if not exists label varchar(80);
alter table wallets add column if not exists is_primary boolean not null default false;
alter table wallets add column if not exists verified_at timestamptz;
create unique index if not exists uq_primary_wallet on wallets(user_id) where is_primary=true;

create table if not exists wallet_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  chain_id bigint not null default 97,
  address varchar(42) not null,
  nonce varchar(128) not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_wallet_challenges_user on wallet_challenges(user_id,created_at desc);

create unique index if not exists uq_primary_wallet on wallets(user_id) where is_primary=true;

create table if not exists kyc_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider varchar(64) not null,
  provider_reference varchar(255),
  status varchar(32) not null default 'pending' check (status in ('pending','approved','rejected','needs_review','error')),
  country char(2) check (country in ('BW','SZ')),
  submitted_at timestamptz, reviewed_at timestamptz,
  review_reason text, result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists compliance_screenings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider varchar(64) not null,
  screening_type varchar(32) not null check (screening_type in ('sanctions','pep','adverse_media','risk')),
  status varchar(32) not null default 'pending' check (status in ('pending','clear','match','review','error')),
  provider_reference varchar(255), result_json jsonb not null default '{}'::jsonb,
  reviewed_by uuid references users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null default 97,
  contract_address varchar(42), onchain_group_id varchar(66) not null,
  name varchar(120) not null, country char(2) check (country in ('BW','SZ')),
  status varchar(32) not null default 'active' check (status in ('draft','active','locked','completed','suspended')),
  metadata jsonb not null default '{}'::jsonb, created_by uuid references users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(chain_id,onchain_group_id)
);

create table if not exists group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  wallet_address varchar(42) not null,
  status varchar(32) not null default 'active' check (status in ('pending','active','defaulted','inactive')),
  joined_at timestamptz not null default now(), left_at timestamptz,
  unique(group_id,user_id), unique(group_id,wallet_address)
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id), group_id uuid references groups(id),
  tx_id uuid, entry_type varchar(64) not null,
  asset_symbol varchar(16) not null, chain_id bigint not null default 97,
  amount numeric(38,18) not null, direction varchar(8) not null check (direction in ('credit','debit')),
  status varchar(32) not null default 'pending' check (status in ('pending','confirmed','reversed')),
  reference varchar(255), metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists blockchain_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id), group_id uuid references groups(id),
  chain_id bigint not null, tx_hash varchar(66) not null unique,
  contract_address varchar(42), action varchar(64) not null,
  status varchar(32) not null default 'pending' check (status in ('pending','confirmed','failed','replaced')),
  block_number bigint, block_hash varchar(66), payload jsonb not null default '{}'::jsonb,
  error_message text, submitted_at timestamptz not null default now(), confirmed_at timestamptz
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  channel varchar(16) not null check (channel in ('email','sms','in_app')),
  template varchar(64) not null, subject varchar(255), body text not null,
  status varchar(32) not null default 'queued' check (status in ('queued','sent','failed','read')),
  provider_reference varchar(255), scheduled_at timestamptz, sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  subject varchar(200) not null, description text not null,
  status varchar(32) not null default 'open' check (status in ('open','pending','resolved','closed')),
  priority varchar(16) not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references users(id), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null, contract_address varchar(42),
  from_block bigint, to_block bigint, status varchar(32) not null default 'running',
  discrepancy_count integer not null default 0, report jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(), completed_at timestamptz
);

create table if not exists audit_log (
  id bigserial primary key, actor_user_id uuid references users(id),
  action varchar(120) not null, entity_type varchar(64), entity_id uuid,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

-- Backward-compatible audit log migration for older databases.
alter table audit_log add column if not exists actor_user_id uuid references users(id);
alter table audit_log add column if not exists entity_type varchar(64);
alter table audit_log add column if not exists entity_id uuid;
alter table audit_log add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table audit_log add column if not exists created_at timestamptz not null default now();

create index if not exists idx_kyc_cases_user on kyc_cases(user_id);
create index if not exists idx_screenings_user on compliance_screenings(user_id);
create index if not exists idx_wallets_user on wallets(user_id);
create index if not exists idx_group_memberships_user on group_memberships(user_id);
create index if not exists idx_group_memberships_group on group_memberships(group_id);
create index if not exists idx_ledger_user on ledger_entries(user_id,created_at desc);
create index if not exists idx_ledger_group on ledger_entries(group_id,created_at desc);
create index if not exists idx_blockchain_transactions_group on blockchain_transactions(group_id);
create index if not exists idx_blockchain_transactions_status on blockchain_transactions(status);
create index if not exists idx_notifications_user on notifications(user_id,created_at desc);
create index if not exists idx_support_user on support_tickets(user_id);
create index if not exists idx_audit_log_actor_created on audit_log(actor_user_id,created_at desc);

alter table users add column if not exists email_verified_at timestamptz;
alter table users add column if not exists phone_verified_at timestamptz;

create table if not exists auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash varchar(128) not null unique,
  purpose varchar(32) not null check (purpose in ('email_verify','password_reset')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_auth_tokens_user_purpose on auth_tokens(user_id,purpose);


-- WhatsApp and indexing tables are kept in separate idempotent SQL files for clean module ownership.\n

-- Stage 3: durable reconciliation evidence and discrepancy tracking.
create table if not exists reconciliation_discrepancies (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references reconciliation_runs(id) on delete cascade,
  severity varchar(16) not null check (severity in ('info','warning','critical')),
  category varchar(64) not null,
  entity_type varchar(64),
  entity_key varchar(255),
  expected jsonb not null default '{}'::jsonb,
  actual jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_recon_discrepancies_open on reconciliation_discrepancies(created_at desc) where resolved_at is null;
create index if not exists idx_recon_discrepancies_run on reconciliation_discrepancies(run_id);

create table if not exists reconciliation_projection (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null,
  contract_address varchar(42) not null,
  tx_hash varchar(66) not null,
  log_index integer not null,
  event_name varchar(96) not null,
  group_id varchar(66),
  wallet_address varchar(42),
  user_id uuid references users(id) on delete set null,
  asset_symbol varchar(16),
  asset_decimals integer,
  amount numeric(78,0),
  direction varchar(8),
  ledger_entry_id uuid references ledger_entries(id) on delete set null,
  block_number bigint not null,
  created_at timestamptz not null default now(),
  unique(chain_id,tx_hash,log_index,event_name)
);
create index if not exists idx_recon_projection_group on reconciliation_projection(group_id);
create index if not exists idx_recon_projection_user on reconciliation_projection(user_id,created_at desc);

-- Stage 3 reconciliation cursor/state. This is independent from the event indexer cursor.
create table if not exists reconciliation_state (
  chain_id bigint primary key,
  contract_address varchar(42) not null,
  last_processed_block bigint not null default -1,
  last_block_hash varchar(66),
  updated_at timestamptz not null default now()
);

create table if not exists reconciliation_member_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references reconciliation_runs(id) on delete cascade,
  group_id varchar(66) not null,
  wallet_address varchar(42) not null,
  active boolean not null,
  defaulted boolean not null,
  won_this_rotation boolean not null,
  contributed_this_round boolean not null,
  bid_submitted boolean not null,
  bid_bps bigint not null,
  total_wins bigint not null,
  total_contributed numeric(78,0) not null,
  total_received numeric(78,0) not null,
  block_number bigint not null,
  created_at timestamptz not null default now(),
  unique(run_id,group_id,wallet_address)
);
create index if not exists idx_recon_member_snapshot_group on reconciliation_member_snapshots(group_id,created_at desc);
