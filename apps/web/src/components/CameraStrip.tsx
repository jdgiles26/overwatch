"use client";
import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import type { CameraFeed } from "@overwatch/schemas";
import { useStore } from "@/lib/store";
import { CameraTile } from "./CameraTile";
import { Plus, X, Video, Cpu, Crosshair } from "lucide-react";
import { onModelStatus } from "@/lib/visionEngine";
import { onDroneDetectorStatus } from "@/lib/droneDetectorWorkerEngine";
import type { DetectionMode } from "@/lib/store";

// Detector presets — user can click these or type custom terms
const DETECTOR_PRESETS = ["person", "vehicle", "fire", "motion", "crowd", "package", "weapon", "drone"];

export function CameraStrip() {
  const cameras = useStore((s) => s.cameras);
  const setCameras = useStore((s) => s.setCameras);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<CameraFeed> & { detectors: string[] }>({
    kind: "hls",
    detectors: [],
  });
  const [detectorInput, setDetectorInput] = useState("");
  const [modelStatus, setModelStatus] = useState<string>("idle");
  const [yoloStatus, setYoloStatus] = useState<string>("idle");
  const globalDetectionMode = useStore((s) => s.globalDetectionMode);
  const setGlobalDetectionMode = useStore((s) => s.setGlobalDetectionMode);

  // Track LFM model status globally in the strip header
  useEffect(() => {
    const unsub = onModelStatus((s) => setModelStatus(s));
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    const unsub = onDroneDetectorStatus((s) => setYoloStatus(s));
    return () => { unsub(); };
  }, []);

  function loadCameras() {
    apiGet<any[]>("/api/cameras")
      .then((cs) =>
        setCameras(
          cs.map((c) => ({
            id: c.id,
            label: c.label,
            source: c.source,
            kind: c.kind,
            geo:
              c.lat != null && c.lon != null
                ? { lat: c.lat, lon: c.lon }
                : undefined,
            whepUrl: c.whep_url ?? undefined,
            hlsUrl: c.hls_url ?? undefined,
            detectors: Array.isArray(c.detectors) ? c.detectors : [],
            detectionMode: (c.detectionMode as any) ?? undefined,
          })),
        ),
      )
      .catch(() => undefined);
  }

  useEffect(() => {
    loadCameras();
    // Refresh on window focus so externally-added cameras appear
    window.addEventListener("focus", loadCameras);
    return () => window.removeEventListener("focus", loadCameras);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function addDetectorTag(val: string) {
    const tag = val.trim().toLowerCase();
    if (!tag) return;
    if (!draft.detectors.includes(tag)) {
      setDraft({ ...draft, detectors: [...draft.detectors, tag] });
    }
    setDetectorInput("");
  }

  function removeDetectorTag(tag: string) {
    setDraft({ ...draft, detectors: draft.detectors.filter((d) => d !== tag) });
  }

  async function addCamera() {
    if (!draft.label) return;
    if (draft.kind !== "webcam" && !draft.source) return;
    const id = `cam-${Date.now()}`;
    const cam: any = {
      id,
      label: draft.label,
      source: draft.source ?? "browser:webcam",
      kind: draft.kind ?? "hls",
      lat: (draft as any).lat,
      lon: (draft as any).lon,
      whepUrl: draft.whepUrl,
      hlsUrl: draft.hlsUrl,
      detectors: draft.detectors,
    };
    await apiPost("/api/cameras", cam);
    setCameras([
      ...cameras,
      {
        id,
        label: cam.label,
        source: cam.source,
        kind: cam.kind,
        geo:
          (draft as any).lat != null
            ? { lat: (draft as any).lat, lon: (draft as any).lon }
            : undefined,
        whepUrl: cam.whepUrl,
        hlsUrl: cam.hlsUrl,
        detectors: cam.detectors,
        detectionMode: globalDetectionMode,
      },
    ]);
    setOpen(false);
    setDraft({ kind: "hls", detectors: [] });
    setDetectorInput("");
  }

  async function removeCam(id: string) {
    await apiDelete(`/api/cameras/${id}`);
    setCameras(cameras.filter((c) => c.id !== id));
  }

  const statusColor =
    modelStatus === "ready"
      ? "text-accent-400"
      : modelStatus === "loading"
      ? "text-yellow-400 animate-pulse"
      : modelStatus === "error"
      ? "text-red-400"
      : "text-white/30";

  const statusLabel =
    modelStatus === "ready"
      ? "LFM ready"
      : modelStatus === "loading"
      ? "LFM loading…"
      : modelStatus === "error"
      ? "LFM error"
      : "";

  const yoloStatusColor =
    yoloStatus === "ready"
      ? "text-accent-400"
      : yoloStatus === "loading"
      ? "text-yellow-400 animate-pulse"
      : yoloStatus === "error"
      ? "text-red-400"
      : "text-white/30";

  const yoloStatusLabel =
    yoloStatus === "ready"
      ? "YOLO ready"
      : yoloStatus === "loading"
      ? "YOLO loading…"
      : yoloStatus === "error"
      ? "YOLO error"
      : "";

  return (
    <div
      className="flex h-32 items-stretch gap-2 border-t border-white/5 bg-ink-900/70 p-2"
      data-agent="camera-strip"
    >
      <div className="flex w-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/10 text-xs text-white/50">
        <Video className="h-4 w-4" />
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 rounded-md bg-accent-500/15 px-2 py-1 text-accent-400 hover:bg-accent-500/25"
          data-agent="add-camera"
        >
          <Plus className="h-3 w-3" /> Add Camera
        </button>
        <span className="text-white/30">{cameras.length} feeds</span>
        {statusLabel && (
          <span className={`flex items-center gap-0.5 text-[9px] ${statusColor}`}>
            <Cpu className="h-2.5 w-2.5" /> {statusLabel}
          </span>
        )}
        {yoloStatusLabel && (
          <span className={`flex items-center gap-0.5 text-[9px] ${yoloStatusColor}`}>
            <Crosshair className="h-2.5 w-2.5" /> {yoloStatusLabel}
          </span>
        )}
        {/* Detection mode toggle */}
        <div className="mt-1 flex gap-0.5 text-[8px]">
          {(["both", "yolo", "vlm", "off"] as DetectionMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setGlobalDetectionMode(mode)}
              className={`rounded px-1.5 py-0.5 uppercase transition ${
                globalDetectionMode === mode
                  ? "bg-accent-400/20 text-accent-400"
                  : "text-white/30 hover:text-white/50"
              }`}
            >
              {mode === "both" ? "ALL" : mode.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="scrollable flex flex-1 gap-2 overflow-x-auto">
        {cameras.map((c) => (
          <CameraTile key={c.id} camera={c} onRemove={() => removeCam(c.id)} />
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel w-[480px] p-4 text-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-semibold">New camera feed</div>
              <button onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Label">
                <input
                  className="input"
                  value={draft.label ?? ""}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </Field>
              <Field label="Kind">
                <select
                  className="input"
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as any })}
                >
                  <option value="webcam">Webcam (browser)</option>
                  <option value="hls">HLS</option>
                  <option value="rtsp">RTSP (via go2rtc)</option>
                  <option value="mjpeg">MJPEG</option>
                  <option value="youtube">YouTube embed</option>
                  <option value="direct">Direct URL (mp4 / webm)</option>
                </select>
              </Field>
              <Field label="Source URL" full>
                <input
                  className="input"
                  placeholder={
                    draft.kind === "webcam"
                      ? "(unused for webcam)"
                      : "https://…/stream.m3u8 or rtsp://…"
                  }
                  value={draft.source ?? ""}
                  onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                  disabled={draft.kind === "webcam"}
                />
                {draft.kind === "rtsp" && (
                  <div className="mt-1 text-[10px] text-white/40">
                    RTSP is proxied through go2rtc → WHEP. go2rtc must be running on{" "}
                    {process.env.NEXT_PUBLIC_GO2RTC_URL ?? "http://localhost:1984"}.
                  </div>
                )}
              </Field>
              {draft.kind !== "webcam" && (
                <Field label="WHEP URL (optional override)" full>
                  <input
                    className="input"
                    placeholder="http://localhost:1984/api/webrtc?src=<stream>"
                    value={draft.whepUrl ?? ""}
                    onChange={(e) => setDraft({ ...draft, whepUrl: e.target.value })}
                  />
                </Field>
              )}
              <Field label="Lat">
                <input
                  className="input"
                  type="number"
                  step="0.0001"
                  value={(draft as any).lat ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, ...({ lat: Number(e.target.value) } as any) })
                  }
                />
              </Field>
              <Field label="Lon">
                <input
                  className="input"
                  type="number"
                  step="0.0001"
                  value={(draft as any).lon ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, ...({ lon: Number(e.target.value) } as any) })
                  }
                />
              </Field>

              {/* Open-vocab detector tags */}
              <Field label="Detectors (what to watch for)" full>
                <div className="mb-1 flex flex-wrap gap-1">
                  {DETECTOR_PRESETS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => addDetectorTag(d)}
                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase transition ${
                        draft.detectors.includes(d)
                          ? "border-accent-400/60 bg-accent-400/10 text-accent-400"
                          : "border-white/10 text-white/40 hover:border-white/20 hover:text-white/60"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input
                    className="input flex-1"
                    placeholder="type custom term and press Enter…"
                    value={detectorInput}
                    onChange={(e) => setDetectorInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addDetectorTag(detectorInput);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="rounded bg-white/10 px-2 text-xs text-white/60 hover:bg-white/20"
                    onClick={() => addDetectorTag(detectorInput)}
                  >
                    Add
                  </button>
                </div>
                {draft.detectors.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {draft.detectors.map((d) => (
                      <span
                        key={d}
                        className="flex items-center gap-0.5 rounded-full bg-accent-400/10 px-2 py-0.5 text-[10px] text-accent-400"
                      >
                        {d}
                        <button
                          type="button"
                          onClick={() => removeDetectorTag(d)}
                          className="ml-0.5 opacity-60 hover:opacity-100"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1 text-[10px] text-white/30">
                  The VLM vision model will focus on these terms. YOLO detects drones/aircraft automatically.
                </div>
              </Field>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={addCamera} data-agent="save-camera">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .input { width:100%; background:rgba(15,20,27,0.7); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:6px 8px; outline:none; color:white; font-size:12px; }
        .input:focus { border-color: rgba(56,224,178,0.4); }
        .btn-primary { background:rgba(56,224,178,0.2); color:#5cf0c9; padding:6px 12px; border-radius:6px; font-size:12px; }
        .btn-primary:hover { background:rgba(56,224,178,0.3); }
        .btn-ghost { color:rgba(255,255,255,0.6); padding:6px 12px; font-size:12px; }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={full ? "col-span-2" : ""}>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-white/50">{label}</div>
      {children}
    </label>
  );
}
