/**
 * Token-bucket rate limiter. One bucket per (socket, event).
 * capacity = burst size, refillPerSec = sustained rate.
 */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private capacity: number, private refillPerSec: number) {
    this.tokens = capacity;
  }
  take(cost = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Per-event limits. Anything not listed falls back to "default". */
const LIMITS: Record<string, [number, number]> = {
  default: [20, 5],
  "queue:join": [6, 0.5], // stops join-spam CPU DoS
  "queue:leave": [10, 1],
  "room:leave": [10, 1],
  signal: [300, 60], // ICE trickle is bursty
  "chat:send": [8, 1],
  react: [6, 2],
  "gift:send": [6, 1],
  "game:answer": [10, 2],
  "game:propose": [3, 0.2],
  report: [3, 0.05],
  "name:shuffle": [5, 0.5],
  "callagain:request": [3, 0.1],
};

export class SocketLimiter {
  private buckets = new Map<string, TokenBucket>();
  allow(event: string): boolean {
    let b = this.buckets.get(event);
    if (!b) {
      const [cap, rate] = LIMITS[event] ?? LIMITS.default;
      b = new TokenBucket(cap, rate);
      this.buckets.set(event, b);
    }
    return b.take();
  }
}

/** Sliding-window connection counter per IP. */
export class IpWindow {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {
    setInterval(() => this.sweep(), windowMs).unref();
  }
  allow(ip: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(ip, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(ip, arr);
    return true;
  }
  private sweep() {
    const now = Date.now();
    for (const [ip, arr] of this.hits) {
      const kept = arr.filter((t) => now - t < this.windowMs);
      if (kept.length) this.hits.set(ip, kept);
      else this.hits.delete(ip);
    }
  }
}
