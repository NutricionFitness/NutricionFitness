"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  actualizarComponente,
  anadirComponente,
  aplicarAjuste,
  borrarComponente,
  convertirComponente,
} from "@/app/dietas/[id]/acciones";
import BuscadorIngrediente from "./BuscadorIngrediente";
import DietaVacia from "./DietaVacia";
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

  // La dieta declara si sus cantidades van en crudo o en cocido. Si además
  // contiene alimentos del estado contrario, los gramos no significan lo mismo
  // en todas las filas y conviene decirlo antes de que cuadre un número falso.
  const desajustes = estadosIncoherentes(
    filas.estado_cantidades,
    comidas.flatMap((m) => (m.componentes ?? []).map((c) => c.ingredientes.estado)),
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 24 }}>
      {/* ------------------------------------------------ tabla de la dieta */}
      <div>
        {desajustes.map((d) => (
          <p key={d.estado} className="aviso" style={{ marginTop: 0 }}>
            Esta dieta dice llevar las cantidades <strong>en {filas.estado_cantidades}</strong>, pero{" "}
            {d.n === 1 ? "hay un ingrediente" : `hay ${d.n} ingredientes`} marcado
            {d.n === 1 ? "" : "s"} como <strong>{d.estado}</strong>. Los gramos no
            significan lo mismo en unas filas que en otras.
          </p>
        ))}
        {comidas.map((comida) => {
          const componentes = [...(comida.componentes ?? [])].sort((a, b) => a.orden - b.orden);
          if (!componentes.length)
            return (
              <section key={comida.id}>
                <h2>{comida.nombre}</h2>
                <p className="vacio" style={{ padding: "8px 0" }}>Sin componentes.</p>
                <BuscadorIngrediente
                  onElegir={(ingredienteId, gramos) =>
                    iniciar(() =>
                      anadirComponente(comida.id, ingredienteId, gramos, filas.id).then(() =>
                        router.refresh(),
                      ),
                    )
                  }
                />
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
            <section key={comida.id}>
              <h2>
                {comida.nombre}{" "}
                <span className="suave" style={{ fontWeight: 400, fontSize: 14 }}>
                  {Math.round(kcalComida)} kcal
                  {hayCambios && ` → ${Math.round(kcalPropuesta)}`}
                </span>
              </h2>
              <table>
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th className="num">Gramos</th>
                    {hayCambios && <th className="num">Propuesta</th>}
                    <th className="num">kcal</th>
                    <th className="num">Prioridad</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {componentes.map((c) => {
                    const cambio = porId.get(c.id);
                    const kcal100 = Number(c.ingredientes.kcal_100);
                    const gramos = Number(c.gramos);
                    const etiqueta = etiquetaMedida(gramos, c.ingredientes.medidas_caseras);
                    const conversion = conversionDisponible(
                      c.ingrediente_id,
                      gramos,
                      equivalencias,
                    );
                    return (
                      <tr key={c.id}>
                        <td>
                          {c.ingredientes.nombre}
                          {c.ingredientes.estado !== "desconocido" && (
                            <span className="chip" style={{ marginLeft: 8 }}>
                              {c.ingredientes.estado}
                            </span>
                          )}
                          {c.bloqueado && <span className="chip" style={{ marginLeft: 6 }}>bloqueado</span>}
                          {conversion && (
                            <button
                              className="enlace"
                              style={{ marginLeft: 8, fontSize: 12 }}
                              title={`Factor ${conversion.factor.toFixed(2)} deducido del agua que declara BEDCA`}
                              onClick={() =>
                                iniciar(() =>
                                  convertirComponente(
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
                            style={{ width: 78, textAlign: "right" }}
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
                          {etiqueta && (
                            <div className="suave" style={{ fontSize: 11 }}>≈ {etiqueta}</div>
                          )}
                        </td>
                        {hayCambios && (
                          <td className="num">
                            {cambio ? (
                              <span className={cambio.deltaG > 0 ? "mas" : cambio.deltaG < 0 ? "menos" : "suave"}>
                                {Math.round(cambio.gramosDespues)} g
                                {Math.abs(cambio.deltaG) >= 0.5 && (
                                  <small className="suave">
                                    {" "}
                                    ({cambio.deltaG > 0 ? "+" : ""}
                                    {Math.round(cambio.deltaG)})
                                  </small>
                                )}
                                {cambio.enLimite && <span className="chip" style={{ marginLeft: 6 }}>tope</span>}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        )}
                        <td className="num suave">{Math.round((gramos * kcal100) / 100)}</td>
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
                        <td className="num">
                          <button
                            title="Quitar"
                            onClick={() =>
                              iniciar(() =>
                                borrarComponente(c.id, filas.id).then(() => router.refresh()),
                              )
                            }
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <BuscadorIngrediente
                onElegir={(ingredienteId, gramos) =>
                  iniciar(() =>
                    anadirComponente(comida.id, ingredienteId, gramos, filas.id).then(() =>
                      router.refresh(),
                    ),
                  )
                }
              />
            </section>
          );
        })}
      </div>

      {/* ------------------------------------------------------ panel lateral */}
      <aside style={{ position: "sticky", top: 16, alignSelf: "start" }}>
        <div className="tarjeta rejilla">
          <div>
            <div className="suave" style={{ fontSize: 13 }}>Ahora</div>
            <div style={{ fontSize: 26, fontWeight: 650, letterSpacing: "-0.02em" }}>
              {Math.round(e0)} kcal
            </div>
            <div className="suave" style={{ fontSize: 13 }}>
              {Math.round(pctActual.prot)} / {Math.round(pctActual.hc)} /{" "}
              {Math.round(pctActual.grasa)}% · P/HC/G
            </div>
          </div>

          <label>
            Objetivo: <strong>{objetivo} kcal</strong>{" "}
            <span className="suave">
              ({objetivo - Math.round(e0) >= 0 ? "+" : ""}
              {objetivo - Math.round(e0)})
            </span>
            <input
              type="range"
              min={Math.ceil(rango[0])}
              max={Math.floor(rango[1])}
              value={objetivo}
              onChange={(e) => setObjetivo(Number(e.target.value))}
              style={{ marginTop: 8 }}
            />
            <div className="suave" style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
              <span>{Math.ceil(rango[0])}</span>
              <span>alcanzable</span>
              <span>{Math.floor(rango[1])}</span>
            </div>
          </label>

          <label>
            Cómo repartirlo
            <select
              value={modo}
              onChange={(e) => setModo(e.target.value as Modo)}
              style={{ width: "100%", marginTop: 6 }}
            >
              {MODOS.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <small className="suave">{DESCRIPCION[modo]}</small>
          </label>

          <label className="fila" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={conMacros}
              onChange={(e) => setConMacros(e.target.checked)}
              style={{ width: 16 }}
            />
            Mantener el reparto de macros
          </label>

          {conMacros && (
            <label>
              Cuánto puede cambiar la dieta: <strong>{fuerza}</strong>
              <input
                type="range"
                min={10}
                max={500}
                step={10}
                value={fuerza}
                onChange={(e) => setFuerza(Number(e.target.value))}
              />
            </label>
          )}

          <label>
            Margen por componente: <strong>±{holgura}%</strong>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={holgura}
              onChange={(e) => setHolgura(Number(e.target.value))}
            />
          </label>

          <hr style={{ border: 0, borderTop: "1px solid var(--linea)", margin: "2px 0" }} />

          {!resultado.factible ? (
            <p className="aviso" style={{ margin: 0 }}>{resultado.motivo}</p>
          ) : (
            <>
              <div>
                <div className="suave" style={{ fontSize: 13 }}>Resultado</div>
                <div style={{ fontSize: 20, fontWeight: 650 }}>
                  {Math.round(resultado.energiaFinal)} kcal
                  <small className="suave" style={{ fontWeight: 400 }}>
                    {" "}
                    ({resultado.errorKcal >= 0 ? "+" : ""}
                    {redondear1(resultado.errorKcal)})
                  </small>
                </div>
                <div className="suave" style={{ fontSize: 13 }}>
                  {Math.round(resultado.pctFinal.prot)} / {Math.round(resultado.pctFinal.hc)} /{" "}
                  {Math.round(resultado.pctFinal.grasa)}%
                </div>
              </div>
              {resultado.avisos.map((a, i) => (
                <p key={i} className="aviso" style={{ margin: 0, fontSize: 12 }}>{a}</p>
              ))}
              <button className="principal" onClick={guardar} disabled={!hayCambios || pendiente}>
                {pendiente ? "Guardando…" : "Guardar como nueva versión"}
              </button>
              {!hayCambios && (
                <small className="suave">Mueve el objetivo para ver una propuesta.</small>
              )}
            </>
          )}
        </div>

        <p className="suave" style={{ fontSize: 12, marginTop: 12 }}>
          El cálculo corre en tu navegador: mover el control no consulta al servidor.{" "}
          <Link href="/personas">Volver</Link>
        </p>
      </aside>
    </div>
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
