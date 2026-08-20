import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "App Nutrición",
  description: "Ajuste de dietas por objetivo de kilocalorías",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="barra">
          <div>
            <strong>App Nutrición</strong>
            <nav>
              <Link href="/personas">Personas</Link>
              <Link href="/ingredientes">Ingredientes</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
