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
Available actions (return EXACTLY ONE JSON object per turn):
  {"action":"click","target":"<data-agent value>"}
  {"action":"flyTo","lat":<num>,"lon":<num>,"zoom":<num>}
  {"action":"setView","value":"map3d"|"map2d"|"split"}
  {"action":"toggleNightVision","value":true|false}
  {"action":"openAnalyst","value":true|false}
  {"action":"openOverseer","value":false}
  {"action":"navigate","value":"/connectors"}
  {"action":"say","value":"final summary"}
  {"action":"stop","value":"why"}
You receive: the mission, last step result, current page outline, and a vision caption.
Plan iteratively. End with {"action":"say",...} when the mission is complete or after at most BUDGET steps.`;

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
    onProgress?.("Reasoning…");
    const userMessage = `MISSION: ${mission}\nBUDGET: ${budget}\nSTEP: ${i + 1}\nLAST: ${lastResult}\nOUTLINE:\n${outline}\nVISION: ${caption}\nReturn ONE JSON action.`;

    let raw = "";
    await new Promise<void>((resolve, reject) => {
      runChat({
        model: "HuggingFaceTB/SmolLM2-360M-Instruct",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMessage },
        ],
        maxNewTokens: 220,
        onProgress,
        onToken: (t) => (raw += t),
      })
        .then((stopper) => {
          // give a bounded wait window for completion
          let elapsed = 0;
          const timer = setInterval(() => {
            elapsed += 200;
            if (raw.includes("\"action\"") && raw.match(/\}\s*$/m)) {
              clearInterval(timer);
              stopper.stop();
              resolve();
            } else if (elapsed > 25_000 || shouldStop()) {
              clearInterval(timer);
              stopper.stop();
              resolve();
            }
          }, 200);
        })
        .catch(reject);
    });

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
  try {
    const { toBlob } = await import("html-to-image");
    return await toBlob(document.body, {
      pixelRatio: 0.5,
      cacheBust: true,
      filter: (n) =>
        !(n instanceof Element && (n.classList?.contains("cesium-widget-credits") || n.tagName === "VIDEO")),
    });
  } catch {
    return null;
  }
}

function collectOutline(): string {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-agent]"));
  return els
    .slice(0, 50)
    .map((el) => {
      const tag = el.dataset.agent ?? "?";
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `- ${tag} :: "${text}"`;
    })
    .join("\n");
}

function parseAction(raw: string): { action: string; [k: string]: any } | null {
  // find first {...}
  const m = raw.match(/\{[^{}]*"action"[^{}]*\}/s);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
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
    case "setView": {
      if (["map3d", "map2d", "split"].includes(a.value)) {
        s.setView(a.value);
        return `view=${a.value}`;
      }
      return "invalid view";
    }
    case "toggleNightVision": {
      s.setNightVision(!!a.value);
      return `nightVision=${!!a.value}`;
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
