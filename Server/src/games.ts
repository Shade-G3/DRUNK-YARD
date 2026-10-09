/**
 * Server-authoritative party games. Clients only send intents (ready / answer);
 * the server owns timers, prompts, votes and scores so nobody can cheat.
 */
import { GAME_META, GameKind, GamePhase, GameView, LIMITS } from "./shared/protocol";
import * as C from "./gameContent";

export interface GameHost {
  members(): string[];
  handle(id: string): string;
  spicy: boolean;
  push(): void; // re-send per-member views
  ended(): void; // game finished; host clears its reference
}

const LOBBY_MS = 20_000;
const QUESTION_MS = 15_000;
const REVEAL_MS = 6_000;
const DONE_MS = 8_000;

export class Game {
  phase: GamePhase = "lobby";
  round = 0;
  totalRounds = 0;
  deadline = Date.now() + LOBBY_MS;
  ready = new Set<string>();
  prompt = "";
  options: string[] = [];
  answers = new Map<string, string>();
  turn: string | null = null;
  reveal: GameView["reveal"] = null;
  scores = new Map<string, number>();

  private timer: NodeJS.Timeout | null = null;
  private deck: unknown[] = [];
  private turnOrder: string[] = [];
  private statements: string[] = [];
  private lieIndex = -1;
  private disposed = false;

  constructor(public kind: GameKind, private host: GameHost, proposer: string) {
    this.ready.add(proposer);
    this.arm(LOBBY_MS, () => this.tryStart(true));
  }

  // ── intents ───────────────────────────────────────────────────────────────
  markReady(id: string) {
    if (this.phase !== "lobby") return;
    this.ready.add(id);
    this.tryStart(false);
    this.host.push();
  }

  answer(id: string, value: unknown, statements?: unknown) {
    if (typeof value !== "string" || value.length > 64) return;
    const members = this.host.members();
    if (!members.includes(id)) return;

    if (this.phase === "compose") {
      if (id !== this.turn) return;
      if (!Array.isArray(statements) || statements.length !== 3) return;
      const clean = statements.map((s) => (typeof s === "string" ? s.trim().slice(0, LIMITS.statementMax) : ""));
      const lie = Number(value);
      if (clean.some((s) => !s) || ![0, 1, 2].includes(lie)) return;
      this.statements = clean;
      this.lieIndex = lie;
      this.prompt = `${this.host.handle(id)} says… which one is the lie?`;
      this.options = clean;
      this.phase = "question";
      this.answers.clear();
      this.arm(20_000, () => this.toReveal());
      this.host.push();
      return;
    }

    if (this.phase === "reveal" && this.kind === "truth_or_dare" && id === this.turn && value === "next") {
      this.nextRound();
      return;
    }

    if (this.phase !== "question") return;
    if (!this.canAnswer(id)) return;
    if (!this.validAnswer(id, value)) return;
    this.answers.set(id, value);
    if (this.eligible().every((m) => this.answers.has(m))) this.toReveal();
    else this.host.push();
  }

  stop() {
    this.finish("Game stopped.");
  }

