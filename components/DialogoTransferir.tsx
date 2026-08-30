"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { copiarDietaAPersona, transferirDieta } from "@/app/dietas/[id]/acciones";
import type {
  AlcanceTransferencia,
  DatosTransferencia,
  PersonaDestino,
} from "@/app/dietas/[id]/tipos";

/** Los pesos van en español: «62,5 kg», no «62.5». */
const enKg = (v: number) => `${v.toLocaleString("es-ES")} kg`;

/**
 * Pasar una dieta de una persona a otra.
 *
 * Tres cosas distintas detrás de un mismo botón, y la diferencia entre ellas no
 * se puede adivinar por el nombre: por eso cada una lleva **escrita la
 * consecuencia** —cuántas versiones se mueven, qué se queda, de quién pasa a
 * colgar lo que se queda—. Es el patrón de los borrados de la fase 8: contar
 * antes de que se pulse, no después.
 *
 * Va en un `<dialog>` con `showModal()`, que se pinta en la capa superior del
 * navegador. Un desplegable posicionado dentro de la fila de una tabla es justo
 * lo que se comió el `overflow` en la fase 11.
 *
 * No consulta nada mientras está abierto: los datos llegan hechos desde
 * `datosParaTransferir`, que los pide **al pulsar el botón**. Así el cruce de
 * alergias de cada persona no es una ida al servidor por cada vez que se cambia
 * el selector, y no hay ningún efecto que pueda cancelarse a sí mismo, que es
 * lo que dejó el escáner remoto sin entregar nada en la fase 16.
 */
