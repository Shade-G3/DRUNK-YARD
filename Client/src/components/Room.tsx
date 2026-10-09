import { useEffect, useState } from "react";
import { DRINK_LABEL, VIBE_LABEL, type PeerInfo, type Reaction } from "@shared/protocol";
import { socket } from "../lib/socket";
import { useApp, colorFor, initials, giveCheers } from "../state";
import { StreamVideo } from "./Video";
import { GameBoard, GamePicker } from "./Game";
import { ChatPanel } from "./Sheets";
import { ThemeToggle } from "./Lobby";
import * as I from "./Icons";

function useElapsed(since: number) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.floor((Date.now() - since) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function Tile({ peer, local }: { peer: PeerInfo; local?: boolean }) {
  const { streams, conn, glows, met, mic, cam } = useApp();
  const stream = local ? useApp.getState().local : streams[peer.id] ?? null;
  const state = conn[peer.id];
  const [touch, setTouch] = useState(false);
  const glow = glows[peer.id];
  const cheered = met[peer.id]?.iCheered;
  const showVideo = !!stream && (local ? cam : true);
  const connecting = !local && (!stream || (state && state !== "connected"));

  return (
    <div
      id={`tile-${peer.id}`}
      className={`tile ${local ? "local" : "remote"} ${touch ? "touch" : ""} ${glow !== undefined ? `glow-${glow}` : ""}`}
      onClick={() => !local && setTouch((t) => !t)}
    >
      {showVideo && <StreamVideo stream={stream} muted={local} />}
      {(!showVideo || connecting) && (
        <div className="ph">
          <span className="avatar" style={{ background: colorFor(peer.id) }}>
            {initials(peer.handle)}
          </span>
          {connecting && (
            <span style={{ textAlign: "center", padding: "0 12px" }}>
              {state === "failed" ? "Video couldn’t connect on this network. Chat still works — try Next." : "Connecting video…"}
            </span>
          )}
        </div>
      )}
      <div className="tile-tags">
        <span className="tag">{local ? "You" : peer.handle}</span>
        <span className="tag soft">{DRINK_LABEL[peer.drink]}</span>
        {!local && peer.cheers > 0 && (
          <span className="tag soft" title="Cheers received">
            <I.Star size={12} /> {peer.cheers}
          </span>
        )}
        {local && !mic && (
          <span className="tag mute-ind">
            <I.MicOff size={12} />
          </span>
        )}
      </div>
      {!local && (
        <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
          <button aria-label={cheered ? `You cheered ${peer.handle}` : `Give ${peer.handle} cheers`} onClick={() => giveCheers(peer.id)} style={cheered ? { color: "#C8F560" } : undefined}>
            <I.Star size={18} />
          </button>
          <button aria-label={`Buy ${peer.handle} a drink`} onClick={() => useApp.getState().openSheet("gift", peer.id)}>
            <I.Glass size={18} />
          </button>
          <button aria-label={`Report ${peer.handle}`} onClick={() => useApp.getState().openSheet("report", peer.id)} style={{ color: "#FF6B5B" }}>
            <I.Flag size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

const REACTS: { kind: Reaction; icon: JSX.Element; color: string; label: string }[] = [
  { kind: "cheers", icon: <I.Star size={22} />, color: "var(--accent-ink)", label: "Cheers" },
  { kind: "laugh", icon: <I.Laugh size={22} />, color: "var(--amber)", label: "Laugh" },
  { kind: "fire", icon: <I.Fire size={22} />, color: "var(--coral)", label: "Fire" },
  { kind: "heart", icon: <I.Heart size={22} />, color: "#F49BC1", label: "Heart" },
];

export function Room() {
  const { room, game, sideTab, unread, mic, cam, prefs } = useApp();
  const { toggleMic, toggleCam, openSheet, setSideTab, next, leave } = useApp.getState();
  const elapsed = useElapsed(room?.startedAt ?? Date.now());
  const [gameMin, setGameMin] = useState(false);
  const phase = game?.phase;
  useEffect(() => {
    if (phase === "question" || phase === "lobby" || phase === "compose") setGameMin(false); // pop back up when you need to act
  }, [phase, game?.round]);
  if (!room) return null;
  const n = room.peers.length + 1;
  const duo = room.size === 2;

  return (
    <div className="room">
      <header className="room-top">
        <div className="wordmark desk-only">
          drunk<span>yard</span>
        </div>
        <div className="info">
          <span className="pill">{VIBE_LABEL[room.vibe]} · {duo ? "1-on-1" : `${n}/${room.size}`}</span>
          <span className="pill">
            <span className="dot live" />
            <span className="mono">{elapsed}</span>
          </span>
        </div>
        <span className="spacer" />
        {!duo && n < room.size && (
          <span className="muted desk-only" style={{ fontSize: 13 }}>
            Open seats: {room.size - n}
          </span>
        )}
        {!(prefs.bar && prefs.drink !== "sober") && <ThemeToggle />}
      </header>

      <div className="stage-wrap">
        <div className="stage">
          <div className={`grid ${duo ? "duo" : ""}`} data-n={duo ? 2 : n}>
            {duo && room.peers.length === 0 && (
              <div className="tile remote">
                <div className="ph">Waiting for someone…</div>
              </div>
            )}
            {room.peers.map((p) => (
              <Tile key={p.id} peer={p} />
            ))}
            <Tile peer={room.you} local />
          </div>

          <div className="phone-only" style={{ position: "absolute", right: 10, top: duo ? 150 : "auto", bottom: duo ? "auto" : 10, display: "flex", flexDirection: "column", gap: 8, zIndex: 7 }}>
            {REACTS.slice(0, 3).map((r) => (
              <button key={r.kind} className="icon-btn" style={{ background: "var(--glass)", color: r.color }} aria-label={r.label} onClick={() => socket.emit("react", { kind: r.kind })}>
                {r.icon}
              </button>
            ))}
          </div>

          {game &&
            (gameMin ? (
              <button className="game-float phone-only btn" style={{ right: "auto", height: 44, padding: "0 14px" }} onClick={() => setGameMin(false)}>
                <I.Dice size={16} /> Game on · tap to open
              </button>
            ) : (
              <div className="game-float phone-only" style={{ right: 66 }}>
                <button className="icon-btn" style={{ position: "absolute", top: 8, right: 8, width: 36, height: 36 }} onClick={() => setGameMin(true)} aria-label="Minimise game">
                  <I.Close size={16} />
                </button>
                <GameBoard g={game} />
              </div>
            ))}
        </div>

        <aside className="side">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={sideTab === "game"} onClick={() => setSideTab("game")}>
              {game ? "Game · live" : "Games"}
            </button>
            <button role="tab" aria-selected={sideTab === "chat"} onClick={() => setSideTab("chat")}>
              Chat{unread ? ` (${unread})` : ""}
            </button>
          </div>
          <section className="panel">
            {sideTab === "chat" ? (
              <ChatPanel />
            ) : game ? (
              <GameBoard g={game} />
            ) : (
              <>
                <div>
                  <h2 className="display" style={{ margin: 0, fontSize: 22 }}>
                    Play something
                  </h2>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                    Starts when everyone taps Ready
                  </p>
                </div>
                <GamePicker />
              </>
            )}
          </section>
          <div className="row" style={{ justifyContent: "center" }}>
            {REACTS.map((r) => (
              <button key={r.kind} className="icon-btn" style={{ color: r.color }} aria-label={r.label} onClick={() => socket.emit("react", { kind: r.kind })}>
                {r.icon}
              </button>
            ))}
          </div>
        </aside>
      </div>

      <nav className="dock" aria-label="Call controls">
        <button className={`d-btn ${mic ? "" : "off"}`} onClick={toggleMic} aria-label={mic ? "Mute" : "Unmute"} aria-pressed={!mic}>
          {mic ? <I.Mic /> : <I.MicOff />}
        </button>
        <button className={`d-btn ${cam ? "" : "off"}`} onClick={toggleCam} aria-label={cam ? "Turn camera off" : "Turn camera on"} aria-pressed={!cam}>
          {cam ? <I.Cam /> : <I.CamOff />}
        </button>
        <button className="d-btn on phone-only" onClick={() => openSheet("games")} aria-label="Games">
          <I.Dice />
        </button>
        <button className="d-btn" onClick={() => openSheet("gift", room.peers.length === 1 ? room.peers[0].id : null)} aria-label="Send a drink" style={{ color: "var(--accent-ink)" }} disabled={!room.peers.length}>
          <I.Glass />
        </button>
        <button className="d-btn phone-only" onClick={() => openSheet("chat")} aria-label="Chat">
          <I.Chat />
          {unread > 0 && <span className="badge">{unread}</span>}
        </button>
        <button className="d-btn desk-only" onClick={() => openSheet("report", room.peers.length === 1 ? room.peers[0].id : null)} aria-label="Report" style={{ color: "var(--coral)" }} disabled={!room.peers.length}>
          <I.Flag />
        </button>
        <button className="next" onClick={next}>
          Next <I.Next size={18} />
        </button>
        <button className="leave" onClick={leave} aria-label="Leave">
          <I.Leave size={18} />
        </button>
      </nav>
    </div>
  );
}
