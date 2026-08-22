import Link from "next/link";
import { notFound } from "next/navigation";

import AlergenosIngrediente from "@/components/AlergenosIngrediente";
import FichaIngrediente, { type FichaCompleta } from "@/components/FichaIngrediente";
import { clienteServidor } from "@/lib/supabase/servidor";
import { catalogoAlergenos } from "@/app/alergenos/consultas";
import { gruposDisponibles } from "../grupos";
import type { Estado } from "../tipos";

export const dynamic = "force-dynamic";

export default async function Ingrediente({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numero = Number(id);
  if (!Number.isInteger(numero)) notFound();

  const supabase = await clienteServidor();

  const [{ data }, grupos, catalogo] = await Promise.all([
    supabase
      .from("ingredientes")
      .select(
        `id, owner_id, nombre, grupo, estado, codigo_bedca, origen, notas,
         prot_100, hc_100, grasa_100, fibra_100, alcohol_100, ags_100, agua_100,
         sodio_100, kcal_ref, porcion_comestible, revisado, editado_a_mano,
         alergenos_revisados, actualizado_en,
         medidas_caseras ( id, nombre, gramos ),
         ingrediente_alergenos ( alergeno_id )`,
      )
      .eq("id", numero)
      .single(),
    gruposDisponibles(),
    catalogoAlergenos(),
  ]);

  if (!data) notFound();

  const numero_o_null = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const ficha: FichaCompleta = {
    id: data.id as number,
    propio: data.owner_id !== null,
    nombre: data.nombre as string,
    grupo: (data.grupo as string | null) ?? null,
    estado: data.estado as Estado,
    codigo_bedca: (data.codigo_bedca as string | null) ?? null,
    origen: (data.origen as string | null) ?? null,
    notas: (data.notas as string | null) ?? null,
    prot_100: Number(data.prot_100),
    hc_100: Number(data.hc_100),
    grasa_100: Number(data.grasa_100),
    fibra_100: Number(data.fibra_100),
    alcohol_100: Number(data.alcohol_100),
    ags_100: numero_o_null(data.ags_100),
    agua_100: numero_o_null(data.agua_100),
    sodio_100: numero_o_null(data.sodio_100),
    kcal_ref: numero_o_null(data.kcal_ref),
    porcion_comestible: numero_o_null(data.porcion_comestible),
    revisado: Boolean(data.revisado),
    editado_a_mano: Boolean(data.editado_a_mano),
    actualizado_en: data.actualizado_en as string,
    medidas: ((data.medidas_caseras ?? []) as { id: string; nombre: string; gramos: number }[])
      .map((m) => ({ id: m.id, nombre: m.nombre, gramos: Number(m.gramos) }))
      .sort((a, b) => a.gramos - b.gramos),
  };

  const puestos = (
    (data.ingrediente_alergenos ?? []) as { alergeno_id: number }[]
  ).map((x) => Number(x.alergeno_id));

  return (
    <>
      <p className="migas">
        <Link href="/ingredientes">← Ingredientes</Link>
      </p>
      <FichaIngrediente
        ficha={ficha}
        grupos={grupos}
        alergenos={
          <AlergenosIngrediente
            ingredienteId={ficha.id}
            catalogo={catalogo}
            puestos={puestos}
            revisado={Boolean(data.alergenos_revisados)}
          />
        }
      />
    </>
  );
}
