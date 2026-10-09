import { useEffect, useState } from "react";
import { GAME_KINDS, GAME_META, type GameView } from "@shared/protocol";
import { socket } from "../lib/socket";
import { useApp, handleOf } from "../state";

function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function GamePicker({ onPicked }: { onPicked?: () => void }) {
  const room = useApp((s) => s.room);
  const count = room ? room.peers.length + 1 : 0;
  return (
    <div className="game-list">
      {GAME_KINDS.map((k) => {
        const m = GAME_META[k];
        const tooFew = count < m.min;
        return (
          <button
            key={k}
            className="game-item"
            disabled={tooFew}
            onClick={() => {
              socket.emit("game:propose", { kind: k });
              onPicked?.();
            }}
          >
            <span className="gi" style={{ background: m.color, boxShadow: k === "truth_or_dare" ? "inset 0 0 0 1px #cfc8ba" : undefined }}>
              {m.short}
            </span>
            <span className="meta">
              <b>{m.name}</b>
              <small>{tooFew ? `Needs ${m.min}+ people` : k === "truth_or_dare" && room?.vibe === "flirt" ? "Spicy pack is ON in this room" : m.desc}</small>
            </span>
            <span className="players">{m.min}–6</span>
          </button>
        );
      })}
    </div>
  );
}

