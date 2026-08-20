import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { AlertTriangle, Download, MapPinned } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { colorForCompany } from "@/lib/company-colors";
import { resolveZipCoords } from "@/lib/geo/geocode";
import { clusterPoints, type Area, type ClusterPoint } from "@/lib/geo/cluster";
import type { MapViewProps } from "@/components/MapView";

export const Route = createFileRoute("/mapa")({
  head: () => ({
    meta: [
      { title: "Mapa de cobertura | EXPANSIÓN RUTAS" },
      {
        name: "description",
        content:
          "Mapa de códigos postales por empresa/DSP con agrupación geográfica en áreas y volumen diario acumulado.",
      },
      { property: "og:title", content: "Mapa de cobertura | EXPANSIÓN RUTAS" },
      { property: "og:description", content: "Puntos de CP por empresa, áreas geográficas y volumen total." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MapaPage,
});

type EpodRow = { zip_code: string; dsp_name: string; task_date: string; parcels: number; locality: string | null };
type ExpansionRow = {
  zip_code: string;
  locality: string | null;
  estimated_daily_volume: number;
  current_company: string | null;
  notes: string | null;
};

const EXPANSION_LABEL = "Expansión (sin empresa)";

function MapaPage() {
  const [MapView, setMapView] = useState<ComponentType<MapViewProps> | null>(null);
  const [activeCompany, setActiveCompany] = useState<string | null>(null);
  const [showExpansion, setShowExpansion] = useState(true);
  const [showAreas, setShowAreas] = useState(true);
  const [thresholdKm, setThresholdKm] = useState(6);

  const [coords, setCoords] = useState<Map<string, { lat: number; lon: number }>>(new Map());
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoProgress, setGeoProgress] = useState<{ done: number; total: number } | null>(null);
  const [missingZips, setMissingZips] = useState<string[]>([]);

  useEffect(() => {
    // Leaflet toca `window`/`document`: solo se importa en cliente.
    import("@/components/MapView").then((mod) => setMapView(() => mod.MapView));
  }, []);

  const { data: epodRecords = [] } = useQuery({
    queryKey: ["epod_daily"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("epod_daily")
        .select("zip_code, dsp_name, task_date, parcels, locality")
        .limit(20000);
      if (error) throw error;
      return (data ?? []) as EpodRow[];
    },
  });

  const { data: expansionRecords = [] } = useQuery({
    queryKey: ["expansion_zips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expansion_zips")
        .select("zip_code, locality, estimated_daily_volume, current_company, notes");
      if (error) throw error;
      return (data ?? []) as ExpansionRow[];
    },
  });

  // Empresa "actual" de cada CP = la de mayor volumen TOTAL acumulado en ese CP.
  const epodByZip = useMemo(() => {
    const byPair = new Map<string, { zip: string; dsp: string; total: number; days: Set<string>; locality: string }>();
    for (const r of epodRecords) {
      const key = `${r.zip_code}|${r.dsp_name}`;
      let entry = byPair.get(key);
      if (!entry) {
        entry = { zip: r.zip_code, dsp: r.dsp_name, total: 0, days: new Set(), locality: r.locality ?? "—" };
        byPair.set(key, entry);
      }
      entry.total += r.parcels;
      entry.days.add(r.task_date);
    }
    const byZip = new Map<string, { zip: string; dsp: string; locality: string; avg: number; total: number }>();
    for (const e of byPair.values()) {
      const avg = e.days.size ? e.total / e.days.size : 0;
      const prev = byZip.get(e.zip);
      if (!prev || e.total > prev.total) {
        byZip.set(e.zip, { zip: e.zip, dsp: e.dsp, locality: e.locality, avg, total: e.total });
      }
    }
    return byZip;
  }, [epodRecords]);

  const basePoints = useMemo(() => {
    const list: Omit<ClusterPoint, "lat" | "lon">[] = [];
    for (const e of epodByZip.values()) {
      list.push({ zip: e.zip, company: e.dsp, locality: e.locality, volume: e.avg, source: "epod" });
    }
    if (showExpansion) {
      for (const r of expansionRecords) {
        if (epodByZip.has(r.zip_code)) continue;
        list.push({
          zip: r.zip_code,
          company: r.current_company?.trim() || EXPANSION_LABEL,
          locality: r.locality ?? "—",
          volume: Number(r.estimated_daily_volume) || 0,
          source: "expansion",
        });
      }
    }
    return list;
  }, [epodByZip, expansionRecords, showExpansion]);

  const zipKey = useMemo(() => basePoints.map((p) => p.zip).sort().join(","), [basePoints]);

  useEffect(() => {
    if (!zipKey) {
      setCoords(new Map());
      setMissingZips([]);
      return;
    }
    let cancelled = false;
    const zips = zipKey.split(",");
    setGeoLoading(true);
    setGeoProgress({ done: 0, total: zips.length });
    (async () => {
      const resolved = await resolveZipCoords(zips, (done, total) => {
        if (!cancelled) setGeoProgress({ done, total });
      });
      if (cancelled) return;
      setCoords(new Map([...resolved].map(([z, c]) => [z, { lat: c.lat, lon: c.lon }])));
      setMissingZips(zips.filter((z) => !resolved.has(z)));
      setGeoLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [zipKey]);

  const points: ClusterPoint[] = useMemo(
    () =>
      basePoints.flatMap((p) => {
        const c = coords.get(p.zip);
        return c ? [{ ...p, lat: c.lat, lon: c.lon }] : [];
      }),
    [basePoints, coords],
  );

  const areas: Area[] = useMemo(() => clusterPoints(points, thresholdKm), [points, thresholdKm]);

  const companySummary = useMemo(() => {
    const map = new Map<string, { company: string; count: number; volume: number }>();
    for (const p of points) {
      const entry = map.get(p.company) ?? { company: p.company, count: 0, volume: 0 };
      entry.count += 1;
      entry.volume += p.volume;
      map.set(p.company, entry);
    }
    return [...map.values()].sort((a, b) => b.volume - a.volume);
  }, [points]);

  const exportExcel = () => {
    const resumen = areas.map((a) => ({
      Área: a.name,
      "Nº de CPs": a.points.length,
      "Volumen total": Number(a.volume.toFixed(1)),
      "Empresa(s) presentes": a.companies.join(", "),
      CPs: a.zips.join(", "),
    }));
    const detalle = areas.flatMap((a) =>
      a.points.map((p) => ({
        Área: a.name,
        CP: p.zip,
        Localidad: p.locality,
        "Empresa/DSP": p.company,
        "Volumen diario": Number(p.volume.toFixed(1)),
        Origen: p.source === "epod" ? "EPOD" : "Expansión",
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), "Áreas");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalle), "Detalle CPs");
    XLSX.writeFile(wb, `areas-expansion-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const nf = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 });

  return (
    <AppLayout
      title="Mapa de cobertura"
      subtitle="Códigos postales geolocalizados por empresa/DSP y agrupados en áreas por cercanía."
    >
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-3">
          <div className="panel space-y-3 p-4">
            <h2 className="text-sm font-semibold text-foreground">Agrupación en áreas</h2>
            <label className="block text-xs text-muted-foreground">
              Distancia máxima entre CPs (km)
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={thresholdKm}
                onChange={(e) => setThresholdKm(Math.max(0.5, Number(e.target.value) || 0.5))}
                className="num mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={showAreas}
                onChange={(e) => setShowAreas(e.target.checked)}
                className="size-4"
              />
              Mostrar áreas en el mapa
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={showExpansion}
                onChange={(e) => setShowExpansion(e.target.checked)}
                className="size-4"
              />
              Incluir CPs de expansión
            </label>
            <p className="text-xs text-muted-foreground">
              {points.length} CP en el mapa · {areas.length} áreas
            </p>
          </div>

          <div className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Leyenda · Empresas / DSP</h2>
            {companySummary.length === 0 && (
              <p className="text-sm text-muted-foreground">Sube un EPOD o añade CPs de expansión.</p>
            )}
            <div className="space-y-2">
              {companySummary.map((c) => {
                const active = activeCompany === c.company;
                return (
                  <button
                    key={c.company}
                    type="button"
                    onClick={() => setActiveCompany(active ? null : c.company)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      active ? "border-primary bg-secondary" : "border-border hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colorForCompany(c.company) }}
                      />
                      <span className="text-sm font-medium text-foreground">{c.company}</span>
                    </div>
                    <div className="num mt-1 flex justify-between text-xs text-muted-foreground">
                      <span>{c.count} CP</span>
                      <span>{nf(c.volume)} paq./día</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              ● círculo = CP del EPOD · ■ cuadrado = CP de expansión manual
            </p>
          </div>

          {missingZips.length > 0 && (
            <div className="panel flex gap-2 p-3 text-xs text-muted-foreground">
              <AlertTriangle className="size-4 shrink-0 text-accent" />
              <span>
                {missingZips.length} CP sin coordenadas encontradas: {missingZips.join(", ")}
              </span>
            </div>
          )}
        </aside>

        <section className="panel relative overflow-hidden" style={{ height: "70vh" }}>
          {geoLoading && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-background/60 text-sm text-muted-foreground">
              Geolocalizando CPs… {geoProgress ? `${geoProgress.done}/${geoProgress.total}` : ""}
            </div>
          )}
          {MapView ? (
            <MapView points={points} areas={areas} activeCompany={activeCompany} showAreas={showAreas} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <MapPinned className="mr-2 size-4" /> Cargando mapa…
            </div>
          )}
        </section>
      </div>

      <div className="panel mt-6 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Resumen de áreas</h2>
          <button
            type="button"
            onClick={exportExcel}
            disabled={areas.length === 0}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            <Download className="size-4" />
            Exportar a Excel
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4">Área</th>
                <th className="py-2 pr-4">Nº de CPs</th>
                <th className="py-2 pr-4">Volumen total</th>
                <th className="py-2 pr-4">Empresa(s) presentes</th>
                <th className="py-2">CPs</th>
              </tr>
            </thead>
            <tbody>
              {areas.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    Sin áreas todavía.
                  </td>
                </tr>
              )}
              {areas.map((a) => (
                <tr key={a.id} className="border-b border-border/60">
                  <td className="py-2 pr-4 font-medium text-foreground">{a.name}</td>
                  <td className="num py-2 pr-4">{a.points.length}</td>
                  <td className="num py-2 pr-4 font-semibold text-foreground">{nf(a.volume)}</td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {a.companies.map((c) => (
                        <span
                          key={c}
                          className="rounded-full px-2 py-0.5 text-xs text-white"
                          style={{ backgroundColor: colorForCompany(c) }}
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num py-2 text-xs text-muted-foreground">{a.zips.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
