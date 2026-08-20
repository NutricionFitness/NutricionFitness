import Link from "next/link";
import { notFound } from "next/navigation";

import { clienteServidor } from "@/lib/supabase/servidor";

export const dynamic = "force-dynamic";

interface Version {
  id: string;
  nombre: string;
  version: number;
  dieta_padre_id: string | null;
  kcal_objetivo: number | null;
  creado_en: string;
  profundidad: number;
}

const fecha = (s: string) =>
  new Date(s).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export default async function Historial({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await clienteServidor();

  const { data: dieta } = await supabase
    .from("dietas")
    .select("id, nombre, persona_id, personas(id, nombre)")
    .eq("id", id)
    .single();
  if (!dieta) notFound();

  const { data: linaje, error } = await supabase.rpc("linaje_dieta", { p_dieta_id: id });
  if (error) return <p className="aviso">{error.message}</p>;

  const versiones = (linaje ?? []) as Version[];
  const ids = versiones.map((v) => v.id);

  const { data: totales } = await supabase
    .from("v_dietas_totales")
    .select("dieta_id, kcal, prot, hc, grasa")
    .in("dieta_id", ids);
  const porDieta = new Map((totales ?? []).map((t) => [t.dieta_id as string, t]));

  const { data: ajustes } = await supabase
    .from("ajustes")
    .select("dieta_resultado_id, modo, kcal_objetivo, kcal_origen, kcal_final, factible, motivo, resultado, creado_en")
    .in("dieta_id", ids)
    .order("creado_en");
  const porResultado = new Map(
    (ajustes ?? [])
      .filter((a) => a.dieta_resultado_id)
      .map((a) => [a.dieta_resultado_id as string, a]),
  );
  const fallidos = (ajustes ?? []).filter((a) => !a.factible);

  const persona = (dieta as unknown as { personas: { id: string; nombre: string } | null }).personas;

  return (
    <>
      <p className="sub" style={{ margin: 0 }}>
        <Link href={`/dietas/${id}`}>← {dieta.nombre}</Link>
      </p>
      <h1>Historial</h1>
      <p className="sub">
        {versiones.length} {versiones.length === 1 ? "versión" : "versiones"}
        {persona ? ` · ${persona.nombre}` : ""}
      </p>

      {versiones.length === 1 && (
        <div className="tarjeta" style={{ marginBottom: 20 }}>
          Esta dieta todavía no tiene versiones anteriores. Cada vez que guardes
          un ajuste aparecerá aquí, y podrás compararla con la de antes.
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Versión</th>
            <th className="num">kcal</th>
            <th className="num">P / HC / G</th>
            <th>Cómo se llegó</th>
            <th className="num">Fecha</th>
            <th className="num">Comparar</th>
          </tr>
        </thead>
        <tbody>
          {versiones.map((v, i) => {
            const t = porDieta.get(v.id);
            const kcal = Number(t?.kcal ?? 0);
            const pct = (g: number, f: number) => (kcal > 0 ? Math.round((f * g * 100) / kcal) : 0);
            const ajuste = porResultado.get(v.id);
            const anterior = versiones[i - 1];
            const esActual = v.id === id;
            return (
              <tr key={v.id} style={esActual ? { background: "color-mix(in srgb, var(--acento) 8%, transparent)" } : undefined}>
                <td>
                  <Link href={`/dietas/${v.id}`}>
                    {"· ".repeat(Math.min(v.profundidad, 4))}
                    v{v.version} {v.nombre}
                  </Link>
                  {esActual && <span className="chip" style={{ marginLeft: 8 }}>aquí</span>}
                </td>
                <td className="num">{kcal ? Math.round(kcal) : "—"}</td>
                <td className="num suave">
                  {kcal
                    ? `${pct(Number(t!.prot), 4)} / ${pct(Number(t!.hc), 4)} / ${pct(Number(t!.grasa), 9)}%`
                    : "—"}
                </td>
                <td className="suave">
                  {ajuste ? (
                    <>
                      {String(ajuste.modo).replace(/_/g, " ")}
                      {ajuste.kcal_objetivo != null && (
                        <> · objetivo {Math.round(Number(ajuste.kcal_objetivo))}</>
                      )}
                    </>
                  ) : (
                    "creada a mano"
                  )}
                </td>
                <td className="num suave">{fecha(v.creado_en)}</td>
                <td className="num">
                  {anterior ? (
                    <Link href={`/comparar?a=${anterior.id}&b=${v.id}`}>con la anterior</Link>
                  ) : (
                    <span className="suave">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {versiones.length > 2 && (
        <p style={{ marginTop: 16 }}>
          <Link href={`/comparar?a=${versiones[0].id}&b=${versiones[versiones.length - 1].id}`}>
            Comparar la primera con la última →
          </Link>
        </p>
      )}

      {fallidos.length > 0 && (
        <>
          <h2>Ajustes que no se pudieron aplicar</h2>
          <p className="sub">
            Se guardan a propósito: saber que se intentó y no se pudo es
            información, no un error que esconder.
          </p>
          <table>
            <thead>
              <tr>
                <th className="num">Objetivo</th>
                <th>Motivo</th>
                <th className="num">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {fallidos.map((a, i) => (
                <tr key={i}>
                  <td className="num">{Math.round(Number(a.kcal_objetivo))} kcal</td>
                  <td className="aviso">{a.motivo}</td>
                  <td className="num suave">{fecha(a.creado_en as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
