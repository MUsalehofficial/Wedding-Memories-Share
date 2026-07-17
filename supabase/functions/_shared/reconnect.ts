/** invalid_grant → reconnect-required; pause uploads; never delete media. */

// deno-lint-ignore no-explicit-any
export async function markReconnectRequired(sb: any, eventId: string): Promise<void> {
  await sb
    .from('google_drive_integrations')
    .update({
      status: 'reconnect_required',
      last_error: 'invalid_grant',
      updated_at: new Date().toISOString(),
    })
    .eq('event_id', eventId)

  // Pause new originals only — gallery previews stay available; Drive media retained.
  await sb
    .from('events')
    .update({
      uploads_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId)
}

export function isDriveUploadBlocked(status: string | null | undefined): boolean {
  return status === 'reconnect_required' || status === 'disconnected' || status === 'error'
}
