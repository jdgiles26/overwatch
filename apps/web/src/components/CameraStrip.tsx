"use client";
import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import type { CameraFeed } from "@overwatch/schemas";
import { useStore } from "@/lib/store";
import { CameraTile } from "./CameraTile";
import { Plus, X, Video } from "lucide-react";

export function CameraStrip() {
  const cameras = useStore((s) => s.cameras);
  const setCameras = useStore((s) => s.setCameras);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<CameraFeed>>({
    kind: "rtsp",
    detectors: [],
  });

  useEffect(() => {
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
          })),
        ),
      )
      .catch(() => {
        /* fabric not up yet */
      });
  }, [setCameras]);

  async function addCamera() {
    if (!draft.label) return;
    const isWebcam = draft.kind === "webcam";
    if (!isWebcam && !draft.source) return;
    const id = `cam-${Date.now()}`;
    const cam: any = {
      id,
      label: draft.label,
      source: draft.source ?? "browser:webcam",
      kind: draft.kind ?? "rtsp",
      lat: (draft as any).lat,
      lon: (draft as any).lon,
      whepUrl: draft.whepUrl,
      hlsUrl: draft.hlsUrl,
      detectors: draft.detectors ?? [],
    };
    await apiPost("/api/cameras", cam);
    setCameras([
      ...cameras,
      {
        id,
        label: cam.label,
        source: cam.source,
        kind: cam.kind,
        geo: (draft as any).lat != null ? { lat: (draft as any).lat, lon: (draft as any).lon } : undefined,
        whepUrl: cam.whepUrl,
        hlsUrl: cam.hlsUrl,
        detectors: cam.detectors,
      },
    ]);
    setOpen(false);
    setDraft({ kind: "rtsp", detectors: [] });
  }

  async function removeCam(id: string) {
    await apiDelete(`/api/cameras/${id}`);
    setCameras(cameras.filter((c) => c.id !== id));
  }

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
      </div>
      <div className="scrollable flex flex-1 gap-2 overflow-x-auto">
        {cameras.map((c) => (
          <CameraTile key={c.id} camera={c} onRemove={() => removeCam(c.id)} />
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel w-[460px] p-4 text-sm">
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
                  <option value="rtsp">RTSP (via go2rtc)</option>
                  <option value="hls">HLS</option>
                  <option value="mjpeg">MJPEG</option>
                  <option value="webcam">Webcam (browser)</option>
                  <option value="youtube">YouTube embed</option>
                </select>
              </Field>
              <Field label="Source URL" full>
                <input
                  className="input"
                  placeholder={
                    draft.kind === "webcam"
                      ? "(unused for webcam)"
                      : "rtsp://… or https://…/stream.m3u8"
                  }
                  value={draft.source ?? ""}
                  onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                  disabled={draft.kind === "webcam"}
                />
                {draft.kind === "rtsp" && (
                  <div className="mt-1 text-[10px] text-white/40">
                    RTSP is proxied through go2rtc → WHEP. Make sure go2rtc is
                    running on {process.env.NEXT_PUBLIC_GO2RTC_URL ?? "http://localhost:1984"}
                    .
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
              <Field label="Detectors" full>
                <div className="flex flex-wrap gap-1">
                  {(["motion", "person", "vehicle", "fire", "plate"] as const).map(
                    (d) => (
                      <label
                        key={d}
                        className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase"
                      >
                        <input
                          type="checkbox"
                          checked={(draft.detectors ?? []).includes(d)}
                          onChange={(e) => {
                            const set = new Set(draft.detectors ?? []);
                            if (e.target.checked) set.add(d);
                            else set.delete(d);
                            setDraft({ ...draft, detectors: [...set] });
                          }}
                        />
                        {d}
                      </label>
                    ),
                  )}
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
      <div className="mb-1 text-[10px] uppercase tracking-wider text-white/50">
        {label}
      </div>
      {children}
    </label>
  );
}
