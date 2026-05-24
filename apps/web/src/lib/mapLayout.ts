/**
 * Layout helpers for MapView. Centralizing the className strings makes them
 * unit-testable and stops the split-view from regressing to a 0-height row
 * (the previous root cause of "2D never renders").
 *
 * Why these classes matter:
 * - The split grid MUST declare `grid-rows-1` (or an explicit fr template)
 *   so its single row resolves against the parent's height. Without it,
 *   `grid-template-rows: auto` makes the row collapse to content size; when
 *   the only child of a cell is `position:absolute`, content size is 0 and
 *   the cell renders 0 px tall. Cesium hides this by force-sizing its own
 *   container; MapLibre does not — its canvas measures the parent and
 *   renders to 0×0, perceived as "blank".
 * - Each map's slot wrapper must be `relative h-full w-full overflow-hidden`
 *   so the inner `<div absolute inset-0>` of Map2D/Map3D fills it.
 */

export const SPLIT_GRID_CLASS =
  "grid h-full min-h-0 w-full grid-cols-2 grid-rows-1 gap-1";

export const MAP_SLOT_CLASS =
  "relative h-full min-h-0 w-full overflow-hidden rounded-md";

export const SINGLE_MAP_WRAPPER_CLASS =
  "relative h-full min-h-0 w-full overflow-hidden";
