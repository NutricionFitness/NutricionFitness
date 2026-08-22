"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { fijarAlergenosIngrediente } from "@/app/alergenos/acciones";
import type { Alergeno } from "@/app/alergenos/consultas";

/**
 * Los alérgenos de un ingrediente, en su ficha.
 *
 * Distingue tres estados, y la diferencia importa:
 *   · revisado y con alérgenos      → esto lleva esto
 *   · revisado y sin ninguno        → alguien miró y no lleva ninguno
 *   · sin revisar                   → lo dedujo el script y nadie lo ha mirado
 *
 * «Sin revisar» no es «no lleva». Por eso lo dice con esas palabras y no se
 * queda callado.
 */
export default function AlergenosIngrediente({
  ingredienteId,
  catalogo,
  puestos,
  revisado,
}: {
  ingredienteId: number;
  catalogo: Alergeno[];
  puestos: number[];
  revisado: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [sel, setSel] = useState<number[]>(puestos);
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardando, iniciar] = useTransition();

  const porId = new Map(catalogo.map((a) => [a.id, a]));
  const actuales = puestos.map((id) => porId.get(id)).filter((a): a is Alergeno => !!a);

  function guardar() {
    setFallo(null);
    iniciar(async () => {
      try {
        await fijarAlergenosIngrediente(ingredienteId, sel);
        setEditando(false);
        router.refresh();
      } catch (e) {
        setFallo(e instanceof Error ? e.message : "No se ha podido guardar.");
      }
    });
  }

  if (editando)
    return (
      <div className="tarjeta">
        <h2 style={{ margin: "0 0 4px", fontSize: 14 }}>Alérgenos</h2>
        <p className="tenue" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
          Marca lo que lleva. Al guardar queda como <strong>revisado</strong>, y el
          script de derivación ya no lo toca.
        </p>

        <div className="rejilla" style={{ gap: 7 }}>
          {catalogo.map((a) => (
            <label key={a.id} className="opcion" style={{ fontSize: 13.5 }}>
              <input
                type="checkbox"
                checked={sel.includes(a.id)}
                onChange={(e) =>
                  setSel(
                    e.target.checked ? [...sel, a.id] : sel.filter((x) => x !== a.id),
                  )
                }
              />
              <span>
                {a.nombre}
                {a.detalle && (
                  <small className="tenue" style={{ display: "block", lineHeight: 1.35 }}>
                    {a.detalle}
                  </small>
                )}
              </span>
            </label>
          ))}
        </div>

        {fallo && <p className="aviso" style={{ marginTop: 12 }}>{fallo}</p>}

        <div className="fila" style={{ marginTop: 14 }}>
          <button className="principal" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar alérgenos"}
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={() => {
              setSel(puestos);
              setEditando(false);
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    );

  return (
    <div className="tarjeta">
      <div className="fila" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>Alérgenos</h2>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setEditando(true)}>
          Editar
        </button>
      </div>

      {actuales.length > 0 && (
        <div className="fila" style={{ gap: 6, marginBottom: 10 }}>
          {actuales.map((a) => (
            <span key={a.id} className="chip alergia" title={a.detalle ?? undefined}>
              {a.nombre}
            </span>
          ))}
        </div>
      )}

      {revisado ? (
        actuales.length === 0 && (
          <p className="tenue" style={{ margin: 0, fontSize: 13.5 }}>
            Revisado: no lleva ninguno de los del catálogo.
          </p>
        )
      ) : (
        <p className="sin-revisar">
          <strong>Sin revisar.</strong> Esta lista la dedujo el script a partir de la
          fuente LanguaL y del nombre. Puede faltarle algo, sobre todo si es un plato
          compuesto. Al editarla y guardar, queda revisada.
        </p>
      )}
    </div>
  );
}
