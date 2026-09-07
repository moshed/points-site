/* Listening Points — web client.
 *
 * Same backend as the iOS app: one POST to `lp-api`, which returns the complete
 * state every time. Identity is a UUID in localStorage, the browser's equivalent
 * of the app's synced-Keychain device id — it is what stamps each point with who
 * gave it. There is no login and there is not going to be one.
 */
const $ = (sel) => document.querySelector(sel);
const LP = window.LP;

/* ---------- identity ---------- */

function deviceId() {
  let id = localStorage.getItem("lp.device_id");
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
    localStorage.setItem("lp.device_id", id);
  }
  return id;
}
const myName = () => localStorage.getItem("lp.name") || "";

/* ---------- api ---------- */

let state = null;
let busy = false;

async function call(payload) {
  const body = {
    ...payload,
    device_id: deviceId(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  if (myName()) body.display_name = myName();

  const res = await fetch(LP.fn, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + LP.anon,
      apikey: LP.anon,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  state = json;
  render();
  return json;
}

/* ---------- maths (mirrors Store.swift) ---------- */

/** A Postgres `date` has no time zone. Parse it in the LOCAL calendar or the
 *  deadline reads a day early for anyone west of UTC. */
function parseDay(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
const startOfToday = () => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
};
const dayDiff = (a, b) => Math.round((b - a) / 86400000);

function derived() {
  const target = state.settings.target;
  const total = state.total;
  const deadline = parseDay(state.settings.deadline);
  const today = startOfToday();
  const now = new Date();

  // The deadline expires at the END of its day.
  const deadlineEnd = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate() + 1);

  // Fractional days, counting only the hours actually left today. Treating today
  // as a whole day is a lie after breakfast: at 8pm on the last day it would
  // still say "1 day left" and quote a rate nobody could hit.
  const daysExact = Math.max(0, (deadlineEnd - now) / 86400000);
  const daysRemaining = Math.ceil(daysExact);
  const remaining = Math.max(0, target - total);
  const neededPerDay = daysExact > 0.0001 ? remaining / daysExact : remaining;

  const firstDay = state.daily.length ? parseDay(state.daily[0].date) : null;
  // Real elapsed time, not whole calendar days — whole days flatter an app that
  // is only hours old.
  const elapsed = firstDay ? Math.max((now - firstDay) / 86400000, 0.25) : 0;
  const pace = elapsed > 0 ? total / elapsed : 0;
  const projected = Math.round(total + pace * daysExact);

  return {
    target, total, deadline, deadlineEnd, today, daysExact, daysRemaining,
    remaining, neededPerDay, firstDay, pace, projected,
    onPace: projected >= target,
  };
}

const perDayText = (d) =>
  d.remaining === 0 ? "0"
    : d.neededPerDay < 1 ? d.neededPerDay.toFixed(1)
    : String(Math.ceil(d.neededPerDay));

function sentence(d) {
  if (d.remaining === 0) return "Target reached. Nice.";
  if (!d.firstDay) {
    return `No points yet. ${d.remaining} needed in ${d.daysRemaining} days — that is ${perDayText(d)} a day.`;
  }
  return `Running at ${d.pace.toFixed(1)} points a day. At that rate you finish on ${d.projected}. You need ${perDayText(d)} a day to hit ${d.target}.`;
}

/* Person colours by id, with a positional fallback so a new person is never
 * gold — that belongs to the Total and has to stay unique to it. */
const PERSON_VARS = { yehuda: "--yehuda", daniel: "--daniel", netanel: "--netanel" };
const PALETTE = ["--yehuda", "--daniel", "--netanel"];

const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function colorFor(id) {
  if (PERSON_VARS[id]) return cssVar(PERSON_VARS[id]);
  const i = state ? state.people.findIndex((p) => p.id === id) : 0;
  return cssVar(PALETTE[Math.max(0, i) % PALETTE.length]);
}

/* ---------- chart ---------- */

/** Hand-rolled SVG, so the page loads no libraries and works offline-ish.
 *  Every plotted value is a whole point — a chart of points must never show
 *  "12.5", which is the same rule the iOS chart follows. */
function chartSVG(d) {
  const w = 620, h = 260, padL = 38, padR = 10, padT = 8, padB = 26;
  const iw = w - padL - padR, ih = h - padT - padB;

  const x0 = d.firstDay
    ? new Date(d.firstDay.getTime() - 86400000)
    : new Date(d.today.getTime() - 86400000);
  const x1 = d.deadlineEnd > d.today ? d.deadlineEnd : new Date(d.today.getTime() + 86400000);
  const spanX = Math.max(1, x1 - x0);

  const series = [];
  const cum = (rows) => rows.map((r) => ({ t: parseDay(r.date), v: Math.round(r.cumulative) }));

  const totalPts = [{ t: x0, v: 0 }, ...cum(state.daily)];
  series.push({ name: "Total", color: "var(--total)", w: 3, dash: "", pts: totalPts });

  for (const p of state.people) {
    const rows = (state.daily_by_person || []).filter((r) => r.person_id === p.id);
    series.push({
      name: p.display_name, color: colorFor(p.id), w: 1.6, dash: "",
      pts: [{ t: x0, v: 0 }, ...cum(rows)],
    });
  }
  // No "Needed" line — the dashed target rule already says where the goal is.
  // The projection is the Total line continued, so it shares the Total's colour;
  // dashed is what marks it as a guess.
  series.push({
    name: "On pace for", color: "var(--total)", w: 2, dash: "5 4",
    pts: [{ t: new Date(), v: d.total }, { t: d.deadlineEnd, v: d.projected }],
  });

  const all = series.flatMap((s) => s.pts.map((p) => p.v));
  const lo = Math.floor(Math.min(0, ...all));
  const hi = Math.ceil(Math.max(d.target, ...all));
  const pad = Math.max(5, Math.ceil((hi - lo) * 0.04));
  const yLo = lo - pad, yHi = hi + pad, spanY = Math.max(1, yHi - yLo);

  const sx = (t) => padL + ((t - x0) / spanX) * iw;
  const sy = (v) => padT + ih - ((v - yLo) / spanY) * ih;

  // Round-number gridlines. A plain span/4 gives steps like 81 — integers, but
  // nobody reads a chart in 81s.
  const nice = (raw) => {
    const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow;
    return 10 * pow;
  };
  const step = Math.max(1, nice((yHi - yLo) / 4));
  const ticks = [];
  for (let v = Math.ceil(yLo / step) * step; v <= yHi; v += step) ticks.push(Math.round(v));

  const totalDays = Math.max(1, Math.round(spanX / 86400000));
  // One label per slot; a hairline for every single day regardless.
  const slots = window.innerWidth >= 700 ? 12 : 6;
  const labelEvery = Math.max(1, Math.ceil(totalDays / slots));

  let svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Points over time">`;

  // Every day gets a hairline, so the horizontal scale is readable even where
  // there is no room for a date.
  for (let i = 0; i <= totalDays; i++) {
    const t = new Date(x0.getTime() + i * 86400000);
    const x = sx(t);
    const major = i % labelEvery === 0;
    svg += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + ih}" `
         + `stroke="var(--edge)" stroke-width="1" stroke-opacity="${major ? 0.9 : 0.35}"/>`;
    if (major) {
      svg += `<text x="${x.toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="9.5" `
           + `fill="var(--muted)">${t.getMonth() + 1}/${t.getDate()}</text>`;
    }
  }
  for (const v of ticks) {
    svg += `<line x1="${padL}" y1="${sy(v)}" x2="${w - padR}" y2="${sy(v)}" stroke="var(--edge)" stroke-width="1"/>`;
    svg += `<text x="${padL - 6}" y="${sy(v) + 3.5}" text-anchor="end" font-size="9.5" fill="var(--muted)">${v}</text>`;
  }
  svg += `<line x1="${padL}" y1="${sy(d.target)}" x2="${w - padR}" y2="${sy(d.target)}" stroke="var(--total)" stroke-opacity=".45" stroke-width="1" stroke-dasharray="3 3"/>`;

  for (const s of series) {
    if (s.pts.length < 2) continue;
    const dAttr = s.pts.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
    svg += `<path d="${dAttr}" fill="none" stroke="${s.color}" stroke-width="${s.w}" stroke-linecap="round" stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`;
  }
  // Small marks on the real days — big dots turn a month of history into a smear.
  if (state.daily.length <= 45) {
    for (const p of totalPts) {
      svg += `<circle cx="${sx(p.t).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="1.8" fill="var(--total)"/>`;
    }
  }
  svg += `</svg>`;

  // No legend: every person is already named and coloured in their own column.
  return { svg, legend: "" };
}

/* ---------- render ---------- */

function render() {
  if (!state) return;
  const d = derived();

  $("#pill").className = "pill " + (d.onPace ? "ok" : "behind");
  $("#pill").textContent = d.onPace ? "On pace ›" : "Behind ›";

  $("#total").textContent = d.total;
  $("#total").className = d.total < 0 ? "neg" : "";
  $("#target").textContent = "/ " + d.target;

  const scale = Math.max(d.target, 1);
  $("#split").innerHTML = state.people
    .map((p) => {
      const pct = (Math.max(0, p.total) / scale) * 100;
      return `<i style="width:${Math.min(100, pct)}%;background:${colorFor(p.id)}"></i>`;
    })
    .join("");

  $("#toGo").textContent = d.remaining;
  $("#daysLeft").textContent = d.daysRemaining;
  $("#perDay").textContent = perDayText(d);

  $("#people").innerHTML = state.people
    .map((p) => {
      const c = colorFor(p.id);
      return `<div class="person">
        <div class="name" style="color:${c}">${esc(p.display_name)}</div>
        <div class="score${p.total < 0 ? " neg" : ""}">${p.total}</div>
        <div class="btns">
          <button class="big" data-give="${p.id}" style="color:${c};border-color:${c};background:color-mix(in srgb, ${c} 16%, transparent)">+1</button>
          <button class="big" data-take="${p.id}" style="color:var(--neg);border-color:var(--neg);background:color-mix(in srgb, var(--neg) 16%, transparent)">−1</button>
          <button class="custom" data-custom="${p.id}">Custom</button>
        </div>
      </div>`;
    })
    .join("");

  const { svg, legend } = chartSVG(d);
  $("#chart").innerHTML = svg;
  $("#legend").innerHTML = legend;
  $("#sentence").textContent = sentence(d);

  // The button is a 34px circle: it keeps the emoji and carries the name as a
  // tooltip. Writing the name into it burst the circle open.
  $("#who").title = myName() ? `You are ${myName()} — tap to change` : "Set your name";
  $("#who").textContent = myName() ? myName().trim()[0].toUpperCase() : "👤";
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- actions ---------- */

/* Unlocked only for this page view. Not stored, so closing the tab re-locks it —
 * a phone left open on a table is exactly what this is for. */
let unlocked = false;

async function award(personId, delta, note = "") {
  // No anonymous points. A ledger whose whole purpose is "who gave what" is
  // worthless when most entries say "Someone" — which is exactly what happened
  // when this asked with window.prompt(): people dismissed it, or the browser
  // suppressed it, and the name was never set.
  if (!myName()) {
    pendingAward = { personId, delta, note };
    askName(true);
    return;
  }
  if (!unlocked) {
    pendingAward = { personId, delta, note };
    askPin();
    return;
  }
  if (busy) return;
  busy = true;
  try {
    await call({ action: "add", person_id: personId, delta, note });
    if (navigator.vibrate) navigator.vibrate(8);
  } catch (e) {
    alert(e.message);
  } finally {
    busy = false;
  }
}

document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-give],[data-take],[data-custom]");
  if (!t) return;
  if (t.dataset.give) award(t.dataset.give, 1);
  else if (t.dataset.take) award(t.dataset.take, -1);
  else openCustom(t.dataset.custom);
});

