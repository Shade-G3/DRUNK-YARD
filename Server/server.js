const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");
const cors    = require("cors");
const helmet  = require("helmet");
const path    = require("path");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim())
  : [
      "http://localhost:3000",
      "http://localhost:5500",
      "https://drunk-yard.onrender.com",
      // add your Vercel/Netlify/GitHub-Pages frontend URL here
    ];

const MAX_MESSAGE_LENGTH     = 500;
const MAX_QUEUE_SIZE         = 200;
const RATE_LIMIT_WINDOW      = 10_000;  // 10 s
const RATE_LIMIT_MAX_MSGS    = 20;
const MAX_CONNECTIONS_PER_IP = 5;
const MAX_ROOM_SIZE          = 6;
const QUEUE_TIMEOUT_MS       = 120_000; // 2 min
const IP_CONN_WINDOW_MS      = 60_000;

// ─── FILTER TAXONOMY ───────────────────────────────────────────────────────
const VALID_DRINKS = new Set(["whisky", "rum", "vodka", "wine", "beer", "sober", "any"]);
const VALID_VIBES  = new Set(["chill", "deep-talk", "research", "fun", "flirt", "rant", "creative", "any"]);
const VALID_MODES  = new Set(["solo", "group"]);

function isValidFilters({ drink, vibe, mode }) {
  return (
    typeof drink === "string" && VALID_DRINKS.has(drink) &&
    typeof vibe  === "string" && VALID_VIBES.has(vibe)  &&
    typeof mode  === "string" && VALID_MODES.has(mode)
  );
}

function queueKey({ drink, vibe, mode }) {
  return `${drink}__${vibe}__${mode}`;
}

// ─── STATE ─────────────────────────────────────────────────────────────────
let onlineUsers = 0;

// queues[key] = [socket, ...]
const queues = {};

// rooms[roomId] = { sockets: Set<socketId>, mode, key }
const rooms = {};

// ipConnections[ip] = [timestamp, ...]
const ipConnections = {};

function getQueue(key) {
  if (!queues[key]) queues[key] = [];
  return queues[key];
}

// ─── EXPRESS ───────────────────────────────────────────────────────────────
const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error("CORS: origin not allowed"));
  },
  methods: ["GET"],
}));

app.use(express.static(path.join(__dirname, "public")));
app.set("trust proxy", 1);

app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime(), ts: Date.now() }));

app.get("/stats", (_req, res) => {
  const qStats = {};
  for (const [k, q] of Object.entries(queues)) {
    if (q.length) qStats[k] = q.length;
  }
  res.json({ online: onlineUsers, activeRooms: Object.keys(rooms).length, queues: qStats });
});

// ─── SOCKET.IO ─────────────────────────────────────────────────────────────
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  pingTimeout: 25_000,
  pingInterval: 10_000,
  maxHttpBufferSize: 1e5,
  connectTimeout: 20_000,
});

server.setTimeout(60_000);

// ─── HELPERS ───────────────────────────────────────────────────────────────
const safeDecrement = n => Math.max(0, n - 1);

function removeFromQueue(socket) {
  const key = socket.data.queueKey;
  if (!key || !queues[key]) return;
  queues[key] = queues[key].filter(s => s.id !== socket.id);
  if (queues[key].length === 0) delete queues[key];
}

function cleanupSocket(socket, isNext = false) {
  if (socket.data.queueTimer) {
    clearTimeout(socket.data.queueTimer);
    socket.data.queueTimer = null;
  }

  removeFromQueue(socket);

  const roomId = socket.data.roomId;
  if (roomId && rooms[roomId]) {
    const room = rooms[roomId];
    room.sockets.delete(socket.id);
    socket.leave(roomId);
    socket.data.roomId = null;

    socket.to(roomId).emit("peer-left", { peerId: socket.id });

    if (room.sockets.size === 0) {
      delete rooms[roomId];
    } else {
      console.log(`Room ${roomId}: ${room.sockets.size} members remaining`);
    }
  }

  if (!isNext) {
    onlineUsers = safeDecrement(onlineUsers);
    io.emit("online-count", onlineUsers);
  }
}

