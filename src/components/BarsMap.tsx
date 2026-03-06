"use client";

import "leaflet-defaulticon-compatibility";

import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";

import { type RawBarNoteStatRow } from "@/src/lib/barNoteStats";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

const Leaflet = require("leaflet") as {
  divIcon: (options: {
    className: string;
    html: string;
    iconSize: [number, number];
    iconAnchor: [number, number];
  }) => unknown;
};

export type MapBar = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  overallAverage: number | null;
};

type RawBarRow = {
  id: string;
  name: string | null;
  lat: number | string | null;
  lng: number | string | null;
  address: string | null;
};

type RawMapBarRow = RawBarRow & {
  overall_avg: number | string | null;
};

type CriterionRow = {
  id: string;
  name: string;
  sort_order: number | null;
};

type RawBarNoteRow = RawBarNoteStatRow & {
  comment: string | null;
};

type NoteValue = {
  valueInt: number | null;
  comment: string | null;
};

type CriterionFormValue = {
  valueInt: string;
  comment: string;
};

type BarPopupState = {
  selectedBarId: string | null;
  openNonce: number;
  isEditOpen: boolean;
  loading: boolean;
  error: string | null;
};

type MapBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

type MapViewport = {
  bounds: MapBounds;
  zoom: number;
};

type FlyToTarget = {
  lat: number;
  lng: number;
  zoom: number;
  nonce: number;
} | null;

type SearchResult = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
};

type PopupCriterionRow = {
  criterionId: string;
  criterionName: string;
  valueInt: number | null;
  comment: string | null;
};

type ClusterMarker = {
  id: string;
  lat: number;
  lng: number;
  count: number;
  zoom: number;
};

type MarkerItem =
  | { kind: "bar"; bar: MapBar }
  | { kind: "cluster"; cluster: ClusterMarker };

const PARIS_BOUNDS: [[number, number], [number, number]] = [
  [48.815, 2.224],
  [48.902, 2.469],
];

const PAGE_SIZE = 1000;
const SEARCH_LIMIT = 8;
const VIEWPORT_LAT_PADDING = 0.01;
const VIEWPORT_LNG_PADDING = 0.015;
const CLUSTER_BASE_ZOOM = 14;
const CLUSTER_MAX_ZOOM = 16;
const averageFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

type RatingAppearance = {
  markerFill: string;
  markerStroke: string;
  badgeClassName: string;
  panelClassName: string;
  label: string;
};

const MapContainerUnsafe = MapContainer as unknown as ComponentType<{
  bounds: [[number, number], [number, number]];
  className: string;
  preferCanvas?: boolean;
  zoomControl?: boolean;
  children: ReactNode;
}>;

const TileLayerUnsafe = TileLayer as unknown as ComponentType<{
  attribution?: string;
  url: string;
}>;

const CircleMarkerUnsafe = CircleMarker as unknown as ComponentType<{
  center: [number, number];
  radius: number;
  pathOptions?: {
    color?: string;
    weight?: number;
    fillColor?: string;
    fillOpacity?: number;
    bubblingMouseEvents?: boolean;
  };
  eventHandlers?: {
    click?: (event: unknown) => void;
  };
}>;

const PopupUnsafe = Popup as unknown as ComponentType<{
  position: [number, number];
  closeButton?: boolean;
  autoPan?: boolean;
  eventHandlers?: {
    remove?: () => void;
  };
  className?: string;
  children: ReactNode;
}>;

const MarkerUnsafe = Marker as unknown as ComponentType<{
  position: [number, number];
  icon: unknown;
  zIndexOffset?: number;
  eventHandlers?: {
    click?: (event: unknown) => void;
  };
}>;

const ZoomControlUnsafe = ZoomControl as unknown as ComponentType<{
  position?: "topleft" | "topright" | "bottomleft" | "bottomright";
}>;