/* ---------- custom sheet ---------- */

let customPerson = null;
let customTaking = false;

function openCustom(personId) {
  customPerson = state.people.find((p) => p.id === personId);
  customTaking = false;
  $("#customTitle").textContent = customPerson.display_name;
  $("#amount").value = 1;
  $("#note").value = "";
  syncCustom();
  $("#customDlg").showModal();
}

function syncCustom() {
  const mag = Math.max(1, parseInt($("#amount").value || "1", 10));
  const c = customTaking ? "var(--neg)" : colorFor(customPerson.id);
  $("#preview").textContent = (customTaking ? "−" : "+") + mag;
  $("#preview").style.color = c;
  $("#confirm").style.background = c;
  $("#confirm").textContent = customTaking
    ? `Take ${mag} from ${customPerson.display_name}`
    : `Give ${customPerson.display_name} ${mag}`;
  document.querySelectorAll("#presets button").forEach((b) =>
    b.setAttribute("aria-pressed", String(Number(b.dataset.p) === mag)));
  $("#giveBtn").setAttribute("aria-pressed", String(!customTaking));
  $("#takeBtn").setAttribute("aria-pressed", String(customTaking));
}

/* ---------- live updates ---------- */

/* Broadcast, not postgres_changes: RLS is deny-all so a row-level subscription
 * with the anon key would receive nothing. lp-api rings a contentless doorbell
 * after every write and we re-read through the function. A 60s poll backs it up,
 * because a socket can die silently. */
