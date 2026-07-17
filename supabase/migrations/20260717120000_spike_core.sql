-- Spike + core schema foundation for Share Memories With Us
-- Apply only to a dedicated wedding photo project (not the RSVP project).

create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique default 'muhammad-basmala',
  couple_names text not null default 'Muhammad & Basmala',
  access_code_hash text not null,
  access_code_salt text not null,
  uploads_enabled boolean not null default true,
  gallery_enabled boolean not null default true,
  max_image_bytes bigint not null default 20971520,
  max_video_bytes bigint not null default 104857600,
  max_video_duration_seconds integer not null default 60,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.onedrive_integrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  status text not null check (status in ('disconnected', 'connected', 'error')),
  microsoft_account_label text,
  drive_id text,
  root_folder_item_id text,
  originals_images_folder_id text,
  originals_videos_folder_id text,
  previews_images_folder_id text,
  previews_posters_folder_id text,
  exports_folder_id text,
  -- Vault secret name holding the encrypted refresh token (never store plaintext here)
  refresh_token_vault_secret_id uuid,
  last_token_refresh_at timestamptz,
  last_successful_api_at timestamptz,
  last_error text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id)
);

create table if not exists public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  idempotency_key text not null,
  status text not null check (
    status in ('created', 'uploading', 'completed', 'failed', 'cancelled')
  ),
  media_kind text not null check (media_kind in ('image', 'video')),
  original_filename_sanitized text not null,
  content_type text not null,
  byte_size bigint not null check (byte_size > 0),
  bytes_uploaded bigint not null default 0,
  graph_upload_url_expires_at timestamptz,
  -- upload URL kept server-side only when using chunk proxy; never select from anon
  graph_upload_url text,
  drive_item_id text,
  preview_drive_item_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, idempotency_key)
);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  upload_session_id uuid references public.upload_sessions (id) on delete set null,
  status text not null check (status in ('pending', 'approved', 'hidden', 'failed')),
  media_kind text not null check (media_kind in ('image', 'video')),
  guest_name text,
  guest_message text,
  width integer,
  height integer,
  duration_seconds numeric,
  original_bytes bigint,
  original_drive_item_id text not null,
  preview_drive_item_id text,
  poster_drive_item_id text,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete set null,
  actor_email text not null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists media_event_status_created_idx
  on public.media (event_id, status, created_at desc);

create index if not exists upload_sessions_event_status_idx
  on public.upload_sessions (event_id, status);

alter table public.events enable row level security;
alter table public.onedrive_integrations enable row level security;
alter table public.upload_sessions enable row level security;
alter table public.media enable row level security;
alter table public.admin_audit_log enable row level security;

-- Anon: no direct access. Guests use Edge Functions with service role.
-- Authenticated admin policies added when ADMIN_EMAIL helper is in place.

revoke all on public.events from anon, authenticated;
revoke all on public.onedrive_integrations from anon, authenticated;
revoke all on public.upload_sessions from anon, authenticated;
revoke all on public.media from anon, authenticated;
revoke all on public.admin_audit_log from anon, authenticated;
