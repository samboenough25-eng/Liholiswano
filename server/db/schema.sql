create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email varchar(254) not null unique,
  password_hash text not null,
  role varchar(32) not null default 'customer' check (role in ('customer','admin','compliance','support')),
  status varchar(32) not null default 'active' check (status in ('active','suspended','pending')),
  country char(2) not null check (country in ('BW','SZ')),
  phone varchar(30),
  kyc_status varchar(32) not null default 'pending' check (kyc_status in ('pending','approved','rejected','needs_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kyc_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider varchar(64) not null,
  provider_reference varchar(255),
  status varchar(32) not null default 'pending' check (status in ('pending','approved','rejected','needs_review','error')),
  country char(2) check (country in ('BW','SZ')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_reason text,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null default 97,
  contract_address varchar(42),
  onchain_group_id varchar(66) not null,
  name varchar(120) not null,
  country char(2) check (country in ('BW','SZ')),
  status varchar(32) not null default 'active' check (status in ('draft','active','locked','completed','suspended')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(chain_id,onchain_group_id)
);

create table if not exists group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  wallet_address varchar(42) not null,
  status varchar(32) not null default 'active' check (status in ('pending','active','defaulted','inactive')),
  joined_at timestamptz not null default now(),
  unique(group_id,user_id),
  unique(group_id,wallet_address)
);

create table if not exists blockchain_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  group_id uuid references groups(id),
  chain_id bigint not null,
  tx_hash varchar(66) not null unique,
  contract_address varchar(42),
  action varchar(64) not null,
  status varchar(32) not null default 'pending' check (status in ('pending','confirmed','failed','replaced')),
  block_number bigint,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  submitted_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table if not exists audit_log (
  id bigserial primary key,
  actor_user_id uuid references users(id),
  action varchar(120) not null,
  entity_type varchar(64),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_kyc_cases_user on kyc_cases(user_id);
create index if not exists idx_group_memberships_user on group_memberships(user_id);
create index if not exists idx_group_memberships_group on group_memberships(group_id);
create index if not exists idx_blockchain_transactions_group on blockchain_transactions(group_id);
create index if not exists idx_blockchain_transactions_status on blockchain_transactions(status);
create index if not exists idx_audit_log_actor_created on audit_log(actor_user_id,created_at desc);
