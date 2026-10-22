/**
 * Adversarial test suite — tries to break the server the way a bad actor would.
 * Every check asserts the SECURE behaviour; a failure means a real weakness.
 *
 *   TRUST_PROXY_HOPS=1 node dist/index.js      # server under test
 *   node test/attack.mjs http://localhost:3000
 *
 * The server must run with TRUST_PROXY_HOPS=1 so each fake user can pretend to
 * come from its own IP via X-Forwarded-For (that's how Render looks in production).
 */
import { io } from "socket.io-client";
import { randomUUID } from "node:crypto";

const URL = process.argv[2] ?? "http://localhost:3000";
const ORIGIN = new globalThis.URL(URL).origin;
const results = [];
let ipSeq = 1;
const nextIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client({ ip = nextIp(), deviceId = randomUUID(), origin = ORIGIN } = {}) {
  const s = io(URL, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    auth: { deviceId },
    extraHeaders: { origin, "x-forwarded-for": ip },
  });
  s.ip = ip;
  s.deviceId = deviceId;
  s.log = [];
  s.onAny((ev, ...a) => s.log.push([ev, a[0]]));
  return s;
}
const ready = (s) =>
  new Promise((res) => {
    s.once("hello", (me) => res({ ok: true, me }));
    s.once("connect_error", (e) => res({ ok: false, err: e.message }));
    setTimeout(() => res({ ok: false, err: "timeout" }), 4000);
  });
const once = (s, ev, ms = 4000) => new Promise((r) => { const t = setTimeout(() => r(null), ms); s.once(ev, (x) => { clearTimeout(t); r(x); }); });
const join = { vibe: "fun", drink: "beer", size: 2, ageConfirmed: true };
const alive = async () => (await fetch(`${URL}/health`).then((r) => r.json()).catch(() => null))?.ok === true;

