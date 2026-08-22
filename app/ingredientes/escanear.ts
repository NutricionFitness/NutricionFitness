"use server";

import { convertir, type ProductoOFF } from "@/lib/openfoodfacts/convertir";
import { normalizarEan } from "@/lib/openfoodfacts/ean";
import { clienteServidor } from "@/lib/supabase/servidor";
import type { ResultadoEscaneo } from "./tipos";

/**
 * Buscar un producto por su código de barras.
 *
 * Primero en el catálogo propio y solo después fuera: el segundo escaneo del
 * mismo yogur no debe preguntar a nadie ni crear un duplicado.
 *
 * La consulta a Open Food Facts se hace **desde el servidor** y no desde el
 * navegador por dos razones. Una, que su API pide una cabecera `User-Agent`
 * identificable y el navegador no deja ponerla. Y otra, que así la clave de la
 * caché es el catálogo: en cuanto un código está dado de alta, deja de salir
 * tráfico.
 */

/** Lo que exige Open Food Facts: `NombreApp/Versión (correo de contacto)`. */
const AGENTE = `AppNutricion/1.0 (${
  process.env.OPENFOODFACTS_CONTACTO || "sin-contacto-configurado"
})`;

/**
 * Solo estos campos.
 *
 * Una ficha completa de Open Food Facts pasa de los 100 kB —lleva el historial
 * de ediciones, las fotos, cincuenta puntuaciones—, y de todo eso aquí se usan
 * doce campos. Pedirlos por su nombre es la diferencia entre una respuesta de
 * 2 kB y una de 100.
 */
const CAMPOS = [
  "product_name",
  "product_name_es",
  "generic_name",
  "generic_name_es",
  "brands",
  "quantity",
  "nutrition_data_per",
  "nutriments",
  "allergens_tags",
  "traces_tags",
  "categories_tags",
].join(",");

const TIEMPO_MAXIMO = 7000;

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
  let ultimoMotivo = "";

  for (const codigo of ean.consultas) {
    let respuesta: Response;
    try {
      respuesta = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${codigo}.json?fields=${CAMPOS}`,
        {
          headers: { "User-Agent": AGENTE, Accept: "application/json" },
          signal: AbortSignal.timeout(TIEMPO_MAXIMO),
          cache: "no-store",
        },
      );
    } catch (e) {
      // Un fallo de red o un plantón no es «no existe»: son cosas distintas y
      // la pantalla dice cosas distintas.
      return {
        estado: "sin_respuesta",
        codigo: ean.codigo,
        motivo:
          e instanceof Error && e.name === "TimeoutError"
            ? "Open Food Facts ha tardado demasiado."
            : "No se ha podido conectar con Open Food Facts.",
      };
    }

    if (respuesta.status === 429)
      return {
        estado: "sin_respuesta",
        codigo: ean.codigo,
        motivo:
          "Open Food Facts limita a 15 consultas por minuto. Espera un poco y vuelve a probar.",
      };

    if (respuesta.status === 404) {
      ultimoMotivo = "no encontrado";
      continue; // puede que esté con otra forma del código
    }

    if (!respuesta.ok) {
      ultimoMotivo = `Open Food Facts ha respondido ${respuesta.status}.`;
      continue;
    }

    let cuerpo: { status?: number; product?: ProductoOFF };
    try {
      cuerpo = await respuesta.json();
    } catch {
      ultimoMotivo = "La respuesta de Open Food Facts no era legible.";
      continue;
    }

    if (cuerpo.status !== 1 || !cuerpo.product) {
      ultimoMotivo = "no encontrado";
      continue;
    }

    return {
      estado: "encontrado",
      codigo: ean.codigo,
      // Se guarda el código tal cual se ha escaneado, no la forma con la que ha
      // respondido: es el que volverá a leerse del mismo envase.
      propuesta: convertir(cuerpo.product, ean.codigo),
    };
  }

  if (ultimoMotivo && ultimoMotivo !== "no encontrado")
    return { estado: "sin_respuesta", codigo: ean.codigo, motivo: ultimoMotivo };

  return { estado: "no_encontrado", codigo: ean.codigo };
}
