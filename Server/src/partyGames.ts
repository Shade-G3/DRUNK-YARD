/**
 * Catch the Imposter + Bluff. Same rules as games.ts: the server owns every secret
 * (words, roles, cards) and only sends each person what they are allowed to see.
 */
import { randomInt } from "crypto";
import {
  BLUFF_RANKS, BLUFF_SUITS, BluffRank, BluffView, Card, GAME_META, GameKind, GamePhase, GameView, ImposterMode,
  ImposterView, LIMITS,
} from "./shared/protocol";
import * as C from "./gameContent";
import type { GameHost } from "./games";
import { scrubLinks, stripInvisible } from "./text";

const LOBBY_MS = 20_000;
const DONE_MS = 10_000;

export type GameAct =
  | { type: "play"; cards: number[]; rank: BluffRank }
  | { type: "pass" }
  | { type: "bluff" }
  | { type: "next" }
  | { type: "vote"; target: string }
  | { type: "guess"; text: string };

/** Lobby / ready-up / timers / finishing — shared by the new games. */
abstract class BaseGame {
  phase: GamePhase = "lobby";
  round = 0;
  totalRounds = 0;
  deadline = Date.now() + LOBBY_MS;
  duration = LOBBY_MS;
  ready = new Set<string>();
  scores = new Map<string, number>();
  /** Fixed at the start; people who walk in later spectate. */
  players: string[] = [];
  note = "";
  protected timer: NodeJS.Timeout | null = null;
  protected disposed = false;

  constructor(public kind: GameKind, protected host: GameHost, proposer: string) {
    this.ready.add(proposer);
    this.arm(LOBBY_MS, () => this.tryStart(true));
  }

  markReady(id: string) {
    if (this.phase !== "lobby" || !this.host.members().includes(id)) return;
    this.ready.add(id);
    this.tryStart(false);
    this.host.push();
  }

  answer(_id: string, _value: unknown) {
    /* these games use game:act */
  }

  abstract act(id: string, a: GameAct): void;
  protected abstract begin(): void;
  protected abstract leftMidGame(id: string): void;
  protected abstract extraView(forId: string): Partial<GameView>;

  locksChat(): boolean {
    return false;
  }

  stop() {
    this.finish("Game stopped.");
  }