async function check(name, fn) {
  try {
    const { pass, detail } = await fn();
    results.push({ name, pass, detail });
    console.log(`${pass ? "✔ PASS" : "✖ VULN"}  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    results.push({ name, pass: false, detail: `threw ${e.message}` });
    console.log(`✖ ERROR ${name} — ${e.message}`);
  }
}

async function pair(size = 2, extra = {}) {
  const a = client(), b = client();
  await Promise.all([ready(a), ready(b)]);
  const ja = once(a, "room:joined"), jb = once(b, "room:joined");
  a.emit("queue:join", { ...join, size, ...extra });
  await sleep(80);
  b.emit("queue:join", { ...join, size, ...extra });
  const [ra, rb] = await Promise.all([ja, jb]);
  return { a, b, ra, rb };
}

// ── 1. Malformed / hostile payloads must not crash the server ────────────────
await check("Fuzzing every event with hostile payloads keeps the server alive", async () => {
  const s = client();
  await ready(s);
  const junk = [null, undefined, 0, -1, 1e308, NaN, "", "x".repeat(30_000), [], [1, 2], { __proto__: { admin: true } },
    JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}}}'), { to: { $gt: "" } }, { value: { toString: 1 } }, () => 1];
  const events = ["queue:join", "queue:leave", "room:leave", "name:shuffle", "signal", "chat:send", "react", "game:propose", "game:ready",
    "game:answer", "game:stop", "gift:send", "cheers:give", "callagain:request", "callagain:accept", "report", "nonexistent:event"];
  for (const ev of events) for (const j of junk) s.emit(ev, j);
  await sleep(800);
  const ok = await alive();
  s.close();
  return { pass: ok && !({}).polluted, detail: ok ? "server healthy" : "server died" };
});

// ── 2. Join spam (CPU DoS) is throttled ───────────────────────────────────────
await check("queue:join flood is rate-limited", async () => {
  const s = client();
  await ready(s);
  for (let i = 0; i < 200; i++) s.emit("queue:join", join);
  await sleep(600);
  const limited = s.log.filter(([e, x]) => e === "error" && x?.code === "rate").length;
  s.close();
  return { pass: limited > 100, detail: `${limited}/200 rejected` };
});

// ── 3. Signaling can't be used to reach / flood strangers ────────────────────
await check("Signals to people outside your room are dropped; oversized SDP rejected", async () => {
  const { a, b } = await pair();
  const outsider = client();
  await ready(outsider);
  const got = once(outsider, "signal", 800);
  a.emit("signal", { to: outsider.id, data: { type: "offer", sdp: "v=0" } });
  const big = once(b, "signal", 800);
  a.emit("signal", { to: b.id, data: { type: "offer", sdp: "x".repeat(25_000) } });
  const [r1, r2] = await Promise.all([got, big]);
  [a, b, outsider].forEach((s) => s.close());
  return { pass: !r1 && !r2, detail: `outsider got=${!!r1}, oversized delivered=${!!r2}` };
});

// ── 4. Gift tampering ─────────────────────────────────────────────────────────
await check("Tampered gifts (bad tier/category, self, outsider) are rejected and cost nothing", async () => {
  const { a, b, rb } = await pair();
  const before = (await once(a, "wallet", 300))?.coins;
  const bad = [
    { category: "whisky", tier: 5, to: rb.you.id }, { category: "whisky", tier: -1, to: rb.you.id },
    { category: "whisky", tier: 1.5, to: rb.you.id }, { category: "whisky", tier: "4", to: "table" },
    { category: "__proto__", tier: 1, to: rb.you.id }, { category: "whisky", tier: 1, to: a.id },
    { category: "whisky", tier: 1, to: "someone-else" },
  ];
  let landed = 0;
  a.on("gift:landed", () => landed++);
  for (const g of bad) a.emit("gift:send", g);
  await sleep(700);
  [a, b].forEach((s) => s.close());
  return { pass: landed === 0, detail: `${landed} tampered gifts landed (wallet before=${before ?? "n/a"})` };
});

// ── 5. Free-tier gift spam (animation flood on the victim's screen) ───────────
await check("Free (Red) drinks can't be spammed at someone", async () => {
  const { a, b, rb } = await pair();
  let landed = 0;
  b.on("gift:landed", () => landed++);
  for (let i = 0; i < 30; i++) {
    a.emit("gift:send", { category: "beer", tier: 0, to: rb.you.id });
    await sleep(100);
  }
  await sleep(400);
  [a, b].forEach((s) => s.close());
  return { pass: landed <= 2, detail: `${landed} free drinks landed in 3s` };
});

// ── 6. Coin farming with throwaway device IDs ────────────────────────────────
await check("Coins can't be farmed by minting new device IDs from one IP", async () => {
  const ip = nextIp();
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const s = client({ ip });
    const r = await ready(s);
    if (r.ok) total += r.me.coins;
    s.close();
  }
  return { pass: total <= 1500 * 5, detail: `12 fresh device IDs from one IP received ${total} coins` };
});

// ── 7. Sybil mass-report: one attacker bans an innocent user ─────────────────
await check("One attacker with several tabs (same IP) can't get someone banned", async () => {
  const victim = client();
  await ready(victim);
  const attackerIp = nextIp();
  const bots = [client({ ip: attackerIp }), client({ ip: attackerIp }), client({ ip: attackerIp })];
  await Promise.all(bots.map(ready));
  const g = { ...join, size: 4, vibe: "rant" };
  victim.emit("queue:join", g);
  await sleep(100);
  for (const b of bots) { b.emit("queue:join", g); await sleep(100); }
  await sleep(500);
  const banned = once(victim, "banned", 1500);
  for (const b of bots) b.emit("report", { peerId: victim.id, reason: "harassment" });
  const r = await banned;
  [victim, ...bots].forEach((s) => s.close());
  return { pass: !r, detail: r ? "victim was BANNED by a single attacker" : "victim not banned" };
});

// ── 8. Drive-by reports (report within seconds of matching) ──────────────────
await check("Reports need a real encounter (not instant drive-by from different IPs)", async () => {
  const victim = client();
  await ready(victim);
  const bots = [client(), client(), client()];
  await Promise.all(bots.map(ready));
  const g = { ...join, size: 4, vibe: "creative" };
  victim.emit("queue:join", g);
  await sleep(100);
  for (const b of bots) { b.emit("queue:join", g); await sleep(100); }
  await sleep(400);
  const banned = once(victim, "banned", 1500);
  for (const b of bots) b.emit("report", { peerId: victim.id, reason: "spam" });
  const r = await banned;
  [victim, ...bots].forEach((s) => s.close());
  return { pass: !r, detail: r ? "banned after 3 instant reports" : "not banned instantly" };
});

// ── 9. Concurrent sockets per IP (connection exhaustion) ─────────────────────
await check("One IP can't hold dozens of open sockets", async () => {
  const ip = nextIp();
  const socks = [];
  let ok = 0;
  for (let i = 0; i < 25; i++) {
    const s = client({ ip });
    socks.push(s);
    if ((await ready(s)).ok) ok++;
  }
  socks.forEach((s) => s.close());
  // Cap is MAX_SOCKETS_PER_IP (20 by default — mobile carriers put many users behind one IP).
  return { pass: ok <= 20, detail: `${ok}/25 concurrent sockets accepted from one IP` };
});

// ── 10. Chat used for scam links / phone numbers ──────────────────────────────
await check("Links in chat are neutralised (scam / phishing / OnlyFans spam)", async () => {
  const { a, b } = await pair();
  const m = once(b, "chat:msg");
  a.emit("chat:send", { text: "hot pics at https://evil.example/x and bit.ly/abc or www.scam.io" });
  const got = await m;
  [a, b].forEach((s) => s.close());
  const leaked = /https?:\/\/|bit\.ly|www\./i.test(got?.text ?? "");
  return { pass: !leaked, detail: `received: "${got?.text}"` };
});

// ── 11. Foreign website can't connect (CSWSH) ─────────────────────────────────
await check("Sockets from a foreign website origin are refused", async () => {
  const s = client({ origin: "https://evil.example" });
  const r = await ready(s);
  s.close();
  return { pass: !r.ok, detail: r.ok ? "evil origin connected" : `refused (${r.err})` };
});

// ── 12. Real reports still work (3 different people, after a real encounter) ─
// Needs the server started with REPORT_MIN_ENCOUNTER_SEC=2 so the test stays fast.
await check("Genuine reports from 3 different people still ban an abuser", async () => {
  const abuser = client();
  await ready(abuser);
  const people = [client(), client(), client()];
  await Promise.all(people.map(ready));
  const g = { ...join, size: 4, vibe: "deep" };
  abuser.emit("queue:join", g);
  await sleep(100);
  for (const p of people) { p.emit("queue:join", g); await sleep(100); }
  await sleep(2600);
  const banned = once(abuser, "banned", 2000);
  for (const p of people) p.emit("report", { peerId: abuser.id, reason: "harassment" });
  const r = await banned;
  [abuser, ...people].forEach((s) => s.close());
  return { pass: !!r, detail: r ? "abuser banned" : "abuser NOT banned (reports ineffective)" };
});

// ── 13. Server still healthy after everything ─────────────────────────────────
await check("Server healthy at the end", async () => ({ pass: await alive(), detail: "" }));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
