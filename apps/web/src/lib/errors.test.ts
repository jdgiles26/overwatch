import { describe, it, expect } from "vitest";
import {
  upsertError,
  removeErrorByKey,
  type AppError,
} from "./errors";

describe("upsertError", () => {
  it("appends a new error when its key is not present", () => {
    const list: AppError[] = [];
    const next = upsertError(list, {
      key: "vlm",
      title: "VLM",
      message: "WebGPU unavailable",
    });
    expect(next).toHaveLength(1);
    expect(next[0]!.key).toBe("vlm");
  });

  it("replaces the existing error with the same key (no duplicates)", () => {
    const list: AppError[] = [
      { key: "vlm", title: "VLM", message: "old" },
      { key: "det", title: "Detector", message: "x" },
    ];
    const next = upsertError(list, {
      key: "vlm",
      title: "VLM v2",
      message: "new",
    });
    expect(next).toHaveLength(2);
    const vlm = next.find((e) => e.key === "vlm")!;
    expect(vlm.title).toBe("VLM v2");
    expect(vlm.message).toBe("new");
  });

  it("returns the same array reference when the upsert is a no-op (perf)", () => {
    const list: AppError[] = [
      { key: "vlm", title: "VLM", message: "same" },
    ];
    const next = upsertError(list, {
      key: "vlm",
      title: "VLM",
      message: "same",
    });
    expect(next).toBe(list);
  });
});

describe("removeErrorByKey", () => {
  it("removes the error with the given key", () => {
    const list: AppError[] = [
      { key: "vlm", title: "VLM", message: "x" },
      { key: "det", title: "Detector", message: "y" },
    ];
    const next = removeErrorByKey(list, "vlm");
    expect(next.map((e) => e.key)).toEqual(["det"]);
  });

  it("returns the same array reference when key is not present", () => {
    const list: AppError[] = [
      { key: "vlm", title: "VLM", message: "x" },
    ];
    expect(removeErrorByKey(list, "missing")).toBe(list);
  });
});
