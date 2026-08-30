"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { anadirComponente, plantillasParaImportar } from "@/app/dietas/[id]/acciones";
import type { DatosPlantillas } from "@/app/dietas/[id]/tipos";
import { opcionActiva } from "@/lib/dominio/mapeo";
import type { DietaCompleta, FilaOpcion } from "@/lib/dominio/tipos";
import type { Componente } from "@/lib/motor";
import BuscadorIngrediente from "./BuscadorIngrediente";
import DialogoPlantillas from "./DialogoPlantillas";

/**
 * Una dieta recién creada: tiene sus comidas pero ningún ingrediente todavía.
 *
 * Este estado NO es un error, es por donde empieza toda dieta. Va en su propio
 * componente porque el editor completo necesita convertir la dieta al formato
 * del motor, y el motor exige al menos un componente.
 *
 * Dos cosas que faltaban aquí y se vieron usándola:
 *
 *  · **Importar una plantilla.** Es justo la pantalla donde más sirve —una
 *    comida vacía es el único caso en que la plantilla *rellena* la opción que
 *    hay en vez de crear otra—, y era la única que no lo ofrecía.
 *  · **Decir en qué opción va el ingrediente.** Sin eso, la acción tenía que
 *    averiguarlo, y ahí estaba el fallo que impedía añadir el primer alimento
 *    de una dieta nueva.
 */
export default function DietaVacia({ filas }: { filas: DietaCompleta }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [plantillas, setPlantillas] = useState<DatosPlantillas | null>(null);
  const [paraComida, setParaComida] = useState<{
    id: string;
    nombre: string;
    opciones: FilaOpcion[];
  } | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  const comidas = [...(filas.comidas ?? [])].sort((a, b) => a.orden - b.orden);

  function anadir(
    comidaId: string,
    ingredienteId: number,
    gramos: number,
    opcionId: string | null,
  ) {
    iniciar(() =>
      anadirComponente(comidaId, ingredienteId, gramos, filas.id, opcionId).then(() =>
        router.refresh(),
      ),
    );
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <div className="tarjeta" style={{ marginBottom: 18, background: "var(--acento-suave)", borderColor: "transparent" }}>
        <strong>Esta dieta aún está vacía.</strong>
        <p className="suave" style={{ margin: "6px 0 0" }}>
          Añade ingredientes a las comidas —o mete una plantilla que tengas
          guardada— y aparecerán los totales y el panel de ajuste.
        </p>
      </div>

      {fallo && <p className="aviso">{fallo}</p>}

      {comidas.length === 0 ? (
        <p className="vacio">Esta dieta no tiene ni comidas. Algo fue mal al crearla.</p>
      ) : (
        comidas.map((comida) => {
          const opciones = comida.opciones ?? [];
          const activaId = opcionActiva(comida);
          return (
            <section key={comida.id} className="comida">
              <header>
                <h2>{comida.nombre}</h2>
                {opciones.length > 0 && (
                  <button
                    type="button"
                    className="enlace"
                    style={{ fontSize: 13, marginLeft: "auto" }}
                    disabled={pendiente}
                    title="Meter aquí una opción que tengas guardada"
                    onClick={() =>
                      iniciar(async () => {
                        setFallo(null);
                        setParaComida({ id: comida.id, nombre: comida.nombre, opciones });
                        setPlantillas(await plantillasParaImportar(filas.id));
                      })
                    }
                  >
                    Importar plantilla
                  </button>
                )}
              </header>
              <footer style={{ borderTop: 0 }}>
                <BuscadorIngrediente
                  onElegir={(ingredienteId, gramos) =>
                    anadir(comida.id, ingredienteId, gramos, activaId)
                  }
                />
              </footer>
            </section>
          );
        })
      )}

      {pendiente && <p className="tenue">Un momento…</p>}

      {plantillas && paraComida && (
        <DialogoPlantillas
          datos={plantillas}
          comidaId={paraComida.id}
          comidaNombre={paraComida.nombre}
          dietaId={filas.id}
          opciones={paraComida.opciones}
          // Todas vacías: es una dieta sin ingredientes. Con eso, el dominio
          // decide «rellenar» y la plantilla entra tal cual, sin cuadrar contra
          // nada, y pasa a ser la referencia de esa comida.
          porOpcion={Object.fromEntries(
            paraComida.opciones.map((o) => [o.id, [] as Componente[]]),
          )}
          modeloEnergia={filas.modelo_energia ?? "atwater"}
          onCerrar={() => {
            setPlantillas(null);
            setParaComida(null);
          }}
          onHecho={() => {
            setPlantillas(null);
            setParaComida(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