  memberLeft(id: string) {
    this.ready.delete(id);
    if (this.phase === "lobby") {
      if (this.host.members().length < GAME_META[this.kind].min) this.finish("Not enough players left.");
      else this.host.push();
      return;
    }
    if (this.phase === "done" || !this.players.includes(id)) return this.host.push();
    this.players = this.players.filter((p) => p !== id);
    this.leftMidGame(id);
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  view(forId: string): GameView {
    return {
      kind: this.kind,
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      deadline: this.deadline,
      duration: this.duration,
      ready: [...this.ready],
      prompt: "",
      options: [],
      answeredBy: [],
      myAnswer: null,
      turn: null,
      reveal: this.phase === "done" ? { answers: {}, note: this.note } : null,
      scores: Object.fromEntries(this.scores),
      spicy: false,
      secret: null,
      guesses: [],
      players: this.players,
      spotlight: null,
      ...(this.phase === "lobby" || this.phase === "done" ? {} : this.extraView(forId)),
    };
  }

  protected present(): string[] {
    const m = this.host.members();
    return this.players.filter((p) => m.includes(p));
  }

  protected add(id: string, n: number) {
    this.scores.set(id, (this.scores.get(id) ?? 0) + n);
  }

  protected tryStart(timedOut: boolean) {
    if (this.phase !== "lobby") return;
    const members = this.host.members();
    const min = GAME_META[this.kind].min;
    const ready = members.filter((m) => this.ready.has(m));
    if (ready.length === members.length && members.length >= min) this.startWith(members);
    else if (timedOut && ready.length >= min) this.startWith(ready); // the rest spectate
    else if (timedOut) this.finish(members.length < min ? `Needs at least ${min} players.` : "Not enough people tapped Ready.");
  }

  private startWith(players: string[]) {
    this.players = [...players];
    this.players.forEach((p) => this.scores.set(p, 0));
    this.begin();
  }

  protected finish(note: string) {
    if (this.disposed || this.phase === "done") return;
    this.phase = "done";
    this.note = note;
    this.arm(DONE_MS, () => {
      this.dispose();
      this.host.ended();
    });
    this.host.push();
  }

  protected winnerNote(): string {
    const top = [...this.scores.entries()].filter(([id]) => this.host.members().includes(id)).sort((a, b) => b[1] - a[1]);
    if (!top.length || top[0][1] === 0) return "Game over! Good vibes all round.";
    if (top.length > 1 && top[0][1] === top[1][1]) return `Game over — it's a tie at ${top[0][1]} points!`;
    return `Game over — ${this.host.handle(top[0][0])} wins with ${top[0][1]} points!`;
  }

  protected arm(ms: number, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.duration = ms;
    this.timer = setTimeout(() => {
      if (!this.disposed) fn();
    }, ms);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Catch the Imposter
// ═════════════════════════════════════════════════════════════════════════════
const CLUE_MS = 20_000;
const VOTE_MS = 30_000;
const LASTGUESS_MS = 25_000;
const RESULT_MS = 9_000;
const CLUE_ROUNDS = 2;

export class ImposterGame extends BaseGame {
  private stage: ImposterView["stage"] = "clue";
  private clueRound = 1;
  private order: string[] = [];
  private turnIdx = 0;
  private imposter = "";
  private word = "";
  private imposterWord = "";
  private deck: [string, string][] = [];
  private votes = new Map<string, string>();
  private result: ImposterView["result"] = null;

  constructor(host: GameHost, proposer: string, public mode: ImposterMode) {
    super("imposter", host, proposer);
  }

  locksChat() {
    return this.phase === "question" && (this.stage === "clue" || this.stage === "lastguess");
  }

  protected begin() {
    this.totalRounds = Math.min(3, this.players.length);
    this.deck = C.pickN(C.WORD_PAIRS, this.totalRounds);
    this.nextRound();
  }

  private nextRound() {
    this.round += 1;
    const players = this.present();
    if (this.round > this.totalRounds) return this.finish(this.winnerNote());
    if (players.length < 3) return this.finish("Not enough players left.");
    // Randomly flip which word is the "main" one so the pair list can't be memorised.
    const pair = this.deck[this.round - 1];
    [this.word, this.imposterWord] = randomInt(2) ? pair : [pair[1], pair[0]];
    this.imposter = players[randomInt(players.length)];
    this.order = C.shuffle(players);
    this.turnIdx = 0;
    this.clueRound = 1;
    this.votes.clear();
    this.result = null;
    this.stage = "clue";
    this.phase = "question";
    this.arm(CLUE_MS, () => this.advanceClue());
    this.host.push();
  }

  private advanceClue() {
    if (this.stage !== "clue") return;
    this.turnIdx += 1;
    if (this.turnIdx >= this.order.length) {
      if (this.clueRound < CLUE_ROUNDS) {
        this.clueRound += 1;
        this.turnIdx = 0;
      } else return this.startVote();
    }
    this.arm(CLUE_MS, () => this.advanceClue());
    this.host.push();
  }

  private startVote() {
    this.stage = "vote";
    this.votes.clear();
    this.arm(VOTE_MS, () => this.tally());
    this.host.push();
  }

  private tally() {
    if (this.stage !== "vote") return;
    const t: Record<string, number> = {};
    for (const v of this.votes.values()) t[v] = (t[v] ?? 0) + 1;
    const top = Object.entries(t).sort((a, b) => b[1] - a[1]);
    // A tie (or nobody voting) means the imposter slips away.
    const caught = !!top.length && (top.length === 1 || top[0][1] > top[1][1]) && top[0][0] === this.imposter;
    this.result = { imposter: this.imposter, word: this.word, imposterWord: this.mode === "undercover" ? this.imposterWord : null, caught, guess: null, tally: t };
    if (caught && this.host.members().includes(this.imposter)) {
      this.stage = "lastguess";
      this.arm(LASTGUESS_MS, () => this.resolve(null));
      this.host.push();
    } else this.resolve(null);
  }

  private resolve(guess: string | null) {
    if (!this.result || this.stage === "reveal") return;
    const r = this.result;
    r.guess = guess;
    const stole = !!guess && C.matches(guess, [this.word]);
    if (!r.caught) this.add(this.imposter, 3);
    else if (stole) this.add(this.imposter, 2);
    else {
      for (const p of this.present()) {
        if (p === this.imposter) continue;
        this.add(p, this.votes.get(p) === this.imposter ? 2 : 1);
      }
    }
    this.note = !r.caught
      ? `${this.host.handle(this.imposter)} was the imposter and got away with it!`
      : stole
        ? `Caught — but ${this.host.handle(this.imposter)} guessed the word and steals the round!`
        : `Caught! ${this.host.handle(this.imposter)} was the imposter.`;
    this.stage = "reveal";
    this.phase = "reveal";
    this.arm(RESULT_MS, () => this.nextRound());
    this.host.push();
  }

  act(id: string, a: GameAct) {
    if (this.phase !== "question" || !this.present().includes(id) || !a || typeof a !== "object") return;
    if (a.type === "next" && this.stage === "clue" && this.order[this.turnIdx] === id) return this.advanceClue();
    if (a.type === "vote" && this.stage === "vote") {
      if (typeof a.target !== "string" || a.target === id || !this.present().includes(a.target)) return;
      this.votes.set(id, a.target);
      if (this.present().every((p) => this.votes.has(p))) this.tally();
      else this.host.push();
      return;
    }
    if (a.type === "guess" && this.stage === "lastguess" && id === this.imposter && typeof a.text === "string") {
      const text = scrubLinks(stripInvisible(a.text).trim().slice(0, LIMITS.guessMax));
      if (text) this.resolve(text);
    }
  }

  protected leftMidGame(id: string) {
    if (this.present().length < 3) return this.finish("Not enough players left.");
    if (this.stage === "reveal") return this.host.push();
    if (id === this.imposter) {
      this.result = { imposter: id, word: this.word, imposterWord: this.mode === "undercover" ? this.imposterWord : null, caught: false, guess: null, tally: {} };
      this.note = "The imposter left the table! New round…";
      this.stage = "reveal";
      this.phase = "reveal";
      this.arm(5_000, () => this.nextRound());
      return this.host.push();
    }
    // Remove from turn order without skipping the next person.
    const idx = this.order.indexOf(id);
    const wasTurn = this.stage === "clue" && idx === this.turnIdx;
    this.order = this.order.filter((p) => p !== id);
    if (idx !== -1 && idx < this.turnIdx) this.turnIdx -= 1;
    for (const [voter, target] of this.votes) if (voter === id || target === id) this.votes.delete(voter);
    if (wasTurn) {
      this.turnIdx -= 1;
      return this.advanceClue();
    }
    if (this.stage === "vote" && this.present().every((p) => this.votes.has(p))) return this.tally();
    this.host.push();
  }

  protected extraView(forId: string): Partial<GameView> {
    const playing = this.players.includes(forId);
    const isImp = forId === this.imposter;
    const word = !playing ? null : isImp ? (this.mode === "undercover" ? this.imposterWord : null) : this.word;
    const turn = this.stage === "clue" ? this.order[this.turnIdx] ?? null : this.stage === "lastguess" ? this.imposter : null;
    const h = (id: string | null) => (id ? this.host.handle(id) : "");
    const prompt =
      this.stage === "clue" ? `${h(turn)} gives a one-word clue (out loud)`
      : this.stage === "vote" ? "Who's the imposter? Vote!"
      : this.stage === "lastguess" ? `${h(this.imposter)} was caught! Last chance: guess everyone's word…`
      : this.note;
    const imposter: ImposterView = {
      mode: this.mode,
      word,
      youAreImposter: this.mode === "blank" && isImp && playing,
      stage: this.stage,
      clueRound: this.clueRound,
      votes: [...this.votes.keys()],
      myVote: this.votes.get(forId) ?? null,
      result: this.stage === "reveal" ? this.result : this.stage === "lastguess" && this.result ? { ...this.result, word: "", imposterWord: null } : null,
    };
    return {
      prompt,
      turn,
      spotlight: this.stage === "reveal" || this.stage === "lastguess" ? this.imposter : turn,
      reveal: this.stage === "reveal" ? { answers: {}, note: this.note } : null,
      imposter,
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Bluff (Indian style)
//   Start a set: put 1–4 cards face down and claim a rank ("3 Kings").
//   Next players: add cards claiming the SAME rank, or pass.
//   Anyone can shout BLUFF on the last play until the next person moves.
//   Caught lying → liar takes the pile. Wrong call → caller takes it.
//   Everyone else passes → pile is flushed, last player starts a new set.
//   First to empty their hand (and survive a call) wins.
// ═════════════════════════════════════════════════════════════════════════════
const TURN_MS = 25_000;
const CALL_GRACE_MS = 3_000; // next player must wait this long, so others can shout Bluff
const AFTER_REVEAL_MS = 2_500;
const GAME_CAP_MS = 8 * 60_000;
const CARDS_PER_PLAYER = 7;

export class BluffGame extends BaseGame {
  private hands = new Map<string, Card[]>();
  private ranks: BluffRank[] = [];
  private pile: Card[] = [];
  private rank: BluffRank | null = null;
  private last: { by: string; cards: Card[]; rank: BluffRank } | null = null;
  private lastPlayer: string | null = null; // who played most recently in this set (survives passes)
  private passes = 0;
  private turn: string | null = null;
  private playableAt = 0;
  private reveal: BluffView["reveal"] = null;
  private log: string[] = [];
  private endsAt = 0;
  private capTimer: NodeJS.Timeout | null = null;

  constructor(host: GameHost, proposer: string) {
    super("bluff", host, proposer);
  }

  dispose() {
    super.dispose();
    if (this.capTimer) clearTimeout(this.capTimer);
  }

  protected begin() {
    const n = this.players.length;
    // Small deck so a game fits in a video call: ~7 cards each, always full 4-suit ranks.
    this.ranks = BLUFF_RANKS.slice(0, Math.min(BLUFF_RANKS.length, Math.ceil((CARDS_PER_PLAYER * n) / 4))) as BluffRank[];
    let id = 1;
    const deck = C.shuffle(this.ranks.flatMap((rank) => BLUFF_SUITS.map((suit) => ({ id: id++, rank, suit }))));
    this.players.forEach((p) => this.hands.set(p, []));
    deck.forEach((c, i) => this.hands.get(this.players[i % n])!.push(c));
    this.turn = this.players[randomInt(n)];
    this.round = 1;
    this.totalRounds = 1;
    this.phase = "question";
    this.endsAt = Date.now() + GAME_CAP_MS;
    this.capTimer = setTimeout(() => this.timeUp(), GAME_CAP_MS);
    this.say(`${this.host.handle(this.turn)} starts.`);
    this.armTurn();
    this.host.push();
  }

  private armTurn() {
    this.arm(TURN_MS + Math.max(0, this.playableAt - Date.now()), () => this.timeout());
  }

  private timeout() {
    if (this.phase !== "question" || !this.turn) return;
    const who = this.turn;
    if (this.rank === null) {
      // Must open a set: auto-play one random card, honestly.
      const hand = this.hands.get(who) ?? [];
      const c = hand[randomInt(hand.length)];
      if (c) this.play(who, [c.id], c.rank, true);
    } else this.pass(who, true);
  }

  act(id: string, a: GameAct) {
    if (this.phase !== "question" || !this.present().includes(id) || !a || typeof a !== "object") return;
    if (a.type === "play") this.play(id, a.cards, a.rank, false);
    else if (a.type === "pass") this.pass(id, false);
    else if (a.type === "bluff") this.callBluff(id);
  }

  /** The previous play is safe once the next player moves. If it emptied their hand, they win. */
  private settle(): boolean {
    if (this.last && (this.hands.get(this.last.by)?.length ?? 1) === 0) {
      this.win(this.last.by);
      return true;
    }
    return false;
  }

  private play(id: string, cardIds: unknown, rank: unknown, auto: boolean) {
    if (id !== this.turn) return;
    if (!auto && this.last && Date.now() < this.playableAt) return;
    if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 4) return;
    if (new Set(cardIds).size !== cardIds.length) return;
    if (typeof rank !== "string" || !this.ranks.includes(rank as BluffRank)) return;
    if (this.rank !== null && rank !== this.rank) return;
    const hand = this.hands.get(id)!;
    const cards = cardIds.map((cid) => hand.find((c) => c.id === cid));
    if (cards.some((c) => !c)) return;
    if (this.settle()) return;

    this.hands.set(id, hand.filter((c) => !cardIds.includes(c.id)));
    this.pile.push(...(cards as Card[]));
    this.last = { by: id, cards: cards as Card[], rank: rank as BluffRank };
    this.lastPlayer = id;
    this.rank = rank as BluffRank;
    this.passes = 0;
    this.reveal = null;
    this.say(`${this.host.handle(id)} put down ${cards.length} × ${rank}${auto ? " (auto)" : ""}`);
    this.turn = this.nextAfter(id);
    this.playableAt = Date.now() + CALL_GRACE_MS;
    this.armTurn();
    this.host.push();
  }

  private pass(id: string, auto: boolean) {
    if (id !== this.turn || this.rank === null) return;
    if (this.settle()) return;
    this.last = null; // the previous play can no longer be called
    this.passes += 1;
    this.say(`${this.host.handle(id)} passed${auto ? " (time)" : ""}`);
    const active = this.present().length;
    if (this.passes >= active - 1) {
      const starter = this.lastPlayer && this.present().includes(this.lastPlayer) ? this.lastPlayer : this.nextAfter(id);
      this.say(`Everyone passed — ${this.pile.length} cards flushed. ${this.host.handle(starter)} starts fresh.`);
      this.pile = [];
      this.rank = null;
      this.passes = 0;
      this.turn = starter;
      this.lastPlayer = starter;
    } else this.turn = this.nextAfter(id);
    this.playableAt = 0;
    this.armTurn();
    this.host.push();
  }

  private callBluff(id: string) {
    const l = this.last;
    if (!l || l.by === id) return;
    const truthful = l.cards.every((c) => c.rank === l.rank);
    const loser = truthful ? id : l.by;
    const n = this.pile.length;
    this.hands.get(loser)?.push(...this.pile);
    this.pile = [];
    this.reveal = { by: l.by, caller: id, cards: l.cards, truthful, ts: Date.now() };
    this.say(
      truthful
        ? `${this.host.handle(id)} called Bluff — but it was true! ${this.host.handle(id)} picks up ${n}.`
        : `${this.host.handle(id)} caught ${this.host.handle(l.by)} lying! ${this.host.handle(l.by)} picks up ${n}.`,
    );
    this.last = null;
    this.rank = null;
    this.passes = 0;
    if (truthful && (this.hands.get(l.by)?.length ?? 1) === 0) return this.win(l.by);
    // Whoever won the challenge opens the next set.
    this.turn = truthful ? l.by : id;
    this.lastPlayer = this.turn;
    this.playableAt = Date.now() + AFTER_REVEAL_MS;
    this.armTurn();
    this.host.push();
  }

  private win(id: string) {
    this.add(id, 3);
    this.finish(`${this.host.handle(id)} emptied their hand — winner! 🃏`);
  }

  private timeUp() {
    if (this.phase === "done") return;
    const left = this.present().map((p) => [p, this.hands.get(p)?.length ?? 99] as const).sort((a, b) => a[1] - b[1]);
    if (!left.length) return this.finish("Time's up!");
    if (left.length > 1 && left[0][1] === left[1][1]) return this.finish(`Time's up — tie at ${left[0][1]} cards!`);
    this.add(left[0][0], 3);
    this.finish(`Time's up — ${this.host.handle(left[0][0])} wins with only ${left[0][1]} cards left!`);
  }

  private nextAfter(id: string): string {
    const order = this.players; // fixed seating; leavers are removed
    const i = order.indexOf(id);
    for (let k = 1; k <= order.length; k++) {
      const p = order[(Math.max(i, 0) + k) % order.length];
      if (this.host.members().includes(p)) return p;
    }
    return id;
  }

  private say(line: string) {
    this.log = [...this.log, line].slice(-6);
  }

  protected leftMidGame(id: string) {
    if (this.present().length < 2) {
      const w = this.present()[0];
      if (w) this.add(w, 3);
      return this.finish(w ? `${this.host.handle(w)} wins — everyone else left.` : "Everyone left.");
    }
    // Their cards are shuffled into the pile; their last play can't be called any more.
    this.pile.push(...(this.hands.get(id) ?? []));
    this.hands.delete(id);
    if (this.last?.by === id) this.last = null;
    if (this.lastPlayer === id) this.lastPlayer = null;
    this.say(`${this.host.handle(id)} left — their cards went into the pile.`);
    if (this.turn === id || !this.turn || !this.present().includes(this.turn)) {
      // nextAfter needs the leaver's seat, which is already gone — pick the next present player.
      this.turn = this.present()[0];
      this.armTurn();
    }
    this.host.push();
  }

  protected extraView(forId: string): Partial<GameView> {
    const order = (c: Card) => BLUFF_RANKS.indexOf(c.rank) * 4 + BLUFF_SUITS.indexOf(c.suit);
    const counts: Record<string, number> = {};
    for (const p of this.present()) counts[p] = this.hands.get(p)?.length ?? 0;
    const bluff: BluffView = {
      hand: [...(this.hands.get(forId) ?? [])].sort((a, b) => order(a) - order(b)),
      counts,
      ranks: this.ranks,
      pile: this.pile.length,
      rank: this.rank,
      last: this.last ? { by: this.last.by, count: this.last.cards.length, rank: this.last.rank } : null,
      playableAt: this.playableAt,
      reveal: this.reveal,
      log: this.log,
      endsAt: this.endsAt,
    };
    const h = this.turn ? this.host.handle(this.turn) : "";
    return {
      prompt: this.rank ? `${h}: play ${this.rank}s or pass` : `${h} starts a new set`,
      turn: this.turn,
      spotlight: this.last?.by ?? this.turn,
      bluff,
    };
  }
}
