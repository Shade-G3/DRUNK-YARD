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
      "http://localhost:4000",
      "http://localhost:5500",
      "https://drunk-yard.onrender.com",
    ];

const MAX_MESSAGE_LENGTH     = 500;
const MAX_QUEUE_SIZE         = 200;
const RATE_LIMIT_WINDOW      = 10_000;
const RATE_LIMIT_MAX_MSGS    = 20;
const MAX_CONNECTIONS_PER_IP = 20;
const MAX_ROOM_SIZE          = 6;
const QUEUE_TIMEOUT_MS       = 120_000; // 2 min (client shows 10s UI prompt)
const IP_CONN_WINDOW_MS      = 60_000;

// ─── FILTER TAXONOMY ───────────────────────────────────────────────────────
const VALID_DRINKS = new Set(["whisky", "rum", "vodka", "wine", "beer", "sober", "any"]);
const VALID_VIBES  = new Set(["chill", "deep-talk", "research", "fun", "flirt", "rant", "creative", "any"]);
const VALID_MODES  = new Set(["solo", "group"]);

// Arrays used for wildcard expansion
const VALID_DRINKS_ARR = ["whisky", "rum", "vodka", "wine", "beer", "sober", "any"];
const VALID_VIBES_ARR  = ["chill", "deep-talk", "research", "fun", "flirt", "rant", "creative", "any"];

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

// ─── WILDCARD COMPATIBILITY ────────────────────────────────────────────────
// "any" acts as a wildcard: matches any concrete value AND other "any"s.
// Two values d1/d2 are compatible if: d1 === d2 || d1 === "any" || d2 === "any"

function areKeysCompatible(key1, key2) {
  const [d1, v1] = key1.split("__");
  const [d2, v2] = key2.split("__");
  const drinkOk = d1 === d2 || d1 === "any" || d2 === "any";
  const vibeOk  = v1 === v2 || v1 === "any" || v2 === "any";
  return drinkOk && vibeOk;
}

