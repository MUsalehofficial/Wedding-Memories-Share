-- Additive R2 media columns (does not rewrite spike_core).
-- OneDrive columns retained but nullable; R2 is the active storage provider.

alter table public.media
  alter column original_drive_item_id drop not null;

alter table public.media
  add column if not exists storage_provider text not null default 'r2'
    check (storage_provider in ('r2', 'onedrive_legacy')),
  add column if not exists original_object_key text,
  add column if not exists preview_object_key text,
  add column if not exists video_poster_object_key text,
  add column if not exists original_etag text,
  add column if not exists preview_etag text,
  add column if not exists size_bytes bigint,
  add column if not exists mime_type text,
  add column if not exists upload_status text
    check (upload_status in (
      'created', 'processing', 'uploaded', 'failed', 'abandoned', 'deleted'
    )),
  add column if not exists moderation_status text
    check (moderation_status in ('pending', 'approved', 'hidden'));

-- Prefer R2 keys for lookups once present
create index if not exists media_original_object_key_idx
  on public.media (original_object_key)
  where original_object_key is not null;

create index if not exists media_upload_moderation_idx
  on public.media (event_id, upload_status, moderation_status, created_at desc);

comment on column public.media.storage_provider is
  'Active provider is r2. onedrive_legacy retained for historical rows only.';

comment on table public.onedrive_integrations is
  'SUPERSEDED: OneDrive integration cancelled. Table kept for migration history; do not use.';

-- Spike/event bootstrap: placeholder hash only (not a real wedding code).
insert into public.events (slug, couple_names, access_code_hash, access_code_salt)
select
  'muhammad-basmala',
  'Muhammad & Basmala',
  encode(digest('placeholder-not-a-real-code', 'sha256'), 'hex'),
  encode(gen_random_bytes(16), 'hex')
where not exists (select 1 from public.events where slug = 'muhammad-basmala');
