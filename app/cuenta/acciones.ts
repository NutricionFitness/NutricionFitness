"use server";

import { revalidatePath } from "next/cache";

import { clienteServidor } from "@/lib/supabase/servidor";

/**
 * Enciende o apaga la publicación del catálogo propio.
 *
 * `upsert` y no `update`: la fila de `cuentas` puede no existir —la migración
 * la crea para las cuentas que había cuando se aplicó, pero una cuenta creada
 * después no la tiene—. Sin esto, el interruptor no haría nada y no diría por
 * qué, que es la peor forma de fallar.
 */
export async function cambiarCatalogoPublico(
  valor: boolean,
): Promise<{ error: string | null }> {
  const supabase = await clienteServidor();
  const { data: usuario } = await supabase.auth.getUser();
  if (!usuario?.user) return { error: "No hay sesión iniciada." };

  const { error } = await supabase
    .from("cuentas")
    .upsert(
      { owner_id: usuario.user.id, catalogo_publico: valor },
      { onConflict: "owner_id" },
    );
  if (error) {
    // El caso que más se va a dar: la migración 0011 sin aplicar.
    return {
      error:
        error.message.includes("cuentas") || error.code === "42P01"
          ? "Falta aplicar la migración 0011_catalogo_publico.sql en Supabase."
          : error.message,
    };
  }

  revalidatePath("/cuenta");
  revalidatePath("/comparador");
  return { error: null };
}
