/** "Add someone": ask the table, then find a stranger (any vibe) or share a friend link. */
import { useEffect, useState } from "react";
import { MAX_ROOM, VIBES, VIBE_LABEL, type Vibe } from "@shared/protocol";
import { socket } from "../lib/socket";
import { useApp, handleOf } from "../state";
import { Sheet } from "./Sheets";
import * as I from "./Icons";

function useCountdown(deadline: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.ceil((deadline - now) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

const close = () => useApp.getState().openSheet(null);

export function SeatSheet() {
  const room = useApp((s) => s.room);
  const [vibe, setVibe] = useState<Vibe>(room?.vibe ?? "any");
  if (!room) return null;
  const n = room.peers.length + 1;
  const full = n >= MAX_ROOM;
  const ask = (mode: "match" | "link") => {
    socket.emit("seat:request", { mode, vibe });
    close();
  };
  return (
    <Sheet label="Add someone to the table" onClose={close}>
      <h2 className="display">Add someone</h2>
      <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
        Everyone at the table has to say yes first. Max {MAX_ROOM} people.
      </p>
      {full ? (
        <div className="game-note" style={{ marginTop: 14 }}>The table is full ({MAX_ROOM}/{MAX_ROOM}).</div>
      ) : n < 2 ? (
        <div className="game-note" style={{ marginTop: 14 }}>Wait until someone has joined you.</div>
      ) : (
        <div className="seat-options">
          <section>
            <h3>A new person</h3>
            <div className="chips" aria-label="Their vibe">
              {VIBES.map((v) => (
                <button key={v} className="chip" aria-pressed={vibe === v} onClick={() => setVibe(v)}>
                  {v === room.vibe ? `${VIBE_LABEL[v]} (same)` : VIBE_LABEL[v]}
                </button>
              ))}
            </div>
            <button className="btn-primary" onClick={() => ask("match")}>
              <I.UserPlus size={18} /> Ask the table
            </button>
          </section>
          <section>
            <h3>A friend</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Get a one-time link (works for 10 minutes). Only your friend can use it.
            </p>
            <button className="btn" onClick={() => ask("link")}>
              <I.Link size={18} /> Create invite link
            </button>
          </section>
        </div>
      )}
    </Sheet>
  );
}

/** Banner under the room header while a seat request is in progress. */
export function SeatBar() {
  const seat = useApp((s) => s.seat);
  const room = useApp((s) => s.room);
  const toast = useApp((s) => s.toast);
  const left = useCountdown(seat?.deadline ?? 0);
  if (!seat || !room) return null;
  const me = room.you.id;
  const total = room.peers.length + 1;
  const who = seat.by === me ? "You" : handleOf(seat.by);
  const link = seat.token ? `${window.location.origin}/?join=${seat.token}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied — send it to your friend.");
    } catch {
      toast("Couldn't copy — long-press the link to copy it.", { err: true });
    }
  };
  const share = () => {
    navigator.share?.({ title: "Join my table on Drunk Yard", text: "Pull up a chair 🍻", url: link }).catch(() => {});
  };

  if (seat.stage === "vote") {
    const voted = seat.yes.includes(me);
    return (
      <div className="seat-bar" role="alert">
        <I.UserPlus size={18} />
        <span className="spacer">
          {seat.mode === "link" ? (
            <><b>{who}</b> {seat.by === me ? "want" : "wants"} to invite a friend.</>
          ) : (
            <><b>{who}</b> {seat.by === me ? "want" : "wants"} to add someone ({VIBE_LABEL[seat.vibe]}).</>
          )}{" "}
          {voted && <span className="muted">Waiting for everyone · {seat.yes.length}/{total}</span>}
        </span>
        {!voted ? (
          <>
            <button className="btn btn-sm" onClick={() => socket.emit("seat:vote", { yes: false })}>No</button>
            <button className="btn-primary btn-sm" onClick={() => socket.emit("seat:vote", { yes: true })}>Yes</button>
          </>
        ) : (
          <button className="btn btn-sm" onClick={() => socket.emit("seat:cancel")} hidden={seat.by !== me}>Cancel</button>
        )}
        <span className="mono muted">{left}</span>
      </div>
    );
  }

  return (
    <div className="seat-bar" role="status">
      {seat.mode === "link" ? <I.Link size={18} /> : <span className="dot live" />}
      <span className="spacer">
        {seat.mode === "match" ? (
          <>Looking for 1 more ({VIBE_LABEL[seat.vibe]})…</>
        ) : seat.token ? (
          <span className="seat-link">
            <span>Send this to your friend:</span>
            <code onClick={copy}>{link}</code>
          </span>
        ) : (
          <>Waiting for {who}’s friend…</>
        )}
      </span>
      {seat.token && (
        <>
          <button className="btn-primary btn-sm" onClick={copy}>Copy</button>
          {"share" in navigator && <button className="btn btn-sm" onClick={share}>Share</button>}
        </>
      )}
      <button className="btn btn-sm" onClick={() => socket.emit("seat:cancel")}>Cancel</button>
      <span className="mono muted">{left}</span>
    </div>
  );
}
