# demongacha auto pack opener (Cloudflare Worker)

Opens packs on demongacha.com on a cron schedule using your logged-in session.

## Deploy

```bash
cd demongacha-worker
npx wrangler login
npx wrangler secret put SID            # value of the `sid` cookie
npx wrangler secret put CF_CLEARANCE   # value of the `cf_clearance` cookie
npx wrangler secret put TRIGGER_TOKEN  # optional, any random string
npx wrangler deploy
```

Get the cookie values from DevTools > Application > Cookies > demongacha.com.
Don't paste them into chats or commit them. Rotate them (log out and back in) if they were shared.

## Tuning

Edit `wrangler.toml`:
- `crons`: how often it runs (default every 30 minutes). Match the site's pack cooldown.
- `MAX_OPENS_PER_RUN`: cap on open calls per run.
- `PACKS_PER_OPEN`: the `count` sent per request.

## Manual run / status (needs TRIGGER_TOKEN)

```bash
curl -X POST https://<your-worker>.workers.dev/run    -H "Authorization: Bearer <TRIGGER_TOKEN>"
curl            https://<your-worker>.workers.dev/status -H "Authorization: Bearer <TRIGGER_TOKEN>"
```

Watch cron output live with `npx wrangler tail`.

## Known limitation

`cf_clearance` is a Cloudflare bot-challenge cookie tied to the IP and user agent it
was issued to, and it expires. Requests from Cloudflare's network will often get a 403 even
with a valid cookie. If that happens, the Worker stops and logs the reason. Fixes:
- Run the same script from your own machine/server (it is plain `fetch`, works in Node 18+), or
- Ask the site owner for an API token or an allowlist for the Worker.
`sid` also expires eventually; re-copy it when you see 401s.
