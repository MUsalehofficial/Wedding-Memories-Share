-- Google Drive storage + configurable capacity settings (additive).

alter table public.events
  add column if not exists video_uploads_enabled boolean not null default true,
  add column if not exists upload_safety_reserve_bytes bigint not null default 104857600
    check (upload_safety_reserve_bytes >= 0),
  add column if not exists capacity_warn_ratio numeric not null default 0.20
    check (capacity_warn_ratio > 0 and capacity_warn_ratio < 1),
  add column if not exists capacity_critical_ratio numeric not null default 0.10
    check (capacity_critical_ratio > 0 and capacity_critical_ratio < 1);

alter table public.media
  add column if not exists google_original_file_id text,
  add column if not exists google_preview_file_id text,
  add column if not exists google_poster_file_id text;

-- Allow google_drive as storage provider (widen check via drop/recreate if needed)
alter table public.media drop constraint if exists media_storage_provider_check;
alter table public.media
  add constraint media_storage_provider_check
  check (storage_provider in ('r2', 'onedrive_legacy', 'google_drive'));

alter table public.media
  alter column storage_provider set default 'google_drive';

create table if not exists public.google_drive_integrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  status text not null check (status in ('disconnected', 'connected', 'error')),
  google_account_email text,
  root_folder_id text,
  originals_images_folder_id text,
  originals_videos_folder_id text,
  previews_images_folder_id text,
  previews_posters_folder_id text,
  refresh_token_vault_secret_id uuid,
  last_token_refresh_at timestamptz,
  last_quota_check_at timestamptz,
  last_quota_limit_bytes bigint,
  last_quota_usage_bytes bigint,
  last_successful_api_at timestamptz,
  last_error text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id)
);

alter table public.google_drive_integrations enable row level security;
revoke all on public.google_drive_integrations from anon, authenticated;

comment on table public.google_drive_integrations is
  'Google Drive OAuth connection for wedding media. Refresh token lives in Vault.';

create index if not exists media_google_original_file_id_idx
  on public.media (google_original_file_id)
  where google_original_file_id is not null;

-- OAuth CSRF state (short-lived)
create table if not exists public.oauth_states (
  state text primary key,
  provider text not null default 'google',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;

-- Vault helpers (service_role only)
create or replace function public.wedding_vault_put(secret_name text, secret_value text)
returns uuid
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  sid uuid;
begin
  select vault.create_secret(secret_value, secret_name, 'wedding google refresh') into sid;
  return sid;
end;
$$;

create or replace function public.wedding_vault_get(secret_id uuid)
returns text
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  val text;
begin
  select ds.decrypted_secret into val
  from vault.decrypted_secrets ds
  where ds.id = secret_id;
  return val;
end;
$$;

create or replace function public.wedding_vault_update(secret_id uuid, secret_value text)
returns void
language plpgsql
security definer
set search_path = vault, public
as $$
begin
  perform vault.update_secret(secret_id, secret_value);
end;
$$;

revoke all on function public.wedding_vault_put(text, text) from public, anon, authenticated;
revoke all on function public.wedding_vault_get(uuid) from public, anon, authenticated;
revoke all on function public.wedding_vault_update(uuid, text) from public, anon, authenticated;
grant execute on function public.wedding_vault_put(text, text) to service_role;
grant execute on function public.wedding_vault_get(uuid) to service_role;
grant execute on function public.wedding_vault_update(uuid, text) to service_role;
