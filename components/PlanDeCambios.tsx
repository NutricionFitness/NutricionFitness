"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { aplicarPlan, buscarPlanDeCambios } from "@/app/dietas/[id]/acciones";
import type { DatosPlan, PlanDeCambios as Plan } from "@/app/dietas/[id]/tipos";
import { desvios } from "@/lib/dominio/plan-sustitucion";
import type { Macros } from "@/lib/dominio/sustituir";

/** Un decimal, con coma: la app escribe en español. */
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("es-ES");

/**
 * Qué cambiar en toda la dieta para llegar al reparto pedido.
 *
 * Sale cuando el motor dice que moviendo gramos no da más de sí. El panel de
 * una fila ya contestaba «¿por qué cambio este alimento?»; lo que faltaba era
 * la pregunta de antes —**¿cuál cambio?**—, que con doce componentes no se
 * contesta abriendo doce paneles.
 *
 * Tres decisiones que se ven en pantalla:
 *
 *  · **Una cadena, no un cambio.** Un solo cambio casi nunca llega. Cada paso
 *    se calcula sobre el resultado del anterior, así que se aplican en orden y
 *    la mejora que anuncia cada uno es la que da estando los de arriba hechos.
 *  · **Se puede decir que no a cada cosa.** Un plan puede ser correcto y
 *    ridículo —437 g de berberechos para cenar—, y adivinar qué es razonable
 *    depende de la persona. En vez de adivinar, se descarta y se recalcula.
 *  · **Se dice a dónde se llega**, incluso cuando no se llega. Si con tres
 *    cambios queda a diez puntos, eso es lo que pone.
 *
 * Va en un `<dialog>` con `showModal()` porque el cajón de ajuste tiene
 * `overflow` y `transform`, y cualquier cosa posicionada dentro se recorta.
 */
