# DNS — custom domain

## Production hostname

`share-memories-with-us.musalehofficial.com`

## Record

| Type | Host | Target |
|------|------|--------|
| CNAME | `share-memories-with-us` | `<GITHUB_USERNAME>.github.io` |

Do **not** point the CNAME at a repository path. Point at the GitHub user/org Pages apex host only.

## Setup steps

1. Create the CNAME at your DNS provider.
2. In the GitHub repo: Settings → Pages → Custom domain → `share-memories-with-us.musalehofficial.com`.
3. Wait for DNS check + certificate provisioning (can take minutes to hours).
4. Enable **Enforce HTTPS**.
5. Verify: `dig share-memories-with-us.musalehofficial.com CNAME` and open https://share-memories-with-us.musalehofficial.com/

## Retirement

When the temporary wedding site is retired:

1. Remove the custom domain from GitHub Pages settings.
2. Delete the DNS CNAME.
3. Optionally archive the repo and revoke Microsoft + rotate any remaining secrets.
