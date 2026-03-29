const socket = io("https://drunk-yard.onrender.com",{
  transports: ["websocket"],  // 🔥 FORCE POLLING
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000
  });
socket.on("connect", () => {
  console.log("Connected:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("Connection error:", err);
});

let localStream;
let peerConnection;
let roomId;

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },

    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]
};

// 🎥 START CAMERA
async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    document.getElementById("localVideo").srcObject = localStream;

    console.log("✅ Camera started");

  
  } catch (err) {
    console.error("Camera error:", err);
  }
}
document.addEventListener("click", () => {
  if (!localStream) {
    startCamera();
  }
});

// 🔌 SOCKET CONNECT
socket.on("connect", () => {
  console.log("Connected:", socket.id);
});

// 🎯 CATEGORY SELECTION
function selectCategory(category) {
  console.log("🔥 BUTTON CLICKED:", category);

  // Hide selection UI
  document.getElementById("selectionScreen").style.display = "none";

  // Update status
  document.getElementById("status").innerText = "Finding someone with same choice...";

  // 🔥 EMIT TO BACKEND
  socket.emit("join-category", { category });

  console.log("🚀 EMITTED TO SERVER:", category);
}
 
// ⏳ WAITING
socket.on("waiting", ({ message }) => {
  document.getElementById("status").innerText = message;
});

// ❌ NO MATCH
socket.on("no-match-found", () => {
  document.getElementById("status").innerText ="Waiting for someone with same choice";
  document.getElementById("selectionScreen").style.display = "block";
});

// 🎉 MATCHED
socket.on("matched", async ({ roomId: id }) => {
  console.log("MATCHED:", id);

  roomId = id;

  document.getElementById("status").innerText = "Connected 🎉";
  document.getElementById("chatBox").style.display = "flex";
  document.getElementById("selectionScreen").style.display = "none";
  document.getElementById("selectionScreen").style.opacity = "0";
  setTimeout(() => {
    document.getElementById("selectionScreen").style.display = "none";
  }, 300);

  // 🔥 WAIT for camera
  if (!localStream) {
     console.log("🎥 Starting camera before connection...");
     await startCamera();
  }
 
  

   createPeerConnection();

  if (role === "caller") {
    console.log("Creating offer...");

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit("signal", { roomId, data: offer });
  }
});

// 🔁 SIGNAL HANDLING (FIXED)
socket.on("signal", async (data) => {
  if (!peerConnection) {
    createPeerConnection();
  }

  if (data.type === "offer") {
    await peerConnection.setRemoteDescription(data);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit("signal", { roomId, data: answer });

  } else if (data.type === "answer") {
    if (peerConnection.signalingState !== "stable") {
      await peerConnection.setRemoteDescription(data);
    }

  } else if (data.candidate) {
    try {
      await peerConnection.addIceCandidate(data);
    } catch (err) {
      console.error("ICE error:", err);
    }
  }
});
socket.on("partner-left", () => {
  alert("Stranger disconnected 😢");

  roomId = null;

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  goBack();
});

// 🔗 CREATE PEER CONNECTION
function createPeerConnection() {
  if (peerConnection) return;

  if (!localStream) {
    console.error("Local stream not ready yet");
    return;
  }

  peerConnection = new RTCPeerConnection(config);

  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE state:", peerConnection.iceConnectionState);
  };

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    document.getElementById("remoteVideo").srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", {
        roomId,
        data: event.candidate
      });
    }
  };
}

// 💬 SEND MESSAGE
function sendMessage() {
  const input = document.getElementById("chatInput");
  const message = input.value;

  if (!message) return;

  socket.emit("chat-message", { roomId, message });

  addMessage("You: " + message);

  input.value = "";
}

// 💬 RECEIVE MESSAGE
socket.on("chat-message", (message) => {
  addMessage("Stranger: " + message);
});

// 🧾 ADD MESSAGE TO UI
function addMessage(msg) {
  const div = document.createElement("div");

  div.innerText = msg;

  div.style.padding = "8px";
  div.style.margin = "5px";
  div.style.borderRadius = "8px";
  div.style.background = msg.startsWith("You")
    ? "#38bdf8"
    : "#1e293b";

  document.getElementById("messages").appendChild(div);
}


  socket.on("online-count", (count) => {
  document.getElementById("status").innerText =
    `👥 ${count} users online`;
 });



document.addEventListener("DOMContentLoaded", () => {
  console.log("✅ DOM LOADED");

  const whiskyBtn = document.getElementById("whiskyBtn");
  const rumBtn = document.getElementById("rumBtn");
  const vodkaBtn = document.getElementById("vodkaBtn");
  const wineBtn = document.getElementById("wineBtn");

  console.log("Buttons found:", whiskyBtn, rumBtn, vodkaBtn, wineBtn);

  // 🔥 FORCE TEST (IMPORTANT)
  whiskyBtn.onclick = () => {
    console.log("WHISKY CLICK WORKED");
    selectCategory("whisky");
  };

  rumBtn.onclick = () => {
    console.log("RUM CLICK WORKED");
    selectCategory("rum");
  };

  vodkaBtn.onclick = () => {
    console.log("VODKA CLICK WORKED");
    selectCategory("vodka");
  };

  wineBtn.onclick = () => {
    console.log("WINE CLICK WORKED");
    selectCategory("wine");
  };
});

document.getElementById("chatToggleBtn").onclick = () => {
  const chat = document.getElementById("chatBox");

  if (chat.style.display === "none" || chat.style.display === "") {
    chat.style.display = "flex";
  } else {
    chat.style.display = "none";
  }
};

socket.on("connect", () => {
  console.log("Connected to backend:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("Connection error:", err);

});

socket.on("connect", () => {
  console.log("✅ Connected:", socket.id);
});
socket.on("ready", () => {
  console.log("⚡ Both users ready");

  if (localStream && roomId) {
    createPeerConnection();
  }
});
peerConnection.ontrack = (event) => {
  console.log("🎥 Remote stream received", event);
  document.getElementById("remoteVideo").srcObject = event.streams[0];
};

peerConnection.oniceconnectionstatechange = () => {
  console.log("ICE state:", peerConnection.iceConnectionState);
};