// ─── IP RATE LIMITING ──────────────────────────────────────────────────────
function checkIpLimit(ip) {
  const now = Date.now();
  if (!ipConnections[ip]) ipConnections[ip] = [];
  ipConnections[ip] = ipConnections[ip].filter(t => now - t < IP_CONN_WINDOW_MS);
  if (ipConnections[ip].length >= MAX_CONNECTIONS_PER_IP) return false;
  ipConnections[ip].push(now);
  return true;
}

// ─── SOLO MATCH ────────────────────────────────────────────────────────────
function trySoloMatch(socket, key) {
  const queue = getQueue(key);
  if (queue.length === 0) return false;

  const partner = queue.shift();
  if (queue.length === 0) delete queues[key];

  const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  socket.data.roomId  = roomId;
  partner.data.roomId = roomId;
  rooms[roomId] = { sockets: new Set([socket.id, partner.id]), mode: "solo", key };

  socket.join(roomId);
  partner.join(roomId);

  io.to(socket.id).emit("matched",  { roomId, role: "caller",   mode: "solo", peers: [partner.id], filters: socket.data.filters });
  io.to(partner.id).emit("matched", { roomId, role: "receiver", mode: "solo", peers: [socket.id],  filters: partner.data.filters });

  console.log(`✅ Solo: ${socket.id.slice(0,8)} ↔ ${partner.id.slice(0,8)} [${key}]`);
  return true;
}

