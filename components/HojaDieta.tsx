"use client";

import { useMemo, useState } from "react";

import { etiquetaMedida } from "@/lib/dominio/medidas";
import type { DietaCompleta } from "@/lib/dominio/tipos";
import { energia, macros, porcentajes, FACTORES } from "@/lib/motor";
import { aDieta, contarComponentes } from "@/lib/dominio/mapeo";

/**
 * La dieta como documento para imprimir o guardar en PDF.
 *
 * No se genera el PDF con una librería: se imprime la página. El PDF que hace
 * el navegador tiene texto seleccionable, tipografía real y saltos de página
 * controlados por CSS, no una captura pixelada; no añade nada al bundle ni una
 * función de servidor con Chromium dentro; y de paso la misma pantalla sirve
 * para imprimir en papel, que es la otra mitad de lo que se pedía.
 */

const MACROS = [
  { clave: "prot", nombre: "Proteína", color: "var(--s1)" },
  { clave: "hc", nombre: "Hidratos", color: "var(--s2)" },
  { clave: "grasa", nombre: "Grasa", color: "var(--s3)" },
] as const;

/** 1910 → «1.910»: el papel se lee en español. */
const n0 = (v: number) => Math.round(v).toLocaleString("es-ES");

const ESTADO_CANTIDADES: Record<string, string> = {
  crudo: "en crudo",
  cocido: "ya cocinadas",
  mixto: "mezcladas",
};

