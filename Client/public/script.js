// ─── SOCKET ────────────────────────────────────────────────────────────────
const socket = io("https://drunk-yard.onrender.com", {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1500,
  reconnectionDelayMax: 8000,
  timeout: 20000,
});

// ─── ICE CONFIG ────────────────────────────────────────────────────────────
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
        "turn:openrelay.metered.ca:80?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

// ─── STATE ─────────────────────────────────────────────────────────────────
let localStream   = null;
let roomId        = null;
let sessionMode   = null;
let sessionStart  = null;
let timerInterval = null;
let isMuted       = false;
let isCamOff      = false;

const peers = {}; // peers[peerId] = { pc, stream }

const selected = { drink: null, vibe: null, mode: null };

const VIBE_META = {
  chill:      { emoji: "🌙", label: "Chill" },
  "deep-talk":{ emoji: "🧠", label: "Deep Talk" },
  research:   { emoji: "🔬", label: "Research" },
  fun:        { emoji: "🎉", label: "Just Fun" },
  flirt:      { emoji: "💘", label: "Flirty" },
  rant:       { emoji: "🔥", label: "Rant Zone" },
  creative:   { emoji: "🎨", label: "Creative" },
  any:        { emoji: "🎲", label: "Any Vibe" },
};

const DRINK_EMOJI = { whisky:"🥃", rum:"🍹", vodka:"🍸", wine:"🍷", beer:"🍺", sober:"💧", any:"✨" };

const $ = id => document.getElementById(id);

function setStatus(msg, live = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("live", live);
}

// ─── CAMERA ────────────────────────────────────────────────────────────────
async function startCamera() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user", frameRate: { ideal: 30, max: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 },
    });
    attachLocalStream();
    return localStream;
  } catch (err) {
    const msg = err.name === "NotAllowedError"
      ? "⚠️ Camera/mic blocked — allow access and refresh"
      : "⚠️ Could not access camera: " + err.message;
    setStatus(msg);
    throw err;
  }
}

function attachLocalStream() {
  const vid = $("localVideo");
  if (vid && localStream) vid.srcObject = localStream;
}

// ─── TILES ─────────────────────────────────────────────────────────────────
function sanitize(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function buildLocalTile() {
  const tile = document.createElement("div");
  tile.className = "video-tile video-tile__local";
  tile.id = "tile-local";
  tile.innerHTML = `
    <video id="localVideo" autoplay muted playsinline></video>
    <div class="video-tile__label">You <span id="localMutedIcon" class="video-tile__muted-icon" style="display:none;">🔇</span></div>
  `;
  return tile;
}

function buildRemoteTile(peerId) {
  const tile = document.createElement("div");
  tile.className = "video-tile";
  tile.id = `tile-${peerId}`;
  tile.innerHTML = `
    <div class="video-tile__placeholder"><div class="avatar">👤</div><span>Connecting…</span></div>
    <video autoplay playsinline style="display:none;"></video>
    <div class="video-tile__label">Stranger·${sanitize(peerId.slice(0,6))}</div>
  `;
  return tile;
}

function updateGridLayout() {
  const grid = $("videoGrid");
  if (!grid) return;
  const remoteCount = grid.children.length - 1;
  grid.className = `video-grid peers-${Math.max(1, remoteCount)}`;
}

function attachStreamToTile(peerId, stream) {
  const tile = $(`tile-${peerId}`);
  if (!tile) return;
  const video = tile.querySelector("video");
  const ph    = tile.querySelector(".video-tile__placeholder");
  if (video) { video.srcObject = stream; video.style.display = "block"; }
  if (ph)    ph.style.display = "none";
}

function removeTile(peerId) {
  const tile = $(`tile-${peerId}`);
  if (tile) tile.remove();
  updateGridLayout();
}

// ─── PEER CONNECTION ───────────────────────────────────────────────────────
function createPeer(peerId) {
  if (peers[peerId]) return peers[peerId].pc;
  const pc = new RTCPeerConnection(ICE_CONFIG);
  peers[peerId] = { pc, stream: null };

  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = ({ streams }) => {
    if (!streams[0]) return;
    peers[peerId].stream = streams[0];
    attachStreamToTile(peerId, streams[0]);
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && roomId) socket.emit("signal", { roomId, targetId: peerId, data: candidate.toJSON() });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") pc.restartIce();
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "failed") pc.restartIce();
    if (pc.iceConnectionState === "disconnected") {
      setTimeout(() => {
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") handlePeerLeft(peerId);
      }, 6000);
    }
  };

  return pc;
}

