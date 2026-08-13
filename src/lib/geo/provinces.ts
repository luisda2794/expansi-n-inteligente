import simplify from "@turf/simplify";

// Prefijo de CP (2 dígitos) -> nombre de fichero en el repo de origen.
// https://github.com/inigoflores/ds-codigos-postales/tree/master/data
export const PROVINCE_FILE: Record<string, string> = {
  "01": "ALAVA",
  "02": "ALBACETE",
  "03": "ALICANTE",
  "04": "ALMERIA",
  "05": "AVILA",
  "06": "BADAJOZ",
  "07": "BALEARES",
  "08": "BARCELONA",
  "09": "BURGOS",
  "10": "CACERES",
  "11": "CADIZ",
  "12": "CASTELLON",
  "13": "CIUDAD_REAL",
  "14": "CORDOBA",
  "15": "A_CORUNA",
  "16": "CUENCA",
  "17": "GIRONA",
  "18": "GRANADA",
  "19": "GUADALAJARA",
  "20": "GUIPUZCOA",
  "21": "HUELVA",
  "22": "HUESCA",
  "23": "JAEN",
  "24": "LEON",
  "25": "LLEIDA",
  "26": "LA_RIOJA",
  "27": "LUGO",
  "28": "MADRID",
  "29": "MALAGA",
  "30": "MURCIA",
  "31": "NAVARRA",
  "32": "OURENSE",
  "33": "ASTURIAS",
  "34": "PALENCIA",
  "35": "LAS_PALMAS",
  "36": "PONTEVEDRA",
  "37": "SALAMANCA",
  "38": "TENERIFE",
  "39": "CANTABRIA",
  "40": "SEGOVIA",
  "41": "SEVILLA",
  "42": "SORIA",
  "43": "TARRAGONA",
  "44": "TERUEL",
  "45": "TOLEDO",
  "46": "VALENCIA",
  "47": "VALLADOLID",
  "48": "VIZCAYA",
  "49": "ZAMORA",
  "50": "ZARAGOZA",
  "51": "CEUTA",
  "52": "MELILLA",
};

const RAW_BASE = "https://raw.githubusercontent.com/inigoflores/ds-codigos-postales/master/data";
const CACHE_VERSION = "v1";
const DB_NAME = "epod-geo-cache";
const STORE = "provinces";
const SIMPLIFY_TOLERANCE = 0.001;

type GeoFeature = { type: "Feature"; properties: Record<string, unknown> | null; geometry: unknown };
export type GeoFC = { type: "FeatureCollection"; features: GeoFeature[] };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(key: string): Promise<GeoFC | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as GeoFC | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function cacheSet(key: string, value: GeoFC): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Cache best-effort: si IndexedDB no está disponible, seguimos sin cachear.
  }
}

const inFlight = new Map<string, Promise<GeoFC>>();

// Descarga (o recupera de caché) el geojson simplificado de una provincia
// completa, sin filtrar. El filtrado por CP se hace aparte y es barato,
// así que la caché no depende de qué CPs tengamos en cada momento.
export function loadProvinceGeoJson(prefix: string): Promise<GeoFC> {
  const file = PROVINCE_FILE[prefix];
  if (!file) return Promise.reject(new Error(`Prefijo de CP desconocido: ${prefix}`));
  const cacheKey = `${CACHE_VERSION}:${file}`;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const res = await fetch(`${RAW_BASE}/${file}.geojson`);
    if (!res.ok) throw new Error(`No se pudo descargar el geojson de ${file} (${res.status})`);
    const raw = (await res.json()) as GeoFC;
    const simplified = simplify(raw as never, {
      tolerance: SIMPLIFY_TOLERANCE,
      highQuality: false,
      mutate: true,
    }) as unknown as GeoFC;
    await cacheSet(cacheKey, simplified);
    return simplified;
  })();

  inFlight.set(cacheKey, promise);
  void promise.finally(() => inFlight.delete(cacheKey));
  return promise;
}

// Filtra un FeatureCollection de provincia a solo los CP que nos interesan.
// Devuelve también el set de CP encontrados, para poder calcular cuáles
// faltaban (sin polígono disponible) sin volver a recorrer nada.
export function filterByZips(fc: GeoFC, zips: Set<string>): { collection: GeoFC; found: Set<string> } {
  const found = new Set<string>();
  const features = fc.features.filter((f) => {
    const cp = String(f.properties?.["COD_POSTAL"] ?? "").padStart(5, "0");
    if (zips.has(cp)) {
      found.add(cp);
      return true;
    }
    return false;
  });
  return { collection: { type: "FeatureCollection", features }, found };
}
