import Link from "next/link";
import { notFound } from "next/navigation";

import CabeceraDieta from "@/components/CabeceraDieta";
import EditorDieta from "@/components/EditorDieta";
import { clienteServidor } from "@/lib/supabase/servidor";
import { alergenosDeIngredientes, alergiasDePersona } from "@/app/alergenos/consultas";
import type { DietaCompleta } from "@/lib/dominio/tipos";

export const dynamic = "force-dynamic";

const CAMPOS_INGREDIENTE =
  "id, owner_id, codigo_bedca, nombre, nombre_norm, nombre_en, grupo, estado, " +
  "prot_100, hc_100, grasa_100, fibra_100, alcohol_100, ags_100, agua_100, " +
  "sodio_100, kcal_ref, kcal_100, porcion_comestible, origen, preferente, revisado, " +
  "medidas_caseras ( id, nombre, gramos, owner_id )";

export default async function PaginaDieta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await clienteServidor();

  const { data, error } = await supabase
    .from("dietas")
    .select(
      `id, owner_id, persona_id, nombre, descripcion, modelo_energia,
       estado_cantidades, kcal_objetivo, version, dieta_padre_id, archivada, creado_en,
       personas ( id, nombre ),
       comidas ( id, dieta_id, nombre, orden,
         componentes ( id, comida_id, ingrediente_id, gramos, orden, bloqueado,
                       prioridad, min_g, max_g, paso_g,
                       ingredientes ( ${CAMPOS_INGREDIENTE} ) ) )`,
    )
    .eq("id", id)
    .single();

  if (error || !data) notFound();

  // Equivalencias crudo↔cocido de los ingredientes que hay en esta dieta.
  // Van en consulta aparte porque no cuelgan del ingrediente: son una relación
  // entre dos de ellos.
  const idsIngredientes = [
    ...new Set(
      ((data as unknown as DietaCompleta).comidas ?? []).flatMap((m) =>
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

  const persona = (data as unknown as { personas: { id: string; nombre: string } | null }).personas;

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
          estado_cantidades: data.estado_cantidades as string,
          version: data.version as number,
          dieta_padre_id: data.dieta_padre_id as string | null,
          persona_id: data.persona_id as string | null,
        }}
        nVersiones={nVersiones}
      />
      <EditorDieta
        dieta={data as unknown as DietaCompleta}
        equivalencias={equivalencias ?? []}
        alergias={alergias}
        alergenos={alergenos}
        persona={persona?.nombre ?? null}
      />
    </>
  );
}
