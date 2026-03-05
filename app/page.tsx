"use client";

import dynamic from "next/dynamic";

const BarsMap = dynamic(() => import("@/src/components/BarsMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center bg-slate-100 text-slate-500">
      Chargement de la carte...
    </div>
  ),
});

export default function HomePage() {
  return (
    <main className="h-screen w-full text-slate-900">
      <BarsMap />
    </main>
  );
}
