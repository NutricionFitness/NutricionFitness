import Link from "next/link";
import { notFound } from "next/navigation";

import EditorDieta from "@/components/EditorDieta";
import { clienteServidor } from "@/lib/supabase/servidor";
import type { DietaCompleta } from "@/lib/dominio/tipos";

export const dynamic = "force-dynamic";

const CAMPOS_INGREDIENTE =
  "id, owner_id, codigo_bedca, nombre, nombre_norm, nombre_en, grupo, estado, " +
  "prot_100, hc_100, grasa_100, fibra_100, alcohol_100, ags_100, agua_100, " +
  "sodio_100, kcal_ref, kcal_100, porcion_comestible, origen, preferente, revisado";

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

  const persona = (data as unknown as { personas: { id: string; nombre: string } | null }).personas;

  return (
    <>
      <p className="sub" style={{ margin: 0 }}>
        {persona ? (
          <Link href={`/personas/${persona.id}`}>← {persona.nombre}</Link>
        ) : (
          <Link href="/personas">← Personas</Link>
        )}
      </p>
      <h1>{data.nombre}</h1>
      <p className="sub">
        Versión {data.version}
        {data.dieta_padre_id ? " · procede de un ajuste" : ""} · cantidades en{" "}
        {data.estado_cantidades} ·{" "}
        <Link href={`/dietas/${data.id}/historial`}>ver historial</Link>
      </p>
      <EditorDieta dieta={data as unknown as DietaCompleta} />
    </>
  );
}
