"use client";

import "leaflet-defaulticon-compatibility";

import type { ComponentType, ReactNode } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

export type MapBar = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
};

const PARIS_BOUNDS: [[number, number], [number, number]] = [
  [48.815, 2.224],
  [48.902, 2.469],
];

type BarsMapProps = {
  bars: MapBar[];
};

const MapContainerUnsafe = MapContainer as unknown as ComponentType<{
  bounds: [[number, number], [number, number]];
  className: string;
  children: ReactNode;
}>;

const TileLayerUnsafe = TileLayer as unknown as ComponentType<{
  attribution?: string;
  url: string;
}>;

const MarkerUnsafe = Marker as unknown as ComponentType<{
  position: [number, number];
  children: ReactNode;
}>;

const PopupUnsafe = Popup as unknown as ComponentType<{ children: ReactNode }>;

export default function BarsMap({ bars }: BarsMapProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <MapContainerUnsafe
        bounds={PARIS_BOUNDS}
        className="h-[520px] w-full"
      >
        <TileLayerUnsafe
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {bars.map((bar) => (
          <MarkerUnsafe key={bar.id} position={[bar.lat, bar.lng]}>
            <PopupUnsafe>
              <div className="space-y-1">
                <p className="font-semibold">{bar.name}</p>
                <p className="text-xs text-slate-600">
                  {bar.address ?? "Adresse non renseignee"}
                </p>
                <a
                  href={`/bar/${bar.id}`}
                  className="inline-block rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-800"
                >
                  Voir la fiche
                </a>
              </div>
            </PopupUnsafe>
          </MarkerUnsafe>
        ))}
      </MapContainerUnsafe>
    </section>
  );
}
