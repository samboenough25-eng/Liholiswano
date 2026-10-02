create table if not exists idempotency_keys (
  key varchar(255) primary key,
  user_id uuid references users(id) on delete cascade,
  operation varchar(96) not null,
  response jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_idempotency_user on idempotency_keys(user_id);
create table if not exists reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null,
  contract_address varchar(42),
  from_block bigint,
  to_block bigint,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status varchar(32) not null,
  details jsonb not null default '{}'::jsonb
);
create table if not exists transaction_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  group_id uuid references groups(id) on delete set null,
  operation varchar(64) not null,
  idempotency_key varchar(255) not null unique,
  wallet_address varchar(42) not null,
  chain_id bigint not null default 97,
  contract_address varchar(42) not null,
  onchain_group_id varchar(66) not null,
  status varchar(32) not null default 'prepared',
  tx_hash varchar(66),
  request_json jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  submitted_at timestamptz
);
alter table transaction_requests add column if not exists submitted_at timestamptz;
alter table transaction_requests drop constraint if exists transaction_requests_status_check;
alter table transaction_requests add constraint transaction_requests_status_check check(status in ('prepared','signed','submitted','confirmed','reverted','failed','cancelled','reconciliation_required'));
create unique index if not exists uq_transaction_request_tx_hash on transaction_requests(tx_hash) where tx_hash is not null;
create index if not exists idx_transaction_requests_user on transaction_requests(user_id,created_at desc);
create index if not exists idx_transaction_requests_status on transaction_requests(status);
create index if not exists idx_transaction_requests_group on transaction_requests(onchain_group_id);
create table if not exists transaction_events (
  id uuid primary key default gen_random_uuid(),
  transaction_request_id uuid references transaction_requests(id) on delete cascade,
  status varchar(32) not null,
  tx_hash varchar(66),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_transaction_events_request on transaction_events(transaction_request_id,created_at desc);
