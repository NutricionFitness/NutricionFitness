"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Red de seguridad.
 *
 * Sin esto, una excepción en cualquier componente de cliente deja la pantalla en
 * blanco y el único rastro está en la consola del navegador. Pasó al crear la
 * primera dieta: la pantalla se cayó entera y el mensaje solo se veía abriendo
 * las herramientas de desarrollo.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ maxWidth: 560, margin: "40px auto" }}>
      <h1>Algo ha fallado</h1>
      <p className="sub">
        La página no ha podido dibujarse. Tus datos no se han tocado.
      </p>

      <div className="tarjeta rejilla">
        <code style={{ fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {error.message || "Error desconocido"}
        </code>
        {error.digest && (
          <small className="suave">Referencia: {error.digest}</small>
        )}
        <div className="fila">
          <button className="principal" onClick={reset}>
            Reintentar
          </button>
          <Link href="/personas">Volver a personas</Link>
        </div>
      </div>
    </div>
  );
}
