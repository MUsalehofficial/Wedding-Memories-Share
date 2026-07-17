-- Guest MVP: optional moderation gate (default off for single wedding).

alter table public.events
  add column if not exists moderation_enabled boolean not null default false;

alter table public.events
  add column if not exists guest_token_version integer not null default 1;

comment on column public.events.moderation_enabled is
  'When false, verified uploads auto-approve for gallery. When true, new completes stay pending.';
comment on column public.events.guest_token_version is
  'Increment to revoke all guest sessions (tokens embed this version).';

update public.events
set moderation_enabled = false
where slug = 'muhammad-basmala';