// Returns all queue keys (for the given mode) that could hold a compatible partner.
// Exact key first, then "any"-expanded variants.
function getCompatibleQueueKeys(drink, vibe, mode) {
  // Which drink values in a queue are compatible with me?
  const matchDrinks = drink === "any" ? VALID_DRINKS_ARR : [drink, "any"];
  // Which vibe values in a queue are compatible with me?
  const matchVibes  = vibe  === "any" ? VALID_VIBES_ARR  : [vibe,  "any"];

  const seen = new Set();
  const keys = [];
  // Put exact key first so we always prefer exact matches
  const exact = `${drink}__${vibe}__${mode}`;
  seen.add(exact);
  keys.push(exact);

  for (const d of matchDrinks) {
    for (const v of matchVibes) {
      const k = `${d}__${v}__${mode}`;
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  return keys;
}

// ─── STATE ─────────────────────────────────────────────────────────────────
let onlineUsers = 0;

// queues[key] = [socket, ...]
const queues = {};

// rooms[roomId] = { sockets: Set<socketId>, mode, key }
const rooms = {};

// vibeMatchVotes[roomId] = Set<socketId> — tracks who clicked "Vibe Match"
const vibeMatchVotes = {};

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
      delete vibeMatchVotes[roomId]; // clean up vibe-match votes
    } else {
      // Remove this socket from any pending vibe-match vote
      if (vibeMatchVotes[roomId]) {
        vibeMatchVotes[roomId].delete(socket.id);
        if (vibeMatchVotes[roomId].size === 0) delete vibeMatchVotes[roomId];
      }
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
// Searches compatible queues (exact first, then "any"-wildcard variants).
function trySoloMatch(socket, key) {
  const { drink, vibe } = socket.data.filters;
  const compatibleKeys = getCompatibleQueueKeys(drink, vibe, "solo");

  for (const k of compatibleKeys) {
    const queue = queues[k];
    if (!queue || queue.length === 0) continue;

    const partner = queue.shift();
    if (queue.length === 0) delete queues[k];
    if (partner.data.queueTimer) { clearTimeout(partner.data.queueTimer); partner.data.queueTimer = null; }

    const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    socket.data.roomId  = roomId;
    partner.data.roomId = roomId;
    rooms[roomId] = { sockets: new Set([socket.id, partner.id]), mode: "solo", key };

    socket.join(roomId);
    partner.join(roomId);

    io.to(socket.id).emit("matched", {
      roomId, role: "caller", mode: "solo", peers: [partner.id],
      filters:     socket.data.filters,
      peerFilters: { [partner.id]: partner.data.filters },
    });
    io.to(partner.id).emit("matched", {
      roomId, role: "receiver", mode: "solo", peers: [socket.id],
      filters:     partner.data.filters,
      peerFilters: { [socket.id]: socket.data.filters },
    });

    console.log(`✅ Solo: ${socket.id.slice(0,8)} ↔ ${partner.id.slice(0,8)} [${k}]`);
    return true;
  }

  return false;
}

// ─── GROUP MATCH ───────────────────────────────────────────────────────────
function tryGroupMatch(socket, key) {
  const { drink, vibe } = socket.data.filters;

  // 1. Try to join an existing open room with a compatible key (exact first)
  // Sort: exact key rooms first
  const roomEntries = Object.entries(rooms).sort(([idA, rA], [idB, rB]) => {
    const exactA = rA.key === key ? 0 : 1;
    const exactB = rB.key === key ? 0 : 1;
    return exactA - exactB;
  });

  for (const [roomId, room] of roomEntries) {
    if (room.mode !== "group" || room.sockets.size >= MAX_ROOM_SIZE) continue;
    if (!areKeysCompatible(key, room.key)) continue;

    const existingPeers = [...room.sockets];
    room.sockets.add(socket.id);
    socket.data.roomId = roomId;
    socket.join(roomId);

    // Build peerFilters map for the joiner
    const peerFilters = {};
    for (const peerId of existingPeers) {
      const peerSock = io.sockets.sockets.get(peerId);
      if (peerSock) peerFilters[peerId] = peerSock.data.filters;
    }

    io.to(socket.id).emit("matched", {
      roomId, role: "joiner", mode: "group", peers: existingPeers,
      filters:     socket.data.filters,
      peerFilters,
    });
    socket.to(roomId).emit("peer-joined", {
      peerId: socket.id, roomId,
      filters: socket.data.filters,
    });
    console.log(`✅ Group join: ${socket.id.slice(0,8)} → ${roomId} (${room.sockets.size}) [${key}→${room.key}]`);
    return true;
  }

  // 2. Form a new room from compatible queues (exact key queue first)
  const compatibleKeys = getCompatibleQueueKeys(drink, vibe, "group");

  for (const k of compatibleKeys) {
    const queue = queues[k];
    if (!queue || queue.length === 0) continue;

    const roomId  = `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const members = [socket, ...queue.splice(0, MAX_ROOM_SIZE - 1)];
    if (queue.length === 0) delete queues[k];

    const memberIds = members.map(s => s.id);
    rooms[roomId] = { sockets: new Set(memberIds), mode: "group", key: k };

    members.forEach(s => {
      s.data.roomId = roomId;
      s.join(roomId);
      if (s.data.queueTimer) { clearTimeout(s.data.queueTimer); s.data.queueTimer = null; }
    });

    members.forEach((s, i) => {
      const peerFilters = {};
      members.filter(m => m.id !== s.id).forEach(m => { peerFilters[m.id] = m.data.filters; });
      io.to(s.id).emit("matched", {
        roomId,
        role:        i === 0 ? "caller" : "receiver",
        mode:        "group",
        peers:       memberIds.filter(id => id !== s.id),
        filters:     s.data.filters,
        peerFilters,
      });
    });

    console.log(`✅ Group formed: ${roomId} — ${members.length} members [${k}]`);
    return true;
  }

  return false;
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

  // ── join ──────────────────────────────────────────────────────────────────
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

  // ── signal ────────────────────────────────────────────────────────────────
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

  // ── chat-message ──────────────────────────────────────────────────────────
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

  // ── vibe-match-request ────────────────────────────────────────────────────
  // When a user clicks "Vibe Match", vote is recorded.
  // When all room members have voted → emit "vibe-matched" to the whole room.
  socket.on("vibe-match-request", ({ roomId: rid } = {}) => {
    if (!rid || socket.data.roomId !== rid) return;
    const room = rooms[rid];
    if (!room) return;

    if (!vibeMatchVotes[rid]) vibeMatchVotes[rid] = new Set();
    vibeMatchVotes[rid].add(socket.id);

    const voteCount = vibeMatchVotes[rid].size;
    const total     = room.sockets.size;

    // Tell everyone else in the room that someone voted (for live counter)
    socket.to(rid).emit("vibe-match-vote", { fromId: socket.id, count: voteCount, total });

    // All members voted → fire!
    if (voteCount >= total) {
      io.to(rid).emit("vibe-matched");
      delete vibeMatchVotes[rid];
      console.log(`⚡ Vibe matched in room ${rid}`);
    }
  });

  // ── next ──────────────────────────────────────────────────────────────────
  socket.on("next", () => cleanupSocket(socket, true));

  // ── disconnect ────────────────────────────────────────────────────────────
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
