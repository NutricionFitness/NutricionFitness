import type { Metadata } from "next";
import Link from "next/link";

import { salir } from "./login/acciones";
import { usuarioActual } from "@/lib/supabase/servidor";
import "./globals.css";

export const metadata: Metadata = {
  title: "App Nutrición",
  description: "Ajuste de dietas por objetivo de kilocalorías",
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioActual();

  return (
    <html lang="es">
      <body>
        <header className="barra">
          <div>
            <strong>App Nutrición</strong>
            {usuario && (
              <nav>
                <Link href="/personas">Personas</Link>
                <Link href="/ingredientes">Ingredientes</Link>
                <Link href="/cuenta" className="suave">
                  {usuario.email}
                </Link>
                <form action={salir}>
                  <button className="enlace">Salir</button>
                </form>
              </nav>
            )}
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
