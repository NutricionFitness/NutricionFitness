"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  actualizarComponente,
  anadirComponente,
  aplicarAjuste,
  borrarComponente,
  borrarComida,
  crearComida,
  moverComponente,
  cambiarIngrediente,
} from "@/app/dietas/[id]/acciones";
import AnadirComida from "./AnadirComida";
import BuscadorIngrediente from "./BuscadorIngrediente";
import PanelSustitucion from "./PanelSustitucion";
import PlanDeCambios from "./PlanDeCambios";
import OpcionesComida from "./OpcionesComida";
import DietaVacia from "./DietaVacia";
import { IconoAyuda } from "./Iconos";
import type { Alergeno, AlergenosIngrediente } from "@/app/alergenos/consultas";
import type { DatosPlan } from "@/app/dietas/[id]/tipos";
import {
  aComponente,
  aDieta,
  componentesActivos,
  contarComponentes,
  gramosAGuardar,
  opcionActiva,
} from "@/lib/dominio/mapeo";
import { totalesDe } from "@/lib/dominio/totales";
import { objetivoParaCuadrar } from "@/lib/dominio/opciones";
import TotalesDe from "./TotalesDieta";
import { mereceDirigido } from "@/lib/dominio/sustituir";
import {
  conversionDisponible,
  estadosIncoherentes,
  etiquetaMedida,
  type Equivalencia,
} from "@/lib/dominio/medidas";
import type { DietaCompleta } from "@/lib/dominio/tipos";
import {
  ajustar,
  DESCRIPCION,
  energia,
  macros,
  MODOS,
  porcentajes,
  type Modo,
  type Resultado,
} from "@/lib/motor";

const redondear1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Cuánto pesa el reparto de macros frente a no mover la dieta.
 *
 * Era un deslizante de 10 a 500 en la pantalla, y medirlo lo dejó sin
 * argumentos: para mantener el reparto que la dieta ya tiene —lo único que se
 * podía pedir— de 30 en adelante el resultado es idéntico con cualquier margen,
 * y por debajo sale peor en las dos cosas a la vez (más desvío Y más gramos
 * movidos). 470 de sus 490 puntos no hacían nada.
 *
 * Fijado alto a propósito: ahora que se puede pedir un reparto distinto, lo que
 * se pide es lo que se intenta. Con un objetivo lejano, 600 llega a 38,6/39,8/21,5
 * de un 40/38/22 pedido; subir a 1200 solo gana medio punto y mueve 55 g más.
 * Quien limita cuánto se mueve la dieta es el margen por componente, que es un
 * control con unidades y que se entiende.
 */
const FUERZA_MACROS = 600;

/** Coma o punto, los dos valen: la gente escribe «33,3». */
const aNumero = (s: string) => Number(String(s).replace(",", "."));

