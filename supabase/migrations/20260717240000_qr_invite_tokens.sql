-- QR invite tokens: opaque guest entry (hash only; never store raw token).

create table if not exists public.qr_invite_tokens (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  use_count integer not null default 0 check (use_count >= 0),
  enabled boolean not null default true,
  constraint qr_invite_tokens_hash_unique unique (token_hash)
);

create index if not exists qr_invite_tokens_event_id_idx
  on public.qr_invite_tokens (event_id);

create index if not exists qr_invite_tokens_event_active_idx
  on public.qr_invite_tokens (event_id)
  where enabled = true and revoked_at is null;

alter table public.qr_invite_tokens enable row level security;
revoke all on public.qr_invite_tokens from anon, authenticated;

comment on table public.qr_invite_tokens is
  'Opaque QR invite credentials. Store token_hash only; never the raw token.';
