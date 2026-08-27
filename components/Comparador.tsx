"use client";

import { useEffect, useId, useRef, useState } from "react";

import { buscarAlimentos, sustitutosPublicos } from "@/app/comparador/acciones";
import type { AlimentoPublico, Orden, PaginaSustitutos } from "@/app/comparador/tipos";
import { gramosIsoenergeticos, type Sustitucion } from "@/lib/dominio/sustituir";

/**
 * El comparador público.
 *
 * Contesta dos preguntas, y son distintas:
 *
 *  1. «¿Por qué puedo cambiar esto?» — se puntúa el catálogo entero y salen los
 *     diez que mejor encajan, con «buscar más» si esos diez no valen.
 *  2. «¿Y esto contra aquello?» — se elige el segundo a mano y sale la tabla de
 *     los dos, con los gramos del segundo cuadrados a las mismas kilocalorías.
 *
 * Las dos están a la vez en la pantalla: una lista de propuestas no quita las
 * ganas de comparar contra algo concreto que ya se tiene en la cabeza.
 *
 * Todo lo que se calcula aquí —las dos fichas y la tabla comparativa— es
 * aritmética sobre datos que ya están en el navegador. Al servidor solo se va a
 * buscar por nombre y a puntuar el catálogo, que es lo que no cabe aquí.
 */

const MACROS = [
  { k: "prot", nombre: "Proteína", corto: "P" },
  { k: "hc", nombre: "Hidratos", corto: "HC" },
  { k: "grasa", nombre: "Grasa", corto: "G" },
] as const;

const ORDENES: Array<{ v: Orden; t: string }> = [
  { v: "parecido", t: "Los más parecidos" },
  { v: "mas_prot", t: "Con más proteína" },
  { v: "menos_prot", t: "Con menos proteína" },
  { v: "mas_hc", t: "Con más hidratos" },
  { v: "menos_hc", t: "Con menos hidratos" },
  { v: "mas_grasa", t: "Con más grasa" },
  { v: "menos_grasa", t: "Con menos grasa" },
];

const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("es-ES");
const n0 = (v: number) => Math.round(v).toLocaleString("es-ES");

/** Lo que aportan `gramos` de un alimento. */
function aporte(a: AlimentoPublico, gramos: number) {
  const f = gramos / 100;
  const macros = { prot: a.prot * f, hc: a.hc * f, grasa: a.grasa * f };
  const kcal = a.kcal100 * f;
  const pct =
    kcal > 0
      ? {
          prot: (100 * 4 * macros.prot) / kcal,
          hc: (100 * 4 * macros.hc) / kcal,
          grasa: (100 * 9 * macros.grasa) / kcal,
        }
      : { prot: 0, hc: 0, grasa: 0 };
  return { macros, kcal, pct, fibra: a.fibra * f };
}

export default function Comparador() {
  const [alimento, setAlimento] = useState<AlimentoPublico | null>(null);
  const [gramos, setGramos] = useState("100");
  const [otro, setOtro] = useState<AlimentoPublico | null>(null);

  const g = Number(String(gramos).replace(",", "."));
  const gValidos = Number.isFinite(g) && g > 0 && g <= 2000;

  return (
    <div className="comparador">
      <section className="paso">
        <BuscadorPublico
          etiqueta="Alimento"
          valor={alimento}
          onElegir={(a) => {
            setAlimento(a);
            setOtro(null);
          }}
        />

        <label className="campo-gramos">
          <span className="etiqueta">Cantidad</span>
          <span className="con-unidad">
            <input
              value={gramos}
              inputMode="decimal"
              onChange={(e) => setGramos(e.target.value)}
              aria-label="Cantidad en gramos"
            />
            <span>g</span>
          </span>
        </label>
      </section>

      {alimento && !gValidos && (
        <p className="aviso">Escribe una cantidad entre 1 y 2.000 gramos.</p>
      )}

      {alimento && gValidos && (
        <>
          <Ficha alimento={alimento} gramos={g} />
          {/* Con `key`: cambiar de alimento o de cantidad es otra pregunta, y
              lo que se quiere es empezar de cero. Remontar hace eso sin un
              efecto que reinicie estado, que es de donde salen las carreras. */}
          <Sustitutos key={`${alimento.id}-${g}`} alimento={alimento} gramos={g} />
          <Contra
            alimento={alimento}
            gramos={g}
            otro={otro}
            onElegir={setOtro}
          />
        </>
      )}
    </div>
  );
}

