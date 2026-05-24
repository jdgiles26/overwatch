// Pure-logic tests for the Overseer agent's input parser. These cover the
// degraded-output cases observed from small models (SmolLM2-360M) that often
// emit chatter around or inside the JSON envelope.

import { describe, it, expect } from "vitest";
import { parseAction, extractThought } from "./agent";

describe("agent.parseAction", () => {
  it("returns null for empty input", () => {
    expect(parseAction("")).toBeNull();
  });

  it("returns null when no JSON is present", () => {
    expect(parseAction("I will switch to 3D and fly to the top event.")).toBeNull();
  });

  it("parses a clean single-line JSON action", () => {
    const out = parseAction('{"action":"setView","value":"map3d"}');
    expect(out).toEqual({ action: "setView", value: "map3d" });
  });

  it("parses JSON wrapped in a markdown code fence", () => {
    const out = parseAction('```json\n{"action":"flyToTopEvent"}\n```');
    expect(out).toEqual({ action: "flyToTopEvent" });
  });

  it("parses JSON after a thought prefix", () => {
    const out = parseAction(
      'I should switch the view first.\n{"action":"setView","value":"map3d"}',
    );
    expect(out?.action).toBe("setView");
  });

  it("picks the first action object when multiple are present", () => {
    const out = parseAction(
      '{"action":"setView","value":"map3d"} then {"action":"flyToTopEvent"}',
    );
    expect(out?.action).toBe("setView");
  });

  it("ignores curly braces that are not actions", () => {
    const out = parseAction(
      'config { foo: 1 }\n{"action":"clearFilters"}',
    );
    expect(out?.action).toBe("clearFilters");
  });

  it("recovers from trailing commas (minor JSON cleanup)", () => {
    const out = parseAction('{"action":"setView","value":"map3d",}');
    expect(out?.action).toBe("setView");
  });

  it("recovers from single-quoted keys (minor JSON cleanup)", () => {
    const out = parseAction(`{'action':'setView','value':'map2d'}`);
    expect(out?.action).toBe("setView");
  });

  it("parses nested action object with lat/lon", () => {
    const out = parseAction(
      '{"action":"flyTo","lat":34.05,"lon":-118.24,"zoom":7}',
    );
    expect(out).toMatchObject({
      action: "flyTo",
      lat: 34.05,
      lon: -118.24,
      zoom: 7,
    });
  });
});

describe("agent.extractThought", () => {
  it("returns '(no commentary)' for empty string", () => {
    expect(extractThought("")).toBe("(no commentary)");
  });

  it("returns '(no commentary)' for JSON-only output", () => {
    expect(extractThought('{"action":"setView","value":"map3d"}')).toBe(
      "(no commentary)",
    );
  });

  it("captures any thought text preceding the first JSON object", () => {
    const t = extractThought(
      'I will switch to 3D first.\n{"action":"setView","value":"map3d"}',
    );
    expect(t).toContain("I will switch to 3D first.");
  });

  it("truncates very long thoughts to 320 chars", () => {
    const longThought = "x".repeat(500);
    const t = extractThought(`${longThought} {"action":"say"}`);
    expect(t.length).toBeLessThanOrEqual(320);
  });
});
