export type ClusterPoint = {
  zip: string;
  lat: number;
  lon: number;
  company: string;
  volume: number;
  locality: string;
  source: "epod" | "expansion";
};

export type Area = {
  id: number;
  name: string;
  points: ClusterPoint[];
  center: { lat: number; lon: number };
  radiusMeters: number;
  volume: number;
  companies: string[];
  zips: string[];
};

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Clustering de enlace simple: dos CP están en la misma área si su distancia
 * haversine es menor que `thresholdKm` (transitivo, vía union-find).
 */
export function clusterPoints(points: ClusterPoint[], thresholdKm: number): Area[] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (haversineKm(points[i]!, points[j]!) <= thresholdKm) union(i, j);
    }
  }

  const groups = new Map<number, ClusterPoint[]>();
  points.forEach((p, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(p);
    groups.set(root, list);
  });

  const areas: Area[] = [...groups.values()].map((pts) => {
    const center = {
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length,
    };
    const maxDist = pts.reduce((m, p) => Math.max(m, haversineKm(center, p)), 0);
    const companies = [...new Set(pts.map((p) => p.company))].sort();
    return {
      id: 0,
      name: "",
      points: pts,
      center,
      radiusMeters: Math.max(maxDist * 1000 + 600, 900),
      volume: pts.reduce((s, p) => s + p.volume, 0),
      companies,
      zips: pts.map((p) => p.zip).sort(),
    };
  });

  areas.sort((a, b) => b.volume - a.volume);
  return areas.map((a, i) => ({ ...a, id: i + 1, name: `Área ${i + 1}` }));
}
