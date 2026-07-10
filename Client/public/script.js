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
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turns:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:80?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:numb.viagenie.ca",
      username: "webrtc@live.com",
      credential: "muazkh",
    },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

// ─── STATE ─────────────────────────────────────────────────────────────────
let localStream       = null;
let roomId            = null;
let sessionMode       = null;
let sessionStart      = null;
let timerInterval     = null;
let isMuted           = false;
let isCamOff          = false;
let pipMode           = false;
let pipOverlayOpen    = false;
let queueTimeoutTimer = null;
let peerLeftTimer     = null;
let isWaiting         = false;

// Vibe-match voting
let myVibeMatchClicked = false;
let vibeMatchVoteCount = 0;
let vibeMatchTotalRoom = 2;
let vibeMatchCanvas    = null;

// peers[peerId] = { pc, stream, filters, pending }
//   pc      — RTCPeerConnection (null until createPeer; stubs pre-populate filters/pending)
//   stream  — incoming MediaStream from ontrack
//   filters — { drink, vibe, mode } received from server on match
//   pending — RTCIceCandidate[] buffered before setRemoteDescription completes
const peers   = {};
const selected = { drink: null, vibe: null, mode: null };

const VIBE_META = {
  chill:      { icon: "fa-moon",             label: "Chill" },
  "deep-talk":{ icon: "fa-comments",         label: "Deep Talk" },
  research:   { icon: "fa-magnifying-glass", label: "Research" },
  fun:        { icon: "fa-face-smile",       label: "Just Fun" },
  flirt:      { icon: "fa-heart",            label: "Flirty" },
  rant:       { icon: "fa-bolt",             label: "Rant Zone" },
  creative:   { icon: "fa-palette",          label: "Creative" },
  any:        { icon: "fa-dice",             label: "Any Vibe" },
};

const DRINK_ICONS = {
  whisky: "fa-whiskey-glass",
  rum:    "fa-martini-glass-citrus",
  vodka:  "fa-martini-glass",
  wine:   "fa-wine-glass",
  beer:   "fa-beer-mug-empty",
  sober:  "fa-droplet",
  any:    "fa-wand-magic-sparkles",
};

const $ = id => document.getElementById(id);

function setStatus(msg, live = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("live", live);
}

// ─── PARTICIPANT COUNT + LAYOUT ────────────────────────────────────────────
function getTotalParticipants() {
  return 1 + Object.keys(peers).length;
}

function refreshLayout() {
  const total = getTotalParticipants();
  if (total === 5) { if (!pipMode) enterPipMode(); }
  else             { if (pipMode)  exitPipMode();  }
  const grid = $("videoGrid");
  if (grid) grid.className = `video-grid layout-${Math.max(1, total)}`;
}

// ─── PIP MODE ──────────────────────────────────────────────────────────────
function enterPipMode() {
  if (pipMode) return;
  pipMode = true;
  $("tile-local")?.remove();
  const pip = $("localPip");
  if (pip) {
    const v = pip.querySelector("video");
    if (v && localStream) v.srcObject = localStream;
    pip.style.display = "flex";
  }
}

function exitPipMode() {
  if (!pipMode) return;
  pipMode = false;
  closePipOverlay();
  const pip = $("localPip");
  if (pip) pip.style.display = "none";
  if (!$("tile-local")) {
    const grid = $("videoGrid");
    if (grid) { grid.insertBefore(buildLocalTile(), grid.firstChild); attachLocalStream(); }
  }
}

function togglePipOverlay() {
  if (pipOverlayOpen) closePipOverlay(); else openPipOverlay();
}

function openPipOverlay() {
  const overlay = $("pipOverlay");
  if (!overlay) return;
  const v = overlay.querySelector("video");
  if (v && localStream) v.srcObject = localStream;
  overlay.style.display = "flex";
  pipOverlayOpen = true;
}

