"use client";
import { create } from "zustand";
import type {
  AlertFiring,
  AlertRule,
  CameraFeed,
  ConnectorStatus,
  DroneClassification,
  DroneTrack,
  IngestEvent,
  Location,
  PIR,
  ThreatCon,
} from "@overwatch/schemas";

export type FilterState = {
  categories: Set<string>;
  severities: Set<string>;
  query: string;
};

type View = "map3d" | "map2d" | "split";

export type Store = {
  events: IngestEvent[];
  status: ConnectorStatus[];
  locations: Location[];
  cameras: CameraFeed[];
  threatcon: ThreatCon | null;
  pirs: PIR[];
  view: View;
  nightVision: boolean;
  analystOpen: boolean;
  overseerOpen: boolean;
  filter: FilterState;
  wsConnected: boolean;
  selectedEventId: string | null;
  flyTo: { lat: number; lon: number; zoom?: number } | null;
  rules: AlertRule[];
  firings: AlertFiring[];
  // DVR / time machine
  timeWindow: { from: number; to: number } | null; // null = live
  // entity follow
  followEntity: { kind: "icao24" | "id"; value: string } | null;
  // drone tracks
  droneTracks: DroneTrack[];
  droneClassifications: Record<string, DroneClassification>;
  followDroneId: string | null;
  // NLI-derived topic tags keyed by event id
  eventTopics: Record<string, string[]>;

  setView: (v: View) => void;
  setNightVision: (v: boolean) => void;
  setAnalystOpen: (v: boolean) => void;
  setOverseerOpen: (v: boolean) => void;
  setLocations: (l: Location[]) => void;
  setCameras: (c: CameraFeed[]) => void;
  setStatus: (s: ConnectorStatus[]) => void;
  setThreatCon: (t: ThreatCon) => void;
  setPIR: (p: PIR[]) => void;
  addEvent: (e: IngestEvent) => void;
  setEvents: (e: IngestEvent[]) => void;
  setWsConnected: (v: boolean) => void;
  toggleCategory: (c: string) => void;
  toggleSeverity: (s: string) => void;
  setQuery: (q: string) => void;
  clearFilters: () => void;
  selectEvent: (id: string | null) => void;
  requestFlyTo: (x: { lat: number; lon: number; zoom?: number } | null) => void;
  setRules: (r: AlertRule[]) => void;
  pushFiring: (f: AlertFiring) => void;
  setTimeWindow: (w: { from: number; to: number } | null) => void;
  setFollowEntity: (e: { kind: "icao24" | "id"; value: string } | null) => void;
  pushDroneTrack: (t: DroneTrack) => void;
  setDroneClassification: (id: string, c: DroneClassification) => void;
  setFollowDrone: (id: string | null) => void;
  setEventTopics: (id: string, topics: string[]) => void;
};

export const useStore = create<Store>((set, get) => ({
  events: [],
  status: [],
  locations: [],
  cameras: [],
  threatcon: null,
  pirs: [],
  view: "map3d",
  nightVision: false,
  analystOpen: false,
  overseerOpen: false,
  filter: { categories: new Set(), severities: new Set(), query: "" },
  wsConnected: false,
  selectedEventId: null,
  flyTo: null,
  rules: [],
  firings: [],
  timeWindow: null,
  followEntity: null,
  droneTracks: [],
  droneClassifications: {},
  followDroneId: null,
  eventTopics: {},

  setView: (v) => set({ view: v }),
  setNightVision: (v) => set({ nightVision: v }),
  setAnalystOpen: (v) => set({ analystOpen: v }),
  setOverseerOpen: (v) => set({ overseerOpen: v }),
  setLocations: (locations) => set({ locations }),
  setCameras: (cameras) => set({ cameras }),
  setStatus: (status) => set({ status }),
  setThreatCon: (t) => set({ threatcon: t }),
  setPIR: (p) => set({ pirs: p }),
  setEvents: (events) => set({ events }),
  addEvent: (e) => {
    const arr = get().events;
    const existing = arr.findIndex((x) => x.id === e.id);
    if (existing >= 0) {
      const next = [...arr];
      next[existing] = e;
      set({ events: next.slice(0, 2000) });
    } else {
      set({ events: [e, ...arr].slice(0, 2000) });
    }
  },
  setWsConnected: (v) => set({ wsConnected: v }),
  toggleCategory: (c) => {
    const next = new Set(get().filter.categories);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    set({ filter: { ...get().filter, categories: next } });
  },
  toggleSeverity: (s) => {
    const next = new Set(get().filter.severities);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    set({ filter: { ...get().filter, severities: next } });
  },
  setQuery: (q) => set({ filter: { ...get().filter, query: q } }),
  clearFilters: () =>
    set({ filter: { categories: new Set(), severities: new Set(), query: "" } }),
  selectEvent: (id) => set({ selectedEventId: id }),
  requestFlyTo: (x) => set({ flyTo: x }),
  setRules: (rules) => set({ rules }),
  pushFiring: (f) => set({ firings: [f, ...get().firings].slice(0, 200) }),
  setTimeWindow: (w) => set({ timeWindow: w }),
  setFollowEntity: (e) => set({ followEntity: e }),
  pushDroneTrack: (t) => {
    const existing = get().droneTracks;
    const idx = existing.findIndex((x) => x.id === t.id);
    let next: DroneTrack[];
    if (idx >= 0) {
      next = [...existing];
      next[idx] = t;
    } else {
      next = [t, ...existing];
    }
    // remove expired tracks and cap at 100
    next = next.filter((x) => x.state !== "expired").slice(0, 100);
    const followDroneId = get().followDroneId;
    set({
      droneTracks: next,
      followDroneId: followDroneId && !next.find((x) => x.id === followDroneId) ? null : followDroneId,
    });
  },
  setDroneClassification: (id, c) =>
    set({ droneClassifications: { ...get().droneClassifications, [id]: c } }),
  setFollowDrone: (id) => set({ followDroneId: id }),
  setEventTopics: (id, topics) =>
    set({ eventTopics: { ...get().eventTopics, [id]: topics } }),
}));

export function applyFilter(
  events: IngestEvent[],
  f: FilterState,
  timeWindow?: { from: number; to: number } | null,
): IngestEvent[] {
  const q = f.query.trim().toLowerCase();
  return events.filter((e) => {
    if (timeWindow) {
      const t = new Date(e.occurredAt).getTime();
      if (!Number.isFinite(t)) return false;
      if (t < timeWindow.from || t > timeWindow.to) return false;
    }
    if (f.categories.size && !f.categories.has(e.category)) return false;
    if (f.severities.size && !f.severities.has(e.severity)) return false;
    if (q) {
      const hay = `${e.title} ${e.summary ?? ""} ${e.geoMentioned ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
