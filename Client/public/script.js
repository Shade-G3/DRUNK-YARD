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
    // STUN — multiple servers for redundancy
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    // TURN — openrelay (free public relay, last resort)
    // turns: (TLS port 443) punches through most corporate firewalls
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turns:openrelay.metered.ca:443",      // TLS — best NAT traversal
        "turn:openrelay.metered.ca:80?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    // TURN — numb.viagenie.ca (secondary free relay)
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
let localStream      = null;
let roomId           = null;
let sessionMode      = null;
let sessionStart     = null;
let timerInterval    = null;
let isMuted          = false;
let isCamOff         = false;
let pipMode          = false;
let pipOverlayOpen   = false;

// Queue / fallback
let queueTimeoutTimer = null;    // 10s timer to show fallback modal
let peerLeftTimer     = null;    // solo-mode: timer to auto-goBack when peer leaves
let isWaiting         = false;   // true while searching (between join and matched)

// Vibe-match voting
let myVibeMatchClicked = false;  // did I click the button?
let vibeMatchVoteCount = 0;      // how many others have voted (excluding me)
let vibeMatchTotalRoom = 2;      // room size (to compute denominator)
let vibeMatchCanvas    = null;   // captured canvas, kept for download

const peers            = {};  // peers[peerId] = { pc, stream }
const pendingCandidates = {}; // peerId → RTCIceCandidate[] buffered before remoteDescription is set
const selected         = { drink: null, vibe: null, mode: null };
const peerFiltersMap   = {}; // peerId → { drink, vibe, mode }

const VIBE_META = {
  chill:      { icon: "fa-moon",            label: "Chill" },
  "deep-talk":{ icon: "fa-comments",        label: "Deep Talk" },
  research:   { icon: "fa-magnifying-glass",label: "Research" },
  fun:        { icon: "fa-face-smile",      label: "Just Fun" },
  flirt:      { icon: "fa-heart",           label: "Flirty" },
  rant:       { icon: "fa-bolt",            label: "Rant Zone" },
  creative:   { icon: "fa-palette",         label: "Creative" },
  any:        { icon: "fa-dice",            label: "Any Vibe" },
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
  if (total === 5) {
    if (!pipMode) enterPipMode();
  } else {
    if (pipMode) exitPipMode();
  }
  const grid = $("videoGrid");
  if (grid) grid.className = `video-grid layout-${Math.max(1, total)}`;
}

// ─── PIP MODE ──────────────────────────────────────────────────────────────
function enterPipMode() {
  if (pipMode) return;
  pipMode = true;
  const localTile = $("tile-local");
  if (localTile) localTile.remove();
  const pip = $("localPip");
  if (pip) {
    const pipVideo = pip.querySelector("video");
    if (pipVideo && localStream) pipVideo.srcObject = localStream;
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
    if (grid) {
      const tile = buildLocalTile();
      grid.insertBefore(tile, grid.firstChild);
      attachLocalStream();
    }
  }
}

function togglePipOverlay() {
  if (pipOverlayOpen) closePipOverlay();
  else openPipOverlay();
}

