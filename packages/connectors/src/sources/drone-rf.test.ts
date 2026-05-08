import { describe, it, expect } from "vitest";
import { parseFrame, deriveRangeError } from "./drone-rf.js";

describe("parseFrame", () => {
  it("accepts a valid frame and maps to IngestEvent fields", () => {
    const frame = { ts: new Date().toISOString(), nodeId: "node-1", doppler: [0.1, 0.3, 0.7], rssi: -55, rangeM: 120 };
    const result = parseFrame(frame, { lat: 38.9, lon: -77.0, alt: 10 }, "node-1", -80);
    expect(result).not.toBeNull();
    expect(result!.category).toBe("drone");
    expect(result!.geo?.lat).toBe(38.9);
    expect(result!.geo?.lon).toBe(-77.0);
  });

  it("returns null for a frame missing nodeId", () => {
    const frame = { ts: new Date().toISOString(), doppler: [0.1], rssi: -55, rangeM: 120 } as any;
    const result = parseFrame(frame, { lat: 38.9, lon: -77.0 }, "node-1", -80);
    expect(result).toBeNull();
  });

  it("derives severity from RSSI — below threshold is low, above is moderate", () => {
    const geo = { lat: 0, lon: 0 };
    const weak = parseFrame({ ts: new Date().toISOString(), nodeId: "n", doppler: [], rssi: -90, rangeM: 50 }, geo, "n", -80);
    const strong = parseFrame({ ts: new Date().toISOString(), nodeId: "n", doppler: [], rssi: -60, rangeM: 50 }, geo, "n", -80);
    expect(weak!.severity).toBe("low");
    expect(strong!.severity).toBe("moderate");
  });
});

describe("deriveRangeError", () => {
  it("defaults to 20% of rangeM when not supplied", () => {
    expect(deriveRangeError(undefined, 100)).toBe(20);
  });

  it("passes through an explicit rangeErrorM", () => {
    expect(deriveRangeError(15, 100)).toBe(15);
  });
});
