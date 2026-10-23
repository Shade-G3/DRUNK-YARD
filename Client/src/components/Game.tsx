import { useEffect, useRef, useState } from "react";
import { BluffBoard, ImposterBoard } from "./PartyGames";
import { GAME_KINDS, GAME_META, GUESS_GAMES, LIMITS, type GameView } from "@shared/protocol";
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
        if (k === "imposter")
          return (
            <div key={k} className="game-item game-item-split" aria-disabled={tooFew}>
              <span className="gi" style={{ background: m.color }}>{m.short}</span>
              <span className="meta">
                <b>{m.name}</b>
                <small>{tooFew ? `Needs ${m.min}+ people — tap Add to bring more` : m.desc}</small>
                {!tooFew && (
                  <span className="mode-row">
                    <button className="btn btn-sm" onClick={() => { socket.emit("game:propose", { kind: k, mode: "undercover" }); onPicked?.(); }}>
                      Undercover word
                    </button>
                    <button className="btn btn-sm" onClick={() => { socket.emit("game:propose", { kind: k, mode: "blank" }); onPicked?.(); }}>
                      Imposter gets nothing
                    </button>
                  </span>
                )}
              </span>
              <span className="players">{m.min}–6</span>
            </div>
          );
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
  const guessGame = GUESS_GAMES.includes(g.kind);
  const party = g.kind === "imposter" || g.kind === "bluff";
  const total = g.duration ? g.duration / 1000 :
    g.phase === "lobby" ? 20
    : g.phase === "compose" ? (g.kind === "guess_number" ? 20 : 60)
    : g.phase === "reveal" ? (g.kind === "truth_or_dare" ? 30 : 6)
    : g.kind === "guess_number" ? 45
    : g.kind === "emoji_decode" ? 40
    : guessGame ? 60
    : g.kind === "two_truths" || g.kind === "truth_or_dare" ? 20 : 15;
  const pct = Math.min(100, (left / total) * 100);

  const myHandle = players.find((p) => p.id === me)?.handle;
  // Server text names people; swap your own name for "You" and fix the grammar ("You is" → "You are").
  const note = (t?: string) => {
    if (!t || !myHandle) return t ?? "";
    return t
      .split(`${myHandle} is `).join("You are ")
      .split(`${myHandle} was `).join("You were ")
      .split(`${myHandle} says`).join("You say")
      .split(`${myHandle} wins`).join("You win")
      .split(`${myHandle} gets`).join("You get")
      .split(`${myHandle} gives`).join("You give")
      .split(`${myHandle} picks`).join("You pick")
      .split(`${myHandle} starts`).join("You start")
      .split(`${myHandle} emptied their`).join("You emptied your")
      .split(`${myHandle}: play`).join("You: play")
      .split(myHandle).join("You");
  };
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

      {guessGame && g.phase !== "lobby" && g.phase !== "done" && <GuessBoard g={g} me={me} note={note} />}
      {g.kind === "imposter" && g.phase !== "lobby" && g.phase !== "done" && <ImposterBoard g={g} me={me} note={note} />}
      {g.kind === "bluff" && g.phase !== "lobby" && g.phase !== "done" && <BluffBoard g={g} me={me} note={note} />}

      {!guessGame && !party && g.phase === "compose" &&
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

      {!guessGame && !party && (g.phase === "question" || g.phase === "reveal") && (
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

      {g.phase !== "lobby" && !(g.kind === "bluff" && g.phase !== "done") && Object.keys(g.scores).length > 0 && (
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

const VERDICT: Record<GameView["guesses"][number]["verdict"], { label: string; cls: string }> = {
  higher: { label: "Higher ↑", cls: "v-hi" },
  lower: { label: "Lower ↓", cls: "v-lo" },
  correct: { label: "Got it!", cls: "v-ok" },
  wrong: { label: "Nope", cls: "v-no" },
};

/** Guess My Number · Which Animal Am I · Guess My Object · Emoji Decode */
function GuessBoard({ g, me, note }: { g: GameView; me: string; note: (t?: string) => string }) {
  const [text, setText] = useState("");
  const feedRef = useRef<HTMLOListElement>(null);
  const myTurn = g.turn === me;
  const isNumber = g.kind === "guess_number";
  useEffect(() => setText(""), [g.round, g.phase]);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [g.guesses.length]);

  const canGuess =
    g.phase === "question" &&
    (g.kind === "which_animal" ? myTurn : g.kind === "emoji_decode" ? true : !myTurn);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    socket.emit("game:answer", { value: v });
    setText("");
  };

  // What the secret card says, per game and per person.
  let card: { label: string; value: string; hint: string } | null = null;
  if (g.phase === "question" || g.phase === "compose") {
    if (g.kind === "guess_number" && myTurn && g.secret)
      card = { label: "Your secret number", value: g.secret, hint: "The yard sees Higher / Lower on every guess." };
    if (g.kind === "guess_object" && myTurn && g.secret)
      card = { label: "Describe this — don’t say it!", value: g.secret, hint: "Use actions, sounds, what it’s for…" };
    if (g.kind === "which_animal" && !myTurn && g.secret)
      card = { label: `${handleOf(g.turn ?? "")} is…`, value: g.secret, hint: "Shh! Only answer yes / no out loud." };
    if (g.kind === "which_animal" && myTurn)
      card = { label: "You are…", value: "??? 🐾", hint: "Everyone else can see it. Ask yes/no questions, then type your guess." };
  }

  return (
    <>
      <p className={`game-prompt display${g.kind === "emoji_decode" ? " emoji-clue" : ""}`}>{note(g.prompt)}</p>
      {g.kind === "emoji_decode" && g.phase === "question" && <div className="muted" style={{ fontSize: 13 }}>Bollywood or movie — fastest correct answer wins.</div>}

      {card && (
        <div className="secret-card" role="status">
          <small>{card.label}</small>
          <b className="display">{card.value}</b>
          <span className="muted">{card.hint}</span>
        </div>
      )}

      {g.phase === "compose" && isNumber && myTurn && (
        <form className="guess-form" onSubmit={send}>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={text}
            placeholder="Pick 1–100"
            aria-label="Your secret number"
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <button className="btn-primary" type="submit">Lock it</button>
        </form>
      )}

      {g.guesses.length > 0 && (
        <ol className="guess-feed" ref={feedRef} aria-live="polite">
          {g.guesses.map((x, i) => (
            <li key={i}>
              <span className="who">{x.from === me ? "You" : handleOf(x.from)}</span>
              <span className="what">{x.text}</span>
              <span className={`verdict ${VERDICT[x.verdict].cls}`}>{VERDICT[x.verdict].label}</span>
            </li>
          ))}
        </ol>
      )}

      {canGuess && (
        <form className="guess-form" onSubmit={send}>
          <input
            type={isNumber ? "number" : "text"}
            inputMode={isNumber ? "numeric" : "text"}
            min={isNumber ? 1 : undefined}
            max={isNumber ? 100 : undefined}
            maxLength={LIMITS.guessMax}
            autoComplete="off"
            enterKeyHint="send"
            value={text}
            placeholder={isNumber ? "Your guess (1–100)" : g.kind === "which_animal" ? "I think I’m a…" : "Type your guess"}
            aria-label="Your guess"
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn-primary" type="submit">Guess</button>
        </form>
      )}

      {g.phase === "question" && !canGuess && (
        <div className="muted" style={{ fontSize: 13 }}>
          {g.kind === "guess_number" ? "They’re guessing your number…"
            : g.kind === "guess_object" ? "Describe it out loud — they’re typing guesses."
            : `${handleOf(g.turn ?? "")} is guessing who they are…`}
        </div>
      )}
      {g.phase === "compose" && !myTurn && <div className="muted" style={{ fontSize: 13 }}>Get ready to guess…</div>}
      {g.phase === "reveal" && g.reveal && <div className="game-note">{note(g.reveal.note)}</div>}
    </>
  );
}
