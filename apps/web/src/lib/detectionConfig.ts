export enum DetectionMode {
  Off = "off",
  Yolo = "yolo",
  Vlm = "vlm",
  Both = "both",
}

export const DEFAULT_DETECTION_MODE = DetectionMode.Both;

// Transformers.js supports a fixed set of object-detection architectures
// (DETR, YOLOS, OWL-ViT, RT-DETR). YOLOv10 / YOLOv8 are NOT supported and will
// fail with "Unsupported model type: yolov10". DETR-ResNet-50 is COCO-trained
// (91 classes — airplane, bird, etc.) and is well-tested in the browser runtime.
export const droneDetectorModelId = "Xenova/detr-resnet-50";
export const vlmModelId = "onnx-community/LFM2-VL-450M-ONNX";

export function parseDetectionMode(raw: string): DetectionMode {
  const normalized = raw.trim().toLowerCase();
  if (normalized === DetectionMode.Yolo) return DetectionMode.Yolo;
  if (normalized === DetectionMode.Vlm) return DetectionMode.Vlm;
  if (normalized === DetectionMode.Both) return DetectionMode.Both;
  if (normalized === DetectionMode.Off) return DetectionMode.Off;
  return DEFAULT_DETECTION_MODE;
}

export function detectionModesForCamera(mode: DetectionMode | "off" | "yolo" | "vlm" | "both"): Array<"yolo" | "vlm"> {
  const m = typeof mode === "string" ? parseDetectionMode(mode) : mode;
  if (m === DetectionMode.Off) return [];
  if (m === DetectionMode.Yolo) return ["yolo"];
  if (m === DetectionMode.Vlm) return ["vlm"];
  if (m === DetectionMode.Both) return ["yolo", "vlm"];
  return [];
}
