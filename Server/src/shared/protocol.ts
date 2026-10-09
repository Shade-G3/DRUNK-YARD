/**
 * Shared protocol between Server and Client.
 * Client imports this file directly (see Client/vite.config.ts alias "@shared").
 * Keep it dependency-free.
 */

// ─── Taxonomy ────────────────────────────────────────────────────────────────
export const VIBES = ["chill", "deep", "fun", "flirt", "rant", "creative", "any"] as const;
export type Vibe = (typeof VIBES)[number];

export const VIBE_LABEL: Record<Vibe, string> = {
  chill: "Chill",
  deep: "Deep talk",
  fun: "Just fun",
  flirt: "Flirty",
  rant: "Rant",
  creative: "Creative",
  any: "Surprise me",
};

export const DRINKS = ["whisky", "rum", "vodka", "wine", "beer", "sober"] as const;
export type Drink = (typeof DRINKS)[number];

export const DRINK_LABEL: Record<Drink, string> = {
  whisky: "Whisky",
  rum: "Rum",
  vodka: "Vodka",
  wine: "Wine",
  beer: "Beer",
  sober: "Sober",
};

export const MIN_ROOM = 2;
export const MAX_ROOM = 6;
export type RoomSize = 2 | 3 | 4 | 5 | 6;

export const REACTIONS = ["cheers", "laugh", "fire", "heart"] as const;
export type Reaction = (typeof REACTIONS)[number];

