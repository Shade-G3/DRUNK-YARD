import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

export const Mic = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const MicOff = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3 3l18 18M9 9v2a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.5 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3" /></svg>
);
export const Cam = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></svg>
);
export const CamOff = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3 3l18 18M16 16v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2M10 6h5a1 1 0 0 1 1 1v3l5-3v10" /></svg>
);
export const Dice = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 8h.01M16 16h.01M12 12h.01M16 8h.01M8 16h.01" /></svg>
);
export const Flag = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 21V4h11l-1.5 4L16 12H5" /></svg>
);
export const Star = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7L2 9.2l7.1-.6z" /></svg>
);
export const Chat = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
);
export const Glass = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 3h12l-1.5 16a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2zM6.5 9h11" /></svg>
);
export const Next = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} strokeWidth={2.5}><path d="M6 5l8 7-8 7M18 5v14" /></svg>
);
export const Arrow = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} strokeWidth={2.5}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const Sun = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const Moon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></svg>
);
export const Shuffle = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
);
export const Close = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const Laugh = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M7.5 13.5s1.5 3 4.5 3 4.5-3 4.5-3zM9 9.5h.01M15 9.5h.01" /></svg>
);
export const Fire = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 22c4 0 7-2.7 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5.5-5 8 0 4.3 3 7 7 7z" /></svg>
);
export const Heart = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
);
export const Leave = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M15 4h4v16h-4M10 17l-5-5 5-5M5 12h11" /></svg>
);
