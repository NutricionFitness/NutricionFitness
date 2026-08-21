"use client";

import { useState, useTransition } from "react";

/**
 * Un borrado que arrastra cosas tiene que decir qué arrastra ANTES de hacerlo.
 *
 * No usa `confirm()` del navegador a propósito: ahí no se puede enseñar el
 * recuento de lo que se pierde, que es justo la información que hace falta para
 * decidir. Pide una segunda pulsación con el aviso delante.
 *
 * `etiqueta` puede ser texto o un icono; `clase` y `titulo` son para el disparador,
 * porque un icono sin `title` no dice qué hace.
 */
export default function BotonPeligroso({
  etiqueta,
  aviso,
  confirmacion = "Sí, borrar",
  clase = "enlace",
  titulo,
  onConfirmar,
}: {
  etiqueta: React.ReactNode;
  aviso: string;
  confirmacion?: string;
  clase?: string;
  titulo?: string;
  onConfirmar: () => Promise<void> | void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pendiente, iniciar] = useTransition();

  if (!abierto)
    return (
      <button
        className={clase}
        title={titulo}
        aria-label={titulo}
        onClick={() => setAbierto(true)}
      >
        {etiqueta}
      </button>
    );

  return (
    <span className="fila" style={{ gap: 8 }}>
      <span
        className="aviso"
        style={{
          background: "var(--aviso-suave)",
          borderRadius: "var(--r-s)",
          padding: "5px 10px",
        }}
      >
        {aviso}
      </span>
      <button
        className="peligro"
        disabled={pendiente}
        onClick={() => iniciar(() => void onConfirmar())}
      >
        {pendiente ? "Borrando…" : confirmacion}
      </button>
      <button onClick={() => setAbierto(false)} disabled={pendiente}>
        Cancelar
      </button>
    </span>
  );
}
