/**
 * In-memory persistence. Everything here is lost on restart — swap this class for a
 * Redis/Postgres-backed one before running more than one server instance.
 * Keyed by deviceId (random UUID the browser keeps in localStorage).
 */
import { randomUUID } from "crypto";
import { DAILY_FREE_COINS, STARTING_COINS, Shelf, TierIndex } from "./shared/protocol";
import { config } from "./config";

interface Account {
  coins: number;
  lastGrantDay: string;
  shelf: Shelf;
  cheers: number;
}

interface Mutual {
  token: string;
  a: string; // deviceId
  b: string;
  handles: Record<string, string>;
  expires: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export class Store {
  private accounts = new Map<string, Account>();
  private bansDevice = new Map<string, number>(); // deviceId → until
  private bansIp = new Map<string, number>();
  private reports = new Map<string, Map<string, number>>(); // target deviceId → reporter deviceId → ts
  private avoid = new Map<string, Set<string>>(); // deviceId → deviceIds never to match again (reported/blocked)
  private mutuals = new Map<string, Mutual>();

  constructor() {
    setInterval(() => this.sweep(), 10 * 60_000).unref();
  }

  account(deviceId: string): Account {
    let a = this.accounts.get(deviceId);
    if (!a) {
      a = { coins: STARTING_COINS, lastGrantDay: today(), shelf: { tiers: [0, 0, 0, 0, 0], total: 0 }, cheers: 0 };
      this.accounts.set(deviceId, a);
    }
    if (a.lastGrantDay !== today()) {
      a.coins += DAILY_FREE_COINS;
      a.lastGrantDay = today();
    }
    return a;
  }

  spend(deviceId: string, amount: number): boolean {
    const a = this.account(deviceId);
    if (a.coins < amount) return false;
    a.coins -= amount;
    return true;
  }

  addToShelf(deviceId: string, tier: TierIndex) {
    const a = this.account(deviceId);
    a.shelf.tiers[tier] += 1;
    a.shelf.total += 1;
  }

  addCheers(deviceId: string): number {
    const a = this.account(deviceId);
    a.cheers += 1;
    return a.cheers;
  }

  // ── Bans & reports ────────────────────────────────────────────────────────
  banUntil(deviceId: string, ip: string): number {
    const now = Date.now();
    const d = this.bansDevice.get(deviceId) ?? 0;
    const i = this.bansIp.get(ip) ?? 0;
    const until = Math.max(d, i);
    return until > now ? until : 0;
  }

  /** Returns ban expiry if this report tipped the target over the threshold. */
  report(reporter: string, target: string, targetIp: string): number {
    if (reporter === target) return 0;
    this.block(reporter, target);
    let m = this.reports.get(target);
    if (!m) this.reports.set(target, (m = new Map()));
    m.set(reporter, Date.now());
    const dayAgo = Date.now() - 24 * 3600_000;
    const distinct = [...m.values()].filter((t) => t > dayAgo).length;
    if (distinct >= config.reportsToBan) {
      const until = Date.now() + config.banHours * 3600_000;
      this.bansDevice.set(target, until);
      // IP bans are blunt (shared Jio/Airtel CGNAT IPs!) — keep them short.
      this.bansIp.set(targetIp, Date.now() + 30 * 60_000);
      return until;
    }
    return 0;
  }

  block(a: string, b: string) {
    if (!this.avoid.has(a)) this.avoid.set(a, new Set());
    this.avoid.get(a)!.add(b);
  }

  isBlocked(a: string, b: string): boolean {
    return !!(this.avoid.get(a)?.has(b) || this.avoid.get(b)?.has(a));
  }

  // ── Mutual cheers → call again within 24h ─────────────────────────────────
  addMutual(a: string, b: string, handles: Record<string, string>): string {
    for (const m of this.mutuals.values()) {
      if ((m.a === a && m.b === b) || (m.a === b && m.b === a)) {
        m.expires = Date.now() + 24 * 3600_000;
        m.handles = handles;
        return m.token;
      }
    }
    const token = randomUUID();
    this.mutuals.set(token, { token, a, b, handles, expires: Date.now() + 24 * 3600_000 });
    return token;
  }

  mutual(token: string): Mutual | null {
    const m = this.mutuals.get(token);
    if (!m || m.expires < Date.now()) return null;
    return m;
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.bansDevice) if (v < now) this.bansDevice.delete(k);
    for (const [k, v] of this.bansIp) if (v < now) this.bansIp.delete(k);
    for (const [k, m] of this.mutuals) if (m.expires < now) this.mutuals.delete(k);
  }
}