async function callPeer(peerId) {
  const pc = createPeer(peerId);
  try {
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    socket.emit("signal", { roomId, targetId: peerId, data: { type: offer.type, sdp: offer.sdp } });
  } catch (err) { console.error("Offer error:", err); }
}

function closePeer(peerId) {
  const entry = peers[peerId];
  if (!entry) return;
  try { entry.pc.close(); } catch (_) {}
  delete peers[peerId];
}

function closeAllPeers() { Object.keys(peers).forEach(closePeer); }

// ─── WAITING OVERLAY ───────────────────────────────────────────────────────
function showWaiting(msg) {
  const o = $("waitingOverlay"), t = $("waitingText");
  if (o) o.style.display = "flex";
  if (t) t.textContent = msg || "Searching for your vibe…";
}

function hideWaiting() {
  const o = $("waitingOverlay");
  if (o) o.style.display = "none";
}

// ─── ROOM FLOW ─────────────────────────────────────────────────────────────
async function enterRoom() {
  if (!selected.drink || !selected.vibe || !selected.mode) return;
  try { await startCamera(); } catch { return; }
  showVideoRoom();
  showWaiting("Searching for your vibe…");
  setStatus("🔍 Searching…");
  updateSessionBar();
  socket.emit("join", { drink: selected.drink, vibe: selected.vibe, mode: selected.mode });
}

function showVideoRoom() {
  $("selectionScreen").style.display = "none";
  $("videoRoom").style.display = "flex";
  const grid = $("videoGrid");
  grid.innerHTML = "";
  grid.appendChild(buildLocalTile());
  attachLocalStream();
  updateGridLayout();
}

function showSelectionScreen() {
  hideWaiting();
  $("videoRoom").style.display       = "none";
  $("selectionScreen").style.display = "flex";
  stopTimer();
  setStatus("Choose your vibe");
  const msgs = $("messages");
  if (msgs) msgs.innerHTML = "";
  $("chatPanel")?.classList.remove("open");
}

function updateSessionBar() {
  const vm = VIBE_META[selected.vibe] || { emoji: "🎲", label: selected.vibe };
  const de = DRINK_EMOJI[selected.drink] || "";
  const sv = $("sessionVibe"), sd = $("sessionDrink");
  if (sv) sv.textContent = `${vm.emoji} ${vm.label}`;
  if (sd) sd.textContent = `${de} ${selected.drink}`;
}

