import { useEffect } from "react";
import { DRINKS, DRINK_LABEL, VIBES, VIBE_LABEL, RoomSize, TierIndex } from "@shared/protocol";
import { useApp } from "../state";
import { StreamVideo } from "./Video";
import { DrinkGlass, DOT, Bottle, Silhouette } from "./Art";
import * as I from "./Icons";

const BAR_COPY = {
  whisky: { kicker: "BAR MODE · OAK & AMBER", title: "Whisky night.", sub: "Slow pours, long talks. Your rooms glow amber.", cta: "Pour me a room" },
  rum: { kicker: "BAR MODE · DOCK & SUNSET", title: "Rum o’clock.", sub: "Loud, warm, a little chaotic. Like a beach shack.", cta: "Sail into a room" },
  vodka: { kicker: "BAR MODE · ICE & STEEL", title: "Ice cold.", sub: "Clean, sharp, straight to the point.", cta: "Chill with someone" },
  wine: { kicker: "BAR MODE · VELVET & CANDLELIGHT", title: "A glass of red.", sub: "Candlelit rooms for slow, deep conversations.", cta: "Open a bottle" },
  beer: { kicker: "BAR MODE · PUB & FOAM", title: "Pint up.", sub: "Pub energy. Loud tables, bad jokes, good people.", cta: "Grab a table" },
  sober: { kicker: "CLASSIC YARD", title: "Chai & chill.", sub: "Same yard, no drink needed. Everyone’s welcome.", cta: "Find someone" },
} as const;

export function ThemeToggle() {
  const theme = useApp((s) => s.prefs.theme);
  const setPref = useApp((s) => s.setPref);
  const dark = theme === "dark";
  return (
    <button className="icon-btn" onClick={() => setPref("theme", dark ? "light" : "dark")} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      {dark ? <I.Sun /> : <I.Moon />}
    </button>
  );
}

export function Lobby() {
  const { prefs, setPref, local, camError, mic, cam, me, online, connected } = useApp();
  const { startCamera, toggleMic, toggleCam, findRoom, shuffleName } = useApp.getState();
  const barActive = prefs.bar && prefs.drink !== "sober";
  const copy = BAR_COPY[prefs.drink];

  useEffect(() => {
    void startCamera();
  }, [startCamera]);

  const ctaText = prefs.size === 2 ? (barActive ? copy.cta : "Find someone") : `Find a group of ${prefs.size}`;

  return (
    <main className="lobby">
      <header className="lobby-head">
        <div className="wordmark">
          drunk<span>yard</span>
        </div>
        <span className="pill" title={connected ? "Connected" : "Connecting"}>
          <span className={`dot ${connected ? "live" : ""}`} />
          <span className="mono">{connected ? online : "…"}</span> in the yard
        </span>
        {prefs.drink !== "sober" && (
          <button className="switch desk-only" aria-pressed={prefs.bar} onClick={() => setPref("bar", !prefs.bar)}>
            <span className="knob" />
            Bar theme
          </button>
        )}
        {!barActive && <ThemeToggle />}
      </header>

      <div className="lobby-body">
        <div className="lobby-col">
          <section className="preview" aria-label="Camera preview">
            {local ? (
              <StreamVideo stream={local} muted />
            ) : camError ? (
              <div className="cam-error">
                <I.CamOff size={28} />
                <span>{camError}</span>
                <button className="btn" onClick={() => void startCamera()}>
                  Try again
                </button>
              </div>
            ) : (
              <div className="ph">
                <Silhouette />
              </div>
            )}
            <div className="who">
              You · <b>{me?.handle ?? "…"}</b>
            </div>
            <button className="shuffle" onClick={shuffleName} aria-label="Shuffle your anonymous name">
              <I.Shuffle size={14} />
              New name
            </button>
            {local && (
              <div className="ctrls">
                <button className={`round-btn ${mic ? "" : "off"}`} onClick={toggleMic} aria-label={mic ? "Mute microphone" : "Unmute microphone"} aria-pressed={!mic}>
                  {mic ? <I.Mic /> : <I.MicOff />}
                </button>
                <button className={`round-btn ${cam ? "" : "off"}`} onClick={toggleCam} aria-label={cam ? "Turn camera off" : "Turn camera on"} aria-pressed={!cam}>
                  {cam ? <I.Cam /> : <I.CamOff />}
                </button>
              </div>
            )}
          </section>

          <section className="bar-hero desk-only">
            <DrinkGlass drink={prefs.drink} size={96} />
            <div>
              <div className="kicker">{barActive ? copy.kicker : "TONIGHT"}</div>
              <h1 className="display">{copy.title}</h1>
              <p>{copy.sub}</p>
            </div>
          </section>
        </div>

        <div className="lobby-col">
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 className="section-title">What’s in your glass?</h2>
            <div className="drink-grid">
              {DRINKS.map((d) => (
                <button key={d} className="drink-btn" aria-pressed={prefs.drink === d} onClick={() => setPref("drink", d)}>
                  <span className="drink-dot" style={{ background: DOT[d] }} />
                  {DRINK_LABEL[d]}
                </button>
              ))}
            </div>
            {prefs.drink !== "sober" && (
              <button className="switch phone-only" style={{ alignSelf: "flex-start" }} aria-pressed={prefs.bar} onClick={() => setPref("bar", !prefs.bar)}>
                <span className="knob" />
                Bar theme: {prefs.bar ? "on" : "off"}
              </button>
            )}
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 className="section-title">Tonight’s vibe</h2>
            <div className="chips">
              {VIBES.map((v) => (
                <button key={v} className="chip" aria-pressed={prefs.vibe === v} onClick={() => setPref("vibe", v)}>
                  {VIBE_LABEL[v]}
                </button>
              ))}
            </div>
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 className="section-title">Room size</h2>
              <span className="muted" style={{ fontSize: 13 }}>
                {prefs.size === 2 ? "1-on-1 with a stranger" : `Group of ${prefs.size} · games on`}
              </span>
            </div>
            <div className="seg" role="group" aria-label="Room size">
              {([2, 3, 4, 5, 6] as RoomSize[]).map((n) => (
                <button key={n} aria-pressed={prefs.size === n} onClick={() => setPref("size", n)}>
                  {n}
                </button>
              ))}
            </div>
          </section>

          {me && me.shelf.total > 0 && (
            <section className="shelf-card">
              <span className="muted" style={{ fontSize: 13 }}>
                Your bar shelf · drinks people sent you
              </span>
              <div className="shelf">
                {me.shelf.tiers.map((n, t) =>
                  n > 0 ? (
                    <span key={t} className="row" style={{ gap: 4, alignItems: "flex-end" }}>
                      <Bottle category={prefs.drink === "sober" ? "zero" : prefs.drink} tier={t as TierIndex} width={22 + t * 2} height={44 + t * 5} />
                      <span className="mono muted" style={{ fontSize: 12 }}>×{n}</span>
                    </span>
                  ) : null,
                )}
                <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>
                  {me.shelf.total} total
                </span>
              </div>
            </section>
          )}

          <div className="lobby-foot">
            <label className="age">
              <input type="checkbox" checked={prefs.ageOk} onChange={(e) => setPref("ageOk", e.target.checked)} />
              <span>
                I’m 18+ and agree to the Yard Rules: be kind, keep it clothed, no minors. Reported users get banned.
              </span>
            </label>
            <button className="btn-primary" onClick={() => void findRoom()} disabled={!prefs.ageOk}>
              {ctaText} <I.Arrow />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
