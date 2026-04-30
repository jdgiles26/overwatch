"use client";

type Message = { role: "system" | "user" | "assistant"; content: string };

let _transformers: any | null = null;

async function getTransformers() {
  if (_transformers) return _transformers;
  // Dynamic import keeps it out of the SSR/build path.
  const mod = await import("@huggingface/transformers");
  mod.env.allowLocalModels = false;
  mod.env.useBrowserCache = true;
  // Multi-threaded WASM if SAB is available; otherwise single-thread fallback.
  if (typeof SharedArrayBuffer === "undefined") {
    if (mod.env.backends?.onnx?.wasm) mod.env.backends.onnx.wasm.numThreads = 1;
  }
  _transformers = mod;
  return mod;
}

export async function detectDevice(): Promise<"webgpu" | "wasm"> {
  if (typeof navigator !== "undefined" && (navigator as any).gpu) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter) return "webgpu";
    } catch {
      /* ignore */
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
}

const _pipelineCache = new Map<string, any>();

export async function runChat(args: RunChatArgs): Promise<{ stop: () => void }> {
  const { pipeline, TextStreamer } = await getTransformers();
  const device = await detectDevice();
  args.onDevice?.(device);
  const cacheKey = `chat:${args.model}:${device}`;
  let generator = _pipelineCache.get(cacheKey);
  if (!generator) {
    args.onProgress?.(`Loading ${args.model} on ${device}…`);
    generator = await pipeline("text-generation", args.model, {
      device,
      dtype: device === "webgpu" ? "q4f16" : "q4",
      progress_callback: (p: any) => {
        if (p?.status === "progress" && p?.progress != null) {
          args.onProgress?.(
            `Loading ${p.file ?? args.model}: ${Math.round(p.progress)}%`,
          );
        } else if (p?.status === "ready") {
          args.onProgress?.("Model ready");
        }
      },
    });
    _pipelineCache.set(cacheKey, generator);
  }

  const prompt = generator.tokenizer.apply_chat_template(args.messages, {
    tokenize: false,
    add_generation_prompt: true,
  });

  let aborted = false;
  const stopper = { stop: () => (aborted = true) };

  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (aborted) return;
      if (text) args.onToken?.(text);
    },
  });

  generator(prompt, {
    max_new_tokens: args.maxNewTokens ?? 256,
    do_sample: true,
    temperature: 0.5,
    top_p: 0.9,
    repetition_penalty: 1.05,
    streamer,
  }).catch((e: any) => args.onProgress?.(`Error: ${e?.message ?? e}`));

  return stopper;
}

export async function runVisionCaption(args: {
  blob: Blob;
  onProgress?: (msg: string) => void;
}): Promise<string> {
  const { pipeline, RawImage } = await getTransformers();
  const device = await detectDevice();
  const cacheKey = `caption:${device}`;
  let captioner = _pipelineCache.get(cacheKey);
  if (!captioner) {
    args.onProgress?.("Loading vision model…");
    captioner = await pipeline("image-to-text", "Xenova/vit-gpt2-image-captioning", {
      device,
      progress_callback: (p: any) => {
        if (p?.status === "progress" && p?.progress != null) {
          args.onProgress?.(`Loading: ${Math.round(p.progress)}%`);
        }
      },
    });
    _pipelineCache.set(cacheKey, captioner);
  }
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
