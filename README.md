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

The anon key in `config.js` is public on purpose: RLS on every `lp_` table is
deny-all with zero policies, so the key alone reads and writes nothing.

Deployed by GitHub Pages from `main`. Editing any file and pushing is the deploy.
