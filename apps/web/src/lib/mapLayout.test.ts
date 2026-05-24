import { describe, it, expect } from "vitest";
import {
  SPLIT_GRID_CLASS,
  MAP_SLOT_CLASS,
  SINGLE_MAP_WRAPPER_CLASS,
} from "./mapLayout";

describe("MapView layout classes", () => {
  it("split grid declares a single explicit row track", () => {
    // Without `grid-rows-1` (or an explicit `grid-template-rows`), the
    // grid row defaults to `auto`, which sizes to content. Children
    // using only `position:absolute` then collapse the row to 0px.
    // This assertion is the regression gate for the split-view blank bug.
    expect(SPLIT_GRID_CLASS).toMatch(/\bgrid-rows-1\b/);
    expect(SPLIT_GRID_CLASS).toMatch(/\bh-full\b/);
    expect(SPLIT_GRID_CLASS).toMatch(/\bmin-h-0\b/);
    expect(SPLIT_GRID_CLASS).toMatch(/\bgrid-cols-2\b/);
  });

  it("each slot is a relative-positioned full-size box (so absolute children fill it)", () => {
    expect(MAP_SLOT_CLASS).toMatch(/\brelative\b/);
    expect(MAP_SLOT_CLASS).toMatch(/\bh-full\b/);
    expect(MAP_SLOT_CLASS).toMatch(/\bmin-h-0\b/);
    expect(MAP_SLOT_CLASS).toMatch(/\boverflow-hidden\b/);
  });

  it("single-map wrapper is similarly safe (relative + h-full + min-h-0)", () => {
    expect(SINGLE_MAP_WRAPPER_CLASS).toMatch(/\brelative\b/);
    expect(SINGLE_MAP_WRAPPER_CLASS).toMatch(/\bh-full\b/);
    expect(SINGLE_MAP_WRAPPER_CLASS).toMatch(/\bmin-h-0\b/);
  });
});
