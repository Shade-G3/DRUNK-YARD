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
  private reports = new Map<string, Map<string, { ts: number; ip: string; counts: boolean }>>(); // target → reporter → info
  private freshByIp = new Map<string, number[]>(); // ip → timestamps of new accounts
  /** Recent reports for human review (wire to an admin panel / ticketing later). */
  readonly reviewQueue: { ts: number; reporter: string; target: string; reason: string; counted: boolean }[] = [];
  private avoid = new Map<string, Set<string>>(); // deviceId → deviceIds never to match again (reported/blocked)
  private mutuals = new Map<string, Mutual>();

  constructor() {
    setInterval(() => this.sweep(), 10 * 60_000).unref();
  }

  account(deviceId: string, ip?: string): Account {
    let a = this.accounts.get(deviceId);
    if (a) {
      // LRU touch: re-insert so the least recently used accounts sit at the front.
      this.accounts.delete(deviceId);
      this.accounts.set(deviceId, a);
    } else {
      a = { coins: this.freshCoins(ip), lastGrantDay: today(), shelf: { tiers: [0, 0, 0, 0, 0], total: 0 }, cheers: 0 };
      this.accounts.set(deviceId, a);
      while (this.accounts.size > config.maxAccounts) this.accounts.delete(this.accounts.keys().next().value!);
    }
    if (a.lastGrantDay !== today()) {
      a.coins += DAILY_FREE_COINS;
      a.lastGrantDay = today();
    }
    return a;
  }

  /** Starting coins only for the first few new device IDs per IP per day (anti-farming). */
  private freshCoins(ip?: string): number {
    if (!ip) return 0;
    const dayAgo = Date.now() - 24 * 3600_000;
    const list = (this.freshByIp.get(ip) ?? []).filter((t) => t > dayAgo);
    list.push(Date.now());
    this.freshByIp.set(ip, list);
    return list.length <= config.freshAccountsPerIpPerDay ? STARTING_COINS : 0;
  }

  spend(deviceId: string, amount: number): boolean {
    const a = this.account(deviceId);
    if (a.coins < amount) return false;
    a.coins -= amount;
    return true;
  }

  /** Right to erasure. Bans/reports are kept (legal basis: safety + legal obligations). */
  deleteAccount(deviceId: string) {
    this.accounts.delete(deviceId);
    this.avoid.delete(deviceId);
    for (const [k, m] of this.mutuals) if (m.a === deviceId || m.b === deviceId) this.mutuals.delete(k);
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

  /**
   * Record a report. Returns ban expiry if it tipped the target over the threshold.
   * A ban needs N reporters from N DIFFERENT IPs who each actually spent time with the target —
   * so one person with several tabs, or drive-by instant reports, can't get someone banned.
   */
  report(reporter: string, reporterIp: string, target: string, targetIp: string, reason: string, counts: boolean): number {
    if (reporter === target) return 0;
    this.block(reporter, target);
    this.reviewQueue.push({ ts: Date.now(), reporter, target, reason, counted: counts });
    if (this.reviewQueue.length > 5000) this.reviewQueue.splice(0, this.reviewQueue.length - 5000);
    let m = this.reports.get(target);
    if (!m) this.reports.set(target, (m = new Map()));
    m.set(reporter, { ts: Date.now(), ip: reporterIp, counts });
    const dayAgo = Date.now() - 24 * 3600_000;
    const valid = [...m.values()].filter((r) => r.counts && r.ts > dayAgo);
    const distinctIps = new Set(valid.map((r) => r.ip)).size;
    if (valid.length >= config.reportsToBan && distinctIps >= config.reportsToBan) {
      const until = Date.now() + config.banHours * 3600_000;
      this.bansDevice.set(target, until);
      // IP bans are blunt (shared Jio/Airtel CGNAT IPs!) — keep them short.
      this.bansIp.set(targetIp, Date.now() + 30 * 60_000);
      return until;
    }
    return 0;
  }

  block(a: string, b: string) {
    if (!this.avoid.has(a)) {
      if (this.avoid.size > config.maxAccounts) this.avoid.delete(this.avoid.keys().next().value!);
      this.avoid.set(a, new Set());
    }
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
    const dayAgo = now - 24 * 3600_000;
    for (const [ip, list] of this.freshByIp) {
      const kept = list.filter((t) => t > dayAgo);
      if (kept.length) this.freshByIp.set(ip, kept);
      else this.freshByIp.delete(ip);
    }
    for (const [target, m] of this.reports) {
      for (const [r, info] of m) if (info.ts < dayAgo) m.delete(r);
      if (!m.size) this.reports.delete(target);
    }
  }
}
