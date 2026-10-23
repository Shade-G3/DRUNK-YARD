/**
 * "Add someone" seats, friend invite links, Catch the Imposter and Bluff.
 *   node test/party.mjs http://localhost:3000   (server with TRUST_PROXY_HOPS=1)
 */
import { io } from "socket.io-client";
import { randomUUID } from "node:crypto";

const URL = process.argv[2] ?? "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ipSeq = 1;
const fails = [];
const ok = (c, m) => {
  console.log(`${c ? "✔" : "✖"} ${m}`);
  if (!c) fails.push(m);
};
function client() {
  const s = io(URL, {
    transports: ["websocket"], forceNew: true, reconnection: false, auth: { deviceId: randomUUID() },
    extraHeaders: { origin: new globalThis.URL(URL).origin, "x-forwarded-for": `10.77.${ipSeq >> 8}.${ipSeq++ & 255}` },
  });
  s.view = null; s.seat = undefined; s.size = null; s.results = []; s.errors = []; s.peers = 0; s.joined = null;
  s.on("game:state", (g) => (s.view = g));
  s.on("room:seat", (x) => (s.seat = x));
  s.on("room:size", (x) => (s.size = x.size));
  s.on("seat:result", (x) => s.results.push(x));
  s.on("link:result", (x) => s.results.push(x));
  s.on("error", (e) => s.errors.push(e.code));
  s.on("room:joined", (r) => { s.joined = r; s.size = r.size; s.peers = r.peers.length; });
  s.on("room:peer-joined", () => s.peers++);
  s.on("room:peer-left", () => s.peers--);
  return s;
}
const hello = (s) => new Promise((r) => { s.once("hello", r); setTimeout(r, 4000); });
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(25); } return false; };
const req = (vibe, size, extra = {}) => ({ vibe, drink: "beer", size, ageConfirmed: true, ...extra });

async function table(n, vibe) {
  const cs = Array.from({ length: n }, client);
  await Promise.all(cs.map(hello));
  for (const c of cs) { c.emit("queue:join", req(vibe, n)); await sleep(60); }
  await until(() => cs.every((c) => c.joined));
  return cs;
}
const close = (...cs) => cs.flat().forEach((c) => c.close());