function closePipOverlay() {
  const overlay = $("pipOverlay");
  if (overlay) overlay.style.display = "none";
  pipOverlayOpen = false;
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
    setStatus(err.name === "NotAllowedError"
      ? "Camera/mic blocked — allow access and refresh"
      : "Could not access camera: " + err.message);
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
    <div class="video-tile__label">
      <span>You</span>
      <span id="localMutedIcon" class="video-tile__muted-icon" style="display:none;">
        <i class="fa-solid fa-microphone-slash"></i>
      </span>
    </div>
  `;
  return tile;
}

function buildRemoteTile(peerId) {
  const tile = document.createElement("div");
  tile.className = "video-tile";
  tile.id = `tile-${peerId}`;
  tile.innerHTML = `
    <div class="video-tile__placeholder">
      <div class="avatar"><i class="fa-solid fa-user"></i></div>
      <span>Connecting…</span>
    </div>
    <video autoplay playsinline style="display:none;"></video>
    <div class="video-tile__label">Stranger·${sanitize(peerId.slice(0,6))}</div>
  `;
  return tile;
}

function updateTileVibe(peerId) {
  const tile = $(`tile-${peerId}`);
  if (!tile) return;
  const filters = peers[peerId]?.filters;
  if (!filters) return;

  tile.querySelector(".tile-vibe-badge")?.remove();
  const badge = document.createElement("div");
  badge.className = "tile-vibe-badge";
  const vm = VIBE_META[filters.vibe] || { icon: "fa-dice", label: filters.vibe || "any" };
  const isDiffVibe = filters.vibe !== selected.vibe && filters.vibe !== "any" && selected.vibe !== "any";
  badge.innerHTML = `<i class="fa-solid ${vm.icon}"></i> ${vm.label}`;
  if (isDiffVibe) badge.classList.add("tile-vibe-badge--different");
  tile.appendChild(badge);
}

function attachStreamToTile(peerId, stream) {
  const tile = $(`tile-${peerId}`);
  if (!tile) return;
  const video = tile.querySelector("video");
  const ph    = tile.querySelector(".video-tile__placeholder");
  if (video) { video.srcObject = stream; video.style.display = "block"; }
  if (ph)    ph.style.display = "none";
}

// ─── PEER CONNECTION ───────────────────────────────────────────────────────
// Flush ICE candidates buffered in peers[peerId].pending after remoteDescription is set.
async function flushPending(peerId, pc) {
  const q = peers[peerId]?.pending ?? [];
  if (peers[peerId]) peers[peerId].pending = [];
  for (const c of q) try { await pc.addIceCandidate(c); } catch (_) {}
}

function createPeer(peerId) {
  if (peers[peerId]?.pc) return peers[peerId].pc;  // already created (stubs have pc: null)
  const pc  = new RTCPeerConnection(ICE_CONFIG);
  const stub = peers[peerId];                       // preserve any pre-loaded filters/pending
  peers[peerId] = { pc, stream: null, filters: stub?.filters ?? null, pending: stub?.pending ?? [] };

  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  // Handle empty streams[] on mobile Safari — build MediaStream from raw track
  pc.ontrack = (event) => {
    const incoming = event.streams?.[0];
    if (incoming) {
      peers[peerId].stream = incoming;
      attachStreamToTile(peerId, incoming);
    } else {
      if (!peers[peerId].stream) peers[peerId].stream = new MediaStream();
      peers[peerId].stream.addTrack(event.track);
      attachStreamToTile(peerId, peers[peerId].stream);
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && roomId) socket.emit("signal", { roomId, targetId: peerId, data: candidate.toJSON() });
  };

  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC] ${peerId.slice(0,8)} → ${pc.connectionState}`);
    if (pc.connectionState === "failed") { pc.restartIce(); }
    if (pc.connectionState === "connected") {
      setTimeout(() => {
        const ph = $(`tile-${peerId}`)?.querySelector(".video-tile__placeholder");
        if (ph && ph.style.display !== "none") pc.restartIce();
      }, 5000);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[ICE] ${peerId.slice(0,8)} → ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === "failed") { pc.restartIce(); }
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
  try { entry.pc?.close(); } catch (_) {}
  delete peers[peerId];  // filters and pending auto-cleaned
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

