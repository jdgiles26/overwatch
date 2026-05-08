/// <reference lib="webworker" />

// Zero-shot NLI topic classifier for OSINT event enrichment.
// Uses Xenova/nli-deberta-v3-xsmall to assign threat-relevant topic tags to
// free-text event titles and summaries — without task-specific fine-tuning.

type ClassifyMsg = { type: "classify"; eventId: string; text: string };
type ReadyMsg = { type: "ready" };
type TopicsMsg = { type: "topics"; eventId: string; topics: string[]; scores: Record<string, number> };
type ErrorMsg = { type: "error"; error: string };

const TOPIC_LABELS = [
  "threat to critical infrastructure",
  "civil unrest or social instability",
  "natural disaster or extreme weather",
  "cyberattack or digital security breach",
  "public health emergency",
  "environmental or chemical hazard",
  "armed conflict or military activity",
  "accident or industrial incident",
] as const;

const THRESHOLD = 0.45;

let classifier: any = null;
let ready = false;
const queue: ClassifyMsg[] = [];

async function load() {
  try {
    const { pipeline } = await import("@huggingface/transformers") as any;
    classifier = await pipeline(
      "zero-shot-classification",
      "Xenova/nli-deberta-v3-xsmall",
      { device: "wasm", dtype: "q8" },
    );
    ready = true;
    self.postMessage({ type: "ready" } satisfies ReadyMsg);
    // Drain any messages that arrived before the model was ready
    for (const msg of queue.splice(0)) {
      await classify(msg);
    }
  } catch (err) {
    self.postMessage({ type: "error", error: String(err) } satisfies ErrorMsg);
  }
}

async function classify(msg: ClassifyMsg) {
  try {
    const result = await classifier(msg.text, [...TOPIC_LABELS], { multi_label: true });
    const topics: string[] = [];
    const scores: Record<string, number> = {};
    for (let i = 0; i < result.labels.length; i++) {
      scores[result.labels[i]] = result.scores[i];
      if (result.scores[i] >= THRESHOLD) topics.push(result.labels[i]);
    }
    self.postMessage({ type: "topics", eventId: msg.eventId, topics, scores } satisfies TopicsMsg);
  } catch {
    // Swallow per-event errors — the worker stays alive for subsequent events
  }
}

load();

self.onmessage = async (ev: MessageEvent<ClassifyMsg>) => {
  if (ev.data.type !== "classify") return;
  if (!ready) {
    queue.push(ev.data);
    return;
  }
  await classify(ev.data);
};

export {};
