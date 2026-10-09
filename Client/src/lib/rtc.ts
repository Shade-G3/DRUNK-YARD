/**
 * Full-mesh WebRTC for 2–6 people. Each pair has exactly one offerer (the later
 * joiner — the server tells us via `initiate`), so there's no offer glare.
 *
 * Bandwidth: in a mesh every person uploads one stream per peer, so we cap each
 * sender's bitrate by room size. Swap this class for a LiveKit client later; the
 * rest of the app only uses add/remove/handleSignal/closeAll/onStream.
 */
import type { SignalData } from "@shared/protocol";
import { socket } from "./socket";

interface PeerConn {
  pc: RTCPeerConnection;
  pending: RTCIceCandidateInit[];
  initiator: boolean;
  restarts: number;
}

export class Mesh {
  private peers = new Map<string, PeerConn>();
  constructor(
    private iceServers: RTCIceServer[],
    private local: () => MediaStream | null,
    private onStream: (id: string, s: MediaStream | null) => void,
    private onState: (id: string, state: RTCPeerConnectionState) => void,
  ) {}

  add(id: string, initiator: boolean) {
    if (this.peers.has(id)) return this.peers.get(id)!;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
    const entry: PeerConn = { pc, pending: [], initiator, restarts: 0 };
    this.peers.set(id, entry);

    const stream = this.local();
    if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.ontrack = (ev) => {
      const s = ev.streams[0] ?? new MediaStream([ev.track]);
      this.onStream(id, s);
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) socket.emit("signal", { to: id, data: ev.candidate.toJSON() as SignalData });
    };
    pc.onconnectionstatechange = () => {
      this.onState(id, pc.connectionState);
      if (pc.connectionState === "connected") this.tuneBitrate();
      if (pc.connectionState === "failed" && entry.initiator && entry.restarts < 2) {
        entry.restarts += 1;
        void this.offer(id, true);
      }
    };
    if (initiator) void this.offer(id, false);
    return entry;
  }

  private async offer(id: string, iceRestart: boolean) {
    const e = this.peers.get(id);
    if (!e) return;
    try {
      const offer = await e.pc.createOffer({ iceRestart });
      await e.pc.setLocalDescription(offer);
      socket.emit("signal", { to: id, data: { type: "offer", sdp: offer.sdp ?? "" } });
    } catch (err) {
      console.warn("offer failed", err);
    }
  }

  async handleSignal(from: string, data: SignalData) {
    const e = this.peers.get(from) ?? this.add(from, false);
    const pc = e.pc;
    try {
      if ("type" in data) {
        if (data.type === "offer") {
          await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
          await this.flush(e);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("signal", { to: from, data: { type: "answer", sdp: answer.sdp ?? "" } });
        } else if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
          await this.flush(e);
        }
      } else if (data.candidate) {
        const c: RTCIceCandidateInit = {
          candidate: data.candidate,
          sdpMid: data.sdpMid ?? undefined,
          sdpMLineIndex: data.sdpMLineIndex ?? undefined,
          usernameFragment: data.usernameFragment ?? undefined,
        };
        if (pc.remoteDescription) await pc.addIceCandidate(c).catch(() => {});
        else e.pending.push(c);
      }
    } catch (err) {
      console.warn("signal error", err);
    }
  }

  private async flush(e: PeerConn) {
    const q = e.pending.splice(0);
    for (const c of q) await e.pc.addIceCandidate(c).catch(() => {});
  }

  remove(id: string) {
    const e = this.peers.get(id);
    if (!e) return;
    try {
      e.pc.close();
    } catch {
      /* ignore */
    }
    this.peers.delete(id);
    this.onStream(id, null);
    this.tuneBitrate();
  }

  closeAll() {
    [...this.peers.keys()].forEach((id) => this.remove(id));
  }

  /** Cap upload per peer so a 6-person mesh doesn't melt a phone's uplink. */
  tuneBitrate() {
    const n = this.peers.size;
    const maxBitrate = n <= 1 ? 1_500_000 : n <= 3 ? 600_000 : 350_000;
    const scale = n <= 1 ? 1 : n <= 3 ? 1.5 : 2;
    for (const { pc } of this.peers.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind !== "video") continue;
        const p = sender.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = maxBitrate;
        p.encodings[0].scaleResolutionDownBy = scale;
        sender.setParameters(p).catch(() => {});
      }
    }
  }
}
