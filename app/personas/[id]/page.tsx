import Link from "next/link";
import { notFound } from "next/navigation";

import AccionesDieta from "@/components/AccionesDieta";
import CabeceraPersona from "@/components/CabeceraPersona";
import { clienteServidor } from "@/lib/supabase/servidor";
import { crearDieta } from "../acciones";

export const dynamic = "force-dynamic";

export default async function Persona({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await clienteServidor();

  const { data: persona } = await supabase
    .from("personas").select("id, nombre, notas").eq("id", id).single();
  if (!persona) notFound();

  const { data: dietas } = await supabase
    .from("dietas")
    .select("id, nombre, version, kcal_objetivo, creado_en, dieta_padre_id")
    .eq("persona_id", id)
    .order("creado_en", { ascending: false });

  const { data: totales } = await supabase
    .from("v_dietas_totales").select("dieta_id, kcal, prot, hc, grasa");
  const porDieta = new Map((totales ?? []).map((t) => [t.dieta_id as string, t]));

  return (
    <>
      <p className="migas"><Link href="/personas">← Personas</Link></p>
      <CabeceraPersona
        persona={{
          id: persona.id as string,
          nombre: persona.nombre as string,
          notas: (persona as { notas?: string | null }).notas ?? null,
        }}
        nDietas={dietas?.length ?? 0}
      />

      <form action={crearDieta} className="fila" style={{ margin: "20px 0" }}>
        <input type="hidden" name="persona_id" value={persona.id} />
        <input name="nombre" placeholder="Nombre de la dieta" required style={{ minWidth: 260 }} />
        <button className="principal">Nueva dieta</button>
      </form>

      {!dietas?.length ? (
        <p className="vacio">Aún no tiene ninguna dieta.</p>
      ) : (
        <div className="listado">
        <table>
          <thead>
            <tr>
              <th>Dieta</th>
              <th className="num">kcal</th>
              <th className="num">P / HC / G</th>
              <th className="num">Versión</th>
              <th className="num">Fecha</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {dietas.map((d) => {
              const t = porDieta.get(d.id);
              const kcal = Number(t?.kcal ?? 0);
              const pct = (g: number, f: number) => (kcal > 0 ? Math.round((f * g * 100) / kcal) : 0);
              return (
                <tr key={d.id}>
                  <td>
                    <Link href={`/dietas/${d.id}`}>{d.nombre}</Link>
                    {d.dieta_padre_id && <span className="chip" style={{ marginLeft: 8 }}>ajuste</span>}
                  </td>
                  <td className="num">{kcal ? Math.round(kcal) : "—"}</td>
                  <td className="num suave">
                    {kcal
                      ? `${pct(Number(t!.prot), 4)} / ${pct(Number(t!.hc), 4)} / ${pct(Number(t!.grasa), 9)}%`
                      : "—"}
                  </td>
                  <td className="num">{d.version}</td>
                  <td className="num suave">
                    {new Date(d.creado_en as string).toLocaleDateString("es-ES")}
                  </td>
                  <td className="num">
                    <AccionesDieta
                      dietaId={d.id as string}
                      personaId={persona.id as string}
                      tieneVersiones={Boolean(d.dieta_padre_id) || (d.version as number) > 1}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}