const MarkerLayer = memo(function MarkerLayer({
  markerItems,
  onSelectBar,
  onSelectCluster,
}: {
  markerItems: MarkerItem[];
  onSelectBar: (barId: string) => void;
  onSelectCluster: (cluster: ClusterMarker) => void;
}) {
  return (
    <>
      {markerItems.map((item) => {
        if (item.kind === "bar") {
          const markerAppearance = getRatingAppearance(item.bar.overallAverage);
          return (
            <CircleMarkerUnsafe
              key={item.bar.id}
              center={[item.bar.lat, item.bar.lng]}
              radius={9}
              pathOptions={{
                color: markerAppearance.markerStroke,
                weight: 3,
                fillColor: markerAppearance.markerFill,
                fillOpacity: 0.95,
                bubblingMouseEvents: false,
              }}
              eventHandlers={{
                click: (event) => {
                  stopLeafletEventPropagation(event);
                  onSelectBar(item.bar.id);
                },
              }}
            />
          );
        }

        return (
          <MarkerUnsafe
            key={item.cluster.id}
            position={[item.cluster.lat, item.cluster.lng]}
            icon={getClusterIcon(item.cluster.count)}
            zIndexOffset={1000}
            eventHandlers={{
              click: (event) => {
                stopLeafletEventPropagation(event);
                onSelectCluster(item.cluster);
              },
            }}
          />
        );
      })}
    </>
  );
});

