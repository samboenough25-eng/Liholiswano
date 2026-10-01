create table if not exists whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  phone varchar(30) not null unique,
  verified_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references whatsapp_contacts(id) on delete cascade,
  state varchar(64) not null default 'menu',
  context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(contact_id)
);
create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references whatsapp_contacts(id) on delete cascade,
  provider_message_id varchar(255) not null unique,
  direction varchar(16) not null check(direction in ('inbound','outbound')),
  message_type varchar(32) not null default 'text',
  body text,
  status varchar(32) not null default 'received',
  created_at timestamptz not null default now()
);
create index if not exists idx_whatsapp_contacts_user on whatsapp_contacts(user_id);
create index if not exists idx_whatsapp_messages_contact_created on whatsapp_messages(contact_id,created_at desc);
