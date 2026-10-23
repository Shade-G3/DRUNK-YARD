/** UI for Catch the Imposter and Bluff. All secrets arrive per-person from the server. */
import { useEffect, useMemo, useState } from "react";
import { LIMITS, type BluffRank, type Card, type ClientToServer, type GameView } from "@shared/protocol";
import { socket } from "../lib/socket";
import { handleOf } from "../state";

const act = (a: Parameters<ClientToServer["game:act"]>[0]) => socket.emit("game:act", a);
const nameOf = (id: string, me: string) => (id === me ? "You" : handleOf(id));

function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

// ═══ Catch the Imposter ══════════════════════════════════════════════════════
export function ImposterBoard({ g, me, note }: { g: GameView; me: string; note: (t?: string) => string }) {
  const v = g.imposter!;
  const playing = g.players.includes(me);
  const [guess, setGuess] = useState("");
  const others = g.players.filter((p) => p !== me);

  return (
    <>
      <div className="muted" style={{ fontSize: 12 }}>
        {v.mode === "undercover" ? "Undercover mode — one of you has a slightly different word." : "Blank mode — the imposter has no word."}
      </div>

      {!playing ? (
        <div className="game-note">You’re watching this round — you’ll be in the next game.</div>
      ) : v.stage !== "reveal" && (
        v.youAreImposter ? (
          <div className="secret-card imp">
            <small>Shh… you are</small>
            <b className="display">The Imposter 🕵️</b>
            <span className="muted">No word for you. Listen, then bluff a clue that fits.</span>
          </div>
        ) : (
          <div className="secret-card">
            <small>Your secret word</small>
            <b className="display">{v.word}</b>
            <span className="muted">Give clues without saying it.</span>
          </div>
        )
      )}

      <p className="game-prompt display" style={{ fontSize: 19 }}>{note(g.prompt)}</p>

      {v.stage === "clue" && (
        <>
          <div className="turn-row" aria-label="Clue order">
            <span className="muted mono" style={{ fontSize: 12 }}>Round {v.clueRound}/2</span>
            {g.players.map((p) => (
              <span key={p} className={`pill ${g.turn === p ? "on" : ""}`}>{nameOf(p, me)}</span>
            ))}
          </div>
          {g.turn === me ? (
            <button className="btn-primary" onClick={() => act({ type: "next" })}>
              Said my clue — next ✓
            </button>
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>Watch their face 👀 Chat is paused — clues are spoken out loud.</div>
          )}
        </>
      )}

      {v.stage === "vote" && playing && (
        <>
          <div className="opt-list">
            {others.map((p) => (
              <button key={p} className="opt" aria-pressed={v.myVote === p} onClick={() => act({ type: "vote", target: p })}>
                <span>{handleOf(p)}</span>
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>{v.votes.length}/{g.players.length} voted · you can change your vote</div>
        </>
      )}

      {v.stage === "lastguess" &&
        (v.result?.imposter === me ? (
          <form
            className="guess-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (guess.trim()) act({ type: "guess", text: guess.trim() });
            }}
          >
            <input value={guess} maxLength={LIMITS.guessMax} placeholder="Their word was…" aria-label="Guess their word" onChange={(e) => setGuess(e.target.value)} autoFocus />
            <button className="btn-primary" type="submit">Steal</button>
          </form>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>{handleOf(v.result?.imposter ?? "")} gets one guess to steal the round…</div>
        ))}

      {v.stage === "reveal" && v.result && (
        <div className="imp-result">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="pill">Word: <b>{v.result.word}</b></span>
            {v.result.imposterWord && <span className="pill">Imposter’s word: <b>{v.result.imposterWord}</b></span>}
            {v.result.guess && <span className="pill">Their guess: <b>{v.result.guess}</b></span>}
          </div>
          {Object.keys(v.result.tally).length > 0 && (
            <div className="muted" style={{ fontSize: 13 }}>
              Votes: {Object.entries(v.result.tally).map(([id, n]) => `${nameOf(id, me)} ${n}`).join(" · ")}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ═══ Bluff ═══════════════════════════════════════════════════════════════════
const SUIT: Record<Card["suit"], string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const red = (c: Card) => c.suit === "H" || c.suit === "D";

function PlayingCard({ c, selected, onClick, disabled }: { c: Card; selected?: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`pcard ${red(c) ? "red" : ""} ${selected ? "sel" : ""}`}
      aria-pressed={selected}
      aria-label={`${c.rank} of ${{ S: "spades", H: "hearts", D: "diamonds", C: "clubs" }[c.suit]}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span>{c.rank}</span>
      <i>{SUIT[c.suit]}</i>
    </button>
  );
}

export function BluffBoard({ g, me, note }: { g: GameView; me: string; note: (t?: string) => string }) {
  const b = g.bluff!;
  const now = useNow();
  const myTurn = g.turn === me;
  const playing = me in b.counts;
  const [sel, setSel] = useState<number[]>([]);
  const [claim, setClaim] = useState<BluffRank | null>(null);

  const handKey = b.hand.map((c) => c.id).join(",");
  useEffect(() => setSel((s) => s.filter((id) => b.hand.some((c) => c.id === id))), [handKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSel([]);
    setClaim(null);
  }, [g.turn, b.rank]);

  const selected = useMemo(() => b.hand.filter((c) => sel.includes(c.id)), [b.hand, sel]);
  const rank: BluffRank | null = b.rank ?? claim ?? selected[0]?.rank ?? null;
  const wait = Math.max(0, Math.ceil((b.playableAt - now) / 1000));
  const canPlay = myTurn && selected.length >= 1 && selected.length <= 4 && !!rank && (wait === 0 || !b.last);
  const showReveal = b.reveal && now - b.reveal.ts < 4500;
  const left = Math.max(0, Math.ceil((b.endsAt - now) / 1000));
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));
  const honest = selected.length > 0 && !!rank && selected.every((c) => c.rank === rank);

  return (
    <>
      <div className="bluff-table">
        <div className="pile" aria-label={`${b.pile} cards in the pile`}>
          {Array.from({ length: Math.min(5, b.pile) }).map((_, i) => (
            <span key={i} className="back" style={{ transform: `translate(${i * 3}px, ${-i * 2}px) rotate(${(i % 3) - 1}deg)` }} />
          ))}
          <b className="mono">{b.pile}</b>
        </div>
        <div className="claim">
          {b.last ? (
            <>
              <small>{nameOf(b.last.by, me)} {b.last.by === me ? "say" : "says"}</small>
              <b className="display">{b.last.count} × {b.last.rank}</b>
            </>
          ) : b.rank ? (
            <>
              <small>Current set</small>
              <b className="display">{b.rank}s</b>
            </>
          ) : (
            <>
              <small>New set</small>
              <b className="display">{myTurn ? "Your pick" : `${handleOf(g.turn ?? "")} picks`}</b>
            </>
          )}
        </div>
        <span className="mono muted" style={{ fontSize: 12, alignSelf: "flex-start" }}>
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </span>
      </div>

      {b.last && b.last.by !== me && playing && (
        <button className="bluff-btn" onClick={() => act({ type: "bluff" })}>
          BLUFF!
        </button>
      )}

      {showReveal && b.reveal && (
        <div className={`reveal-strip ${b.reveal.truthful ? "true" : "lie"}`}>
          <span>{b.reveal.truthful ? "TRUE ✓" : "LIE ✗"}</span>
          <div className="cards">
            {b.reveal.cards.map((c) => <PlayingCard key={c.id} c={c} disabled />)}
          </div>
        </div>
      )}

      <div className="turn-row">
        {Object.entries(b.counts).map(([id, n]) => (
          <span key={id} className={`pill ${g.turn === id ? "on" : ""}`}>
            {nameOf(id, me)} <b className="mono">{n}</b>
          </span>
        ))}
      </div>

      {playing ? (
        <>
          <div className="hand" role="group" aria-label="Your cards">
            {b.hand.map((c) => (
              <PlayingCard key={c.id} c={c} selected={sel.includes(c.id)} onClick={() => myTurn && toggle(c.id)} disabled={!myTurn} />
            ))}
          </div>

          {myTurn ? (
            <div className="bluff-actions">
              {!b.rank && (
                <div className="chips" aria-label="Claim a rank">
                  {b.ranks.map((r) => (
                    <button key={r} className="chip chip-sm" aria-pressed={rank === r} onClick={() => setClaim(r)}>
                      {r}
                    </button>
                  ))}
                </div>
              )}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn-primary spacer" disabled={!canPlay} onClick={() => rank && act({ type: "play", cards: sel, rank })}>
                  {wait > 0 && b.last ? `Wait ${wait}s…` : selected.length ? `Put down ${selected.length} × ${rank ?? "?"}${honest ? "" : " 🤫"}` : "Pick 1–4 cards"}
                </button>
                {b.rank && (
                  <button className="btn" onClick={() => act({ type: "pass" })}>
                    Pass
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>
              {handleOf(g.turn ?? "")}’s turn{b.last && b.last.by !== me ? " — think they’re lying? Hit BLUFF!" : ""}
            </div>
          )}
        </>
      ) : (
        <div className="game-note">You’re watching this game — you’ll be dealt in next time.</div>
      )}

      {b.log.length > 0 && (
        <ol className="bluff-log" aria-live="polite">
          {b.log.slice(-3).map((l, i) => <li key={i}>{note(l)}</li>)}
        </ol>
      )}
    </>
  );
}