export const REPORT_REASONS = ["nudity", "minor", "harassment", "hate", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// ─── Drink gifting ───────────────────────────────────────────────────────────
// Own product names on purpose: real liquor brand names/logos are a trademark +
// Indian surrogate-advertising risk. The label-colour ladder is the familiar part.
export const GIFT_CATEGORIES = ["whisky", "rum", "vodka", "wine", "beer", "zero"] as const;
export type GiftCategory = (typeof GIFT_CATEGORIES)[number];

export const GIFT_CATEGORY_LABEL: Record<GiftCategory, string> = {
  whisky: "Whisky",
  rum: "Rum",
  vodka: "Vodka",
  wine: "Wine",
  beer: "Beer",
  zero: "Chai+",
};

export const TIERS = ["red", "black", "green", "gold", "blue"] as const;
export type Tier = (typeof TIERS)[number];
export type TierIndex = 0 | 1 | 2 | 3 | 4;

export interface TierMeta {
  id: Tier;
  label: string;
  price: number; // coins per recipient
  color: string; // label colour
  ink: string; // text on label colour
  effect: string;
}

export const TIER_META: TierMeta[] = [
  { id: "red", label: "RED", price: 0, color: "#C0392B", ink: "#FFFFFF", effect: "Clink sound + their tile glows red" },
  { id: "black", label: "BLACK", price: 10, color: "#0A0806", ink: "#F3E6D3", effect: "Bottle slides across to their tile" },
  { id: "green", label: "GREEN", price: 50, color: "#1F6B3A", ink: "#FFFFFF", effect: "Slow pour on their video" },
  { id: "gold", label: "GOLD", price: 200, color: "#C9A227", ink: "#1A120B", effect: "Gold dust + shout-out to the room" },
  { id: "blue", label: "BLUE", price: 1000, color: "#2A56B8", ink: "#FFFFFF", effect: "Full-screen moment for everyone + shelf trophy" },
];

export const GIFT_LADDER: Record<GiftCategory, [string, string, string, string, string]> = {
  whisky: ["Peg", "Double Peg", "Single Malt 12", "Reserve 18", "Crystal 25"],
  rum: ["Shot", "Spiced", "Dark Reserve", "XO", "Solera Cask"],
  vodka: ["Shot", "On the rocks", "Premium", "Ice Crystal", "Platinum"],
  wine: ["Glass", "Bottle", "Reserve", "Grand Cru", "Vintage"],
  beer: ["Pint", "Pitcher", "Craft Flight", "Keg", "Brewmaster Barrel"],
  zero: ["Cutting Chai", "Cold Coffee", "Mocktail", "Signature Mocktail", "Golden Latte"],
};

export const DAILY_FREE_COINS = 300;
export const STARTING_COINS = 1500; // enough for one Blue-tier moment on day one

// ─── Games ───────────────────────────────────────────────────────────────────
export const GAME_KINDS = [
  "this_or_that",
  "most_likely",
  "never_have_i_ever",
  "two_truths",
  "red_green",
  "would_you_rather",
  "truth_or_dare",
] as const;
export type GameKind = (typeof GAME_KINDS)[number];

export interface GameMeta {
  kind: GameKind;
  name: string;
  short: string;
  desc: string;
  min: number;
  color: string;
}

export const GAME_META: Record<GameKind, GameMeta> = {
  this_or_that: { kind: "this_or_that", name: "This or That", short: "TT", desc: "Rapid picks, see who matches", min: 2, color: "#C8F560" },
  most_likely: { kind: "most_likely", name: "Who's Most Likely To", short: "ML", desc: "Everyone votes for someone", min: 3, color: "#FFC24B" },
  never_have_i_ever: { kind: "never_have_i_ever", name: "Never Have I Ever", short: "NH", desc: "Fingers down, live counter", min: 2, color: "#8FB8FF" },
  two_truths: { kind: "two_truths", name: "Two Truths & a Lie", short: "2L", desc: "Spot the lie, earn points", min: 2, color: "#FF6B5B" },
  red_green: { kind: "red_green", name: "Red Flag / Green Flag", short: "RG", desc: "Judge the dating takes", min: 2, color: "#F49BC1" },
  would_you_rather: { kind: "would_you_rather", name: "Would You Rather", short: "WR", desc: "Pick a side, defend it", min: 2, color: "#B9A4FF" },
  truth_or_dare: { kind: "truth_or_dare", name: "Truth or Dare", short: "TD", desc: "Spicy pack in Flirty rooms only", min: 2, color: "#F4F1EA" },
};

export type GamePhase = "lobby" | "compose" | "question" | "reveal" | "done";

/** What the client renders. Server sends a fresh snapshot on every change. */
export interface GameView {
  kind: GameKind;
  phase: GamePhase;
  round: number;
  totalRounds: number;
  deadline: number; // epoch ms
  ready: string[]; // socket ids
  prompt: string;
  options: string[]; // button labels (for player-vote games: empty; client uses players)
  answeredBy: string[]; // who already answered (values hidden until reveal)
  myAnswer: string | null;
  turn: string | null; // socket id whose turn it is (truth/dare, two truths author)
  reveal: { answers: Record<string, string>; note: string } | null;
  scores: Record<string, number>;
  spicy: boolean;
}

// ─── Wire types ──────────────────────────────────────────────────────────────
export interface PeerInfo {
  id: string; // socket id (room-scoped identity)
  handle: string;
  drink: Drink;
  vibe: Vibe;
  cheers: number; // lifetime cheers received (in-memory for now)
}

export interface JoinRequest {
  vibe: Vibe;
  drink: Drink;
  size: RoomSize;
  ageConfirmed: boolean;
  anyone?: boolean; // fallback: ignore vibe
}

export interface RoomJoined {
  roomId: string;
  size: RoomSize;
  vibe: Vibe;
  you: PeerInfo;
  peers: PeerInfo[];
  /** Peers this client must send WebRTC offers to (later joiner always offers). */
  initiate: string[];
}

export interface GiftLanded {
  from: string;
  fromHandle: string;
  to: string[];
  toHandles: string[];
  category: GiftCategory;
  tier: TierIndex;
  name: string;
  round: boolean;
  ts: number;
}

export interface ChatMsg {
  from: string;
  handle: string;
  text: string;
  ts: number;
}

export interface Shelf {
  /** counts per tier index, received drinks */
  tiers: [number, number, number, number, number];
  total: number;
}

export interface Me {
  handle: string;
  coins: number;
  shelf: Shelf;
  cheers: number;
}

export type SignalData =
  | { type: "offer" | "answer"; sdp: string }
  | { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null };

export interface ServerToClient {
  hello: (me: Me) => void;
  "online-count": (n: number) => void;
  error: (e: { code: string; message: string }) => void;
  waiting: (w: { since: number }) => void;
  "room:joined": (r: RoomJoined) => void;
  "room:peer-joined": (p: PeerInfo) => void;
  "room:peer-left": (p: { id: string }) => void;
  signal: (s: { from: string; data: SignalData }) => void;
  "chat:msg": (m: ChatMsg) => void;
  react: (r: { from: string; kind: Reaction }) => void;
  "game:state": (g: GameView | null) => void;
  "gift:landed": (g: GiftLanded) => void;
  "gift:clink": (c: { a: string; b: string }) => void;
  wallet: (w: { coins: number }) => void;
  shelf: (s: Shelf) => void;
  "cheers:received": (c: { from: string; total: number }) => void;
  "cheers:mutual": (c: { peerId: string; handle: string; token: string }) => void;
  "callagain:invite": (c: { token: string; handle: string }) => void;
  "callagain:result": (c: { ok: boolean; message: string }) => void;
  "report:ok": () => void;
  banned: (b: { until: number }) => void;
}

export interface ClientToServer {
  "queue:join": (j: JoinRequest) => void;
  "queue:leave": () => void;
  "room:leave": () => void;
  "name:shuffle": (cb: (handle: string) => void) => void;
  signal: (s: { to: string; data: SignalData }) => void;
  "chat:send": (m: { text: string }) => void;
  react: (r: { kind: Reaction }) => void;
  "game:propose": (g: { kind: GameKind }) => void;
  "game:ready": () => void;
  "game:answer": (a: { value: string; statements?: string[] }) => void;
  "game:stop": () => void;
  "gift:send": (g: { category: GiftCategory; tier: TierIndex; to: string | "table" }) => void;
  "cheers:give": (c: { to: string }) => void;
  "callagain:request": (c: { token: string }) => void;
  "callagain:accept": (c: { token: string }) => void;
  report: (r: { peerId: string; reason: ReportReason }) => void;
}

export const LIMITS = {
  chatMax: 300,
  statementMax: 90,
} as const;