/**
 * El buscador.
 *
 * Va contra una acción de servidor y no contra Supabase desde el navegador
 * porque desde el navegador habría que darle a `anon` permiso sobre la tabla, y
 * eso es exactamente lo que la migración 0011 evita.
 */
function BuscadorPublico({
  etiqueta,
  valor,
  onElegir,
}: {
  etiqueta: string;
  valor: AlimentoPublico | null;
  onElegir: (a: AlimentoPublico) => void;
}) {
  const [texto, setTexto] = useState("");
  const [lista, setLista] = useState<AlimentoPublico[] | null>(null);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const idLista = useId();

  // Sin `texto` escribiéndose a sí mismo en las dependencias: el efecto lee lo
  // que hay y escribe otra cosa. Es la regla que costó el escáner remoto.
  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) {
      setLista(null);
      return;
    }
    let vigente = true;
    // Un respiro antes de preguntar: escribiendo «garbanzo» son ocho consultas
    // si se lanza una por tecla.
    const t = setTimeout(() => {
      buscarAlimentos(q).then((r) => {
        if (vigente) {
          setLista(r);
          setAbierto(true);
        }
      });
    }, 220);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [texto]);

  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  return (
    <div className="buscador-publico" ref={caja}>
      <label className="etiqueta" htmlFor={idLista}>
        {etiqueta}
      </label>
      <input
        id={idLista}
        value={texto}
        placeholder={valor ? valor.nombre : "arroz, merluza, aceite de oliva…"}
        autoComplete="off"
        onChange={(e) => setTexto(e.target.value)}
        onFocus={() => lista && setAbierto(true)}
      />

      {abierto && lista && (
        <ul className="opciones-buscador">
          {lista.length === 0 ? (
            <li className="vacio">Ningún alimento con ese nombre.</li>
          ) : (
            lista.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    onElegir(a);
                    setTexto("");
                    setAbierto(false);
                  }}
                >
                  <span>{a.nombre}</span>
                  <small>
                    {a.grupo ?? "—"} · {n0(a.kcal100)} kcal/100 g
                  </small>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** Lo que aporta la cantidad elegida. */
function Ficha({ alimento, gramos }: { alimento: AlimentoPublico; gramos: number }) {
  const a = aporte(alimento, gramos);
  return (
    <section className="ficha-alimento">
      <div className="titulo">
        <h2>{alimento.nombre}</h2>
        <span className="chips">
          {alimento.grupo && <span className="chip">{alimento.grupo}</span>}
          {alimento.estado !== "desconocido" && (
            <span className="chip">{alimento.estado}</span>
          )}
        </span>
      </div>

      <div className="cifras-ficha">
        <div className="grande">
          <b>{n0(a.kcal)}</b>
          <small>kcal en {n0(gramos)} g</small>
        </div>
        {MACROS.map((m) => (
          <div key={m.k} className="macro">
            <span className={`etiqueta-macro ${m.k}`}>{m.nombre}</span>
            <b>{n1(a.macros[m.k])} g</b>
            <small>{n0(a.pct[m.k])}% de la energía</small>
          </div>
        ))}
      </div>

      {/* Un tramo estrecho no puede enseñar su cifra: sale cortada y parece un
          error. Por debajo del 12% se calla, que para eso el número está
          escrito entero justo encima. Es el mismo criterio que la hoja
          impresa, donde los tramos pequeños pasan a una leyenda. */}
      <div className="macro-barra" role="img"
        aria-label={`Proteína ${n0(a.pct.prot)}%, hidratos ${n0(a.pct.hc)}%, grasa ${n0(a.pct.grasa)}%`}>
        {MACROS.map((m) => (
          <span key={m.k} className={m.k} style={{ flex: a.pct[m.k] }}>
            {a.pct[m.k] >= 12 && (
              <>
                {m.corto} <b>{n0(a.pct[m.k])}%</b>
              </>
            )}
          </span>
        ))}
      </div>

      <p className="tenue por-cien">
        Por 100 g: {n0(alimento.kcal100)} kcal · {n1(alimento.prot)} g de proteína ·{" "}
        {n1(alimento.hc)} g de hidratos · {n1(alimento.grasa)} g de grasa ·{" "}
        {n1(alimento.fibra)} g de fibra
        {alimento.kcalRef !== null && ` · ${n0(alimento.kcalRef)} kcal declaradas`}
      </p>
    </section>
  );
}

/** Los diez sustitutos, y los diez siguientes si hacen falta. */
function Sustitutos({ alimento, gramos }: { alimento: AlimentoPublico; gramos: number }) {
  const [soloMismoGrupo, setSoloMismoGrupo] = useState(true);
  const [orden, setOrden] = useState<Orden>("parecido");
  const [hasta, setHasta] = useState(10);
  const [pagina, setPagina] = useState<PaginaSustitutos | null>(null);
  const [lista, setLista] = useState<Sustitucion[]>([]);
  const [cargando, setCargando] = useState(false);

  /**
   * Cambiar de filtro empieza de cero, y se hace **aquí**, al pulsar.
   *
   * La primera versión lo hacía en un efecto con las mismas dependencias que
   * el de buscar. Los dos se disparan en el mismo commit y el de buscar lee el
   * `hasta` viejo, así que al cambiar un filtro estando en la página 2 se
   * pedía `desde: 10` y acto seguido `desde: 0`: una consulta tirada y una
   * lista que parpadea con los resultados equivocados. Se vio montándolo y
   * contando llamadas —salían `[10, 0]`—, no leyendo el código.
   *
   * Lo mismo por lo que existe el `key` con el que el padre monta esto: los
   * cambios que vienen de fuera —otro alimento, otra cantidad— lo remontan
   * entero y no hay nada que reiniciar.
   */
  const cambiarFiltro = (f: () => void) => {
    f();
    setHasta(10);
    setLista([]);
  };

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    sustitutosPublicos({
      alimento,
      gramos,
      soloMismoGrupo,
      orden,
      desde: hasta - 10,
    }).then((p) => {
      if (!vigente) return;
      setPagina(p);
      setLista((antes) => (hasta === 10 ? p.sustitutos : [...antes, ...p.sustitutos]));
      setCargando(false);
    });
    return () => {
      vigente = false;
    };
    // `lista` y `cargando` NO entran: son lo que este efecto escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alimento, gramos, soloMismoGrupo, orden, hasta]);

  const quedan = pagina ? Math.max(0, pagina.total - lista.length) : 0;

  return (
    <section className="bloque">
      <div className="cabeza-bloque">
        <h2>¿Por qué lo puedo cambiar?</h2>
        <div className="mandos">
          <label className="opcion">
            <input
              type="checkbox"
              checked={soloMismoGrupo}
              onChange={(e) => cambiarFiltro(() => setSoloMismoGrupo(e.target.checked))}
            />
            Solo del mismo grupo
          </label>
          <label className="opcion">
            <span className="tenue">Ordenar por</span>{" "}
            <select
              value={orden}
              onChange={(e) => cambiarFiltro(() => setOrden(e.target.value as Orden))}
            >
              {ORDENES.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.t}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {!lista.length && cargando ? (
        <p className="suave">Buscando…</p>
      ) : !lista.length ? (
        <p className="suave">
          {soloMismoGrupo
            ? "No hay sustitutos razonables dentro de este grupo. Prueba a desmarcar «solo del mismo grupo»."
            : orden === "parecido"
              ? "No hay sustitutos razonables: ninguno cuadra en energía sin irse a una cantidad que nadie se comería."
              : "Ningún alimento va en esa dirección sin irse a una cantidad que nadie se comería. Prueba con otra ordenación."}
        </p>
      ) : (
        <>
          <div className="tabla">
            <table>
              <thead>
                <tr>
                  <th>Cámbialo por</th>
                  <th className="num">Cantidad</th>
                  {MACROS.map((m) => (
                    <th key={m.k} className="num">
                      {m.corto}
                    </th>
                  ))}
                  <th className="num">Reparto</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((s) => {
                  const p = aporte(
                    { ...alimento, ...s.candidato, fibra: 0, alcohol: 0,
                      kcalRef: null, porcionComestible: null, codigoBedca: null },
                    s.gramos,
                  );
                  return (
                    <tr key={s.candidato.id}>
                      <td>
                        {s.candidato.nombre}
                        {s.candidato.grupo && s.candidato.grupo !== alimento.grupo && (
                          <span className="chip" style={{ marginLeft: 6 }}>
                            {s.candidato.grupo}
                          </span>
                        )}
                      </td>
                      <td className="num">
                        <b>{n0(s.gramos)}</b> g
                      </td>
                      {MACROS.map((m) => (
                        <td
                          key={m.k}
                          className={`num ${s.delta[m.k] > 0 ? "mas" : s.delta[m.k] < 0 ? "menos" : "suave"}`}
                        >
                          {s.delta[m.k] >= 0 ? "+" : "−"}
                          {n1(Math.abs(s.delta[m.k]))}
                        </td>
                      ))}
                      <td className="num">
                        <span className="reparto-vivo">
                          <span className="cifras">
                            <b className="prot">{n0(p.pct.prot)}</b>
                            <i>/</i>
                            <b className="hc">{n0(p.pct.hc)}</b>
                            <i>/</i>
                            <b className="grasa">{n0(p.pct.grasa)}</b>
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pie-bloque">
            {quedan > 0 ? (
              <button type="button" onClick={() => setHasta((h) => h + 10)} disabled={cargando}>
                {cargando ? "Buscando…" : `Buscar más (quedan ${quedan})`}
              </button>
            ) : (
              <span className="tenue">
                No hay más: {lista.length} de {pagina?.mirados ?? 0} alimentos mirados cuadran
                en energía y en cantidad.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** El segundo alimento, elegido a mano, y la tabla de los dos. */
function Contra({
  alimento,
  gramos,
  otro,
  onElegir,
}: {
  alimento: AlimentoPublico;
  gramos: number;
  otro: AlimentoPublico | null;
  onElegir: (a: AlimentoPublico | null) => void;
}) {
  const gOtro = otro ? gramosIsoenergeticos(alimento.kcal100, gramos, otro.kcal100) : null;
  const a = aporte(alimento, gramos);
  const b = otro && gOtro !== null ? aporte(otro, gOtro) : null;

  return (
    <section className="bloque">
      <div className="cabeza-bloque">
        <h2>O compáralo con uno concreto</h2>
        {otro && (
          <button type="button" className="enlace" onClick={() => onElegir(null)}>
            quitar
          </button>
        )}
      </div>

      <BuscadorPublico etiqueta="Segundo alimento" valor={otro} onElegir={onElegir} />

      {otro && (gOtro === null || b === null) && (
        <p className="aviso">
          {otro.nombre} no aporta energía, así que no hay ninguna cantidad suya que iguale
          a {n0(gramos)} g de {alimento.nombre}.
        </p>
      )}

      {otro && b !== null && gOtro !== null && (
        <>
          <div className="tabla">
            <table className="cara-a-cara">
              <thead>
                <tr>
                  <th />
                  <th>{alimento.nombre}</th>
                  <th>{otro.nombre}</th>
                  <th className="num">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                <tr className="cantidad">
                  <th scope="row">Cantidad</th>
                  <td>
                    <b>{n0(gramos)}</b> g
                  </td>
                  <td>
                    <b>{n0(gOtro)}</b> g
                  </td>
                  <td className="num suave">a las mismas kcal</td>
                </tr>
                <tr>
                  <th scope="row">Energía</th>
                  <td>{n0(a.kcal)} kcal</td>
                  <td>{n0(b.kcal)} kcal</td>
                  <td className="num suave">—</td>
                </tr>
                {MACROS.map((m) => {
                  const d = b.macros[m.k] - a.macros[m.k];
                  return (
                    <tr key={m.k}>
                      <th scope="row">
                        <span className={`etiqueta-macro ${m.k}`}>{m.nombre}</span>
                      </th>
                      <td>
                        {n1(a.macros[m.k])} g <small className="tenue">({n0(a.pct[m.k])}%)</small>
                      </td>
                      <td>
                        {n1(b.macros[m.k])} g <small className="tenue">({n0(b.pct[m.k])}%)</small>
                      </td>
                      <td className={`num ${d > 0.05 ? "mas" : d < -0.05 ? "menos" : "suave"}`}>
                        {d >= 0 ? "+" : "−"}
                        {n1(Math.abs(d))} g
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row">Fibra</th>
                  <td>{n1(a.fibra)} g</td>
                  <td>{n1(b.fibra)} g</td>
                  <td
                    className={`num ${b.fibra - a.fibra > 0.05 ? "mas" : b.fibra - a.fibra < -0.05 ? "menos" : "suave"}`}
                  >
                    {b.fibra - a.fibra >= 0 ? "+" : "−"}
                    {n1(Math.abs(b.fibra - a.fibra))} g
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="tenue" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
            Los {n0(gOtro)} g de {otro.nombre} son los que aportan las mismas kilocalorías
            que {n0(gramos)} g de {alimento.nombre}. Comparar cien gramos con cien gramos
            diría otra cosa: que uno tiene más de todo porque tiene más energía.
          </p>
        </>
      )}
    </section>
  );
}
