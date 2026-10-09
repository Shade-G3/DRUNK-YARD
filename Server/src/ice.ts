/**
 * ICE servers for WebRTC. STUN finds your public address; TURN relays video when
 * a direct path is impossible (very common on Indian mobile networks / CGNAT).
 *
 * Supported TURN sources (first configured wins):
 *  1. Cloudflare Realtime TURN  — CF_TURN_KEY_ID + CF_TURN_API_TOKEN
 *  2. Metered.ca                — METERED_TURN_URL (full credentials URL incl. apiKey)
 *  3. Your own coturn           — TURN_URLS + TURN_SECRET (use-auth-secret)
 * Credentials are short-lived and fetched server-side; secrets never reach the browser.
 */
import { createHmac, randomBytes } from "crypto";
import { config } from "./config";

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

let cache: { servers: IceServer[]; expires: number } | null = null;
let inflight: Promise<IceServer[] | null> | null = null;

async function cloudflare(): Promise<IceServer[] | null> {
  const { cfTurnKeyId: id, cfTurnApiToken: token, turnTtlSec: ttl } = config;
  if (!id || !token) return null;
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl }),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`Cloudflare TURN ${r.status}`);
  const j = (await r.json()) as { iceServers: IceServer | IceServer[] };
  const list = Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers];
  // Port 53 is blocked by many browsers/networks; drop those URLs.
  return list.map((s) => ({ ...s, urls: ([] as string[]).concat(s.urls).filter((u) => !u.includes(":53")) }));
}

async function metered(): Promise<IceServer[] | null> {
  if (!config.meteredTurnUrl) return null;
  const r = await fetch(config.meteredTurnUrl, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Metered TURN ${r.status}`);
  return (await r.json()) as IceServer[];
}

function coturn(): IceServer[] | null {
  if (!config.turnUrls.length || !config.turnSecret) return null;
  const username = `${Math.floor(Date.now() / 1000) + config.turnTtlSec}:${randomBytes(6).toString("hex")}`;
  const credential = createHmac("sha1", config.turnSecret).update(username).digest("base64");
  return [{ urls: config.turnUrls, username, credential }];
}

async function fetchTurn(): Promise<IceServer[] | null> {
  try {
    return (await cloudflare()) ?? (await metered()) ?? coturn();
  } catch (e) {
    console.warn("[ice] TURN fetch failed:", (e as Error).message);
    return coturn();
  }
}

/** v1's free relay. Media stays end-to-end encrypted (DTLS-SRTP); the relay only forwards packets. */
const PUBLIC_TURN: IceServer = {
  urls: [
    "turn:openrelay.metered.ca:80",
    "turn:openrelay.metered.ca:443",
    "turn:openrelay.metered.ca:443?transport=tcp",
    "turns:openrelay.metered.ca:443",
  ],
  username: "openrelayproject",
  credential: "openrelayproject",
};

export function turnConfigured(): boolean {
  return !!((config.cfTurnKeyId && config.cfTurnApiToken) || config.meteredTurnUrl || (config.turnUrls.length && config.turnSecret));
}

export async function iceServers(): Promise<IceServer[]> {
  const stun: IceServer[] = config.stunUrls.length ? [{ urls: config.stunUrls }] : [];
  const fallback = config.publicTurn ? [PUBLIC_TURN] : [];
  if (!turnConfigured()) return [...stun, ...fallback];
  // Cache shared credentials for half their lifetime (cuts API calls to the provider).
  if (cache && cache.expires > Date.now()) return [...stun, ...cache.servers];
  inflight ??= fetchTurn().finally(() => (inflight = null));
  const turn = await inflight;
  if (turn?.length) cache = { servers: turn, expires: Date.now() + (config.turnTtlSec * 1000) / 2 };
  return [...stun, ...(turn?.length ? turn : fallback)];
}
