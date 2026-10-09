import { io, Socket } from "socket.io-client";
import type { ClientToServer, ServerToClient } from "@shared/protocol";
import { deviceId } from "./storage";

export type AppSocket = Socket<ServerToClient, ClientToServer>;

/**
 * Same-origin by default (Vite proxies /socket.io in dev; the Node server serves the
 * built app in prod). Set VITE_SERVER_URL only if the client is hosted elsewhere.
 */
const URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || undefined;

export const socket: AppSocket = io(URL as string, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  auth: { deviceId: deviceId() },
  reconnectionDelay: 1000,
  reconnectionDelayMax: 6000,
});

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const base = URL ?? "";
    const r = await fetch(`${base}/api/ice`, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { iceServers: RTCIceServer[] };
    if (Array.isArray(j.iceServers) && j.iceServers.length) return j.iceServers;
  } catch {
    /* fall through */
  }
  return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
}
