"use client";

import { useState, useTransition } from "react";

import {
  activarOpcion,
  borrarOpcion,
  crearOpcion,
  guardarGramos,
  plantillasParaImportar,
  renombrarOpcion,
} from "@/app/dietas/[id]/acciones";
import type { DatosPlantillas } from "@/app/dietas/[id]/tipos";
import DialogoGuardarPlantilla from "./DialogoGuardarPlantilla";
import DialogoPlantillas from "./DialogoPlantillas";
import { compararOpcion, objetivoParaCuadrar, type Equivalencia } from "@/lib/dominio/opciones";
import { ajustar, type Componente, type ModeloEnergia } from "@/lib/motor";
import type { FilaOpcion } from "@/lib/dominio/tipos";

/**
 * Las pestañas de opciones de una comida.
 *
 * Una comida puede tener varias formas de resolverse —«con tortilla», «con
 * yogur»— y se cambia de una a otra pulsando. **No es un estado de la
 * pantalla**: la opción activa se guarda, así que mañana la dieta se abre como
 * la dejaste, y es la que se imprime y la que se ajusta.
 *
 * La regla que lo sostiene todo: las opciones de una comida valen lo mismo en
 * kilocalorías y en reparto. Si no lo fueran, «las kcal de la dieta»
 * dependerían de qué combinación estuviera activa y dejarían de significar
 * nada. Por eso una opción nueva nace **copiando** la que estabas viendo —así
 * empieza cuadrada y se cambia lo que se quiera— y por eso hay un aviso
 * cuando deja de cuadrar, con un botón para volver a cuadrarla.
 *
 * Ese botón corre el MISMO motor que el ajuste de la dieta, aquí en el
 * navegador, sobre los componentes de esta opción sola. No hay un segundo
 * cálculo «para opciones».
 */
