import { useEffect, useState } from "react";
import { loadProvinceGeoJson, filterByZips } from "@/lib/geo/provinces";

export type PostalBoundary = {
  zip: string;
  geometry: unknown;
};

type BoundaryState = {
  boundaries: Map<string, PostalBoundary>;
  loading: boolean;
};

export function usePostalBoundaries(zips: string[]): BoundaryState {
  const key = [...new Set(zips)].sort().join(",");
  const [state, setState] = useState<BoundaryState>({ boundaries: new Map(), loading: false });

  useEffect(() => {
    const unique = [...new Set(zips)].filter((z) => /^\d{5}$/.test(z));
    if (unique.length === 0) {
      setState({ boundaries: new Map(), loading: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ boundaries: prev.boundaries, loading: true }));

    const byPrefix = new Map<string, string[]>();
    for (const zip of unique) {
      const prefix = zip.slice(0, 2);
      const list = byPrefix.get(prefix) ?? [];
      list.push(zip);
      byPrefix.set(prefix, list);
    }

    (async () => {
      const boundaries = new Map<string, PostalBoundary>();
      await Promise.all(
        [...byPrefix.entries()].map(async ([prefix, prefixZips]) => {
          try {
            const fc = await loadProvinceGeoJson(prefix);
            const { collection } = filterByZips(fc, new Set(prefixZips));
            for (const feature of collection.features) {
              const cp = String(feature.properties?.["COD_POSTAL"] ?? "").padStart(5, "0");
              if (cp) boundaries.set(cp, { zip: cp, geometry: feature.geometry });
            }
          } catch {
            // Provincia sin geojson disponible: esos CP quedan sin polígono
            // y el caller cae al marcador de punto para ellos.
          }
        }),
      );
      if (!cancelled) setState({ boundaries, loading: false });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
