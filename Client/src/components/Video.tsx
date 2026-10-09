import { useEffect, useRef } from "react";

/** <video> that binds a MediaStream. Must be visible before srcObject on mobile Safari/Android. */
export function StreamVideo({ stream, muted = false, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}
