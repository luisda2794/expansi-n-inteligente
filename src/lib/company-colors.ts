const PALETTE = [
  "#2563eb",
  "#16a34a",
  "#f97316",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#ca8a04",
  "#db2777",
  "#4d7c0f",
  "#7c3aed",
  "#0d9488",
  "#b45309",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Color determinista por nombre de empresa/DSP, estable aunque se añadan o
// quiten empresas con el tiempo. Se reutiliza en el mapa y en el dashboard.
export function colorForCompany(name: string): string {
  const idx = hashString(name.trim().toLowerCase()) % PALETTE.length;
  return PALETTE[idx]!;
}
