import { create } from "zustand";
import type {
  ChatMsg, Drink, GameView, GiftLanded, Me, PeerInfo, Reaction, RoomJoined, RoomSize, Shelf, TierIndex, Vibe,
} from "@shared/protocol";
import { socket, fetchIceServers } from "./lib/socket";
import { Mesh } from "./lib/rtc";
import { storage } from "./lib/storage";
import * as sfx from "./lib/sound";

export type Screen = "lobby" | "searching" | "room" | "recap";
export type Sheet = null | "games" | "gift" | "report" | "chat";

export interface Effect {
  id: number;
  kind: "gift" | "clink" | "react";
  gift?: GiftLanded;
  clink?: { a: string; b: string };
  react?: { from: string; kind: Reaction };
}

export interface Toast {
  id: number;
  text: string;
  err?: boolean;
  action?: { label: string; run: () => void };
}

export interface MetPerson {
  id: string;
  handle: string;
  drink: Drink;
  iCheered: boolean;
  theyCheered: boolean;
  mutualToken: string | null;
  seconds: number;
  joinedAt: number;
}

export interface RoomState {
  id: string;
  size: RoomSize;
  vibe: Vibe;
  you: PeerInfo;
  peers: PeerInfo[];
  startedAt: number;
}

interface Prefs {
  theme: "dark" | "light";
  bar: boolean;
  vibe: Vibe;
  size: RoomSize;
  drink: Drink;
  ageOk: boolean;
  sound: boolean;
}

interface State {
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;

  connected: boolean;
  online: number;
  me: Me | null;
  bannedUntil: number;

  local: MediaStream | null;
  mic: boolean;
  cam: boolean;
  camError: string | null;
  startCamera: () => Promise<boolean>;
  toggleMic: () => void;
  toggleCam: () => void;

  screen: Screen;
  searchSince: number;
  room: RoomState | null;
  streams: Record<string, MediaStream>;
  conn: Record<string, RTCPeerConnectionState>;
  chat: (ChatMsg & { sys?: boolean })[];
  unread: number;
  game: GameView | null;
  effects: Effect[];
  glows: Record<string, TierIndex>;
  met: Record<string, MetPerson>;
  recapStats: { seconds: number; giftsGot: number; cheersGot: number; gamesPlayed: number };
  toasts: Toast[];
  sheet: Sheet;
  giftTarget: string | "table" | null;
  reportTarget: string | null;
  sideTab: "game" | "chat";

  findRoom: (anyone?: boolean) => Promise<void>;
  cancelSearch: () => void;
  next: () => void;
  leave: () => void;
  backToLobby: () => void;
  shuffleName: () => void;
  openSheet: (s: Sheet, target?: string | "table" | null) => void;
  setSideTab: (t: "game" | "chat") => void;
  toast: (text: string, opts?: { err?: boolean; action?: Toast["action"]; ms?: number }) => void;
  dropEffect: (id: number) => void;
}

const DEFAULT_PREFS: Prefs = {
  theme: window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark",
  bar: true,
  vibe: "fun",
  size: 2,
  drink: "beer",
  ageOk: false,
  sound: true,
};

let mesh: Mesh | null = null;
const DEFAULT_ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
let iceServers: RTCIceServer[] | null = null;
let iceFetchedAt = 0;
// Prefetch TURN/STUN so room:joined can be handled synchronously (no event races).
// TURN credentials expire, so refresh them every few hours while the tab stays open.
function refreshIce() {
  if (Date.now() - iceFetchedAt < 4 * 3600_000) return;
  iceFetchedAt = Date.now();
  void fetchIceServers().then((s) => (iceServers = s));
}
refreshIce();
let fxId = 1;
const glowTimers: Record<string, number> = {};

