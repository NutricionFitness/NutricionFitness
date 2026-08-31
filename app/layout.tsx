import type { Metadata } from "next";
import Link from "next/link";

import CambiarTema from "@/components/CambiarTema";
import { salir } from "./login/acciones";
import { usuarioActual } from "@/lib/supabase/servidor";
import "./globals.css";

export const metadata: Metadata = {
  title: "App Nutrición",
  description: "Ajuste de dietas por objetivo de kilocalorías",
};

/**
 * El tema, antes de pintar.
 *
 * Si la elección guardada se aplicara desde React, la primera pintura saldría
 * con el tema del sistema y cambiaría de golpe al hidratar. Este trozo corre
 * antes de que se pinte nada; en `try` porque en una ventana privada leer
 * `localStorage` lanza excepción, y entonces manda el sistema, que es lo
 * correcto.
 */
const TEMA_TEMPRANO = `try{var t=localStorage.getItem("tema");if(t==="claro"||t==="oscuro")document.documentElement.dataset.tema=t}catch(e){}`;

export default async function Layout({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioActual();

  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: TEMA_TEMPRANO }} />
      </head>
      <body>
        <header className="barra">
          <div>
            <Link
              href={usuario ? "/personas" : "/comparador"}
              className="marca"
              aria-label="App Nutrición"
            >
              {/* El logo va como <img> y no por `next/image`: mide 24 px fijos, nunca
                  se redimensiona y no hay nada que optimizar. El nombre accesible
                  del enlace lo pone el `aria-label` de arriba y no este `alt`,
                  porque por debajo de 480 px `.marca-nombre` se esconde y el
                  enlace se quedaría sin nombre. */}
              <img src="/logo.png" alt="" width={24} height={24} />
              <span className="marca-nombre">App Nutrición</span>
            </Link>

            <nav>
              {/* El comparador es público: sale con sesión y sin ella, porque
                  para eso se ha hecho. */}
              <Link href="/comparador">Comparador</Link>
              {usuario && (
                <>
                  <Link href="/personas">Personas</Link>
                  <Link href="/ingredientes">Ingredientes</Link>
                  <Link href="/plantillas">Plantillas</Link>
                  <Link href="/cuenta" className="barra-correo">
                    {usuario.email}
                  </Link>
                  <form action={salir}>
                    <button className="enlace" style={{ padding: "6px 10px" }}>
                      Salir
                    </button>
                  </form>
                </>
              )}
              <CambiarTema />
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