const MapCanvas = memo(function MapCanvas({
  markerItems,
  selectedBar,
  popupNonce,
  popupLoading,
  popupError,
  popupCriteriaRows,
  flyToTarget,
  onViewportChange,
  onMapClick,
  onSelectBar,
  onSelectCluster,
  onOpenEdit,
  onClosePopup,
}: {
  markerItems: MarkerItem[];
  selectedBar: MapBar | null;
  popupNonce: number;
  popupLoading: boolean;
  popupError: string | null;
  popupCriteriaRows: PopupCriterionRow[];
  flyToTarget: FlyToTarget;
  onViewportChange: (viewport: MapViewport) => void;
  onMapClick: () => void;
  onSelectBar: (barId: string) => void;
  onSelectCluster: (cluster: ClusterMarker) => void;
  onOpenEdit: () => void;
  onClosePopup: () => void;
}) {
  const popupPosition = useMemo<[number, number] | null>(() => {
    if (!selectedBar) return null;
    return [selectedBar.lat, selectedBar.lng];
  }, [selectedBar?.id, selectedBar?.lat, selectedBar?.lng]);
  const popupRating = getRatingAppearance(selectedBar?.overallAverage ?? null);

  return (
    <MapContainerUnsafe
      bounds={PARIS_BOUNDS}
      className="h-full w-full"
      preferCanvas
      zoomControl={false}
    >
      <TileLayerUnsafe
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ZoomControlUnsafe position="bottomright" />

      <MapViewportWatcher
        onViewportChange={onViewportChange}
        onMapClick={onMapClick}
      />
      <FlyToController target={flyToTarget} />

      <MarkerLayer
        markerItems={markerItems}
        onSelectBar={onSelectBar}
        onSelectCluster={onSelectCluster}
      />

      {selectedBar && popupPosition ? (
        <PopupUnsafe
          key={`popup-${selectedBar.id}-${popupNonce}`}
          position={popupPosition}
          closeButton={false}
          autoPan={false}
          eventHandlers={{
            remove: onClosePopup,
          }}
          className="bar-map-popup"
        >
          <div className="bar-map-popup__body">
            <div className="bar-map-popup__top">
              <div className="bar-map-popup__identity">
                <div className="bar-map-popup__name-wrap">
                  <p className="bar-map-popup__title">
                    {selectedBar.name}
                  </p>
                </div>
                <div className="bar-map-popup__address-wrap">
                  <p className="bar-map-popup__address-label">
                    Adresse
                  </p>
                  <p className="bar-map-popup__address">
                    {selectedBar.address ?? "Adresse non renseignée"}
                  </p>
                </div>
                <div className="bar-map-popup__legacy-hidden">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Horaires
                  </p>
                  <p className="break-words text-sm leading-5 text-slate-600">
                    Non renseignés
                  </p>
                </div>
                <div
                  className={`bar-map-popup__summary ${popupRating.panelClassName}`}
                >
                  <div className="bar-map-popup__summary-copy">
                    <div className="bar-map-popup__summary-copy-inner">
                      <p className="bar-map-popup__eyebrow">
                        Moyenne
                      </p>
                      <p className="bar-map-popup__score">
                        {formatAverage(selectedBar.overallAverage)}
                      </p>
                    </div>
                    <span
                      className={`bar-map-popup__badge ${popupRating.badgeClassName}`}
                    >
                      {popupRating.label}
                    </span>
                  </div>
                </div>
              </div>
              <div className="bar-map-popup__close-wrap">
                <button
                  type="button"
                  onClick={onOpenEdit}
                  className="bar-map-popup__legacy-hidden"
                  title="Editer"
                  aria-label="Editer"
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="bar-map-popup__action-icon"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                  <span>Noter</span>
                </button>
                <button
                  type="button"
                  onClick={onClosePopup}
                  className="bar-map-popup__close"
                  title="Fermer"
                  aria-label="Fermer"
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="bar-map-popup__close-icon"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="bar-map-popup__bottom">
              <div className="bar-map-popup__section-header">
                <p className="bar-map-popup__section-title">Avis recents</p>
              <button
                type="button"
                onClick={onOpenEdit}
                className="bar-map-popup__action"
                title="Noter"
                aria-label="Noter"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="bar-map-popup__action-icon"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                <span>Noter</span>
              </button>
              </div>

            {popupLoading ? (
              <div className="bar-map-popup__state">
                Chargement...
              </div>
            ) : popupError ? (
              <div className="bar-map-popup__state bar-map-popup__state--error">
                {popupError}
              </div>
            ) : popupCriteriaRows.length === 0 ? (
              <div className="bar-map-popup__state">
                Aucun avis.
              </div>
            ) : (
              <ul className="bar-map-popup__list">
                {popupCriteriaRows.map((item) => {
                  const noteAppearance = getRatingAppearance(item.valueInt);

                  return (
                    <li key={item.criterionId} className="bar-map-popup__item">
                      <div className="bar-map-popup__item-head">
                        <p className="bar-map-popup__item-title">
                          {item.criterionName}
                        </p>
                        <span
                          className={`bar-map-popup__badge ${noteAppearance.badgeClassName}`}
                        >
                          {formatScore(item.valueInt)}
                        </span>
                      </div>
                      {item.comment ? (
                        <p className="bar-map-popup__item-comment">
                          {item.comment}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            </div>
          </div>
        </PopupUnsafe>
      ) : null}
    </MapContainerUnsafe>
  );
});

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function normalizeComment(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getRatingAppearance(score: number | null): RatingAppearance {
  if (score === null) {
    return {
      markerFill: "#e2e8f0",
      markerStroke: "#94a3b8",
      badgeClassName: "bar-map-popup__badge--neutral",
      panelClassName: "bar-map-popup__summary--neutral",
      label: "Sans note",
    };
  }

  if (score > 3.5) {
    return {
      markerFill: "#22c55e",
      markerStroke: "#15803d",
      badgeClassName: "bar-map-popup__badge--good",
      panelClassName: "bar-map-popup__summary--good",
      label: "Recommandé",
    };
  }

  if (score >= 2.5) {
    return {
      markerFill: "#f97316",
      markerStroke: "#c2410c",
      badgeClassName: "bar-map-popup__badge--warn",
      panelClassName: "bar-map-popup__summary--warn",
      label: "A tester",
    };
  }

  return {
    markerFill: "#ef4444",
    markerStroke: "#b91c1c",
    badgeClassName: "bar-map-popup__badge--bad",
    panelClassName: "bar-map-popup__summary--bad",
    label: "A revoir",
  };
}

function formatAverage(score: number | null): string {
  if (score === null) return "Pas encore note";
  return `${averageFormatter.format(score)}/5`;
}

function formatScore(score: number | null): string {
  if (score === null) return "-";
  return `${score}/5`;
}

function stopLeafletEventPropagation(event: unknown): void {
  if (
    typeof event === "object" &&
    event !== null &&
    "originalEvent" in event &&
    typeof (event as { originalEvent?: unknown }).originalEvent === "object" &&
    (event as { originalEvent?: unknown }).originalEvent !== null
  ) {
    const originalEvent = (event as {
      originalEvent?: {
        stopPropagation?: () => void;
        preventDefault?: () => void;
      };
    }).originalEvent;

    originalEvent?.stopPropagation?.();
    originalEvent?.preventDefault?.();
  }
}

const clusterIconCache = new Map<number, unknown>();

function getClusterIcon(count: number): unknown {
  const cached = clusterIconCache.get(count);
  if (cached) return cached;

  const size = count >= 25 ? 42 : count >= 10 ? 38 : 34;
  const icon = Leaflet.divIcon({
    className: "",
    html: `<div style="display:flex;height:${size}px;width:${size}px;align-items:center;justify-content:center;border-radius:9999px;background:#0f172a;border:3px solid #bfdbfe;color:#fff;font:700 12px/1 system-ui,sans-serif;box-shadow:0 8px 18px rgba(15,23,42,0.22);">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  clusterIconCache.set(count, icon);
  return icon;
}

function expandBounds(
  bounds: MapBounds,
  latPadding = VIEWPORT_LAT_PADDING,
  lngPadding = VIEWPORT_LNG_PADDING
): MapBounds {
  return {
    south: bounds.south - latPadding,
    west: bounds.west - lngPadding,
    north: bounds.north + latPadding,
    east: bounds.east + lngPadding,
  };
}

function makeBoundsKey(bounds: MapBounds): string {
  return [
    bounds.south.toFixed(2),
    bounds.west.toFixed(2),
    bounds.north.toFixed(2),
    bounds.east.toFixed(2),
  ].join(":");
}

function isInBounds(bar: MapBar, bounds: MapBounds): boolean {
  return (
    bar.lat >= bounds.south &&
    bar.lat <= bounds.north &&
    bar.lng >= bounds.west &&
    bar.lng <= bounds.east
  );
}

function getClusterCellSize(zoom: number): { lat: number; lng: number } {
  const normalizedZoom = Math.max(zoom - CLUSTER_BASE_ZOOM, 0);
  const scale = 2 ** normalizedZoom;

  return {
    lat: Math.max(0.0012, 0.009 / scale),
    lng: Math.max(0.0018, 0.013 / scale),
  };
}

function buildMarkerItems(bars: MapBar[], zoom: number): MarkerItem[] {
  if (bars.length === 0) return [];

  if (zoom >= CLUSTER_MAX_ZOOM || bars.length < 2) {
    return bars.map((bar) => ({ kind: "bar", bar }));
  }

  const cellSize = getClusterCellSize(zoom);
  const groups = new Map<string, MapBar[]>();

  for (const bar of bars) {
    const cellLat = Math.floor(bar.lat / cellSize.lat);
    const cellLng = Math.floor(bar.lng / cellSize.lng);
    const key = `${cellLat}:${cellLng}`;
    const group = groups.get(key);
    if (group) {
      group.push(bar);
    } else {
      groups.set(key, [bar]);
    }
  }

  const items: MarkerItem[] = [];
  for (const [key, group] of groups) {
    if (group.length === 1) {
      items.push({ kind: "bar", bar: group[0] });
      continue;
    }

    const aggregate = group.reduce(
      (accumulator, bar) => ({
        lat: accumulator.lat + bar.lat,
        lng: accumulator.lng + bar.lng,
      }),
      { lat: 0, lng: 0 }
    );

    items.push({
      kind: "cluster",
      cluster: {
        id: `cluster:${zoom}:${key}`,
        lat: aggregate.lat / group.length,
        lng: aggregate.lng / group.length,
        count: group.length,
        zoom,
      },
    });
  }

  return items;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}

function MapViewportWatcher({
  onViewportChange,
  onMapClick,
}: {
  onViewportChange: (viewport: MapViewport) => void;
  onMapClick: () => void;
}) {
  const map = useMapEvents({
    moveend: publish,
    zoomend: publish,
    click: onMapClick,
  });

  function publish() {
    const bounds = map.getBounds();
    onViewportChange({
      bounds: {
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      },
      zoom: map.getZoom(),
    });
  }

  useEffect(() => {
    publish();
    // Initial map bounds are required once at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function FlyToController({ target }: { target: FlyToTarget }) {
  const map = useMap();

  useEffect(() => {
    if (!target) return;

    map.flyTo([target.lat, target.lng], target.zoom, {
      duration: 0.6,
    });
  }, [map, target]);

  return null;
}

export default function BarsMap() {
  const [bars, setBars] = useState<MapBar[]>([]);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const [isLoadingBars, setIsLoadingBars] = useState(true);
  const [barsError, setBarsError] = useState<string | null>(null);
  const [criteriaError, setCriteriaError] = useState<string | null>(null);

  const [criteria, setCriteria] = useState<CriterionRow[]>([]);
  const [notesByBar, setNotesByBar] = useState<
    Record<string, Record<string, NoteValue>>
  >({});

  const [popupState, setPopupState] = useState<BarPopupState>({
    selectedBarId: null,
    openNonce: 0,
    isEditOpen: false,
    loading: false,
    error: null,
  });

  const [editForm, setEditForm] = useState<Record<string, CriterionFormValue>>(
    {}
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 250);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const [flyToTarget, setFlyToTarget] = useState<FlyToTarget>(null);

  const zoneCacheRef = useRef<Map<string, MapBar[]>>(new Map());
  const zonesInFlightRef = useRef<Set<string>>(new Set());
  const notesCacheRef = useRef<Record<string, Record<string, NoteValue>>>({});

  const barsById = useMemo(() => {
    return new Map<string, MapBar>(bars.map((bar) => [bar.id, bar]));
  }, [bars]);

  const selectedBar = useMemo(() => {
    if (!popupState.selectedBarId) return null;
    return barsById.get(popupState.selectedBarId) ?? null;
  }, [barsById, popupState.selectedBarId]);

  const selectedBarNotes = useMemo(() => {
    if (!selectedBar) return {};
    return notesByBar[selectedBar.id] ?? {};
  }, [notesByBar, selectedBar]);

  const visibleBars = useMemo(() => {
    if (!viewport) return [];
    const tightenedBounds = expandBounds(viewport.bounds, 0.002, 0.003);
    return bars.filter((bar) => isInBounds(bar, tightenedBounds));
  }, [bars, viewport]);

  const markerItems = useMemo(() => {
    if (!viewport) return [];
    return buildMarkerItems(visibleBars, viewport.zoom);
  }, [viewport, visibleBars]);
  const deferredMarkerItems = useDeferredValue(markerItems);

  const popupCriteriaRows = useMemo(() => {
    return criteria
      .map((criterion) => {
        const note = selectedBar ? selectedBarNotes[criterion.id] : undefined;
        return {
          criterionId: criterion.id,
          criterionName: criterion.name,
          valueInt: note?.valueInt ?? null,
          comment: note?.comment ?? null,
        };
      })
      .filter((item) => item.valueInt !== null || item.comment !== null);
  }, [criteria, selectedBar, selectedBarNotes]);

  const mergeBars = useCallback((incomingBars: MapBar[]) => {
    startTransition(() => {
      setBars((previous) => {
        const byId = new Map(previous.map((bar) => [bar.id, bar]));
        for (const bar of incomingBars) {
          byId.set(bar.id, bar);
        }

        return Array.from(byId.values());
      });
    });
  }, []);

  const refreshSingleBarOverall = useCallback(async (barId: string) => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("bars_map")
      .select("overall_avg")
      .eq("id", barId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    const avg = toNumberOrNull(
      (data as Pick<RawMapBarRow, "overall_avg"> | null)?.overall_avg ?? null
    );
    setBars((previous) =>
      previous.map((bar) =>
        bar.id === barId ? { ...bar, overallAverage: avg } : bar
      )
    );
  }, []);

  const loadBarsForBounds = useCallback(
    async (bounds: MapBounds) => {
      const paddedBounds = expandBounds(bounds);
      const zoneKey = makeBoundsKey(paddedBounds);

      if (zoneCacheRef.current.has(zoneKey)) {
        mergeBars(zoneCacheRef.current.get(zoneKey) ?? []);
        setIsLoadingBars(false);
        return;
      }

      if (zonesInFlightRef.current.has(zoneKey)) {
        return;
      }

      zonesInFlightRef.current.add(zoneKey);
      setBarsError(null);
      setIsLoadingBars(true);

      try {
        const supabase = getSupabaseClient();
        const rawBars: RawMapBarRow[] = [];

        for (let start = 0; ; start += PAGE_SIZE) {
          const end = start + PAGE_SIZE - 1;
          const { data, error } = await supabase
            .from("bars_map")
            .select("id,name,lat,lng,address,overall_avg")
            .gte("lat", paddedBounds.south)
            .lte("lat", paddedBounds.north)
            .gte("lng", paddedBounds.west)
            .lte("lng", paddedBounds.east)
            .range(start, end);

          if (error) {
            throw new Error(error.message);
          }

          const page = (data as RawMapBarRow[] | null) ?? [];
          rawBars.push(...page);

          if (page.length < PAGE_SIZE) {
            break;
          }
        }

        const parsedBars = rawBars
          .map((bar) => ({
            id: String(bar.id),
            name: String(bar.name ?? "Bar sans nom"),
            lat: toNumberOrNull(bar.lat),
            lng: toNumberOrNull(bar.lng),
            address: typeof bar.address === "string" ? bar.address : null,
            overallAverage: toNumberOrNull(bar.overall_avg),
          }))
          .filter((bar): bar is MapBar => bar.lat !== null && bar.lng !== null);

        zoneCacheRef.current.set(zoneKey, parsedBars);
        mergeBars(parsedBars);
      } catch (error) {
        setBarsError(
          error instanceof Error
            ? error.message
            : "Impossible de charger les bars pour cette zone."
        );
      } finally {
        zonesInFlightRef.current.delete(zoneKey);
        setIsLoadingBars(false);
      }
    },
    [mergeBars]
  );

  const fetchCriteria = useCallback(async () => {
    setCriteriaError(null);

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("criteria")
        .select("id,name:label,sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });

      if (error) {
        throw new Error(error.message);
      }

      const rows: CriterionRow[] = ((data as CriterionRow[] | null) ?? []).map(
        (row) => ({
          id: String(row.id),
          name: String(row.name ?? "Critere"),
          sort_order: toNumberOrNull(row.sort_order),
        })
      );

      setCriteria(rows);
    } catch (error) {
      setCriteriaError(
        error instanceof Error
          ? error.message
          : "Impossible de charger les criteres."
      );
    }
  }, []);

  const fetchBarNotes = useCallback(async (barId: string, force = false) => {
    if (!force && notesCacheRef.current[barId]) {
      return;
    }

    setPopupState((previous) => ({
      ...previous,
      loading: true,
      error: null,
    }));

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("bar_notes")
        .select("criteria_id,value_int,comment,created_at")
        .eq("bar_id", barId)
        .order("created_at", { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      const latestByCriteria: Record<string, NoteValue> = {};
      for (const row of (data as RawBarNoteRow[] | null) ?? []) {
        const criteriaId = String(row.criteria_id);
        if (latestByCriteria[criteriaId]) continue;

        latestByCriteria[criteriaId] = {
          valueInt: toNumberOrNull(row.value_int),
          comment: normalizeComment(row.comment),
        };
      }

      notesCacheRef.current[barId] = latestByCriteria;
      startTransition(() => {
        setNotesByBar((previous) => ({
          ...previous,
          [barId]: latestByCriteria,
        }));
      });

      setPopupState((previous) => ({
        ...previous,
        loading: false,
        error: null,
      }));
    } catch (error) {
      setPopupState((previous) => ({
        ...previous,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "Impossible de charger les notes du bar.",
      }));
    }
  }, []);

  const openEditSheet = useCallback(() => {
    if (!selectedBar) return;

    const currentNotes = notesByBar[selectedBar.id] ?? {};
    const nextForm: Record<string, CriterionFormValue> = {};
    for (const criterion of criteria) {
      const note = currentNotes[criterion.id];
      nextForm[criterion.id] = {
        valueInt:
          note?.valueInt !== null && note?.valueInt !== undefined
            ? String(note.valueInt)
            : "",
        comment: note?.comment ?? "",
      };
    }

    setEditForm(nextForm);
    setSaveError(null);
    setSaveSuccess(null);
    setPopupState((previous) => ({
      ...previous,
      isEditOpen: true,
    }));
  }, [criteria, notesByBar, selectedBar]);

  const closeEditSheet = useCallback(() => {
    setPopupState((previous) => ({
      ...previous,
      isEditOpen: false,
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedBar) return;

    const payload = criteria
      .map((criterion) => {
        const current = editForm[criterion.id] ?? { valueInt: "", comment: "" };
        const parsedValue =
          current.valueInt === "" ? null : Number(current.valueInt);
        const valueInt =
          typeof parsedValue === "number" && Number.isFinite(parsedValue)
            ? parsedValue
            : null;
        const comment = normalizeComment(current.comment);

        if (valueInt === null && comment === null) {
          return null;
        }

        return {
          bar_id: selectedBar.id,
          criteria_id: criterion.id,
          value_int: valueInt,
          comment,
        };
      })
      .filter(
        (
          entry
        ): entry is {
          bar_id: string;
          criteria_id: string;
          value_int: number | null;
          comment: string | null;
        } => entry !== null
      );

    if (payload.length === 0) {
      setSaveError(
        "Renseigne au moins une note ou un commentaire avant d'enregistrer."
      );
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("bar_notes").insert(payload);

      if (error) {
        throw new Error(error.message);
      }

      setSaveSuccess("Modifications enregistrees.");
      await fetchBarNotes(selectedBar.id, true);
      await refreshSingleBarOverall(selectedBar.id);
      closeEditSheet();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Impossible d'enregistrer les modifications."
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    closeEditSheet,
    criteria,
    editForm,
    fetchBarNotes,
    refreshSingleBarOverall,
    selectedBar,
  ]);

  const closePopup = useCallback(() => {
    setPopupState((previous) => ({
      ...previous,
      selectedBarId: null,
      isEditOpen: false,
      loading: false,
      error: null,
    }));
    setSaveError(null);
    setSaveSuccess(null);
  }, []);

  const handleMapClick = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  const handleSelectCluster = useCallback((cluster: ClusterMarker) => {
    setPopupState((previous) => ({
      ...previous,
      selectedBarId: null,
      isEditOpen: false,
      loading: false,
      error: null,
    }));
    setFlyToTarget({
      lat: cluster.lat,
      lng: cluster.lng,
      zoom: Math.min(cluster.zoom + 2, 17),
      nonce: Date.now(),
    });
  }, []);

  const handleSelectBar = useCallback((barId: string) => {
    setPopupState((previous) => ({
      ...previous,
      selectedBarId: barId,
      openNonce: previous.openNonce + 1,
      isEditOpen: false,
      error: null,
    }));
    setSaveError(null);
    setSaveSuccess(null);
  }, []);

  const handleSearchResultSelect = useCallback(
    async (result: SearchResult) => {
      setSearchQuery(result.name);
      setIsSearchOpen(false);
      handleSelectBar(result.id);

      setFlyToTarget({
        lat: result.lat,
        lng: result.lng,
        zoom: 17,
        nonce: Date.now(),
      });

      if (!barsById.has(result.id)) {
        mergeBars([
          {
            id: result.id,
            name: result.name,
            lat: result.lat,
            lng: result.lng,
            address: result.address,
            overallAverage: null,
          },
        ]);
      }

      try {
        await refreshSingleBarOverall(result.id);
      } catch {
        // Keep fallback marker color if overall load fails.
      }
    },
    [barsById, handleSelectBar, mergeBars, refreshSingleBarOverall]
  );

  useEffect(() => {
    void fetchCriteria();
  }, [fetchCriteria]);

  useEffect(() => {
    if (!viewport) return;
    void loadBarsForBounds(viewport.bounds);
  }, [loadBarsForBounds, viewport]);

  useEffect(() => {
    if (!popupState.selectedBarId) return;
    void fetchBarNotes(popupState.selectedBarId);
  }, [fetchBarNotes, popupState.selectedBarId]);

  useEffect(() => {
    if (debouncedSearchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }

    let cancelled = false;

    async function searchBars() {
      setIsSearching(true);
      setSearchError(null);

      try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
          .from("bars")
          .select("id,name,lat,lng,address")
          .ilike("name", `%${debouncedSearchQuery.trim()}%`)
          .not("lat", "is", null)
          .not("lng", "is", null)
          .order("name", { ascending: true })
          .range(0, SEARCH_LIMIT - 1);

        if (error) {
          throw new Error(error.message);
        }

        if (cancelled) return;

        const rows: SearchResult[] = ((data as RawBarRow[] | null) ?? [])
          .map((bar) => ({
            id: String(bar.id),
            name: String(bar.name ?? "Bar sans nom"),
            lat: toNumberOrNull(bar.lat),
            lng: toNumberOrNull(bar.lng),
            address: typeof bar.address === "string" ? bar.address : null,
          }))
          .filter(
            (bar): bar is SearchResult => bar.lat !== null && bar.lng !== null
          );

        setSearchResults(rows);
      } catch (error) {
        if (cancelled) return;
        setSearchError(
          error instanceof Error
            ? error.message
            : "Impossible de chercher les bars."
        );
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }

    void searchBars();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearchQuery]);

  return (
    <section className="relative h-screen w-full bg-slate-200">
      <MapCanvas
        markerItems={deferredMarkerItems}
        selectedBar={selectedBar}
        popupNonce={popupState.openNonce}
        popupLoading={popupState.loading}
        popupError={popupState.error}
        popupCriteriaRows={popupCriteriaRows}
        flyToTarget={flyToTarget}
        onViewportChange={setViewport}
        onMapClick={handleMapClick}
        onSelectBar={handleSelectBar}
        onSelectCluster={handleSelectCluster}
        onOpenEdit={openEditSheet}
        onClosePopup={closePopup}
      />

      <div className="pointer-events-none absolute inset-0 z-[1000]">
        <div className="pointer-events-auto absolute left-3 right-3 top-3 sm:left-4 sm:right-auto sm:top-4 sm:w-[360px]">
          <div className="rounded-xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              placeholder="Rechercher un bar..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />

            {isSearchOpen ? (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                {isSearching ? (
                  <p className="px-3 py-2 text-xs text-slate-500">Recherche...</p>
                ) : searchError ? (
                  <p className="px-3 py-2 text-xs text-red-600">{searchError}</p>
                ) : debouncedSearchQuery.trim().length < 2 ? (
                  <p className="px-3 py-2 text-xs text-slate-500">
                    Tape au moins 2 caracteres.
                  </p>
                ) : searchResults.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-500">Aucun resultat.</p>
                ) : (
                  <ul className="py-1">
                    {searchResults.map((result) => (
                      <li key={result.id}>
                        <button
                          type="button"
                          onClick={() => {
                            void handleSearchResultSelect(result);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-slate-100"
                        >
                          <p className="text-sm font-medium text-slate-800">
                            {result.name}
                          </p>
                          <p className="text-xs text-slate-600">
                            {result.address ?? "Adresse non renseignee"}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2 sm:right-4 sm:top-4">
          {isLoadingBars ? (
            <p className="rounded-md bg-white/95 px-3 py-1 text-xs text-slate-700 shadow">
              Chargement des bars...
            </p>
          ) : null}
          {barsError ? (
            <p className="max-w-[260px] rounded-md bg-red-50 px-3 py-1 text-xs text-red-700 shadow">
              Erreur carte: {barsError}
            </p>
          ) : null}
          {criteriaError ? (
            <p className="max-w-[260px] rounded-md bg-red-50 px-3 py-1 text-xs text-red-700 shadow">
              Erreur criteres: {criteriaError}
            </p>
          ) : null}
        </div>
      </div>

      {popupState.isEditOpen && selectedBar ? (
        <div className="absolute inset-0 z-[1200] flex items-end justify-center bg-slate-900/45 p-3 sm:items-center sm:p-6">
          <section className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
              <div>
                <h2 className="text-base font-semibold">Editer les notes</h2>
                <p className="text-xs text-slate-600">{selectedBar.name}</p>
              </div>
              <button
                type="button"
                onClick={closeEditSheet}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-lg hover:bg-slate-100"
                aria-label="Fermer le panneau d'edition"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {criteria.map((criterion) => (
                <div
                  key={criterion.id}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <p className="text-sm font-medium">{criterion.name}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr]">
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-slate-600">Note sur 5</span>
                      <select
                        value={editForm[criterion.id]?.valueInt ?? ""}
                        onChange={(event) => {
                          const valueInt = event.target.value;
                          setEditForm((previous) => ({
                            ...previous,
                            [criterion.id]: {
                              valueInt,
                              comment: previous[criterion.id]?.comment ?? "",
                            },
                          }));
                        }}
                        className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                      >
                        <option value="">-</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                        <option value="5">5</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-slate-600">Commentaire</span>
                      <textarea
                        value={editForm[criterion.id]?.comment ?? ""}
                        onChange={(event) => {
                          const comment = event.target.value;
                          setEditForm((previous) => ({
                            ...previous,
                            [criterion.id]: {
                              valueInt: previous[criterion.id]?.valueInt ?? "",
                              comment,
                            },
                          }));
                        }}
                        rows={2}
                        placeholder="Optionnel"
                        className="resize-y rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <footer className="border-t border-slate-200 p-4">
              {saveError ? (
                <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {saveError}
                </p>
              ) : null}
              {saveSuccess ? (
                <p className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  {saveSuccess}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeEditSheet}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSave}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {isSaving ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