let ws = null, hb = null, backoff = 1000;

function goLive() {
  try {
    ws = new WebSocket(`${LP.ws}?apikey=${encodeURIComponent(LP.anon)}&vsn=1.0.0`);
  } catch { return retry(); }

  ws.onopen = () => {
    backoff = 1000;
    ws.send(JSON.stringify({
      topic: "realtime:lp-points",
      event: "phx_join",
      payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "" } } },
      ref: "1",
    }));
    clearInterval(hb);
    hb = setInterval(() => {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "hb" }));
      }
    }, 25000);
  };
  ws.onmessage = (m) => {
    let msg;
    try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.event === "broadcast") call({ action: "state" }).catch(() => {});
  };
  ws.onclose = retry;
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function retry() {
  clearInterval(hb);
  ws = null;
  const wait = backoff;
  backoff = Math.min(backoff * 2, 30000);
  setTimeout(goLive, wait);
}

setInterval(() => call({ action: "state" }).catch(() => {}), 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) call({ action: "state" }).catch(() => {});
});

/* ---------- boot ---------- */

function bindUI() {
  $("#pill").onclick = () => $("#paceDlg").showModal();
  $("#menuBtn").onclick = () => $("#menuDlg").showModal();
  $("#who").onclick = () => askName(false);
  $("#nameSave").onclick = saveName;
  $("#nameCancel").onclick = () => { pendingAward = null; $("#nameDlg").close(); };
  $("#nameInput").onkeydown = (e) => { if (e.key === "Enter") saveName(); };
  $("#pinSubmit").onclick = submitPin;
  $("#pinCancel").onclick = () => { pendingAward = null; $("#pinDlg").close(); };
  $("#pinInput").onkeydown = (e) => { if (e.key === "Enter") submitPin(); };
  // A required prompt must not be escapable, or we are back to anonymous points.
  $("#nameDlg").addEventListener("cancel", (e) => {
    if ($("#nameCancel").hidden) e.preventDefault();
  });

  $("#giveBtn").onclick = () => { customTaking = false; syncCustom(); };
  $("#takeBtn").onclick = () => { customTaking = true; syncCustom(); };
  $("#minus").onclick = () => { $("#amount").value = Math.max(1, +$("#amount").value - 1); syncCustom(); };
  $("#plus").onclick = () => { $("#amount").value = Math.min(1000, +$("#amount").value + 1); syncCustom(); };
  $("#amount").oninput = syncCustom;
  document.querySelectorAll("#presets button").forEach((b) => {
    b.onclick = () => { $("#amount").value = b.dataset.p; syncCustom(); };
  });
  $("#confirm").onclick = () => {
    const mag = Math.max(1, parseInt($("#amount").value || "1", 10));
    $("#customDlg").close();
    award(customPerson.id, customTaking ? -mag : mag, $("#note").value.trim());
  };
  $("#historyBtn").onclick = () => {
    $("#menuDlg").close();
    renderHistory();
    $("#histDlg").showModal();
  };
  $("#paceBtn").onclick = () => { $("#menuDlg").close(); $("#paceDlg").showModal(); };
  $("#nameBtn").onclick = () => { $("#menuDlg").close(); askName(); };
  document.querySelectorAll("[data-close]").forEach((b) => {
    b.onclick = () => b.closest("dialog").close();
  });
}