export const useApp = create<State>((set, get) => ({
  prefs: { ...DEFAULT_PREFS, ...storage.get<Partial<Prefs>>("dy.prefs", {}), ageOk: false },
  setPref: (k, v) => {
    set((s) => ({ prefs: { ...s.prefs, [k]: v } }));
    const { ageOk: _skip, ...persist } = get().prefs;
    storage.set("dy.prefs", persist);
    if (k === "sound") sfx.setSound(Boolean(v));
  },

  connected: false,
  online: 0,
  me: null,
  bannedUntil: 0,

  local: null,
  mic: true,
  cam: true,
  camError: null,
  startCamera: async () => {
    if (get().local) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      set({ local: s, camError: null, mic: true, cam: true });
      return true;
    } catch (e) {
      const name = (e as DOMException)?.name;
      set({
        camError:
          name === "NotAllowedError"
            ? "Camera blocked. Allow camera and mic in your browser settings, then try again."
            : name === "NotFoundError"
              ? "No camera found on this device."
              : "Couldn't start your camera. Is another app using it?",
      });
      return false;
    }
  },
  toggleMic: () => {
    const on = !get().mic;
    get().local?.getAudioTracks().forEach((t) => (t.enabled = on));
    set({ mic: on });
  },
  toggleCam: () => {
    const on = !get().cam;
    get().local?.getVideoTracks().forEach((t) => (t.enabled = on));
    set({ cam: on });
  },

  screen: "lobby",
  searchSince: 0,
  room: null,
  streams: {},
  conn: {},
  chat: [],
  unread: 0,
  game: null,
  effects: [],
  glows: {},
  met: {},
  recapStats: { seconds: 0, giftsGot: 0, cheersGot: 0, gamesPlayed: 0 },
  toasts: [],
  sheet: null,
  giftTarget: null,
  reportTarget: null,
  sideTab: "game",

  findRoom: async (anyone = false) => {
    const { prefs } = get();
    if (!prefs.ageOk) {
      get().toast("Please confirm you're 18+ first.", { err: true });
      return;
    }
    if (!(await get().startCamera())) return;
    if (!socket.connected) socket.connect();
    teardownRoom(false);
    refreshIce();
    set({ screen: "searching", searchSince: Date.now(), sheet: null });
    socket.emit("queue:join", { vibe: prefs.vibe, drink: prefs.drink, size: prefs.size, ageConfirmed: true, anyone });
  },
  cancelSearch: () => {
    socket.emit("queue:leave");
    set({ screen: "lobby" });
  },
  next: () => {
    socket.emit("room:leave");
    teardownRoom(false);
    void get().findRoom();
  },
  leave: () => {
    socket.emit("room:leave");
    teardownRoom(true);
  },
  backToLobby: () => set({ screen: "lobby", met: {}, recapStats: { seconds: 0, giftsGot: 0, cheersGot: 0, gamesPlayed: 0 } }),
  shuffleName: () => {
    if (!socket.connected) socket.connect();
    socket.emit("name:shuffle", (handle) => set((s) => ({ me: s.me ? { ...s.me, handle } : s.me })));
  },
  openSheet: (sheet, target = null) =>
    set((s) => ({
      sheet,
      giftTarget: sheet === "gift" ? target : s.giftTarget,
      reportTarget: sheet === "report" ? (target as string | null) : s.reportTarget,
      unread: sheet === "chat" ? 0 : s.unread,
    })),
  setSideTab: (t) => set((s) => ({ sideTab: t, unread: t === "chat" ? 0 : s.unread })),
  toast: (text, opts = {}) => {
    const id = fxId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, err: opts.err, action: opts.action }] }));
    window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), opts.ms ?? 4000);
  },
  dropEffect: (id) => set((s) => ({ effects: s.effects.filter((e) => e.id !== id) })),
}));

// ─── Room lifecycle helpers ──────────────────────────────────────────────────
function teardownRoom(toRecap: boolean) {
  const s = useApp.getState();
  mesh?.closeAll();
  mesh = null;
  if (s.room) {
    const now = Date.now();
    const met = { ...s.met };
    for (const id of Object.keys(met)) {
      if (!met[id].seconds) met[id] = { ...met[id], seconds: Math.round((now - met[id].joinedAt) / 1000) };
    }
    useApp.setState({
      met,
      recapStats: { ...s.recapStats, seconds: s.recapStats.seconds + Math.round((now - s.room.startedAt) / 1000) },
    });
  }
  useApp.setState({
    room: null, streams: {}, conn: {}, chat: [], unread: 0, game: null, effects: [], glows: {}, sheet: null,
    screen: toRecap ? "recap" : useApp.getState().screen,
  });
}

