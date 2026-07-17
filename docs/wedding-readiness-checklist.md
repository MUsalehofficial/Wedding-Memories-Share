# Wedding readiness checklist

Private single-wedding release validation for **Muhammad & Basmala**.  
Production: `https://share-memories-with-us.musalehofficial.com`  
**Never** record invite URLs, raw QR tokens, wedding access codes, admin secrets, or Google credentials in this file.

---

## Release validation (2026-07-17)

| Item | Status | Notes |
|------|--------|-------|
| Production QR generated | **Done** | Opaque invite; SHA-256 hash only in Postgres; expiry after wedding (2026-12-31 UTC); PNG+SVG under private `/tmp` (not committed) |
| QR printable card designed | **Done** | Linen/gold identity card outside repo; no wedding code on primary card; quiet zone preserved |
| QR printed / camera-scanned | **Human required** | Print `/tmp/wedding-release/qr-card-print.html` (or PNG/SVG); scan on real phones |
| iPhone Safari end-to-end | **Human required** | Checklist § Real device tests below |
| Android Chrome end-to-end | **Human required** | Checklist § Real device tests below |
| Photo upload (API smoke) | **Pass** | Resumable → Google Drive → preview → gallery |
| Video upload (API smoke) | **Pass** | Short MP4 → Drive → poster preview → gallery |
| Gallery | **Pass** | Items visible with guest session; signed previews work while Drive connected |
| Emergency controls | **Pass (API/SQL)** | Uploads / videos / gallery disable verified; guest session revoke verified; Drive reconnect pause verified (gallery retained) |
| Google OAuth health | **Pass** | `gdrive-health` ready; integration `connected`; live `about.get` via `gdrive-quota`; Console status **In production** (operator-confirmed earlier) |
| Drive capacity | **Recorded** | See capacity section; estimate recommends more storage before wedding |
| Custom-domain HTTPS | **Pass** | `https://share-memories-with-us.musalehofficial.com` serves SPA (HTTP 200). HSTS not set by GitHub Pages |
| Secret scan (frontend bundle) | **Pass** | Bundle contains Supabase project URL + Edge Function base only; no `service_role`, Google secrets, refresh tokens, or invite token |
| Ops CLI (`scripts/ops.mjs`) | **Documented** | Requires `SUPABASE_SERVICE_ROLE_KEY` in operator shell; commands listed in `docs/operations.md`. Equivalent toggles verified via secured API/SQL this session |
| Reconciliation dry-run | **Pass (SQL report)** | Report-only counts taken; **no** `--apply` / destructive cleanup |
| Recovery instructions | **Documented** | See below + `docs/operations.md` / `docs/qr-access.md` |
| Site retirement steps | **Documented** | See below |

---

## Real device tests (operator)

Use the **printed** QR only. Do not paste the invite URL into chat, tickets, or screenshots.

For **iPhone Safari** and **Android Chrome**, check each:

1. Camera scans the QR  
2. Production URL opens over HTTPS  
3. Invite exchanges successfully  
4. Token disappears from the URL (`/#/join` scrubbed)  
5. Lands on `/#/upload`  
6. Guest session persists through normal navigation  
7. Select one real phone photo  
8. Upload progress visible  
9. Upload completes to Google Drive  
10. Preview in private Supabase Storage  
11. Photo appears in gallery  
12. Full-screen viewer works  
13. Refresh does not expose invite token  
14. Second upload works  
15. Camera capture input where supported  
16. Usable errors on a slow network  

Also: one short video on at least one device.

| Device | Result | Tester initials / date |
|--------|--------|------------------------|
| iPhone / Safari | ☐ Pass / ☐ Fail | |
| Android / Chrome | ☐ Pass / ☐ Fail | |
| Photo upload (device) | ☐ Pass / ☐ Fail | |
| Video upload (device) | ☐ Pass / ☐ Fail | |

Sanitized evidence only (no QR token/URL in screenshots).

---

## Live Drive capacity (do not hardcode forever — re-check wedding morning)

Retrieved via production `GET …/gdrive-quota` (`about.get`) during release validation:

| Field | Value |
|-------|-------|
| Limit | 15 GiB (`16106127360` bytes) |
| Usage | ~10.34 GiB (`11102366642` bytes) |
| Available | ~4.66 GiB (`5003760718` bytes) |
| Trash usage | 0 |
| Capacity level | `ok` |
| Safety reserve | 100 MiB (`104857600` bytes) |
| Usable after reserve (approx.) | ~4.56 GiB |

### Estimate (label: estimate)

Assumption example: ~150 guests × ~15 photos × ~4 MiB + ~20% guests × ~40 MiB video ≈ **~10 GiB** new originals.  
With ~4.6 GiB usable headroom, estimated coverage is well under that load.

**Recommendation:** purchase additional Google storage before the wedding (estimate). Re-run `node scripts/ops.mjs quota` (or `gdrive-quota`) after any purchase and on the morning of the event.

