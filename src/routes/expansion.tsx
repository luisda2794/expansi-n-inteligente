import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { inferLocality, normalizeZip } from "@/lib/spain-zip";

export const Route = createFileRoute("/expansion")({
  head: () => ({
    meta: [
      { title: "CPs de expansión | EXPANSIÓN RUTAS" },
      {
        name: "description",
        content:
          "Gestiona códigos postales candidatos a expansión con volumen estimado, empresa actual y notas.",
      },
      { property: "og:title", content: "CPs de expansión | EXPANSIÓN RUTAS" },
      {
        property: "og:description",
        content: "Añade, edita y ordena los códigos postales candidatos a expansión.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExpansionPage,
});

type ExpansionZip = {
  id: string;
  zip_code: string;
  locality: string | null;
  estimated_daily_volume: number;
  current_company: string | null;
  notes: string | null;
};

type FormState = {
  zip_code: string;
  locality: string;
  estimated_daily_volume: string;
  current_company: string;
  notes: string;
};

const emptyForm: FormState = {
  zip_code: "",
  locality: "",
  estimated_daily_volume: "",
  current_company: "",
  notes: "",
};

function ExpansionPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"zip" | "volume">("zip");
  const [sortAsc, setSortAsc] = useState(true);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["expansion_zips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expansion_zips")
        .select("id, zip_code, locality, estimated_daily_volume, current_company, notes");
      if (error) throw error;
      return (data ?? []) as ExpansionZip[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const zip = normalizeZip(form.zip_code);
      if (!zip) throw new Error("Introduce un código postal válido.");
      const volume = Number(form.estimated_daily_volume.replace(",", "."));
      if (!isFinite(volume) || volume < 0) throw new Error("Volumen diario no válido.");
      const payload = {
        zip_code: zip,
        locality: form.locality.trim() || inferLocality(zip),
        estimated_daily_volume: volume,
        current_company: form.current_company.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (editingId) {
        const { error } = await supabase
          .from("expansion_zips")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("expansion_zips").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "CP actualizado" : "CP añadido");
      setForm(emptyForm);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["expansion_zips"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("expansion_zips").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("CP eliminado");
      queryClient.invalidateQueries({ queryKey: ["expansion_zips"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const diff =
        sortKey === "zip"
          ? a.zip_code.localeCompare(b.zip_code)
          : Number(a.estimated_daily_volume) - Number(b.estimated_daily_volume);
      return sortAsc ? diff : -diff;
    });
    return copy;
  }, [rows, sortKey, sortAsc]);

  const totalVolume = rows.reduce((sum, r) => sum + Number(r.estimated_daily_volume), 0);

  const toggleSort = (key: "zip" | "volume") => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const startEdit = (row: ExpansionZip) => {
    setEditingId(row.id);
    setForm({
      zip_code: row.zip_code,
      locality: row.locality ?? "",
      estimated_daily_volume: String(row.estimated_daily_volume),
      current_company: row.current_company ?? "",
      notes: row.notes ?? "",
    });
  };

  return (
    <AppLayout
      title="CPs de expansión"
      subtitle="Códigos postales candidatos con volumen estimado introducido manualmente."
    >
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <section className="panel h-fit p-5">
          <h2 className="text-sm font-semibold text-foreground">
            {editingId ? "Editar CP" : "Añadir CP candidato"}
          </h2>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="zip">Código postal</Label>
              <Input
                id="zip"
                value={form.zip_code}
                maxLength={5}
                placeholder="28001"
                onChange={(e) => setForm({ ...form, zip_code: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc">Localidad</Label>
              <Input
                id="loc"
                value={form.locality}
                maxLength={100}
                placeholder="Se infiere del CP si lo dejas vacío"
                onChange={(e) => setForm({ ...form, locality: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vol">Volumen diario estimado</Label>
              <Input
                id="vol"
                inputMode="decimal"
                value={form.estimated_daily_volume}
                placeholder="120"
                onChange={(e) => setForm({ ...form, estimated_daily_volume: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company">Empresa actual (opcional)</Label>
              <Input
                id="company"
                value={form.current_company}
                maxLength={100}
                onChange={(e) => setForm({ ...form, current_company: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                rows={3}
                maxLength={1000}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={saveMutation.isPending}>
                <Plus className="size-4" />
                {editingId ? "Guardar cambios" : "Añadir CP"}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingId(null);
                    setForm(emptyForm);
                  }}
                >
                  <X className="size-4" />
                  Cancelar
                </Button>
              )}
            </div>
          </form>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Candidatos ({rows.length})
            </h2>
            <p className="num text-sm text-muted-foreground">
              Volumen total estimado: <span className="font-semibold text-foreground">
                {totalVolume.toLocaleString("es-ES", { maximumFractionDigits: 1 })}
              </span>{" "}
              paq./día
            </p>
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
                <TableHead>Localidad</TableHead>
                <TableHead className="text-right">
                  <button
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort("volume")}
                  >
                    Vol. diario est. <ArrowUpDown className="size-3" />
                  </button>
                </TableHead>
                <TableHead>Empresa actual</TableHead>
                <TableHead>Notas</TableHead>
                <TableHead className="w-24 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Cargando…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Todavía no has añadido ningún CP candidato.
                  </TableCell>
                </TableRow>
              )}
              {sorted.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="num font-semibold">{row.zip_code}</TableCell>
                  <TableCell>{row.locality ?? "—"}</TableCell>
                  <TableCell className="num text-right font-semibold">
                    {Number(row.estimated_daily_volume).toLocaleString("es-ES", {
                      maximumFractionDigits: 1,
                    })}
                  </TableCell>
                  <TableCell>{row.current_company ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {row.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(row)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(row.id)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>
    </AppLayout>
  );
}