  memberLeft(id: string) {
    this.ready.delete(id);
    this.answers.delete(id);
    this.turnOrder = this.turnOrder.filter((t) => t !== id);
    const n = this.host.members().length;
    if (this.phase !== "done" && n < GAME_META[this.kind].min) {
      this.finish("Not enough players left.");
      return;
    }
    if (this.turn === id && (this.phase === "question" || this.phase === "compose" || this.phase === "reveal")) {
      this.nextRound();
      return;
    }
    if (this.phase === "question" && this.eligible().length && this.eligible().every((m) => this.answers.has(m))) this.toReveal();
    else this.host.push();
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
      ready: [...this.ready],
      prompt: this.prompt,
      options: this.options,
      answeredBy: [...this.answers.keys()],
      myAnswer: this.answers.get(forId) ?? null,
      turn: this.turn,
      reveal: this.reveal,
      scores: Object.fromEntries(this.scores),
      spicy: this.host.spicy,
    };
  }

  // ── flow ──────────────────────────────────────────────────────────────────
  private tryStart(timedOut: boolean) {
    if (this.phase !== "lobby") return;
    const members = this.host.members();
    const min = GAME_META[this.kind].min;
    const allReady = members.every((m) => this.ready.has(m));
    if (members.length >= min && (allReady || (timedOut && this.ready.size >= min))) {
      this.begin();
    } else if (timedOut) {
      this.finish(members.length < min ? `Needs at least ${min} players.` : "Not enough people tapped Ready.");
    }
  }

  private begin() {
    const members = this.host.members();
    members.forEach((m) => this.scores.set(m, 0));
    this.turnOrder = C.pickN(members, members.length);
    switch (this.kind) {
      case "this_or_that": this.totalRounds = 8; this.deck = C.pickN(C.THIS_OR_THAT, 8); break;
      case "would_you_rather": this.totalRounds = 6; this.deck = C.pickN(C.WOULD_YOU_RATHER, 6); break;
      case "most_likely": this.totalRounds = 8; this.deck = C.pickN(C.MOST_LIKELY, 8); break;
      case "never_have_i_ever": this.totalRounds = 8; this.deck = C.pickN(C.NEVER_HAVE_I_EVER, 8); break;
      case "red_green": this.totalRounds = 8; this.deck = C.pickN(C.RED_GREEN, 8); break;
      case "truth_or_dare": this.totalRounds = Math.min(10, members.length * 2); break;
      case "two_truths": this.totalRounds = Math.min(6, members.length); break;
    }
    this.nextRound();
  }

  private nextRound() {
    if (this.disposed) return;
    this.round += 1;
    if (this.round > this.totalRounds) {
      this.finish(this.winnerNote());
      return;
    }
    this.answers.clear();
    this.reveal = null;
    this.turn = null;
    const i = this.round - 1;

    switch (this.kind) {
      case "this_or_that":
      case "would_you_rather": {
        const [a, b] = this.deck[i] as [string, string];
        this.prompt = this.kind === "this_or_that" ? "This or that?" : "Would you rather…";
        this.options = [a, b];
        break;
      }
      case "most_likely":
        this.prompt = `Who's most likely to ${(this.deck[i] as string).replace(/^\.\.\./, "")}`;
        this.options = [];
        break;
      case "never_have_i_ever":
        this.prompt = this.deck[i] as string;
        this.options = ["I have", "Never"];
        break;
      case "red_green":
        this.prompt = this.deck[i] as string;
        this.options = ["Red flag", "Green flag"];
        break;
      case "truth_or_dare":
        this.turn = this.nextTurn();
        this.prompt = `${this.host.handle(this.turn)}, truth or dare?`;
        this.options = ["Truth", "Dare"];
        break;
      case "two_truths":
        this.turn = this.nextTurn();
        this.prompt = `${this.host.handle(this.turn)} is writing two truths and a lie…`;
        this.options = [];
        this.statements = [];
        this.lieIndex = -1;
        this.phase = "compose";
        this.arm(60_000, () => this.nextRound()); // author timed out → skip
        this.host.push();
        return;
    }
    this.phase = "question";
    this.arm(this.kind === "truth_or_dare" ? 20_000 : QUESTION_MS, () => this.toReveal());
    this.host.push();
  }

  private nextTurn(): string {
    const members = this.host.members();
    this.turnOrder = this.turnOrder.filter((t) => members.includes(t));
    for (const m of members) if (!this.turnOrder.includes(m)) this.turnOrder.push(m);
    const t = this.turnOrder.shift()!;
    this.turnOrder.push(t);
    return t;
  }

  private toReveal() {
    if (this.phase !== "question") return;
    const answers = Object.fromEntries(this.answers);
    let note = "";
    const add = (id: string, n = 1) => this.scores.set(id, (this.scores.get(id) ?? 0) + n);

    switch (this.kind) {
      case "this_or_that":
      case "would_you_rather":
      case "red_green": {
        const counts = this.options.map((o) => [...this.answers.values()].filter((v) => v === o).length);
        const members = this.host.members().length;
        if (members === 2 && this.answers.size === 2 && counts.includes(2)) {
          note = "Match! You both picked the same.";
          for (const id of this.answers.keys()) add(id);
        } else if (counts[0] !== counts[1]) {
          const win = counts[0] > counts[1] ? this.options[0] : this.options[1];
          note = `${this.options[0]}: ${counts[0]} · ${this.options[1]}: ${counts[1]}`;
          for (const [id, v] of this.answers) if (v === win) add(id);
        } else {
          note = this.answers.size ? `Split decision — ${counts[0]} each.` : "Nobody answered.";
        }
        break;
      }
      case "most_likely": {
        const tally = new Map<string, number>();
        for (const v of this.answers.values()) tally.set(v, (tally.get(v) ?? 0) + 1);
        const top = [...tally.entries()].sort((a, b) => b[1] - a[1]);
        if (top.length && (top.length === 1 || top[0][1] > top[1][1])) {
          add(top[0][0]);
          note = `${this.host.handle(top[0][0])} wins this one with ${top[0][1]} vote${top[0][1] > 1 ? "s" : ""}.`;
        } else note = top.length ? "It's a tie!" : "Nobody voted.";
        break;
      }
      case "never_have_i_ever": {
        const have = [...this.answers.entries()].filter(([, v]) => v === "I have").map(([id]) => id);
        have.forEach((id) => add(id));
        note = have.length ? `Fingers down: ${have.map((id) => this.host.handle(id)).join(", ")}` : "Everyone's innocent… apparently.";
        break;
      }
      case "truth_or_dare": {
        const choice = (this.turn && this.answers.get(this.turn)) || (Math.random() < 0.5 ? "Truth" : "Dare");
        const spicy = this.host.spicy;
        const deck = choice === "Truth" ? (spicy ? [...C.TRUTHS, ...C.SPICY_TRUTHS] : C.TRUTHS) : spicy ? [...C.DARES, ...C.SPICY_DARES] : C.DARES;
        note = `${choice.toUpperCase()}: ${deck[Math.floor(Math.random() * deck.length)]}`;
        if (this.turn) answers[this.turn] = choice;
        this.phase = "reveal";
        this.reveal = { answers, note };
        this.arm(30_000, () => this.nextRound());
        this.host.push();
        return;
      }
      case "two_truths": {
        const lie = String(this.lieIndex);
        let fooled = 0;
        for (const [id, v] of this.answers) {
          if (v === lie) add(id);
          else fooled += 1;
        }
        if (this.turn) add(this.turn, fooled);
        note = `The lie was: "${this.statements[this.lieIndex]}"`;
        answers["__lie"] = lie;
        break;
      }
    }
    this.phase = "reveal";
    this.reveal = { answers, note };
    this.arm(REVEAL_MS, () => this.nextRound());
    this.host.push();
  }

  private winnerNote(): string {
    const top = [...this.scores.entries()].sort((a, b) => b[1] - a[1]);
    if (!top.length || top[0][1] === 0) return "Game over! Good vibes all round.";
    if (top.length > 1 && top[0][1] === top[1][1]) return `Game over — it's a tie at ${top[0][1]} points!`;
    return `Game over — ${this.host.handle(top[0][0])} wins with ${top[0][1]} points!`;
  }

  private finish(note: string) {
    if (this.disposed) return;
    this.phase = "done";
    this.turn = null;
    this.reveal = { answers: {}, note };
    this.arm(DONE_MS, () => {
      this.dispose();
      this.host.ended();
    });
    this.host.push();
  }

  private canAnswer(id: string): boolean {
    if (this.kind === "truth_or_dare") return id === this.turn;
    if (this.kind === "two_truths") return id !== this.turn;
    return true;
  }

  private eligible(): string[] {
    return this.host.members().filter((m) => this.canAnswer(m));
  }

  private validAnswer(id: string, v: string): boolean {
    if (this.kind === "most_likely") return v !== id && this.host.members().includes(v);
    if (this.kind === "two_truths") return ["0", "1", "2"].includes(v);
    return this.options.includes(v);
  }

  private arm(ms: number, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(fn, ms);
  }
}