---

## Security checks (validated)

- [x] `ADMIN_PANEL_SECRET` configured (`gdrive-health`)  
- [x] `GUEST_TOKEN_SIGNING_SECRET` configured  
- [x] Email-shaped / non-secret admin headers rejected (`admin_unauthorized`) — `ADMIN_EMAIL` is not a passphrase  
- [x] Google OAuth **In production** (prior operator confirmation); refresh path healthy (`about.get` succeeds)  
- [x] Custom domain HTTPS  
- [x] Frontend bundle: no Google credentials / privileged Supabase keys  
- [x] QR invite: hash column only; raw token absent from DB/repo  
- [x] No `guest_sessions` table — guest JWTs not stored in Postgres  
- [x] Manual wedding-code access works (`verify-access-code` with `{ code }`)  
- [x] Old disclosed code `MB-B37B9E` rejected (`invalid_code`)  

---

## Failure matrix (validated)

| Scenario | Result |
|----------|--------|
| Invalid QR token | `401 invalid_invite` |
| Expired QR token | `401 invite_expired` |
| Revoked QR token | `401 invite_revoked` |
| Revoked guest session (`guest_token_version` bump) | `401 guest_token_revoked` |
| Uploads disabled | `403 uploads_disabled`; gallery still readable |
| Video uploads disabled | `403 video_uploads_disabled`; images still allowed |
| Gallery disabled | `403 gallery_disabled` |
| Drive `reconnect_required` | Uploads paused (`503 google_drive_reconnect_required`); gallery + signed previews remain |
| Interrupted upload + retry | Resume via Content-Range / query offset; complete OK |
| Missing preview | Approved item without preview object; signed preview fails; other gallery items remain |
| Storage capacity rejection (`507 storage_full`) | Unit + prior spike (temporary reserve); live gate present — do not force-fill Drive for retest |
| Slow network errors | **Human** on device |

All emergency flags restored to production defaults after probes (`uploads`/`videos`/`gallery` enabled; Drive `connected`).

---

## Operator commands (safe reference)

See `docs/operations.md` and `docs/qr-access.md`.

```bash
export SUPABASE_URL=https://vszfgqylajnvdbjqadjr.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...   # never commit

node scripts/ops.mjs status
node scripts/ops.mjs enable-uploads   # / disable-uploads
node scripts/ops.mjs enable-videos    # / disable-videos
node scripts/ops.mjs enable-gallery   # / disable-gallery
node scripts/ops.mjs quota
node scripts/ops.mjs revoke-guest-sessions
node scripts/ops.mjs list-media 30
node scripts/ops.mjs hide-media <mediaId>
# OPS_CONFIRM=YES node scripts/ops.mjs delete-media <mediaId>
node scripts/ops.mjs reconcile              # report-only dry-run
# OPS_CONFIRM=YES node scripts/ops.mjs reconcile --apply
node scripts/ops.mjs list-qr-invites
# OPS_CONFIRM=YES node scripts/ops.mjs revoke-qr-invites
node scripts/ops.mjs create-qr-invite       # prints URL once; store hash only
# printf '%s\n' "$INVITE_URL" | node scripts/ops.mjs generate-qr
```

Destructive actions require `OPS_CONFIRM=YES` and explicit confirmation.

### Replacement QR (if a print is compromised)

1. `OPS_CONFIRM=YES node scripts/ops.mjs revoke-qr-invites`  
2. `node scripts/ops.mjs create-qr-invite` (capture URL once; do not commit)  
3. Pipe URL into `generate-qr`; print new card; destroy old prints  
4. Optionally `revoke-guest-sessions` if sessions may already be issued  

---

## Recovery

1. **Uploads broken / Drive auth:** check `event-public.reconnectRequired`; admin reconnect via `/#/admin/drive` with `ADMIN_PANEL_SECRET` only (`docs/operations.md`). Do not revoke a still-valid refresh token.  
2. **Abuse / leaked QR:** revoke QR invites + guest sessions; create replacement invite; reprint.  
3. **Gallery clutter:** `hide-media` / secured `delete-media` (not manual Drive-only deletes).  
4. **After manual Drive deletion:** `node scripts/ops.mjs reconcile` (report-only first).  
5. **Capacity:** buy Google storage; re-check `quota`.  

---

## Site retirement (after wedding)

1. `OPS_CONFIRM=YES node scripts/ops.mjs revoke-qr-invites`  
2. `node scripts/ops.mjs revoke-guest-sessions`  
3. `node scripts/ops.mjs disable-uploads` (and gallery if desired)  
4. Destroy printed QRs and any private invite URL copies  
5. Optionally rotate wedding access code  
6. Export / archive Drive originals as needed; then deprecate Pages + Edge when ready  

---

## Prior / optional load items

- [ ] 100-photo load test  
- [ ] Concurrent guest stress test  
- [ ] Venue gallery display rehearsal  

These are optional polish — not required to complete QR/release validation scope.
