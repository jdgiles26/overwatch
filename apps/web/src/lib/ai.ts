"use client";

import { useStore } from "./store";

type Message = { role: "system" | "user" | "assistant"; content: string };

let _transformers: any | null = null;
let _consoleFilterInstalled = false;

/**
 * ORT writes "W:onnxruntime: ... VerifyEachNodeIsAssignedToAnEp" warnings
 * straight to console.error from inside the wasm runtime. Next.js's dev
 * overlay then escalates *every* console.error into a red error toast.
 *
 * These messages are informational ("some ops fell back to CPU"), not failures.
 * We swallow them at the source by:
 *   1. Lowering ORT's log threshold (env.logLevel + per-session logSeverityLevel).
 *   2. Installing a one-time console.error filter that drops the few patterns
 *      that ORT prints below that threshold anyway.
 */
function installConsoleFilter() {
  if (_consoleFilterInstalled) return;
  if (typeof window === "undefined") return;
  _consoleFilterInstalled = true;
  const orig = console.error.bind(console);
  const NOISY = [
    /VerifyEachNodeIsAssignedToAnEp/i,
    /some nodes were not assigned to the preferred execution providers/i,
    /Rerunning with verbose output/i,
    /CleanUnusedInitializersAndNodeArgs/i,
    /\bW:onnxruntime/i,
    /\bI:onnxruntime/i,
    /ort-wasm/i,
  ];
  console.error = (...args: any[]) => {
    try {
      const text = args
        .map((a) => (typeof a === "string" ? a : a?.message ?? ""))
        .join(" ");
      if (text && NOISY.some((re) => re.test(text))) {
        // Re-route to debug so it stays visible in the console but doesn't
        // trigger Next.js's dev overlay.
        console.debug("[ort]", ...args);
        return;
      }
    } catch {
      /* ignore */
    }
    orig(...args);
  };
}

async function getTransformers() {
  if (_transformers) return _transformers;
  installConsoleFilter();
  const mod = await import("@huggingface/transformers");
  const env: any = mod.env;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  // Lower ORT's global log level. Accepts: "verbose" | "info" | "warning" | "error" | "fatal"
  try {
    env.logLevel = "error";
    if (env.backends?.onnx) {
      env.backends.onnx.logLevel = "error";
      if (env.backends.onnx.wasm) {
        env.backends.onnx.wasm.logLevel = "error";
        if (typeof SharedArrayBuffer === "undefined") {
          env.backends.onnx.wasm.numThreads = 1;
        }
      }
      if (env.backends.onnx.webgpu) {
        env.backends.onnx.webgpu.logLevel = "error";
      }
    }
  } catch {
    /* older builds may reject these fields; ignore */
  }
  _transformers = mod;
  return mod;
}

const SESSION_OPTIONS = {
  logSeverityLevel: 3, // 0 verbose, 1 info, 2 warning, 3 error, 4 fatal
  logVerbosityLevel: 0,
};

export async function detectDevice(): Promise<"webgpu" | "wasm"> {
  if (typeof navigator !== "undefined" && (navigator as any).gpu) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter) return "webgpu";
    } catch {
      /* fall through to wasm */
    }
  }
  return "wasm";
}

export interface RunChatArgs {
  model: string;
  messages: Message[];
  onProgress?: (msg: string) => void;
  onDevice?: (d: "webgpu" | "wasm") => void;
  onToken?: (tok: string) => void;
  maxNewTokens?: number;
  temperature?: number;
}

export interface RunChatHandle {
  /** Resolves to the full generated text when generation finishes (or is stopped). */
  done: Promise<string>;
  /** Aborts generation early. */
  stop: () => void;
}

const _pipelineCache = new Map<string, any>();
const _pipelineLoading = new Map<string, Promise<any>>();

function pushFallbackError(message: string) {
  try {
    const { pushError } = useStore.getState();
    pushError({ key: "ai-pipeline", title: "AI pipeline degraded", message });
  } catch {
    /* SSR */
  }
}

function clearFallbackError() {
  try {
    const { dismissError } = useStore.getState();
    dismissError("ai-pipeline");
  } catch {
    /* SSR */
  }
}

export async function getOrCreatePipeline(
  task: string,
  model: string,
  dtype: string,
  onProgress?: (msg: string) => void,
): Promise<any> {
  const { pipeline } = await getTransformers();
  const device = await detectDevice();

  const cacheKey = `${task}:${model}:${device}:${dtype}`;
  const cached = _pipelineCache.get(cacheKey);
  if (cached) return cached;
  const loading = _pipelineLoading.get(cacheKey);
  if (loading) return loading;

  const promise = (async () => {
    try {
      // --- Try WebGPU first ---
      if (device === "webgpu") {
        onProgress?.(`Loading ${model} on WebGPU…`);
        try {
          const p = await pipeline(task, model, {
            device: "webgpu",
            dtype,
            session_options: SESSION_OPTIONS,
            progress_callback: makeProgressCallback(onProgress, model),
          });
          _pipelineCache.set(cacheKey, p);
          clearFallbackError();
          return p;
        } catch (err) {
          console.warn(`[ai] WebGPU pipeline failed, falling back to WASM: ${err}`);
          pushFallbackError(
            `WebGPU unavailable for ${model} — falling back to WASM. Inference will be slower.`,
          );
        }
      } else {
        pushFallbackError(
          `WebGPU not detected for ${model} — using WASM. Inference will be slower.`,
        );
      }

      // --- WASM fallback ---
      const wasmKey = `${task}:${model}:wasm:q8`;
      const wasmCached = _pipelineCache.get(wasmKey);
      if (wasmCached) return wasmCached;

      onProgress?.(`Loading ${model} on WASM (fallback)…`);
      const p = await pipeline(task, model, {
        device: "wasm",
        dtype: "q8",
        session_options: SESSION_OPTIONS,
        progress_callback: makeProgressCallback(onProgress, model),
      });
      _pipelineCache.set(wasmKey, p);
      return p;
    } finally {
      _pipelineLoading.delete(cacheKey);
    }
  })();

  _pipelineLoading.set(cacheKey, promise);
  return promise;
}

