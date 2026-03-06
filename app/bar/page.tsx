"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  computeCriteriaStatsForBar,
  computeOverallByBar,
  type RawBarNoteStatRow,
} from "@/src/lib/barNoteStats";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

type BarRow = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

type CriterionRow = {
  id: string;
  name: string;
  sort_order: number | null;
};

type BarAvgByCriteriaRow = {
  criteria_id: string;
  avg_value: number | null;
  notes_count: number | null;
};

type CriterionFormValue = {
  valueInt: string;
  comment: string;
};

type FormState = Record<string, CriterionFormValue>;

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function formatAverage(value: number | null): string {
  if (value === null) return "-";
  return value.toFixed(2);
}

export default function BarDetailsPage() {
  const searchParams = useSearchParams();
  const barId = searchParams.get("id")?.trim() ?? "";

  const [bar, setBar] = useState<BarRow | null>(null);
  const [criteria, setCriteria] = useState<CriterionRow[]>([]);
  const [overall, setOverall] = useState<{
    avg_value: number | null;
    notes_count: number;
  } | null>(null);
  const [avgByCriteria, setAvgByCriteria] = useState<BarAvgByCriteriaRow[]>([]);
  const [formState, setFormState] = useState<FormState>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("bar_notes")
      .select("bar_id,criteria_id,value_int,created_at")
      .eq("bar_id", barId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data as RawBarNoteStatRow[] | null) ?? [];
    const overallStat = computeOverallByBar(rows).get(barId) ?? {
      avg: null,
      count: 0,
    };

    setOverall({
      avg_value: overallStat.avg,
      notes_count: overallStat.count,
    });
    setAvgByCriteria(computeCriteriaStatsForBar(rows, barId));
  }, [barId]);

  const fetchPageData = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    setBar(null);
    setCriteria([]);
    setOverall(null);
    setAvgByCriteria([]);

    try {
      if (!barId) {
        throw new Error("Identifiant de bar manquant.");
      }

      const supabase = getSupabaseClient();
      const [barResult, criteriaResult] = await Promise.all([
        supabase
          .from("bars")
          .select("id,name,address,lat,lng")
          .eq("id", barId)
          .maybeSingle(),
        supabase
          .from("criteria")
          .select("id,name:label,sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("label", { ascending: true }),
      ]);

      if (barResult.error) throw new Error(barResult.error.message);
      if (criteriaResult.error) throw new Error(criteriaResult.error.message);
      if (!barResult.data) throw new Error("Bar introuvable.");

      setBar({
        id: String(barResult.data.id),
        name: String(barResult.data.name ?? "Bar"),
        address:
          typeof barResult.data.address === "string"
            ? barResult.data.address
            : null,
        lat: toNumberOrNull(barResult.data.lat),
        lng: toNumberOrNull(barResult.data.lng),
      });

      const criteriaRows: CriterionRow[] = (criteriaResult.data ?? []).map(
        (item) => ({
          id: String(item.id),
          name: String(item.name ?? "Critere"),
          sort_order: toNumberOrNull(item.sort_order),
        })
      );
      setCriteria(criteriaRows);

      setFormState((previous) => {
        const next: FormState = {};
        for (const item of criteriaRows) {
          next[item.id] = previous[item.id] ?? { valueInt: "", comment: "" };
        }
        return next;
      });

      await fetchStats();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Erreur de chargement."
      );
    } finally {
      setLoading(false);
    }
  }, [barId, fetchStats]);

  useEffect(() => {
    void fetchPageData();
  }, [fetchPageData]);

  const averageByCriteriaMap = useMemo(() => {
    const map = new Map<string, { avg: number | null; count: number }>();
    for (const item of avgByCriteria) {
      map.set(String(item.criteria_id), {
        avg: toNumberOrNull(item.avg_value),
        count: Number(item.notes_count ?? 0),
      });
    }
    return map;
  }, [avgByCriteria]);

  const overallAverage = toNumberOrNull(overall?.avg_value ?? null);
  const overallCount = Number(overall?.notes_count ?? 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    if (!barId) {
      setSubmitError("Identifiant de bar invalide.");
      return;
    }

    const payload = criteria
      .map((criterion) => {
        const current = formState[criterion.id];
        const valueInt = current?.valueInt ? Number(current.valueInt) : null;
        const trimmedComment = (current?.comment ?? "").trim();
        const comment = trimmedComment.length > 0 ? trimmedComment : null;

        if (valueInt === null && comment === null) {
          return null;
        }

        return {
          bar_id: barId,
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
      setSubmitError(
        "Renseigne au moins une note ou un commentaire avant d'enregistrer."
      );
      return;
    }

    setSaving(true);

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("bar_notes").insert(payload);
      if (error) throw new Error(error.message);

      setSubmitSuccess("Notes enregistrees.");
      setFormState((previous) => {
        const next = { ...previous };
        for (const criterion of criteria) {
          next[criterion.id] = { valueInt: "", comment: "" };
        }
        return next;
      });

      await fetchStats();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Impossible d'enregistrer les notes."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Link
          href="/"
          className="w-fit rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          {"<- Retour a la carte"}
        </Link>

        {loading ? (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            Chargement...
          </section>
        ) : pageError ? (
          <section className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">
            Erreur: {pageError}
          </section>
        ) : bar ? (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h1 className="text-2xl font-bold">{bar.name}</h1>
              <p className="mt-2 text-sm text-slate-600">
                {bar.address ?? "Adresse non renseignee"}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-slate-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Note globale
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {formatAverage(overallAverage)}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Nombre de notes
                  </p>
                  <p className="mt-1 text-xl font-semibold">{overallCount}</p>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Coordonnees
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {bar.lat ?? "-"}, {bar.lng ?? "-"}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Moyennes par critere</h2>
              {criteria.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">
                  Aucun critere actif.
                </p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {criteria.map((criterion) => {
                    const avg = averageByCriteriaMap.get(criterion.id);
                    return (
                      <li
                        key={criterion.id}
                        className="flex items-center justify-between rounded-md border border-slate-200 p-3"
                      >
                        <span className="font-medium">{criterion.name}</span>
                        <span className="text-sm text-slate-600">
                          {formatAverage(avg?.avg ?? null)} ({avg?.count ?? 0}{" "}
                          notes)
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Ajouter des notes</h2>
              <p className="mt-2 text-sm text-slate-600">
                Tu peux saisir une note (1-5), un commentaire, ou les deux.
              </p>

              {submitError ? (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {submitError}
                </div>
              ) : null}
              {submitSuccess ? (
                <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  {submitSuccess}
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                {criteria.map((criterion) => (
                  <div
                    key={criterion.id}
                    className="rounded-md border border-slate-200 p-4"
                  >
                    <p className="font-medium">{criterion.name}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr]">
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-slate-600">Note</span>
                        <select
                          value={formState[criterion.id]?.valueInt ?? ""}
                          onChange={(event) => {
                            const valueInt = event.target.value;
                            setFormState((previous) => ({
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
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-slate-600">Commentaire</span>
                        <input
                          type="text"
                          value={formState[criterion.id]?.comment ?? ""}
                          onChange={(event) => {
                            const comment = event.target.value;
                            setFormState((previous) => ({
                              ...previous,
                              [criterion.id]: {
                                valueInt: previous[criterion.id]?.valueInt ?? "",
                                comment,
                              },
                            }));
                          }}
                          placeholder="Optionnel"
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                  </div>
                ))}

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Enregistrement..." : "Enregistrer"}
                </button>
              </form>
            </section>
          </>
        ) : (
          <section className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">
            Bar introuvable.
          </section>
        )}
      </div>
    </main>
  );
}
