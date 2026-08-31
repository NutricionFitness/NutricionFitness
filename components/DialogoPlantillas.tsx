"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { importarPlantilla } from "@/app/dietas/[id]/acciones";
import { borrarPlantilla } from "@/app/plantillas/acciones";
import BotonPeligroso from "./BotonPeligroso";
import type { DatosPlantillas, PlantillaParaElegir } from "@/app/dietas/[id]/tipos";
import {
  aComponentePlantilla,
  avisoEstadoCantidades,
  destinoDeImportacion,
  encajarPlantilla,
  nombreLibre,
} from "@/lib/dominio/plantillas";
import { totalesDe } from "@/lib/dominio/totales";
import type { Componente, ModeloEnergia } from "@/lib/motor";
import type { FilaOpcion } from "@/lib/dominio/tipos";

const n0 = (v: number) => Math.round(v).toLocaleString("es-ES");

/** Sin tildes y en minúsculas, para casar «Desayuno» con «desayuno». */
const plano = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Meter una opción guardada en esta comida.
 *
 * Lo que decide qué pasa está en `lib/dominio/plantillas.ts` y tiene sus
 * pruebas; aquí solo se pregunta y se pinta. En concreto:
 *
 *  · **dónde entra** —rellenando la única opción vacía de una comida recién
 *    creada, o en una opción nueva—;
 *  · **con qué gramos** —cuadrada contra la referencia con el mismo motor del
 *    botón de cuadrar, y comprobando después con la regla que ha quedado
 *    cuadrada de verdad, que no es lo mismo que el motor diga «factible»—;
 *  · **con qué nombre**, para no chocar con el único `(comida_id, nombre)`.
 *
 * No hay ningún efecto: las plantillas llegan hechas desde el servidor al
 * pulsar el botón, y el encaje es una cuenta de microsegundos que se rehace en
 * cada render sin pedirle nada a nadie. Es más simple que memorizarlo, y no
 * puede quedarse viejo.
 */
