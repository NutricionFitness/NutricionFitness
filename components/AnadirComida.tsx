"use client";

import { useState, useTransition } from "react";

import { crearComida } from "@/app/dietas/[id]/acciones";

/**
 * Añadir una comida al día.
 *
 * Las dietas nacen con las cinco de siempre, pero no todo el mundo come cinco
 * veces ni las llama igual: «post-entreno», «recena», «media tarde».
 *
 * Solo se pueden quitar las comidas vacías. Borrar una con ingredientes dentro
 * se los llevaría por delante sin que se vea, y eso no es un botón, es una
 * trampa.
 */
export default function AnadirComida({
  dietaId,
  orden,
  onHecho,
}: {
  dietaId: string;
  orden: number;
  onHecho: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [pendiente, iniciar] = useTransition();

  function guardar() {
    const n = nombre.trim();
    if (!n) return;
    iniciar(() =>
      crearComida(dietaId, n, orden).then(() => {
        setNombre("");
        setAbierto(false);
        onHecho();
      }),
    );
  }

  if (!abierto)
    return (
      <button className="enlace" style={{ marginTop: 16 }} onClick={() => setAbierto(true)}>
        + añadir una comida
      </button>
    );

  return (
    <div className="fila" style={{ marginTop: 16 }}>
      <input
        value={nombre}
        autoFocus
        placeholder="Post-entreno, recena…"
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") guardar();
          if (e.key === "Escape") setAbierto(false);
        }}
      />
      <button className="principal" onClick={guardar} disabled={pendiente || !nombre.trim()}>
        Añadir
      </button>
      <button onClick={() => setAbierto(false)}>Cancelar</button>
    </div>
  );
}
