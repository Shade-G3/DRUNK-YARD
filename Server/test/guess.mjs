/** Guess-games engine test: secrets stay hidden from the right people, verdicts + scoring work. */
import { io } from "socket.io-client";
import { randomUUID } from "node:crypto";
const URL = process.argv[2] ?? "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ip = 1;
const fail = [];
const ok = (c, m) => { console.log(`${c ? "✔" : "✖"} ${m}`); if (!c) fail.push(m); };
function client() {
  const s = io(URL, { transports: ["websocket"], forceNew: true, reconnection: false, auth: { deviceId: randomUUID() },
    extraHeaders: { origin: new globalThis.URL(URL).origin, "x-forwarded-for": `10.9.${ip >> 8}.${ip++ & 255}` } });
  s.view = null; s.on("game:state", (g) => (s.view = g));
  return s;
}
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(30); } return false; };

async function room(vibe) {
  const a = client(), b = client();
  await Promise.all([a, b].map((s) => new Promise((r) => s.once("hello", r))));
  const j = { vibe, drink: "beer", size: 2, ageConfirmed: true };
  const ja = new Promise((r) => a.once("room:joined", r)), jb = new Promise((r) => b.once("room:joined", r));
  a.emit("queue:join", j); await sleep(80); b.emit("queue:join", j);
  await Promise.all([ja, jb]);
  return [a, b];
}
async function start(a, b, kind) {
  a.emit("game:propose", { kind });
  await until(() => b.view?.kind === kind);
  b.emit("game:ready");
  await until(() => a.view && a.view.phase !== "lobby");
}
const turnOf = (a, b) => (a.view.turn === a.id ? [a, b] : [b, a]);

// ── Guess My Number ──
{
  const [a, b] = await room("fun");
  await start(a, b, "guess_number");
  const [t, g] = turnOf(a, b);
  ok(t.view.phase === "compose", "number: picker is in compose phase");
  t.emit("game:answer", { value: "42" });
  await until(() => g.view.phase === "question");
  ok(t.view.secret === "42", "number: picker sees their number");
  ok(g.view.secret === null, "number: guesser can't see the number");
  t.emit("game:answer", { value: "50" }); await sleep(200);
  ok(g.view.guesses.length === 0, "number: picker can't guess own number");
  g.emit("game:answer", { value: "10" }); await sleep(450);
  g.emit("game:answer", { value: "90" }); await sleep(450);
  g.emit("game:answer", { value: "abc" }); await sleep(450);
  await until(() => g.view.guesses.length === 2);
  ok(g.view.guesses.map((x) => x.verdict).join() === "higher,lower", `number: verdicts higher/lower (${g.view.guesses.map((x) => x.verdict)})`);
  g.emit("game:answer", { value: "42" });
  await until(() => g.view.phase === "reveal");
  ok(g.view.phase === "reveal" && g.view.scores[g.id] === 2, "number: correct guess reveals + scores 2");
  ok(g.view.secret === "42", "number: everyone sees number at reveal");
  [a, b].forEach((s) => s.close());
}
// ── Which Animal Am I ──
{
  const [a, b] = await room("deep");
  await start(a, b, "which_animal");
  const [t, o] = turnOf(a, b);
  ok(t.view.secret === null && typeof o.view.secret === "string", "animal: everyone but the player sees the animal");
  const animal = o.view.secret;
  o.emit("game:answer", { value: animal }); await sleep(200);
  ok(o.view.phase === "question", "animal: other player can't answer for them");
  t.emit("game:answer", { value: "zzz" }); await sleep(450);
  ok(t.view.guesses.at(-1)?.verdict === "wrong", "animal: wrong guess marked");
  t.emit("game:answer", { value: `The ${animal.toUpperCase()}s` });
  await until(() => t.view.phase === "reveal");
  ok(t.view.scores[t.id] === 2, "animal: fuzzy match ('The ELEPHANTs') counts");
  ok(!t.view.guesses.some((x) => x.text.toLowerCase().includes(animal)), "animal: correct guess text not echoed in feed");
  [a, b].forEach((s) => s.close());
}
// ── Guess My Object ──
{
  const [a, b] = await room("creative");
  await start(a, b, "guess_object");
  const [t, o] = turnOf(a, b);
  ok(typeof t.view.secret === "string" && o.view.secret === null, "object: only the describer sees the word");
  const word = t.view.secret;
  for (let i = 0; i < 5; i++) o.emit("game:answer", { value: "spam" + i });
  await sleep(300);
  ok(o.view.guesses.length <= 1, `object: guess spam throttled (${o.view.guesses.length} landed of 5 in 300ms)`);
  await sleep(450);
  o.emit("game:answer", { value: "visit evil.com now" }); await sleep(450);
  ok(!/evil\.com/.test(JSON.stringify(o.view.guesses)), "object: links scrubbed from guesses");
  o.emit("game:answer", { value: word });
  await until(() => o.view.phase === "reveal");
  ok(o.view.scores[o.id] === 2 && o.view.scores[t.id] === 1, "object: guesser +2, describer +1");
  [a, b].forEach((s) => s.close());
}
// ── Emoji Decode ──
{
  const [a, b] = await room("fun");
  await start(a, b, "emoji_decode");
  ok(a.view.secret === null && b.view.secret === null && /\p{Extended_Pictographic}/u.test(a.view.prompt), "emoji: clue shown, answer hidden from all");
  a.emit("game:answer", { value: "x".repeat(500) }); await sleep(450);
  ok(a.view.guesses.every((g) => g.text.length <= 40), "emoji: overlong guess rejected/trimmed");
  a.emit("game:stop"); await sleep(200);
  ok(a.view.phase === "done", "emoji: can stop");
  [a, b].forEach((s) => s.close());
}
ok((await fetch(`${URL}/health`).then((r) => r.json())).ok, "server healthy");
console.log(fail.length ? `\n${fail.length} FAILED` : "\nAll guess-game checks passed.");
process.exit(fail.length ? 1 : 0);