// ─── GROUP MATCH ───────────────────────────────────────────────────────────
function tryGroupMatch(socket, key) {
  // Join an existing open room
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.mode !== "group" || room.key !== key || room.sockets.size >= MAX_ROOM_SIZE) continue;
    const existingPeers = [...room.sockets];
    room.sockets.add(socket.id);
    socket.data.roomId = roomId;
    socket.join(roomId);
    io.to(socket.id).emit("matched", { roomId, role: "joiner", mode: "group", peers: existingPeers, filters: socket.data.filters });
    socket.to(roomId).emit("peer-joined", { peerId: socket.id, roomId });
    console.log(`✅ Group join: ${socket.id.slice(0,8)} → ${roomId} (${room.sockets.size} members) [${key}]`);
    return true;
  }

  // Form a new room from the queue
  const queue = getQueue(key);
  if (queue.length < 1) return false;

  const roomId  = `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const members = [socket, ...queue.splice(0, MAX_ROOM_SIZE - 1)];
  if (queue.length === 0) delete queues[key];

  const memberIds = members.map(s => s.id);
  rooms[roomId] = { sockets: new Set(memberIds), mode: "group", key };

  members.forEach(s => {
    s.data.roomId = roomId;
    s.join(roomId);
    if (s.data.queueTimer) { clearTimeout(s.data.queueTimer); s.data.queueTimer = null; }
  });

  members.forEach((s, i) => {
    io.to(s.id).emit("matched", {
      roomId,
      role:    i === 0 ? "caller" : "receiver",
      mode:    "group",
      peers:   memberIds.filter(id => id !== s.id),
      filters: s.data.filters,
    });
  });

  console.log(`✅ Group formed: ${roomId} — ${members.length} members [${key}]`);
  return true;
}

// ─── SOCKET HANDLERS ───────────────────────────────────────────────────────
io.on("connection", (socket) => {
  const ip = socket.handshake.headers["x-forwarded-for"]?.split(",")[0].trim()
    || socket.handshake.address || "unknown";

  if (!checkIpLimit(ip)) {
    socket.emit("error", { message: "Too many connections. Please try again shortly." });
    socket.disconnect(true);
    return;
  }

  console.log(`🟢 ${socket.id.slice(0,8)} (${ip})`);
  onlineUsers++;
  io.emit("online-count", onlineUsers);

  let msgCount = 0, rateLimitTimer = null;

  socket.on("join", (payload) => {
    if (!payload || typeof payload !== "object") { socket.emit("error", { message: "Invalid request." }); return; }
    const { drink, vibe, mode } = payload;
    const filters = { drink, vibe, mode };
    if (!isValidFilters(filters)) { socket.emit("error", { message: "Invalid filter selection." }); return; }

    if (socket.data.roomId) cleanupSocket(socket, true);
    else removeFromQueue(socket);

    socket.data.filters  = filters;
    socket.data.queueKey = queueKey(filters);

    const key     = socket.data.queueKey;
    const matched = mode === "group" ? tryGroupMatch(socket, key) : trySoloMatch(socket, key);

    if (!matched) {
      const queue = getQueue(key);
      if (queue.length >= MAX_QUEUE_SIZE) { socket.emit("error", { message: "Server busy. Try a different vibe!" }); return; }
      queue.push(socket);
      socket.data.queueTimer = setTimeout(() => {
        removeFromQueue(socket);
        socket.data.queueTimer = null;
        socket.emit("no-match-found");
      }, QUEUE_TIMEOUT_MS);
      socket.emit("waiting", { message: "Searching for your vibe…", filters });
      io.emit("queue-stats", buildQueueStats());
    }
  });

  socket.on("signal", (payload) => {
    if (!payload || typeof payload !== "object") return;
    const { roomId, targetId, data } = payload;
    if (!roomId || socket.data.roomId !== roomId) return;
    if (!targetId || typeof targetId !== "string") return;
    if (!data || typeof data !== "object") return;
    const isOffer = data.type === "offer", isAnswer = data.type === "answer", isCandidate = data.candidate !== undefined;
    if (!isOffer && !isAnswer && !isCandidate) return;
    const room = rooms[roomId];
    if (!room || !room.sockets.has(targetId)) return;
    io.to(targetId).emit("signal", { fromId: socket.id, data });
  });

  socket.on("chat-message", (payload) => {
    if (!payload || typeof payload !== "object") return;
    const { roomId, message } = payload;
    if (!roomId || socket.data.roomId !== roomId) return;
    if (typeof message !== "string") return;
    const safe = message.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!safe) return;
    msgCount++;
    if (msgCount >= RATE_LIMIT_MAX_MSGS) { socket.emit("error", { message: "Slow down — too many messages." }); return; }
    if (!rateLimitTimer) rateLimitTimer = setTimeout(() => { msgCount = 0; rateLimitTimer = null; }, RATE_LIMIT_WINDOW);
    socket.to(roomId).emit("chat-message", { fromId: socket.id, message: safe });
  });

  socket.on("next", () => cleanupSocket(socket, true));

  socket.on("disconnect", (reason) => {
    console.log(`🔴 ${socket.id.slice(0,8)} disconnected (${reason})`);
    if (rateLimitTimer) clearTimeout(rateLimitTimer);
    cleanupSocket(socket, false);
  });

  socket.on("error", (err) => console.error(`Socket error (${socket.id.slice(0,8)}):`, err?.message));
});

// ─── QUEUE STATS ───────────────────────────────────────────────────────────
function buildQueueStats() {
  const stats = {};
  for (const [k, q] of Object.entries(queues)) { if (q.length) stats[k] = q.length; }
  return stats;
}

// Periodic IP map cleanup
setInterval(() => {
  const now = Date.now();
  for (const ip of Object.keys(ipConnections)) {
    ipConnections[ip] = ipConnections[ip].filter(t => now - t < IP_CONN_WINDOW_MS);
    if (ipConnections[ip].length === 0) delete ipConnections[ip];
  }
}, 60_000);

// ─── START ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => console.log(`🚀 DRUNKYARD server on port ${PORT}`));

module.exports = { app, server };
