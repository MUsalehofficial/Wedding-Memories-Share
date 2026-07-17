# Repository inventory

**Date:** 2026-07-17  
**Workspace:** `Wedding-Share-Memories-With-Us`

## Summary

This repository was **empty** at inspection time (no application code, no git history, no remote). The only existing content was Cursor IDE settings enabling the Supabase plugin.

No unrelated work exists to preserve. Greenfield build is appropriate.

## Contents found

| Path | Purpose |
|------|---------|
| `.cursor/settings.json` | Enables Supabase Cursor plugin |

## Not found

- No `frontend/`, `supabase/`, `docs/` (before this audit), or `.github/`
- No git repository initialized (`git status` failed)
- No `README`, env examples, or lockfiles
- No prior OneDrive / upload spike artifacts

## Related external systems (not in this repo)

| Resource | Status | Notes |
|----------|--------|-------|
| Invitation site | Live | https://muhammad-and-basmala-wedding-invitation.musalehofficial.com/ — primary visual reference |
| Supabase org `dikuoeotvqsevzgmrfie` | Active | Contains unrelated / inactive projects |
| `wedding-invitation-rsvp` (`haxxbylgztrhmxnilobg`) | **INACTIVE** | RSVP project — do not reuse for photo sharing |
| `Cilantro-B2B-APP` (`bbntkrmpyxetnnjlgyfl`) | **INACTIVE** | Unrelated product |

## Decision

1. Initialize a new git repository when the user requests commits.
2. Create a **new** dedicated Supabase project for this wedding photo app (do not revive or overwrite the RSVP project).
3. Reuse invitation visual assets by downloading copies into this repo (already captured under `docs/reference-screenshots/assets/` for audit; production copies will live under `frontend/public/`).

## Audit artifacts produced in this pass

- `docs/reference-screenshots/` — desktop/mobile viewport + inner invitation screenshots
- `docs/reference-screenshots/assets/` — wax seal, MB monogram, rings, sprig, og-share, favicon
- `docs/reference-screenshots/extracted-tokens.json` — live computed styles from Playwright
