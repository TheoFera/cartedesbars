"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { MapBar } from "@/src/components/BarsMap";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

type BarRow = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
};

const BarsMap = dynamic(() => import("@/src/components/BarsMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500">
      Chargement de la carte...
    </div>
  ),
});

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

export default function HomePage() {
  const [bars, setBars] = useState<BarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchBars() {
      setLoading(true);
      setErrorMessage(null);

      try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
          .from("bars")
          .select("id,name,lat,lng,address")
          .order("name", { ascending: true });

        if (error) {
          throw new Error(error.message);
        }

        const rows: BarRow[] = (data ?? []).map((bar) => ({
          id: String(bar.id),
          name: String(bar.name ?? "Bar sans nom"),
          lat: toNumberOrNull(bar.lat),
          lng: toNumberOrNull(bar.lng),
          address: typeof bar.address === "string" ? bar.address : null,
        }));

        if (!cancelled) {
          setBars(rows);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Impossible de charger les bars."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchBars();

    return () => {
      cancelled = true;
    };
  }, []);

  const barsWithCoordinates = useMemo(
    () =>
      bars.filter(
        (bar): bar is MapBar => bar.lat !== null && bar.lng !== null
      ),
    [bars]
  );

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight">Carte des bars</h1>
          <p className="mt-2 text-sm text-slate-600">
            Clique sur un marqueur pour ouvrir la fiche d&apos;un bar et saisir
            des notes.
          </p>
        </header>

        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Erreur: {errorMessage}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            Chargement des bars...
          </div>
        ) : (
          <>
            <BarsMap bars={barsWithCoordinates} />

            {bars.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
                Aucun bar disponible.
              </div>
            ) : (
              <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold">Liste des bars</h2>
                <ul className="mt-4 space-y-3">
                  {bars.map((bar) => (
                    <li
                      key={bar.id}
                      className="flex items-start justify-between gap-4 rounded-md border border-slate-200 p-3"
                    >
                      <div>
                        <p className="font-medium">{bar.name}</p>
                        <p className="text-sm text-slate-600">
                          {bar.address ?? "Adresse non renseignee"}
                        </p>
                      </div>
                      <Link
                        href={`/bar/${bar.id}`}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                      >
                        Ouvrir
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
