"use client";

import { useEffect, useRef } from "react";

/** Single-location map for a machine page — Google Maps embed, no API key
 *  needed for the q=…&output=embed form. Prefers coordinates when geocoded. */
export function MachineMap({ address, lat, lng }: { address: string | null; lat: number | null; lng: number | null }) {
  const q = lat != null && lng != null ? `${lat},${lng}` : address;
  if (!q) return null;
  return (
    <iframe
      title="Machine location"
      src={`https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed`}
      className="h-64 w-full rounded-xl border border-line"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

export type FleetMarker = { name: string; location: string | null; lat: number; lng: number; online: boolean };

type LeafletModule = typeof import("leaflet");
declare global {
  interface Window {
    L?: LeafletModule;
  }
}

/** All-machines map — Leaflet + OpenStreetMap tiles from CDN (no API key,
 *  multi-marker, which the keyless Google embed can't do). */
export function FleetMap({ markers }: { markers: FleetMarker[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<ReturnType<LeafletModule["map"]> | null>(null);

  useEffect(() => {
    if (!ref.current || !markers.length || mapRef.current) return;

    const init = () => {
      const L = window.L;
      if (!L || !ref.current || mapRef.current) return;
      const map = L.map(ref.current);
      mapRef.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
      for (const m of markers) {
        L.circleMarker([m.lat, m.lng], {
          radius: 8,
          color: m.online ? "#6fa98c" : "#927c6c",
          fillColor: m.online ? "#6fa98c" : "#927c6c",
          fillOpacity: 0.85,
        })
          .addTo(map)
          .bindPopup(`<b>${m.name}</b><br/>${m.location ?? ""}<br/>${m.online ? "Online" : "Offline"}`);
      }
      map.fitBounds(bounds.pad(0.3));
    };

    if (window.L) {
      init();
      return;
    }
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = init;
    document.head.appendChild(script);

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [markers]);

  if (!markers.length) return null;
  return <div ref={ref} className="h-80 w-full rounded-2xl border border-line" />;
}
