import Link from "next/link";
import { notFound } from "next/navigation";

import HojaDieta from "@/components/HojaDieta";
import { clienteServidor } from "@/lib/supabase/servidor";
import { cargarDieta } from "@/lib/supabase/dieta";
import type { DietaCompleta } from "@/lib/dominio/tipos";
import "@/app/hoja.css";

export const dynamic = "force-dynamic";

const CAMPOS_INGREDIENTE =
  "id, owner_id, codigo_bedca, nombre, nombre_norm, nombre_en, grupo, estado, " +
  "prot_100, hc_100, grasa_100, fibra_100, alcohol_100, ags_100, agua_100, " +
  "sodio_100, kcal_ref, kcal_100, porcion_comestible, origen, preferente, revisado, " +
  "medidas_caseras ( id, nombre, gramos, owner_id )";

export default async function Imprimir({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await clienteServidor();

  const cargada = await cargarDieta(
    supabase,
    id,
    CAMPOS_INGREDIENTE,
    undefined,
    "personas ( id, nombre )",
  );
  if (cargada.error) throw new Error(cargada.error);
  if (!cargada.dieta) notFound();
  const data = cargada.dieta;

  const persona = (
    data as unknown as { personas: { id: string; nombre: string } | null }
  ).personas;

  return (
    <>
      <p className="no-imprimir migas" style={{ margin: "0 0 16px" }}>
        <Link href={`/dietas/${id}`}>← Volver a la dieta</Link>
      </p>
      <HojaDieta dieta={data as unknown as DietaCompleta} persona={persona} />
    </>
  );
}
