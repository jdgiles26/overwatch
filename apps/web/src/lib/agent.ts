"use client";

import { runChat, runVisionCaption, detectDevice } from "./ai";
import { useStore } from "./store";

export type AgentStep = {
  ts: number;
  thought: string;
  action?: { type: string; target?: string; value?: any };
  result?: string;
  caption?: string;
};

interface OverseerArgs {
  mission: string;
  budget: number;
  onStep: (s: AgentStep) => void;
  onProgress?: (msg: string) => void;
  onDevice?: (d: string) => void;
  shouldStop: () => boolean;
  isPaused: () => boolean;
}

const SYSTEM = `You are OverWatch Overseer, an autonomous agent navigating a tactical OSINT dashboard.
Return EXACTLY ONE JSON object per turn — nothing else. Allowed actions:
  {"action":"click","target":"<data-agent value>"}
  {"action":"flyToTopEvent"}                     // jump to the highest-severity event
  {"action":"flyTo","lat":<num>,"lon":<num>,"zoom":<num>}
  {"action":"setView","value":"map3d"|"map2d"|"split"}
  {"action":"toggleNightVision","value":true|false}
  {"action":"openAnalyst","value":true|false}
  {"action":"openOverseer","value":false}
  {"action":"navigate","value":"/connectors" | "/"}
  {"action":"selectCategory","value":"weather"|"seismic"|"air"|"transport"|"power"|"fire"|"news"|"iot"|"cv"|"space"|"finance"|"social"}
  {"action":"selectSeverity","value":"info"|"low"|"moderate"|"high"|"extreme"}
  {"action":"clearFilters"}
  {"action":"say","value":"final summary including any findings"}
  {"action":"stop","value":"why"}
You will receive: the mission, last step result, a list of available data-agent targets,
a compact live-state snapshot (THREATCON, PIR answers, top 5 events with geo), and a
vision caption of what's currently rendered. Plan iteratively. End with {"action":"say",...}
when the mission is complete or after BUDGET steps.`;

export async function runOverseer(a: OverseerArgs) {
  const { onStep, onProgress, onDevice, shouldStop, isPaused, budget, mission } = a;
  onDevice?.(await detectDevice());

  let lastResult = "(start)";
  for (let i = 0; i < budget; i++) {
    if (shouldStop()) return;
    while (isPaused()) {
      await sleep(200);
      if (shouldStop()) return;
    }

    onProgress?.("Capturing viewport…");
    const blob = await captureScreenshot();
    let caption = "";
    if (blob) {
      try {
        caption = await runVisionCaption({ blob, onProgress });
      } catch {
        caption = "(vision unavailable)";
      }
    }

    const outline = collectOutline();
    const snapshot = liveSnapshot();
    onProgress?.("Reasoning…");
    const userMessage = `MISSION: ${mission}
BUDGET: ${budget}
STEP: ${i + 1}
LAST: ${lastResult}
TARGETS:
${outline}
LIVE:
${snapshot}
VISION: ${caption}
Return ONE JSON action.`;

    let raw = "";
    let handleRef: { stop: () => void } | null = null;
    let earlyCalled = false;
    const tryEarlyStop = () => {
      if (earlyCalled || !handleRef) return;
      if (raw.includes('"action"') && /\{[\s\S]*?"action"[\s\S]*?\}/.test(raw)) {
        earlyCalled = true;
        handleRef.stop();
      }
    };
    const handle = await runChat({
      model: "HuggingFaceTB/SmolLM2-360M-Instruct",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMessage },
      ],
      maxNewTokens: 220,
      temperature: 0.2,
      onProgress,
      onToken: (t) => {
        raw += t;
        tryEarlyStop();
      },
    });
    handleRef = handle;
    // If the JSON already streamed before the handle resolved.
    tryEarlyStop();
    raw = (await handle.done) || raw;
    if (shouldStop()) return;

    const parsed = parseAction(raw);
    const step: AgentStep = {
      ts: Date.now(),
      thought: extractThought(raw),
      caption,
      action: parsed
        ? { type: parsed.action, target: parsed.target, value: parsed.value }
        : undefined,
    };
    onStep(step);

    if (!parsed) {
      lastResult = "Could not parse action. Stopping.";
      break;
    }
    lastResult = await executeAction(parsed);
    step.result = lastResult;
    onStep({ ...step, result: lastResult });

    if (parsed.action === "say" || parsed.action === "stop") break;
    await sleep(500);
  }
}

async function captureScreenshot(): Promise<Blob | null> {
  // Prefer a direct read of a visible WebGL canvas (Cesium / MapLibre).
  // html-to-image cannot read those contexts without preserveDrawingBuffer
  // and tends to produce empty captures of dynamic 3D scenes.
  try {
    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>("canvas"));
    const visible = canvases
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 200 && r.height > 200;
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return br.width * br.height - ar.width * ar.height;
      });
    const target = visible[0];
    if (target) {
      const blob = await new Promise<Blob | null>((resolve) =>
        target.toBlob((b) => resolve(b), "image/jpeg", 0.85),
      );
      if (blob && blob.size > 1024) return blob;
    }
  } catch {
    /* fall through */
  }
  try {
    const { toBlob } = await import("html-to-image");
    return await toBlob(document.body, {
      pixelRatio: 0.5,
      cacheBust: true,
      filter: (n) =>
        !(
          n instanceof Element &&
          (n.classList?.contains("cesium-widget-credits") || n.tagName === "VIDEO")
        ),
    });
  } catch {
    return null;
  }
}

