"use client";

import {
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";

const PASSWORD = "paris";
const STORAGE_KEY = "cartedesbars-password-ok";

type PasswordGateProps = {
  children: ReactNode;
};

export default function PasswordGate({ children }: PasswordGateProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const isStoredUnlocked = useSyncExternalStore(
    () => () => {},
    () => window.localStorage.getItem(STORAGE_KEY) === "1",
    () => false
  );
  const shouldShowGate = !isUnlocked && !isStoredUnlocked;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (value.trim() !== PASSWORD) {
      setError("Mot de passe incorrect.");
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, "1");
    setIsUnlocked(true);
    setValue("");
    setError(null);
  }

  if (!shouldShowGate) {
    return <>{children}</>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8 text-slate-900">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Accès protégé</h1>

        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-600">Mot de passe</span>
            <input
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              autoComplete="current-password"
              required
            />
          </label>

          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Ouvrir le site
          </button>
        </form>
      </section>
    </main>
  );
}
