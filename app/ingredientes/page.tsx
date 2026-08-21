import Link from "next/link";
import { redirect } from "next/navigation";

import SelectorGrupos from "@/components/SelectorGrupos";
import SelectorPorPagina from "@/components/SelectorPorPagina";
import { clienteServidor } from "@/lib/supabase/servidor";

export const dynamic = "force-dynamic";

const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

const TAMANOS = [25, 50, 100, 200] as const;
const POR_DEFECTO = 100;

interface Filtro {
  q: string;
  grupos: string[];
  por: number;
  pagina: number;
}

/** La URL de una página, conservando búsqueda, grupos y tamaño. */
function enlace({ q, grupos, por, pagina }: Filtro) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  // Varios grupos van como el mismo campo repetido, igual que los manda el
  // formulario: ?grupo=Frutas&grupo=Legumbres
  grupos.forEach((g) => p.append("grupo", g));
  if (por !== POR_DEFECTO) p.set("por", String(por));
  if (pagina > 1) p.set("pagina", String(pagina));
  const cola = p.toString();
  return cola ? `/ingredientes?${cola}` : "/ingredientes";
}

/**
 * Qué números de página se enseñan.
 *
 * Con 1.090 ingredientes de 25 en 25 salen 44 páginas: pintarlas todas es una
 * fila de números que nadie lee. Se enseñan la primera, la última, la actual y
 * sus vecinas, y el resto se resume en un hueco.
 */
function ventana(actual: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const marcadas = new Set([1, total, actual, actual - 1, actual + 1]);
  if (actual <= 3) [2, 3, 4].forEach((n) => marcadas.add(n));
  if (actual >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => marcadas.add(n));

  const numeros = [...marcadas].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const salida: (number | "…")[] = [];
  numeros.forEach((n, i) => {
    if (i > 0 && n - numeros[i - 1] > 1) salida.push("…");
    salida.push(n);
  });
  return salida;
}

export default async function Ingredientes({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    grupo?: string | string[];
    por?: string;
    pagina?: string;
  }>;
}) {
  const { q = "", grupo, por: porPedido, pagina: paginaPedida } = await searchParams;

  // Un solo grupo llega como texto y varios como lista: se normaliza a lista.
  const grupos = (Array.isArray(grupo) ? grupo : grupo ? [grupo] : []).filter(Boolean);

  const por = (TAMANOS as readonly number[]).includes(Number(porPedido))
    ? Number(porPedido)
    : POR_DEFECTO;
  const pagina = Math.max(1, Math.floor(Number(paginaPedida)) || 1);
  const desde = (pagina - 1) * por;

  const supabase = await clienteServidor();

  // Los grupos que existen de verdad, para el desplegable. Son quince, pero se
  // leen de los datos y no de una lista escrita a mano: si mañana aparece uno
  // nuevo en BEDCA, sale solo. El `limit` alto es para que un tope de filas del
  // servidor no deje fuera el último grupo por orden alfabético.
  const { data: filasGrupo } = await supabase
    .from("ingredientes")
    .select("grupo")
    .eq("preferente", true)
    .limit(5000);

  const gruposDisponibles = [
    ...new Set(
      (filasGrupo ?? [])
        .map((f) => (f.grupo as string | null) ?? "")
        .filter((g): g is string => g !== ""),
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));

  let consulta = supabase
    .from("ingredientes")
    .select(
      "id, nombre, grupo, estado, kcal_100, prot_100, hc_100, grasa_100, fibra_100",
      { count: "exact" },
    )
    .eq("preferente", true)
    .order("nombre")
    .range(desde, desde + por - 1);

  const norm = sinTildes(q);
  if (norm) consulta = consulta.ilike("nombre_norm", `%${norm}%`);
  if (grupos.length) consulta = consulta.in("grupo", grupos);

  const { data, error, count } = await consulta;

  const total = count ?? 0;
  const paginas = Math.max(1, Math.ceil(total / por));

  // Pedir una página que ya no existe pasa al estrechar la búsqueda desde la
  // página 30. Se va a la última en vez de enseñar una tabla vacía sin explicar
  // por qué.
  if (total > 0 && pagina > paginas) redirect(enlace({ q, grupos, por, pagina: paginas }));

  const hasta = Math.min(desde + por, total);

  return (
    <>
      <h1>Ingredientes</h1>
      <p className="sub">
        Catálogo de BEDCA. Se muestran los preferentes: un registro por nombre, el
        más completo de los que ofrece la fuente.
      </p>

      <form className="fila buscador-catalogo" style={{ marginBottom: 18 }}>
        <input name="q" defaultValue={q} placeholder="Buscar…" style={{ minWidth: 220 }} />
        <SelectorGrupos grupos={gruposDisponibles} elegidos={grupos} />
        <button className="principal">Buscar</button>
        <span style={{ flex: 1 }} />
        <SelectorPorPagina valor={por} opciones={TAMANOS} />
      </form>

      {error && <p className="aviso">{error.message}</p>}

      {!data?.length ? (
        <p className="vacio">Sin resultados.</p>
      ) : (
        <>
          <div className="listado">
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

          <div className="paginacion">
            <span>
              Del <b>{desde + 1}</b> al <b>{hasta}</b> de{" "}
              <b>{total.toLocaleString("es-ES")}</b>
              {q || grupos.length ? " que encajan con la búsqueda" : ""}
            </span>

            {paginas > 1 && (
              <nav className="paginas" aria-label="Páginas de ingredientes">
                {pagina > 1 ? (
                  <Link
                    href={enlace({ q, grupos, por, pagina: pagina - 1 })}
                    aria-label="Página anterior"
                    title="Página anterior"
                  >
                    ←
                  </Link>
                ) : (
                  <span className="inerte" aria-hidden="true">
                    ←
                  </span>
                )}

                {ventana(pagina, paginas).map((n, i) =>
                  n === "…" ? (
                    <span key={`hueco-${i}`} className="hueco" aria-hidden="true">
                      …
                    </span>
                  ) : n === pagina ? (
                    <span key={n} className="actual" aria-current="page">
                      {n}
                    </span>
                  ) : (
                    <Link
                      key={n}
                      href={enlace({ q, grupos, por, pagina: n })}
                      aria-label={`Página ${n}`}
                    >
                      {n}
                    </Link>
                  ),
                )}

                {pagina < paginas ? (
                  <Link
                    href={enlace({ q, grupos, por, pagina: pagina + 1 })}
                    aria-label="Página siguiente"
                    title="Página siguiente"
                  >
                    →
                  </Link>
                ) : (
                  <span className="inerte" aria-hidden="true">
                    →
                  </span>
                )}
              </nav>
            )}
          </div>
        </>
      )}
    </>
  );
}
