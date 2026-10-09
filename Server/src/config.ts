/** All runtime knobs in one place. Override with environment variables. */
const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 3000),
  isProd: process.env.NODE_ENV === "production",

  /** Comma-separated list of allowed browser origins. Empty in dev = allow localhost. */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  /**
   * How many reverse proxies sit in front of the app (Render/Railway/Fly = 1, Cloudflare + Render = 2).
   * Used to read the REAL client IP from X-Forwarded-For (right-most trusted hop),
   * so attackers can't spoof the header to dodge IP limits.
   */
  trustProxyHops: num(process.env.TRUST_PROXY_HOPS, 0),

  maxConnectionsPerIpPerMin: num(process.env.MAX_CONN_PER_IP_PER_MIN, 30),
  maxQueueSize: num(process.env.MAX_QUEUE_SIZE, 2000),

  /** STUN/TURN. TURN_URLS="turn:turn.example.com:3478,turns:turn.example.com:5349" */
  stunUrls: (process.env.STUN_URLS ?? "stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  turnUrls: (process.env.TURN_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  /** coturn "use-auth-secret" shared secret → short-lived HMAC credentials (never ship static TURN passwords). */
  turnSecret: process.env.TURN_SECRET ?? "",
  turnTtlSec: num(process.env.TURN_TTL_SEC, 24 * 3600),
  /** Cloudflare Realtime TURN (dash.cloudflare.com → Realtime → TURN Server). */
  cfTurnKeyId: process.env.CF_TURN_KEY_ID ?? "",
  cfTurnApiToken: process.env.CF_TURN_API_TOKEN ?? "",
  /** Metered.ca: full URL, e.g. https://<app>.metered.live/api/v1/turn/credentials?apiKey=... */
  meteredTurnUrl: process.env.METERED_TURN_URL ?? "",

  reportsToBan: num(process.env.REPORTS_TO_BAN, 3),
  banHours: num(process.env.BAN_HOURS, 24),

  /** Serve the built React app from ../Client/dist when present (single-service deploy). */
  clientDist: process.env.CLIENT_DIST ?? "",
};