// ─── QUEUE TIMEOUT ─────────────────────────────────────────────────────────
function startQueueTimeout() {
  clearQueueTimeout();
  queueTimeoutTimer = setTimeout(() => {
    queueTimeoutTimer = null;
    if (!roomId) showFallbackModal();
  }, 10_000);
}

function clearQueueTimeout() {
  if (queueTimeoutTimer) { clearTimeout(queueTimeoutTimer); queueTimeoutTimer = null; }
}

// ─── FALLBACK MODAL ────────────────────────────────────────────────────────
function showFallbackModal() {
  const m = $("fallbackModal");
  if (m) m.style.display = "flex";
}

function hideFallbackModal() {
  const m = $("fallbackModal");
  if (m) m.style.display = "none";
}

function fallbackJoinAny() {
  hideFallbackModal();
  clearQueueTimeout();
  socket.emit("next");
  socket.emit("join", { drink: "any", vibe: "any", mode: selected.mode });
  isWaiting = true;
  startQueueTimeout();
  showWaiting("Looking for anyone available…");
  setStatus("Joining any vibe…");
}

// ─── VIBE MATCH BUTTON ─────────────────────────────────────────────────────
function showVibeMatchBtn() {
  const btn = $("vibeMatchBtn");
  if (btn) btn.style.display = "";
}

function hideVibeMatchBtn() {
  const btn = $("vibeMatchBtn");
  if (!btn) return;
  btn.style.display = "none";
  myVibeMatchClicked = false;
  vibeMatchVoteCount = 0;
  btn.classList.remove("ctrl-btn--voted");
  const label = btn.querySelector(".vibe-match-label");
  if (label) label.textContent = "Vibe Match";
}

function updateVibeMatchBtn() {
  const btn = $("vibeMatchBtn");
  if (!btn) return;
  const label = btn.querySelector(".vibe-match-label");
  if (myVibeMatchClicked) {
    btn.classList.add("ctrl-btn--voted");
    if (label) label.textContent = `${1 + vibeMatchVoteCount}/${vibeMatchTotalRoom} voted`;
  } else {
    btn.classList.remove("ctrl-btn--voted");
    if (label) label.textContent = vibeMatchVoteCount > 0 ? `${vibeMatchVoteCount} voted — click!` : "Vibe Match";
  }
}

function requestVibeMatch() {
  if (!roomId || myVibeMatchClicked) return;
  myVibeMatchClicked = true;
  socket.emit("vibe-match-request", { roomId });
  updateVibeMatchBtn();
  showVibeMatchProgress();
}

function showVibeMatchProgress() {
  const el = $("vibeMatchProgress");
  if (!el) return;
  el.style.display = "flex";
  const text = $("vibeMatchProgressText");
  if (text) text.textContent = `${(myVibeMatchClicked ? 1 : 0) + vibeMatchVoteCount}/${vibeMatchTotalRoom} voted for Vibe Match…`;
}

function hideVibeMatchProgress() {
  const el = $("vibeMatchProgress");
  if (el) el.style.display = "none";
}

