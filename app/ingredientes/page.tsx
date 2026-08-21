import { clienteServidor } from "@/lib/supabase/servidor";

export const dynamic = "force-dynamic";

const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export default async function Ingredientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; grupo?: string }>;
}) {
  const { q = "", grupo = "" } = await searchParams;
  const supabase = await clienteServidor();

  let consulta = supabase
    .from("ingredientes")
    .select("id, nombre, grupo, estado, kcal_100, prot_100, hc_100, grasa_100, fibra_100")
    .eq("preferente", true)
    .order("nombre")
    .limit(100);

  const norm = sinTildes(q);
  if (norm) consulta = consulta.ilike("nombre_norm", `%${norm}%`);
  if (grupo) consulta = consulta.eq("grupo", grupo);

  const { data, error } = await consulta;

  return (
    <>
      <h1>Ingredientes</h1>
      <p className="sub">
        Catálogo de BEDCA. Se muestran los preferentes: un registro por nombre, el
        más completo de los que ofrece la fuente.
      </p>

      <form className="fila" style={{ marginBottom: 20 }}>
        <input name="q" defaultValue={q} placeholder="Buscar…" style={{ minWidth: 260 }} />
        <input name="grupo" defaultValue={grupo} placeholder="Grupo (opcional)" />
        <button className="principal">Buscar</button>
      </form>

      {error && <p className="aviso">{error.message}</p>}

      {!data?.length ? (
        <p className="vacio">Sin resultados.</p>
      ) : (
        <div className="listado tabla">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Grupo</th>
              <th>Estado</th>
              <th className="num">kcal</th>
              <th className="num">P</th>
              <th className="num">HC</th>
              <th className="num">G</th>
              <th className="num">Fibra</th>
            </tr>
          </thead>
          <tbody>
            {data.map((i) => (
              <tr key={i.id}>
                <td>{i.nombre}</td>
                <td className="suave">{i.grupo ?? "—"}</td>
                <td className="suave">{i.estado}</td>
                <td className="num">{Math.round(Number(i.kcal_100))}</td>
                <td className="num suave">{Number(i.prot_100)}</td>
                <td className="num suave">{Number(i.hc_100)}</td>
                <td className="num suave">{Number(i.grasa_100)}</td>
                <td className="num suave">{Number(i.fibra_100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}
