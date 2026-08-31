"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { borrarIngrediente, usosDeIngrediente } from "@/app/ingredientes/acciones";

type Usos = Awaited<ReturnType<typeof usosDeIngrediente>>;

/**
 * Eliminar un ingrediente propio, diciendo antes dónde está usado.
 *
 * Solo los propios: los del catálogo compartido se pueden **corregir** desde la
 * fase 12 —y así se arregla también en las dietas que ya lo usan, que es lo que
 * interesa— pero no hacer desaparecer, porque están dentro de dietas guardadas.
 * Eso lo impide el RLS; aquí ni se ofrece.
 *
 * Y no se borra a ciegas: `componentes` y `plantilla_componentes` apuntan con
 * `on delete restrict`, así que un ingrediente en uso no se va. Sin contar
 * antes, el único aviso sería un error de la base con su jerga. Se cuenta y se
 * enseña **dónde**, con enlaces, que es lo que hace falta para poder arreglarlo.
 * Es el patrón de los borrados de la fase 8.
 */
export default function BorrarIngrediente({
  id,
  nombre,
}: {
  id: number;
  nombre: string;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [usos, setUsos] = useState<Usos | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  useEffect(() => {
    const d = dialogo.current;
    if (usos && d && !d.open) d.showModal();
  }, [usos]);

  const enUso = Boolean(usos && (usos.dietas.length > 0 || usos.plantillas.length > 0));

  return (
    <>
      <button
        className="enlace peligroso"
        disabled={pendiente}
        onClick={() =>
          iniciar(async () => {
            setFallo(null);
            setUsos(await usosDeIngrediente(id));
          })
        }
      >
        Eliminar este ingrediente
      </button>

      {usos && (
        <dialog ref={dialogo} className="borrar-ingrediente" onClose={() => setUsos(null)}>
          <header>
            <h3>Eliminar «{nombre}»</h3>
            <button
              type="button"
              className="enlace"
              onClick={() => dialogo.current?.close()}
            >
              cerrar
            </button>
          </header>

          {enUso ? (
            <>
              <p className="caja-peligro">
                No se puede: está usado
                {usos.dietas.length > 0 &&
                  ` en ${usos.dietas.length} ${usos.dietas.length === 1 ? "dieta" : "dietas"}`}
                {usos.dietas.length > 0 && usos.plantillas.length > 0 && " y"}
                {usos.plantillas.length > 0 &&
                  ` en ${usos.plantillas.length} ${
                    usos.plantillas.length === 1 ? "plantilla" : "plantillas"
                  }`}
                . Quítalo de ahí y vuelve.
              </p>

              {usos.dietas.length > 0 && (
                <div className="donde">
                  <span className="etiqueta">Dietas</span>
                  <ul>
                    {usos.dietas.map((d) => (
                      <li key={d.id}>
                        <Link href={`/dietas/${d.id}`}>{d.nombre}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {usos.plantillas.length > 0 && (
                <div className="donde">
                  <span className="etiqueta">Plantillas</span>
                  <ul>
                    {usos.plantillas.map((p) => (
                      <li key={p.id}>{p.nombre}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="tenue">
                Si lo que quieres es corregirlo, no hace falta borrarlo: edítalo y el
                cambio llega a todas las dietas que lo usan.
              </p>
            </>
          ) : (
            <p>
              No está en ninguna dieta ni en ninguna plantilla, así que no se pierde
              nada más. Esto no tiene vuelta atrás.
            </p>
          )}

          {fallo && <p className="caja-peligro">{fallo}</p>}

          <footer>
            <button type="button" disabled={pendiente} onClick={() => dialogo.current?.close()}>
              Cancelar
            </button>
            {!enUso && (
              <button
                type="button"
                className="peligro"
                disabled={pendiente}
                onClick={() =>
                  iniciar(async () => {
                    const r = await borrarIngrediente(id);
                    if (r.error) setFallo(r.error);
                    // Si sale bien, la acción redirige al catálogo.
                  })
                }
              >
                {pendiente ? "Eliminando…" : "Sí, eliminarlo"}
              </button>
            )}
          </footer>
        </dialog>
      )}
    </>
  );
}