export default function PlanDeCambios({
  datos,
  dietaId,
  onCerrar,
  onHecho,
}: {
  /** La foto de la dieta, hecha al pulsar el botón y sin rehacerse. */
  datos: DatosPlan;
  dietaId: string;
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [excluir, setExcluir] = useState<string[]>([]);
  const [sinEstos, setSinEstos] = useState<Array<{ id: number; nombre: string }>>([]);
  const [fallo, setFallo] = useState<string | null>(null);
  const [algoAplicado, setAlgoAplicado] = useState(false);
  const [pendiente, iniciar] = useTransition();

  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Ojo con las dependencias: aquí solo entra lo que NO escribe este efecto.
  // Meter el estado que él mismo pone —«cargando»— y cancelarse en la limpieza
  // es lo que dejó el escáner remoto sin entregar nada.
  useEffect(() => {
    let vigente = true;
    setPlan(null);
    buscarPlanDeCambios({
      componentes: datos.componentes,
      macrosDieta: datos.macrosDieta,
      energiaDieta: datos.energiaDieta,
      objetivoPct: datos.objetivoPct,
      alergenos: datos.alergenos,
      excluir,
      sinEstos: sinEstos.map((x) => x.id),
    }).then((p) => {
      if (vigente) setPlan(p);
    });
    return () => {
      vigente = false;
    };
  }, [datos, excluir, sinEstos]);

  /**
   * Cerrar. Si se llegó a aplicar algo, además hay que refrescar la pantalla:
   * la dieta que hay debajo ya no es la que se está viendo.
   */
  const cerrar = () => {
    dialogo.current?.close();
    if (algoAplicado) onHecho();
    else onCerrar();
  };

  function aplicar() {
    if (!plan?.pasos.length) return;
    setFallo(null);
    iniciar(async () => {
      const r = await aplicarPlan(
        plan.pasos.map((p) => ({
          componenteId: p.componenteId,
          ingredienteId: p.candidato.id,
          gramos: p.gramos,
        })),
        dietaId,
      );
      if (r.aplicados > 0) setAlgoAplicado(true);

      if (r.error) {
        // Sin cerrar: si se cerrara, el aviso se iría con el diálogo y lo
        // aplicado a medias no se lo habría contado nadie.
        setFallo(
          r.aplicados === 0
            ? `No se ha podido aplicar ningún cambio: ${r.error}`
            : `Se han aplicado los ${r.aplicados} primeros cambios y el siguiente ha ` +
              `fallado: ${r.error}. Lo aplicado es correcto —cada cambio se sostiene ` +
              "solo—; cierra y vuelve a pedir el plan para el resto.",
        );
        return;
      }
      dialogo.current?.close();
      onHecho();
    });
  }

  const n = plan?.pasos.length ?? 0;
  const hayDescartes = excluir.length > 0 || sinEstos.length > 0;
  const queda = plan ? enQueFalla(plan.pctFinal, datos.objetivoPct) : null;

  return (
    <dialog ref={dialogo} className="plan-cambios" onClose={onCerrar} onCancel={onCerrar}>
      <header>
        <h2>Qué cambiar para llegar al reparto</h2>
        <button type="button" className="enlace" onClick={cerrar}>
          cerrar
        </button>
      </header>

      {plan && (
        <p className="de-a">
          <Reparto p={plan.pctInicial} /> <span aria-hidden>→</span>{" "}
          <Objetivo o={datos.objetivoPct} />
          {/* Sin viñeta delante: en el móvil esto cae a su propia línea y un
              «·» suelto al principio de la línea no significa nada.
              Y en palabras, no en una distancia: «a 30,1 puntos» no dice dónde
              falta ni dónde sobra, que es lo único que se puede accionar. */}
          <span className="tenue">
            {enQueFalla(plan.pctInicial, datos.objetivoPct) ?? "es lo que pides"}
          </span>
        </p>
      )}

      {plan === null ? (
        <p className="suave" style={{ margin: "14px 0" }}>
          Mirando toda la dieta…
        </p>
      ) : n === 0 ? (
        <p className="suave" style={{ margin: "14px 0" }}>
          {hayDescartes
            ? "Con lo que queda sin descartar no hay ningún cambio que acerque al reparto pedido. Devuelve alguno de los de abajo."
            : plan.mirados === 0
              ? "Todos los componentes de la dieta están bloqueados, así que no hay nada que proponer. Desbloquea alguno."
              : "Ningún cambio de un solo alimento acerca al reparto pedido. O ya estás muy cerca, o el reparto que pides está fuera de lo que da de sí este catálogo."}
        </p>
      ) : (
        <>
          <ol className="pasos">
            {plan.pasos.map((s, i) => (
              <li key={s.componenteId}>
                <div className="cabeza">
                  <span className="orden">{i + 1}</span>
                  <div className="cambio">
                    <span className="tenue">{s.comida}</span>
                    <div>
                      <s>{s.actual.nombre}</s>{" "}
                      <span aria-hidden>→</span>{" "}
                      <strong>
                        {Math.round(s.gramos)} g de {s.candidato.nombre}
                      </strong>
                      {datos.conAlergias && !s.revisado && (
                        <span className="chip" title="Lo que se sabe de sus alérgenos está deducido de la fuente y del nombre, no comprobado a mano.">
                          alérgenos sin revisar
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className="acerca"
                    title={
                      "Cuánto acerca este cambio, sumando lo que corrige en los tres " +
                      "macros. Un punto es un 1% de las kilocalorías del día."
                    }
                  >
                    +{n1(s.mejora)} pt
                  </span>
                </div>

                <div className="pie">
                  <span className="tenue">queda en</span>
                  <Reparto p={s.pct} pequeno />
                  {/* Las dos juntas en su caja: si caben en la línea van a
                      la derecha, y si no, bajan las dos, no una sola. */}
                  <span className="acciones">
                    <button
                      type="button"
                      className="enlace"
                      disabled={pendiente}
                      onClick={() =>
                        // Devolver el mismo array si ya estaba es lo que evita
                        // un render —y una búsqueda— que no cambiaría nada.
                        setExcluir((v) =>
                          v.includes(s.componenteId) ? v : [...v, s.componenteId],
                        )
                      }
                      title="Buscar otro plan que no toque este componente"
                    >
                      no cambiar este
                    </button>
                    <button
                      type="button"
                      className="enlace"
                      disabled={pendiente}
                      onClick={() =>
                        setSinEstos((v) =>
                          v.some((x) => x.id === s.candidato.id)
                            ? v
                            : [...v, { id: s.candidato.id, nombre: s.candidato.nombre }],
                        )
                      }
                      title={`No volver a proponer ${s.candidato.nombre} en este plan`}
                    >
                      otro sustituto
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ol>

          <p className="llegada">
            Con {n === 1 ? "este cambio" : `estos ${n} cambios`} la dieta queda en{" "}
            <Reparto p={plan.pctFinal} />
            {queda === null ? (
              <>: <strong>justo lo que pides</strong>.</>
            ) : (
              <>
                : todavía <strong>{queda}</strong>.
                {plan.motivo === "tope" && plan.distanciaFinal > 2
                  ? " Más cerca no llega con tres cambios: aplícalos y vuelve a pedir el" +
                    " plan, o pide un reparto menos lejano."
                  : ""}
              </>
            )}
          </p>
        </>
      )}

      {plan && plan.fueraPorAlergia > 0 && (
        <p className="tenue nota">
          {plan.fueraPorAlergia === 1
            ? "1 alimento se ha dejado fuera de la propuesta"
            : `${plan.fueraPorAlergia} alimentos se han dejado fuera de la propuesta`}{" "}
          por chocar con las alergias declaradas.
        </p>
      )}

      {hayDescartes && (
        <div className="descartes">
          <span className="tenue">Descartado:</span>
          {excluir.map((id) => {
            const c = datos.componentes.find((x) => x.componenteId === id);
            return (
              <button
                key={id}
                type="button"
                className="chip quitable"
                onClick={() => setExcluir((v) => v.filter((x) => x !== id))}
                title="Volver a tenerlo en cuenta"
              >
                no tocar {c?.comida ?? "un componente"} <span aria-hidden>✕</span>
              </button>
            );
          })}
          {sinEstos.map((x) => (
            <button
              key={x.id}
              type="button"
              className="chip quitable"
              onClick={() => setSinEstos((v) => v.filter((y) => y.id !== x.id))}
              title="Volver a proponerlo"
            >
              {x.nombre} <span aria-hidden>✕</span>
            </button>
          ))}
        </div>
      )}

      {fallo && <p className="aviso">{fallo}</p>}

      <footer>
        {/* Con un fallo a medias no se puede volver a pulsar: los primeros
            cambios ya están puestos y repetirlos sería deshacerlos. */}
        <button
          type="button"
          className="principal"
          disabled={!n || pendiente || Boolean(fallo)}
          onClick={aplicar}
        >
          {pendiente
            ? "Aplicando…"
            : n === 1
              ? "Aplicar el cambio"
              : `Aplicar los ${n} cambios`}
        </button>
        <button type="button" onClick={cerrar} disabled={pendiente}>
          {algoAplicado ? "Cerrar" : "Cancelar"}
        </button>
        <p className="tenue">
          Un <b>punto</b> es un 1% de las kilocalorías del día: si pides un 35% de
          proteína y te quedas en el 31%, te faltan cuatro puntos. Los cambios se
          aplican en orden y no mueven las kilocalorías: cada cantidad es la que aporta
          la misma energía que lo que había. Los gramos de la dieta no se tocan; el ajuste
          de kcal se hace después, como siempre.
        </p>
      </footer>
    </dialog>
  );
}

const NOMBRE_MACRO = { prot: "proteína", hc: "hidratos", grasa: "grasa" } as const;

/** «a, b y c», no «a, b, c». */
const enLista = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`;

/**
 * En qué se queda corto el reparto, dicho en palabras.
 *
 * Antes aquí ponía «a 30,1 puntos de lo pedido» y Carlos preguntó, con razón,
 * puntos de qué. Un número que hay que preguntar no vale, y además ese número
 * es peor de lo que parece por dos motivos:
 *
 *  · **no señala nada**: es la suma de las tres desviaciones, así que no dice
 *    si falta proteína o sobra grasa, que es lo único que se puede accionar; y
 *  · **cuenta doble**: los dos repartos suman 100, así que lo que falta y lo
 *    que sobra son el mismo número y la distancia los suma los dos. «30
 *    puntos» son quince que faltan y quince que sobran.
 *
 * Devuelve null cuando no hay nada que decir —todo por debajo de medio punto—,
 * para que quien llama escriba «justo lo que pides» en vez de «te faltan 0,0».
 */
function enQueFalla(pct: Macros, objetivo: Partial<Macros>): string | null {
  const d = desvios(pct, objetivo);
  if (!d.length) return null;

  const falta = d.filter((x) => x.puntos < 0);
  const sobra = d.filter((x) => x.puntos > 0);

  // «puntos» se dice una sola vez, en la primera cifra: repetirlo en las tres
  // convierte una frase en un formulario.
  const cifras = (xs: typeof d, conUnidad: boolean) =>
    xs.map((x, i) => {
      const v = Math.abs(x.puntos);
      const unidad = i === 0 && conUnidad ? (v.toFixed(1) === "1.0" ? " punto" : " puntos") : "";
      return `${n1(v)}${unidad} de ${NOMBRE_MACRO[x.macro]}`;
    });

  const uno = (xs: typeof d) => xs.length === 1 && Math.abs(xs[0].puntos).toFixed(1) === "1.0";

  const partes: string[] = [];
  if (falta.length)
    partes.push(`${uno(falta) ? "falta" : "faltan"} ${enLista(cifras(falta, true))}`);
  if (sobra.length)
    partes.push(
      `${uno(sobra) ? "sobra" : "sobran"} ${enLista(cifras(sobra, partes.length === 0))}`,
    );

  // Punto y coma entre las dos mitades: con «y» salen tres seguidas.
  return partes.join("; ");
}

/** «25/50/25» con los colores de siempre. */
function Reparto({ p, pequeno }: { p: Macros; pequeno?: boolean }) {
  const t = `Proteína ${Math.round(p.prot)}%, hidratos ${Math.round(
    p.hc,
  )}%, grasa ${Math.round(p.grasa)}%`;
  return (
    <span className={pequeno ? "reparto pequeno" : "reparto"} title={t} aria-label={t}>
      <b className="prot">{Math.round(p.prot)}</b>
      <i>/</i>
      <b className="hc">{Math.round(p.hc)}</b>
      <i>/</i>
      <b className="grasa">{Math.round(p.grasa)}</b>
    </span>
  );
}

/** El reparto pedido, que puede venir a medias: «35/–/–» si solo se pidió proteína. */
function Objetivo({ o }: { o: Partial<Macros> }) {
  const v = (x: number | undefined) =>
    x === undefined ? "–" : String(Math.round(x <= 1.5 ? x * 100 : x));
  return (
    <span className="reparto pedido" title="El reparto que has pedido">
      <b className="prot">{v(o.prot)}</b>
      <i>/</i>
      <b className="hc">{v(o.hc)}</b>
      <i>/</i>
      <b className="grasa">{v(o.grasa)}</b>
    </span>
  );
}
