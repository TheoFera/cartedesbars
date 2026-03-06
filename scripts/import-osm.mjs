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
const SUPPORTED_AMENITIES = new Set(["bar", "pub", "cafe", "restaurant"]);

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "Il manque NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY dans .env.local ou env.local"
  );
  if (!loadedEnvPath) {
    console.error(
      "Aucun fichier .env.local/env.local detecte dans le dossier du projet"
    );
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
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lng: el.lon };
  }

  if (
    el.center &&
    typeof el.center.lat === "number" &&
    typeof el.center.lon === "number"
  ) {
    return { lat: el.center.lat, lng: el.center.lon };
  }

  return { lat: null, lng: null };
}

function cleanName(tags = {}) {
  return tags.name || tags["name:fr"] || null;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getAddressLine1(address) {
  const firstPart = String(address || "").split(",")[0] || "";
  return normalizeText(firstPart);
}

function buildMatchKey(name, address) {
  return `${normalizeText(name)}||${getAddressLine1(address)}`;
}

function buildOsmKey(osmType, osmId) {
  return `${osmType}||${osmId}`;
}

async function fetchAllBarsIndex() {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("bars")
      .select("id,name,address,osm_type,osm_id")
      .range(from, to);

    if (error) throw error;

    const page = data || [];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  const byMatchKey = new Map();
  const byOsmKey = new Map();

  for (const row of rows) {
    const key = buildMatchKey(row.name, row.address);
    if (!normalizeText(row.name) || !getAddressLine1(row.address)) continue;
    if (!byMatchKey.has(key)) {
      byMatchKey.set(key, row);
    }

    if (row.osm_type && row.osm_id !== null && row.osm_id !== undefined) {
      byOsmKey.set(buildOsmKey(row.osm_type, row.osm_id), row);
    }
  }

  return { byMatchKey, byOsmKey };
}

async function updateExistingBatch(rows) {
  const batchSize = 200;
  let done = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    for (const row of batch) {
      const { error } = await supabase
        .from("bars")
        .update({
          osm_type: row.osm_type,
          osm_id: row.osm_id,
          amenity: row.amenity,
          name: row.name,
          address: row.address,
          lat: row.lat,
          lng: row.lng,
          opening_hours_raw: row.opening_hours_raw,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (error) throw error;
    }

    done += batch.length;
    console.log(`Update: ${done}/${rows.length}`);
  }
}

async function upsertBatch(rows) {
  if (rows.length === 0) return;

  const { error } = await supabase
    .from("bars")
    .upsert(rows, { onConflict: "osm_type,osm_id" });

  if (error) throw error;
}

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error(
      "Usage: node scripts/import-osm.mjs <chemin_du_fichier_json>"
    );
    console.error(
      'Exemple: node scripts/import-osm.mjs "./paris-bars-restaurants.json"'
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(path.resolve(inputFile), "utf8");
  const data = JSON.parse(raw);

  if (!data.elements || !Array.isArray(data.elements)) {
    console.error("JSON invalide: pas de champ elements[]");
    process.exit(1);
  }

  console.log(`Fichier charge. elements: ${data.elements.length}`);

  const rows = [];
  for (const el of data.elements) {
    const tags = el.tags || {};
    const amenity = tags.amenity;

    if (!SUPPORTED_AMENITIES.has(amenity)) continue;

    const name = cleanName(tags);
    const { lat, lng } = getLatLng(el);

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
      nearest_metro: null,
      area_notes: null,
      manager_name: null,
      manager_details: null,
    });
  }

  const uniqueRowsByOsmKey = new Map();
  for (const row of rows) {
    uniqueRowsByOsmKey.set(buildOsmKey(row.osm_type, row.osm_id), row);
  }
  const dedupedRows = Array.from(uniqueRowsByOsmKey.values());

  console.log(
    `Lieux filtres (${Array.from(SUPPORTED_AMENITIES).join("/")}) avec coordonnees: ${dedupedRows.length}`
  );

  const existingBarsIndex = await fetchAllBarsIndex();
  const rowsToUpdateById = new Map();
  const rowsToUpsertByOsmKey = new Map();
  let skippedBecauseConflict = 0;

  for (const row of dedupedRows) {
    const osmKey = buildOsmKey(row.osm_type, row.osm_id);
    const matchKey = buildMatchKey(row.name, row.address);
    const existingByOsmKey = existingBarsIndex.byOsmKey.get(osmKey);
    const existingByMatchKey = existingBarsIndex.byMatchKey.get(matchKey);

    if (existingByOsmKey) {
      rowsToUpdateById.set(existingByOsmKey.id, {
        id: existingByOsmKey.id,
        ...row,
      });
      continue;
    }

    if (existingByMatchKey) {
      if (
        existingByMatchKey.osm_type &&
        existingByMatchKey.osm_id !== null &&
        existingByMatchKey.osm_id !== undefined
      ) {
        skippedBecauseConflict += 1;
        continue;
      }

      rowsToUpdateById.set(existingByMatchKey.id, {
        id: existingByMatchKey.id,
        ...row,
      });
      existingBarsIndex.byOsmKey.set(osmKey, {
        ...existingByMatchKey,
        osm_type: row.osm_type,
        osm_id: row.osm_id,
      });
      continue;
    }

    rowsToUpsertByOsmKey.set(osmKey, row);
  }

  const rowsToUpdate = Array.from(rowsToUpdateById.values());
  const rowsToUpsert = Array.from(rowsToUpsertByOsmKey.values());

  console.log(`Lignes fusionnees avec des lieux existants: ${rowsToUpdate.length}`);
  console.log(`Lignes a upsert par OSM: ${rowsToUpsert.length}`);
  console.log(`Lignes ignorees pour conflit OSM deja mappe: ${skippedBecauseConflict}`);

  if (rowsToUpdate.length > 0) {
    await updateExistingBatch(rowsToUpdate);
  }

  const BATCH_SIZE = 500;
  let done = 0;

  for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
    const batch = rowsToUpsert.slice(i, i + BATCH_SIZE);
    await upsertBatch(batch);
    done += batch.length;
    console.log(`Import: ${done}/${rowsToUpsert.length}`);
  }

  console.log("Import termine.");
}

main().catch((error) => {
  console.error("Erreur import:", error);
  process.exit(1);
});