// ═══ Add someone ═════════════════════════════════════════════════════════════
{
  const [a, b] = await table(2, "chill");
  a.emit("seat:request", { mode: "match", vibe: "chill" });
  await until(() => b.seat?.stage === "vote");
  ok(b.seat?.stage === "vote" && b.seat.yes.includes(a.id), "seat: the other person is asked to agree");
  b.emit("seat:vote", { yes: false });
  await until(() => a.seat === null);
  ok(a.seat === null && a.size === 2, "seat: one 'no' cancels it, table stays 2");
  ok(a.results.some((r) => /Not everyone/.test(r.message)) && !a.results.some((r) => r.message.includes(b.joined.you.handle)), "seat: refusal is anonymous");
  a.emit("seat:request", { mode: "match", vibe: "chill" });
  await until(() => a.results.length > 1);
  ok(/few seconds/.test(a.results.at(-1)?.message ?? ""), "seat: cooldown after a refusal");
  close(a, b);
}
{
  const [a, b] = await table(2, "fun");
  a.emit("seat:request", { mode: "match", vibe: "fun" });
  await until(() => b.seat?.stage === "vote");
  b.emit("seat:vote", { yes: true });
  await until(() => a.seat?.stage === "open");
  ok(a.seat?.stage === "open" && a.size === 3 && b.size === 3, "seat: unanimous yes opens a seat (2 → 3)");
  const solo = client(); await hello(solo);
  solo.emit("queue:join", req("fun", 2)); // wants 1-on-1, not opted in
  const wrongVibe = client(); await hello(wrongVibe);
  wrongVibe.emit("queue:join", req("rant", 3));
  await sleep(600);
  ok(!solo.joined || solo.joined.roomId !== a.joined.roomId, "seat: a 1-on-1 seeker is NOT dropped into the group");
  ok(!wrongVibe.joined, "seat: a different-vibe seeker doesn't take the seat");
  const c = client(); await hello(c);
  c.emit("queue:join", req("fun", 3));
  await until(() => c.joined);
  ok(c.joined?.roomId === a.joined.roomId && c.joined.ongoing === true && c.joined.peers.length === 2, "seat: a size-3 seeker takes it, told it's an ongoing table");
  await until(() => a.seat === null);
  ok(a.seat === null && a.peers === 2, "seat: closes once filled");
  close(a, b, c, solo, wrongVibe);
}
{
  const [a, b] = await table(2, "deep");
  a.emit("seat:request", { mode: "match", vibe: "creative" });
  await until(() => b.seat); b.emit("seat:vote", { yes: true });
  await until(() => a.seat?.stage === "open");
  const e = client(); await hello(e);
  e.emit("queue:join", req("creative", 2, { ongoing: true }));
  await until(() => e.joined);
  ok(e.joined?.roomId === a.joined.roomId, "seat: different vibe + 'join ongoing' toggle works");
  close(a, b, e);
}
{
  const [a, b] = await table(2, "chill");
  a.emit("seat:request", { mode: "match", vibe: "chill" });
  await until(() => b.seat);
  a.close();
  await until(() => b.seat === null);
  ok(b.seat === null, "seat: requester leaving cancels the vote");
  close(b);
}
// ═══ Friend link ═════════════════════════════════════════════════════════════
{
  const [a, b] = await table(2, "fun");
  a.emit("seat:request", { mode: "link", vibe: "fun" });
  await until(() => b.seat); b.emit("seat:vote", { yes: true });
  await until(() => a.seat?.token);
  ok(!!a.seat?.token && !b.seat?.token, "link: only the asker gets the invite token");
  const token = a.seat.token;
  const stranger = client(); await hello(stranger);
  stranger.emit("queue:join", req("fun", 3, { ongoing: true }));
  await sleep(500);
  ok(!stranger.joined, "link: a friend's seat isn't given to a random stranger");
  const f = client(); await hello(f);
  f.emit("link:join", { token, drink: "rum", ageConfirmed: false });
  await until(() => f.results.length);
  ok(!f.joined && /18/.test(f.results[0]?.message), "link: still needs 18+ confirmation");
  f.emit("link:join", { token: randomUUID(), drink: "rum", ageConfirmed: true });
  await until(() => f.results.length > 1);
  ok(!f.joined, "link: a made-up token fails");
  f.emit("link:join", { token, drink: "rum", ageConfirmed: true });
  await until(() => f.joined);
  ok(f.joined?.roomId === a.joined.roomId, "link: friend joins the table");
  const g = client(); await hello(g);
  g.emit("link:join", { token, drink: "rum", ageConfirmed: true });
  await until(() => g.results.length);
  ok(!g.joined && /expired|used/.test(g.results[0]?.message), "link: single use");
  close(a, b, f, g, stranger);
}

