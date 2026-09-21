"use server";

import { consultarOpenFoodFacts } from "@/lib/openfoodfacts/consultar";
import { convertir } from "@/lib/openfoodfacts/convertir";
import { normalizarEan } from "@/lib/openfoodfacts/ean";
import { clienteServidor } from "@/lib/supabase/servidor";
import type { ResultadoEscaneo } from "./tipos";

/**
 * Buscar un producto por su código de barras.
 *
 * Primero en el catálogo propio y solo después fuera: el segundo escaneo del
 * mismo yogur no debe preguntar a nadie ni crear un duplicado.
 *
 * La consulta a Open Food Facts —`lib/openfoodfacts/consultar.ts`— se hace
 * **desde el servidor** y no desde el navegador por dos razones. Una, que su
 * API pide una cabecera `User-Agent` identificable y el navegador no deja
 * ponerla. Y otra, que así la clave de la caché es el catálogo: en cuanto un
 * código está dado de alta, deja de salir tráfico.
 */
export async function buscarPorCodigoBarras(bruto: string): Promise<ResultadoEscaneo> {
  const ean = normalizarEan(bruto);
  if (!ean) return { estado: "codigo_invalido" };

  // ------------------------------------------- 1. ¿lo tengo ya dado de alta?
  const supabase = await clienteServidor();
  const { data: mio } = await supabase
    .from("ingredientes")
    .select("id, nombre")
    .in("codigo_barras", ean.consultas)
    .limit(1)
    .maybeSingle();

  if (mio)
    return {
      estado: "en_catalogo",
      codigo: ean.codigo,
      ingrediente: { id: Number(mio.id), nombre: mio.nombre as string },
    };

  // ------------------------------------------------- 2. preguntar fuera
  const r = await consultarOpenFoodFacts(ean.consultas);

  switch (r.estado) {
    case "encontrado":
      return {
        estado: "encontrado",
        codigo: ean.codigo,
        // Se guarda el código tal cual se ha escaneado, no la forma con la que
        // ha respondido: es el que volverá a leerse del mismo envase.
        propuesta: convertir(r.producto, ean.codigo),
      };
    case "sin_respuesta":
      return { estado: "sin_respuesta", codigo: ean.codigo, motivo: r.motivo };
    default:
      return { estado: "no_encontrado", codigo: ean.codigo };
  }
}
