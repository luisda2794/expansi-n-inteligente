import { supabase } from "@/integrations/supabase/client";

export type ZipCoord = { zip: string; lat: number; lon: number };

const LS_KEY = "epod-zip-geocache-v1";

function readLocal(): Record<string, { lat: number; lon: number }> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as Record<string, { lat: number; lon: number }>;
  } catch {
    return {};
  }
}

function writeLocal(map: Record<string, { lat: number; lon: number }>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    // best-effort
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geocodeZip(zip: string): Promise<{ lat: number; lon: number; display: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(
    zip,
  )}&country=Spain&format=json&limit=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
  const first = json[0];
  if (!first) return null;
  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, display: first.display_name ?? "" };
}

/**
 * Devuelve las coordenadas (centroide aproximado) de cada CP.
 * Caché en tres niveles: localStorage -> tabla `zip_geocodes` -> Nominatim.
 * Nominatim se consulta en serie con throttling (1 req/s) según su política de uso.
 */
export async function resolveZipCoords(
  zips: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, ZipCoord>> {
  const result = new Map<string, ZipCoord>();
  const unique = [...new Set(zips)].filter(Boolean);
  if (unique.length === 0) return result;

  const local = readLocal();
  const pending: string[] = [];
  for (const zip of unique) {
    const hit = local[zip];
    if (hit) result.set(zip, { zip, lat: hit.lat, lon: hit.lon });
    else pending.push(zip);
  }

  if (pending.length > 0) {
    const { data } = await supabase.from("zip_geocodes").select("zip_code, lat, lon").in("zip_code", pending);
    for (const row of data ?? []) {
      const zip = row.zip_code as string;
      result.set(zip, { zip, lat: Number(row.lat), lon: Number(row.lon) });
      local[zip] = { lat: Number(row.lat), lon: Number(row.lon) };
    }
    writeLocal(local);
  }

  const missing = pending.filter((z) => !result.has(z));
  let done = unique.length - missing.length;
  onProgress?.(done, unique.length);

  for (const zip of missing) {
    try {
      const geo = await geocodeZip(zip);
      if (geo) {
        result.set(zip, { zip, lat: geo.lat, lon: geo.lon });
        local[zip] = { lat: geo.lat, lon: geo.lon };
        writeLocal(local);
        await supabase
          .from("zip_geocodes")
          .upsert({ zip_code: zip, lat: geo.lat, lon: geo.lon, display_name: geo.display }, { onConflict: "zip_code" });
      }
    } catch {
      // Si falla un CP concreto seguimos con el resto.
    }
    done += 1;
    onProgress?.(done, unique.length);
    await sleep(1100);
  }

  return result;
}
