/** Drawn bits: glass, bottle, decanter, silhouette. Pure SVG, theme-aware via props. */
import type { Drink, GiftCategory, TierIndex } from "@shared/protocol";
import { TIER_META } from "@shared/protocol";

export const LIQUID: Record<Drink, string> = {
  whisky: "#B8701F",
  rum: "#8A4B1F",
  vodka: "#D6E8F6",
  wine: "#7A1530",
  beer: "#E0A214",
  sober: "#C9864A",
};
export const DOT: Record<Drink, string> = { ...LIQUID, vodka: "#CFE3F3", sober: "#C8F560" };
const LEVEL: Record<Drink, number> = { whisky: 62, rum: 55, vodka: 48, wine: 45, beer: 70, sober: 60 };

export function DrinkGlass({ drink, size = 120 }: { drink: Drink; size?: number }) {
  const level = LEVEL[drink];
  const top = 138 - Math.round((118 * level) / 100);
  const xAt = (y: number) => 14 + ((y - 20) * 10) / 118;
  const lx = xAt(top);
  const rx = 120 - xAt(top);
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 120 150" aria-hidden="true">
      <path d="M14 20h92l-10 118a8 8 0 0 1-8 7H32a8 8 0 0 1-8-7z" fill="var(--surface)" stroke="var(--line2)" strokeWidth="3" />
      <path className="glass-liquid" d={`M${lx.toFixed(1)} ${top}H${rx.toFixed(1)}L96 138a8 8 0 0 1-8 7H32a8 8 0 0 1-8-7z`} fill={LIQUID[drink]} />
      {drink === "beer" && <path d={`M${lx.toFixed(1)} ${top - 10}H${rx.toFixed(1)}l-1 12H${(lx + 1).toFixed(1)}z`} fill="#FFF6DF" />}
      {(drink === "whisky" || drink === "vodka" || drink === "rum") && (
        <>
          <rect x="40" y="76" width="22" height="22" rx="4" fill="#fff" opacity="0.5" transform="rotate(-12 51 87)" />
          <rect x="60" y="94" width="20" height="20" rx="4" fill="#fff" opacity="0.4" transform="rotate(10 70 104)" />
        </>
      )}
    </svg>
  );
}

const BOTTLE_BODY: Record<GiftCategory, string> = {
  whisky: "#6B3A10",
  rum: "#4A2510",
  vodka: "#BFD9EE",
  wine: "#4A0F1E",
  beer: "#8A5A0C",
  zero: "#C9864A",
};

export function Bottle({ category, tier, width = 30, height = 60 }: { category: GiftCategory; tier: TierIndex; width?: number; height?: number }) {
  const body = tier === 4 && category === "whisky" ? "#9CC3E6" : BOTTLE_BODY[category];
  return (
    <svg width={width} height={height} viewBox="0 0 26 64" aria-hidden="true">
      <path d="M9 0h8v14c6 4 9 9 9 16v30a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V30c0-7 3-12 9-16z" fill={body} />
      <rect x="3" y="34" width="20" height="14" rx="2" fill={TIER_META[tier].color} stroke={tier === 1 ? "#5a4a3a" : "none"} />
      {tier >= 3 && <rect x="9" y="0" width="8" height="5" rx="1" fill="#E9C46A" />}
    </svg>
  );
}

export function Decanter({ label, sub }: { label: string; sub: string }) {
  return (
    <svg width="150" height="250" viewBox="0 0 150 250" aria-hidden="true">
      <rect x="60" y="0" width="30" height="22" rx="4" fill="#E9C46A" />
      <path d="M58 22h34v26l30 34c8 9 12 20 12 32v104a20 20 0 0 1-20 20H36a20 20 0 0 1-20-20V114c0-12 4-23 12-32l30-34z" fill="#9CC3E6" fillOpacity="0.35" stroke="#CFE2F7" strokeWidth="2" />
      <path d="M22 140h106v94a14 14 0 0 1-14 14H36a14 14 0 0 1-14-14z" fill="#B8701F" />
      <path d="M75 60v190M40 110l70 120M110 110l-70 120" stroke="#fff" strokeOpacity="0.18" strokeWidth="2" />
      <rect x="30" y="150" width="90" height="46" rx="4" fill="#1D3E8A" stroke="#E9C46A" strokeWidth="2" />
      <text x="75" y="171" textAnchor="middle" fontFamily="Playfair Display, serif" fontSize="12" fontWeight="700" fill="#E9C46A" textLength={label.length > 9 ? 80 : undefined} lengthAdjust="spacingAndGlyphs">
        {label.toUpperCase()}
      </text>
      <text x="75" y="188" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#EEF3FF">
        {sub}
      </text>
    </svg>
  );
}

export function Silhouette({ width = 170 }: { width?: number }) {
  return (
    <svg width={width} height={(width * 190) / 170} viewBox="0 0 170 190" fill="none" aria-hidden="true">
      <circle cx="85" cy="70" r="42" fill="var(--ghost)" />
      <path d="M10 190c4-48 36-72 75-72s71 24 75 72" fill="var(--ghost)" />
    </svg>
  );
}