// ─── SCREENSHOT CAPTURE ────────────────────────────────────────────────────
async function captureVibeMatchedScreenshot() {
  const grid = $("videoGrid");
  const tiles = [...grid.querySelectorAll(".video-tile")];
  const gridRect = grid.getBoundingClientRect();
  const W = Math.floor(gridRect.width)  || 800;
  const H = Math.floor(gridRect.height) || 600;

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#020612";
  ctx.fillRect(0, 0, W, H);

  for (const tile of tiles) {
    const video    = tile.querySelector("video");
    const tileRect = tile.getBoundingClientRect();
    const gap = 6;
    const x = Math.floor(tileRect.left - gridRect.left) + gap;
    const y = Math.floor(tileRect.top  - gridRect.top)  + gap;
    const w = Math.floor(tileRect.width)  - gap * 2;
    const h = Math.floor(tileRect.height) - gap * 2;
    if (w <= 0 || h <= 0) continue;

    ctx.fillStyle = "#010409";
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();

    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      try {
        ctx.save();
        ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.clip();
        ctx.drawImage(video, x, y, w, h);
        ctx.restore();
      } catch (_) {}
    }
  }

  ctx.fillStyle = "rgba(56,189,248,0.06)";
  ctx.fillRect(0, 0, W, H);

  const stamp = `DRUNKYARD · Vibe Matched · ${new Date().toLocaleString()}`;
  const fSize = Math.max(11, Math.round(W * 0.016));
  ctx.font = `600 ${fSize}px Inter, sans-serif`;
  const textW = ctx.measureText(stamp).width + 20;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(W / 2 - textW / 2, H - fSize * 2.2, textW, fSize * 1.9);
  ctx.fillStyle = "rgba(255,255,255,.88)";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(stamp, W / 2, H - fSize * 1.3);

  return canvas;
}

// ─── VIBE MATCHED MODAL ────────────────────────────────────────────────────
async function showVibeMatchedModal(canvas) {
  const modal = $("vibeMatchedModal");
  if (!modal) return;
  const img = $("vibeMatchedImg");
  if (img) img.src = canvas.toDataURL("image/png");
  const dlBtn = $("vibeMatchDownloadBtn");
  if (dlBtn) {
    dlBtn.onclick = () => {
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `drunkyard-vibe-match-${Date.now()}.png`;
      a.click();
    };
  }
  modal.style.display = "flex";
}

function closeVibeMatchedModal() {
  const modal = $("vibeMatchedModal");
  if (modal) modal.style.display = "none";
}

// ─── ROOM FLOW ─────────────────────────────────────────────────────────────
async function enterRoom() {
  if (!selected.drink || !selected.vibe || !selected.mode) return;
  try { await startCamera(); } catch { return; }
  showVideoRoom();
  showWaiting("Searching for your vibe…");
  setStatus("Searching…");
  updateSessionBar();
  $("videoRoom").dataset.vibe = selected.vibe || "any";
  socket.emit("join", { drink: selected.drink, vibe: selected.vibe, mode: selected.mode });
  isWaiting = true;
  startQueueTimeout();
}

function showVideoRoom() {
  $("selectionScreen").style.display = "none";
  $("videoRoom").style.display = "flex";
  const grid = $("videoGrid");
  grid.innerHTML = "";
  grid.className = "video-grid layout-1";
  grid.appendChild(buildLocalTile());
  attachLocalStream();
}

function showSelectionScreen() {
  if (pipMode) exitPipMode();
  clearQueueTimeout();
  hideFallbackModal();
  hideVibeMatchBtn();
  hideVibeMatchProgress();
  closeVibeMatchedModal();
  hideWaiting();
  isWaiting = false;
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  $("videoRoom").style.display       = "none";
  $("videoRoom").removeAttribute("data-vibe");
  $("selectionScreen").style.display = "flex";
  stopTimer();
  setStatus("Choose your vibe");
  const msgs = $("messages");
  if (msgs) msgs.innerHTML = "";
  $("chatPanel")?.classList.remove("open");
}

