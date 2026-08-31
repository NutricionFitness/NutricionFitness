"use client";

import { useState, useTransition } from "react";

import { borrarMedidaCasera, crearMedidaCasera } from "@/app/ingredientes/acciones";
import BotonPeligroso from "./BotonPeligroso";
import type { Medida } from "./FichaIngrediente";

/**
 * Las medidas caseras de un ingrediente, y las tuyas se pueden tocar.
 *
 * En la misma tabla conviven las **de serie** —las 472 que dedujo la fase 6,
 * sin dueño, que ve todo el mundo— y las que añade cada cuenta. Las de serie se
 * usan y no se tocan: están calculadas contra la fuente y son de todos. Las
 * propias se añaden y se quitan aquí, que es donde se miran.
 *
 * Se pueden añadir también a un ingrediente **compartido**: «el vaso de casa
 * son 240 ml» es exactamente el tipo de cosa que no está en BEDCA. Lo permite
 * el RLS —`with check (owner_id = auth.uid())` mira el dueño de la medida, no
 * el del ingrediente— y es medio motivo de que la tabla exista.
 *
 * Las medidas no cambian ni un gramo de ninguna dieta: se deducen al mostrar,
 * que es la decisión de la fase 6.
 */
export default function MedidasCaseras({
  ingredienteId,
  medidas,
  onHecho,
}: {
  ingredienteId: number;
  medidas: Medida[];
  onHecho: () => void;
}) {
  const [anadiendo, setAnadiendo] = useState(false);
  const [nombre, setNombre] = useState("");
  const [gramos, setGramos] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const g = Number(gramos.replace(",", "."));
  const valido = nombre.trim().length > 0 && Number.isFinite(g) && g > 0;

  function anadir() {
    if (!valido) return;
    setFallo(null);
    iniciar(async () => {
      const r = await crearMedidaCasera(ingredienteId, nombre, g);
      if (r.error) return setFallo(r.error);
      setNombre("");
      setGramos("");
      setAnadiendo(false);
      onHecho();
    });
  }

  return (
    <div className="tarjeta">
      <h2 style={{ margin: "0 0 10px", fontSize: 14 }}>Medidas caseras</h2>

      {medidas.length === 0 ? (
        <p className="tenue" style={{ margin: "0 0 10px", fontSize: 13.5 }}>
          Ninguna todavía. Este ingrediente se pesa.
        </p>
      ) : (
        <ul className="medidas">
          {medidas.map((m) => (
            <li key={m.id}>
              1 {m.nombre} <span className="tenue">=</span>{" "}
              <b className="cifra">{Math.round(Number(m.gramos))} g</b>
              {m.propia ? (
                <BotonPeligroso
                  clase="enlace peligroso"
                  etiqueta="quitar"
                  aviso={`Se quita «${m.nombre}». Las dietas no cambian: las medidas se deducen al mostrarlas.`}
                  confirmacion="Sí, quitarla"
                  onConfirmar={async () => {
                    const r = await borrarMedidaCasera(m.id, ingredienteId);
                    if (r.error) setFallo(r.error);
                    else onHecho();
                  }}
                />
              ) : (
                <span className="chip" title="Viene con el catálogo: se usa, no se toca">
                  de serie
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {anadiendo ? (
        <div className="anadir-medida">
          <div className="fila">
            <input
              value={nombre}
              autoFocus
              placeholder="vaso, cazo, unidad…"
              aria-label="Nombre de la medida"
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valido) anadir();
                if (e.key === "Escape") setAnadiendo(false);
              }}
            />
            <span className="tenue">=</span>
            <input
              value={gramos}
              inputMode="decimal"
              placeholder="g"
              aria-label="Gramos"
              style={{ width: 84 }}
              onChange={(e) => setGramos(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valido) anadir();
                if (e.key === "Escape") setAnadiendo(false);
              }}
            />
          </div>
          <div className="fila">
            <button className="principal" disabled={!valido || pendiente} onClick={anadir}>
              {pendiente ? "Añadiendo…" : "Añadir"}
            </button>
            <button disabled={pendiente} onClick={() => setAnadiendo(false)}>
              Cancelar
            </button>
            {/* En singular, que es como se guardan: «1 vaso». La app las
                concuerda al mostrarlas —«2 vasos»— desde la fase 9. */}
            <span className="tenue" style={{ fontSize: 12 }}>
              En singular: «vaso», no «vasos».
            </span>
          </div>
        </div>
      ) : (
        <button className="enlace" onClick={() => setAnadiendo(true)}>
          añadir una medida mía
        </button>
      )}

      {fallo && (
        <p className="aviso" style={{ marginTop: 8, fontSize: 13 }}>
          {fallo}
        </p>
      )}
    </div>
  );
}
