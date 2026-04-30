"use client";
import { useEffect, useRef, useState } from "react";
import type { CameraFeed } from "@overwatch/schemas";
import { Activity, Eye, Trash2, Maximize2, X } from "lucide-react";

export function CameraTile({
  camera,
  onRemove,
}: {
  camera: CameraFeed;
  onRemove: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const [theater, setTheater] = useState(false);
  const [detections, setDetections] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      try {
        if (camera.kind === "webcam") {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 360 },
            audio: false,
          });
          if (cancelled) return;
          v!.srcObject = stream;
          await v!.play();
        } else if (camera.kind === "hls" || camera.kind === "mjpeg") {
          v!.src = camera.source;
          v!.crossOrigin = "anonymous";
          await v!.play().catch(() => undefined);
        } else if (camera.kind === "rtsp") {
          // go2rtc WHEP endpoint (default name = camera id)
          const whep =
            camera.whepUrl ??
            `${process.env.NEXT_PUBLIC_GO2RTC_URL ?? "http://localhost:1984"}/api/webrtc?src=${encodeURIComponent(
              camera.id,
            )}`;
          await playWhep(v!, whep);
        } else if (camera.kind === "youtube") {
          // handled in JSX as iframe
        }
      } catch (e: any) {
        setError(e.message ?? String(e));
      }
    }
    start();

    return () => {
      cancelled = true;
      if (stream) for (const t of stream.getTracks()) t.stop();
      try {
        v.pause();
      } catch {
        /* ignore */
      }
    };
  }, [camera]);

  // Run a CV worker on the video frames
  useEffect(() => {
    if (!camera.detectors || camera.detectors.length === 0) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;

    const w = new Worker(new URL("./cvWorker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = w;
    w.onmessage = (ev) => {
      const msg = ev.data;
      if (msg.type === "detection") {
        setDetections((d) => d + 1);
        // Send to fabric as cv-event
        fetch("/fabric/api/cv-event", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: `cv-${camera.id}-${Date.now()}`,
            title: `${msg.label} on ${camera.label}`,
            summary: `${(msg.confidence * 100).toFixed(0)}% confidence`,
            severity: msg.label === "fire" ? "high" : "moderate",
            geo: camera.geo,
            payload: msg,
          }),
        }).catch(() => undefined);
      }
    };

    let raf = 0;
    const ctx = c.getContext("2d");
    const tick = () => {
      if (!ctx || v.readyState < 2) {
        raf = requestAnimationFrame(tick);
        return;
      }
      c.width = 160;
      c.height = 90;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      w.postMessage({
        type: "frame",
        detectors: camera.detectors,
        data,
        ts: Date.now(),
      });
      raf = window.setTimeout(() => requestAnimationFrame(tick), 1000) as unknown as number;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      w.terminate();
    };
  }, [camera]);

  return (
    <>
      <div
        className="group relative aspect-video w-56 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black"
        data-agent={`camera-${camera.id}`}
      >
        {camera.kind === "youtube" ? (
          <iframe
            src={camera.source.replace("watch?v=", "embed/")}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; encrypted-media"
          />
        ) : (
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            muted
            playsInline
            autoPlay
          />
        )}
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-x-1 top-1 flex items-center gap-1 text-[10px]">
          <span className="rounded bg-black/60 px-1 py-0.5 backdrop-blur">
            ● {camera.label}
          </span>
          {detections > 0 && (
            <span className="rounded bg-threat-elevated/80 px-1 py-0.5 text-black">
              <Eye className="inline h-3 w-3" /> {detections}
            </span>
          )}
        </div>
        <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            onClick={() => setTheater(true)}
            className="rounded bg-black/60 p-1 text-white/80 hover:text-white"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
          <button
            onClick={onRemove}
            className="rounded bg-black/60 p-1 text-white/80 hover:text-threat-high"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-2 text-center text-[10px] text-threat-high">
            <Activity className="mr-1 h-3 w-3" /> {error}
          </div>
        )}
      </div>

      {theater && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="relative h-[80vh] w-[80vw] overflow-hidden rounded-xl border border-white/10 bg-black">
            <video
              src={
                camera.kind === "hls" || camera.kind === "mjpeg"
                  ? camera.source
                  : undefined
              }
              autoPlay
              muted
              playsInline
              className="h-full w-full object-contain"
            />
            <button
              onClick={() => setTheater(false)}
              className="absolute right-2 top-2 rounded bg-black/60 p-1.5"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs">
              {camera.label} · {camera.kind}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

async function playWhep(video: HTMLVideoElement, whepUrl: string) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  const stream = new MediaStream();
  pc.ontrack = (ev) => {
    stream.addTrack(ev.track);
    video.srcObject = stream;
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const ans = await fetch(whepUrl, {
    method: "POST",
    headers: { "content-type": "application/sdp" },
    body: offer.sdp,
  });
  if (!ans.ok) throw new Error(`WHEP ${ans.status}`);
  const sdp = await ans.text();
  await pc.setRemoteDescription({ type: "answer", sdp });
}
