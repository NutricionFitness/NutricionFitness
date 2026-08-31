import Link from "next/link";
import { notFound } from "next/navigation";

import CabeceraDieta from "@/components/CabeceraDieta";
import EditorDieta from "@/components/EditorDieta";
import { clienteServidor } from "@/lib/supabase/servidor";
import { cargarDieta } from "@/lib/supabase/dieta";
import { alergenosDeIngredientes, alergiasDePersona } from "@/app/alergenos/consultas";
import type { DietaCompleta } from "@/lib/dominio/tipos";
import { aNumeroOpcional } from "@/lib/dominio/mapeo";

export const dynamic = "force-dynamic";

const CAMPOS_INGREDIENTE =
  "id, owner_id, codigo_bedca, nombre, nombre_norm, nombre_en, grupo, estado, " +
  "prot_100, hc_100, grasa_100, fibra_100, alcohol_100, ags_100, agua_100, " +
  "sodio_100, kcal_ref, kcal_100, porcion_comestible, origen, preferente, revisado, " +
  "medidas_caseras ( id, nombre, gramos, owner_id )";

export default async function PaginaDieta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await clienteServidor();

  const cargada = await cargarDieta(
    supabase,
    id,
    CAMPOS_INGREDIENTE,
    undefined,
    "personas ( id, nombre, peso_kg )",
  );

  // `notFound()` SOLO cuando de verdad no hay dieta. Antes cualquier error de
  // la consulta acababa aquí, y un fallo de PostgREST —por ejemplo el de
  // ambigüedad al anidar `opciones`— salía como un 404 pelado que no decía
  // nada. Un error de la base es un error, y se enseña.
  if (cargada.error) throw new Error(cargada.error);
  if (!cargada.dieta) notFound();
  const data = cargada.dieta;

  // Equivalencias crudo↔cocido de los ingredientes que hay en esta dieta.
  // Van en consulta aparte porque no cuelgan del ingrediente: son una relación
  // entre dos de ellos.
  const idsIngredientes = [
    ...new Set(
      (data.comidas ?? []).flatMap((m) =>
        (m.componentes ?? []).map((c) => c.ingrediente_id),
      ),
    ),
  ];
  const { data: equivalencias } = idsIngredientes.length
    ? await supabase
        .from("equivalencias_coccion")
        .select("ingrediente_crudo_id, ingrediente_cocido_id, factor, agua_crudo, agua_cocido")
        .or(
          `ingrediente_crudo_id.in.(${idsIngredientes.join(",")}),` +
            `ingrediente_cocido_id.in.(${idsIngredientes.join(",")})`,
        )
    : { data: [] };

  const persona = (data as unknown as {
    personas: { id: string; nombre: string; peso_kg: unknown } | null;
  }).personas;

  // Cuántas versiones hay en la familia, para poder avisar al borrar.
  const { data: linaje } = await supabase.rpc("linaje_dieta", { p_dieta_id: id });
  const nVersiones = Array.isArray(linaje) ? linaje.length : 1;

  // Las alergias van en consulta aparte y no colgando de la dieta: así el tipo
  // del dominio se queda como está y el motor no se entera de que existen.
  const [alergias, alergenos] = await Promise.all([
    persona ? alergiasDePersona(persona.id) : Promise.resolve([]),
    alergenosDeIngredientes(idsIngredientes),
  ]);

  return (
    <>
      <p className="migas">
        {persona ? (
          <Link href={`/personas/${persona.id}`}>← {persona.nombre}</Link>
        ) : (
          <Link href="/personas">← Personas</Link>
        )}
      </p>
      <CabeceraDieta
        dieta={{
          id: data.id as string,
          nombre: data.nombre as string,
          descripcion: (data.descripcion as string | null) ?? null,
          nota_en_hoja: Boolean(data.nota_en_hoja),
          estado_cantidades: data.estado_cantidades as string,
          version: data.version as number,
          dieta_padre_id: data.dieta_padre_id as string | null,
          persona_id: data.persona_id as string | null,
        }}
        nVersiones={nVersiones}
      />
      {cargada.faltaMigracion && (
        <p className="aviso-caja">
          <span>
            Esta dieta se está viendo <strong>sin opciones por comida</strong>: falta
            aplicar <code>0012_opciones_comida.sql</code> en Supabase. Todo lo demás
            funciona igual; en cuanto la apliques, aparecen las pestañas.
          </span>
        </p>
      )}

      <EditorDieta
        dieta={data}
        equivalencias={equivalencias ?? []}
        alergias={alergias}
        alergenos={alergenos}
        persona={persona?.nombre ?? null}
        pesoKg={aNumeroOpcional(persona?.peso_kg, "peso_kg")}
      />
    </>
  );
}
