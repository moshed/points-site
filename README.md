# points.dancykier.com

The web client for **Listening Points**. Same backend as the iOS app — one POST
to the `lp-api` Supabase edge function, which returns the whole state every time.

- Give or take a point with one tap; anything bigger is behind **Custom**.
- The pace chart draws **Total** plus each person, the straight line needed, and
  where the current rate lands. Every plotted value is a whole point.
- **Live.** A Supabase Realtime *broadcast* subscription (not `postgres_changes`
  — RLS is deny-all, so a row-level subscription with the anon key gets nothing).
  The function rings a contentless doorbell after each write and clients re-read.
  A 60-second poll backs it up, because a socket can die silently.
- Identity is a UUID in `localStorage`, the browser's version of the app's
  synced-Keychain device id. It is what stamps each point with who gave it.
  No login, by design.
- **A name is required**, on open and before any point. It used to ask with
  `window.prompt()`; people dismissed it, and 25 of the first 27 web identities
  ended up anonymous — which makes "who gave what" useless. It is now an
  in-page dialog with no Cancel and no Escape until a name is typed, and an
  existing nameless visitor is asked again next time they open the page.

The anon key in `config.js` is public on purpose: RLS on every `lp_` table is
deny-all with zero policies, so the key alone reads and writes nothing.

**Hosted on Cloudflare Pages** (project `points-lp`), not GitHub Pages. GitHub
never issued a certificate for the subdomain — it sat at `pending` for hours
while HTTP served fine — and Cloudflare issues one in minutes.

Pushing to `main` deploys: `.github/workflows/deploy.yml` runs
`wrangler pages deploy`. Direct upload rather than a Git connection, which
avoids the dashboard OAuth click. There is deliberately **no `CNAME` file** —
that is a GitHub Pages mechanism and would only confuse things here.