export default function OpcionesComida({
  comidaId,
  comidaNombre,
  dietaId,
  estadoDieta,
  opciones,
  activaId,
  modeloEnergia,
  /** Los componentes del motor de cada opción, por id de opción. */
  porOpcion,
  /** Los ids de fila de cada componente, en el mismo orden que `porOpcion`. */
  idsPorOpcion,
  onHecho,
}: {
  comidaId: string;
  comidaNombre: string;
  dietaId: string;
  estadoDieta: "crudo" | "cocido" | "mixto";
  opciones: FilaOpcion[];
  activaId: string | null;
  modeloEnergia: ModeloEnergia;
  porOpcion: Record<string, Componente[]>;
  idsPorOpcion: Record<string, string[]>;
  onHecho: () => void;
}) {
  const [pendiente, iniciar] = useTransition();
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);
  // Las plantillas se piden al pulsar, no al pintar la comida: son cinco
  // consultas para algo que no se abre casi nunca, y meterlas en un efecto es
  // la trampa de la fase 16.
  const [plantillas, setPlantillas] = useState<DatosPlantillas | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardada, setGuardada] = useState<string | null>(null);

  const orden = [...opciones].sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id));
  const activa = orden.find((o) => o.id === activaId) ?? orden[0];
  if (!activa) return null;

  // La referencia es la PRIMERA, no la activa: una referencia que se mueve
  // según lo que estés mirando no es una referencia.
  const referencia = orden[0];
  const esReferencia = activa.id === referencia.id;
  const eq: Equivalencia | null = esReferencia
    ? null
    : compararOpcion(
        porOpcion[referencia.id] ?? [],
        porOpcion[activa.id] ?? [],
        modeloEnergia,
      );

  function nueva() {
    setFallo(null);
    const usados = new Set(orden.map((o) => o.nombre));
    let n = orden.length + 1;
    while (usados.has(`Opción ${n}`)) n++;
    iniciar(async () => {
      const r = await crearOpcion({
        comidaId,
        nombre: `Opción ${n}`,
        // Copiando la que se está viendo: una opción nueva se hace cambiando
        // algo de la que hay, no empezando de cero. Y nace cuadrada.
        copiarDe: activa.id,
        dietaId,
      });
      if (r.error) setFallo(r.error);
      else onHecho();
    });
  }

  function cuadrar() {
    setFallo(null);
    const comps = porOpcion[activa.id] ?? [];
    const ids = idsPorOpcion[activa.id] ?? [];
    if (!comps.length) {
      setFallo("Esta opción no tiene alimentos que cuadrar.");
      return;
    }

    const objetivo = objetivoParaCuadrar(
      compararOpcion(porOpcion[referencia.id] ?? [], comps, modeloEnergia).referencia,
    );
    const res = ajustar({ componentes: comps, modeloEnergia }, objetivo.kcal, {
      modo: "prioridades",
      // Margen ancho: cuadrar una opción es mover cantidades a propósito, no el
      // retoque fino del ajuste diario. Con el ±40% de la pantalla, una opción
      // que se ha ido un 30% no tiene sitio para volver.
      holguraRel: 2,
      redondear: true,
      fuerzaMacros: 600,
      macrosObjetivo: objetivo.macrosObjetivo,
    });

    if (!res.factible) {
      setFallo(`El motor no ha podido cuadrarla: ${res.motivo}`);
      return;
    }

    iniciar(async () => {
      const r = await guardarGramos(
        res.cambios.map((c, i) => ({ id: ids[i], gramos: c.gramosDespues })),
        dietaId,
      );
      if (r.error) setFallo(r.error);
      else onHecho();
    });
  }

  return (
    <div className="opciones-comida">
      <div className="pestanas" role="tablist" aria-label={`Opciones de esta comida`}>
        {orden.map((o) => (
          <button
            key={o.id}
            role="tab"
            type="button"
            aria-selected={o.id === activa.id}
            className={o.id === activa.id ? "pestana activa" : "pestana"}
            disabled={pendiente}
            onClick={() =>
              o.id === activa.id
                ? (setRenombrando(o.id), setNombre(o.nombre))
                : iniciar(() => activarOpcion(comidaId, o.id, dietaId).then(onHecho))
            }
            title={
              o.id === activa.id
                ? "Pulsa otra vez para cambiarle el nombre"
                : `Ver «${o.nombre}»`
            }
          >
            {o.nombre}
            {o.id === referencia.id && orden.length > 1 && (
              <span className="chip ref" title="Es la referencia: las demás se comparan con ella">
                ref
              </span>
            )}
          </button>
        ))}

        <button type="button" className="pestana anadir" disabled={pendiente} onClick={nueva}
          title="Crear otra opción copiando la que estás viendo">
          + Opción
        </button>

        {orden.length > 1 && (
          <button
            type="button"
            className="enlace peligroso quitar-opcion"
            disabled={pendiente}
            onClick={() =>
              iniciar(async () => {
                const r = await borrarOpcion(activa.id, dietaId);
                if (r.error) setFallo(r.error);
                else onHecho();
              })
            }
            title={
              esReferencia
                ? `Quitar «${activa.nombre}» y sus alimentos. Es la referencia: ` +
                  "pasará a serlo la siguiente, y las demás se compararán con ella."
                : `Quitar «${activa.nombre}» y sus alimentos`
            }
          >
            quitar esta
          </button>
        )}
      </div>

      <p className="acciones-plantilla">
        <button
          type="button"
          className="enlace"
          disabled={pendiente}
          title="Meter aquí una opción que tengas guardada"
          onClick={() =>
            iniciar(async () => {
              setFallo(null);
              setPlantillas(await plantillasParaImportar(dietaId));
            })
          }
        >
          Importar plantilla
        </button>
        <span className="tenue" aria-hidden>
          ·
        </span>
        <button
          type="button"
          className="enlace"
          disabled={pendiente}
          title={`Guardar «${activa.nombre}» para poder usarla en otras comidas`}
          onClick={() => {
            setFallo(null);
            setGuardada(null);
            setGuardando(true);
          }}
        >
          guardar esta como plantilla
        </button>
      </p>

      {guardada && (
        <p className="tenue">
          Guardada como plantilla «{guardada}». Está disponible en cualquier comida de
          cualquier dieta.
        </p>
      )}

      {plantillas && (
        <DialogoPlantillas
          datos={plantillas}
          comidaId={comidaId}
          comidaNombre={comidaNombre}
          dietaId={dietaId}
          opciones={opciones}
          porOpcion={porOpcion}
          modeloEnergia={modeloEnergia}
          onCerrar={() => setPlantillas(null)}
          onHecho={() => {
            setPlantillas(null);
            onHecho();
          }}
        />
      )}

      {guardando && (
        <DialogoGuardarPlantilla
          opcionId={activa.id}
          opcionNombre={activa.nombre}
          comidaNombre={comidaNombre}
          estadoDieta={estadoDieta}
          componentes={porOpcion[activa.id] ?? []}
          modeloEnergia={modeloEnergia}
          onCerrar={() => setGuardando(false)}
          onHecho={(n) => {
            setGuardando(false);
            setGuardada(n);
          }}
        />
      )}

      {renombrando === activa.id && (
        <div className="fila renombrar-opcion">
          <input
            value={nombre}
            autoFocus
            aria-label="Nombre de la opción"
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenombrando(null);
              if (e.key === "Enter" && nombre.trim())
                iniciar(async () => {
                  const r = await renombrarOpcion(activa.id, nombre, dietaId);
                  if (r.error) setFallo(r.error);
                  else {
                    setRenombrando(null);
                    onHecho();
                  }
                });
            }}
          />
          <button
            className="principal"
            disabled={pendiente || !nombre.trim()}
            onClick={() =>
              iniciar(async () => {
                const r = await renombrarOpcion(activa.id, nombre, dietaId);
                if (r.error) setFallo(r.error);
                else {
                  setRenombrando(null);
                  onHecho();
                }
              })
            }
          >
            Guardar
          </button>
          <button onClick={() => setRenombrando(null)}>Cancelar</button>
        </div>
      )}

      {fallo && <p className="aviso">{fallo}</p>}

      {eq && !eq.equivalente && (
        <div className="aviso-caja no-cuadra">
          <div>
            <strong>Esta opción no cuadra con «{referencia.nombre}»</strong>
            <ul>
              {eq.motivos.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
            <p className="tenue">
              Las opciones de una comida tienen que valer lo mismo: si no, las
              kilocalorías de la dieta dependerían de cuál esté puesta. Puedes
              cuadrarla moviendo cantidades a mano, o dejar que lo haga el motor.
            </p>
            <button type="button" className="boton-plan" disabled={pendiente} onClick={cuadrar}>
              {pendiente ? "Cuadrando…" : "Cuadrar esta opción con el motor"}
            </button>
          </div>
        </div>
      )}

      {eq?.equivalente && (
        <p className="tenue cuadra">
          Cuadra con «{referencia.nombre}»: {Math.round(eq.opcion.energia)} kcal frente a{" "}
          {Math.round(eq.referencia.energia)}.
        </p>
      )}
    </div>
  );
}
