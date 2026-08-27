import Link from "next/link";

import { compararDietas } from "@/lib/dominio/comparar";
import type { DietaCompleta } from "@/lib/dominio/tipos";
import { clienteServidor } from "@/lib/supabase/servidor";
import { cargarDieta } from "@/lib/supabase/dieta";

export const dynamic = "force-dynamic";

const CAMPOS_INGREDIENTE = `id, nombre, kcal_100, prot_100, hc_100, grasa_100,
  fibra_100, alcohol_100, estado`;

const n0 = (v: number) => Math.round(v).toLocaleString("es-ES");
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("es-ES");
const signo = (v: number, f: (n: number) => string) => (v >= 0 ? `+${f(v)}` : f(v));
const clase = (v: number) => (v > 0.005 ? "mas" : v < -0.005 ? "menos" : "suave");

export default async function Comparar({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;

  if (!a || !b)
    return (
      <>
        <h1>Comparar versiones</h1>
        <p className="vacio">
          Elige dos versiones desde el historial de una dieta.{" "}
          <Link href="/personas">Ir a personas</Link>
        </p>
      </>
    );

  const supabase = await clienteServidor();
  // Por `cargarDieta` y no con un `select` anidado: desde la 0012 hay dos
  // claves ajenas entre `comidas` y `opciones` y PostgREST no sabe cuál usar.
  const [ra, rb] = await Promise.all([
    cargarDieta(supabase, a, CAMPOS_INGREDIENTE),
    cargarDieta(supabase, b, CAMPOS_INGREDIENTE),
  ]);

  if (ra.error || rb.error || !ra.dieta || !rb.dieta)
    return (
      <>
        <h1>Comparar versiones</h1>
        <p className="aviso">
          No se han podido cargar las dos versiones. Puede que alguna ya no
          exista o no sea tuya.
        </p>
      </>
    );

  const dietaA = ra.dieta;
  const dietaB = rb.dieta;
  const c = compararDietas(dietaA, dietaB);
  const dKcal = c.totalB.kcal - c.totalA.kcal;

  return (
    <>
      <p className="migas">
        <Link href={`/dietas/${b}/historial`}>← Historial</Link>
      </p>
      <h1>
        {dietaA.nombre} <span className="suave">frente a</span> {dietaB.nombre}
      </h1>
      <p className="sub">
        v{dietaA.version} → v{dietaB.version}
        {c.nAnadidos > 0 && ` · ${c.nAnadidos} añadido${c.nAnadidos > 1 ? "s" : ""}`}
        {c.nQuitados > 0 && ` · ${c.nQuitados} quitado${c.nQuitados > 1 ? "s" : ""}`}
      </p>

      {/* -------------------------------------------------- cabecera de totales */}
      <div className="tarjeta tabla" style={{ marginBottom: 24, padding: "4px 18px" }}>
        <table style={{ margin: 0 }}>
          <thead>
            <tr>
              <th />
              <th className="num">v{dietaA.version}</th>
              <th className="num">v{dietaB.version}</th>
              <th className="num">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Energía</strong></td>
              <td className="num">{n0(c.totalA.kcal)} kcal</td>
              <td className="num">{n0(c.totalB.kcal)} kcal</td>
              <td className={"num " + clase(dKcal)}>
                <strong>{signo(dKcal, n0)} kcal</strong>
              </td>
            </tr>
            {(["prot", "hc", "grasa"] as const).map((m) => {
              const etiqueta = { prot: "Proteína", hc: "Hidratos", grasa: "Grasa" }[m];
              const d = c.totalB[m] - c.totalA[m];
              return (
                <tr key={m}>
                  <td>{etiqueta}</td>
                  <td className="num">
                    {n1(c.totalA[m])} g <span className="suave">({n0(c.totalA.pct[m])}%)</span>
                  </td>
                  <td className="num">
                    {n1(c.totalB[m])} g <span className="suave">({n0(c.totalB.pct[m])}%)</span>
                  </td>
                  <td className={"num " + clase(d)}>{signo(d, n1)} g</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------------------ detalle por comida */}
      {!c.hayCambios ? (
        <p className="vacio">Las dos versiones son idénticas.</p>
      ) : (
        c.grupos.map((g) => {
          const d = g.kcalB - g.kcalA;
          return (
            <section key={g.comida} className="comida">
              <header>
                <h2>{g.comida}</h2>
                <span className="kcal-comida">
                  {n0(g.kcalA)} → <em>{n0(g.kcalB)}</em> kcal{" "}
                  <span className={clase(d)}>({signo(d, n0)})</span>
                </span>
              </header>
              <div className="tabla">
              <table>
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th className="num">v{dietaA.version}</th>
                    <th className="num">v{dietaB.version}</th>
                    <th className="num">Δ gramos</th>
                    <th className="num">Δ kcal</th>
                  </tr>
                </thead>
                <tbody>
                  {g.lineas.map((l, i) => (
                    <tr key={i} style={l.estado === "igual" ? { opacity: 0.55 } : undefined}>
                      <td>
                        {l.ingrediente}
                        {l.estado === "anadido" && (
                          <span className="chip mas" style={{ marginLeft: 8 }}>nuevo</span>
                        )}
                        {l.estado === "quitado" && (
                          <span className="chip menos" style={{ marginLeft: 8 }}>quitado</span>
                        )}
                      </td>
                      <td className="num">{l.gramosA === null ? "—" : `${n0(l.gramosA)} g`}</td>
                      <td className="num">{l.gramosB === null ? "—" : `${n0(l.gramosB)} g`}</td>
                      <td className={"num " + clase(l.deltaG)}>
                        {l.estado === "igual" ? "—" : signo(l.deltaG, n0)}
                      </td>
                      <td className={"num " + clase(l.deltaKcal)}>
                        {l.estado === "igual" ? "—" : signo(l.deltaKcal, n0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </section>
          );
        })
      )}

      <p style={{ marginTop: 24 }}>
        <Link href={`/comparar?a=${b}&b=${a}`}>Invertir la comparación ↔</Link>
      </p>
    </>
  );
}
