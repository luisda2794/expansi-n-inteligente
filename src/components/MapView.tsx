import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import type { GeoJSON as LeafletGeoJSON, Layer, PathOptions, LeafletMouseEvent } from "leaflet";
import "leaflet/dist/leaflet.css";
import { colorForCompany } from "@/lib/company-colors";

export type CpInfo = {
  zip: string;
  dsp: string;
  locality: string;
  avg: number;
};

export type ExpansionInfo = {
  zip: string;
  locality: string;
  volume: number;
  company: string | null;
  notes: string | null;
};

type GeoFeature = { type: "Feature"; properties: Record<string, unknown> | null; geometry: unknown };
type GeoFC = { type: "FeatureCollection"; features: GeoFeature[] };

export type MapViewProps = {
  coverage: GeoFC;
  cpInfoByZip: Map<string, CpInfo>;
  expansion: GeoFC | null;
  expansionInfoByZip: Map<string, ExpansionInfo>;
  activeCompany: string | null;
};

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c]!);
}

function zipOf(feature: GeoFeature): string {
  return String(feature.properties?.["COD_POSTAL"] ?? "").padStart(5, "0");
}

function FitBounds({ data }: { data: GeoFC }) {
  const map = useMap();
  useEffect(() => {
    if (!data.features.length) return;
    try {
      const layer = L.geoJSON(data as never);
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
    } catch {
      // Si algún polígono viene mal formado, mantenemos la vista por defecto.
    }
  }, [data, map]);
  return null;
}

function CoverageLayer({
  data,
  cpInfoByZip,
  activeCompany,
}: {
  data: GeoFC;
  cpInfoByZip: Map<string, CpInfo>;
  activeCompany: string | null;
}) {
  const layerRef = useRef<LeafletGeoJSON | null>(null);

  const styleFor = (feature?: GeoFeature): PathOptions => {
    const info = feature ? cpInfoByZip.get(zipOf(feature)) : undefined;
    const color = info ? colorForCompany(info.dsp) : "#94a3b8";
    const dimmed = Boolean(activeCompany) && info?.dsp !== activeCompany;
    return {
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: dimmed ? 0.08 : 0.55,
      opacity: dimmed ? 0.25 : 0.9,
    };
  };

  useEffect(() => {
    layerRef.current?.setStyle(styleFor as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompany, cpInfoByZip]);

  const onEachFeature = (feature: GeoFeature, layer: Layer) => {
    const zip = zipOf(feature);
    const info = cpInfoByZip.get(zip);
    layer.bindTooltip(
      `<div style="font-size:12px;line-height:1.5">
        <strong>${escapeHtml(zip)}</strong><br/>
        ${escapeHtml(info?.locality || "—")}<br/>
        ${escapeHtml(info?.dsp || "—")}<br/>
        Vol. medio diario: ${info ? info.avg.toLocaleString("es-ES", { maximumFractionDigits: 1 }) : "—"}
      </div>`,
      { sticky: true },
    );
    layer.on("mouseover", () => (layer as unknown as { setStyle: (s: PathOptions) => void }).setStyle({ weight: 3 }));
    layer.on("mouseout", () => layerRef.current?.resetStyle(layer as never));
    layer.on("click", (e: LeafletMouseEvent) => {
      const target = layer as unknown as { getBounds?: () => L.LatLngBounds };
      if (target.getBounds) e.target._map?.fitBounds(target.getBounds(), { padding: [24, 24] });
    });
  };

  return <GeoJSON ref={layerRef} data={data as never} style={styleFor as never} onEachFeature={onEachFeature as never} />;
}

function ExpansionLayer({
  data,
  expansionInfoByZip,
}: {
  data: GeoFC;
  expansionInfoByZip: Map<string, ExpansionInfo>;
}) {
  const style = (): PathOptions => ({
    color: "#334155",
    weight: 2,
    dashArray: "5 4",
    fillOpacity: 0,
  });

  const onEachFeature = (feature: GeoFeature, layer: Layer) => {
    const zip = zipOf(feature);
    const info = expansionInfoByZip.get(zip);
    layer.bindTooltip(
      `<div style="font-size:12px;line-height:1.5">
        <strong>${escapeHtml(zip)} (candidato)</strong><br/>
        ${escapeHtml(info?.locality || "—")}<br/>
        Vol. estimado: ${info ? info.volume.toLocaleString("es-ES", { maximumFractionDigits: 1 }) : "—"}
        ${info?.company ? `<br/>Empresa actual: ${escapeHtml(info.company)}` : ""}
      </div>`,
      { sticky: true },
    );
  };

  return <GeoJSON data={data as never} style={style as never} onEachFeature={onEachFeature as never} />;
}

export function MapView({ coverage, cpInfoByZip, expansion, expansionInfoByZip, activeCompany }: MapViewProps) {
  return (
    <MapContainer center={[40.2, -3.7]} zoom={6} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <CoverageLayer data={coverage} cpInfoByZip={cpInfoByZip} activeCompany={activeCompany} />
      {expansion && <ExpansionLayer data={expansion} expansionInfoByZip={expansionInfoByZip} />}
      <FitBounds data={coverage} />
    </MapContainer>
  );
}
