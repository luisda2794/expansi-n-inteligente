import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Map, MapPinned, Upload, Route as RouteIcon } from "lucide-react";

const navItems = [
  { to: "/", label: "Subir EPOD", icon: Upload },
  { to: "/mapa", label: "Mapa de cobertura", icon: Map },
  { to: "/expansion", label: "CPs de expansión", icon: MapPinned },
] as const;

export function AppLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-sidebar">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <RouteIcon className="size-5" />
            </span>
            <div>
              <p className="text-base font-semibold tracking-tight text-sidebar-foreground">
                EXPANSIÓN RUTAS
              </p>
              <p className="text-xs text-sidebar-foreground/60">
                Análisis de última milla y planificación geográfica
              </p>
            </div>
          </div>
          <nav className="flex gap-1">
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-foreground"
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {children}
      </main>
    </div>
  );
}
