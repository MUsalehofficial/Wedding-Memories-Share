-- Guest MVP: reconnect_required status for invalid_grant (do not delete media).

alter table public.google_drive_integrations
  drop constraint if exists google_drive_integrations_status_check;

alter table public.google_drive_integrations
  add constraint google_drive_integrations_status_check
  check (status in ('disconnected', 'connected', 'error', 'reconnect_required'));

comment on column public.google_drive_integrations.status is
  'connected | disconnected | error | reconnect_required (invalid_grant; uploads paused; media retained)';
