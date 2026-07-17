# R2 bucket CORS

Configure on the private Cloudflare R2 bucket `wedding-memories` (R2 → bucket → Settings → CORS policy).

Do **not** enable public bucket access.

## Policy (JSON)

```json
[
  {
    "AllowedOrigins": [
      "https://share-memories-with-us.musalehofficial.com",
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Rules

- No wildcard `*` origins in production.
- Only methods/headers actually used by the app.
- If checksum headers are added later, extend `AllowedHeaders` explicitly (do not use `*`).
- Dashboard CORS changes take effect without redeploying Edge Functions.
