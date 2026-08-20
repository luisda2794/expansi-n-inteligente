import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Circle, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { colorForCompany } from "@/lib/company-colors";
import type { Area, ClusterPoint } from "@/lib/geo/cluster";

export type MapViewProps = {
  points: ClusterPoint[];
  areas: Area[];
  activeCompany: string | null;
  showAreas: boolean;
};

const AREA_COLOR = "#0f766e";

function squareIcon(color: string, dimmed: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<span style="display:block;width:14px;height:14px;background:${color};border:2px solid #0f172a;opacity:${
      dimmed ? 0.25 : 1
    }"></span>`,
  });
}

function FitBounds({ points }: { points: ClusterPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
  }, [points, map]);
  return null;
}

function PointPopup({ p }: { p: ClusterPoint }) {
  return (
    <Popup>
      <div style={{ fontSize: 12, lineHeight: 1.6 }}>
        <strong>{p.zip}</strong>
        <br />
        {p.locality || "—"}
        <br />
        {p.company}
        <br />
        Volumen diario: {p.volume.toLocaleString("es-ES", { maximumFractionDigits: 1 })}
        <br />
        <em>{p.source === "epod" ? "EPOD" : "Expansión (manual)"}</em>
      </div>
    </Popup>
  );
}

export function MapView({ points, areas, activeCompany, showAreas }: MapViewProps) {
  return (
    <MapContainer center={[40.2, -3.7]} zoom={6} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {showAreas &&
        areas.map((a) => (
          <Circle
            key={`area-${a.id}`}
            center={[a.center.lat, a.center.lon]}
            radius={a.radiusMeters}
            pathOptions={{ color: AREA_COLOR, weight: 2, dashArray: "6 4", fillColor: AREA_COLOR, fillOpacity: 0.08 }}
          >
            <Popup>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                <strong>{a.name}</strong>
                <br />
                {a.points.length} CP · Vol. total {a.volume.toLocaleString("es-ES", { maximumFractionDigits: 1 })}
                <br />
                Empresas: {a.companies.join(", ")}
                <br />
                CPs: {a.zips.join(", ")}
              </div>
            </Popup>
          </Circle>
        ))}

      {points.map((p) => {
        const color = colorForCompany(p.company);
        const dimmed = Boolean(activeCompany) && p.company !== activeCompany;
        if (p.source === "expansion") {
          return (
            <Marker key={`exp-${p.zip}`} position={[p.lat, p.lon]} icon={squareIcon(color, dimmed)}>
              <PointPopup p={p} />
            </Marker>
          );
        }
        return (
          <CircleMarker
            key={`epod-${p.zip}`}
            center={[p.lat, p.lon]}
            radius={7}
            pathOptions={{
              color: "#0f172a",
              weight: 1.5,
              fillColor: color,
              fillOpacity: dimmed ? 0.15 : 0.9,
              opacity: dimmed ? 0.25 : 1,
            }}
          >
            <PointPopup p={p} />
          </CircleMarker>
        );
      })}

      <FitBounds points={points} />
    </MapContainer>
  );
}
