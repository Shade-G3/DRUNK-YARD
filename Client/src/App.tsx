import { useEffect } from "react";
import { useApp } from "./state";
import { socket } from "./lib/socket";
import { Lobby } from "./components/Lobby";
import { Searching } from "./components/Searching";
import { Room } from "./components/Room";
import { Recap } from "./components/Recap";
import { FxLayer } from "./components/Fx";
import { GamesSheet, GiftSheet, ReportSheet, ChatSheet } from "./components/Sheets";
import { FiltersSheet } from "./components/Filters";
import { Legal, LEGAL_PATHS } from "./components/Legal";

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.err ? "err" : ""}`}>
          <span className="spacer">{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                useApp.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Banned({ until }: { until: number }) {
  return (
    <main className="recap" style={{ justifyContent: "center", textAlign: "center" }}>
      <h1 className="display">You’ve been removed from the yard.</h1>
      <p className="muted">
        Several people reported you. You can come back after {new Date(until).toLocaleString()}.
      </p>
    </main>
  );
}

export default function App() {
  const { screen, sheet, prefs, bannedUntil } = useApp();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    if (prefs.bar && prefs.drink !== "sober") root.dataset.bar = prefs.drink;
    else delete root.dataset.bar;
    const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || "#0D0B12");
  }, [prefs.theme, prefs.bar, prefs.drink]);

  useEffect(() => {
    socket.connect();
  }, []);

  const legal = LEGAL_PATHS[window.location.pathname.replace(/\/+$/, "")];
  if (legal) return <Legal page={legal} />;
  if (bannedUntil > Date.now()) return <Banned until={bannedUntil} />;

  return (
    <div className="app">
      {screen === "lobby" && <Lobby />}
      {screen === "searching" && (
        <>
          <Lobby />
          <Searching />
        </>
      )}
      {screen === "room" && <Room />}
      {screen === "recap" && <Recap />}
      {sheet === "games" && <GamesSheet />}
      {sheet === "gift" && <GiftSheet />}
      {sheet === "report" && <ReportSheet />}
      {sheet === "chat" && <ChatSheet />}
      {sheet === "filters" && <FiltersSheet />}
      <FxLayer />
      <Toasts />
    </div>
  );
}