function startTimer() {
  sessionStart = Date.now(); stopTimer();
  timerInterval = setInterval(() => {
    const e  = Math.floor((Date.now() - sessionStart) / 1000);
    const mm = String(Math.floor(e / 60)).padStart(2, "0");
    const ss = String(e % 60).padStart(2, "0");
    const el = $("sessionTimer");
    if (el) { el.textContent = `${mm}:${ss}`; el.classList.toggle("hot", e >= 1800); }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const el = $("sessionTimer");
  if (el) { el.textContent = "00:00"; el.classList.remove("hot"); }
}

function handlePeerLeft(peerId) {
  if (!peers[peerId]) return;
  closePeer(peerId);
  removeTile(peerId);
  addSystemMessage("A stranger left the yard.");
  if (sessionMode === "solo") setTimeout(goBack, 1800);
  else setStatus(`🔴 Live · ${Object.keys(peers).length + 1} people`, true);
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  const btn = $("muteBtn"), icon = $("localMutedIcon");
  if (btn)  { btn.textContent = isMuted ? "🔇" : "🎤"; btn.classList.toggle("ctrl-btn--muted", isMuted); }
  if (icon) icon.style.display = isMuted ? "inline" : "none";
}

function toggleCam() {
  if (!localStream) return;
  isCamOff = !isCamOff;
  localStream.getVideoTracks().forEach(t => { t.enabled = !isCamOff; });
  const btn = $("camBtn");
  if (btn) { btn.textContent = isCamOff ? "📷🚫" : "📷"; btn.classList.toggle("ctrl-btn--muted", isCamOff); }
}

function goBack() {
  const wasInRoom = !!roomId;
  roomId = null; sessionMode = null;
  closeAllPeers(); stopTimer(); hideWaiting();
  if (wasInRoom) socket.emit("next");
  showSelectionScreen();
}

function doNext() {
  if (sessionMode === "group") { goBack(); return; }
  closeAllPeers(); stopTimer();
  const grid = $("videoGrid");
  if (grid) [...grid.querySelectorAll(".video-tile:not(.video-tile__local)")].forEach(t => t.remove());
  updateGridLayout();
  socket.emit("next");
  showWaiting("Finding someone new…");
  setStatus("🔍 Finding someone new…");
  socket.emit("join", { drink: selected.drink, vibe: selected.vibe, mode: selected.mode });
}

// ─── CHAT ──────────────────────────────────────────────────────────────────
function sendMessage() {
  const input = $("chatInput");
  if (!input) return;
  const message = input.value.trim();
  if (!message || !roomId || message.length > 500) return;
  socket.emit("chat-message", { roomId, message });
  addChatMessage(message, null, true);
  input.value = "";
  updateCharCount(0);
}

function updateCharCount(len) {
  const el = $("chatCharCount");
  if (!el) return;
  el.textContent = len;
  el.parentElement?.classList.toggle("near-limit", len >= 400);
  el.parentElement?.classList.toggle("at-limit",   len >= 490);
}

function addChatMessage(msg, fromId, isMine) {
  const msgs = $("messages");
  if (!msgs) return;
  const div = document.createElement("div");
  div.className = `chat-msg ${isMine ? "chat-msg--mine" : "chat-msg--theirs"}`;
  if (!isMine && fromId) {
    const name = document.createElement("div");
    name.className = "chat-msg__name";
    name.textContent = `Stranger·${fromId.slice(0,6)}`;
    div.appendChild(name);
  }
  const text = document.createElement("div");
  text.textContent = msg;
  div.appendChild(text);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function addSystemMessage(msg) {
  const msgs = $("messages");
  if (!msgs) return;
  const div = document.createElement("div");
  div.className = "chat-msg chat-msg--system";
  div.textContent = msg;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ─── SOCKET EVENTS ─────────────────────────────────────────────────────────
socket.on("connect",       ()  => setStatus("Choose your vibe"));
socket.on("connect_error", ()  => setStatus("⚠️ Reconnecting…"));
socket.on("reconnect",     ()  => setStatus("Choose your vibe"));
socket.on("online-count",  n   => { const el = $("onlineCount"); if (el) el.textContent = `👥 ${n} online`; });

socket.on("queue-stats", stats => {
  const c = $("liveCounts");
  if (!c) return;
  c.innerHTML = "";
  for (const [key, count] of Object.entries(stats)) {
    if (!count) continue;
    const [drink, vibe] = key.split("__");
    const pill = document.createElement("span");
    pill.className = "count-pill";
    pill.textContent = `${DRINK_EMOJI[drink]||""}${VIBE_META[vibe]?.emoji||""} ${count} waiting`;
    c.appendChild(pill);
  }
});

socket.on("waiting",       ({ message }) => { showWaiting(message); setStatus("⏳ " + (message||"Searching…")); });
socket.on("no-match-found",()            => { hideWaiting(); setStatus("No match found — try a different vibe?"); showSelectionScreen(); });
socket.on("error",         ({ message }) => { hideWaiting(); setStatus("⚠️ " + (message||"Something went wrong")); });

socket.on("matched", async ({ roomId: id, role, mode, peers: peerIds }) => {
  roomId = id; sessionMode = mode;
  hideWaiting();
  setStatus(`🔴 Live · ${mode === "group" ? `${peerIds.length + 1} people` : "1-on-1"}`, true);
  updateSessionBar();
  startTimer();
  if (!localStream) { try { await startCamera(); } catch { return; } }
  attachLocalStream();
  const grid = $("videoGrid");
  for (const peerId of peerIds) {
    if (!$(`tile-${peerId}`)) { grid.appendChild(buildRemoteTile(peerId)); updateGridLayout(); }
    if (role === "caller" || role === "joiner") await callPeer(peerId);
  }
  addSystemMessage(`You joined the yard. ${peerIds.length} ${peerIds.length === 1 ? "stranger" : "strangers"} here.`);
});

socket.on("peer-joined", async ({ peerId }) => {
  const grid = $("videoGrid");
  if (grid && !$(`tile-${peerId}`)) { grid.appendChild(buildRemoteTile(peerId)); updateGridLayout(); }
  createPeer(peerId);
  addSystemMessage("Someone just walked into the yard.");
  setStatus(`🔴 Live · ${Object.keys(peers).length + 1} people`, true);
});

socket.on("peer-left", ({ peerId }) => handlePeerLeft(peerId));

socket.on("signal", async ({ fromId, data }) => {
  if (!peers[fromId]) {
    if (!localStream) { try { await startCamera(); } catch { return; } }
    createPeer(fromId);
    const grid = $("videoGrid");
    if (grid && !$(`tile-${fromId}`)) { grid.appendChild(buildRemoteTile(fromId)); updateGridLayout(); }
  }
  const pc = peers[fromId]?.pc;
  if (!pc) return;
  try {
    if (data.type === "offer") {
      if (pc.signalingState !== "stable" && pc.signalingState !== "have-remote-offer") {
        await pc.setLocalDescription({ type: "rollback" });
      }
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { roomId, targetId: fromId, data: { type: answer.type, sdp: answer.sdp } });
    } else if (data.type === "answer") {
      if (pc.signalingState === "have-local-offer") await pc.setRemoteDescription(new RTCSessionDescription(data));
    } else if (data.candidate !== undefined) {
      try { await pc.addIceCandidate(data.candidate ? new RTCIceCandidate(data) : null); } catch (_) {}
    }
  } catch (err) { console.error(`Signal error [${fromId.slice(0,8)}]:`, err); }
});

socket.on("chat-message", ({ fromId, message }) => addChatMessage(message, fromId, false));

// ─── DOM READY ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

  document.querySelectorAll(".filter-btn, .mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.dataset.group, value = btn.dataset.value;
      if (!group || !value) return;
      document.querySelectorAll(`[data-group="${group}"]`).forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      selected[group] = value;
      const ready = !!(selected.drink && selected.vibe && selected.mode);
      const eb = $("enterBtn"), et = $("enterBtnText");
      if (eb) eb.disabled = !ready;
      if (et) et.textContent = ready
        ? `Enter the Yard — ${selected.mode === "group" ? "Group Room" : "1-on-1"}`
        : "Select all three to continue";
    });
  });

  $("enterBtn")?.addEventListener("click", enterRoom);
  $("muteBtn")?.addEventListener("click", toggleMute);
  $("camBtn")?.addEventListener("click",  toggleCam);
  $("leaveBtn")?.addEventListener("click", goBack);
  $("nextBtn")?.addEventListener("click",  doNext);

  $("chatToggleBtn")?.addEventListener("click", () => $("chatPanel")?.classList.toggle("open"));
  $("chatClose")?.addEventListener("click",     () => $("chatPanel")?.classList.remove("open"));
  $("chatSendBtn")?.addEventListener("click",   sendMessage);

  const chatInput = $("chatInput");
  if (chatInput) {
    chatInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    chatInput.addEventListener("input",   () => updateCharCount(chatInput.value.length));
  }

  startCamera().catch(() => {}); // pre-warm permission
});