function updateSessionBar() {
  const vm = VIBE_META[selected.vibe] || { icon: "fa-dice", label: selected.vibe || "Any Vibe" };
  const di = DRINK_ICONS[selected.drink] || "fa-droplet";
  const sv = $("sessionVibe"), sd = $("sessionDrink");
  if (sv) sv.innerHTML = `<i class="fa-solid ${vm.icon}"></i> ${vm.label}`;
  if (sd) sd.innerHTML = `<i class="fa-solid ${di}"></i> ${selected.drink || "any"}`;
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
  $(`tile-${peerId}`)?.remove();
  refreshLayout();
  addMessage("A stranger left the yard.", { isSystem: true });
  const total = getTotalParticipants();
  if (sessionMode === "solo") peerLeftTimer = setTimeout(goBack, 1800);
  else {
    setStatus(`Live · ${total} ${total === 1 ? "person" : "people"}`, true);
    vibeMatchTotalRoom = total;
    updateVibeMatchBtn();
  }
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  const btn = $("muteBtn"), icon = $("localMutedIcon");
  if (btn) {
    btn.classList.toggle("ctrl-btn--muted", isMuted);
    btn.querySelector(".icon-on").style.display  = isMuted ? "none" : "";
    btn.querySelector(".icon-off").style.display = isMuted ? ""     : "none";
  }
  if (icon) icon.style.display = isMuted ? "inline" : "none";
}

function toggleCam() {
  if (!localStream) return;
  isCamOff = !isCamOff;
  localStream.getVideoTracks().forEach(t => { t.enabled = !isCamOff; });
  const btn = $("camBtn");
  if (btn) {
    btn.classList.toggle("ctrl-btn--muted", isCamOff);
    btn.querySelector(".icon-on").style.display  = isCamOff ? "none" : "";
    btn.querySelector(".icon-off").style.display = isCamOff ? ""     : "none";
  }
}

function goBack() {
  if (pipMode) exitPipMode();
  clearQueueTimeout();
  if (peerLeftTimer) { clearTimeout(peerLeftTimer); peerLeftTimer = null; }
  const wasInRoom = !!roomId;
  roomId = null; sessionMode = null;
  closeAllPeers(); stopTimer(); hideWaiting();
  if (wasInRoom) socket.emit("next");
  showSelectionScreen();
}

function doNext() {
  if (sessionMode === "group") { goBack(); return; }
  if (pipMode) exitPipMode();
  clearQueueTimeout();
  if (peerLeftTimer) { clearTimeout(peerLeftTimer); peerLeftTimer = null; }
  hideVibeMatchBtn();
  hideVibeMatchProgress();
  closeAllPeers(); stopTimer();
  roomId = null; sessionMode = null;
  const grid = $("videoGrid");
  if (grid) {
    [...grid.querySelectorAll(".video-tile:not(.video-tile__local)")].forEach(t => t.remove());
    grid.className = "video-grid layout-1";
  }
  socket.emit("next");
  socket.emit("join", { drink: selected.drink, vibe: selected.vibe, mode: selected.mode });
  isWaiting = true;
  showWaiting("Finding someone new…");
  setStatus("Finding someone new…");
  startQueueTimeout();
}