/** «equitativo_kcal» se lee «Equitativo kcal»: es una opción, no una constante. */
const nombreModo = (m: Modo) => {
  const t = m.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function EditorCompleto({
  filas,
  equivalencias,
  alergias,
  alergenos,
  persona,
  pesoKg,
}: {
  filas: DietaCompleta;
  equivalencias: Equivalencia[];
  alergias: Alergeno[];
  alergenos: Record<number, AlergenosIngrediente>;
  persona: string | null;
  pesoKg: number | null;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  // El motor corre AQUÍ, en el navegador. Un ajuste completo son unas décimas de
  // milisegundo, así que el control de kcal puede responder a cada movimiento sin
  // pedirle nada al servidor.
  const { dieta, idsComponentes } = useMemo(() => aDieta(filas), [filas]);
  const e0 = useMemo(() => energia(dieta), [dieta]);
  const pctActual = useMemo(() => porcentajes(macros(dieta), e0), [dieta, e0]);

  const [objetivo, setObjetivo] = useState(() => Math.round(e0));
  const [modo, setModo] = useState<Modo>("prioridades");
  const [conMacros, setConMacros] = useState(false);
  // false = mantener el reparto que ya tiene; true = pedir uno distinto.
  const [pedirOtro, setPedirOtro] = useState(false);
  const [pedido, setPedido] = useState({ prot: "", hc: "", grasa: "" });
  const [holgura, setHolgura] = useState(40);
  const [sustituyendo, setSustituyendo] = useState<string | null>(null);
  const [datosPlan, setDatosPlan] = useState<DatosPlan | null>(null);
  const [falloGuardar, setFalloGuardar] = useState<string | null>(null);
  const [verLimites, setVerLimites] = useState(false);
  const [ayudaPrioridad, setAyudaPrioridad] = useState<string | null>(null);

  // El bloque de ajuste ocupaba una columna fija a la derecha aunque no se
  // estuviera usando. Ahora entra y sale: la dieta se lee a todo lo ancho y el
  // panel aparece cuando hace falta.
  const [cajon, setCajon] = useState(false);

  useEffect(() => {
    if (!cajon) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCajon(false);
    };
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [cajon]);

  const trio = useMemo(
    () => [aNumero(pedido.prot), aNumero(pedido.hc), aNumero(pedido.grasa)],
    [pedido],
  );
  const sumaPedida = trio.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const pedidoValido =
    trio.every((v) => Number.isFinite(v) && v >= 0) && Math.round(sumaPedida) === 100;

  // El reparto de ahora, redondeado y cuadrado a 100: si se redondea a pelo puede
  // salir 27/47/25, que no suma y el motor lo rechazaría.
  const actualRedondeado = useMemo(() => {
    const p = Math.round(pctActual.prot);
    const h = Math.round(pctActual.hc);
    return [p, h, 100 - p - h];
  }, [pctActual]);

  const opciones = useMemo(
    () => ({
      modo,
      holguraRel: holgura / 100,
      redondear: true,
      fuerzaMacros: FUERZA_MACROS,
      // Nunca se manda un reparto que no sume 100: `gramosObjetivo` lanza
      // `ErrorMotor` y tumbaría la pantalla mientras se está escribiendo.
      macrosObjetivo: !conMacros
        ? null
        : pedirOtro
          ? pedidoValido
            ? { prot: trio[0] / 100, hc: trio[1] / 100, grasa: trio[2] / 100 }
            : null
          : {
              prot: pctActual.prot / 100,
              hc: pctActual.hc / 100,
              grasa: pctActual.grasa / 100,
            },
    }),
    [modo, holgura, conMacros, pedirOtro, pedidoValido, trio, pctActual],
  );

  const resultado: Resultado = useMemo(
    () => ajustar(dieta, objetivo, opciones),
    [dieta, objetivo, opciones],
  );

  // --- índice de los cambios por posición, para pintarlos junto a cada fila ---
  // Arriba y no abajo: lo leen `cuadrarLasDemas` y `guardar`, que están antes.
  const porId = new Map(idsComponentes.map((id, i) => [id, resultado.cambios[i]]));

  const rango = resultado.rangoAlcanzable;
  // ¿Hay propuesta? Se mira lo que se ha PEDIDO, no lo que el motor devuelve.
  //
  // Mirar el resultado parece más listo y es una trampa: `redondearAPasos` cuadra
  // cada componente a su paso de 5 g, así que una dieta con 63, 218 o 123 g
  // «propone» 65, 220 y 125 sin que nadie haya tocado nada. Se probó, y la
  // propuesta salía sola al abrir cualquier dieta con gramos no redondos.
  //
  // Con las kcal no bastaba: desde que se puede pedir un reparto distinto, se
  // puede querer cambiar el reparto SIN mover el total.
  const repartoDistinto =
    conMacros &&
    pedirOtro &&
    pedidoValido &&
    (Math.abs(trio[0] - pctActual.prot) > 0.5 ||
      Math.abs(trio[1] - pctActual.hc) > 0.5 ||
      Math.abs(trio[2] - pctActual.grasa) > 0.5);

  const hayCambios = Math.abs(objetivo - e0) > 0.5 || repartoDistinto;

  /**
   * Deja la dieta como estaba: quita la propuesta.
   *
   * Devuelve a su sitio lo que la produce —el objetivo y el reparto pedido— y no
   * toca el cómo —el modo de reparto y el margen—, que son preferencias de cómo
   * se haría un ajuste, no el ajuste. Sin nada que proponer, esos dos no cambian
   * nada, así que borrarlos solo sería tirar trabajo del usuario.
   */
  function cancelar() {
    setObjetivo(Math.round(e0));
    setConMacros(false);
    setPedirOtro(false);
    setPedido({ prot: "", hc: "", grasa: "" });
  }

  /**
   * Los gramos que le quedan a cada opción NO activa después del ajuste.
   *
   * El motor solo ha movido la combinación activa, porque es la que forma la
   * dieta. Pero las opciones de una comida tienen que seguir valiendo lo mismo
   * entre ellas, así que cada una que no esté activa se cuadra contra lo que le
   * haya quedado a **su comida**: se corre el mismo motor sobre esa opción sola,
   * con las kcal y el reparto nuevos de la comida como objetivo.
   *
   * Devuelve también las que no se han podido cuadrar, para poder decirlo en
   * vez de guardar una dieta cuyas alternativas ya no valen lo mismo.
   */
  function cuadrarLasDemas(): {
    gramos: Array<{ id: string; gramos: number }>;
    rebeldes: string[];
  } {
    const modeloEnergia = filas.modelo_energia ?? "atwater";
    const gramos: Array<{ id: string; gramos: number }> = [];
    const rebeldes: string[] = [];

    for (const comida of [...(filas.comidas ?? [])]) {
      const suyas = comida.opciones ?? [];
      if (suyas.length < 2) continue;

      const activa = opcionActiva(comida);

      // Cómo queda la comida después del ajuste: es el objetivo de las demás.
      const activos = componentesActivos(comida).map((c) => {
        const cambio = porId.get(c.id);
        return {
          ...aComponente(c, comida.nombre),
          gramos: cambio ? cambio.gramosDespues : Number(c.gramos),
        };
      });
      if (!activos.length) continue;
      const objetivoComida = objetivoParaCuadrar(totalesDe(activos, modeloEnergia));

      for (const o of suyas) {
        if (o.id === activa) continue;
        const suyos = [...(comida.componentes ?? [])]
          .filter((c) => c.opcion_id === o.id)
          .sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id));
        if (!suyos.length) continue;

        const res = ajustar(
          {
            componentes: suyos.map((c) => aComponente(c, comida.nombre)),
            modeloEnergia,
          },
          objetivoComida.kcal,
          {
            modo: "prioridades",
            // Ancho a propósito: aquí se cuadra una opción entera contra otras
            // kcal, no se retoca. Con el margen de la pantalla, una opción se
            // quedaría sin sitio para seguir a su comida.
            holguraRel: 2,
            redondear: true,
            fuerzaMacros: FUERZA_MACROS,
            macrosObjetivo: objetivoComida.macrosObjetivo,
          },
        );

        if (!res.factible) {
          rebeldes.push(`${comida.nombre} · ${o.nombre}`);
          continue;
        }
        res.cambios.forEach((c, i) => gramos.push({ id: suyos[i].id, gramos: c.gramosDespues }));
      }
    }

    return { gramos, rebeldes };
  }

  function guardar() {
    const otras = cuadrarLasDemas();
    if (otras.rebeldes.length) {
      setFalloGuardar(
        `No se han podido cuadrar estas opciones con lo que les queda a su comida: ` +
          `${otras.rebeldes.join("; ")}. Ajústalas a mano —o quítales algún tope— y ` +
          "vuelve a guardar; si se guardara así, las alternativas dejarían de valer lo mismo.",
      );
      return;
    }
    setFalloGuardar(null);

    iniciar(async () => {
      const nueva = await aplicarAjuste({
        dietaId: filas.id,
        gramos: [...gramosAGuardar(resultado, idsComponentes), ...otras.gramos],
        nombre: null,
        kcalObjetivo: objetivo,
        kcalOrigen: e0,
        kcalFinal: resultado.energiaFinal,
        modo,
        parametros: { ...opciones, macrosObjetivo: opciones.macrosObjetivo ?? undefined },
        resultado: {
          avisos: resultado.avisos,
          pct_final: resultado.pctFinal,
          macros_final: resultado.macrosFinal,
        },
      });
      router.push(`/dietas/${nueva}`);
    });
  }

  const comidas = [...(filas.comidas ?? [])].sort((a, b) => a.orden - b.orden);

  // --- de dónde viene cada tope -------------------------------------------
  // Un componente sin mín/máx propios NO va suelto: el motor le pone
  // gramos·(1 ± holgura). Por eso salen «tope» ingredientes a los que no se les
  // ha fijado nada, y por eso hay que decir en voz alta de dónde sale el número.
  let topesMargen = 0;
  let topesPropios = 0;
  for (const m of comidas)
    for (const c of m.componentes ?? []) {
      if (!porId.get(c.id)?.enLimite) continue;
      if (c.min_g !== null || c.max_g !== null) topesPropios++;
      else topesMargen++;
    }
  // El motor ya avisa con un «en su límite: a, b, c» que no explica nada; aquí
  // se sustituye por el aviso largo de abajo.
  const avisosMotor = resultado.avisos.filter((a) => !a.startsWith("en su límite:"));

  const nTopes = topesMargen + topesPropios;
  const frasesTope: string[] = [];
  if (topesMargen > 0)
    frasesTope.push(
      topesMargen === 1
        ? `A uno se lo pone el margen por componente de aquí arriba: con ±${holgura}% no puede alejarse más de esa proporción de los gramos que tiene ahora, aunque tú no le hayas fijado nada. Sube el margen para darle más juego.`
        : `A ${topesMargen} se lo pone el margen por componente de aquí arriba: con ±${holgura}% no pueden alejarse más de esa proporción de los gramos que tienen ahora, aunque tú no les hayas fijado nada. Sube el margen para darles más juego.`,
    );
  if (topesPropios > 0)
    frasesTope.push(
      topesMargen > 0
        ? topesPropios === 1
          ? "Otro ha llegado al mínimo o al máximo que le fijaste tú."
          : `Otros ${topesPropios} han llegado al mínimo o al máximo que les fijaste tú.`
        : topesPropios === 1
          ? "Ha llegado al mínimo o al máximo que le fijaste tú."
          : "Han llegado al mínimo o al máximo que les fijaste tú.",
    );

  // La dieta declara si sus cantidades van en crudo o en cocido. Si además
  // contiene alimentos del estado contrario, los gramos no significan lo mismo
  // en todas las filas y conviene decirlo antes de que cuadre un número falso.
  /**
   * Para el modo dirigido del panel de sustitución.
   *
   * Solo se pasa si el reparto pedido es **distinto** del que la dieta ya
   * tiene. Antes se pasaba siempre que estuviera activo el control de macros,
   * y ahí se colaban dos casos en los que el objetivo era el reparto actual o
   * estaba vacío: la distancia de partida es cero y entonces ninguna
   * sustitución puede acercar, así que la respuesta era siempre «ningún cambio
   * acerca al reparto pedido». `mereceDirigido` es esa comprobación, y está en
   * el dominio con sus pruebas.
   *
   * Memorizado, además, porque viaja a las dependencias del efecto del panel.
   */
  const objetivoSustitucion = useMemo(
    () =>
      mereceDirigido(
        resultado.macrosInicial,
        resultado.energiaInicial,
        opciones.macrosObjetivo,
      )
        ? {
            macrosDieta: resultado.macrosInicial,
            energiaDieta: resultado.energiaInicial,
            objetivoPct: opciones.macrosObjetivo!,
          }
        : undefined,
    [resultado.macrosInicial, resultado.energiaInicial, opciones.macrosObjetivo],
  );

  // El total del día sale de los mismos componentes que el motor, en el mismo
  // orden, así que cuadra con la suma de las comidas por construcción.
  const totalDia = useMemo(
    () => totalesDe(dieta.componentes, filas.modelo_energia ?? "atwater"),
    [dieta, filas.modelo_energia],
  );
  const totalDiaPropuesto = hayCambios
    ? totalesDe(
        dieta.componentes.map((c, i) => ({
          ...c,
          gramos: resultado.cambios[i]?.gramosDespues ?? c.gramos,
        })),
        filas.modelo_energia ?? "atwater",
      )
    : null;

  const desajustes = estadosIncoherentes(
    filas.estado_cantidades,
    comidas.flatMap((m) => (m.componentes ?? []).map((c) => c.ingredientes.estado)),
  );

  const reparto = `Proteína ${Math.round(pctActual.prot)}%, hidratos ${Math.round(
    pctActual.hc,
  )}%, grasa ${Math.round(pctActual.grasa)}%`;

  // --- alergias -----------------------------------------------------------
  // Se cruza lo que lleva cada ingrediente con lo que le sienta mal a esta
  // persona. `choques` guarda, por componente, los nombres de los alérgenos, que
  // es lo que hay que poder leer sin abrir nada.
  const nombreAlergeno = new Map(alergias.map((a) => [a.id, a.nombre]));
  // Memorizado porque viaja a `PanelSustitucion`, que lo lleva en las
  // dependencias de su efecto de búsqueda: un `Set` nuevo en cada render hacía
  // que el panel volviera a buscar cada vez que se movía un deslizante.
  const idsAlergia = useMemo(() => new Set(alergias.map((a) => a.id)), [alergias]);

  /**
   * Abre el plan de toda la dieta con una foto de cómo está ahora.
   *
   * La foto se hace aquí, al pulsar, y no se vuelve a hacer: este cajón tiene
   * deslizantes, y un objeto rehecho en cada render dispararía la búsqueda con
   * cada movimiento y cambiaría el plan bajo la mano de quien lo está leyendo.
   */
  function abrirPlan() {
    if (!objetivoSustitucion) return;
    setDatosPlan({
      componentes: comidas.flatMap((m) =>
        (m.componentes ?? []).map((c) => ({
          componenteId: c.id,
          comida: m.nombre,
          ingredienteId: Number(c.ingrediente_id),
          gramos: Number(c.gramos),
          // Bloqueado es «este se queda». Cambiarle el alimento entero sería
          // más gordo todavía que moverle los gramos.
          movible: !c.bloqueado,
        })),
      ),
      ...objetivoSustitucion,
      alergenos: [...idsAlergia],
      conAlergias: idsAlergia.size > 0,
    });
  }
  const choques = new Map<string, string[]>();
  let sinRevisar = 0;

  for (const m of comidas)
    for (const c of m.componentes ?? []) {
      const ficha = alergenos[Number(c.ingrediente_id)];
      if (!ficha) continue;
      if (!ficha.revisado) sinRevisar++;
      const coincide = ficha.alergenos
        .filter((id) => idsAlergia.has(id))
        .map((id) => nombreAlergeno.get(id))
        .filter((n): n is string => !!n);
      if (coincide.length) choques.set(c.id, coincide);
    }

  const alergenosEnJuego = [...new Set([...choques.values()].flat())].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
  // «leche, huevos y frutos de cáscara», no «leche, huevos, frutos de cáscara».
  const enLista = (xs: string[]) =>
    xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`;

  return (
    <>
      {/* ------------------------------------------- la barra que no se va */}
      <div className="barra-dieta">
        <div className="kcal-vivo">
          <strong>{Math.round(e0)}</strong>
          <span>kcal ahora</span>
        </div>

        {/* Los números al lado y no dentro: dentro no caben —la barra mide 108
            px— y un tramo del 3% no puede enseñar su cifra. Al lado se leen
            los tres siempre, que es lo que se pidió, y la barra se queda con
            lo que sabe hacer, que es la proporción de un vistazo. */}
        <span className="reparto-vivo" title={reparto} aria-label={reparto}>
          <span className="mini-macros" role="img" aria-hidden="true">
            <i className="prot" style={{ flex: pctActual.prot, background: "var(--m-prot)" }} />
            <i className="hc" style={{ flex: pctActual.hc, background: "var(--m-hc)" }} />
            <i className="grasa" style={{ flex: pctActual.grasa, background: "var(--m-grasa)" }} />
          </span>
          <span className="cifras" aria-hidden="true">
            <b className="prot">{Math.round(pctActual.prot)}</b>
            <i>/</i>
            <b className="hc">{Math.round(pctActual.hc)}</b>
            <i>/</i>
            <b className="grasa">{Math.round(pctActual.grasa)}</b>
          </span>
        </span>

        {hayCambios && (
          <span className="pastilla avisa">
            objetivo <b>{objetivo}</b>
            <button
              type="button"
              className="quitar-propuesta"
              onClick={cancelar}
              title="Quitar la propuesta y dejar la dieta como está"
              aria-label="Quitar la propuesta"
            >
              ✕
            </button>
          </span>
        )}

        <span className="separa" />

        {/* Los dos botones en su caja: en pantalla estrecha la barra ya venía
            partiéndose en dos filas, y sin agrupar caía uno solo a la segunda,
            suelto a la izquierda. Agrupados bajan juntos y a la derecha. */}
        <span className="acciones-barra">
        <button
          aria-pressed={verLimites}
          title="Enseñar las columnas de mínimo y máximo de cada componente"
          onClick={() => setVerLimites(!verLimites)}
          style={
            verLimites
              ? { background: "var(--acento-suave)", borderColor: "transparent", color: "var(--acento)" }
              : undefined
          }
        >
          Márgenes
        </button>

        <button className="principal" onClick={() => setCajon(true)}>
          Ajustar kcal
        </button>
        </span>
      </div>

      {choques.size > 0 && (
        <div className="alerta-alergia" role="alert">
          <strong>POSIBLE ALERGIA DETECTADA: REVISAR DIETA</strong>
          <p>
            {choques.size === 1
              ? "Un ingrediente de esta dieta lleva "
              : `${choques.size} ingredientes de esta dieta llevan `}
            <strong>{enLista(alergenosEnJuego)}</strong>
            {persona ? `, y ${persona} lo tiene declarado como alergia.` : "."} Va
            {choques.size === 1 ? "" : "n"} señalado{choques.size === 1 ? "" : "s"} abajo,
            en su fila.
          </p>
        </div>
      )}

      {alergias.length > 0 && sinRevisar > 0 && (
        <p className="nota-revision">
          {sinRevisar === 1
            ? "1 ingrediente de esta dieta no tiene los alérgenos revisados"
            : `${sinRevisar} ingredientes de esta dieta no tienen los alérgenos revisados`}
          : lo que se sabe de ellos está deducido de la fuente y del nombre. Sin
          revisar no es lo mismo que sin alérgenos.
        </p>
      )}

      {desajustes.map((d) => (
        <p key={d.estado} className="aviso-caja">
          <span>
            Esta dieta dice llevar las cantidades <strong>en {filas.estado_cantidades}</strong>,
            pero {d.n === 1 ? "hay un ingrediente" : `hay ${d.n} ingredientes`} marcado
            {d.n === 1 ? "" : "s"} como <strong>{d.estado}</strong>. Los gramos no significan lo
            mismo en unas filas que en otras.
          </span>
        </p>
      ))}

      {/* ------------------------------------------------- las comidas */}
      {comidas.map((comida) => {
        // Solo los de la opción que se está viendo. Los de las demás siguen
        // cargados —hacen falta para las pestañas y para comprobar que cuadran—
        // pero no se pintan ni entran en el motor.
        const componentes = componentesActivos(comida);
        const activaId = opcionActiva(comida);
        const opciones = comida.opciones ?? [];

        // Los componentes de cada opción, en formato del motor, para que las
        // pestañas puedan comparar y cuadrar sin volver al servidor.
        const porOpcion: Record<string, ReturnType<typeof aComponente>[]> = {};
        const idsPorOpcion: Record<string, string[]> = {};
        for (const o of opciones) {
          const suyos = [...(comida.componentes ?? [])]
            .filter((c) => c.opcion_id === o.id)
            .sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id));
          porOpcion[o.id] = suyos.map((c) => aComponente(c, comida.nombre));
          idsPorOpcion[o.id] = suyos.map((c) => c.id);
        }

        const pestanas =
          opciones.length > 0 ? (
            <OpcionesComida
              comidaId={comida.id}
              comidaNombre={comida.nombre}
              dietaId={filas.id}
              estadoDieta={filas.estado_cantidades ?? "crudo"}
              opciones={opciones}
              activaId={activaId}
              modeloEnergia={filas.modelo_energia ?? "atwater"}
              porOpcion={porOpcion}
              idsPorOpcion={idsPorOpcion}
              onHecho={() => router.refresh()}
            />
          ) : null;

        if (!componentes.length)
          return (
            <section key={comida.id} className="comida">
              <header>
                <h2>{comida.nombre}</h2>
                <button
                  className="enlace"
                  style={{ fontSize: 13, marginLeft: "auto" }}
                  title="Quitar esta comida"
                  onClick={() =>
                    iniciar(() => borrarComida(comida.id, filas.id).then(() => router.refresh()))
                  }
                >
                  quitar
                </button>
              </header>
              {pestanas}
              <div style={{ padding: "10px 16px 14px" }}>
                <p className="tenue" style={{ margin: 0, fontSize: 13.5 }}>
                  {opciones.length > 1
                    ? "Esta opción no tiene ningún alimento todavía."
                    : "Sin componentes."}
                </p>
                <BuscadorIngrediente
                  alergias={idsAlergia}
                  onElegir={(ingredienteId, gramos) =>
                    iniciar(() =>
                      anadirComponente(comida.id, ingredienteId, gramos, filas.id, activaId).then(() =>
                        router.refresh(),
                      ),
                    )
                  }
                />
              </div>
            </section>
          );

        const kcalComida = componentes.reduce(
          (t, c) => t + (Number(c.gramos) * Number(c.ingredientes.kcal_100)) / 100,
          0,
        );
        const kcalPropuesta = componentes.reduce((t, c) => {
          const cb = porId.get(c.id);
          return t + (cb ? cb.kcalDespues : 0);
        }, 0);

        // Los totales de la comida salen del MOTOR sobre sus componentes, no de
        // una suma escrita aquí: así una comida y su dieta no pueden decir
        // cosas distintas si algún día cambia cómo se calcula la energía.
        const suyos = componentes.map((c) => aComponente(c, comida.nombre));
        const tot = totalesDe(suyos, filas.modelo_energia ?? "atwater");
        const totPropuesto = hayCambios
          ? totalesDe(
              suyos.map((x, i) => ({
                ...x,
                gramos: porId.get(componentes[i].id)?.gramosDespues ?? x.gramos,
              })),
              filas.modelo_energia ?? "atwater",
            )
          : null;

        return (
          <section key={comida.id} className="comida">
            <header>
              <h2>{comida.nombre}</h2>
              <span className="kcal-comida">
                <em>{Math.round(kcalComida)}</em> kcal
                {hayCambios && ` → ${Math.round(kcalPropuesta)}`}
              </span>
            </header>

            {pestanas}

            <div className="tabla">
              <table>
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th className="num">Gramos</th>
                    {hayCambios && <th className="num">Propuesta</th>}
                    <th className="num">kcal</th>
                    <th className="num">
                      <span className="th-ayuda">
                        Prioridad
                        <button
                          className="icono ayuda-boton"
                          aria-expanded={ayudaPrioridad === comida.id}
                          title="Qué es la prioridad"
                          aria-label="Qué es la prioridad"
                          onClick={() =>
                            setAyudaPrioridad(
                              ayudaPrioridad === comida.id ? null : comida.id,
                            )
                          }
                        >
                          <IconoAyuda />
                        </button>
                      </span>
                    </th>
                    {verLimites && <th className="num">Mín</th>}
                    {verLimites && <th className="num">Máx</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ayudaPrioridad === comida.id && (
                    <tr>
                      <td colSpan={9} className="celda-ayuda">
                        <div className="ayuda">
                          <h3>Qué es la prioridad</h3>
                          <p>
                            Es lo dispuesto que está cada ingrediente a absorber el
                            cambio cuando ajustas las kilocalorías. No cambia nada
                            por sí sola: solo decide a quién se le carga la
                            diferencia.
                          </p>
                          <ul>
                            <li>
                              <strong>No tocar</strong> — se queda clavado en sus
                              gramos, pase lo que pase.
                            </li>
                            <li>
                              <strong>Poco</strong> — absorbe la tercera parte que
                              uno normal.
                            </li>
                            <li>
                              <strong>Normal</strong> — la referencia.
                            </li>
                            <li>
                              <strong>Bastante</strong> — el doble que uno normal.
                            </li>
                            <li>
                              <strong>Mucho</strong> — el cuádruple que uno normal.
                            </li>
                          </ul>
                          <p>
                            El reparto va en kilocalorías, no en gramos: si a un
                            ingrediente le tocan el doble de kcal que a otro, los
                            gramos que se mueven dependen de lo que engorde cada uno.
                          </p>
                          <p>
                            Solo se usa con el reparto{" "}
                            <strong>«prioridades»</strong>, que es el que viene
                            puesto. Los otros tres modos la ignoran —reparten a
                            partes iguales o en proporción al tamaño—, pero{" "}
                            <strong>«No tocar» se respeta siempre</strong>.
                          </p>
                          <p>
                            Y por alta que sea la prioridad, ningún ingrediente pasa
                            de su margen: como mucho ±{holgura}% de sus gramos de
                            ahora, o el mínimo y el máximo que le hayas fijado tú.
                          </p>
                          <button
                            className="enlace"
                            onClick={() => setAyudaPrioridad(null)}
                          >
                            Entendido
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {componentes.map((c, i) => {
                    const cambio = porId.get(c.id);
                    const kcal100 = Number(c.ingredientes.kcal_100);
                    const gramos = Number(c.gramos);
                    const etiqueta = etiquetaMedida(gramos, c.ingredientes.medidas_caseras);
                    const conversion = conversionDisponible(
                      c.ingrediente_id,
                      gramos,
                      equivalencias,
                    );

                    // Los mismos números que usa el motor en `limites()`: si el
                    // componente no trae mín/máx propios, el tope es el margen.
                    const topePropio = c.min_g != null || c.max_g != null;
                    const topeMin =
                      c.min_g != null
                        ? Number(c.min_g)
                        : Math.max(0, gramos * (1 - holgura / 100));
                    const topeMax =
                      c.max_g != null
                        ? Number(c.max_g)
                        : gramos * (1 + holgura / 100);
                    const topeAbajo =
                      Boolean(cambio?.enLimite) &&
                      Number(cambio?.gramosDespues) <= topeMin + 0.5;
                    const topeValor = Math.round(topeAbajo ? topeMin : topeMax);
                    const topeTitulo = topePropio
                      ? `Se ha parado en el ${topeAbajo ? "mínimo" : "máximo"} que le fijaste tú: ${topeValor} g.`
                      : `Se ha parado en ${topeValor} g. No tiene mínimo ni máximo propios, así que manda el margen por componente: con ±${holgura}% no puede alejarse más de eso de sus ${Math.round(gramos)} g. Súbelo en «Ajustar kcal» si quieres que se mueva más.`;

                    return (
                      <tr key={c.id}>
                        <td>
                          <Link
                            href={`/ingredientes/${c.ingrediente_id}?dieta=${filas.id}`}
                            className="nombre-ingrediente"
                            title="Ver o corregir su ficha"
                          >
                            {c.ingredientes.nombre}
                          </Link>
                          {choques.has(c.id) && (
                            <span
                              className="chip alergia fuerte"
                              style={{ marginLeft: 8 }}
                              title={`Lleva ${choques.get(c.id)!.join(", ")}`}
                            >
                              POSIBLE ALERGIA
                            </span>
                          )}
                          {c.ingredientes.estado !== "desconocido" && (
                            <span className="chip" style={{ marginLeft: 8 }}>
                              {c.ingredientes.estado}
                            </span>
                          )}
                          {c.bloqueado && (
                            <span className="chip" style={{ marginLeft: 6 }}>
                              bloqueado
                            </span>
                          )}
                          {conversion && (
                            <button
                              className="enlace"
                              style={{ marginLeft: 8, fontSize: 12.5 }}
                              title={`Factor ${conversion.factor.toFixed(2)} deducido del agua que declara BEDCA`}
                              onClick={() =>
                                iniciar(() =>
                                  cambiarIngrediente(
                                    c.id,
                                    conversion.ingredienteDestino,
                                    conversion.gramosDestino,
                                    filas.id,
                                  ).then(() => router.refresh()),
                                )
                              }
                            >
                              → pasar a {conversion.haciaCocido ? "cocido" : "crudo"} (
                              {Math.round(conversion.gramosDestino)} g)
                            </button>
                          )}
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            defaultValue={gramos}
                            min={0}
                            step={1}
                            style={{ width: 82, textAlign: "right" }}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v) && v !== gramos)
                                iniciar(() =>
                                  actualizarComponente(c.id, { gramos: v }, filas.id).then(() =>
                                    router.refresh(),
                                  ),
                                );
                            }}
                          />
                          {etiqueta && <div className="medida">≈ {etiqueta}</div>}
                        </td>
                        {hayCambios && (
                          <td className="num">
                            {cambio ? (
                              <span
                                className={
                                  cambio.deltaG > 0 ? "mas" : cambio.deltaG < 0 ? "menos" : "tenue"
                                }
                              >
                                {Math.round(cambio.gramosDespues)} g
                                {Math.abs(cambio.deltaG) >= 0.5 && (
                                  <small className="tenue">
                                    {" "}
                                    ({cambio.deltaG > 0 ? "+" : ""}
                                    {Math.round(cambio.deltaG)})
                                  </small>
                                )}
                                {cambio.enLimite && (
                                  <span
                                    className="chip tope"
                                    style={{ marginLeft: 6 }}
                                    title={topeTitulo}
                                  >
                                    tope {topeValor} g
                                  </span>
                                )}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        )}
                        <td className="num tenue">{Math.round((gramos * kcal100) / 100)}</td>
                        <td className="num">
                          <select
                            defaultValue={c.bloqueado ? "bloq" : String(Number(c.prioridad))}
                            onChange={(e) => {
                              const v = e.target.value;
                              const cambios =
                                v === "bloq"
                                  ? { bloqueado: true }
                                  : { bloqueado: false, prioridad: Number(v) };
                              iniciar(() =>
                                actualizarComponente(c.id, cambios, filas.id).then(() =>
                                  router.refresh(),
                                ),
                              );
                            }}
                          >
                            <option value="bloq">No tocar</option>
                            <option value="0.3">Poco</option>
                            <option value="1">Normal</option>
                            <option value="2">Bastante</option>
                            <option value="4">Mucho</option>
                          </select>
                        </td>
                        {verLimites && (
                          <>
                            <td className="num">
                              <input
                                type="number"
                                min={0}
                                placeholder="—"
                                defaultValue={c.min_g ?? ""}
                                title="Por debajo de esto no bajará el ajuste"
                                style={{ width: 70, textAlign: "right" }}
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? null : Number(e.target.value);
                                  if (v !== (c.min_g === null ? null : Number(c.min_g)))
                                    iniciar(() =>
                                      actualizarComponente(c.id, { min_g: v }, filas.id).then(() =>
                                        router.refresh(),
                                      ),
                                    );
                                }}
                              />
                            </td>
                            <td className="num">
                              <input
                                type="number"
                                min={0}
                                placeholder="—"
                                defaultValue={c.max_g ?? ""}
                                title="Por encima de esto no subirá el ajuste"
                                style={{ width: 70, textAlign: "right" }}
                                onBlur={(e) => {
                                  const v = e.target.value === "" ? null : Number(e.target.value);
                                  if (v !== (c.max_g === null ? null : Number(c.max_g)))
                                    iniciar(() =>
                                      actualizarComponente(c.id, { max_g: v }, filas.id).then(() =>
                                        router.refresh(),
                                      ),
                                    );
                                }}
                              />
                            </td>
                          </>
                        )}
                        <td>
                          <span className="acciones">
                            <button
                              className="icono"
                              title="Subir"
                              aria-label="Subir"
                              disabled={i === 0}
                              onClick={() =>
                                iniciar(() =>
                                  moverComponente(c.id, comida.id, -1, filas.id).then(() =>
                                    router.refresh(),
                                  ),
                                )
                              }
                            >
                              ↑
                            </button>
                            <button
                              className="icono"
                              title="Bajar"
                              aria-label="Bajar"
                              disabled={i === componentes.length - 1}
                              onClick={() =>
                                iniciar(() =>
                                  moverComponente(c.id, comida.id, 1, filas.id).then(() =>
                                    router.refresh(),
                                  ),
                                )
                              }
                            >
                              ↓
                            </button>
                            <button
                              className="icono"
                              title="Cambiar por otro alimento"
                              aria-label="Cambiar por otro alimento"
                              onClick={() => setSustituyendo(sustituyendo === c.id ? null : c.id)}
                            >
                              ⇄
                            </button>
                            <button
                              className="icono quitar"
                              title="Quitar"
                              aria-label="Quitar"
                              onClick={() =>
                                iniciar(() =>
                                  borrarComponente(c.id, filas.id).then(() => router.refresh()),
                                )
                              }
                            >
                              ✕
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {componentes
                    .filter((c) => c.id === sustituyendo)
                    .map((c) => (
                      <PanelSustitucion
                        key={`sust-${c.id}`}
                        componenteId={c.id}
                        ingredienteId={c.ingrediente_id}
                        nombreActual={c.ingredientes.nombre}
                        grupo={c.ingredientes.grupo}
                        gramos={Number(c.gramos)}
                        dietaId={filas.id}
                        alergias={idsAlergia}
                        objetivo={objetivoSustitucion}
                        onCerrar={() => setSustituyendo(null)}
                        onHecho={() => {
                          setSustituyendo(null);
                          router.refresh();
                        }}
                      />
                    ))}
                </tbody>
              </table>
            </div>

            <TotalesDe
              titulo={comida.nombre}
              tot={tot}
              propuesto={totPropuesto}
              pesoKg={pesoKg}
            />

            <footer>
              <BuscadorIngrediente
                alergias={idsAlergia}
                onElegir={(ingredienteId, gramos) =>
                  iniciar(() =>
                    anadirComponente(comida.id, ingredienteId, gramos, filas.id, activaId).then(() =>
                      router.refresh(),
                    ),
                  )
                }
              />
            </footer>
          </section>
        );
      })}

      <TotalesDe
        titulo="Total del día"
        tot={totalDia}
        propuesto={totalDiaPropuesto}
        pesoKg={pesoKg}
        dia
      />

      <AnadirComida dietaId={filas.id} orden={comidas.length} onHecho={() => router.refresh()} />

      {/* --------------------------------------------------------- el cajón */}
      <div
        className={`velo${cajon ? " abierto" : ""}`}
        onClick={() => setCajon(false)}
        aria-hidden="true"
      />

      <aside
        className={`cajon${cajon ? " abierto" : ""}`}
        role="dialog"
        aria-label="Ajustar las kilocalorías de la dieta"
        aria-hidden={!cajon}
      >
        <header>
          <h2>Ajustar la dieta</h2>
          <button className="cerrar" onClick={() => setCajon(false)} aria-label="Cerrar el panel">
            ✕
          </button>
        </header>

        <div className="cuerpo">
          <div>
            <span className="etiqueta">Ahora</span>
            <div className="cifra-xl">
              {Math.round(e0)}
              <small>kcal</small>
            </div>
            <div className="macro-barra" style={{ marginTop: 10 }} role="img" aria-label={reparto}>
              <span className="prot" style={{ flex: pctActual.prot }}>
                P <b>{Math.round(pctActual.prot)}%</b>
              </span>
              <span className="hc" style={{ flex: pctActual.hc }}>
                HC <b>{Math.round(pctActual.hc)}%</b>
              </span>
              <span className="grasa" style={{ flex: pctActual.grasa }}>
                G <b>{Math.round(pctActual.grasa)}%</b>
              </span>
            </div>
          </div>

          <hr />

          <label className="campo">
            <span className="etiqueta">Objetivo</span>
            <span className="medidor">
              <span className="valor">{objetivo}</span>
              <span className="tenue" style={{ fontSize: 13 }}>
                kcal
              </span>
              <span
                className={
                  "delta " +
                  (objetivo - Math.round(e0) > 0
                    ? "mas"
                    : objetivo - Math.round(e0) < 0
                      ? "menos"
                      : "tenue")
                }
              >
                {objetivo - Math.round(e0) >= 0 ? "+" : ""}
                {objetivo - Math.round(e0)}
              </span>
            </span>
            <input
              type="range"
              min={Math.ceil(rango[0])}
              max={Math.floor(rango[1])}
              value={objetivo}
              onChange={(e) => setObjetivo(Number(e.target.value))}
            />
            <span className="pie">
              <span>{Math.ceil(rango[0])}</span>
              <span>alcanzable</span>
              <span>{Math.floor(rango[1])}</span>
            </span>
          </label>

          <label className="campo">
            <span className="etiqueta">Cómo repartirlo</span>
            <select value={modo} onChange={(e) => setModo(e.target.value as Modo)}>
              {MODOS.map((m) => (
                <option key={m} value={m}>
                  {nombreModo(m)}
                </option>
              ))}
            </select>
            <small>{DESCRIPCION[modo]}</small>
          </label>

          <hr />

          <label className="opcion">
            <input
              type="checkbox"
              checked={conMacros}
              onChange={(e) => setConMacros(e.target.checked)}
            />
            Controlar el reparto de macros
          </label>

          {conMacros && (
            <div className="campo">
              <div className="segs">
                <button
                  type="button"
                  className="seg"
                  aria-pressed={!pedirOtro}
                  onClick={() => setPedirOtro(false)}
                >
                  Mantener el que tiene ahora
                  <b className="cifra"> {actualRedondeado.join(" / ")}</b>
                </button>
                <button
                  type="button"
                  className="seg"
                  aria-pressed={pedirOtro}
                  onClick={() => {
                    // Se arranca del reparto de ahora: es un punto de partida que
                    // ya suma 100 y se ve enseguida qué hay que mover.
                    if (!pedido.prot && !pedido.hc && !pedido.grasa)
                      setPedido({
                        prot: String(actualRedondeado[0]),
                        hc: String(actualRedondeado[1]),
                        grasa: String(actualRedondeado[2]),
                      });
                    setPedirOtro(true);
                  }}
                >
                  Pedir otro
                </button>
              </div>

              {pedirOtro && (
                <>
                  <div className="reparto-pedido">
                    {(
                      [
                        ["prot", "P"],
                        ["hc", "HC"],
                        ["grasa", "G"],
                      ] as const
                    ).map(([clave, etiqueta]) => (
                      <label key={clave}>
                        <span className="etiqueta">{etiqueta}</span>
                        <span className="con-unidad">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.1"
                            inputMode="decimal"
                            value={pedido[clave]}
                            onChange={(e) =>
                              setPedido({ ...pedido, [clave]: e.target.value })
                            }
                          />
                          <span className="unidad">%</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <p className={pedidoValido ? "suma-ok" : "suma-mal"}>
                    {pedidoValido
                      ? "Suman 100. Se está pidiendo ese reparto."
                      : `Los tres tienen que sumar 100 y ahora suman ${
                          Number.isFinite(sumaPedida) ? redondear1(sumaPedida) : 0
                        }. Hasta que sumen, no se pide ningún reparto.`}
                  </p>
                </>
              )}

              <small>
                El reparto va en <strong>porcentaje de la energía</strong>, no en
                gramos. Moviendo cantidades de los mismos alimentos se llega hasta
                donde se llega: si se queda lejos, el resultado lo dirá, y entonces
                lo que hace falta es cambiar algún ingrediente, no más gramos.
                Cuánto puede moverse la dieta para conseguirlo lo decide el margen
                de aquí abajo.
              </small>
            </div>
          )}

          <label className="campo">
            <span className="etiqueta">
              Margen por componente: <b className="cifra">±{holgura}%</b>
            </span>
            <input
              type="range"
              min={5}
              max={300}
              step={5}
              value={holgura}
              onChange={(e) => setHolgura(Number(e.target.value))}
            />
            <small>
              Cuánto puede moverse cada ingrediente respecto a los gramos que tiene
              ahora: con ±{holgura}%, uno de 100 g se queda entre{" "}
              {Math.max(0, 100 - holgura)} y {100 + holgura} g.{" "}
              <strong>Este es el tope</strong> de todos los que no tengan un mínimo y un
              máximo propios. Estrecho, cambios pequeños y puede que no se llegue al
              objetivo; ancho, más sitio para cuadrarlo.
              {holgura >= 100 &&
                " Del 100% para arriba el mínimo ya es 0 g: lo único que sigue creciendo es el máximo."}
            </small>
          </label>

          <hr />

          {!resultado.factible ? (
            <p className="aviso" style={{ margin: 0 }}>
              {resultado.motivo}
            </p>
          ) : (
            <div>
              <span className="etiqueta">Resultado</span>
              <div className="medidor" style={{ marginTop: 2 }}>
                <span className="valor">{Math.round(resultado.energiaFinal)}</span>
                <span className="tenue" style={{ fontSize: 13 }}>
                  kcal
                </span>
                <span className="delta tenue">
                  ({resultado.errorKcal >= 0 ? "+" : ""}
                  {redondear1(resultado.errorKcal)})
                </span>
              </div>
              <div className="macro-barra" style={{ marginTop: 10, height: 20 }} role="img"
                aria-label={`Reparto resultante: proteína ${Math.round(resultado.pctFinal.prot)}%, hidratos ${Math.round(resultado.pctFinal.hc)}%, grasa ${Math.round(resultado.pctFinal.grasa)}%`}
              >
                <span className="prot" style={{ flex: resultado.pctFinal.prot }}>
                  <b>{Math.round(resultado.pctFinal.prot)}%</b>
                </span>
                <span className="hc" style={{ flex: resultado.pctFinal.hc }}>
                  <b>{Math.round(resultado.pctFinal.hc)}%</b>
                </span>
                <span className="grasa" style={{ flex: resultado.pctFinal.grasa }}>
                  <b>{Math.round(resultado.pctFinal.grasa)}%</b>
                </span>
              </div>
              {avisosMotor.map((a, i) => (
                <p key={i} className="aviso" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
                  {a}
                </p>
              ))}

              {/* El aviso dice «haría falta sustituir ingredientes» y ahí se
                  acababa: quien lo leía tenía que ir abriendo el panel de fila
                  en fila para averiguar CUÁL. Esto lo contesta. */}
              {objetivoSustitucion &&
                avisosMotor.some((a) => a.includes("sustituir ingredientes")) && (
                  <button type="button" className="boton-plan" onClick={abrirPlan}>
                    Ver qué ingredientes cambiar
                  </button>
                )}

              {hayCambios && nTopes > 0 && (
                <div className="nota-tope">
                  <strong>
                    {nTopes === 1
                      ? "Un ingrediente se ha quedado en su tope"
                      : `${nTopes} ingredientes se han quedado en su tope`}
                  </strong>
                  {frasesTope.map((f, i) => (
                    <p key={i}>{f}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <footer>
          {falloGuardar && <p className="aviso">{falloGuardar}</p>}
          {resultado.factible && (
            <button className="principal" onClick={guardar} disabled={!hayCambios || pendiente}>
              {pendiente ? "Guardando…" : "Guardar como nueva versión"}
            </button>
          )}
          {hayCambios && (
            <button
              type="button"
              onClick={cancelar}
              disabled={pendiente}
              title="Deja la dieta como está. No borra nada de lo guardado."
              style={{ justifyContent: "center" }}
            >
              Cancelar el ajuste
            </button>
          )}
          <p className="tenue" style={{ fontSize: 12, margin: 0, lineHeight: 1.45 }}>
            {hayCambios
              ? "El cálculo corre en tu navegador: mover el control no consulta al servidor."
              : "Mueve el objetivo, o pide un reparto, para ver una propuesta."}{" "}
            <Link href="/personas">Volver</Link>
          </p>
        </footer>
      </aside>

      {datosPlan && (
        <PlanDeCambios
          datos={datosPlan}
          dietaId={filas.id}
          onCerrar={() => setDatosPlan(null)}
          onHecho={() => {
            setDatosPlan(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}


/**
 * Punto de entrada.
 *
 * No lleva hooks a propósito: decide cuál de los dos editores toca y delega. Una
 * dieta sin componentes no puede pasar por `aDieta`, porque el motor exige al
 * menos uno; intentarlo era lo que reventaba la pantalla al crear una dieta
 * nueva.
 */
export default function EditorDieta({
  dieta: filas,
  equivalencias = [],
  alergias = [],
  alergenos = {},
  persona = null,
  pesoKg = null,
}: {
  dieta: DietaCompleta;
  equivalencias?: Equivalencia[];
  alergias?: Alergeno[];
  alergenos?: Record<number, AlergenosIngrediente>;
  persona?: string | null;
  /** Para leer los macros en gramos por kilo. Nulo si no se sabe. */
  pesoKg?: number | null;
}) {
  return contarComponentes(filas) === 0 ? (
    <DietaVacia filas={filas} />
  ) : (
    <EditorCompleto
      filas={filas}
      equivalencias={equivalencias}
      alergias={alergias}
      alergenos={alergenos}
      persona={persona}
      pesoKg={pesoKg}
    />
  );
}
