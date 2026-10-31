/**
 * Draggable self-view ("PiP") on phones: drag it anywhere, it snaps to the nearest
 * corner on release and remembers that corner. Uses pointer events + pointer capture,
 * and `touch-action: none` on the tile so dragging never scrolls the page.
 */
import { useEffect, useRef, useState } from "react";

export type Corner = "tl" | "tr" | "bl" | "br";
const KEY = "dy.pip";
const read = (): Corner => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "tl" || v === "tr" || v === "bl" || v === "br" ? v : "tr";
  } catch {
    return "tr";
  }
};

export function usePipDrag(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<Corner>(read);
  const dragged = useRef(false); // so a drag doesn't also count as a tap

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number; id: number } | null = null;

    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return; // let buttons on the tile work
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dragged.current = false;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragged.current && Math.hypot(dx, dy) < 6) return;
      dragged.current = true;
      el.classList.add("dragging");
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      // Measure where it was dropped BEFORE clearing the drag offset.
      const box = el.getBoundingClientRect();
      el.classList.remove("dragging");
      el.style.transform = "";
      if (!dragged.current) return;
      // Snap to whichever corner the tile's centre is closest to, inside its container.
      const parent = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
      if (!parent) return;
      const cy = box.top + box.height / 2;
      const centreX = box.left + box.width / 2;
      const next: Corner = `${cy < parent.top + parent.height / 2 ? "t" : "b"}${centreX < parent.left + parent.width / 2 ? "l" : "r"}` as Corner;
      setCorner(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* ignore */
      }
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [enabled]);

  return { ref, corner, dragged };
}
