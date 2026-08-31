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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `?dieta=<uuid>` lo pone el enlace del nombre en la tabla de una dieta:
   *  es lo que permite volver a ella desde aquí. */
  searchParams: Promise<{ dieta?: string }>;
}) {
  const [{ id }, { dieta: dietaId }] = await Promise.all([params, searchParams]);
  const numero = Number(id);
  if (!Number.isInteger(numero)) notFound();

  const supabase = await clienteServidor();

  // De dónde se viene: lo pone el enlace del nombre en la tabla de una dieta.
  const idDieta =
    typeof dietaId === "string" && /^[0-9a-f-]{36}$/i.test(dietaId) ? dietaId : null;

  const [{ data }, grupos, catalogo, vuelta] = await Promise.all([
    supabase
      .from("ingredientes")
      .select(
        `id, owner_id, nombre, grupo, estado, codigo_bedca, codigo_barras, origen, notas,
         prot_100, hc_100, grasa_100, fibra_100, alcohol_100, ags_100, agua_100,
         sodio_100, kcal_ref, porcion_comestible, revisado, editado_a_mano,
         alergenos_revisados, actualizado_en,
         medidas_caseras ( id, nombre, gramos, owner_id ),
         ingrediente_alergenos ( alergeno_id )`,
      )
      .eq("id", numero)
      .single(),
    gruposDisponibles(),
    catalogoAlergenos(),
    idDieta
      ? supabase.from("dietas").select("id, nombre").eq("id", idDieta).maybeSingle()
      : Promise.resolve(null),
  ]);

  if (!data) notFound();

  // Si la dieta no existe o no es tuya, el RLS no devuelve nada y no se ofrece
  // la vuelta: ni se enseña un enlace que no lleva a ningún sitio, ni se filtra
  // el nombre de la dieta de otro.
  const volver = vuelta?.data
    ? { href: `/dietas/${vuelta.data.id}`, nombre: vuelta.data.nombre as string }
    : null;

  const numero_o_null = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const ficha: FichaCompleta = {
    id: data.id as number,
    propio: data.owner_id !== null,
    nombre: data.nombre as string,
    grupo: (data.grupo as string | null) ?? null,
    estado: data.estado as Estado,
    codigo_bedca: (data.codigo_bedca as string | null) ?? null,
    codigo_barras: (data.codigo_barras as string | null) ?? null,
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
    medidas: ((data.medidas_caseras ?? []) as {
      id: string; nombre: string; gramos: number; owner_id: string | null;
    }[])
      // Sin dueño = de serie: se usa, no se toca.
      .map((m) => ({
        id: m.id,
        nombre: m.nombre,
        gramos: Number(m.gramos),
        propia: m.owner_id !== null,
      }))
      .sort((a, b) => a.gramos - b.gramos),
  };

  const puestos = (
    (data.ingrediente_alergenos ?? []) as { alergeno_id: number }[]
  ).map((x) => Number(x.alergeno_id));

  return (
    <>
      <p className="migas">
        {volver ? (
          <>
            <Link href={volver.href}>← {volver.nombre}</Link>
            <span aria-hidden>·</span>
            <Link href="/ingredientes">Ingredientes</Link>
          </>
        ) : (
          <Link href="/ingredientes">← Ingredientes</Link>
        )}
      </p>
      <FichaIngrediente
        ficha={ficha}
        grupos={grupos}
        volver={volver}
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
