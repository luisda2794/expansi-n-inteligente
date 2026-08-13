import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseEpodFile, type EpodDailyRow } from "@/lib/epod-parse";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Subir EPOD | EXPANSIÓN RUTAS" },
      {
        name: "description",
        content:
          "Sube ficheros EPOD en Excel y obtén el volumen medio diario de paquetes por código postal y empresa de reparto.",
      },
      { property: "og:title", content: "Subir EPOD | EXPANSIÓN RUTAS" },
      {
        property: "og:description",
        content: "Análisis automático de códigos postales, DSP y volumen medio diario de última milla.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EpodPage,
});

type Summary = {
  zip: string;
  dsp: string;
  locality: string;
  total: number;
  days: number;
  avg: number;
};

function EpodPage() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sortKey, setSortKey] = useState<"zip" | "avg">("avg");
  const [sortAsc, setSortAsc] = useState(false);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["epod_daily"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("epod_daily")
        .select("zip_code, dsp_name, task_date, parcels, locality")
        .order("task_date", { ascending: false })
        .limit(20000);
      if (error) throw error;
      return (data ?? []) as EpodDailyRow[];
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const parsed = await parseEpodFile(file);
      if (parsed.rows.length === 0) throw new Error("No se han encontrado filas válidas.");

      // Sumar con lo ya guardado para la misma combinación CP+DSP+día
      const keys = parsed.rows.map((r) => r.zip_code);
      const { data: existing, error: readError } = await supabase
        .from("epod_daily")
        .select("zip_code, dsp_name, task_date, parcels")
        .in("zip_code", [...new Set(keys)]);
      if (readError) throw readError;

      const existingMap = new Map(
        (existing ?? []).map((r) => [`${r.zip_code}|${r.dsp_name}|${r.task_date}`, r.parcels]),
      );

      const payload = parsed.rows.map((r) => ({
        ...r,
        parcels:
          r.parcels + (existingMap.get(`${r.zip_code}|${r.dsp_name}|${r.task_date}`) ?? 0),
      }));

      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabase
          .from("epod_daily")
          .upsert(payload.slice(i, i + 500), { onConflict: "zip_code,dsp_name,task_date" });
        if (error) throw error;
      }
      return parsed;
    },
    onSuccess: (parsed) => {
      toast.success(
        `EPOD procesado: ${parsed.totalParcels} paquetes, ${parsed.days.length} día(s), ${new Set(parsed.rows.map((r) => r.zip_code)).size} CP.`,
      );
      queryClient.invalidateQueries({ queryKey: ["epod_daily"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const summary = useMemo<Summary[]>(() => {
    const map = new Map<string, Summary & { dayset: Set<string> }>();
    for (const r of records) {
      const key = `${r.zip_code}|${r.dsp_name}`;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          zip: r.zip_code,
          dsp: r.dsp_name,
          locality: r.locality ?? "—",
          total: 0,
          days: 0,
          avg: 0,
          dayset: new Set<string>(),
        };
        map.set(key, entry);
      }
      entry.total += r.parcels;
      entry.dayset.add(r.task_date);
    }
    return [...map.values()].map((e) => ({
      zip: e.zip,
      dsp: e.dsp,
      locality: e.locality,
      total: e.total,
      days: e.dayset.size,
      avg: e.dayset.size ? e.total / e.dayset.size : 0,
    }));
  }, [records]);

  const sorted = useMemo(() => {
    const copy = [...summary];
    copy.sort((a, b) => {
      const diff = sortKey === "zip" ? a.zip.localeCompare(b.zip) : a.avg - b.avg;
      return sortAsc ? diff : -diff;
    });
    return copy;
  }, [summary, sortAsc, sortKey]);

  const toggleSort = (key: "zip" | "avg") => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === "zip");
    }
  };

  const totalDays = new Set(records.map((r) => r.task_date)).size;
  const totalParcels = records.reduce((s, r) => s + r.parcels, 0);
  const dsps = new Set(records.map((r) => r.dsp_name)).size;

  const stats = [
    { label: "Códigos postales", value: new Set(records.map((r) => r.zip_code)).size },
    { label: "Empresas / DSP", value: dsps },
    { label: "Días distintos", value: totalDays },
    { label: "Paquetes acumulados", value: totalParcels },
  ];

  return (
    <AppLayout
      title="Subir EPOD"
      subtitle="Sube ficheros EPOD (.xlsx) de Cainiao. El histórico se acumula automáticamente."
    >
      <section className="panel mb-6 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-10 items-center justify-center rounded-md bg-secondary text-primary">
              <FileSpreadsheet className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">Fichero EPOD (.xlsx / .xls / .csv)</p>
              <p className="text-sm text-muted-foreground">
                Se detectan automáticamente CP, DSP y fecha, en inglés o español.
              </p>
            </div>
          </div>
          <div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
                e.target.value = "";
              }}
            />
            <Button onClick={() => inputRef.current?.click()} disabled={uploadMutation.isPending}>
              {uploadMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {uploadMutation.isPending ? "Procesando…" : "Seleccionar archivo"}
            </Button>
          </div>
        </div>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="panel p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {s.label}
            </p>
            <p className="num mt-1 text-2xl font-semibold text-foreground">
              {s.value.toLocaleString("es-ES")}
            </p>
          </div>
        ))}
      </div>

      <section className="panel overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Resumen por código postal ({sorted.length} combinaciones CP · DSP)
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort("zip")}
                >
                  CP <ArrowUpDown className="size-3" />
                </button>
              </TableHead>
              <TableHead>Empresa / DSP</TableHead>
              <TableHead>Localidad</TableHead>
              <TableHead className="text-right">
                <button
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => toggleSort("avg")}
                >
                  Vol. medio diario <ArrowUpDown className="size-3" />
                </button>
              </TableHead>
              <TableHead className="text-right">Días</TableHead>
              <TableHead className="text-right">Total paquetes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Cargando histórico…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Sube tu primer EPOD para ver el análisis por código postal.
                </TableCell>
              </TableRow>
            )}
            {sorted.map((row) => (
              <TableRow key={`${row.zip}-${row.dsp}`}>
                <TableCell className="num font-semibold">{row.zip}</TableCell>
                <TableCell>{row.dsp}</TableCell>
                <TableCell className="text-muted-foreground">{row.locality}</TableCell>
                <TableCell className="num text-right font-semibold">
                  {row.avg.toLocaleString("es-ES", { maximumFractionDigits: 1 })}
                </TableCell>
                <TableCell className="num text-right text-muted-foreground">{row.days}</TableCell>
                <TableCell className="num text-right">
                  {row.total.toLocaleString("es-ES")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </AppLayout>
  );
}
