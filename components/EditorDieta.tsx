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
import DietaVacia from "./DietaVacia";
import { IconoAyuda } from "./Iconos";
import { aDieta, contarComponentes, gramosAGuardar } from "@/lib/dominio/mapeo";
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

function EditorCompleto({
  filas,
  equivalencias,
}: {
  filas: DietaCompleta;
  equivalencias: Equivalencia[];
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
  const [fuerza, setFuerza] = useState(60);
  const [holgura, setHolgura] = useState(40);
  const [sustituyendo, setSustituyendo] = useState<string | null>(null);
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

  const opciones = useMemo(
    () => ({
      modo,
      holguraRel: holgura / 100,
      redondear: true,
      fuerzaMacros: fuerza,
      macrosObjetivo: conMacros
        ? {
            prot: pctActual.prot / 100,
            hc: pctActual.hc / 100,
            grasa: pctActual.grasa / 100,
          }
        : null,
    }),
    [modo, holgura, fuerza, conMacros, pctActual],
  );

  const resultado: Resultado = useMemo(
    () => ajustar(dieta, objetivo, opciones),
    [dieta, objetivo, opciones],
  );

  const rango = resultado.rangoAlcanzable;
  const hayCambios = Math.abs(objetivo - e0) > 0.5;

  function guardar() {
    iniciar(async () => {
      const nueva = await aplicarAjuste({
        dietaId: filas.id,
        gramos: gramosAGuardar(resultado, idsComponentes),
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

  // --- índice de los cambios por posición, para pintarlos junto a cada fila ---
  const porId = new Map(idsComponentes.map((id, i) => [id, resultado.cambios[i]]));
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
  // Para el modo dirigido del panel de sustitución: si se está pidiendo un
  // reparto de macros, se le pasa para que proponga los cambios que acercan.
  const objetivoSustitucion = conMacros
    ? {
        macrosDieta: resultado.macrosInicial,
        energiaDieta: resultado.energiaInicial,
        objetivoPct: opciones.macrosObjetivo ?? {},
      }
    : undefined;

  const desajustes = estadosIncoherentes(
    filas.estado_cantidades,
    comidas.flatMap((m) => (m.componentes ?? []).map((c) => c.ingredientes.estado)),
  );

  const reparto = `Proteína ${Math.round(pctActual.prot)}%, hidratos ${Math.round(
    pctActual.hc,
  )}%, grasa ${Math.round(pctActual.grasa)}%`;

  return (
    <>
      {/* ------------------------------------------- la barra que no se va */}
      <div className="barra-dieta">
        <div className="kcal-vivo">
          <strong>{Math.round(e0)}</strong>
          <span>kcal ahora</span>
        </div>

        <div className="mini-macros" role="img" aria-label={reparto} title={reparto}>
          <i className="prot" style={{ flex: pctActual.prot, background: "var(--m-prot)" }} />
          <i className="hc" style={{ flex: pctActual.hc, background: "var(--m-hc)" }} />
          <i className="grasa" style={{ flex: pctActual.grasa, background: "var(--m-grasa)" }} />
        </div>

        {hayCambios && (
          <span className="pastilla avisa">
            objetivo <b>{objetivo}</b>
          </span>
        )}

        <span className="separa" />

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
      </div>

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
        const componentes = [...(comida.componentes ?? [])].sort((a, b) => a.orden - b.orden);

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
              <div style={{ padding: "10px 16px 14px" }}>
                <p className="tenue" style={{ margin: 0, fontSize: 13.5 }}>
                  Sin componentes.
                </p>
                <BuscadorIngrediente
                  onElegir={(ingredienteId, gramos) =>
                    iniciar(() =>
                      anadirComponente(comida.id, ingredienteId, gramos, filas.id).then(() =>
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

        return (
          <section key={comida.id} className="comida">
            <header>
              <h2>{comida.nombre}</h2>
              <span className="kcal-comida">
                <em>{Math.round(kcalComida)}</em> kcal
                {hayCambios && ` → ${Math.round(kcalPropuesta)}`}
              </span>
            </header>

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
                          {c.ingredientes.nombre}
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

            <footer>
              <BuscadorIngrediente
                onElegir={(ingredienteId, gramos) =>
                  iniciar(() =>
                    anadirComponente(comida.id, ingredienteId, gramos, filas.id).then(() =>
                      router.refresh(),
                    ),
                  )
                }
              />
            </footer>
          </section>
        );
      })}

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
                  {m.replace(/_/g, " ")}
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
            Mantener el reparto de macros
          </label>

          {conMacros && (
            <label className="campo">
              <span className="etiqueta">
                Cuánto puede cambiar la dieta: <b className="cifra">{fuerza}</b>
              </span>
              <input
                type="range"
                min={10}
                max={500}
                step={10}
                value={fuerza}
                onChange={(e) => setFuerza(Number(e.target.value))}
              />
              <small>
                Cuánto vale respetar el reparto de macros frente a no alejarse de la
                dieta que ya tienes. Bajo, apenas mueve los gramos y el reparto queda
                como salga; alto, se acerca al reparto que le pides aunque tenga que
                cambiar mucho más. Solo cuenta con «Mantener el reparto de macros»
                marcado.
              </small>
            </label>
          )}

          <label className="campo">
            <span className="etiqueta">
              Margen por componente: <b className="cifra">±{holgura}%</b>
            </span>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={holgura}
              onChange={(e) => setHolgura(Number(e.target.value))}
            />
            <small>
              Cuánto puede moverse cada ingrediente respecto a los gramos que tiene
              ahora: con ±{holgura}%, uno de 100 g se queda entre {100 - holgura} y{" "}
              {100 + holgura} g. <strong>Este es el tope</strong> de todos los que no
              tengan un mínimo y un máximo propios. Estrecho, cambios pequeños y puede
              que no se llegue al objetivo; ancho, más sitio para cuadrarlo.
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
          {resultado.factible && (
            <button className="principal" onClick={guardar} disabled={!hayCambios || pendiente}>
              {pendiente ? "Guardando…" : "Guardar como nueva versión"}
            </button>
          )}
          <p className="tenue" style={{ fontSize: 12, margin: 0, lineHeight: 1.45 }}>
            {hayCambios
              ? "El cálculo corre en tu navegador: mover el control no consulta al servidor."
              : "Mueve el objetivo para ver una propuesta."}{" "}
            <Link href="/personas">Volver</Link>
          </p>
        </footer>
      </aside>
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
}: {
  dieta: DietaCompleta;
  equivalencias?: Equivalencia[];
}) {
  return contarComponentes(filas) === 0 ? (
    <DietaVacia filas={filas} />
  ) : (
    <EditorCompleto filas={filas} equivalencias={equivalencias} />
  );
}