function makeProgressCallback(
  onProgress: ((msg: string) => void) | undefined,
  model: string,
) {
  return (cb: any) => {
    if (cb?.status === "progress" && cb?.progress != null) {
      onProgress?.(`Loading ${cb.file ?? model}: ${Math.round(cb.progress)}%`);
    } else if (cb?.status === "ready") {
      onProgress?.("Model ready");
    } else if (cb?.status === "download") {
      onProgress?.(`Downloading ${cb.file ?? model}`);
    } else if (cb?.status === "initiate") {
      onProgress?.(`Fetching ${cb.file ?? model}`);
    }
  };
}

/**
 * Detects degenerate repetition loops in small-model output (e.g. SmolLM2-360M
 * answering "what model are you" with "a model of a model of a model…").
 * Returns true when the tail of `text` contains 4+ non-overlapping occurrences
 * of any 8-80 character substring.
 */
export function detectRepetitionLoop(text: string): boolean {
  if (text.length < 60) return false;
  const tail = text.slice(-600);
  for (let len = 8; len <= 80; len++) {
    if (tail.length < len * 4) continue;
    const unit = tail.slice(-len);
    if (unit.trim().length < 6) continue;
    let count = 0;
    let idx = 0;
    while (idx <= tail.length - len) {
      const found = tail.indexOf(unit, idx);
      if (found < 0) break;
      count++;
      idx = found + len; // non-overlapping
      if (count >= 4) return true;
    }
  }
  return false;
}

export async function runChat(args: RunChatArgs): Promise<RunChatHandle> {
  const device = await detectDevice();
  args.onDevice?.(device);
  const { TextStreamer, InterruptableStoppingCriteria } = await getTransformers();
  const generator = await getOrCreatePipeline(
    "text-generation",
    args.model,
    "q4f16",
    args.onProgress,
  );

  const prompt = generator.tokenizer.apply_chat_template(args.messages, {
    tokenize: false,
    add_generation_prompt: true,
  });

  let aborted = false;
  let acc = "";
  const stopping = InterruptableStoppingCriteria
    ? new InterruptableStoppingCriteria()
    : null;

  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (aborted) return;
      if (text) {
        acc += text;
        args.onToken?.(text);
        // Hard cut-off if the small model starts looping the same phrase.
        // Detects 4+ consecutive repetitions of any 12+ char substring.
        if (detectRepetitionLoop(acc)) {
          aborted = true;
          stopping?.interrupt();
        }
      }
    },
  });

  const done = new Promise<string>((resolve) => {
    const opts: any = {
      max_new_tokens: args.maxNewTokens ?? 256,
      do_sample: true,
      temperature: args.temperature ?? 0.5,
      top_p: 0.9,
      repetition_penalty: 1.2,
      no_repeat_ngram_size: 6,
      streamer,
    };
    if (stopping) opts.stopping_criteria = stopping;
    generator(prompt, opts)
      .then((out: any) => {
        if (!acc) {
          // Some pipelines don't stream; fall back to the final text.
          const text =
            Array.isArray(out)
              ? out.map((o: any) => o.generated_text).join("")
              : out?.[0]?.generated_text ?? out?.generated_text ?? "";
          acc = typeof text === "string" ? text : "";
          if (acc) args.onToken?.(acc);
        }
        resolve(acc);
      })
      .catch((e: any) => {
        args.onProgress?.(`Error: ${e?.message ?? e}`);
        resolve(acc);
      });
  });

  return {
    done,
    stop: () => {
      aborted = true;
      stopping?.interrupt();
    },
  };
}

export async function runVisionCaption(args: {
  blob: Blob;
  onProgress?: (msg: string) => void;
}): Promise<string> {
  await detectDevice();
  const { RawImage } = await getTransformers();
  const captioner = await getOrCreatePipeline(
    "image-to-text",
    "Xenova/vit-gpt2-image-captioning",
    "fp16",
    args.onProgress,
  );
  const url = URL.createObjectURL(args.blob);
  try {
    const img = await RawImage.read(url);
    const out = await captioner(img);
    const text = Array.isArray(out)
      ? out.map((o: any) => o.generated_text).join(" ")
      : out.generated_text;
    return text ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
}
