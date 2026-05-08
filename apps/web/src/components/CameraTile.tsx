"use client";
import { useEffect, useRef, useState } from "react";
import type { CameraFeed } from "@overwatch/schemas";
import { Activity, Eye, GripVertical, Trash2, Maximize2, X } from "lucide-react";
import { submitFrame, onDetection, onModelStatus } from "@/lib/visionEngine";
import { useStore } from "@/lib/store";


function youtubeEmbedUrl(src: string): string {
  const short = src.match(/youtu\.be\/([^?&]+)/);
  if (short) return `https://www.youtube.com/embed/${short[1]}?autoplay=1`;
  const watch = src.match(/[?&]v=([^&]+)/);
  if (watch) return `https://www.youtube.com/embed/${watch[1]}?autoplay=1`;
  if (src.includes("/embed/")) return src;
  return src.replace("watch?v=", "embed/");
}

export function CameraTile({
  camera,
  onRemove,
}: {
  camera: CameraFeed;
  onRemove: () => void;
}) {
  const cameras = useStore((s) => s.cameras);
  const setCameras = useStore((s) => s.setCameras);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const hlsRef = useRef<any>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [theater, setTheater] = useState(false);
  const theaterVideoRef = useRef<HTMLVideoElement | null>(null);
  const [detections, setDetections] = useState<number>(0);
  const [lastSummary, setLastSummary] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");

  // Tile width for resize (16:9, default 224 = w-56)
  const [tileWidth, setTileWidth] = useState(224);
  const tileHeight = Math.round(tileWidth * (9 / 16));
  const resizeStart = useRef<{ x: number; w: number } | null>(null);

  // ── Media playback ──────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v || camera.kind === "youtube") return;

    let cancelled = false;
    const onPlaying = () => setStatus("live");
    const onError = () => setStatus("offline");
    v.addEventListener("playing", onPlaying);
    v.addEventListener("error", onError);
    v.addEventListener("stalled", onError);

    async function start() {
      try {
        setStatus("connecting");
        setError(null);
        if (camera.kind === "webcam") {
          const s = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 360 },
            audio: false,
          });
          if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
          streamRef.current = s;
          v!.srcObject = s;
          await v!.play();
        } else if (camera.kind === "mjpeg" || (camera.kind as string) === "direct") {
          v!.src = camera.source;
          v!.crossOrigin = "anonymous";
          await v!.play().catch(() => undefined);
        } else if (camera.kind === "hls") {
          if (v!.canPlayType("application/vnd.apple.mpegurl")) {
            v!.src = camera.source;
            v!.crossOrigin = "anonymous";
            await v!.play().catch(() => undefined);
          } else {
            const Hls = (await import("hls.js")).default;
            if (Hls.isSupported()) {
              const hls = new Hls({ liveSyncDurationCount: 2, lowLatencyMode: true });
              hlsRef.current = hls;
              hls.attachMedia(v!);
              hls.loadSource(camera.source);
              hls.on(Hls.Events.ERROR, (_e: any, d: any) => {
                if (d?.fatal) { setError(`HLS ${d.type}: ${d.details}`); setStatus("offline"); }
              });
            } else {
              throw new Error("HLS not supported in this browser");
            }
          }
        } else if (camera.kind === "rtsp") {
          const whep =
            camera.whepUrl ??
            `${process.env.NEXT_PUBLIC_GO2RTC_URL ?? "http://localhost:1984"}/api/webrtc?src=${encodeURIComponent(camera.id)}`;
          pcRef.current = await playWhep(v!, whep);
        }
      } catch (e: any) {
        if (!cancelled) { setError(e.message ?? String(e)); setStatus("offline"); }
      }
    }
    start();

    return () => {
      cancelled = true;
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("error", onError);
      v.removeEventListener("stalled", onError);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      try { hlsRef.current?.destroy(); hlsRef.current = null; } catch { /* ignore */ }
      try { pcRef.current?.close(); pcRef.current = null; } catch { /* ignore */ }
      try { v.pause(); } catch { /* ignore */ }
    };
  }, [camera]);

  // ── Theater: share existing stream / hls instance ────────────────────────
  useEffect(() => {
    if (!theater) return;
    const tv = theaterVideoRef.current;
    if (!tv) return;
    if (streamRef.current) {
      tv.srcObject = streamRef.current;
      tv.play().catch(() => undefined);
    } else if (hlsRef.current) {
      hlsRef.current.attachMedia(tv);
      tv.play().catch(() => undefined);
    } else if (camera.kind === "hls" || camera.kind === "mjpeg" || (camera.kind as string) === "direct") {
      tv.src = camera.source;
      tv.crossOrigin = "anonymous";
      tv.play().catch(() => undefined);
    }
    const primaryVideo = videoRef.current;
    return () => {
      if (hlsRef.current && primaryVideo) hlsRef.current.attachMedia(primaryVideo);
      try { tv.pause(); tv.srcObject = null; tv.removeAttribute("src"); } catch { /* ignore */ }
    };
  }, [theater, camera]);

  // ── AI detection via shared vision worker ────────────────────────────────
  useEffect(() => {
    if (!camera.detectors || camera.detectors.length === 0) return;

    const unsubStatus = onModelStatus(() => { /* status tracked globally */ });
    const unsubDetection = onDetection(camera.id, (msg) => {
      const summary: string = (msg.summary ?? "").trim();
      if (!summary || summary.toLowerCase().includes("no activity")) return;

      setLastSummary(summary);
      setDetections((n) => n + 1);
      fetch("/fabric/api/cv-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: `cv-${camera.id}-${Date.now()}`,
          title: `${camera.label}: ${summary}`,
          summary,
          severity: "moderate",
          geo: camera.geo,
          payload: { cameraId: camera.id, detectors: camera.detectors },
        }),
      }).catch(() => undefined);
    });

    return () => { unsubStatus(); unsubDetection(); };
  }, [camera]);

  // ── Frame extraction loop ────────────────────────────────────────────────
  useEffect(() => {
    if (!camera.detectors || camera.detectors.length === 0) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;

    const ctx = c.getContext("2d");
    let timer = 0;
    const tick = () => {
      if (v.readyState >= 2 && ctx) {
        c.width = 320;
        c.height = 180;
        ctx.drawImage(v, 0, 0, 320, 180);
        const imgData = ctx.getImageData(0, 0, 320, 180);
        // Copy before transfer so the canvas buffer isn't neutered
        const copy = new Uint8ClampedArray(imgData.data).buffer;
        submitFrame(camera.id, copy, 320, 180, camera.detectors);
      }
      timer = window.setTimeout(tick, 2000);
    };
    timer = window.setTimeout(tick, 4000); // wait for model to load first
    return () => clearTimeout(timer);
  }, [camera]);

  // ── Drag-to-reorder (within the strip, no CameraStrip changes needed) ────
  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("cameraId", camera.id);
    e.dataTransfer.effectAllowed = "move";
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const dragId = e.dataTransfer.getData("cameraId");
    if (!dragId || dragId === camera.id) return;
    const arr = [...cameras];
    const from = arr.findIndex((c) => c.id === dragId);
    const to = arr.findIndex((c) => c.id === camera.id);
    if (from === -1 || to === -1) return;
    const [item] = arr.splice(from, 1);
    if (item) { arr.splice(to, 0, item); setCameras(arr); }
  }

  // ── Resize handle ────────────────────────────────────────────────────────
  function onResizeDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    resizeStart.current = { x: e.clientX, w: tileWidth };
  }
  function onResizeMove(e: React.PointerEvent) {
    if (!resizeStart.current) return;
    setTileWidth(Math.max(160, Math.min(540, resizeStart.current.w + (e.clientX - resizeStart.current.x))));
  }
  function onResizeUp(e: React.PointerEvent) {
    (e.target as Element).releasePointerCapture(e.pointerId);
    resizeStart.current = null;
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className="group relative shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black"
        style={{ width: tileWidth, height: tileHeight }}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        data-agent={`camera-${camera.id}`}
      >
        {camera.kind === "youtube" ? (
          <iframe
            src={youtubeEmbedUrl(camera.source)}
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

        {/* Top bar — identical to original, plus grip icon */}
        <div className="absolute inset-x-1 top-1 flex items-center gap-1 text-[10px]">
          <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-white/30 active:cursor-grabbing" />
          <span className="flex items-center gap-1 rounded bg-black/60 px-1 py-0.5 backdrop-blur">
            <span
              className={
                "h-1.5 w-1.5 rounded-full " +
                (status === "live"
                  ? "bg-accent-400 animate-pulse"
                  : status === "offline"
                  ? "bg-threat-high"
                  : "bg-white/40 animate-pulse")
              }
            />
            {camera.label}
          </span>
          <span className="rounded bg-black/40 px-1 py-0.5 text-[9px] uppercase">
            {camera.kind}
          </span>
          {detections > 0 && (
            <span
              className="rounded bg-threat-elevated/80 px-1 py-0.5 text-black"
              title={lastSummary || undefined}
            >
              <Eye className="inline h-3 w-3" /> {detections}
            </span>
          )}
        </div>

        {/* Bottom controls — identical to original */}
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

        {/* Resize grip — bottom-right, same hover visibility as bottom controls */}
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize opacity-0 transition group-hover:opacity-60"
          style={{ touchAction: "none" }}
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className="absolute bottom-0.5 right-0.5 fill-white/60">
            <path d="M9 9L9 5L5 9Z M9 9L9 2L2 9Z" />
          </svg>
        </div>
      </div>

      {/* Theater — shares the same stream/hls */}
      {theater && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div
            className="relative overflow-hidden rounded-xl border border-white/10 bg-black"
            style={{ width: "min(84vw,1280px)", aspectRatio: "16/9" }}
          >
            {camera.kind === "youtube" ? (
              <iframe
                src={youtubeEmbedUrl(camera.source)}
                className="h-full w-full"
                allow="autoplay; encrypted-media"
              />
            ) : (
              <video
                ref={theaterVideoRef}
                className="h-full w-full object-contain"
                autoPlay
                muted
                playsInline
              />
            )}
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

async function playWhep(video: HTMLVideoElement, whepUrl: string): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  const stream = new MediaStream();
  pc.ontrack = (ev) => { stream.addTrack(ev.track); video.srcObject = stream; };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const ans = await fetch(whepUrl, {
    method: "POST",
    headers: { "content-type": "application/sdp" },
    body: offer.sdp ?? "",
  });
  if (!ans.ok) throw new Error(`WHEP ${ans.status} (${whepUrl})`);
  await pc.setRemoteDescription({ type: "answer", sdp: await ans.text() });
  return pc;
}
