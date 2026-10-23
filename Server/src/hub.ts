/**
 * The Hub owns all realtime state: who's online, who's waiting, rooms, games, gifts.
 * Single-process, in-memory. To scale horizontally, move queues/rooms to Redis and
 * add the Socket.IO Redis adapter — the event surface stays the same.
 */
import { scrubLinks } from "./text";
export { scrubLinks };
import { randomUUID } from "crypto";
import type { Server, Socket } from "socket.io";
import {
  ClientToServer, ServerToClient, Drink, Vibe, RoomSize, JoinRequest, PeerInfo, SignalData,
  VIBES, DRINKS, REACTIONS, REPORT_REASONS, GAME_KINDS, GAME_META, GIFT_CATEGORIES, GIFT_LADDER,
  TIER_META, TierIndex, LIMITS, MIN_ROOM, MAX_ROOM, Me, IMPOSTER_MODES, ImposterMode, SeatState, GameKind,
} from "./shared/protocol";
import { Game, GameHost } from "./games";
import { BluffGame, ImposterGame, GameAct } from "./partyGames";
import { Store } from "./store";
import { SocketLimiter } from "./limiter";
import { randomHandle } from "./names";
import { config } from "./config";

type IO = Server<ClientToServer, ServerToClient>;
type Sock = Socket<ClientToServer, ServerToClient>;

interface SockData {
  deviceId: string;
  ip: string;
  handle: string;
  limiter: SocketLimiter;
  roomId: string | null;
  recent: Map<string, number>; // deviceId → when we last shared a room (short cool-down after Next)
  met: Map<string, { deviceId: string; handle: string; ts: number }>; // socketId → who we shared a room with
  lastFreeGift: number;
  lastChat: { text: string; n: number; ts: number };
  violations: number[]; // timestamps of rate-limit hits (persistent abusers get disconnected)
}

interface Waiter {
  sock: Sock;
  req: JoinRequest;
  since: number;
}

interface Member {
  id: string;
  sock: Sock;
  drink: Drink;
  vibe: Vibe;
}

type PartyGame = Game | ImposterGame | BluffGame;

/** "Add someone": everyone must agree, then one extra seat opens for a while. */
interface Seat {
  stage: "vote" | "open";
  mode: "match" | "link";
  by: string;
  vibe: Vibe;
  yes: Set<string>;
  deadline: number;
  timer: NodeJS.Timeout;
  token?: string;
  grew: boolean; // did we bump room.size for this seat?
}

const SEAT_VOTE_MS = 15_000;
const SEAT_MATCH_MS = 90_000;
const SEAT_LINK_MS = 10 * 60_000;
const SEAT_COOLDOWN_MS = 30_000;

