import { describe, it, expect } from "vitest";
import {
  createToast,
  removeToastById,
  pruneExpiredToasts,
  type Toast,
} from "./toasts";

describe("toasts", () => {
  describe("createToast", () => {
    it("generates an id, defaults severity to info, defaults ttl to 5000ms", () => {
      const now = 1_000_000;
      const t = createToast({ message: "hello" }, now);
      expect(t.id).toMatch(/^toast-/);
      expect(t.message).toBe("hello");
      expect(t.severity).toBe("info");
      expect(t.expiresAt).toBe(now + 5000);
    });

    it("respects supplied severity and ttl", () => {
      const now = 100;
      const t = createToast(
        { message: "wgpu down", severity: "warning", ttlMs: 8000 },
        now,
      );
      expect(t.severity).toBe("warning");
      expect(t.expiresAt).toBe(now + 8000);
    });

    it("rejects an empty message", () => {
      expect(() => createToast({ message: "" }, 0)).toThrow(/message/i);
    });
  });

  describe("removeToastById", () => {
    it("removes the toast with the given id", () => {
      const t1 = createToast({ message: "a" }, 0);
      const t2 = createToast({ message: "b" }, 0);
      const result = removeToastById([t1, t2], t1.id);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(t2.id);
    });

    it("returns the same list when id not found", () => {
      const t1 = createToast({ message: "a" }, 0);
      const result = removeToastById([t1], "missing");
      expect(result).toEqual([t1]);
    });
  });

  describe("pruneExpiredToasts", () => {
    it("removes toasts whose expiresAt is at or before now", () => {
      const list: Toast[] = [
        { id: "a", message: "x", severity: "info", expiresAt: 100 },
        { id: "b", message: "y", severity: "info", expiresAt: 200 },
        { id: "c", message: "z", severity: "info", expiresAt: 50 },
      ];
      const result = pruneExpiredToasts(list, 150);
      expect(result.map((t) => t.id)).toEqual(["b"]);
    });

    it("returns the same array reference when nothing expired (perf)", () => {
      const list: Toast[] = [
        { id: "a", message: "x", severity: "info", expiresAt: 500 },
      ];
      expect(pruneExpiredToasts(list, 100)).toBe(list);
    });
  });
});
