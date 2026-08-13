import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, MapPinned } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { colorForCompany } from "@/lib/company-colors";
import { loadProvinceGeoJson, filterByZips } from "@/lib/geo/provinces";
import type { CpInfo, ExpansionInfo, MapViewProps } from "@/components/MapView";

export const Route = createFileRoute("/mapa")({
  head: () => ({
    meta: [
      { title: "Mapa de cobertura | EXPANSIÓN RUTAS" },
      {
        name: "description",
        content: "Mapa interactivo de códigos postales coloreados por empresa/DSP, con volumen medio diario.",
      },
      { property: "og:title", content: "Mapa de cobertura | EXPANSIÓN RUTAS" },
      { property: "og:type", content: "website" },
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

type GeoFeature = { type: "Feature"; properties: Record<string, unknown> | null; geometry: unknown };
type GeoFC = { type: "FeatureCollection"; features: GeoFeature[] };
const EMPTY_FC: GeoFC = { type: "FeatureCollection", features: [] };

function MapaPage() {
  const [MapView, setMapView] = useState<ComponentType<MapViewProps> | null>(null);
  const [activeCompany, setActiveCompany] = useState<string | null>(null);
  const [showExpansion, setShowExpansion] = useState(false);

  const [coverageGeo, setCoverageGeo] = useState<GeoFC>(EMPTY_FC);
  const [expansionGeo, setExpansionGeo] = useState<GeoFC>(EMPTY_FC);
  const [missingZips, setMissingZips] = useState<string[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    // Leaflet toca `window`/`document`: solo se importa en cliente para no
    // romper el render en servidor (TanStack Start hace SSR por defecto).
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
    enabled: showExpansion,
  });

  const cpDspSummary = useMemo(() => {
    const map = new Map<string, { zip: string; dsp: string; total: number; days: Set<string>; locality: string }>();
    for (const r of epodRecords) {
      const key = `${r.zip_code}|${r.dsp_name}`;
      let entry = map.get(key);
      if (!entry) {
        entry = { zip: r.zip_code, dsp: r.dsp_name, total: 0, days: new Set(), locality: r.locality ?? "—" };
        map.set(key, entry);
      }
      entry.total += r.parcels;
      entry.days.add(r.task_date);
    }
    return [...map.values()].map((e) => ({
      zip: e.zip,
      dsp: e.dsp,
      locality: e.locality,
      total: e.total,
      avg: e.days.size ? e.total / e.days.size : 0,
    }));
  }, [epodRecords]);

  // Empresa "actual" de cada CP = la de mayor volumen TOTAL acumulado en ese CP.
  const cpInfoByZip = useMemo(() => {
    const byZip = new Map<string, typeof cpDspSummary>();
    for (const row of cpDspSummary) {
      const list = byZip.get(row.zip) ?? [];
      list.push(row);
      byZip.set(row.zip, list);
    }
    const result = new Map<string, CpInfo>();
    for (const [zip, rows] of byZip) {
      const winner = [...rows].sort((a, b) => b.total - a.total || a.dsp.localeCompare(b.dsp))[0]!;
      result.set(zip, { zip, dsp: winner.dsp, locality: winner.locality, avg: winner.avg });
    }
    return result;
  }, [cpDspSummary]);

  const companySummary = useMemo(() => {
    const map = new Map<string, { dsp: string; count: number; volume: number }>();
    for (const info of cpInfoByZip.values()) {
      const entry = map.get(info.dsp) ?? { dsp: info.dsp, count: 0, volume: 0 };
      entry.count += 1;
      entry.volume += info.avg;
      map.set(info.dsp, entry);
    }
    return [...map.values()].sort((a, b) => b.volume - a.volume);
  }, [cpInfoByZip]);

  const expansionInfoByZip = useMemo(() => {
    const result = new Map<string, ExpansionInfo>();
    for (const r of expansionRecords) {
      result.set(r.zip_code, {
        zip: r.zip_code,
        locality: r.locality ?? "—",
        volume: Number(r.estimated_daily_volume),
        company: r.current_company,
        notes: r.notes,
      });
    }
    return result;
  }, [expansionRecords]);

  useEffect(() => {
    let cancelled = false;
    const zips = new Set(cpInfoByZip.keys());
    if (zips.size === 0) {
      setCoverageGeo(EMPTY_FC);
      setMissingZips([]);
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    (async () => {
      try {
        const codes = new Set([...zips].map((z) => z.slice(0, 2)));
        const features: GeoFeature[] = [];
        const found = new Set<string>();
        for (const code of codes) {
          const fc = await loadProvinceGeoJson(code);
          const { collection, found: foundHere } = filterByZips(fc, zips);
          features.push(...collection.features);
          for (const z of foundHere) found.add(z);
        }
        if (cancelled) return;
        setCoverageGeo({ type: "FeatureCollection", features });
        const missing = [...zips].filter((z) => !found.has(z)).sort();
        setMissingZips(missing);
        if (missing.length > 0) {
          console.warn("CP sin polígono en el geojson de su provincia:", missing);
        }
      } catch (err) {
        if (!cancelled) setGeoError((err as Error).message);
      } finally {
        if (!cancelled) setGeoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cpInfoByZip]);

  useEffect(() => {
    if (!showExpansion) return;
    let cancelled = false;
    const zips = new Set(expansionInfoByZip.keys());
    if (zips.size === 0) {
      setExpansionGeo(EMPTY_FC);
      return;
    }
    (async () => {
      const codes = new Set([...zips].map((z) => z.slice(0, 2)));
      const features: GeoFeature[] = [];
      for (const code of codes) {
        try {
          const fc = await loadProvinceGeoJson(code);
          const { collection } = filterByZips(fc, zips);
          features.push(...collection.features);
        } catch (err) {
          console.warn("No se pudo cargar geometría de expansión para la provincia", code, err);
        }
      }
      if (!cancelled) setExpansionGeo({ type: "FeatureCollection", features });
    })();
    return () => {
      cancelled = true;
    };
  }, [showExpansion, expansionInfoByZip]);

  return (
    <AppLayout
      title="Mapa de cobertura"
      subtitle="Códigos postales coloreados por empresa/DSP, con volumen medio diario."
    >
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-3">
          <div className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Empresas / DSP</h2>
            {companySummary.length === 0 && (
              <p className="text-sm text-muted-foreground">Sube un EPOD para ver el reparto por empresa.</p>
            )}
            <div className="space-y-2">
              {companySummary.map((c) => {
                const active = activeCompany === c.dsp;
                return (
                  <button
                    key={c.dsp}
                    type="button"
                    onClick={() => setActiveCompany(active ? null : c.dsp)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      active ? "border-primary bg-secondary" : "border-border hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colorForCompany(c.dsp) }}
                      />
                      <span className="text-sm font-medium text-foreground">{c.dsp}</span>
                    </div>
                    <div className="num mt-1 flex justify-between text-xs text-muted-foreground">
                      <span>{c.count} CP</span>
                      <span>{c.volume.toLocaleString("es-ES", { maximumFractionDigits: 1 })} paq./día</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="panel flex items-center gap-2 p-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={showExpansion}
              onChange={(e) => setShowExpansion(e.target.checked)}
              className="size-4"
            />
            Mostrar CPs de expansión
          </label>

          {missingZips.length > 0 && (
            <div className="panel flex gap-2 p-3 text-xs text-muted-foreground">
              <AlertTriangle className="size-4 shrink-0 text-accent" />
              <span>
                {missingZips.length} CP sin polígono disponible en su provincia: {missingZips.join(", ")}
              </span>
            </div>
          )}
          {geoError && (
            <div className="panel p-3 text-xs text-destructive">Error cargando el mapa: {geoError}</div>
          )}
        </aside>

        <section className="panel relative overflow-hidden" style={{ height: "75vh" }}>
          {geoLoading && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-background/60 text-sm text-muted-foreground">
              Cargando geometrías…
            </div>
          )}
          {MapView ? (
            <MapView
              coverage={coverageGeo}
              cpInfoByZip={cpInfoByZip}
              expansion={showExpansion ? expansionGeo : null}
              expansionInfoByZip={expansionInfoByZip}
              activeCompany={activeCompany}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <MapPinned className="mr-2 size-4" /> Cargando mapa…
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
