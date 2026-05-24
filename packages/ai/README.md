# @overwatch/ai

**Status:** placeholder — reserved for on-device LLM and VLM wrappers.

## Planned scope

Browser-side AI primitives backed by `@huggingface/transformers`
(WebGPU with WASM fallback). Used by the Analyst chat panel and the
Overseer agent. Models pulled from the Hugging Face CDN on first run
and cached in the browser.

| Capability | Current model(s) |
|---|---|
| Analyst chat (LLM) | SmolLM2 / Qwen2.5 / Llama 3.2 |
| Vision-language (VLM) for camera detectors | LFM2.5-VL-450M-ONNX |
| Image-to-text caption for Overseer | from `transformers` `image-to-text` pipeline |

## Where the code currently lives

| Concern | Current location |
|---|---|
| LLM wrapper, model selection, WebGPU/WASM fallback | `apps/web/src/lib/ai.ts` |
| VLM invocation per camera frame | `apps/web/src/components/visionWorker.ts` |
| Caption pipeline for Overseer | inline inside `apps/web/src/lib/agent.ts` |

## Extraction plan

1. Move `ai.ts` to `packages/ai/src/llm.ts`; export from `src/index.ts`.
2. Hoist the VLM caption pipeline used in `visionWorker.ts` into
   `packages/ai/src/vlm.ts` (worker-safe — no DOM access).
3. Extract the Overseer caption pipeline to `packages/ai/src/caption.ts`.
4. Add a `package.json` peerDependency on `@huggingface/transformers`
   so consumers control the version.

## Blockers

- Browser-only (WebGPU). Tests will need a jsdom + transformers mock
  or live-browser harness; defer that decision until extraction.
- Worker-context constraints: any code referencing `self`/`postMessage`
  must stay Worker-safe.

## Dependencies (planned)

- `@huggingface/transformers` (peer)
