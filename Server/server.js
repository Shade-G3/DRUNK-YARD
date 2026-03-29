const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors({
  origin: "*",   // 🔥 allow all (for now)
  methods: ["GET", "POST"]
}));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket"]
});

server.setTimeout(60000);
app.set("trust proxy", 1);

let queues = {
  whisky: null,
  rum: null,
  vodka: null,
  wine: null
};

let onlineUsers = 0;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  onlineUsers++;
  io.emit("online-count", onlineUsers);

  // 🎯 JOIN CATEGORY
  socket.on("join-category", ({ category }) => {
    console.log("JOIN CATEGORY EVENT RECEIVED");
    console.log(socket.id, "selected", category);
    socket.category = category;

    if (queues[category] && queues[category].id !== socket.id) {
      const partner = queues[category];
      const roomId = `${socket.id}#${partner.id}`;

      // store room
      socket.roomId = roomId;
      partner.roomId = roomId;

      socket.join(roomId);
      partner.join(roomId);

      io.to(socket.id).emit("matched", { roomId, role: "caller" });
      io.to(partner.id).emit("matched", { roomId, role: "receiver" });

      queues[category] = null;

      console.log(`Matched in ${category}:`, socket.id, partner.id);
    } else {
      queues[category] = socket;

      socket.emit("waiting", {
        message: "Waiting for someone with same choice..."
      });
    }
  });

  // 🔁 WebRTC signaling
  socket.on("signal", ({ roomId, data }) => {
    if (!roomId) return;
    socket.to(roomId).emit("signal", data);
  });

  // 💬 CHAT FEATURE
  socket.on("chat-message", ({ roomId, message }) => {
    if (!roomId) return;
    socket.to(roomId).emit("chat-message", message);
  });

  // ⏭️ NEXT (skip partner)
  socket.on("next", () => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit("partner-left");
      socket.leave(socket.roomId);
      socket.roomId = null;
    }
  });

  // ❌ DISCONNECT
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    onlineUsers--;
    io.emit("online-count", onlineUsers);

    // notify partner if in room
    if (socket.roomId) {
      socket.to(socket.roomId).emit("partner-left");
    }

    // remove from all queues
    Object.keys(queues).forEach((key) => {
      if (queues[key]?.id === socket.id) {
        queues[key] = null;
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
