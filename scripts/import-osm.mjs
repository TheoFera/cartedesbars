// scripts/import-osm.mjs
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const envPaths = [".env.local", "env.local"];
let loadedEnvPath = null;

for (const envPath of envPaths) {
  const absoluteEnvPath = path.resolve(process.cwd(), envPath);
  if (!fs.existsSync(absoluteEnvPath)) continue;

  dotenv.config({ path: absoluteEnvPath });
  loadedEnvPath = envPath;
  break;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Il manque NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY dans .env.local ou env.local"
  );
  if (!loadedEnvPath) {
    console.error("Aucun fichier .env.local/env.local detecte dans le dossier du projet");
  }
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function buildAddress(tags = {}) {
  const hn = tags["addr:housenumber"] || "";
  const street = tags["addr:street"] || "";
  const postcode = tags["addr:postcode"] || "";
  const city = tags["addr:city"] || "Paris";

  const line1 = [hn, street].filter(Boolean).join(" ").trim();
  const line2 = [postcode, city].filter(Boolean).join(" ").trim();

  const full = [line1, line2].filter(Boolean).join(", ").trim();
  return full || null;
}

function getLatLng(el) {
  // node => lat/lon
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lng: el.lon };
  }
  // way/relation => center.lat/center.lon (si "out center")
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return { lat: null, lng: null };
}

function cleanName(tags = {}) {
  return tags.name || tags["name:fr"] || null;
}

async function upsertBatch(rows) {
  const { error } = await supabase
    .from("bars")
    .upsert(rows, { onConflict: "osm_type,osm_id" });

  if (error) throw error;
}

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error("❌ Usage: node scripts/import-osm.mjs <chemin_du_fichier_json>");
    console.error('   Exemple: node scripts/import-osm.mjs "./paris-bars.json"');
    process.exit(1);
  }

  const raw = fs.readFileSync(path.resolve(inputFile), "utf8");
  const data = JSON.parse(raw);

  if (!data.elements || !Array.isArray(data.elements)) {
    console.error("❌ JSON invalide: pas de champ elements[]");
    process.exit(1);
  }

  console.log(`✅ Fichier chargé. elements: ${data.elements.length}`);

  const rows = [];
  for (const el of data.elements) {
    const tags = el.tags || {};
    const amenity = tags.amenity;

    // On ne garde que bar/pub/cafe
    if (!["bar", "pub", "cafe"].includes(amenity)) continue;

    const name = cleanName(tags);
    const { lat, lng } = getLatLng(el);

    // Si pas de coordonnées, on saute
    if (lat === null || lng === null) continue;

    rows.push({
      osm_type: el.type,
      osm_id: el.id,
      amenity,
      name: name || "(sans nom)",
      address: buildAddress(tags),
      lat,
      lng,
      opening_hours_raw: tags.opening_hours || null,
      // Champs optionnels déjà dans ta table bars (si présents)
      nearest_metro: null,
      area_notes: null,
      manager_name: null,
      manager_details: null,
    });
  }

  console.log(`✅ Lieux filtrés (bar/pub/cafe) avec coordonnées: ${rows.length}`);

  // Insert par paquets (évite les erreurs de taille)
  const BATCH_SIZE = 500;
  let done = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await upsertBatch(batch);
    done += batch.length;
    console.log(`➡️ Import: ${done}/${rows.length}`);
  }

  console.log("🎉 Import terminé.");
}

main().catch((e) => {
  console.error("❌ Erreur import:", e);
  process.exit(1);
});
