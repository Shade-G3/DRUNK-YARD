import { useEffect, useState } from "react";
import { useApp } from "../state";
import { LIQUID } from "./Art";

export function Searching() {
  const { prefs, searchSince } = useApp();
  const { cancelSearch, findRoom } = useApp.getState();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const waited = Math.max(0, Math.floor((now - searchSince) / 1000));

  return (
    <div className="searching" role="status" aria-live="polite">
      <svg className="pour" viewBox="0 0 120 150" aria-hidden="true">
        <path d="M14 20h92l-10 118a8 8 0 0 1-8 7H32a8 8 0 0 1-8-7z" fill="var(--surface)" stroke="var(--line2)" strokeWidth="3" />
        <path className="fill" d="M20 60h80l-6 78a8 8 0 0 1-8 7H34a8 8 0 0 1-8-7z" fill={LIQUID[prefs.drink]} />
      </svg>
      <h2 className="display">{prefs.size === 2 ? "Finding your person…" : `Pulling up ${prefs.size - 1} chairs…`}</h2>
      <p className="muted" style={{ margin: 0 }}>
        <span className="mono">{waited}s</span> · looking for {prefs.vibe === "any" ? "any vibe" : `“${prefs.vibe}” vibes`}
      </p>
      {waited >= 10 && prefs.vibe !== "any" && (
        <button className="btn btn-inv" onClick={() => void findRoom(true)}>
          Nobody yet — join anyone
        </button>
      )}
      <button className="btn" onClick={cancelSearch}>
        Cancel
      </button>
    </div>
  );
}