// ═══ Catch the Imposter ══════════════════════════════════════════════════════
async function startGame(cs, kind, mode) {
  cs[0].emit("game:propose", { kind, mode });
  await until(() => cs.every((c) => c.view?.kind === kind));
  cs.slice(1).forEach((c) => c.emit("game:ready"));
  await until(() => cs.every((c) => c.view?.phase !== "lobby"));
}
{
  const cs = await table(4, "rant");
  const tooFew = await table(3, "creative");
  tooFew[0].emit("game:propose", { kind: "imposter" });
  await until(() => tooFew[0].errors.includes("game_min"));
  ok(tooFew[0].errors.includes("game_min"), "imposter: needs 4 people");
  close(tooFew);

  await startGame(cs, "imposter", "undercover");
  const words = cs.map((c) => c.view.imposter.word);
  const counts = words.reduce((m, w) => ((m[w] = (m[w] ?? 0) + 1), m), {});
  ok(Object.keys(counts).length === 2 && Object.values(counts).includes(1) && words.every(Boolean), `imposter: undercover — exactly one different word (${JSON.stringify(counts)})`);
  ok(cs.every((c) => !c.view.imposter.youAreImposter), "imposter: undercover doesn't know");
  const odd = cs.find((c) => counts[c.view.imposter.word] === 1);
  const mainWord = words.find((w) => counts[w] > 1);
  ok(!JSON.stringify(cs.find((c) => c !== odd).view).includes(odd.view.imposter.word), "imposter: others never receive the imposter's word");
  cs[0].emit("chat:send", { text: "the word is " + mainWord });
  await until(() => cs[0].errors.includes("chat_locked"));
  ok(cs[0].errors.includes("chat_locked"), "imposter: chat is paused during clues");
  // Wrong person can't skip someone else's turn.
  const t0 = cs[0].view.turn;
  cs.find((c) => c.id !== t0).emit("game:act", { type: "next" });
  await sleep(200);
  ok(cs[0].view.turn === t0, "imposter: only the clue-giver can end their turn");
  for (let i = 0; i < 8; i++) {
    const t = cs[0].view.turn;
    cs.find((c) => c.id === t).emit("game:act", { type: "next" });
    await until(() => cs[0].view.turn !== t || cs[0].view.imposter.stage === "vote");
  }
  ok(cs[0].view.imposter.stage === "vote", "imposter: 2 clue rounds then vote");
  odd.emit("game:act", { type: "vote", target: odd.id });
  await sleep(150);
  ok(!cs[0].view.imposter.votes.includes(odd.id), "imposter: can't vote for yourself");
  for (const c of cs) c.emit("game:act", { type: "vote", target: c === odd ? cs.find((x) => x !== odd).id : odd.id });
  await until(() => cs[0].view.imposter.stage === "lastguess");
  ok(cs[0].view.imposter.stage === "lastguess" && odd.view.imposter.result?.word === "", "imposter: caught → last guess, word still hidden");
  cs.find((c) => c !== odd).emit("game:act", { type: "guess", text: mainWord });
  await sleep(150);
  ok(cs[0].view.imposter.stage === "lastguess", "imposter: only the imposter may guess");
  odd.emit("game:act", { type: "guess", text: mainWord.toUpperCase() });
  await until(() => cs[0].view.imposter.stage === "reveal");
  ok(cs[0].view.imposter.result?.caught && cs[0].view.scores[odd.id] === 2 && /steals/.test(cs[0].view.reveal?.note), "imposter: correct last guess steals the round");
  cs[0].emit("game:stop");
  await sleep(200);
  close(cs);
}
{
  const cs = await table(4, "chill");
  await startGame(cs, "imposter", "blank");
  const imp = cs.filter((c) => c.view.imposter.youAreImposter);
  ok(imp.length === 1 && imp[0].view.imposter.word === null && cs.filter((c) => c.view.imposter.word).length === 3, "imposter: blank mode — imposter knows, gets no word");
  // Imposter leaves mid-clue → round resolves, game continues with 3.
  imp[0].close();
  const rest = cs.filter((c) => c !== imp[0]);
  await until(() => rest[0].view.imposter?.stage === "reveal");
  ok(/left/.test(rest[0].view.reveal?.note ?? ""), "imposter: imposter leaving ends the round cleanly");
  close(rest);
}

