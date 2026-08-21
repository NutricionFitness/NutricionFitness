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
            <Link href="/personas" className="marca">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect
                  x="1.6"
                  y="1.6"
                  width="20.8"
                  height="20.8"
                  rx="6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M6.6 15.4c3.1 0 4.9-1.4 5.7-3.1.9-2 .6-4.1.6-4.1s-2.2-.3-4 .6c-1.8.8-3.1 2.5-3.1 5.6"
                  fill="currentColor"
                  opacity=".9"
                />
                <path
                  d="M6 18c1.5-3.4 3.9-5.5 7.4-6.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span className="marca-nombre">App Nutrición</span>
            </Link>

            <nav>
              {usuario && (
                <>
                  <Link href="/personas">Personas</Link>
                  <Link href="/ingredientes">Ingredientes</Link>
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
