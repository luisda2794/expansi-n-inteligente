import * as XLSX from "xlsx";
import { inferLocality, normalizeZip } from "./spain-zip";

export type EpodDailyRow = {
  zip_code: string;
  dsp_name: string;
  task_date: string; // YYYY-MM-DD
  parcels: number;
  locality: string;
};

export type ParseResult = {
  rows: EpodDailyRow[];
  totalParcels: number;
  days: string[];
  skipped: number;
  excludedCancelled: number;
  duplicateEvents: number;
};

const ALIASES: Record<string, string[]> = {
  waybill: ["waybill number", "número de waybill", "numero de waybill", "waybill", "nº waybill"],
  date: ["task date", "fecha de la tarea", "fecha tarea", "fecha", "date"],
  status: ["task status", "estado de la tarea", "estado", "status"],
  zip: ["zip code", "código postal", "codigo postal", "cp", "postcode", "zipcode"],
  dsp: ["dsp name", "nombre de dsp", "nombre dsp", "dsp", "empresa"],
  courier: ["courier name", "nombre del repartidor", "repartidor", "courier"],
};

const clean = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

function findKey(headers: string[], type: keyof typeof ALIASES): string | null {
  const wanted = ALIASES[type]!;
  for (const h of headers) {
    const c = clean(h);
    if (wanted.includes(c)) return h;
  }
  for (const h of headers) {
    const c = clean(h);
    if (wanted.some((w) => c.includes(w))) return h;
  }
  return null;
}

function toISODate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

type StatusBucket = "delivered" | "attempt_failure" | "cancel" | "driver_received" | "assigned" | "other";

const STATUS_PRIORITY: Record<StatusBucket, number> = {
  delivered: 4,
  attempt_failure: 3,
  cancel: 3,
  driver_received: 2,
  assigned: 1,
  other: 0,
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function classifyStatus(raw: unknown): { bucket: StatusBucket; priority: number } {
  const s = stripAccents(String(raw ?? "").toLowerCase().trim());
  let bucket: StatusBucket = "other";
  if (!s) bucket = "other";
  else if (s.includes("cancel")) bucket = "cancel";
  else if (s.includes("fail") || s.includes("fallid") || s.includes("fallo")) bucket = "attempt_failure";
  else if (s.includes("deliver") || s.includes("entregad")) bucket = "delivered";
  else if (
    s.includes("driver_received") ||
    s.includes("driver received") ||
    s.includes("recib") ||
    s.includes("recogid")
  )
    bucket = "driver_received";
  else if (s.includes("assign") || s.includes("asignad")) bucket = "assigned";
  return { bucket, priority: STATUS_PRIORITY[bucket] };
}

type RawEvent = {
  waybill: string;
  date: string;
  zip: string;
  dsp: string;
  bucket: StatusBucket;
  priority: number;
};

export async function parseEpodFile(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("El archivo no contiene ninguna hoja.");
  const sheet = wb.Sheets[sheetName]!;
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (json.length === 0) throw new Error("La hoja está vacía.");

  const headers = Object.keys(json[0]!);
  const zipKey = findKey(headers, "zip");
  const dateKey = findKey(headers, "date");
  const dspKey = findKey(headers, "dsp");
  const waybillKey = findKey(headers, "waybill");
  const statusKey = findKey(headers, "status");

  if (!zipKey) throw new Error("No se encontró la columna de código postal (Zip Code).");
  if (!dateKey) throw new Error("No se encontró la columna de fecha (Task Date).");
  if (!waybillKey)
    throw new Error(
      "No se encontró la columna de Waybill Number, necesaria para deduplicar eventos del mismo paquete.",
    );
  if (!statusKey)
    throw new Error(
      "No se encontró la columna de Task Status, necesaria para aplicar las reglas de estado (excluir cancelados).",
    );

  const events: RawEvent[] = [];
  let skipped = 0;
  for (const row of json) {
    const zip = normalizeZip(row[zipKey]);
    const date = toISODate(row[dateKey]);
    const waybill = String(row[waybillKey] ?? "").trim();
    if (!zip || !date || !waybill) {
      skipped++;
      continue;
    }
    const dsp = dspKey ? String(row[dspKey] ?? "").trim() : "";
    const dspName = dsp || "Desconocido";
    const { bucket, priority } = classifyStatus(row[statusKey]);
    events.push({ waybill, date, zip, dsp: dspName, bucket, priority });
  }

  const winners = new Map<string, RawEvent>();
  for (const ev of events) {
    const key = `${ev.waybill}|${ev.date}`;
    const existing = winners.get(key);
    if (!existing || ev.priority >= existing.priority) {
      winners.set(key, ev);
    }
  }
  const duplicateEvents = events.length - winners.size;

  const map = new Map<string, EpodDailyRow>();
  const days = new Set<string>();
  let totalParcels = 0;
  let excludedCancelled = 0;
  for (const ev of winners.values()) {
    if (ev.bucket === "cancel") {
      excludedCancelled++;
      continue;
    }
    days.add(ev.date);
    totalParcels++;
    const key = `${ev.zip}|${ev.dsp}|${ev.date}`;
    const existing = map.get(key);
    if (existing) {
      existing.parcels += 1;
    } else {
      map.set(key, {
        zip_code: ev.zip,
        dsp_name: ev.dsp,
        task_date: ev.date,
        parcels: 1,
        locality: inferLocality(ev.zip),
      });
    }
  }

  return {
    rows: [...map.values()],
    totalParcels,
    days: [...days].sort(),
    skipped,
    excludedCancelled,
    duplicateEvents,
  };
}
