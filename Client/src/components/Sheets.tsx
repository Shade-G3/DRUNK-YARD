import { useEffect, useRef, useState } from "react";
import {
  GIFT_CATEGORIES, GIFT_CATEGORY_LABEL, GIFT_LADDER, TIER_META, REPORT_REASONS, LIMITS,
  type GiftCategory, type ReportReason, type TierIndex,
} from "@shared/protocol";
import { socket } from "../lib/socket";
import { useApp, colorFor, initials } from "../state";
import { Bottle } from "./Art";
import { GamePicker } from "./Game";
import * as I from "./Icons";

export function Sheet({ children, label, onClose }: { children: React.ReactNode; label: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {children}
      </section>
    </div>
  );
}

const close = () => useApp.getState().openSheet(null);

export function GamesSheet() {
  const room = useApp((s) => s.room);
  return (
    <Sheet label="Pick a game" onClose={close}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="spacer">
          <h2 className="display">Play something</h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Starts when everyone in the room taps Ready
          </p>
        </div>
        <span className="pill mono" style={{ background: "var(--accent)", color: "var(--on-accent)", border: "none" }}>
          {room ? room.peers.length + 1 : 0} in room
        </span>
      </div>
      <GamePicker onPicked={close} />
    </Sheet>
  );
}

export function GiftSheet() {
  const { room, me, giftTarget, prefs } = useApp();
  const defaultCat: GiftCategory = prefs.drink === "sober" ? "zero" : prefs.drink;
  const [cat, setCat] = useState<GiftCategory>(defaultCat);
  const [tier, setTier] = useState<TierIndex>(0);
  const peers = room?.peers ?? [];
  const [target, setTarget] = useState<string | "table">(giftTarget ?? (peers.length === 1 ? peers[0].id : peers[0]?.id ?? "table"));
  if (!room) return null;

  const recipients = target === "table" ? peers.length : 1;
  const cost = TIER_META[tier].price * recipients;
  const coins = me?.coins ?? 0;
  const afford = cost <= coins;
  const name = GIFT_LADDER[cat][tier];
  const targetName = target === "table" ? "the table" : peers.find((p) => p.id === target)?.handle ?? "them";

  const send = () => {
    if (!afford || !peers.length) return;
    socket.emit("gift:send", { category: cat, tier, to: target });
    close();
  };

  return (
    <Sheet label="Send a drink" onClose={close}>
      <div>
        <h2 className="display">Buy {targetName} a drink</h2>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          Higher tier = bigger moment on their screen
        </p>
      </div>

      {peers.length > 1 && (
        <div className="target-row" role="group" aria-label="Who gets it">
          {peers.map((p) => (
            <button key={p.id} className="chip" aria-pressed={target === p.id} onClick={() => setTarget(p.id)}>
              {p.handle}
            </button>
          ))}
          <button className="chip" aria-pressed={target === "table"} onClick={() => setTarget("table")}>
            Round for the table ({peers.length})
          </button>
        </div>
      )}

      <div className="tabs-scroll" role="tablist">
        {GIFT_CATEGORIES.map((c) => (
          <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}>
            {GIFT_CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {TIER_META.map((t, i) => (
          <button key={t.id} className="tier-row" aria-pressed={tier === i} onClick={() => setTier(i as TierIndex)}>
            <Bottle category={cat} tier={i as TierIndex} width={26} height={48} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <span className="row">
                <b style={{ fontSize: 15 }}>{GIFT_LADDER[cat][i]}</b>
                <span className="tier-chip" style={{ background: t.color, color: t.ink, boxShadow: i === 1 ? "inset 0 0 0 1px #5a4a3a" : undefined }}>
                  {t.label}
                </span>
              </span>
              <small className="muted" style={{ fontSize: 12 }}>
                {t.effect}
              </small>
            </span>
            <span className="mono" style={{ fontSize: 13, color: t.price === 0 ? "var(--accent-ink)" : undefined }}>
              {t.price === 0 ? "Free" : `${t.price.toLocaleString("en-IN")} c`}
            </span>
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 12 }}>
        <span className="muted" style={{ fontSize: 12, lineHeight: 1.3 }}>
          Balance
          <br />
          <b className="mono" style={{ fontSize: 15, color: "var(--text)" }}>
            {coins.toLocaleString("en-IN")} c
          </b>
        </span>
        <button className="btn-primary spacer" disabled={!afford || !peers.length} onClick={send}>
          {!peers.length ? "Nobody here yet" : afford ? `Send ${name}${cost ? ` · ${cost.toLocaleString("en-IN")} c` : ""}` : "Not enough coins"}
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 11 }}>
        Demo coins: everyone gets free coins daily. Virtual drinks only — nothing here is a real product.
      </p>
    </Sheet>
  );
}

const REASON_LABEL: Record<ReportReason, string> = {
  nudity: "Nudity or sexual content",
  minor: "Looks under 18",
  harassment: "Harassment or threats",
  hate: "Hate speech",
  spam: "Spam or scam",
  other: "Something else",
};

export function ReportSheet() {
  const { room, reportTarget } = useApp();
  const peer = room?.peers.find((p) => p.id === reportTarget) ?? null;
  const [picked, setPicked] = useState<string | null>(peer?.id ?? (room?.peers.length === 1 ? room.peers[0].id : null));
  if (!room) return null;
  const submit = (reason: ReportReason) => {
    if (!picked) return;
    socket.emit("report", { peerId: picked, reason });
    close();
    if (room.size === 2) useApp.getState().next();
  };
  return (
    <Sheet label="Report" onClose={close}>
      <h2 className="display">Report someone</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        They won’t know it was you, and you’ll never be matched with them again.
      </p>
      {room.peers.length > 1 && (
        <div className="target-row">
          {room.peers.map((p) => (
            <button key={p.id} className="chip" aria-pressed={picked === p.id} onClick={() => setPicked(p.id)}>
              {p.handle}
            </button>
          ))}
        </div>
      )}
      <div className="reason-list">
        {REPORT_REASONS.map((r) => (
          <button key={r} className="btn" style={{ justifyContent: "flex-start" }} disabled={!picked} onClick={() => submit(r)}>
            <I.Flag size={16} /> {REASON_LABEL[r]}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function ChatPanel() {
  const { chat, room } = useApp();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.length]);
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    socket.emit("chat:send", { text: t });
    setText("");
  };
  return (
    <div className="chat">
      <div className="chat-list" ref={listRef} aria-live="polite">
        {chat.map((m, i) =>
          m.sys ? (
            <div key={i} className="msg sys">
              {m.text}
            </div>
          ) : (
            <div key={i} className={`msg ${m.from === room?.you.id ? "mine" : ""}`}>
              {m.from !== room?.you.id && (
                <div className="who" style={{ color: colorFor(m.from) }}>
                  {m.handle}
                </div>
              )}
              {m.text}
            </div>
          ),
        )}
      </div>
      <form className="chat-input" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={LIMITS.chatMax} placeholder="Say something…" aria-label="Message" />
        <button className="btn btn-inv" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

export function ChatSheet() {
  return (
    <Sheet label="Chat" onClose={close}>
      <div className="row">
        <h2 className="display spacer">Yard chat</h2>
        <button className="icon-btn" onClick={close} aria-label="Close chat">
          <I.Close />
        </button>
      </div>
      <div style={{ height: "55dvh", display: "flex" }}>
        <ChatPanel />
      </div>
    </Sheet>
  );
}

export { initials };