function addPeer(p: PeerInfo, initiate: boolean) {
  const s = useApp.getState();
  if (!s.room) return;
  useApp.setState({
    room: { ...s.room, peers: [...s.room.peers.filter((x) => x.id !== p.id), p] },
    met: {
      ...s.met,
      [p.id]: s.met[p.id] ?? { id: p.id, handle: p.handle, drink: p.drink, iCheered: false, theyCheered: false, mutualToken: null, seconds: 0, joinedAt: Date.now() },
    },
  });
  mesh?.add(p.id, initiate);
}

function sys(text: string) {
  useApp.setState((s) => ({ chat: [...s.chat, { from: "sys", handle: "", text, ts: Date.now(), sys: true }].slice(-200) }));
}

function glow(id: string, tier: TierIndex) {
  useApp.setState((s) => ({ glows: { ...s.glows, [id]: tier } }));
  window.clearTimeout(glowTimers[id]);
  glowTimers[id] = window.setTimeout(() => {
    useApp.setState((s) => {
      const g = { ...s.glows };
      delete g[id];
      return { glows: g };
    });
  }, 3500);
}

export function handleOf(id: string): string {
  const s = useApp.getState();
  if (s.room?.you.id === id) return "You";
  return s.room?.peers.find((p) => p.id === id)?.handle ?? s.met[id]?.handle ?? "Someone";
}