function openPipOverlay() {
  const overlay = $("pipOverlay");
  if (!overlay) return;
  const video = overlay.querySelector("video");
  if (video && localStream) video.srcObject = localStream;
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
    const msg = err.name === "NotAllowedError"
      ? "Camera/mic blocked — allow access and refresh"
      : "Could not access camera: " + err.message;
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

// Show the peer's vibe/drink in the top-left of their tile.
// Highlights "different" vibes so both people know they crossed vibes.
function updateTileVibe(peerId) {
  const tile = $(`tile-${peerId}`);
  if (!tile) return;

  const filters = peerFiltersMap[peerId];
  if (!filters) return;

  // Remove previous badge if any
  tile.querySelector(".tile-vibe-badge")?.remove();

  const badge = document.createElement("div");
  badge.className = "tile-vibe-badge";

  const vm = VIBE_META[filters.vibe] || { icon: "fa-dice", label: filters.vibe || "any" };

  // "Different vibe" = neither side chose "any", and vibes are different
  const isDiffVibe = filters.vibe !== selected.vibe
    && filters.vibe  !== "any"
    && selected.vibe !== "any";

  badge.innerHTML = `<i class="fa-solid ${vm.icon}"></i> ${vm.label}`;
  if (isDiffVibe) badge.classList.add("tile-vibe-badge--different");

  tile.appendChild(badge);
}

function clearPeerFilters() {
  for (const k of Object.keys(peerFiltersMap)) delete peerFiltersMap[k];
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
}

// ─── PEER CONNECTION ───────────────────────────────────────────────────────
function createPeer(peerId) {
  if (peers[peerId]) return peers[peerId].pc;
  const pc = new RTCPeerConnection(ICE_CONFIG);
  peers[peerId]            = { pc, stream: null };
  pendingCandidates[peerId] = []; // buffer for candidates that arrive before remoteDescription

  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  // FIX: some browsers (especially mobile Safari) fire ontrack with streams[] empty.
  // Instead of bailing, build a MediaStream from event.track directly.
  pc.ontrack = (event) => {
    const incoming = event.streams?.[0];
    if (incoming) {
      peers[peerId].stream = incoming;
      attachStreamToTile(peerId, incoming);
    } else {
      // No stream attached — assemble one from the raw track
      if (!peers[peerId].stream) peers[peerId].stream = new MediaStream();
      peers[peerId].stream.addTrack(event.track);
      attachStreamToTile(peerId, peers[peerId].stream);
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && roomId) {
      socket.emit("signal", { roomId, targetId: peerId, data: candidate.toJSON() });
    }
  };

  // Log connection states to console so issues are diagnosable
  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC] ${peerId.slice(0,8)} → ${pc.connectionState}`);
    if (pc.connectionState === "failed") {
      console.warn(`[WebRTC] Restarting ICE for ${peerId.slice(0,8)}`);
      pc.restartIce();
    }
    // Media-flow watchdog: if connected but tile still shows placeholder, renegotiate
    if (pc.connectionState === "connected") {
      setTimeout(() => {
        const tile = $(`tile-${peerId}`);
        const placeholder = tile?.querySelector(".video-tile__placeholder");
        if (placeholder && placeholder.style.display !== "none") {
          console.warn(`[WebRTC] Connected but no media for ${peerId.slice(0,8)}, renegotiating`);
          pc.restartIce();
        }
      }, 5000);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[ICE] ${peerId.slice(0,8)} → ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === "failed") {
      console.warn(`[ICE] Failed for ${peerId.slice(0,8)}, restarting`);
      pc.restartIce();
    }
    if (pc.iceConnectionState === "disconnected") {
      setTimeout(() => {
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          handlePeerLeft(peerId);
        }
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
  delete pendingCandidates[peerId]; // clean up buffered candidates
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

// ─── QUEUE TIMEOUT (10s) ───────────────────────────────────────────────────
function startQueueTimeout() {
  clearQueueTimeout();
  queueTimeoutTimer = setTimeout(() => {
    queueTimeoutTimer = null;
    if (!roomId) showFallbackModal(); // still searching
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

function fallbackWait() {
  // Stay in queue, just dismiss the modal
  hideFallbackModal();
}

function fallbackJoinAny() {
  hideFallbackModal();
  clearQueueTimeout();
  // Leave current queue, rejoin with any/any (keep same mode)
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
    const myVote = 1;
    const otherVotes = vibeMatchVoteCount;
    const total = vibeMatchTotalRoom;
    if (label) label.textContent = `${myVote + otherVotes}/${total} voted`;
  } else {
    btn.classList.remove("ctrl-btn--voted");
    if (vibeMatchVoteCount > 0) {
      if (label) label.textContent = `${vibeMatchVoteCount} voted — click!`;
    } else {
      if (label) label.textContent = "Vibe Match";
    }
  }
}

function requestVibeMatch() {
  if (!roomId || myVibeMatchClicked) return;
  myVibeMatchClicked = true;
  socket.emit("vibe-match-request", { roomId });
  updateVibeMatchBtn();

  // Update in-room progress toast
  showVibeMatchProgress();
}

function showVibeMatchProgress() {
  const el = $("vibeMatchProgress");
  if (!el) return;
  el.style.display = "flex";
  const text = $("vibeMatchProgressText");
  const voted = (myVibeMatchClicked ? 1 : 0) + vibeMatchVoteCount;
  if (text) text.textContent = `${voted}/${vibeMatchTotalRoom} voted for Vibe Match…`;
}

function hideVibeMatchProgress() {
  const el = $("vibeMatchProgress");
  if (el) el.style.display = "none";
}

// ─── SCREENSHOT CAPTURE ────────────────────────────────────────────────────
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function captureVibeMatchedScreenshot() {
  const grid = $("videoGrid");
  const tiles = [...grid.querySelectorAll(".video-tile")];

  const gridRect = grid.getBoundingClientRect();
  const W = Math.floor(gridRect.width)  || 800;
  const H = Math.floor(gridRect.height) || 600;

  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background
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

    // Tile background
    ctx.fillStyle = "#010409";
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, 10);
    ctx.fill();

    // Video frame
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      try {
        ctx.save();
        ctx.beginPath();
        roundRectPath(ctx, x, y, w, h, 10);
        ctx.clip();
        ctx.drawImage(video, x, y, w, h);
        ctx.restore();
      } catch (_) { /* video frame not available */ }
    }
  }

  // Subtle cyan tint overlay
  ctx.fillStyle = "rgba(56,189,248,0.06)";
  ctx.fillRect(0, 0, W, H);

  // Watermark strip
  const stamp = `DRUNKYARD · Vibe Matched · ${new Date().toLocaleString()}`;
  const fSize = Math.max(11, Math.round(W * 0.016));
  ctx.font = `600 ${fSize}px Inter, sans-serif`;
  const textW = ctx.measureText(stamp).width + 20;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(W / 2 - textW / 2, H - fSize * 2.2, textW, fSize * 1.9);
  ctx.fillStyle = "rgba(255,255,255,.88)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
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
      a.href     = canvas.toDataURL("image/png");
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
  // Apply vibe room theme — triggers CSS [data-vibe] overrides
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
  // Stop camera tracks — camera light should be off on the selection screen
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  $("videoRoom").style.display       = "none";
  $("videoRoom").removeAttribute("data-vibe");  // reset vibe theme
  $("selectionScreen").style.display = "flex";
  stopTimer();
  setStatus("Choose your vibe");
  const msgs = $("messages");
  if (msgs) msgs.innerHTML = "";
  $("chatPanel")?.classList.remove("open");
  clearPeerFilters();
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
  removeTile(peerId);
  delete peerFiltersMap[peerId];
  refreshLayout();
  addSystemMessage("A stranger left the yard.");
  const total = getTotalParticipants();
  if (sessionMode === "solo") peerLeftTimer = setTimeout(goBack, 1800);
  else {
    setStatus(`Live · ${total} ${total === 1 ? "person" : "people"}`, true);
    // Recalculate room size for vibe-match denominator
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
  clearPeerFilters();
  hideVibeMatchBtn();
  hideVibeMatchProgress();
  closeAllPeers(); stopTimer();
  roomId = null; sessionMode = null; // clear stale room state so stale ICE signals don't leak
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
socket.on("connect_error", ()  => setStatus("Reconnecting…"));

// On reconnect the server has already cleaned up rooms and queues.
// If we were in a room or mid-session, bail out to selection screen.
// If we were searching (no room yet), re-emit join so we re-enter the queue.
socket.on("reconnect", () => {
  clearQueueTimeout();
  if (roomId || sessionMode) {
    // Server destroyed the room — clean up and send user back
    closeAllPeers();
    stopTimer();
    roomId = null; sessionMode = null;
    showSelectionScreen();
    setTimeout(() => setStatus("Reconnected — start a new session"), 50);
  } else if (isWaiting && selected.drink && selected.vibe && selected.mode) {
    // Was in the queue — re-join automatically
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
    const di = DRINK_ICONS[drink] || "";
    const vi = VIBE_META[vibe]?.icon || "";
    pill.innerHTML = `<i class="fa-solid ${di}"></i> <i class="fa-solid ${vi}"></i> ${count} waiting`;
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
  // Give them 2.5s to read the error, then return to selection screen
  setTimeout(showSelectionScreen, 2500);
});

socket.on("matched", async ({ roomId: id, role, mode, peers: peerIds, peerFilters: pf }) => {
  roomId = id; sessionMode = mode;
  isWaiting = false;
  clearQueueTimeout();
  hideFallbackModal();
  hideWaiting();

  // Store peer filters for vibe badge display
  if (pf) {
    for (const [peerId, filters] of Object.entries(pf)) {
      peerFiltersMap[peerId] = filters;
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
      // Camera denied/revoked — notify server we can't participate, return to selection
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
    updateTileVibe(peerId); // show vibe badge
    if (role === "caller" || role === "joiner") await callPeer(peerId);
  }

  refreshLayout();
  showVibeMatchBtn();
  addSystemMessage(`You joined the yard. ${peerIds.length} ${peerIds.length === 1 ? "stranger" : "strangers"} here.`);

  // Notify if this was a cross-vibe match
  if (pf) {
    const diffVibes = Object.values(pf).filter(f =>
      f.vibe !== selected.vibe && f.vibe !== "any" && selected.vibe !== "any"
    );
    if (diffVibes.length > 0) {
      addSystemMessage("Matched across vibes — their vibe is shown in the corner.");
    }
  }
});

socket.on("peer-joined", async ({ peerId, filters }) => {
  const grid = $("videoGrid");
  if (grid && !$(`tile-${peerId}`)) grid.appendChild(buildRemoteTile(peerId));
  createPeer(peerId);

  if (filters) {
    peerFiltersMap[peerId] = filters;
    updateTileVibe(peerId);
  }

  vibeMatchTotalRoom = getTotalParticipants();
  refreshLayout();
  addSystemMessage("Someone just walked into the yard.");
  setStatus(`Live · ${getTotalParticipants()} people`, true);
  updateVibeMatchBtn();
});

socket.on("peer-left", ({ peerId }) => handlePeerLeft(peerId));

// ─── VIBE MATCH EVENTS ─────────────────────────────────────────────────────

// Another person in the room voted but not everyone has yet
socket.on("vibe-match-vote", ({ count, total }) => {
  vibeMatchVoteCount = myVibeMatchClicked ? count - 1 : count;
  vibeMatchTotalRoom = total;
  updateVibeMatchBtn();
  showVibeMatchProgress();
});

// ALL people voted — take screenshot and show modal
socket.on("vibe-matched", async () => {
  hideVibeMatchProgress();
  hideVibeMatchBtn();

  try {
    vibeMatchCanvas = await captureVibeMatchedScreenshot();
    await showVibeMatchedModal(vibeMatchCanvas);
  } catch (err) {
    console.error("Screenshot failed:", err);
    addSystemMessage("Vibe matched! (Screenshot unavailable in this browser.)");
  }

  // Reset vote state (conversation continues)
  myVibeMatchClicked = false;
  vibeMatchVoteCount = 0;
  showVibeMatchBtn(); // re-show so they can match again
  updateVibeMatchBtn();
});

// ─── SIGNAL ────────────────────────────────────────────────────────────────
// KEY FIX: ICE candidates that arrive before setRemoteDescription() completes
// are buffered in pendingCandidates[peerId] and flushed immediately after.
// Without this, candidates are silently dropped and cross-device media never flows.
socket.on("signal", async ({ fromId, data }) => {
  // Lazily create peer + tile if we receive a signal before matched event fires
  if (!peers[fromId]) {
    if (!localStream) { try { await startCamera(); } catch { return; } }
    createPeer(fromId);
    const grid = $("videoGrid");
    if (grid && !$(`tile-${fromId}`)) grid.appendChild(buildRemoteTile(fromId));
    refreshLayout(); // always sync layout — receiver's tile pre-exists from matched but peers map was empty until now
  }
  const pc = peers[fromId]?.pc;
  if (!pc) return;

  try {
    if (data.type === "offer") {
      // Rollback any in-progress local offer (glare condition)
      if (pc.signalingState !== "stable" && pc.signalingState !== "have-remote-offer") {
        await pc.setLocalDescription({ type: "rollback" });
      }
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      // Flush any ICE candidates that arrived before the offer was processed
      const buffered = pendingCandidates[fromId] ?? [];
      pendingCandidates[fromId] = [];
      for (const c of buffered) {
        try { await pc.addIceCandidate(c); } catch (_) {}
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { roomId, targetId: fromId, data: { type: answer.type, sdp: answer.sdp } });

    } else if (data.type === "answer") {
      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        // Flush buffered candidates for the caller side too
        const buffered = pendingCandidates[fromId] ?? [];
        pendingCandidates[fromId] = [];
        for (const c of buffered) {
          try { await pc.addIceCandidate(c); } catch (_) {}
        }
      }

    } else if (data.candidate !== undefined) {
      // ICE candidate — buffer if remote description not set yet
      if (!data.candidate) return; // null candidate = gathering complete, ignore
      const candidate = new RTCIceCandidate(data);
      if (pc.remoteDescription && pc.remoteDescription.type) {
        // Remote description ready — add immediately
        try { await pc.addIceCandidate(candidate); } catch (_) {}
      } else {
        // Remote description not yet set — buffer for later
        if (!pendingCandidates[fromId]) pendingCandidates[fromId] = [];
        pendingCandidates[fromId].push(candidate);
      }
    }
  } catch (err) { console.error(`Signal error [${fromId.slice(0,8)}]:`, err); }
});

socket.on("chat-message", ({ fromId, message }) => addChatMessage(message, fromId, false));

// ─── DOM READY ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

  // Filter / mode selection
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

  // Session controls
  $("enterBtn")?.addEventListener("click",    enterRoom);
  $("muteBtn")?.addEventListener("click",     toggleMute);
  $("camBtn")?.addEventListener("click",      toggleCam);
  $("leaveBtn")?.addEventListener("click",    goBack);
  $("nextBtn")?.addEventListener("click",     doNext);
  $("vibeMatchBtn")?.addEventListener("click", requestVibeMatch);

  // Fallback modal buttons
  $("fallbackWaitBtn")?.addEventListener("click", fallbackWait);
  $("fallbackJoinBtn")?.addEventListener("click",  fallbackJoinAny);

  // Chat
  $("chatToggleBtn")?.addEventListener("click", () => $("chatPanel")?.classList.toggle("open"));
  $("chatClose")?.addEventListener("click",     () => $("chatPanel")?.classList.remove("open"));
  $("chatSendBtn")?.addEventListener("click",   sendMessage);

  const chatInput = $("chatInput");
  if (chatInput) {
    chatInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    chatInput.addEventListener("input",   () => updateCharCount(chatInput.value.length));
  }

  // PiP controls
  $("localPip")?.addEventListener("click",   togglePipOverlay);
  $("pipOverlay")?.addEventListener("click", closePipOverlay);

  // Pre-warm camera permission
  startCamera().catch(() => {});
});
