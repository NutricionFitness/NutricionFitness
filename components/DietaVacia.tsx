"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { anadirComponente } from "@/app/dietas/[id]/acciones";
import type { DietaCompleta } from "@/lib/dominio/tipos";
import BuscadorIngrediente from "./BuscadorIngrediente";

/**
 * Una dieta recién creada: tiene sus comidas pero ningún ingrediente todavía.
 *
 * Este estado NO es un error, es por donde empieza toda dieta. Va en su propio
 * componente porque el editor completo necesita convertir la dieta al formato
 * del motor, y el motor exige al menos un componente.
 */
export default function DietaVacia({ filas }: { filas: DietaCompleta }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const comidas = [...(filas.comidas ?? [])].sort((a, b) => a.orden - b.orden);

  function anadir(comidaId: string, ingredienteId: number, gramos: number) {
    iniciar(() =>
      anadirComponente(comidaId, ingredienteId, gramos, filas.id).then(() => router.refresh()),
    );
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <div className="tarjeta" style={{ marginBottom: 20 }}>
        <strong>Esta dieta aún está vacía.</strong>
        <p className="suave" style={{ margin: "6px 0 0" }}>
          Añade ingredientes a las comidas y aparecerán los totales y el panel de
          ajuste.
        </p>
      </div>

      {comidas.length === 0 ? (
        <p className="vacio">Esta dieta no tiene ni comidas. Algo fue mal al crearla.</p>
      ) : (
        comidas.map((comida) => (
          <section key={comida.id} style={{ marginBottom: 18 }}>
            <h2 style={{ margin: "0 0 2px" }}>{comida.nombre}</h2>
            <BuscadorIngrediente
              onElegir={(ingredienteId, gramos) => anadir(comida.id, ingredienteId, gramos)}
            />
          </section>
        ))
      )}

      {pendiente && <p className="suave">Añadiendo…</p>}
    </div>
  );
}