function collectOutline(): string {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-agent]"));
  // Avoid spamming the model with hundreds of per-event targets; keep
  // distinct tag names so the model has a clean menu.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const el of els) {
    const tag = el.dataset.agent ?? "?";
    if (tag.startsWith("event-") || tag.startsWith("camera-")) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
    out.push(`- ${tag} :: "${text}"`);
    if (out.length >= 60) break;
  }
  return out.join("\n");
}

function liveSnapshot(): string {
  const s = useStore.getState();
  const tc = s.threatcon;
  const top = s.events
    .filter((e) => e.severity !== "info")
    .slice(0, 5)
    .map(
      (e) =>
        `${e.severity}/${e.category} ${e.title}${
          e.geo ? ` @ ${e.geo.lat.toFixed(2)},${e.geo.lon.toFixed(2)}` : ""
        }`,
    );
  const pir = s.pirs.map((p) => `${p.question} -> ${p.answer}`);
  return [
    tc ? `THREATCON ${tc.score} (${tc.level})` : "THREATCON pending",
    `Top: ${top.join(" | ") || "(quiet)"}`,
    `PIR: ${pir.join(" | ")}`,
    `Active feeds: ${s.status.filter((x) => x.connected).length}/${s.status.length}`,
    `View: ${s.view}, NightVision: ${s.nightVision}`,
  ].join("\n");
}

function parseAction(raw: string): { action: string; [k: string]: any } | null {
  // Try fenced code blocks first.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const tryObj = tryJson(fenced[1] ?? "");
    if (tryObj) return tryObj;
  }
  // Find any {...} that contains "action": "...".
  const re = /\{[\s\S]*?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (!m[0].includes('"action"')) continue;
    const obj = tryJson(m[0]);
    if (obj && typeof obj.action === "string") return obj;
  }
  return null;
}

function tryJson(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    // attempt minor cleanup (single-quotes, trailing commas)
    try {
      const cleaned = s
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/'(\w+)'\s*:/g, '"$1":');
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function extractThought(raw: string): string {
  const before = raw.split("{")[0]?.trim() ?? "";
  return before.length ? before.slice(0, 320) : "(no commentary)";
}

async function executeAction(a: { action: string; [k: string]: any }): Promise<string> {
  const s = useStore.getState();
  switch (a.action) {
    case "click": {
      const el = document.querySelector<HTMLElement>(`[data-agent="${a.target}"]`);
      if (!el) return `no element data-agent="${a.target}"`;
      el.click();
      return `clicked ${a.target}`;
    }
    case "flyTo": {
      if (typeof a.lat === "number" && typeof a.lon === "number") {
        s.requestFlyTo({ lat: a.lat, lon: a.lon, zoom: a.zoom ?? 5 });
        return `flying to ${a.lat.toFixed(2)},${a.lon.toFixed(2)}`;
      }
      return "flyTo missing coords";
    }
    case "flyToTopEvent": {
      const sevRank: Record<string, number> = {
        extreme: 4,
        high: 3,
        moderate: 2,
        low: 1,
        info: 0,
      };
      const sorted = [...s.events]
        .filter((e) => e.geo)
        .sort((a, b) => (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0));
      const top = sorted[0];
      if (!top || !top.geo) return "no geolocated events available";
      s.requestFlyTo({ lat: top.geo.lat, lon: top.geo.lon, zoom: 6 });
      s.selectEvent(top.id);
      return `flew to "${top.title}" (${top.severity}) at ${top.geo.lat.toFixed(2)},${top.geo.lon.toFixed(2)}`;
    }
    case "setView": {
      if (["map3d", "map2d", "split"].includes(a.value)) {
        s.setView(a.value);
        return `view=${a.value}`;
      }
      return "invalid view";
    }
    case "toggleNightVision": {
      const next = a.value === undefined ? !s.nightVision : !!a.value;
      s.setNightVision(next);
      return `nightVision=${next}`;
    }
    case "openAnalyst": {
      s.setAnalystOpen(!!a.value);
      return `analyst=${!!a.value}`;
    }
    case "openOverseer": {
      s.setOverseerOpen(!!a.value);
      return `overseer=${!!a.value}`;
    }
    case "navigate": {
      if (typeof a.value === "string" && a.value.startsWith("/")) {
        location.assign(a.value);
        return `navigating to ${a.value}`;
      }
      return "blocked navigation";
    }
    case "selectCategory": {
      if (typeof a.value === "string") {
        s.toggleCategory(a.value);
        return `toggled category ${a.value}`;
      }
      return "selectCategory missing value";
    }
    case "selectSeverity": {
      if (typeof a.value === "string") {
        s.toggleSeverity(a.value);
        return `toggled severity ${a.value}`;
      }
      return "selectSeverity missing value";
    }
    case "clearFilters": {
      s.clearFilters();
      return "filters cleared";
    }
    case "say":
      return String(a.value ?? "(no message)");
    case "stop":
      return `stopped: ${a.value}`;
    default:
      return `unknown action ${a.action}`;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
