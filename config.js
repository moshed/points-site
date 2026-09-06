// The Supabase anon key is public by design: RLS on every lp_ table is deny-all
// with zero policies, so this key reads and writes nothing on its own. The only
// way in is the lp-api edge function, exactly as in the iOS app.
window.LP = {
  fn: "https://atqhfbaurrmivjarowco.supabase.co/functions/v1/lp-api",
  ws: "wss://atqhfbaurrmivjarowco.supabase.co/realtime/v1/websocket",
  anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cWhmYmF1cnJtaXZqYXJvd2NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzODc2ODgsImV4cCI6MjA5NTk2MzY4OH0.buWqvUnwid4QEE6m9OFM7n1tu51mcogTc01oG7pdtJI",
};
