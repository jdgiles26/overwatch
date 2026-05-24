import type { IngestEvent, PIR } from "@overwatch/schemas";

export type PirEvidence = {
  events: IngestEvent[];
  firstGeoEvent: IngestEvent | null;
};

/**
 * Resolve a PIR's `evidenceIds` to the matching IngestEvents in the store.
 * Used by AssessmentPanel to render expandable PIR rows and to wire a
 * "Show on Map" CTA that flies the globe to the first geo-located piece of
 * evidence.
 */
export function buildPirEvidence(pir: PIR, events: IngestEvent[]): PirEvidence {
  const ids = new Set(pir.evidenceIds ?? []);
  const matched = events.filter((e) => ids.has(e.id));
  const firstGeoEvent = matched.find((e) => e.geo) ?? null;
  return { events: matched, firstGeoEvent };
}

export type ShowOnMapTarget = {
  lat: number;
  lon: number;
  zoom: number;
} | null;

/**
 * Pure helper used by the AssessmentPanel "Show on Map" button. Returns the
 * coordinates the map should fly to, or null if there's nothing locatable.
 */
export function pirShowOnMapTarget(
  pir: PIR,
  events: IngestEvent[],
  zoom = 7,
): ShowOnMapTarget {
  const { firstGeoEvent } = buildPirEvidence(pir, events);
  if (!firstGeoEvent?.geo) return null;
  return { lat: firstGeoEvent.geo.lat, lon: firstGeoEvent.geo.lon, zoom };
}
