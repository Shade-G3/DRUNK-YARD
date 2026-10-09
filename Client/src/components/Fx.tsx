/**
 * The dopamine layer: bottles flying between tiles, glows, gold dust,
 * Blue-tier takeovers and the two-glass "clink".
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { TIER_META } from "@shared/protocol";
import { useApp, handleOf, type Effect } from "../state";
import { Bottle, Decanter } from "./Art";
import * as I from "./Icons";

function center(id: string): { x: number; y: number } | null {
  const el = document.getElementById(`tile-${id}`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function FlyingBottle({ e, to }: { e: Effect; to: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const g = e.gift!;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = center(g.from) ?? { x: window.innerWidth / 2, y: window.innerHeight };
    const b = center(to) ?? { x: window.innerWidth / 2, y: window.innerHeight / 3 };
    const midX = (a.x + b.x) / 2;
    const midY = Math.min(a.y, b.y) - 120;
    const anim = el.animate(
      [
        { transform: `translate(${a.x - 20}px, ${a.y - 40}px) rotate(-20deg) scale(0.6)`, opacity: 0 },
        { transform: `translate(${midX - 20}px, ${midY - 40}px) rotate(10deg) scale(1.2)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${b.x - 20}px, ${b.y - 40}px) rotate(-35deg) scale(1)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${b.x - 20}px, ${b.y - 40}px) rotate(-35deg) scale(0.4)`, opacity: 0 },
      ],
      { duration: 1500, easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" },
    );
    return () => anim.cancel();
  }, [g.from, to]);
  return (
    <div ref={ref} className="fly-bottle" style={{ left: 0, top: 0 }}>
      <Bottle category={g.category} tier={g.tier} width={40} height={80} />
    </div>
  );
}

function GoldDust() {
  const bits = Array.from({ length: 36 }, (_, i) => {
    const ang = (i / 36) * Math.PI * 2;
    const dist = 120 + Math.random() * 260;
    return { dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist, delay: Math.random() * 0.3 };
  });
  return (
    <div className="gold-dust" style={{ position: "absolute", left: "50%", top: "40%" }}>
      {bits.map((b, i) => (
        <i key={i} style={{ ["--dx" as string]: `${b.dx}px`, ["--dy" as string]: `${b.dy}px`, animationDelay: `${b.delay}s` }} />
      ))}
    </div>
  );
}

function GiftFx({ e }: { e: Effect }) {
  const g = e.gift!;
  const drop = useApp.getState().dropEffect;
  const me = useApp((s) => s.room?.you.id);
  const forMe = me ? g.to.includes(me) : false;
  const tier = TIER_META[g.tier];
  useEffect(() => {
    const t = window.setTimeout(() => drop(e.id), g.tier === 4 ? 5200 : 4200);
    return () => window.clearTimeout(t);
  }, [e.id, g.tier, drop]);

  const toText = g.round ? "the table" : g.to.map((id) => (id === me ? "you" : handleOf(id))).join(", ");
  const fromText = g.from === me ? "You" : g.fromHandle;

  if (g.tier === 4) {
    return (
      <div className="takeover" onClick={() => drop(e.id)} role="alert">
        <div className="rings">
          <i />
          <i style={{ animationDelay: "0.8s" }} />
          <i style={{ animationDelay: "1.6s" }} />
        </div>
        <GoldDust />
        <span className="mono" style={{ fontSize: 11, letterSpacing: 2, color: "#9DB6EA", position: "relative" }}>
          THE WHOLE ROOM SEES THIS
        </span>
        <div className="decanter">
          <Decanter label={g.name} sub={g.category === "whisky" ? "25 YR" : "LEGEND"} />
        </div>
        <span className="tier-tag" style={{ background: tier.color, color: tier.ink }}>
          BLUE TIER
        </span>
        <h1>
          {fromText} sent {toText}
          <br />
          <i>{g.name}</i>
        </h1>
        {forMe && (
          <p style={{ margin: 0, color: "#B9C8EA", position: "relative" }}>Added to your bar shelf. Biggest pour in the room tonight.</p>
        )}
      </div>
    );
  }

  return (
    <>
      {g.tier >= 1 && g.to.map((to) => <FlyingBottle key={to} e={e} to={to} />)}
      {g.tier >= 3 && <GoldDust />}
      <div className="banner" role="status">
        <span className="tier-chip" style={{ background: tier.color, color: tier.ink }}>
          {tier.label}
        </span>
        <span>
          {fromText} sent {toText} <b>{g.round ? `a round of ${g.name}` : g.name}</b>
        </span>
      </div>
    </>
  );
}

function ClinkFx({ e }: { e: Effect }) {
  const drop = useApp.getState().dropEffect;
  useEffect(() => {
    const t = window.setTimeout(() => drop(e.id), 2200);
    return () => window.clearTimeout(t);
  }, [e.id, drop]);
  const glass = (
    <svg width="70" height="110" viewBox="0 0 70 110" aria-hidden="true">
      <path d="M8 6h54l-6 92a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6z" fill="rgba(255,255,255,.15)" stroke="var(--text)" strokeWidth="3" />
      <path d="M12 40h46l-4 58a6 6 0 0 1-6 6H22a6 6 0 0 1-6-6z" fill="#D9922E" />
    </svg>
  );
  return (
    <>
      <div className="clink">
        <span className="g1">{glass}</span>
        <span className="g2">{glass}</span>
      </div>
      <div className="clink-text">Clink! {handleOf(e.clink!.a)} × {handleOf(e.clink!.b)}</div>
    </>
  );
}

const REACT_ICON = { cheers: I.Star, laugh: I.Laugh, fire: I.Fire, heart: I.Heart } as const;
const REACT_COLOR = { cheers: "#C8F560", laugh: "#FFC24B", fire: "#FF6B5B", heart: "#F49BC1" } as const;

function ReactFx({ e }: { e: Effect }) {
  const drop = useApp.getState().dropEffect;
  useEffect(() => {
    const t = window.setTimeout(() => drop(e.id), 1900);
    return () => window.clearTimeout(t);
  }, [e.id, drop]);
  const r = e.react!;
  const c = center(r.from);
  const Icon = REACT_ICON[r.kind];
  const x = (c?.x ?? window.innerWidth / 2) + (Math.random() * 60 - 30);
  const y = c?.y ?? window.innerHeight * 0.6;
  return (
    <span className="react-float" style={{ left: x - 18, top: y, color: REACT_COLOR[r.kind], position: "absolute" }}>
      <Icon size={36} />
    </span>
  );
}

export function FxLayer() {
  const effects = useApp((s) => s.effects);
  return createPortal(
    <div className="fx-layer">
      {effects.map((e) =>
        e.kind === "gift" ? <GiftFx key={e.id} e={e} /> : e.kind === "clink" ? <ClinkFx key={e.id} e={e} /> : <ReactFx key={e.id} e={e} />,
      )}
    </div>,
    document.body,
  );
}
