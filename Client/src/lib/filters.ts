/**
 * Camera filters — 100% on-device. Raw camera → hidden <video> → <canvas> (filter drawn
 * each frame) → canvas.captureStream() → sent to peers with RTCRtpSender.replaceTrack.
 *
 * Cost: zero server/bandwidth cost (the stream is the same size). CPU only while a filter
 * is ON — "None" sends the raw camera track and the pipeline is fully torn down.
 *
 * Browser notes:
 *  - Chrome/Edge/Firefox support ctx.filter (GPU-accelerated CSS filters on canvas).
 *  - Safari doesn't, so colour looks fall back to a per-pixel colour matrix on a small
 *    frame, and blur/pixel use cheap down-scale/up-scale tricks that work everywhere.
 *  - If frames take too long (old phone), FPS drops automatically from 24 → 15 → 10.
 */

export const FILTERS = [
  { id: "none", name: "None", swatch: "linear-gradient(135deg,#888,#ccc)" },
  { id: "whisky", name: "Whisky", swatch: "linear-gradient(135deg,#7a3e0e,#e6a548)" },
  { id: "noir", name: "Noir", swatch: "linear-gradient(135deg,#111,#bbb)" },
  { id: "vintage", name: "Vintage", swatch: "linear-gradient(135deg,#8c6f4f,#e8d7b0)" },
  { id: "neon", name: "Neon", swatch: "linear-gradient(135deg,#ff2bd6,#22e4ff)" },
  { id: "frost", name: "Frost", swatch: "linear-gradient(135deg,#3a6ea5,#dff1ff)" },
  { id: "disco", name: "Disco", swatch: "conic-gradient(#ff5b5b,#ffd25b,#5bff9c,#5bc8ff,#c25bff,#ff5b5b)" },
  { id: "goggles", name: "Goggles", swatch: "repeating-linear-gradient(45deg,#c8f560 0 6px,#6b8f20 6px 12px)" },
  { id: "pixel", name: "Pixel", swatch: "conic-gradient(#555 25%,#aaa 0 50%,#555 0 75%,#aaa 0)" },
  { id: "blur", name: "Shy blur", swatch: "radial-gradient(#fff,#999)" },
] as const;
export type FilterId = (typeof FILTERS)[number]["id"];
export const isFilterId = (v: unknown): v is FilterId => FILTERS.some((f) => f.id === v);

/** ctx.filter strings (Chrome/Firefox). */
const CSS: Partial<Record<FilterId, string>> = {
  whisky: "sepia(.45) saturate(1.35) contrast(1.06) brightness(1.04)",
  noir: "grayscale(1) contrast(1.35) brightness(1.02)",
  vintage: "sepia(.35) saturate(.8) contrast(.92) brightness(1.08)",
  neon: "saturate(2.1) contrast(1.18)",
  frost: "saturate(.75) brightness(1.08) hue-rotate(-8deg)",
};

/** 3×4 colour matrices (rows = out R,G,B; cols = in R,G,B, offset) — Safari fallback. */
const MATRIX: Partial<Record<FilterId, number[]>> = {
  whisky: [1.12, 0.32, 0.08, 6, 0.2, 0.92, 0.07, 2, 0.12, 0.22, 0.62, -8],
  noir: [0.4, 0.8, 0.14, -20, 0.4, 0.8, 0.14, -20, 0.4, 0.8, 0.14, -20],
  vintage: [0.78, 0.38, 0.1, 18, 0.22, 0.8, 0.1, 14, 0.16, 0.26, 0.6, 10],
  neon: [1.6, -0.35, -0.25, -6, -0.3, 1.55, -0.25, -6, -0.3, -0.35, 1.65, -6],
  frost: [0.8, 0.12, 0.08, 4, 0.08, 0.9, 0.1, 8, 0.06, 0.12, 0.98, 22],
};

/** Colour washes blended on top (works in every browser). */
const WASH: Partial<Record<FilterId, [string, GlobalCompositeOperation, number]>> = {
  whisky: ["#ff9a2e", "soft-light", 0.35],
  vintage: ["#f2d29b", "multiply", 0.25],
  neon: ["#ff2bd6", "soft-light", 0.35],
  frost: ["#7cc4ff", "soft-light", 0.3],
};
const VIGNETTE: Partial<Record<FilterId, number>> = { whisky: 0.45, noir: 0.6, vintage: 0.55, neon: 0.35 };

const MAX_W = 640; // plenty for a call tile; keeps CPU and encoder load low

function supportsCtxFilter(): boolean {
  try {
    const c = document.createElement("canvas").getContext("2d");
    if (!c || !("filter" in c)) return false;
    c.filter = "blur(2px)";
    return c.filter === "blur(2px)";
  } catch {
    return false;
  }
}

