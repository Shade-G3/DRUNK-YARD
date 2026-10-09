import { socket } from "../lib/socket";
import { useApp, colorFor, initials, giveCheers } from "../state";
import * as I from "./Icons";

export function Recap() {
  const { met, recapStats, me } = useApp();
  const { backToLobby, findRoom } = useApp.getState();
  const people = Object.values(met).sort((a, b) => Number(!!b.mutualToken) - Number(!!a.mutualToken) || b.seconds - a.seconds);
  const mins = Math.floor(recapStats.seconds / 60);
  const secs = recapStats.seconds % 60;

  const badges: { label: string; color: string; earned: boolean }[] = [
    { label: "Icebreaker", color: "var(--amber)", earned: people.length >= 3 },
    { label: "Night Owl", color: "var(--blue)", earned: new Date().getHours() >= 23 || new Date().getHours() < 4 },
    { label: "Game Night", color: "var(--accent-ink)", earned: recapStats.gamesPlayed > 0 },
    { label: "Life of the party", color: "var(--coral)", earned: recapStats.cheersGot >= 3 },
  ];

  return (
    <main className="recap">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="mono muted" style={{ fontSize: 12 }}>
          SESSION ENDED · {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </span>
        <h1 className="display">Who made your night?</h1>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Give cheers. If it’s mutual, you can call them again within 24 hours.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {people.length === 0 && <p className="muted">You didn’t meet anyone this time.</p>}
        {people.map((p) => {
          const sub = p.mutualToken ? "Mutual cheers · call again for 24h" : p.theyCheered ? "Cheered you" : p.seconds ? `Talked ${Math.max(1, Math.round(p.seconds / 60))} min` : "Said hi";
          return (
            <div key={p.id} className="person">
              <span className="avatar" style={{ background: colorFor(p.id) }}>
                {initials(p.handle)}
              </span>
              <span className="meta">
                <b>{p.handle}</b>
                <small className={p.mutualToken || p.theyCheered ? "good" : ""}>{sub}</small>
              </span>
              {p.mutualToken ? (
                <button className="btn-primary" style={{ height: 40, fontSize: 14, padding: "0 14px", borderRadius: 12 }} onClick={() => socket.emit("callagain:request", { token: p.mutualToken! })}>
                  Call again
                </button>
              ) : (
                <button
                  className={`btn ${p.iCheered ? "" : "btn-inv"}`}
                  style={{ height: 40, fontSize: 14 }}
                  aria-pressed={p.iCheered}
                  disabled={p.iCheered}
                  onClick={() => giveCheers(p.id)}
                  title={p.iCheered ? "Cheered" : "Cheers only count while you're in the room"}
                >
                  <I.Star size={16} /> {p.iCheered ? "Cheered" : "Cheers"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <section className="shelf-card">
        <b className="display" style={{ fontSize: 16 }}>
          Your night
        </b>
        <div className="stats">
          <div className="stat">
            <b style={{ color: "var(--accent-ink)" }}>{recapStats.cheersGot}</b>
            <small>cheers got</small>
          </div>
          <div className="stat">
            <b>{recapStats.giftsGot}</b>
            <small>drinks got</small>
          </div>
          <div className="stat">
            <b>{(me?.coins ?? 0).toLocaleString("en-IN")}</b>
            <small>coins left</small>
          </div>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {badges.map((b) => (
            <span key={b.label} className="badge-pill" style={b.earned ? { borderColor: b.color, color: b.color } : { borderStyle: "dashed", borderColor: "var(--line2)", color: "var(--faint)", fontWeight: 500 }}>
              {b.label}
              {b.earned ? "" : " · locked"}
            </span>
          ))}
        </div>
      </section>

      <div className="spacer" />
      <button className="btn-primary" onClick={() => void findRoom()}>
        Find the next room <I.Arrow />
      </button>
      <button className="btn" onClick={backToLobby}>
        Back to the lobby
      </button>
    </main>
  );
}
