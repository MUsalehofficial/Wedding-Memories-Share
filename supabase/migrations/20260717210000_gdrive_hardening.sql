-- Google Drive hardening: folder hierarchy columns + private preview bucket.

alter table public.google_drive_integrations
  add column if not exists originals_folder_id text,
  add column if not exists exports_folder_id text;

comment on column public.google_drive_integrations.originals_folder_id is
  'Wedding Memories/Originals folder id (stored; not re-searched per upload)';
comment on column public.google_drive_integrations.exports_folder_id is
  'Wedding Memories/Exports folder id';

-- Private gallery previews / video posters (not Drive originals).
-- No anon/authenticated policies → RLS denies direct access; Edge uses service role + signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wedding-previews',
  'wedding-previews',
  false,
  5242880,
  array['image/jpeg', 'image/webp', 'image/png']
)
on conflict (id) do update set public = false;
