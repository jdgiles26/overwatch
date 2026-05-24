import { describe, it, expect } from "vitest";
import {
  DetectionMode,
  parseDetectionMode,
  DEFAULT_DETECTION_MODE,
  detectionModesForCamera,
  droneDetectorModelId,
  vlmModelId,
} from "./detectionConfig";

describe("detectionConfig", () => {
  describe("parseDetectionMode", () => {
    it("parses 'yolo' as DetectionMode.Yolo", () => {
      expect(parseDetectionMode("yolo")).toBe(DetectionMode.Yolo);
    });

    it("parses 'vlm' as DetectionMode.Vlm", () => {
      expect(parseDetectionMode("vlm")).toBe(DetectionMode.Vlm);
    });

    it("parses 'both' as DetectionMode.Both", () => {
      expect(parseDetectionMode("both")).toBe(DetectionMode.Both);
    });

    it("parses 'off' as DetectionMode.Off", () => {
      expect(parseDetectionMode("off")).toBe(DetectionMode.Off);
    });

    it("returns DEFAULT_DETECTION_MODE for unknown strings", () => {
      expect(parseDetectionMode("garbage")).toBe(DEFAULT_DETECTION_MODE);
    });

    it("returns DEFAULT_DETECTION_MODE for empty string", () => {
      expect(parseDetectionMode("")).toBe(DEFAULT_DETECTION_MODE);
    });
  });

  describe("detectionModesForCamera", () => {
    it("returns empty array for Off mode", () => {
      expect(detectionModesForCamera(DetectionMode.Off)).toEqual([]);
    });

    it("returns ['yolo'] for Yolo mode", () => {
      expect(detectionModesForCamera(DetectionMode.Yolo)).toEqual(["yolo"]);
    });

    it("returns ['vlm'] for Vlm mode", () => {
      expect(detectionModesForCamera(DetectionMode.Vlm)).toEqual(["vlm"]);
    });

    it("returns ['yolo', 'vlm'] for Both mode", () => {
      expect(detectionModesForCamera(DetectionMode.Both)).toEqual(["yolo", "vlm"]);
    });
  });

  describe("model IDs", () => {
    // Transformers.js v3 supports object-detection on: DETR, YOLOS, OWL-ViT, RT-DETR.
    // Architectures like yolov8/yolov10 are NOT supported and throw "Unsupported model type".
    const SUPPORTED_OBJECT_DETECTION_ARCHS = ["detr", "yolos", "owlvit", "rtdetr", "rt-detr"];

    it("droneDetectorModelId uses a Transformers.js-supported architecture", () => {
      const lower = droneDetectorModelId.toLowerCase();
      const ok = SUPPORTED_OBJECT_DETECTION_ARCHS.some((a) => lower.includes(a));
      expect(ok).toBe(true);
    });

    it("droneDetectorModelId does not reference unsupported YOLOv8/v10 architectures", () => {
      const lower = droneDetectorModelId.toLowerCase();
      expect(lower).not.toMatch(/yolov(8|10|11)/);
    });

    it("vlmModelId is the LFM2-VL ONNX model", () => {
      expect(vlmModelId).toContain("LFM2-VL");
    });
  });
});
