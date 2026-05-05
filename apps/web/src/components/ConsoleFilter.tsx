"use client";
import { useEffect } from "react";

const NOISY = [
  /VerifyEachNodeIsAssignedToAnEp/i,
  /some nodes were not assigned to the preferred execution providers/i,
  /Rerunning with verbose output/i,
  /CleanUnusedInitializersAndNodeArgs/i,
  /\bW:onnxruntime/i,
  /\bI:onnxruntime/i,
  /ort-wasm/i,
  /CoreMLExecutionProvider/i,
];

let installed = false;

/**
 * Installs a console.error filter that demotes noisy ONNX Runtime warnings
 * to console.debug so Next.js's dev overlay does not turn them into red toasts.
 * Real errors from any other source pass through unchanged.
 */
export function ConsoleFilter() {
  useEffect(() => {
    if (installed) return;
    installed = true;
    const orig = console.error.bind(console);
    console.error = (...args: any[]) => {
      try {
        const text = args
          .map((a) => (typeof a === "string" ? a : a?.message ?? ""))
          .join(" ");
        if (text && NOISY.some((re) => re.test(text))) {
          console.debug("[ort]", ...args);
          return;
        }
      } catch {
        /* ignore */
      }
      orig(...args);
    };
  }, []);
  return null;
}
