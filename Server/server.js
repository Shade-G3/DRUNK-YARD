const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

app.set("trust proxy", 1);

let queues = {
  whisky: null,
  rum: null,
  vodka: null,
  wine: null
};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-category", ({ category }) => {
    console.log("JOIN CATEGORY EVENT RECEIVED");
    console.log(socket.id, "selected", category);

    if (queues[category] && queues[category].id !== socket.id) {
      const partner = queues[category];
      const roomId = `${socket.id}#${partner.id}`;

      socket.join(roomId);
      partner.join(roomId);

      io.to(socket.id).emit("matched", { roomId });
      io.to(partner.id).emit("matched", { roomId });

      queues[category] = null;

      console.log(`Matched in ${category}:`, socket.id, partner.id);

    } else {
      queues[category] = socket;

      socket.emit("waiting", {
        message: "Waiting for someone with same choice..."
      });
    }
  });

  // ❌ If no match after some time
  socket.on("no-match", () => {
    socket.emit("no-match-found");
  });

  // 🔁 WebRTC signaling
  socket.on("signal", ({ roomId, data }) => {
    socket.to(roomId).emit("signal", data);
  });

  // 💬 CHAT FEATURE
  socket.on("chat-message", ({ roomId, message }) => {
    socket.to(roomId).emit("chat-message", message);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  
  socket.on("next", ({ roomId }) => {
   socket.to(roomId).emit("partner-left");

   socket.leave(roomId);
  });  

    // remove from all queues
    Object.keys(queues).forEach((key) => {
      if (queues[key]?.id === socket.id) {
        queues[key] = null;
      }
    });
  });
});
let onlineUsers = 0;

io.on("connection", (socket) => {
  onlineUsers++;

  io.emit("online-count", onlineUsers);

  socket.on("disconnect", () => {
    onlineUsers--;
    io.emit("online-count", onlineUsers);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