export default function HojaDieta({
  dieta: filas,
  persona,
}: {
  dieta: DietaCompleta;
  persona: { nombre: string } | null;
}) {
  const [verKcal, setVerKcal] = useState(true);
  const [verMedidas, setVerMedidas] = useState(true);
  // La nota al pie viene puesta con la de la dieta cuando se ha dicho que salga
  // en el papel, y se puede retocar para esta impresión sin tocar la dieta. Lo
  // que se escriba aquí no se guarda: es de esta hoja.
  const [nota, setNota] = useState(filas.nota_en_hoja ? (filas.descripcion ?? "") : "");

  const hayComponentes = contarComponentes(filas) > 0;
  const datos = useMemo(() => (hayComponentes ? aDieta(filas).dieta : null), [filas, hayComponentes]);

  const total = datos ? energia(datos) : 0;
  const gramosMacro = datos ? macros(datos) : { prot: 0, hc: 0, grasa: 0 };
  const pct = porcentajes(gramosMacro, total);

  const comidas = [...(filas.comidas ?? [])].sort((a, b) => a.orden - b.orden);
  const fecha = new Date().toLocaleDateString("es-ES", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <>
      {/* ---------------------------------------------- barra, fuera del papel */}
      <div className="no-imprimir fila" style={{ marginBottom: 20, gap: 16 }}>
        <button className="principal" onClick={() => window.print()}>
          Descargar PDF o imprimir
        </button>
        <label className="fila suave" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={verKcal} onChange={(e) => setVerKcal(e.target.checked)} style={{ width: 15 }} />
          kcal por alimento
        </label>
        <label className="fila suave" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={verMedidas} onChange={(e) => setVerMedidas(e.target.checked)} style={{ width: 15 }} />
          medidas caseras
        </label>
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Nota al pie (opcional)"
          style={{ minWidth: 260, marginLeft: "auto" }}
        />
      </div>
      <p className="no-imprimir suave" style={{ fontSize: 12, marginTop: -12, marginBottom: 24 }}>
        En el diálogo de impresión, elige <strong>Guardar como PDF</strong> como
        destino. Activa «Gráficos de fondo» si tu navegador lo pide, para que salga
        la barra de reparto.
      </p>

      {/* ------------------------------------------------------------ el papel */}
      <article className="hoja">
        <header className="hoja-cabecera">
          <div>
            <h1>{filas.nombre}</h1>
            {persona && <p className="para">{persona.nombre}</p>}
          </div>
          <div className="hoja-fecha">
            {/* El servidor va en UTC y quien imprime, no: cerca de medianoche
                la fecha del servidor y la del navegador no son la misma. Manda
                la del navegador y se calla el aviso de hidratación. */}
            <div suppressHydrationWarning>{fecha}</div>
            <div className="tenue">
              Versión {filas.version} · cantidades{" "}
              {ESTADO_CANTIDADES[filas.estado_cantidades] ?? filas.estado_cantidades}
            </div>
          </div>
        </header>

        {!hayComponentes ? (
          <p className="tenue">Esta dieta todavía no tiene ingredientes.</p>
        ) : (
          <>
            {/* fichas de totales */}
            <section className="fichas">
              <div className="ficha destacada">
                <div className="ficha-valor">{n0(total)}</div>
                <div className="ficha-nombre">
                  kcal al día
                  {filas.kcal_objetivo
                    ? ` · objetivo ${n0(Number(filas.kcal_objetivo))}`
                    : ""}
                </div>
              </div>
              {MACROS.map((m) => (
                <div className="ficha" key={m.clave}>
                  <div className="ficha-valor">
                    {n0(gramosMacro[m.clave])}
                    <span className="ficha-unidad"> g</span>
                  </div>
                  <div className="ficha-nombre">
                    <span className="punto" style={{ background: m.color }} />
                    {m.nombre}
                  </div>
                </div>
              ))}
            </section>

            {/* reparto energético: parte-de-todo, barra apilada con etiqueta dentro */}
            <section className="reparto">
              <h2 className="titulo-seccion">Reparto de la energía</h2>
              <div className="barra">
                {MACROS.map((m) => {
                  const p = pct[m.clave];
                  if (p <= 0) return null;
                  return (
                    <div
                      key={m.clave}
                      className="tramo"
                      style={{ width: `${p}%`, background: m.color }}
                    >
                      {p >= 11 && (
                        <span className="tramo-etiqueta">
                          {m.nombre} {Math.round(p)}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* los tramos estrechos no caben: su identidad va aquí */}
              {MACROS.some((m) => pct[m.clave] > 0 && pct[m.clave] < 11) && (
                <p className="leyenda">
                  {MACROS.filter((m) => pct[m.clave] > 0 && pct[m.clave] < 11).map((m) => (
                    <span key={m.clave}>
                      <span className="punto" style={{ background: m.color }} />
                      {m.nombre} {Math.round(pct[m.clave])}%
                    </span>
                  ))}
                </p>
              )}
            </section>

            {/* las comidas */}
            {comidas.flatMap((comida) => {
              /*
               * Con opciones, la hoja saca **todas**, una detrás de otra.
               *
               * Es lo que las hace útiles para quien recibe el papel: valen lo
               * mismo —esa es la regla— así que el cliente elige la que le
               * apetezca ese día. Sacar solo la activa dejaría la alternativa
               * dentro de la app, donde el cliente no entra.
               *
               * Una dieta anterior a la migración 0012 no tiene opciones y
               * entra por el mismo sitio con una sola «opción» sin nombre.
               */
              const suyas = [...(comida.opciones ?? [])].sort(
                (a, b) => a.orden - b.orden || a.id.localeCompare(b.id),
              );
              const bloques = suyas.length
                ? suyas.map((o) => ({
                    clave: o.id,
                    etiqueta: suyas.length > 1 ? o.nombre : null,
                    lista: [...(comida.componentes ?? [])]
                      .filter((c) => c.opcion_id === o.id)
                      .sort((a, b) => a.orden - b.orden),
                  }))
                : [{
                    clave: comida.id,
                    etiqueta: null,
                    lista: [...(comida.componentes ?? [])].sort((a, b) => a.orden - b.orden),
                  }];

              return bloques.map(({ clave, etiqueta, lista }, i) => {
              const componentes = lista;
              if (!componentes.length) return null;
              const kcalComida = componentes.reduce(
                (s, c) => s + (Number(c.gramos) * Number(c.ingredientes.kcal_100)) / 100,
                0,
              );
              return (
                <section className={i === 0 ? "comida" : "comida opcion-alterna"} key={clave}>
                  <h2>
                    {i === 0 ? comida.nombre : <span className="o">o bien</span>}
                    {etiqueta && <span className="opcion-nombre">{etiqueta}</span>}
                    <span className="comida-kcal">{n0(kcalComida)} kcal</span>
                  </h2>
                  <table>
                    {/* Anchos fijos e iguales en todas las comidas: si cada
                        tabla se mide por su cuenta, las columnas bailan de una
                        comida a otra y el papel se ve descuidado. */}
                    <colgroup>
                      <col />
                      <col className="c-gramos" />
                      {verMedidas && <col className="c-medida" />}
                      {verKcal && <col className="c-kcal" />}
                    </colgroup>
                    <tbody>
                      {componentes.map((c) => {
                        const g = Number(c.gramos);
                        const etiqueta = verMedidas
                          ? etiquetaMedida(g, c.ingredientes.medidas_caseras)
                          : null;
                        return (
                          <tr key={c.id}>
                            <td className="alimento">
                              {c.ingredientes.nombre}
                              {c.ingredientes.estado !== "desconocido" && (
                                <span className="estado"> · {c.ingredientes.estado}</span>
                              )}
                            </td>
                            <td className="gramos">{n0(g)} g</td>
                            {verMedidas && <td className="medida">{etiqueta ?? ""}</td>}
                            {verKcal && (
                              <td className="kcal">
                                {n0((g * Number(c.ingredientes.kcal_100)) / 100)}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              );
              });
            })}
          </>
        )}

        <footer className="hoja-pie">
          {nota && <p className="nota">{nota}</p>}
          <p className="tenue">
            Cantidades por 100 g de porción comestible · energía = 4·proteína +
            4·hidratos + 9·grasa · composición: BEDCA.
          </p>
        </footer>
      </article>
    </>
  );
}

/** Se exporta para que la página pueda comprobar que hay algo que imprimir. */
export { FACTORES };