export default function DialogoPlantillas({
  datos,
  comidaId,
  comidaNombre,
  dietaId,
  opciones,
  porOpcion,
  modeloEnergia,
  onCerrar,
  onHecho,
}: {
  datos: DatosPlantillas;
  comidaId: string;
  comidaNombre: string;
  dietaId: string;
  opciones: FilaOpcion[];
  porOpcion: Record<string, Componente[]>;
  modeloEnergia: ModeloEnergia;
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [elegida, setElegida] = useState<PlantillaParaElegir | null>(null);
  const [nombre, setNombre] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);
  // Las que se han quitado sin cerrar el diálogo. Se filtran en memoria en vez
  // de volver a pedir la lista: lo que se ha borrado, borrado está.
  const [quitadas, setQuitadas] = useState<string[]>([]);
  const [pendiente, iniciar] = useTransition();

  // En un `<dialog>` modal, que se pinta en la capa superior del navegador: es
  // el patrón de la casa desde la fase 14, y lo que evita que un `overflow` de
  // más arriba se lo coma, como pasó en la fase 11.
  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  const destino = destinoDeImportacion(opciones, porOpcion);
  const orden = [...opciones].sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id));
  const referencia = destino.modo === "rellenar" ? null : (porOpcion[orden[0]?.id] ?? []);
  const usados = orden.filter((o) => o.id !== destino.opcionId).map((o) => o.nombre);

  // Las de esta comida arriba: **ordenar, no filtrar**. Una plantilla de cena
  // puede valer para una comida, y esconderla sería decidir por quien mira.
  const lista = datos.plantillas
    .filter((p) => !quitadas.includes(p.id))
    .sort((a, b) => {
      const suya = (p: PlantillaParaElegir) =>
        p.comidaSugerida && plano(p.comidaSugerida) === plano(comidaNombre) ? 0 : 1;
      return suya(a) - suya(b) || a.nombre.localeCompare(b.nombre, "es");
    });

  const componentesDe = (p: PlantillaParaElegir): Componente[] =>
    p.componentes.map((c) => aComponentePlantilla(c, comidaNombre));

  const encaje = elegida
    ? encajarPlantilla(componentesDe(elegida), referencia, modeloEnergia)
    : null;
  const avisoEstado = elegida
    ? avisoEstadoCantidades(elegida.estadoCantidades, datos.estadoDieta)
    : null;

  function elegir(p: PlantillaParaElegir) {
    setFallo(null);
    setElegida(p);
    setNombre(nombreLibre(p.nombre, usados));
  }

  function importar() {
    if (!elegida || !encaje) return;
    setFallo(null);

    // El id del ingrediente se saca de la FILA, no del componente del motor:
    // `Ingrediente.id` es opcional ahí dentro —al motor no le hace falta— y una
    // plantilla que se guardara con ids a medias sería basura silenciosa.
    // `encajarPlantilla` devuelve un `map` de lo que se le da, así que el orden
    // se conserva; esto lo comprueba en vez de darlo por hecho.
    if (encaje.componentes.length !== elegida.componentes.length) {
      setFallo("No cuadran los alimentos de la plantilla con los calculados.");
      return;
    }

    iniciar(async () => {
      const r = await importarPlantilla({
        comidaId,
        opcionId: destino.opcionId,
        nombre,
        componentes: encaje.componentes.map((c, i) => ({
          ingredienteId: Number(elegida.componentes[i].ingrediente_id),
          gramos: c.gramos,
          orden: i,
          bloqueado: Boolean(c.bloqueado),
          prioridad: c.prioridad ?? 1,
          minG: c.minG ?? null,
          maxG: c.maxG ?? null,
          pasoG: c.pasoG ?? 5,
        })),
        dietaId,
      });
      if (r.error) setFallo(r.error);
      else onHecho();
    });
  }

  return (
    <dialog ref={dialogo} className="plantillas" onClose={onCerrar}>
      <header>
        <h3>Importar una plantilla en {comidaNombre}</h3>
        <button type="button" className="enlace" onClick={() => dialogo.current?.close()}>
          cerrar
        </button>
      </header>

      {lista.length === 0 ? (
        <p className="suave">
          Todavía no has guardado ninguna plantilla. Se guardan desde una opción
          cualquiera, con «guardar esta como plantilla».
        </p>
      ) : (
        <>
          <ul className="lista-plantillas">
            {lista.map((p, i) => {
              const t = totalesDe(componentesDe(p), modeloEnergia);
              const suya =
                p.comidaSugerida && plano(p.comidaSugerida) === plano(comidaNombre);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    // El foco, en la primera de la lista y no en el «cerrar»:
                    // `showModal()` enfoca el primer elemento enfocable, que es
                    // el de la cabecera. Es la misma corrección de la fase 22.
                    autoFocus={i === 0}
                    className={p.id === elegida?.id ? "plantilla elegida" : "plantilla"}
                    disabled={pendiente}
                    onClick={() => elegir(p)}
                  >
                    <span className="cabeza">
                      <strong>{p.nombre}</strong>
                      {suya && (
                        <span className="chip" title={`Guardada para ${p.comidaSugerida}`}>
                          {p.comidaSugerida}
                        </span>
                      )}
                      {p.estadoCantidades !== datos.estadoDieta && (
                        <span className="chip" title="No coincide con el de esta dieta">
                          {p.estadoCantidades}
                        </span>
                      )}
                      {p.choques.length > 0 && (
                        <span className="chip alergia" title={p.choques.join(", ")}>
                          {p.choques.length === 1 ? p.choques[0].toLowerCase() : "alérgenos"}
                        </span>
                      )}
                    </span>
                    <span className="cifras">
                      {n0(t.energia)} kcal · {n0(t.pct.prot)}/{n0(t.pct.hc)}/
                      {n0(t.pct.grasa)}
                      <span className="tenue">
                        {" "}
                        · {p.componentes.length}{" "}
                        {p.componentes.length === 1 ? "alimento" : "alimentos"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {elegida && encaje && (
            <div className="encaje">
              <label className="campo-nombre">
                <span>Se llamará</span>
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  disabled={pendiente}
                  aria-label="Nombre de la opción"
                />
              </label>

              {destino.modo === "rellenar" ? (
                <p className="tenue">
                  Esta comida solo tiene una opción y está vacía, así que la plantilla la
                  rellena y pasa a ser la referencia con la que se comparan las demás.
                </p>
              ) : encaje.cuadrada ? (
                <p className="tenue">
                  {encaje.ajustada
                    ? `Entra cuadrada con «${orden[0].nombre}»: ${n0(
                        totalesDe(encaje.componentes, modeloEnergia).energia,
                      )} kcal. Se han movido las cantidades para que valga lo mismo.`
                    : "Entra tal cual: ya vale lo mismo que la referencia."}
                </p>
              ) : (
                <div className="caja-aviso">
                  <strong>Entra sin cuadrar con «{orden[0].nombre}»</strong>
                  <ul>
                    {encaje.motivos.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                  <p className="tenue">
                    Se importa igual, con sus cantidades. Dentro tienes el botón de
                    cuadrarla con el motor, o puedes moverlas a mano.
                  </p>
                </div>
              )}

              {avisoEstado && <p className="caja-aviso">{avisoEstado}</p>}

              {elegida.choques.length > 0 && (
                <p className="caja-peligro">
                  Lleva {elegida.choques.length === 1 ? "un alérgeno" : "alérgenos"} de esta
                  persona: {elegida.choques.join(", ").toLowerCase()}. No se impide, pero
                  revísalo.
                </p>
              )}
              {elegida.sinRevisar > 0 && (
                <p className="tenue">
                  {elegida.sinRevisar === 1
                    ? "1 de sus ingredientes no tiene"
                    : `${elegida.sinRevisar} de sus ingredientes no tienen`}{" "}
                  los alérgenos revisados a mano.
                </p>
              )}
              {elegida.notas && <p className="tenue notas">{elegida.notas}</p>}

              {/* Va aquí y no en la ficha porque un botón no puede llevar otro
                  dentro. Quitar una plantilla no toca ninguna dieta: las
                  opciones que salieron de ella son copias. */}
              <p className="quitar-plantilla">
                <BotonPeligroso
                  clase="enlace peligroso"
                  etiqueta="quitar esta plantilla"
                  aviso={`Se borra «${elegida.nombre}». Las opciones que ya salieron de ella se quedan como están.`}
                  confirmacion="Sí, quitarla"
                  onConfirmar={async () => {
                    const r = await borrarPlantilla(elegida.id);
                    if (r.error) setFallo(r.error);
                    else {
                      setQuitadas((v) => [...v, elegida.id]);
                      setElegida(null);
                    }
                  }}
                />
              </p>
            </div>
          )}

          {fallo && <p className="caja-peligro">{fallo}</p>}

          <footer>
            <button
              type="button"
              disabled={pendiente}
              onClick={() => dialogo.current?.close()}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="principal"
              disabled={!elegida || pendiente || !nombre.trim()}
              onClick={importar}
            >
              {pendiente ? "Importando…" : "Importar"}
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
