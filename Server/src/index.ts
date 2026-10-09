import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import helmet from "helmet";
import compression from "compression";
import { Server } from "socket.io";
import type { IncomingMessage } from "http";
import { config } from "./config";
import { Store } from "./store";
import { Hub, isUuid } from "./hub";
import { IpWindow } from "./limiter";
import { iceServers, turnConfigured } from "./ice";
import type { ClientToServer, ServerToClient } from "./shared/protocol";

// ─── Real client IP (spoof-resistant) ──────────────────────────────────────
// Only trust X-Forwarded-For entries added by OUR proxies: take the Nth entry from the right.
export function clientIp(req: IncomingMessage): string {
  const hops = config.trustProxyHops;
  const xff = req.headers["x-forwarded-for"];
  if (hops > 0 && typeof xff === "string") {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const ip = parts[parts.length - hops];
    if (ip) return ip;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return !config.isProd; // browsers always send Origin for WebSockets
  if (config.allowedOrigins.includes(origin)) return true;
  if (host && (origin === `https://${host}` || origin === `http://${host}`)) return true; // same-origin deploy
  if (!config.isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

// ─── HTTP ───────────────────────────────────────────────────────────────────
const app = express();
app.disable("x-powered-by");
if (config.trustProxyHops > 0) app.set("trust proxy", config.trustProxyHops);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "blob:"],
        "media-src": ["'self'", "blob:"],
        "connect-src": ["'self'", "wss:", "ws:", ...config.allowedOrigins],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": config.isProd ? [] : null,
      },
    },
    hsts: config.isProd,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(compression());
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Short-lived TURN credentials (coturn --use-auth-secret). No static passwords in the client.
const iceLimiter = new IpWindow(30, 60_000);
app.get("/api/ice", async (req, res) => {
  if (!iceLimiter.allow(clientIp(req))) return res.status(429).json({ error: "rate" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ iceServers: await iceServers() });
});

// Serve the built React app (single-service deploy).
const distCandidates = [config.clientDist, path.resolve(__dirname, "../../Client/dist")].filter(Boolean);
const dist = distCandidates.find((p) => fs.existsSync(path.join(p, "index.html")));
if (dist) {
  app.use(express.static(dist, { maxAge: "1h", index: false }));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  console.log(`Serving client from ${dist}`);
}

// ─── Socket.IO ──────────────────────────────────────────────────────────────
const server = http.createServer(app);
const io = new Server<ClientToServer, ServerToClient>(server, {
  maxHttpBufferSize: 32_000, // SDPs are ~5–10 KB; nothing legit is bigger
  pingInterval: 10_000,
  pingTimeout: 20_000,
  connectTimeout: 15_000,
  allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin, req.headers.host)),
});

const store = new Store();
const hub = new Hub(io, store);
const connWindow = new IpWindow(config.maxConnectionsPerIpPerMin, 60_000);

io.use((socket, next) => {
  const ip = clientIp(socket.request);
  const deviceId = socket.handshake.auth?.deviceId;
  if (!isUuid(deviceId)) return next(new Error("bad_device"));
  if (!connWindow.allow(ip)) return next(new Error("too_many_connections"));
  const until = store.banUntil(deviceId, ip);
  if (until) {
    const err = new Error("banned") as Error & { data?: unknown };
    err.data = { until };
    return next(err);
  }
  socket.data.deviceId = deviceId;
  socket.data.ip = ip;
  next();
});

io.on("connection", (socket) => hub.attach(socket));

server.listen(config.port, () => {
  console.log(`🍻 Drunk Yard server on :${config.port}`);
  if (!turnConfigured())
    console.log(
      config.publicTurn
        ? "ℹ Using the free public TURN relay (openrelay.metered.ca). Fine to start; add your own TURN for reliability (README → TURN)."
        : "⚠ No TURN server — video will fail for many mobile users. See README → TURN.",
    );
});

const shutdown = () => {
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