export function GameBoard({ g }: { g: GameView }) {
  const room = useApp((s) => s.room);
  const now = useNow();
  const me = room?.you.id ?? "";
  const meta = GAME_META[g.kind];
  const left = Math.max(0, Math.ceil((g.deadline - now) / 1000));
  const players = room ? [room.you, ...room.peers] : [];
  const [stmts, setStmts] = useState(["", "", ""]);
  const [lie, setLie] = useState(2);

  const answer = (value: string) => socket.emit("game:answer", { value });
  const total = g.phase === "lobby" ? 20 : g.phase === "compose" ? 60 : g.phase === "reveal" ? (g.kind === "truth_or_dare" ? 30 : 6) : g.kind === "two_truths" ? 20 : g.kind === "truth_or_dare" ? 20 : 15;
  const pct = Math.min(100, (left / total) * 100);

  const myHandle = players.find((p) => p.id === me)?.handle;
  const note = (t?: string) => (t && myHandle ? t.split(myHandle).join("You") : t ?? "");
  const counts = (val: string) => (g.reveal ? Object.values(g.reveal.answers).filter((v) => v === val).length : 0);
  const maxCount = Math.max(1, ...((g.reveal && Object.values(g.reveal.answers).length ? Object.values(g.reveal.answers) : [""]) as string[]).map(counts));

  return (
    <div className="game">
      <div className="game-head">
        <span className="game-name" style={{ color: meta.kind === "truth_or_dare" ? "var(--text)" : "var(--accent-ink)" }}>
          {meta.name}
          {g.spicy && g.kind === "truth_or_dare" ? " · spicy" : ""}
        </span>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {g.phase === "lobby" ? "Ready up" : g.phase === "done" ? "Done" : `${g.round}/${g.totalRounds}`} · 0:{String(left).padStart(2, "0")}
        </span>
      </div>
      <div className="timer-bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </div>

      {g.phase === "lobby" && (
        <>
          <p className="game-prompt display">{meta.desc}</p>
          <div className="muted" style={{ fontSize: 13 }}>
            Ready: {g.ready.map(handleOf).join(", ")} ({g.ready.length}/{players.length})
          </div>
          {g.ready.includes(me) ? (
            <div className="game-note">Waiting for everyone to tap Ready…</div>
          ) : (
            <button className="btn-primary" onClick={() => socket.emit("game:ready")}>
              I’m in
            </button>
          )}
        </>
      )}

      {g.phase === "compose" &&
        (g.turn === me ? (
          <form
            className="compose"
            onSubmit={(e) => {
              e.preventDefault();
              if (stmts.some((s) => !s.trim())) return;
              socket.emit("game:answer", { value: String(lie), statements: stmts });
            }}
          >
            <p className="game-prompt display" style={{ fontSize: 18 }}>
              Write two truths and one lie. Pick which one is the lie.
            </p>
            {stmts.map((s, i) => (
              <label key={i}>
                <input type="radio" name="lie" checked={lie === i} onChange={() => setLie(i)} aria-label={`Statement ${i + 1} is the lie`} />
                <input
                  type="text"
                  value={s}
                  maxLength={90}
                  placeholder={`Statement ${i + 1}`}
                  onChange={(e) => setStmts((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </label>
            ))}
            <button className="btn-primary" type="submit">
              Lock it in
            </button>
          </form>
        ) : (
          <p className="game-prompt display">{g.prompt}</p>
        ))}

      {(g.phase === "question" || g.phase === "reveal") && (
        <>
          <p className="game-prompt display">{g.prompt}</p>

          {g.kind === "most_likely" ? (
            <div className="opt-list">
              {players
                .filter((p) => p.id !== me)
                .map((p) => (
                  <button key={p.id} className="opt" aria-pressed={g.myAnswer === p.id} disabled={g.phase !== "question"} onClick={() => answer(p.id)}>
                    {g.reveal && <i className="bar" style={{ width: `${(counts(p.id) / maxCount) * 100}%` }} />}
                    <span>{p.handle}</span>
                    {g.reveal && <span className="mono">{counts(p.id)}</span>}
                  </button>
                ))}
            </div>
          ) : g.kind === "two_truths" ? (
            <div className="opt-list">
              {g.options.map((o, i) => {
                const isLie = g.reveal?.answers["__lie"] === String(i);
                return (
                  <button
                    key={i}
                    className="opt"
                    aria-pressed={g.myAnswer === String(i)}
                    disabled={g.phase !== "question" || g.turn === me}
                    onClick={() => answer(String(i))}
                    style={isLie ? { borderColor: "var(--coral)" } : undefined}
                  >
                    <span>{o}</span>
                    {g.reveal && <span className="mono">{isLie ? "LIE" : counts(String(i))}</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="opt-grid">
              {g.options.map((o) => (
                <button
                  key={o}
                  className="opt"
                  aria-pressed={g.myAnswer === o}
                  disabled={g.phase !== "question" || (g.kind === "truth_or_dare" && g.turn !== me)}
                  onClick={() => answer(o)}
                >
                  {g.reveal && g.kind !== "truth_or_dare" && <i className="bar" style={{ width: `${(counts(o) / maxCount) * 100}%` }} />}
                  <span>{o}</span>
                </button>
              ))}
            </div>
          )}

          {g.phase === "question" && (
            <div className="muted" style={{ fontSize: 13 }}>
              {g.kind === "truth_or_dare"
                ? g.turn === me
                  ? "Your turn — pick one."
                  : `${handleOf(g.turn ?? "")} is choosing…`
                : g.kind === "two_truths" && g.turn === me
                  ? "Everyone’s guessing your lie…"
                  : `${g.answeredBy.length} answered`}
            </div>
          )}
          {g.reveal && <div className="game-note">{note(g.reveal.note)}</div>}
          {g.phase === "reveal" && g.kind === "truth_or_dare" && g.turn === me && (
            <button className="btn btn-inv" onClick={() => answer("next")}>
              Done — next turn
            </button>
          )}
        </>
      )}

      {g.phase === "done" && <div className="game-note">{note(g.reveal?.note)}</div>}

      {g.phase !== "lobby" && Object.keys(g.scores).length > 0 && (
        <div className="scores">
          {Object.entries(g.scores)
            .sort((a, b) => b[1] - a[1])
            .map(([id, n]) => (
              <span key={id} className="pill">
                {handleOf(id)} <b className="mono">{n}</b>
              </span>
            ))}
        </div>
      )}
      {g.phase !== "done" && (
        <button className="btn" style={{ height: 38, alignSelf: "flex-start", fontSize: 13 }} onClick={() => socket.emit("game:stop")}>
          End game
        </button>
      )}
    </div>
  );
}