class Room {
  id = `r_${randomUUID()}`;
  members = new Map<string, Member>();
  game: PartyGame | null = null;
  seat: Seat | null = null;
  seatCooldownUntil = 0;
  lastGift = new Map<string, number>(); // "from>to" → ts
  createdAt = Date.now();
  constructor(public size: RoomSize, public vibe: Vibe, public privateRoom = false) {}
  get spicy() {
    return this.vibe === "flirt";
  }
  ids() {
    return [...this.members.keys()];
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

const compatible = (a: Vibe, b: Vibe) => a === b || a === "any" || b === "any";

export class Hub {
  private waiting = new Map<string, Waiter>(); // socketId → waiter (Map keeps insertion order = FIFO)
  private rooms = new Map<string, Room>();
  private byDevice = new Map<string, Set<string>>(); // deviceId → socketIds
  private invites = new Map<string, { from: string; ts: number }>(); // mutual token → requester socket id
  private links = new Map<string, string>(); // friend-invite token → roomId
  private lastOnline = -1;
  private cheersGiven = new Map<string, number>(); // "deviceA>deviceB" → ts


  constructor(private io: IO, private store: Store) {
    setInterval(() => this.broadcastOnline(), 5000).unref();
    setInterval(() => this.rematchWaiting(), 3000).unref();
    setInterval(() => {
      const cutoff = Date.now() - 24 * 3600_000;
      for (const [k, t] of this.cheersGiven) if (t < cutoff) this.cheersGiven.delete(k);
    }, 30 * 60_000).unref();
  }

  // ── connection lifecycle ──────────────────────────────────────────────────
  attach(sock: Sock) {
    const d = sock.data as SockData;
    d.handle = randomHandle();
    d.limiter = new SocketLimiter();
    d.roomId = null;
    d.recent = new Map();
    d.met = new Map();
    d.lastFreeGift = 0;
    d.lastChat = { text: "", n: 0, ts: 0 };
    d.violations = [];
    this.store.account(d.deviceId, d.ip); // create with IP so anti-farming rules apply
    if (!this.byDevice.has(d.deviceId)) this.byDevice.set(d.deviceId, new Set());
    this.byDevice.get(d.deviceId)!.add(sock.id);

    sock.emit("hello", this.me(sock));
    sock.emit("online-count", this.io.engine.clientsCount);

    const on = <E extends keyof ClientToServer>(ev: E, fn: (...args: any[]) => void) => {
      sock.on(ev as any, (...args: any[]) => {
        if (!d.limiter.allow(ev)) {
          if (ev !== "signal") sock.emit("error", { code: "rate", message: "Slow down a little." });
          const now = Date.now();
          d.violations = d.violations.filter((t) => now - t < 60_000);
          d.violations.push(now);
          if (d.violations.length > 300) {
            console.warn(`[abuse] disconnecting ${d.deviceId.slice(0, 8)} (${d.violations.length} rate-limit hits/min)`);
            sock.disconnect(true);
          }
          return;
        }
        try {
          fn(...args);
        } catch (e) {
          console.error(`[${ev}]`, e);
        }
      });
    };

    on("queue:join", (req: unknown) => this.join(sock, req));
    on("queue:leave", () => this.waiting.delete(sock.id));
    on("room:leave", () => this.leaveRoom(sock));
    on("name:shuffle", (cb: unknown) => {
      if (d.roomId) return; // no identity swaps mid-room
      d.handle = randomHandle();
      if (typeof cb === "function") cb(d.handle);
    });
    on("signal", (p: unknown) => this.signal(sock, p));
    on("chat:send", (p: unknown) => this.chat(sock, p));
    on("react", (p: unknown) => {
      const kind = (p as any)?.kind;
      if (!REACTIONS.includes(kind) || !d.roomId) return;
      this.io.to(d.roomId).emit("react", { from: sock.id, kind });
    });
    on("game:propose", (p: unknown) => this.proposeGame(sock, (p as any)?.kind, (p as any)?.mode));
    on("game:act", (p: unknown) => {
      const g = this.room(sock)?.game;
      if (g && p && typeof p === "object") g.act(sock.id, p as GameAct);
    });
    on("seat:request", (p: unknown) => this.seatRequest(sock, p));
    on("seat:vote", (p: unknown) => this.seatVote(sock, (p as any)?.yes === true));
    on("seat:cancel", () => {
      const room = this.room(sock);
      if (room?.seat) this.closeSeat(room, `${(sock.data as SockData).handle} closed the extra seat.`);
    });
    on("link:join", (p: unknown) => this.linkJoin(sock, p));
    on("game:ready", () => this.room(sock)?.game?.markReady(sock.id));
    on("game:answer", (p: unknown) => this.room(sock)?.game?.answer(sock.id, (p as any)?.value, (p as any)?.statements));
    on("game:stop", () => this.room(sock)?.game?.stop());
    on("gift:send", (p: unknown) => this.gift(sock, p));
    on("cheers:give", (p: unknown) => this.cheers(sock, (p as any)?.to));
    on("callagain:request", (p: unknown) => this.callAgainRequest(sock, (p as any)?.token));
    on("callagain:accept", (p: unknown) => this.callAgainAccept(sock, (p as any)?.token));
    on("report", (p: unknown) => this.report(sock, p));
    on("account:delete", (cb: unknown) => {
      this.store.deleteAccount(d.deviceId);
      console.log(JSON.stringify({ evt: "account_deleted", device: d.deviceId.slice(0, 8), ts: new Date().toISOString() }));
      if (typeof cb === "function") cb(true);
      sock.disconnect(true);
    });

    sock.on("disconnect", () => {
      this.waiting.delete(sock.id);
      this.leaveRoom(sock);
      const set = this.byDevice.get(d.deviceId);
      set?.delete(sock.id);
      if (set && !set.size) this.byDevice.delete(d.deviceId);
    });
  }

  private me(sock: Sock): Me {
    const d = sock.data as SockData;
    const a = this.store.account(d.deviceId);
    return { handle: d.handle, coins: a.coins, shelf: a.shelf, cheers: a.cheers };
  }

  private broadcastOnline() {
    const n = this.io.engine.clientsCount;
    if (n !== this.lastOnline) {
      this.lastOnline = n;
      this.io.emit("online-count", n); // throttled: max once per 5s, not on every connect
    }
  }

  // ── matchmaking ───────────────────────────────────────────────────────────
  private join(sock: Sock, raw: unknown) {
    const d = sock.data as SockData;
    const r = raw as Partial<JoinRequest> | null;
    if (!r || typeof r !== "object") return;
    const size = Number(r.size) as RoomSize;
    if (!VIBES.includes(r.vibe as Vibe) || !DRINKS.includes(r.drink as Drink) || !(size >= MIN_ROOM && size <= MAX_ROOM)) {
      sock.emit("error", { code: "bad_request", message: "Invalid selection." });
      return;
    }
    if (r.ageConfirmed !== true) {
      sock.emit("error", { code: "age", message: "You must confirm you are 18+." });
      return;
    }
    const req: JoinRequest = { vibe: r.vibe as Vibe, drink: r.drink as Drink, size, ageConfirmed: true, anyone: r.anyone === true, ongoing: r.ongoing === true };

    this.leaveRoom(sock);
    this.waiting.delete(sock.id);

    if (this.waiting.size >= config.maxQueueSize) {
      sock.emit("error", { code: "busy", message: "The yard is packed. Try again in a moment." });
      return;
    }

    if (!this.place(sock, req)) {
      this.waiting.set(sock.id, { sock, req, since: Date.now() });
      sock.emit("waiting", { since: Date.now() });
    }
  }

  /** Re-try everyone still waiting (cool-downs expire, people leave rooms, etc.). */
  private rematchWaiting() {
    for (const w of [...this.waiting.values()]) {
      if (!this.waiting.has(w.sock.id) || !w.sock.connected) continue;
      this.waiting.delete(w.sock.id);
      if (!this.place(w.sock, w.req)) this.waiting.set(w.sock.id, w);
    }
  }

  /** Put `sock` into a room if anyone suitable exists. Returns false if it should keep waiting. */
  private place(sock: Sock, req: JoinRequest): boolean {
    const d = sock.data as SockData;
    const size = req.size;
    const COOLDOWN_MS = 10_000; // after Next, skip that person for a bit — but don't ban them forever (small user base!)
    const okWith = (other: Sock) => {
      const od = other.data as SockData;
      if (other.id === sock.id) return false; // same device in two tabs is allowed (handy for testing)
      if (this.store.isBlocked(d.deviceId, od.deviceId)) return false;
      const t = Math.max(d.recent.get(od.deviceId) ?? 0, od.recent.get(d.deviceId) ?? 0);
      if (Date.now() - t < COOLDOWN_MS) return false;
      return true;
    };
    const vibeOk = (a: Vibe, b: Vibe, w?: JoinRequest) => req.anyone || w?.anyone || compatible(a, b);

    // 0) "Add someone" seats: only people who asked for this table size, or who said
    //    they're happy to walk into a table that's already chatting. Longest-open first.
    const seats = [...this.rooms.values()]
      .filter((rm) => rm.seat?.stage === "open" && rm.seat.mode === "match" && rm.members.size < rm.size)
      .filter((rm) => (req.size === rm.size || req.ongoing) && vibeOk(rm.seat!.vibe, req.vibe))
      .filter((rm) => [...rm.members.values()].every((m) => okWith(m.sock)))
      .sort((a, b) => a.seat!.deadline - b.seat!.deadline);
    if (seats.length) {
      const rm = seats[0];
      this.addToRoom(rm, sock, req, true);
      this.closeSeat(rm, null, true);
      return true;
    }

    // 1) Group: join an open room of the same size (fullest first → rooms fill up fast).
    if (size > 2) {
      const open = [...this.rooms.values()]
        .filter((rm) => !rm.privateRoom && !rm.seat && rm.size === size && rm.members.size < size && vibeOk(rm.vibe, req.vibe))
        .filter((rm) => [...rm.members.values()].every((m) => okWith(m.sock)))
        .sort((a, b) => b.members.size - a.members.size);
      if (open.length) {
        this.addToRoom(open[0], sock, req);
        return true;
      }
    }

    // 2) Pair up with compatible waiters (exact vibe first, then "any").
    const candidates = [...this.waiting.values()]
      .filter((w) => w.req.size === size && vibeOk(w.req.vibe, req.vibe, w.req) && okWith(w.sock))
      .sort((a, b) => Number(b.req.vibe === req.vibe) - Number(a.req.vibe === req.vibe));
    if (candidates.length) {
      const take = candidates.slice(0, size - 1);
      take.forEach((w) => this.waiting.delete(w.sock.id));
      const vibe = [req.vibe, ...take.map((t) => t.req.vibe)].find((v) => v !== "any") ?? "any";
      const room = new Room(size, vibe);
      this.rooms.set(room.id, room);
      // Earlier waiters join first; each later joiner offers to everyone already inside.
      for (const w of take) this.addToRoom(room, w.sock, w.req);
      this.addToRoom(room, sock, req);
      return true;
    }
    return false;
  }

  private peerInfo(sock: Sock, m: { drink: Drink; vibe: Vibe }): PeerInfo {
    const d = sock.data as SockData;
    return { id: sock.id, handle: d.handle, drink: m.drink, vibe: m.vibe, cheers: this.store.account(d.deviceId).cheers };
  }

  private addToRoom(room: Room, sock: Sock, req: { drink: Drink; vibe: Vibe }, ongoing = false) {
    const d = sock.data as SockData;
    const existing = [...room.members.values()];
    room.members.set(sock.id, { id: sock.id, sock, drink: req.drink, vibe: req.vibe });
    d.roomId = room.id;
    sock.join(room.id);
    const me = this.peerInfo(sock, req);

    sock.emit("room:joined", {
      roomId: room.id,
      size: room.size,
      vibe: room.vibe,
      you: me,
      peers: existing.map((m) => this.peerInfo(m.sock, m)),
      initiate: existing.map((m) => m.id), // fixes v1 bug: every pair gets exactly one offerer
      ongoing: ongoing || undefined,
    });
    for (const m of existing) {
      m.sock.emit("room:peer-joined", me);
      const md = m.sock.data as SockData;
      md.recent.set(d.deviceId, Date.now());
      d.recent.set(md.deviceId, Date.now());
      if (md.recent.size > 50) md.recent.delete(md.recent.keys().next().value!);
      if (d.recent.size > 50) d.recent.delete(d.recent.keys().next().value!);
      md.met.set(sock.id, { deviceId: d.deviceId, handle: d.handle, ts: Date.now() });
      d.met.set(m.id, { deviceId: md.deviceId, handle: md.handle, ts: Date.now() });
      if (md.met.size > 200) md.met.delete(md.met.keys().next().value!);
      if (d.met.size > 200) d.met.delete(d.met.keys().next().value!);
    }
    if (room.game) this.pushGame(room);
    if (room.seat) this.pushSeat(room);
  }

  private room(sock: Sock): Room | null {
    const id = (sock.data as SockData).roomId;
    return id ? this.rooms.get(id) ?? null : null;
  }

  private leaveRoom(sock: Sock) {
    const d = sock.data as SockData;
    const room = this.room(sock);
    d.roomId = null;
    if (!room) return;
    room.members.delete(sock.id);
    sock.leave(room.id);
    this.io.to(room.id).emit("room:peer-left", { id: sock.id });
    if (room.members.size === 0) {
      room.game?.dispose();
      if (room.seat) clearTimeout(room.seat.timer);
      if (room.seat?.token) this.links.delete(room.seat.token);
      this.rooms.delete(room.id);
      return;
    }
    if (room.seat) {
      if (room.seat.by === sock.id && room.seat.stage === "vote") this.closeSeat(room, "The request was cancelled.");
      else if (room.seat.stage === "vote") this.checkSeatVotes(room);
    }
    room.game?.memberLeft(sock.id);
  }

  // ── signaling relay (validated + size-capped) ─────────────────────────────
  private signal(sock: Sock, raw: unknown) {
    const p = raw as { to?: unknown; data?: any } | null;
    const room = this.room(sock);
    if (!room || !p || typeof p.to !== "string" || !room.members.has(p.to) || p.to === sock.id) return;
    const data = p.data;
    let clean: SignalData | null = null;
    if (data && (data.type === "offer" || data.type === "answer") && typeof data.sdp === "string" && data.sdp.length < 20_000) {
      clean = { type: data.type, sdp: data.sdp };
    } else if (data && typeof data.candidate === "string" && data.candidate.length < 1_000) {
      clean = {
        candidate: data.candidate,
        sdpMid: typeof data.sdpMid === "string" ? data.sdpMid.slice(0, 32) : null,
        sdpMLineIndex: Number.isInteger(data.sdpMLineIndex) ? data.sdpMLineIndex : null,
        usernameFragment: typeof data.usernameFragment === "string" ? data.usernameFragment.slice(0, 64) : null,
      };
    }
    if (clean) this.io.to(p.to).emit("signal", { from: sock.id, data: clean });
  }

  private chat(sock: Sock, raw: unknown) {
    const room = this.room(sock);
    const text = (raw as any)?.text;
    if (!room || typeof text !== "string") return;
    if (room.game?.locksChat()) {
      sock.emit("error", { code: "chat_locked", message: "Chat is paused while clues are given — say it out loud!" });
      return;
    }
    const clean = scrubLinks(text.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, LIMITS.chatMax));
    if (!clean) return;
    const d = sock.data as SockData;
    const now = Date.now();
    if (clean === d.lastChat.text && now - d.lastChat.ts < 30_000) {
      if (++d.lastChat.n >= 3) return; // same message 3× in 30s = spam
    } else d.lastChat = { text: clean, n: 1, ts: now };
    d.lastChat.ts = now;
    this.io.to(room.id).emit("chat:msg", { from: sock.id, handle: (sock.data as SockData).handle, text: clean, ts: Date.now() });
  }

  // ── games ─────────────────────────────────────────────────────────────────
  private proposeGame(sock: Sock, kind: unknown, mode?: unknown) {
    const room = this.room(sock);
    if (!room || !GAME_KINDS.includes(kind as any)) return;
    if (room.game) {
      sock.emit("error", { code: "game_running", message: "A game is already running." });
      return;
    }
    const meta = GAME_META[kind as keyof typeof GAME_META];
    if (room.members.size < meta.min) {
      sock.emit("error", { code: "game_min", message: `${meta.name} needs at least ${meta.min} people.` });
      return;
    }
    const host: GameHost = {
      members: () => room.ids(),
      handle: (id) => ((room.members.get(id)?.sock.data as SockData | undefined)?.handle ?? "Someone"),
      spicy: room.spicy,
      push: () => this.pushGame(room),
      ended: () => {
        room.game = null;
        this.io.to(room.id).emit("game:state", null);
      },
    };
    const k = kind as GameKind;
    room.game =
      k === "imposter" ? new ImposterGame(host, sock.id, IMPOSTER_MODES.includes(mode as ImposterMode) ? (mode as ImposterMode) : "undercover")
      : k === "bluff" ? new BluffGame(host, sock.id)
      : new Game(k, host, sock.id);
    this.pushGame(room);
  }

  private pushGame(room: Room) {
    if (!room.game) return;
    for (const m of room.members.values()) m.sock.emit("game:state", room.game.view(m.id));
  }

  // ── drinks ────────────────────────────────────────────────────────────────
  private gift(sock: Sock, raw: unknown) {
    const room = this.room(sock);
    const p = raw as { category?: unknown; tier?: unknown; to?: unknown } | null;
    if (!room || !p) return;
    const d = sock.data as SockData;
    const category = p.category as (typeof GIFT_CATEGORIES)[number];
    if (typeof p.tier !== "number" || !Number.isInteger(p.tier) || p.tier < 0 || p.tier > 4) return;
    const tier = p.tier as TierIndex;
    if (typeof category !== "string" || !GIFT_CATEGORIES.includes(category)) return;
    if (tier === 0) {
      // Free drinks: one every 10s per sender, so nobody can flood someone's screen with animations.
      if (Date.now() - d.lastFreeGift < 10_000) {
        sock.emit("error", { code: "slow", message: "One free drink every 10 seconds — or send a fancier one!" });
        return;
      }
      d.lastFreeGift = Date.now();
    }
    const isRound = p.to === "table";
    const to = isRound ? room.ids().filter((id) => id !== sock.id) : typeof p.to === "string" && room.members.has(p.to) && p.to !== sock.id ? [p.to] : [];
    if (!to.length) return;

    const cost = TIER_META[tier].price * to.length;
    if (cost > 0 && !this.store.spend(d.deviceId, cost)) {
      sock.emit("error", { code: "coins", message: "Not enough coins for that one." });
      return;
    }
    const toHandles: string[] = [];
    for (const id of to) {
      const m = room.members.get(id)!;
      const md = m.sock.data as SockData;
      this.store.addToShelf(md.deviceId, tier);
      m.sock.emit("shelf", this.store.account(md.deviceId).shelf);
      toHandles.push(md.handle);
    }
    sock.emit("wallet", { coins: this.store.account(d.deviceId).coins });
    this.io.to(room.id).emit("gift:landed", {
      from: sock.id, fromHandle: d.handle, to, toHandles, category, tier,
      name: GIFT_LADDER[category][tier], round: isRound, ts: Date.now(),
    });

    // Clink: A→B and B→A within 3 seconds.
    const now = Date.now();
    for (const id of to) {
      const back = room.lastGift.get(`${id}>${sock.id}`);
      if (back && now - back < 3000) {
        this.io.to(room.id).emit("gift:clink", { a: sock.id, b: id });
        room.lastGift.delete(`${id}>${sock.id}`);
      } else room.lastGift.set(`${sock.id}>${id}`, now);
    }
  }

  // ── cheers & call again ───────────────────────────────────────────────────
  /** Cheers work in-room AND from the recap screen (anyone you shared a room with in the last 2h). */
  private cheers(sock: Sock, to: unknown) {
    const d = sock.data as SockData;
    if (typeof to !== "string" || to === sock.id) return;
    const who = d.met.get(to);
    if (!who || Date.now() - who.ts > 2 * 3600_000) return;
    const key = `${d.deviceId}>${who.deviceId}`;
    if (this.cheersGiven.has(key)) return;
    this.cheersGiven.set(key, Date.now());
    const total = this.store.addCheers(who.deviceId);
    const target = this.io.sockets.sockets.get(to) as Sock | undefined;
    target?.emit("cheers:received", { from: sock.id, total });
    const back = this.cheersGiven.get(`${who.deviceId}>${d.deviceId}`);
    if (back && Date.now() - back < 24 * 3600_000) {
      const token = this.store.addMutual(d.deviceId, who.deviceId, { [d.deviceId]: d.handle, [who.deviceId]: who.handle });
      sock.emit("cheers:mutual", { peerId: to, handle: who.handle, token });
      target?.emit("cheers:mutual", { peerId: sock.id, handle: d.handle, token });
    }
  }

  private otherSockets(deviceId: string): Sock[] {
    return [...(this.byDevice.get(deviceId) ?? [])]
      .map((id) => this.io.sockets.sockets.get(id) as Sock | undefined)
      .filter((s): s is Sock => !!s);
  }

  private callAgainRequest(sock: Sock, token: unknown) {
    const d = sock.data as SockData;
    const m = isUuid(token) ? this.store.mutual(token) : null;
    if (!m || (m.a !== d.deviceId && m.b !== d.deviceId)) {
      sock.emit("callagain:result", { ok: false, message: "That invite has expired." });
      return;
    }
    const other = m.a === d.deviceId ? m.b : m.a;
    const targets = this.otherSockets(other);
    if (!targets.length) {
      sock.emit("callagain:result", { ok: false, message: `${m.handles[other] ?? "They"} isn't online right now.` });
      return;
    }
    this.invites.set(m.token, { from: sock.id, ts: Date.now() });
    targets.forEach((t) => t.emit("callagain:invite", { token: m.token, handle: d.handle }));
    sock.emit("callagain:result", { ok: true, message: `Invite sent to ${m.handles[other] ?? "them"}.` });
  }

  private callAgainAccept(sock: Sock, token: unknown) {
    const d = sock.data as SockData;
    const inv = isUuid(token) ? this.invites.get(token) : undefined;
    const m = isUuid(token) ? this.store.mutual(token) : null;
    const from = inv && (this.io.sockets.sockets.get(inv.from) as Sock | undefined);
    if (!inv || !m || !from || Date.now() - inv.ts > 120_000 || (m.a !== d.deviceId && m.b !== d.deviceId) || (from.data as SockData).deviceId === d.deviceId) {
      sock.emit("callagain:result", { ok: false, message: "That invite has expired." });
      return;
    }
    this.invites.delete(token as string);
    for (const s of [from, sock]) {
      this.waiting.delete(s.id);
      this.leaveRoom(s);
    }
    const room = new Room(2, "any", true);
    this.rooms.set(room.id, room);
    this.addToRoom(room, from, { drink: "sober", vibe: "any" });
    this.addToRoom(room, sock, { drink: "sober", vibe: "any" });
  }

  // ── "Add someone" + friend invite links ───────────────────────────────────
  private seatRequest(sock: Sock, raw: unknown) {
    const room = this.room(sock);
    const p = raw as { mode?: unknown; vibe?: unknown } | null;
    if (!room || !p) return;
    const mode = p.mode === "link" ? "link" : p.mode === "match" ? "match" : null;
    const vibe = (VIBES.includes(p.vibe as Vibe) ? p.vibe : room.vibe) as Vibe;
    const fail = (message: string) => sock.emit("seat:result", { ok: false, message });
    if (!mode) return;
    if (room.seat) return fail("There's already a request going.");
    if (Date.now() < room.seatCooldownUntil) return fail("Give it a few seconds before asking again.");
    if (room.members.size < 2) return fail("Wait for someone to join first.");
    const growing = room.members.size >= room.size;
    if (growing && room.size >= MAX_ROOM) return fail(`Tables max out at ${MAX_ROOM} people.`);
    if (!growing && mode === "match") return fail("There's already an empty seat — someone will join soon.");

    const timer = setTimeout(() => this.closeSeat(room, "Not everyone answered in time."), SEAT_VOTE_MS);
    room.seat = { stage: "vote", mode, by: sock.id, vibe, yes: new Set([sock.id]), deadline: Date.now() + SEAT_VOTE_MS, timer, grew: false };
    this.pushSeat(room);
  }

  private seatVote(sock: Sock, yes: boolean) {
    const room = this.room(sock);
    if (!room?.seat || room.seat.stage !== "vote") return;
    if (!yes) {
      // Anonymous on purpose — nobody needs to know who said no.
      this.closeSeat(room, "Not everyone wanted to add someone right now.");
      return;
    }
    room.seat.yes.add(sock.id);
    this.checkSeatVotes(room);
  }

  private checkSeatVotes(room: Room) {
    const seat = room.seat;
    if (!seat || seat.stage !== "vote") return;
    if (![...room.members.keys()].every((id) => seat.yes.has(id))) return this.pushSeat(room);
    clearTimeout(seat.timer);
    if (room.members.size >= room.size) {
      room.size = Math.min(MAX_ROOM, room.size + 1) as RoomSize;
      seat.grew = true;
      this.io.to(room.id).emit("room:size", { size: room.size });
    }
    const ms = seat.mode === "link" ? SEAT_LINK_MS : SEAT_MATCH_MS;
    seat.stage = "open";
    seat.deadline = Date.now() + ms;
    seat.timer = setTimeout(
      () => this.closeSeat(room, seat.mode === "link" ? "The invite link expired." : "Couldn't find anyone right now — try again in a bit."),
      ms,
    );
    if (seat.mode === "link") {
      seat.token = randomUUID();
      this.links.set(seat.token, room.id);
    }
    this.pushSeat(room);
    if (seat.mode === "match") this.rematchWaiting(); // fill it right away if someone's queued
  }

  /** filled=true: someone took the seat (keep the bigger size). Otherwise shrink back. */
  private closeSeat(room: Room, message: string | null, filled = false) {
    const seat = room.seat;
    if (!seat) return;
    clearTimeout(seat.timer);
    if (seat.token) this.links.delete(seat.token);
    room.seat = null;
    if (!filled) {
      room.seatCooldownUntil = Date.now() + SEAT_COOLDOWN_MS;
      if (seat.grew && room.size > Math.max(2, room.members.size)) {
        room.size = Math.max(2, room.members.size) as RoomSize;
        this.io.to(room.id).emit("room:size", { size: room.size });
      }
    }
    this.io.to(room.id).emit("room:seat", null);
    if (message) this.io.to(room.id).emit("seat:result", { ok: false, message });
  }

  private pushSeat(room: Room) {
    const s = room.seat;
    if (!s) return;
    for (const m of room.members.values()) {
      const view: SeatState = { stage: s.stage, mode: s.mode, by: s.by, vibe: s.vibe, yes: [...s.yes], deadline: s.deadline, size: room.size };
      if (s.token && m.id === s.by) view.token = s.token; // only the person who asked gets the link
      m.sock.emit("room:seat", view);
    }
  }

  private linkJoin(sock: Sock, raw: unknown) {
    const p = raw as { token?: unknown; drink?: unknown; ageConfirmed?: unknown } | null;
    const fail = (message: string) => sock.emit("link:result", { ok: false, message });
    if (!p || p.ageConfirmed !== true) return fail("You must confirm you are 18+.");
    const roomId = isUuid(p.token) ? this.links.get(p.token) : undefined;
    const room = roomId ? this.rooms.get(roomId) : undefined;
    const seat = room?.seat;
    if (!room || !seat || seat.mode !== "link" || seat.token !== p.token || room.members.size >= room.size) {
      return fail("This invite has expired or was already used.");
    }
    const d = sock.data as SockData;
    for (const m of room.members.values()) {
      const md = m.sock.data as SockData;
      if (this.store.isBlocked(d.deviceId, md.deviceId)) return fail("You can't join this table.");
      if (m.id === sock.id) return fail("You're already at this table.");
    }
    const drink = (DRINKS.includes(p.drink as Drink) ? p.drink : "sober") as Drink;
    this.waiting.delete(sock.id);
    this.leaveRoom(sock);
    this.addToRoom(room, sock, { drink, vibe: room.vibe }, true);
    this.closeSeat(room, null, true); // single use
    sock.emit("link:result", { ok: true, message: "You're in!" });
  }

  // ── safety ────────────────────────────────────────────────────────────────
  private report(sock: Sock, raw: unknown) {
    const p = raw as { peerId?: unknown; reason?: unknown } | null;
    const room = this.room(sock);
    if (!room || !p || typeof p.peerId !== "string" || !REPORT_REASONS.includes(p.reason as any)) return;
    const target = room.members.get(p.peerId)?.sock;
    if (!target || target.id === sock.id) return;
    const d = sock.data as SockData;
    const td = target.data as SockData;
    const metAt = d.met.get(target.id)?.ts ?? Date.now();
    const counts = Date.now() - metAt >= config.reportMinEncounterSec * 1000;
    const priority = p.reason === "minor" || p.reason === "nudity";
    // Structured log line → searchable in Render logs until a real review dashboard exists.
    console.warn(JSON.stringify({ evt: "report", priority, reason: p.reason, reporter: d.deviceId.slice(0, 8), target: td.deviceId.slice(0, 8), counted: counts, ts: new Date().toISOString() }));
    const until = this.store.report(d.deviceId, d.ip, td.deviceId, td.ip, String(p.reason), counts);
    sock.emit("report:ok");
    // Reporter never gets matched with them again (store.report blocks the pair).
    if (until) {
      for (const s of this.otherSockets(td.deviceId)) {
        s.emit("banned", { until });
        s.disconnect(true);
      }
    }
  }
}