// ─── Socket wiring ───────────────────────────────────────────────────────────
export function wireSocket() {
  const set = useApp.setState;
  const get = useApp.getState;

  socket.on("connect", () => set({ connected: true }));
  socket.on("disconnect", () => {
    set({ connected: false });
    if (get().room || get().screen === "searching") {
      teardownRoom(false);
      set({ screen: "lobby" });
      get().toast("Connection lost. Reconnecting…", { err: true });
    }
  });
  socket.on("connect_error", (err: Error & { data?: { until?: number } }) => {
    if (err.message === "banned") {
      set({ bannedUntil: err.data?.until ?? Date.now() + 3600_000 });
      socket.disconnect();
    } else if (err.message === "too_many_connections") {
      get().toast("Too many connections from your network. Wait a minute.", { err: true });
    }
  });
  socket.on("hello", (me) => set({ me }));
  socket.on("online-count", (n) => set({ online: n }));
  socket.on("error", (e) => {
    get().toast(e.message, { err: true });
    if (["bad_request", "age", "busy"].includes(e.code)) set({ screen: "lobby" });
  });
  socket.on("waiting", () => set({ screen: "searching" }));
  socket.on("banned", ({ until }) => {
    set({ bannedUntil: until });
    teardownRoom(false);
  });

  // Must stay synchronous: room:peer-joined / signal can arrive right after this.
  socket.on("room:joined", (r: RoomJoined) => {
    mesh?.closeAll();
    mesh = new Mesh(
      iceServers ?? DEFAULT_ICE,
      () => get().local,
      (id, stream) =>
        set((s) => {
          const streams = { ...s.streams };
          if (stream) streams[id] = stream;
          else delete streams[id];
          return { streams };
        }),
      (id, state) => set((s) => ({ conn: { ...s.conn, [id]: state } })),
    );
    set({
      screen: "room",
      room: { id: r.roomId, size: r.size, vibe: r.vibe, you: r.you, peers: [], startedAt: Date.now() },
      chat: [], game: null, effects: [], glows: {}, met: get().screen === "recap" ? {} : get().met,
    });
    sys(r.peers.length ? `You joined ${r.peers.length === 1 ? r.peers[0].handle : `${r.peers.length} people`}. Say hi!` : "You're in. Waiting for others to walk in…");
    for (const p of r.peers) addPeer(p, r.initiate.includes(p.id));
    sfx.blip();
  });
  socket.on("room:peer-joined", (p) => {
    addPeer(p, false); // the joiner sends us the offer
    sys(`${p.handle} walked into the yard.`);
    sfx.blip();
  });
  socket.on("room:peer-left", ({ id }) => {
    const s = get();
    if (!s.room) return;
    const p = s.room.peers.find((x) => x.id === id);
    mesh?.remove(id);
    const met = s.met[id] ? { ...s.met, [id]: { ...s.met[id], seconds: Math.round((Date.now() - s.met[id].joinedAt) / 1000) } } : s.met;
    set({ room: { ...s.room, peers: s.room.peers.filter((x) => x.id !== id) }, met });
    if (p) sys(`${p.handle} left.`);
    // 1-on-1: partner left → auto-find the next person (Omegle-style flow).
    if (s.room.size === 2 && get().room?.peers.length === 0) {
      get().toast(`${p?.handle ?? "They"} left. Finding someone new…`);
      get().next();
    }
  });
  socket.on("signal", ({ from, data }) => void mesh?.handleSignal(from, data));

  socket.on("chat:msg", (m) => {
    const s = get();
    const visible = s.sheet === "chat" || (s.sideTab === "chat" && window.innerWidth >= 1024);
    set({ chat: [...s.chat, m].slice(-200), unread: m.from === s.room?.you.id || visible ? s.unread : s.unread + 1 });
  });
  socket.on("react", (r) => set((s) => ({ effects: [...s.effects, { id: fxId++, kind: "react", react: r }] })));

  socket.on("game:state", (g) => {
    const prev = get().game;
    if (g && !prev) {
      sys(`Game starting: ${g.kind.replace(/_/g, " ")}`);
      set((s) => ({ recapStats: { ...s.recapStats, gamesPlayed: s.recapStats.gamesPlayed + 1 } }));
    }
    set({ game: g });
    if (g && prev?.phase !== g.phase && g.phase === "reveal") sfx.blip();
  });

  socket.on("gift:landed", (g) => {
    const s = get();
    const me = s.room?.you.id;
    set({ effects: [...s.effects, { id: fxId++, kind: "gift", gift: g }] });
    g.to.forEach((id) => glow(id, g.tier));
    if (me && g.to.includes(me)) set((st) => ({ recapStats: { ...st.recapStats, giftsGot: st.recapStats.giftsGot + 1 } }));
    sys(`${g.from === me ? "You" : g.fromHandle} sent ${g.round ? "a round of" : ""} ${g.name} to ${g.round ? "the table" : g.to.map(handleOf).join(", ")}.`);
    if (g.tier >= 4) sfx.fanfare();
    else if (g.tier >= 2) sfx.pour(1.2);
    sfx.clink();
  });
  socket.on("gift:clink", (c) => {
    set((s) => ({ effects: [...s.effects, { id: fxId++, kind: "clink", clink: c }] }));
    window.setTimeout(() => sfx.clink(), 600);
  });
  socket.on("wallet", ({ coins }) => set((s) => ({ me: s.me ? { ...s.me, coins } : s.me })));
  socket.on("shelf", (shelf: Shelf) => set((s) => ({ me: s.me ? { ...s.me, shelf } : s.me })));

  socket.on("cheers:received", ({ from, total }) => {
    set((s) => ({
      me: s.me ? { ...s.me, cheers: total } : s.me,
      met: s.met[from] ? { ...s.met, [from]: { ...s.met[from], theyCheered: true } } : s.met,
      recapStats: { ...s.recapStats, cheersGot: s.recapStats.cheersGot + 1 },
    }));
    get().toast(`${handleOf(from)} gave you cheers!`);
    sfx.clink();
  });
  socket.on("cheers:mutual", ({ peerId, handle, token }) => {
    set((s) => ({ met: s.met[peerId] ? { ...s.met, [peerId]: { ...s.met[peerId], mutualToken: token, theyCheered: true, iCheered: true } } : s.met }));
    get().toast(`Mutual cheers with ${handle}! You can call them again for 24h.`);
  });
  socket.on("callagain:invite", ({ token, handle }) => {
    get().toast(`${handle} wants to call you again`, {
      ms: 30_000,
      action: { label: "Join", run: () => socket.emit("callagain:accept", { token }) },
    });
    sfx.fanfare();
  });
  socket.on("callagain:result", (r) => get().toast(r.message, { err: !r.ok }));
  socket.on("report:ok", () => get().toast("Thanks. They won't be matched with you again."));
}

export function giveCheers(id: string) {
  const s = useApp.getState();
  if (!s.met[id] || s.met[id].iCheered) return;
  socket.emit("cheers:give", { to: id });
  useApp.setState({ met: { ...s.met, [id]: { ...s.met[id], iCheered: true } } });
  sfx.clink();
}

export const AVATAR_COLORS = ["#FF6B5B", "#8FB8FF", "#FFC24B", "#C8F560", "#F49BC1", "#B9A4FF"];
export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
export const initials = (h: string) =>
  h
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
