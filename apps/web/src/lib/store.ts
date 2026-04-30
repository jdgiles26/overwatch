"use client";
import { create } from "zustand";
import type {
  CameraFeed,
  ConnectorStatus,
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
}));

export function applyFilter(events: IngestEvent[], f: FilterState): IngestEvent[] {
  const q = f.query.trim().toLowerCase();
  return events.filter((e) => {
    if (f.categories.size && !f.categories.has(e.category)) return false;
    if (f.severities.size && !f.severities.has(e.severity)) return false;
    if (q) {
      const hay = `${e.title} ${e.summary ?? ""} ${e.geoMentioned ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
