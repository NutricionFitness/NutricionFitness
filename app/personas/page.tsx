import Link from "next/link";

import { clienteServidor } from "@/lib/supabase/servidor";
import { crearPersona } from "./acciones";

export const dynamic = "force-dynamic";

export default async function Personas() {
  const supabase = await clienteServidor();
  const { data: personas, error } = await supabase
    .from("personas")
    .select("id, nombre, notas, creado_en, dietas(count)")
    .order("nombre");

  if (error) return <p className="aviso">No se han podido cargar las personas: {error.message}</p>;

  return (
    <>
      <h1>Personas</h1>
      <p className="sub">Cada persona tiene sus dietas y el historial de sus ajustes.</p>

      <form action={crearPersona} className="fila" style={{ marginBottom: 24 }}>
        <input name="nombre" placeholder="Nombre de la persona" required style={{ minWidth: 260 }} />
        <button className="principal">Añadir</button>
      </form>

      {!personas?.length ? (
        <p className="vacio">Todavía no hay ninguna persona.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th className="num">Dietas</th>
              <th className="num">Alta</th>
            </tr>
          </thead>
          <tbody>
            {personas.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/personas/${p.id}`}>{p.nombre}</Link></td>
                <td className="num">{(p.dietas as unknown as { count: number }[])[0]?.count ?? 0}</td>
                <td className="num suave">
                  {new Date(p.creado_en as string).toLocaleDateString("es-ES")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
