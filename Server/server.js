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

let onlineUsers = 0;

let queues = {
   whisky: [],
  rum: [],
  vodka: [],
  wine: []
};


io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  
  onlineUsers++;
  io.emit("online-count", onlineUsers);
  
  // 🎯 JOIN CATEGORY
  socket.on("join-category", ({ category }) => {
    console.log("JOIN CATEGORY EVENT RECEIVED");
    console.log(socket.id, "selected", category);
    socket.category = category;

    const queue = queues[category];
     console.log(`${socket.id} joined ${category}`);

       // ✅ IF SOMEONE IS WAITING → MATCH
    if (queue.length > 0) {
      const partner = queue.shift(); // FIFO

      const roomId = `${socket.id}#${partner.id}`;

      socket.roomId = roomId;
      partner.roomId = roomId;

      socket.join(roomId);
      partner.join(roomId);

      // ✅ ASSIGN ROLES
      io.to(socket.id).emit("matched", { roomId, role: "caller" });
      io.to(partner.id).emit("matched", { roomId, role: "receiver" });

      console.log(`✅ Matched: ${socket.id} ↔ ${partner.id}`);

    } else {
      // ⏳ ADD TO QUEUE
      queue.push(socket);

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
     handleDisconnect(socket, true);
  });


  // ❌ DISCONNECT
  socket.on("disconnect", () => {
   handleDisconnect(socket, false);
  });

  // 🔥 CLEANUP FUNCTION (IMPORTANT)
  function handleDisconnect(socket, isNext) {
    console.log("🔴 Leaving:", socket.id);

    // NEXT: keep same category, find another random person from same queue.
  socket.on("next", () => {
    if (!socket.category) return;
    leaveCurrentSession({ countOffline: false });
    joinCategory(socket.category);
 });

// HOME: leave room/queue and wait for user to choose category again.
  socket.on("go-home", () => {
    leaveCurrentSession({ countOffline: false });
    socket.category = null;
 });
    
    // notify partner
    if (socket.roomId) {
      socket.to(socket.roomId).emit("partner-left");
      socket.leave(socket.roomId);
      socket.roomId = null;
    }

    // remove from queue
    if (socket.category && queues[socket.category]) {
      queues[socket.category] = queues[socket.category].filter(
        (s) => s.id !== socket.id
      );
    }

    if (!isNext) {
      onlineUsers--;
      io.emit("online-count", onlineUsers);
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