export class FilterPipeline {
  readonly track: MediaStreamTrack;
  private video = document.createElement("video");
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private small = document.createElement("canvas"); // scratch for blur / pixel
  private sctx: CanvasRenderingContext2D;
  private timer = 0;
  private stopped = false;
  private fps = 24;
  private slowFrames = 0;
  private start = performance.now();
  private native = supportsCtxFilter();

  constructor(source: MediaStreamTrack, private filter: FilterId) {
    const v = this.video;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.srcObject = new MediaStream([source]);
    // iOS Safari won't decode frames for a video that isn't in the document.
    Object.assign(v.style, { position: "fixed", width: "1px", height: "1px", opacity: "0", pointerEvents: "none", left: "-10px", top: "0" });
    document.body.appendChild(v);
    void v.play().catch(() => {});

    const s = source.getSettings();
    const w0 = s.width ?? 640, h0 = s.height ?? 480;
    const scale = Math.min(1, MAX_W / w0);
    this.canvas.width = Math.round(w0 * scale);
    this.canvas.height = Math.round(h0 * scale);
    this.ctx = this.canvas.getContext("2d", { alpha: false, willReadFrequently: !this.native })!;
    this.sctx = this.small.getContext("2d")!;
    this.track = this.canvas.captureStream(this.fps).getVideoTracks()[0];
    this.loop();
  }

  setFilter(f: FilterId) {
    this.filter = f;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.track.stop();
    this.video.srcObject = null;
    this.video.remove();
  }

  private loop = () => {
    if (this.stopped) return;
    const t0 = performance.now();
    try {
      this.draw();
    } catch {
      /* a single bad frame shouldn't kill the stream */
    }
    // Adaptive FPS: if drawing eats most of the frame budget, step down.
    const cost = performance.now() - t0;
    if (cost > 1000 / this.fps * 0.7) {
      if (++this.slowFrames > 30 && this.fps > 10) {
        this.fps = this.fps > 15 ? 15 : 10;
        this.slowFrames = 0;
      }
    } else this.slowFrames = Math.max(0, this.slowFrames - 1);
    this.timer = window.setTimeout(this.loop, Math.max(0, 1000 / this.fps - cost));
  };

  private draw() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    // Keep the canvas aspect in sync if the camera changes orientation (phones).
    const want = Math.round(W * (v.videoHeight / v.videoWidth));
    if (Math.abs(want - H) > 2) {
      canvas.height = want;
      return;
    }
    const f = this.filter;
    const time = (performance.now() - this.start) / 1000;
    ctx.save();

    if (f === "pixel" || f === "blur") {
      const factor = f === "pixel" ? 0.075 : 0.04;
      const sw = Math.max(8, Math.round(W * factor)), sh = Math.max(6, Math.round(H * factor));
      if (this.small.width !== sw) { this.small.width = sw; this.small.height = sh; }
      this.sctx.imageSmoothingEnabled = true;
      this.sctx.drawImage(v, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = f === "blur";
      if (f === "blur") ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.small, 0, 0, W, H);
    } else if (f === "goggles") {
      // Wavy "drunk" double vision: horizontal slices shifted on a sine wave + a ghost copy.
      const strips = 24, sh = H / strips, vw = v.videoWidth, vh = v.videoHeight;
      for (let i = 0; i < strips; i++) {
        const dx = Math.sin(time * 2.2 + i * 0.45) * W * 0.022;
        ctx.drawImage(v, 0, (i * vh) / strips, vw, vh / strips + 1, dx, i * sh, W, sh + 1);
      }
      ctx.globalAlpha = 0.28;
      ctx.drawImage(v, W * 0.03 + Math.sin(time * 1.3) * W * 0.015, 0, W, H);
      ctx.globalAlpha = 1;
    } else if (f === "disco") {
      if (this.native) ctx.filter = `hue-rotate(${(time * 90) % 360}deg) saturate(1.6)`;
      ctx.drawImage(v, 0, 0, W, H);
      ctx.filter = "none";
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = `hsl(${(time * 120) % 360} 100% 55%)`;
      ctx.fillRect(0, 0, W, H);
    } else {
      if (this.native && CSS[f]) ctx.filter = CSS[f]!;
      ctx.drawImage(v, 0, 0, W, H);
      ctx.filter = "none";
      if (!this.native && MATRIX[f]) this.applyMatrix(MATRIX[f]!, W, H);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const wash = WASH[f];
    if (wash) {
      ctx.globalCompositeOperation = wash[1];
      ctx.globalAlpha = wash[2];
      ctx.fillStyle = wash[0];
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    const vig = VIGNETTE[f];
    if (vig) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${vig})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  private applyMatrix(m: number[], W: number, H: number) {
    const img = this.ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i] = m[0] * r + m[1] * g + m[2] * b + m[3];
      d[i + 1] = m[4] * r + m[5] * g + m[6] * b + m[7];
      d[i + 2] = m[8] * r + m[9] * g + m[10] * b + m[11];
    }
    this.ctx.putImageData(img, 0, 0);
  }
}