let pendingAward = null;

/** `required` blocks Cancel: it is shown because someone tried to give a point. */
function askName(required = false) {
  const dlg = $("#nameDlg");
  $("#nameInput").value = myName();
  $("#nameErr").hidden = true;
  $("#nameCancel").hidden = required;
  $("#nameTitle").textContent = required ? "Name first" : "Who are you?";
  $("#nameWhy").textContent = required
    ? "Type your name to use Listening Points. It goes on every point you give, so everyone can see who awarded what."
    : "Your name goes on every point you give, so everyone can see who awarded what.";
  if (!dlg.open) dlg.showModal();
  setTimeout(() => $("#nameInput").focus(), 50);
}

function saveName() {
  const v = $("#nameInput").value.trim().slice(0, 60);
  if (!v) {
    $("#nameErr").hidden = false;
    return;
  }
  localStorage.setItem("lp.name", v);
  $("#nameDlg").close();
  call({ action: "state" }).catch(() => {});
  if (pendingAward) {
    const a = pendingAward;
    pendingAward = null;
    award(a.personId, a.delta, a.note);
  }
}

function askPin() {
  $("#pinErr").hidden = true;
  $("#pinInput").value = "";
  if (!$("#pinDlg").open) $("#pinDlg").showModal();
  setTimeout(() => $("#pinInput").focus(), 50);
}

