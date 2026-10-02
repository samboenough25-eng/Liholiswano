create table if not exists subscription_accounts (
  user_id uuid primary key references users(id) on delete cascade,
  currency char(1) not null check (currency in ('P','E')),
  monthly_fiat_minor integer not null default 500,
  active boolean not null default true,
  next_due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subscription_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  period_start date not null,
  period_key varchar(7) not null,
  currency char(1) not null check (currency in ('P','E')),
  fiat_amount_minor integer not null,
  token_address varchar(42) not null,
  token_amount_base_units numeric(78,0) not null,
  token_decimals integer not null default 6,
  chain_id bigint not null,
  subscription_contract varchar(42) not null,
  subscription_key varchar(66) not null,
  customer_key varchar(66) not null,
  wallet_address varchar(42) not null,
  status varchar(32) not null default 'prepared',
  tx_hash varchar(66),
  exchange_rate numeric(30,12),
  rate_source varchar(255),
  prepared_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  error_message text,
  unique(user_id, period_key),
  unique(subscription_key),
  unique(tx_hash)
);

create index if not exists idx_subscription_payments_user on subscription_payments(user_id, period_start desc);
create index if not exists idx_subscription_payments_status on subscription_payments(status);
create index if not exists idx_subscription_payments_due on subscription_payments(status, period_start);
alter table subscription_payments add column if not exists wallet_address varchar(42);
alter table subscription_payments add column if not exists created_at timestamptz not null default now();
alter table subscription_payments add column if not exists updated_at timestamptz not null default now();
update subscription_payments s set wallet_address=w.address from wallets w where w.user_id=s.user_id and w.chain_id=s.chain_id and w.is_primary=true and w.verified_at is not null and s.wallet_address is null;
alter table subscription_payments alter column wallet_address set not null;

create table if not exists subscription_events (
  id bigserial primary key,
  payment_id uuid references subscription_payments(id) on delete cascade,
  event_type varchar(64) not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists subscription_authorizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  payment_id uuid not null references subscription_payments(id) on delete cascade,
  token_hash varchar(64) not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_subscription_authorizations_expiry on subscription_authorizations(expires_at) where used_at is null;
