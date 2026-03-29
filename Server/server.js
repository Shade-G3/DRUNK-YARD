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

io.on("connection", (socket) => {
  console.log("User connected:", socket.id); 
 onlineUsers++;
 io.emit("online-count", onlineUsers);

  // ALL EVENTS HERE (merge both blocks)

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    onlineUsers--;
    io.emit("online-count", onlineUsers);

    Object.keys(queues).forEach((key) => {
      if (queues[key]?.id === socket.id) {
        queues[key] = null;
      }
    });
  });

  socket.on("join-category", ({ category }) => {
   socket.category = category;
    console.log("JOIN CATEGORY EVENT RECEIVED");
    console.log(socket.id, "selected", category);
  socket.on("matched", ({ roomId }) => {
     socket.roomId = roomId;
   });

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
 socket.on("disconnect", () => {
  if (socket.roomId) {
    socket.to(socket.roomId).emit("partner-left");
  }
});

  // ❌ If no match after some time
  socket.on("no-match", () => {
    socket.emit("no-match-found");
  });

  // 🔁 WebRTC signaling
socket.on("signal", ({ roomId, data }) => {
  if (!roomId) return;

  socket.to(roomId).emit("signal", data);
});

  // 💬 CHAT FEATURE
  socket.on("chat-message", ({ roomId, message }) => {
    socket.to(roomId).emit("chat-message", message);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  
  
    // remove from all queues
    Object.keys(queues).forEach((key) => {
      if (queues[key]?.id === socket.id) {
        queues[key] = null;
      }
    });
  });
});

socket.on("next", ({ roomId }) => {
   socket.to(roomId).emit("partner-left");

   socket.leave(roomId);
  });  
let onlineUsers = 0;

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
