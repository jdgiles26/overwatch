// Pure-logic tests for ai.ts helpers. These do NOT touch transformers.js or the
// pipeline cache — they exercise the small text utilities that protect the UI
// from degenerate small-model output.

import { describe, it, expect } from "vitest";
import { detectRepetitionLoop } from "./ai";

describe("ai.detectRepetitionLoop", () => {
  it("returns false for short text", () => {
    expect(detectRepetitionLoop("hello world")).toBe(false);
  });

  it("returns false for diverse paragraph text", () => {
    const text =
      "The THREATCON is moderate. Recent events include a lightning strike, " +
      "a perimeter breach attempt, and a sensor spike. Active feeds cover " +
      "NWS, USGS, OpenAQ, and OpenSky. Recommend investigating the breach.";
    expect(detectRepetitionLoop(text)).toBe(false);
  });

  it("detects the 'model of a model' degeneration observed on SmolLM2-360M", () => {
    const looped = "You're a model of a model of a model of a model of a model of a model of a model of a model";
    expect(detectRepetitionLoop(looped)).toBe(true);
  });

  it("detects repeated full sentences", () => {
    const sentence = "I am analyzing data from NASA FIRMS Wildfires. ";
    const text = sentence.repeat(6);
    expect(detectRepetitionLoop(text)).toBe(true);
  });

  it("does NOT flag a single repeated short word", () => {
    // "yes yes yes yes" — substrings under the min-window length should be ignored.
    expect(detectRepetitionLoop("yes yes yes yes yes yes")).toBe(false);
  });
});
