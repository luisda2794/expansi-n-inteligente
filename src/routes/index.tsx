import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function EpodPage() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sortKey, setSortKey] = useState<"zip" | "avg">("avg");
  const [sortAsc, setSortAsc] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [selected, setSelected] = useState<{ zip: string; dsp: string } | null>(null);

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

      for (let i = 0; i < parsed.rows.length; i += 500) {
        const { error } = await supabase
          .from("epod_daily")
          .upsert(parsed.rows.slice(i, i + 500), { onConflict: "zip_code,dsp_name,task_date" });
        if (error) throw error;
      }
      return parsed;
    },
    onSuccess: (parsed) => {
      const zips = new Set(parsed.rows.map((r) => r.zip_code)).size;
      let msg = `EPOD procesado: ${parsed.totalParcels} paquetes, ${parsed.days.length} día(s), ${zips} CP.`;
      if (parsed.excludedCancelled > 0) {
        msg += ` ${parsed.excludedCancelled} cancelado(s) excluido(s).`;
      }
      if (parsed.duplicateEvents > 0) {
        msg += ` ${parsed.duplicateEvents} evento(s) duplicado(s) del mismo waybill/día colapsados.`;
      }
      toast.success(msg);
      queryClient.invalidateQueries({ queryKey: ["epod_daily"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filteredRecords = useMemo(() => {
    if (!dateFrom && !dateTo) return records;
    return records.filter(
      (r) => (!dateFrom || r.task_date >= dateFrom) && (!dateTo || r.task_date <= dateTo),
    );
  }, [records, dateFrom, dateTo]);

  const summary = useMemo<Summary[]>(() => {
    const map = new Map<string, Summary & { dayset: Set<string> }>();
    for (const r of filteredRecords) {
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
  }, [filteredRecords]);

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

  const applyPreset = (preset: "all" | "last7" | "prevWeek") => {
    const today = new Date();
    if (preset === "all") {
      setDateFrom("");
      setDateTo("");
    } else if (preset === "last7") {
      setDateFrom(toIso(addDays(today, -6)));
      setDateTo(toIso(today));
    } else {
      setDateFrom(toIso(addDays(today, -13)));
      setDateTo(toIso(addDays(today, -7)));
    }
  };

  const exportToExcel = () => {
    if (sorted.length === 0) {
      toast.error("No hay datos para exportar.");
      return;
    }
    const data = sorted.map((r) => ({
      "Código Postal": r.zip,
      "Empresa / DSP": r.dsp,
      Localidad: r.locality,
      "Volumen medio diario": Number(r.avg.toFixed(2)),
      "Días con actividad": r.days,
      "Total paquetes": r.total,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resumen CP");
    const suffix = dateFrom || dateTo ? `_${dateFrom || "inicio"}_a_${dateTo || "hoy"}` : "";
    XLSX.writeFile(wb, `expansion-rutas-resumen${suffix}.xlsx`);
  };

  const chartData = useMemo(() => {
    if (!selected) return [];
    return records
      .filter((r) => r.zip_code === selected.zip && r.dsp_name === selected.dsp)
      .sort((a, b) => a.task_date.localeCompare(b.task_date))
      .map((r) => ({ date: r.task_date, parcels: r.parcels }));
  }, [records, selected]);

  const totalDays = new Set(filteredRecords.map((r) => r.task_date)).size;
  const totalParcels = filteredRecords.reduce((s, r) => s + r.parcels, 0);
  const dsps = new Set(filteredRecords.map((r) => r.dsp_name)).size;

  const stats = [
    { label: "Códigos postales", value: new Set(filteredRecords.map((r) => r.zip_code)).size },
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
                Se detectan automáticamente CP, DSP, waybill y estado, en inglés o español. Volver a
                subir el mismo fichero es seguro: los valores se sobrescriben, no se suman.
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

      <section className="panel mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => applyPreset("all")}>
              Todo el histórico
            </Button>
            <Button size="sm" variant="outline" onClick={() => applyPreset("last7")}>
              Últimos 7 días
            </Button>
            <Button size="sm" variant="outline" onClick={() => applyPreset("prevWeek")}>
              Semana anterior
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="from" className="text-xs">
                Desde
              </Label>
              <Input
                id="from"
                type="date"
                className="h-9"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to" className="text-xs">
                Hasta
              </Label>
              <Input
                id="to"
                type="date"
                className="h-9"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={exportToExcel} className="ml-auto">
            <Download className="size-4" />
            Exportar a Excel
          </Button>
        </div>
      </section>

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
              <TableRow
                key={`${row.zip}-${row.dsp}`}
                className="cursor-pointer"
                onClick={() => setSelected({ zip: row.zip, dsp: row.dsp })}
              >
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

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Evolución diaria — CP {selected?.zip} · {selected?.dsp}
            </DialogTitle>
            <DialogDescription>
              Volumen de paquetes por día en todo el histórico disponible.
            </DialogDescription>
          </DialogHeader>
          <div className="h-72 w-full">
            {chartData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No hay datos suficientes para mostrar la evolución.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(value: number) => [value, "Paquetes"]}
                    labelFormatter={(label) => `Fecha: ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="parcels"
                    stroke="var(--color-primary)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