export default function DialogoTransferir({
  datos,
  dietaId,
  onCerrar,
  onHecho,
}: {
  datos: DatosTransferencia;
  dietaId: string;
  /** Se cierra sin haber hecho nada. */
  onCerrar: () => void;
  /** Se cierra habiendo movido o copiado algo: la pantalla de debajo ya no vale. */
  onHecho: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [destinoId, setDestinoId] = useState("");
  const [alcance, setAlcance] = useState<AlcanceTransferencia>("linaje");
  const [hecho, setHecho] = useState<{ texto: string; enlace: string } | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  const destino: PersonaDestino | null =
    datos.destinos.find((p) => p.id === destinoId) ?? null;
  const nombreOrigen = datos.origen?.nombre ?? "esta persona";
  const variasVersiones = datos.versiones > 1;

  function confirmar() {
    if (!destino) return;
    setFallo(null);
    iniciar(async () => {
      if (alcance === "copia") {
        const r = await copiarDietaAPersona(dietaId, destino.id);
        if (r.error) return setFallo(r.error);
        setHecho({
          texto: `${destino.nombre} tiene ya su copia de «${datos.dietaNombre}». La original se queda donde estaba.`,
          enlace: r.nuevaId ? `/dietas/${r.nuevaId}` : `/personas/${destino.id}`,
        });
        return;
      }

      const r = await transferirDieta(dietaId, destino.id, alcance);
      if (r.error) return setFallo(r.error);
      setHecho({
        texto:
          r.movidas === 1
            ? `«${datos.dietaNombre}» es ahora de ${destino.nombre}.`
            : `Las ${r.movidas} versiones de «${datos.dietaNombre}» son ahora de ${destino.nombre}.`,
        enlace: `/personas/${destino.id}`,
      });
    });
  }

  // --- lo que pasa con lo que se queda, dicho en palabras -------------------
  const otras = datos.versiones - 1;
  let consecuenciaSola = `${
    otras === 1 ? "la otra versión se queda" : `las otras ${otras} se quedan`
  } con ${nombreOrigen}`;
  if (datos.hijas > 0)
    consecuenciaSola += datos.nombrePadre
      ? `; ${
          datos.hijas === 1
            ? "la que colgaba de ella pasa"
            : `las ${datos.hijas} que colgaban de ella pasan`
        } a colgar de «${datos.nombrePadre}»`
      : `; ${
          datos.hijas === 1
            ? "la que colgaba de ella queda"
            : `las ${datos.hijas} que colgaban de ella quedan`
        } como raíz, sin madre`;
  consecuenciaSola += ". La que se va empieza de nuevo: versión 1 y sin madre.";

  return (
    <dialog
      ref={dialogo}
      className="transferir"
      onClose={() => (hecho ? onHecho() : onCerrar())}
    >
      <header>
        <h2>Transferir «{datos.dietaNombre}»</h2>
        <button type="button" className="enlace" onClick={() => dialogo.current?.close()}>
          cerrar
        </button>
      </header>

      {hecho ? (
        <>
          <p className="hecho">{hecho.texto}</p>
          <footer>
            <Link className="enlace" href={hecho.enlace}>
              Ver la dieta
            </Link>
            <button type="button" className="principal" onClick={() => dialogo.current?.close()}>
              Cerrar
            </button>
          </footer>
        </>
      ) : datos.destinos.length === 0 ? (
        <>
          <p className="suave">
            En esta cuenta no hay ninguna otra persona a la que pasarle la dieta.{" "}
            <Link href="/personas">Crea otra persona</Link> y vuelve a intentarlo.
          </p>
          <footer>
            <button type="button" onClick={() => dialogo.current?.close()}>
              Cerrar
            </button>
          </footer>
        </>
      ) : (
        <>
          <label className="a-quien">
            <span>¿A quién?</span>
            <select
              // `showModal()` deja el foco en el primer elemento enfocable, que
              // es el «cerrar» de la cabecera: se abre el diálogo y el teclado
              // está en la salida. El trabajo empieza aquí.
              autoFocus
              value={destinoId}
              onChange={(e) => setDestinoId(e.target.value)}
              disabled={pendiente}
            >
              {/* La persona que ya la tiene no está en la lista: la función de la
                  base rechaza ese caso, así que ofrecerlo sería ofrecer un error. */}
              <option value="">Elige una persona…</option>
              {datos.destinos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>

          <div className="opciones" role="radiogroup" aria-label="Qué hacer con la dieta">
            <Opcion
              elegida={alcance === "linaje"}
              onElegir={() => setAlcance("linaje")}
              deshabilitada={pendiente}
              titulo={variasVersiones ? "Transferir el historial entero" : "Transferir la dieta"}
              consecuencia={
                variasVersiones
                  ? `se llevan las ${datos.versiones} versiones, se haya pulsado en la que se haya pulsado`
                  : "es la única versión que hay"
              }
            />

            {variasVersiones && (
              <Opcion
                elegida={alcance === "sola"}
                onElegir={() => setAlcance("sola")}
                deshabilitada={pendiente}
                titulo={`Transferir solo esta versión (v${datos.version})`}
                consecuencia={consecuenciaSola}
              />
            )}

            <Opcion
              elegida={alcance === "copia"}
              onElegir={() => setAlcance("copia")}
              deshabilitada={pendiente}
              titulo="Copiar"
              consecuencia={`${nombreOrigen} conserva la suya y ${
                destino?.nombre ?? "la otra persona"
              } recibe una dieta nueva e independiente, en versión\u00a01`}
            />
          </div>

          {destino && (
            <div className="consecuencias">
              {destino.choques.length > 0 && (
                <p className="caja-peligro">
                  <strong>{destino.nombre}</strong> tiene declarada alergia a{" "}
                  {destino.choques.map((c, i) => (
                    <span key={c.alergeno}>
                      {i > 0 && (i === destino.choques.length - 1 ? " y a " : ", ")}
                      {c.alergeno.toLowerCase()} (
                      {c.ingredientes === 1
                        ? "1 ingrediente"
                        : `${c.ingredientes} ingredientes`}
                      )
                    </span>
                  ))}
                  . No se impide: la dieta se transfiere igual y el aviso se queda en
                  su listado.
                </p>
              )}

              {datos.sinRevisar > 0 && (
                <p className="tenue">
                  {datos.sinRevisar === 1
                    ? "1 ingrediente de la dieta no tiene"
                    : `${datos.sinRevisar} ingredientes de la dieta no tienen`}{" "}
                  los alérgenos revisados a mano, así que lo de arriba puede quedarse
                  corto.
                </p>
              )}

              <PesoQueCambia
                origen={datos.origen}
                destino={destino}
                nombreOrigen={nombreOrigen}
              />

              {alcance !== "copia" && (
                <p className="tenue">
                  {alcance === "linaje" && variasVersiones
                    ? `Esas ${datos.versiones} versiones pasan a depender de ${destino.nombre}: borrar a esa persona se las lleva.`
                    : `La dieta pasa a depender de ${destino.nombre}: borrar a esa persona se la lleva.`}
                </p>
              )}

              {alcance === "sola" && (
                <p className="tenue">
                  En el historial de {nombreOrigen} quedará un hueco donde estaba la v
                  {datos.version}. Las demás no se renumeran: cambiarle el número a una
                  versión que ya se ha impreso es peor que el hueco.
                </p>
              )}
            </div>
          )}

          {fallo && <p className="caja-peligro">{fallo}</p>}

          <footer>
            <button type="button" disabled={pendiente} onClick={() => dialogo.current?.close()}>
              Cancelar
            </button>
            <button
              type="button"
              className="principal"
              disabled={!destino || pendiente}
              onClick={confirmar}
            >
              {pendiente
                ? alcance === "copia"
                  ? "Copiando…"
                  : "Transfiriendo…"
                : alcance === "copia"
                  ? "Copiar"
                  : "Transferir"}
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}

/** Una elección con su consecuencia debajo, no solo su nombre. */
function Opcion({
  elegida,
  onElegir,
  deshabilitada,
  titulo,
  consecuencia,
}: {
  elegida: boolean;
  onElegir: () => void;
  deshabilitada: boolean;
  titulo: string;
  consecuencia: string;
}) {
  return (
    <label className={`opcion${elegida ? " elegida" : ""}`}>
      <input
        type="radio"
        name="alcance-transferencia"
        checked={elegida}
        onChange={onElegir}
        disabled={deshabilitada}
      />
      <span className="que">{titulo}</span>
      <span className="consecuencia">{consecuencia}</span>
    </label>
  );
}

/**
 * Los gramos por kilo son de la persona, no de la dieta.
 *
 * La misma dieta se lee distinta según quién la tenga: 150 g de proteína son
 * 1,9 g/kg en alguien de 78 kg y 2,4 en alguien de 62. Y si la persona de
 * destino no tiene peso puesto, esa fila **desaparece** de la pantalla, que es
 * un cambio que sorprende si no se avisa.
 */
function PesoQueCambia({
  origen,
  destino,
  nombreOrigen,
}: {
  origen: DatosTransferencia["origen"];
  destino: PersonaDestino;
  nombreOrigen: string;
}) {
  const de = origen?.pesoKg ?? null;
  const a = destino.pesoKg;

  if (de === null && a === null) return null;
  if (de !== null && a !== null && de === a) return null;

  if (a === null)
    return (
      <p className="tenue">
        {destino.nombre} no tiene peso puesto, así que la dieta dejará de enseñar los
        gramos por kilo.
      </p>
    );

  if (de === null)
    return (
      <p className="tenue">
        {destino.nombre} pesa {enKg(a)}, así que la dieta pasará a enseñar los gramos
        por kilo.
      </p>
    );

  return (
    <p className="tenue">
      Los gramos por kilo se leerán distintos: {nombreOrigen} pesa {enKg(de)} y{" "}
      {destino.nombre}, {enKg(a)}.
    </p>
  );
}
