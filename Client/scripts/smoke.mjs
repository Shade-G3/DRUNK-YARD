/**
 * End-to-end smoke test against a running server (used by CI).
 *   node Client/scripts/smoke.mjs [http://localhost:3000]
 * Two fake users: connect → match 1-on-1 → chat → send a drink → leave.
 */
import { io } from "socket.io-client";
import { randomUUID } from "node:crypto";

const URL = process.argv[2] ?? "http://localhost:3000";
const ORIGIN = new globalThis.URL(URL).origin;
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};
const timer = setTimeout(() => fail("timed out after 15s"), 15_000);

const mk = (name) => {
  const s = io(URL, { transports: ["websocket"], forceNew: true, auth: { deviceId: randomUUID() }, extraHeaders: { origin: ORIGIN } });
  s.on("connect_error", (e) => fail(`${name} connect_error: ${e.message}`));
  s.on("error", (e) => fail(`${name} server error: ${e.code} ${e.message}`));
  return s;
};
const once = (s, ev) => new Promise((r) => s.once(ev, r));

// 1. Health + app shell
const health = await fetch(`${URL}/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) fail("/health did not return ok");
const html = await fetch(URL).then((r) => r.text());
if (!html.includes('id="root"')) fail("client app not served at /");
console.log("✔ health + client served");

// 2. Bad device id is rejected
await new Promise((resolve) => {
  const bad = io(URL, { transports: ["websocket"], forceNew: true, auth: { deviceId: "nope" }, extraHeaders: { origin: ORIGIN } });
  bad.on("connect", () => fail("bad device id was accepted"));
  bad.on("connect_error", () => {
    bad.close();
    resolve();
  });
});
console.log("✔ invalid device id rejected");

// 3. Two users match, chat, gift
const a = mk("A");
const b = mk("B");
await Promise.all([once(a, "hello"), once(b, "hello")]);
const join = { vibe: "fun", drink: "beer", size: 2, ageConfirmed: true };
const ra = once(a, "room:joined");
const rb = once(b, "room:joined");
a.emit("queue:join", join);
b.emit("queue:join", join);
const [ja, jb] = await Promise.all([ra, rb]);
if (ja.roomId !== jb.roomId) fail("users landed in different rooms");
const offerer = ja.initiate.length ? ja : jb;
if (offerer.initiate.length !== 1 || (ja.initiate.length && jb.initiate.length)) fail("exactly one side should send the WebRTC offer");
console.log("✔ matched into one room, one offerer");

const msg = once(a, "chat:msg");
b.emit("chat:send", { text: "cheers <b>yo</b>" });
const m = await msg;
if (m.text !== "cheers <b>yo</b>") fail("chat text altered or missing");
console.log("✔ chat relayed");

const landed = once(a, "gift:landed");
b.emit("gift:send", { category: "whisky", tier: 0, to: ja.you.id });
const g = await landed;
if (g.name !== "Peg" || !g.to.includes(ja.you.id)) fail("gift not delivered");
console.log("✔ drink gift delivered");

const left = once(a, "room:peer-left");
b.emit("room:leave");
await left;
console.log("✔ leave propagated");

clearTimeout(timer);
a.close();
b.close();
console.log("All smoke checks passed.");
process.exit(0);
