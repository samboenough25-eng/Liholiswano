create table if not exists indexer_state (
  chain_id bigint primary key,
  contract_address varchar(42),
  last_processed_block bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists chain_events (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null,
  contract_address varchar(42),
  block_number bigint not null,
  block_hash varchar(66),
  tx_hash varchar(66) not null,
  log_index integer not null,
  event_name varchar(96) not null,
  args jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(chain_id,tx_hash,log_index)
);
create index if not exists idx_chain_events_block on chain_events(chain_id,block_number);