// ─── CHAT ──────────────────────────────────────────────────────────────────
function sendMessage() {
  const input = $("chatInput");
  if (!input) return;
  const message = input.value.trim();
  if (!message || !roomId || message.length > 500) return;
  socket.emit("chat-message", { roomId, message });
  addMessage(message, { isMine: true });
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

function addMessage(msg, { fromId = null, isMine = false, isSystem = false } = {}) {
  const msgs = $("messages");
  if (!msgs) return;
  const div = document.createElement("div");
  if (isSystem) {
    div.className = "chat-msg chat-msg--system";
    div.textContent = msg;
  } else {
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
  }
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ─── SOCKET EVENTS ─────────────────────────────────────────────────────────
socket.on("connect",       () => setStatus("Choose your vibe"));
socket.on("connect_error", () => setStatus("Reconnecting…"));

socket.on("reconnect", () => {
  clearQueueTimeout();
  if (roomId || sessionMode) {
    closeAllPeers(); stopTimer();
    roomId = null; sessionMode = null;
    showSelectionScreen();
    setTimeout(() => setStatus("Reconnected — start a new session"), 50);
  } else if (isWaiting && selected.drink && selected.vibe && selected.mode) {
    socket.emit("join", { drink: selected.drink, vibe: selected.vibe, mode: selected.mode });
    startQueueTimeout();
    showWaiting("Reconnected, still searching…");
    setStatus("Searching…");
  } else {
    setStatus("Choose your vibe");
  }
});

socket.on("online-count", n => {
  const el = $("onlineCountNum");
  if (el) el.textContent = n;
});

socket.on("queue-stats", stats => {
  const c = $("liveCounts");
  if (!c) return;
  c.innerHTML = "";
  for (const [key, count] of Object.entries(stats)) {
    if (!count) continue;
    const [drink, vibe] = key.split("__");
    const pill = document.createElement("span");
    pill.className = "count-pill";
    pill.innerHTML = `<i class="fa-solid ${DRINK_ICONS[drink] || ""}"></i> <i class="fa-solid ${VIBE_META[vibe]?.icon || ""}"></i> ${count} waiting`;
    c.appendChild(pill);
  }
});

socket.on("waiting", ({ message }) => {
  showWaiting(message);
  setStatus(message || "Searching…");
});

socket.on("no-match-found", () => {
  clearQueueTimeout();
  hideWaiting();
  setStatus("No match found — try a different vibe?");
  showSelectionScreen();
});

socket.on("error", ({ message }) => {
  clearQueueTimeout();
  hideWaiting();
  setStatus(message || "Something went wrong");
  setTimeout(showSelectionScreen, 2500);
});

socket.on("matched", async ({ roomId: id, role, mode, peers: peerIds, peerFilters: pf }) => {
  roomId = id; sessionMode = mode;
  isWaiting = false;
  clearQueueTimeout();
  hideFallbackModal();
  hideWaiting();

  // Pre-populate peer stubs with filters. For the receiver, pc is created lazily
  // when the offer arrives — but filters are ready for vibe badges immediately.
  if (pf) {
    for (const [peerId, filters] of Object.entries(pf)) {
      if (!peers[peerId]) peers[peerId] = { pc: null, stream: null, filters, pending: [] };
      else peers[peerId].filters = filters;
    }
  }

  vibeMatchTotalRoom = 1 + peerIds.length;
  myVibeMatchClicked = false;
  vibeMatchVoteCount = 0;

  setStatus(`Live · ${mode === "group" ? `${peerIds.length + 1} people` : "1-on-1"}`, true);
  updateSessionBar();
  startTimer();

  if (!localStream) {
    try { await startCamera(); }
    catch {
      socket.emit("next");
      roomId = null; sessionMode = null;
      showSelectionScreen();
      return;
    }
  }
  attachLocalStream();

  const grid = $("videoGrid");
  for (const peerId of peerIds) {
    if (!$(`tile-${peerId}`)) grid.appendChild(buildRemoteTile(peerId));
    updateTileVibe(peerId);
    if (role === "caller" || role === "joiner") await callPeer(peerId);
  }

  refreshLayout();
  showVibeMatchBtn();
  addMessage(`You joined the yard. ${peerIds.length} ${peerIds.length === 1 ? "stranger" : "strangers"} here.`, { isSystem: true });

  if (pf) {
    const diffVibes = Object.values(pf).filter(f =>
      f.vibe !== selected.vibe && f.vibe !== "any" && selected.vibe !== "any"
    );
    if (diffVibes.length > 0) addMessage("Matched across vibes — their vibe is shown in the corner.", { isSystem: true });
  }
});

socket.on("peer-joined", async ({ peerId, filters }) => {
  const grid = $("videoGrid");
  if (grid && !$(`tile-${peerId}`)) grid.appendChild(buildRemoteTile(peerId));
  createPeer(peerId);
  if (filters) { peers[peerId].filters = filters; updateTileVibe(peerId); }
  vibeMatchTotalRoom = getTotalParticipants();
  refreshLayout();
  addMessage("Someone just walked into the yard.", { isSystem: true });
  setStatus(`Live · ${getTotalParticipants()} people`, true);
  updateVibeMatchBtn();
});

socket.on("peer-left", ({ peerId }) => handlePeerLeft(peerId));

// ─── VIBE MATCH EVENTS ─────────────────────────────────────────────────────
socket.on("vibe-match-vote", ({ count, total }) => {
  vibeMatchVoteCount = myVibeMatchClicked ? count - 1 : count;
  vibeMatchTotalRoom = total;
  updateVibeMatchBtn();
  showVibeMatchProgress();
});

socket.on("vibe-matched", async () => {
  hideVibeMatchProgress();
  hideVibeMatchBtn();
  try {
    vibeMatchCanvas = await captureVibeMatchedScreenshot();
    await showVibeMatchedModal(vibeMatchCanvas);
  } catch (err) {
    console.error("Screenshot failed:", err);
    addMessage("Vibe matched! (Screenshot unavailable in this browser.)", { isSystem: true });
  }
  myVibeMatchClicked = false;
  vibeMatchVoteCount = 0;
  showVibeMatchBtn();
  updateVibeMatchBtn();
});

// ─── SIGNAL ────────────────────────────────────────────────────────────────
// ICE candidates arriving before setRemoteDescription() are stored in
// peers[peerId].pending and flushed by flushPending() after SDP is set.
socket.on("signal", async ({ fromId, data }) => {
  // Create peer if none exists, OR if stub exists but pc hasn't been created yet
  if (!peers[fromId]?.pc) {
    if (!localStream) { try { await startCamera(); } catch { return; } }
    createPeer(fromId);
    const grid = $("videoGrid");
    if (grid && !$(`tile-${fromId}`)) grid.appendChild(buildRemoteTile(fromId));
    refreshLayout();
  }
  const pc = peers[fromId]?.pc;
  if (!pc) return;

  try {
    if (data.type === "offer") {
      if (pc.signalingState !== "stable" && pc.signalingState !== "have-remote-offer") {
        await pc.setLocalDescription({ type: "rollback" });
      }
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      await flushPending(fromId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { roomId, targetId: fromId, data: { type: answer.type, sdp: answer.sdp } });

    } else if (data.type === "answer") {
      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        await flushPending(fromId, pc);
      }

    } else if (data.candidate !== undefined) {
      if (!data.candidate) return;
      const candidate = new RTCIceCandidate(data);
      if (pc.remoteDescription?.type) {
        try { await pc.addIceCandidate(candidate); } catch (_) {}
      } else {
        // Buffer until remote description is ready
        if (!peers[fromId]) peers[fromId] = { pc: null, stream: null, filters: null, pending: [] };
        peers[fromId].pending.push(candidate);
      }
    }
  } catch (err) { console.error(`Signal error [${fromId.slice(0,8)}]:`, err); }
});

socket.on("chat-message", ({ fromId, message }) => addMessage(message, { fromId }));

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

  $("enterBtn")?.addEventListener("click",     enterRoom);
  $("muteBtn")?.addEventListener("click",      toggleMute);
  $("camBtn")?.addEventListener("click",       toggleCam);
  $("leaveBtn")?.addEventListener("click",     goBack);
  $("nextBtn")?.addEventListener("click",      doNext);
  $("vibeMatchBtn")?.addEventListener("click", requestVibeMatch);

  $("fallbackWaitBtn")?.addEventListener("click", hideFallbackModal);
  $("fallbackJoinBtn")?.addEventListener("click",  fallbackJoinAny);

  $("chatToggleBtn")?.addEventListener("click", () => $("chatPanel")?.classList.toggle("open"));
  $("chatClose")?.addEventListener("click",     () => $("chatPanel")?.classList.remove("open"));
  $("chatSendBtn")?.addEventListener("click",   sendMessage);

  const chatInput = $("chatInput");
  if (chatInput) {
    chatInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    chatInput.addEventListener("input",   () => updateCharCount(chatInput.value.length));
  }

  $("localPip")?.addEventListener("click",   togglePipOverlay);
  $("pipOverlay")?.addEventListener("click", closePipOverlay);

  startCamera().catch(() => {});
});
