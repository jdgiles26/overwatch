/// <reference lib="webworker" />

let pipe: any = null;
const TAGS = [
  "weather emergency",
  "earthquake",
  "wildfire",
  "air quality alert",
  "transportation incident",
  "power outage",
  "civil unrest",
  "cyber attack",
  "geopolitical conflict",
  "space weather",
  "market shock",
  "law enforcement",
];

async function ensure() {
  if (pipe) return pipe;
  const { pipeline } = await import("@huggingface/transformers");
  pipe = await pipeline(
    "zero-shot-classification",
    "Xenova/nli-deberta-v3-xsmall",
    { device: "wasm", dtype: "q8" },
  );
  return pipe;
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, text } = ev.data ?? {};
  if (!text || !id) return;
  try {
    const p = await ensure();
    const result = await p(text, TAGS, { multi_label: false });
    const top = result?.labels?.[0];
    const score = result?.scores?.[0];
    (self as any).postMessage({ id, tag: top, score });
  } catch (e: any) {
    (self as any).postMessage({ id, error: e?.message ?? String(e) });
  }
};

export {};
