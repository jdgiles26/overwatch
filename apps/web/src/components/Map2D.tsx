"use client";
import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useStore } from "@/lib/store";

export function Map2D() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const events = useStore((s) => s.events);
  const locations = useStore((s) => s.locations);
  const flyTo = useStore((s) => s.flyTo);
  const setFlyTo = useStore((s) => s.requestFlyTo);

  const features = useMemo(() => {
    const fs = events
      .filter((e) => e.geo)
      .slice(0, 1500)
      .map((e) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [e.geo!.lon, e.geo!.lat] },
        properties: {
          id: e.id,
          title: e.title,
          severity: e.severity,
          category: e.category,
        },
      }));
    return { type: "FeatureCollection" as const, features: fs };
  }, [events]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap",
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#05070a" } },
          {
            id: "osm",
            type: "raster",
            source: "osm",
            paint: { "raster-opacity": 0.5, "raster-saturation": -0.4 },
          },
        ],
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      },
      center: [-30, 25],
      zoom: 1.4,
      attributionControl: { compact: true },
      pitch: 30,
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("events", { type: "geojson", data: features as any });
      map.addLayer({
        id: "events-circle",
        type: "circle",
        source: "events",
        paint: {
          "circle-radius": [
            "match",
            ["get", "severity"],
            "extreme",
            8,
            "high",
            6,
            "moderate",
            5,
            "low",
            4,
            3,
          ],
          "circle-color": [
            "match",
            ["get", "severity"],
            "extreme",
            "#ff3860",
            "high",
            "#ff6a3d",
            "moderate",
            "#ffb020",
            "low",
            "#5cf0c9",
            "#38e0b2",
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-opacity": 0.5,
        },
      });
      map.addSource("locations", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "loc-circle",
        type: "circle",
        source: "locations",
        paint: {
          "circle-radius": 14,
          "circle-color": "#38e0b2",
          "circle-opacity": 0.18,
          "circle-stroke-color": "#38e0b2",
          "circle-stroke-width": 1.5,
        },
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once("load", () => {
        const src = map.getSource("events") as maplibregl.GeoJSONSource | undefined;
        src?.setData(features as any);
      });
      return;
    }
    const src = map.getSource("events") as maplibregl.GeoJSONSource | undefined;
    src?.setData(features as any);
  }, [features]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: locations.map((l) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [l.geo.lon, l.geo.lat] },
        properties: { id: l.id, label: l.label },
      })),
    };
    if (!map.isStyleLoaded()) {
      map.once("load", () => {
        const src = map.getSource("locations") as maplibregl.GeoJSONSource | undefined;
        src?.setData(data);
      });
      return;
    }
    const src = map.getSource("locations") as maplibregl.GeoJSONSource | undefined;
    src?.setData(data);
  }, [locations]);

  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [flyTo.lon, flyTo.lat],
      zoom: flyTo.zoom ?? 6,
      essential: true,
    });
    setFlyTo(null);
  }, [flyTo, setFlyTo]);

  return <div ref={containerRef} className="absolute inset-0" data-agent="map-2d" />;
}