// ═══ Bluff ═══════════════════════════════════════════════════════════════════
{
  const cs = await table(3, "fun");
  await startGame(cs, "bluff");
  const v = (c) => c.view.bluff;
  const total = cs.reduce((n, c) => n + v(c).hand.length, 0);
  ok(total === v(cs[0]).ranks.length * 4 && cs.every((c) => v(c).hand.length >= 6), `bluff: dealt ${total} cards (${cs.map((c) => v(c).hand.length)})`);
  const ids = cs.map((c) => v(c).hand.map((x) => x.id));
  ok(new Set(ids.flat()).size === total, "bluff: nobody shares a card");
  ok(cs.every((c) => !JSON.stringify(c.view).includes('"suit"') || v(c).hand.length === JSON.stringify(c.view).split('"suit"').length - 1), "bluff: you only receive your own cards");

  const byId = (id) => cs.find((c) => c.id === id);
  let p = byId(cs[0].view.turn);
  const notTurn = cs.find((c) => c !== p);
  notTurn.emit("game:act", { type: "play", cards: [v(notTurn).hand[0].id], rank: v(notTurn).hand[0].rank });
  await sleep(150);
  ok(v(cs[0]).pile === 0, "bluff: can't play out of turn");
  p.emit("game:act", { type: "pass" });
  await sleep(150);
  ok(cs[0].view.turn === p.id, "bluff: can't pass when opening a set");
  p.emit("game:act", { type: "play", cards: v(p).hand.slice(0, 5).map((x) => x.id), rank: v(p).ranks[0] });
  p.emit("game:act", { type: "play", cards: [v(byId(cs.find((c) => c !== p).id)).hand[0].id], rank: v(p).ranks[0] });
  await sleep(150);
  ok(v(cs[0]).pile === 0, "bluff: rejects 5 cards / someone else's cards");

  // A lie: two cards claiming a rank they're not (pick a rank neither card has).
  const two = v(p).hand.slice(0, 2);
  const lieRank = v(p).ranks.find((r) => two.every((c) => c.rank !== r));
  const before = v(p).hand.length;
  p.emit("game:act", { type: "play", cards: two.map((x) => x.id), rank: lieRank });
  await until(() => v(cs[0]).pile === 2);
  ok(v(cs[0]).pile === 2 && v(cs[0]).rank === lieRank && v(cs[0]).counts[p.id] === before - 2, "bluff: play lands face down, claim recorded");
  ok(cs[0].view.spotlight === p.id, "bluff: spotlight on the player who just played");
  const next = byId(cs[0].view.turn);
  next.emit("game:act", { type: "play", cards: [v(next).hand[0].id], rank: lieRank });
  await sleep(150);
  ok(v(cs[0]).pile === 2, "bluff: next player must wait a moment (time to shout Bluff)");
  const caller = cs.find((c) => c !== p && c !== next);
  caller.emit("game:act", { type: "bluff" });
  await until(() => v(cs[0]).reveal);
  ok(v(cs[0]).reveal?.truthful === false && v(cs[0]).counts[p.id] === before && v(cs[0]).pile === 0, "bluff: liar caught, picks up the pile");
  ok(cs[0].view.turn === caller.id && v(cs[0]).rank === null, "bluff: caller opens the next set");

  // Truthful play + wrong call → caller picks up.
  p = caller;
  await sleep(2600);
  const card = v(p).hand[0];
  p.emit("game:act", { type: "play", cards: [card.id], rank: card.rank });
  await until(() => v(cs[0]).pile === 1);
  const wrong = cs.find((c) => c !== p);
  const wBefore = v(wrong).hand.length;
  wrong.emit("game:act", { type: "bluff" });
  await until(() => v(cs[0]).reveal?.truthful === true);
  ok(v(cs[0]).counts[wrong.id] === wBefore + 1, "bluff: wrong call → caller picks up");

  // Everyone passes → flush, last player starts again.
  await sleep(2600);
  const opener = byId(cs[0].view.turn);
  const oc = v(opener).hand[0];
  opener.emit("game:act", { type: "play", cards: [oc.id], rank: oc.rank });
  await until(() => v(cs[0]).pile === 1);
  for (let i = 0; i < 2; i++) {
    const t = cs[0].view.turn;
    byId(t).emit("game:act", { type: "pass" });
    await until(() => cs[0].view.turn !== t);
  }
  ok(v(cs[0]).pile === 0 && v(cs[0]).rank === null && cs[0].view.turn === opener.id, "bluff: all pass → pile flushed, last player restarts");
  cs[0].emit("game:stop");
  close(cs);
}
{
  // Win: honest player empties their hand while the other keeps passing.
  const cs = await table(2, "chill");
  await startGame(cs, "bluff");
  const byId = (id) => cs.find((c) => c.id === id);
  const p = byId(cs[0].view.turn), q = cs.find((c) => c !== p);
  for (let i = 0; i < 20 && p.view?.phase === "question"; i++) {
    if (p.view.turn === p.id) {
      const h = p.view.bluff.hand;
      const r = h[0].rank;
      const same = h.filter((c) => c.rank === r).slice(0, 4);
      const pile = p.view.bluff.pile;
      p.emit("game:act", { type: "play", cards: same.map((c) => c.id), rank: r });
      await until(() => p.view.bluff?.pile !== pile || p.view.phase !== "question");
    } else {
      q.emit("game:act", { type: "pass" });
      await until(() => p.view.turn === p.id || p.view.phase !== "question");
    }
  }
  ok(p.view.phase === "done" && /winner/.test(p.view.reveal?.note ?? "") && p.view.scores[p.id] === 3, "bluff: emptying your hand (and surviving) wins");
  close(cs);
}

ok((await fetch(`${URL}/health`).then((r) => r.json())).ok, "server healthy");
console.log(fails.length ? `\n${fails.length} FAILED` : "\nAll party checks passed.");
process.exit(fails.length ? 1 : 0);
