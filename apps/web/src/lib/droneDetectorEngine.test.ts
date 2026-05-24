import { describe, it, expect } from "vitest";
import {
  parseDetections,
  parseYoloDetections,
  type DetectorRawOutput,
  type ParsedDetection,
  buildDroneCvEvent,
  DRONE_COCO_CLASSES,
  isDroneLikeLabel,
} from "./droneDetectorEngine";

describe("droneDetectorEngine", () => {
  describe("isDroneLikeLabel", () => {
    it("returns true for 'airplane'", () => {
      expect(isDroneLikeLabel("airplane")).toBe(true);
    });

    it("returns true for 'bird'", () => {
      expect(isDroneLikeLabel("bird")).toBe(true);
    });

    it("returns false for 'car'", () => {
      expect(isDroneLikeLabel("car")).toBe(false);
    });

    it("returns false for 'person'", () => {
      expect(isDroneLikeLabel("person")).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(isDroneLikeLabel("Airplane")).toBe(true);
      expect(isDroneLikeLabel("BIRD")).toBe(true);
    });
  });

  describe("DRONE_COCO_CLASSES", () => {
    it("includes airplane, bird, and kite", () => {
      expect(DRONE_COCO_CLASSES).toContain("airplane");
      expect(DRONE_COCO_CLASSES).toContain("bird");
      expect(DRONE_COCO_CLASSES).toContain("kite");
    });
  });

  describe("parseDetections", () => {
    it("returns empty array for empty raw output", () => {
      expect(parseDetections([])).toEqual([]);
    });

    it("parses a single detection with valid fields", () => {
      const raw: DetectorRawOutput[] = [
        {
          label: "airplane",
          score: 0.92,
          box: { xmin: 10, ymin: 20, xmax: 100, ymax: 80 },
        },
      ];
      const result = parseDetections(raw);
      expect(result).toHaveLength(1);
      expect(result[0]!.label).toBe("airplane");
      expect(result[0]!.score).toBeCloseTo(0.92);
      expect(result[0]!.box.xmin).toBe(10);
      expect(result[0]!.isDroneLike).toBe(true);
    });

    it("marks drone-like labels correctly", () => {
      const raw: DetectorRawOutput[] = [
        { label: "airplane", score: 0.9, box: { xmin: 0, ymin: 0, xmax: 50, ymax: 50 } },
        { label: "car", score: 0.8, box: { xmin: 60, ymin: 60, xmax: 100, ymax: 100 } },
      ];
      const result = parseDetections(raw);
      expect(result[0]!.isDroneLike).toBe(true);
      expect(result[1]!.isDroneLike).toBe(false);
    });

    it("filters out detections below threshold", () => {
      const raw: DetectorRawOutput[] = [
        { label: "airplane", score: 0.15, box: { xmin: 0, ymin: 0, xmax: 50, ymax: 50 } },
        { label: "airplane", score: 0.85, box: { xmin: 10, ymin: 10, xmax: 60, ymax: 60 } },
      ];
      const result = parseDetections(raw, 0.5);
      expect(result).toHaveLength(1);
      expect(result[0]!.score).toBeCloseTo(0.85);
    });

    it("parseYoloDetections is an alias of parseDetections", () => {
      expect(parseYoloDetections).toBe(parseDetections);
    });
  });

  describe("buildDroneCvEvent", () => {
    it("builds an event with drone detections", () => {
      const detections: ParsedDetection[] = [
        {
          label: "airplane",
          score: 0.92,
          box: { xmin: 10, ymin: 20, xmax: 100, ymax: 80 },
          isDroneLike: true,
        },
      ];
      const event = buildDroneCvEvent("cam-1", detections, { lat: 34.0, lon: -118.0 });
      expect(event.cameraId).toBe("cam-1");
      expect(event.title).toContain("airplane");
      expect(event.severity).toBe("high");
      expect(event.geo).toEqual({ lat: 34.0, lon: -118.0 });
      expect(event.detections).toHaveLength(1);
    });

    it("sets severity to moderate for non-drone-like detections only", () => {
      const detections: ParsedDetection[] = [
        {
          label: "car",
          score: 0.8,
          box: { xmin: 10, ymin: 20, xmax: 100, ymax: 80 },
          isDroneLike: false,
        },
      ];
      const event = buildDroneCvEvent("cam-1", detections, { lat: 34.0, lon: -118.0 });
      expect(event.severity).toBe("moderate");
    });

    it("sets severity to info when no detections", () => {
      const event = buildDroneCvEvent("cam-1", [], undefined);
      expect(event.severity).toBe("info");
      expect(event.title).toContain("No drone detections");
    });
  });
});