async function submitPin() {
  const code = $("#pinInput").value.trim();
  if (code.length < 4) { $("#pinErr").textContent = "Enter the code."; $("#pinErr").hidden = false; return; }
  $("#pinSubmit").disabled = true;
  try {
    const res = await fetch(LP.fn, {
      method: "POST",
      headers: { "Content-Type": "application/json",
                 Authorization: "Bearer " + LP.anon, apikey: LP.anon },
      body: JSON.stringify({ action: "verify_unlock_code", device_id: deviceId(), code }),
    });
    const j = await res.json();
    if (j.ok) {
      unlocked = true;
      $("#pinDlg").close();
      if (pendingAward) {
        const a = pendingAward; pendingAward = null;
        award(a.personId, a.delta, a.note);
      }
    } else {
      $("#pinErr").textContent = "Wrong code.";
      $("#pinErr").hidden = false;
    }
  } catch {
    $("#pinErr").textContent = "Could not reach the server.";
    $("#pinErr").hidden = false;
  } finally {
    $("#pinSubmit").disabled = false;
  }
}

function renderHistory() {
  const rows = (state.recent || []).map((e) => {
    const person = state.people.find((p) => p.id === e.person_id);
    const when = new Date(e.created_at);
    const who = e.author_name || "Someone";
    return `<div class="h">
      <b style="color:${e.delta < 0 ? "var(--neg)" : "var(--yehuda)"}">${e.delta > 0 ? "+" : ""}${e.delta}</b>
      <div style="flex:1">
        <div>${esc(person ? person.display_name : e.person_id)}</div>
        <div class="who">${esc(who)}${e.note ? " · " + esc(e.note) : ""}</div>
      </div>
      <time>${when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
    </div>`;
  });
  $("#histList").innerHTML = rows.length ? rows.join("") : '<p class="muted">No points yet.</p>';
}

async function boot() {
  bindUI();
  try {
    await call({ action: "state" });
  } catch (e) {
    $("#people").innerHTML = `<p class="err">Could not reach the server. ${esc(e.message)}</p>`;
    return;
  }
  // The server may already know this device's name — someone can be named from
  // another device, as happened when Mommy's browser was identified after the
  // fact. Adopt it rather than asking again for a name that already exists.
  if (!myName() && state && state.me && state.me.display_name) {
    localStorage.setItem("lp.name", state.me.display_name);
    render();
  }

  // Required, not optional. Anyone still anonymous is made to name themselves
  // the next time they open the page. An unnamed ledger entry defeats the whole
  // point of recording who gave what.
  if (!myName()) askName(true);
  goLive();
}
boot();
