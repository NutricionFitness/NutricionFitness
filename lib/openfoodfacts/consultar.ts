import type { ProductoOFF } from "./convertir";

/**
 * Preguntar a Open Food Facts por un código, en vivo.
 *
 * Es el único fichero de esta carpeta que sale a la red, y por eso el único
 * sin batería: lo que se puede probar de verdad —comprobar el código,
 * convertir la ficha— está en `ean.ts` y en `convertir.ts`. Esto solo hace la
 * llamada y traduce lo que pase (404, 429, plantón) a algo que una pantalla
 * pueda decir.
 *
 * Vivía dentro de `app/ingredientes/escanear.ts`, el alta con sesión. Se sacó
 * cuando el comparador público empezó a escanear también: son dos pantallas y
 * una sola manera de preguntar.
 *
 * Se llama **desde el servidor**, nunca desde el navegador. Su API pide una
 * cabecera `User-Agent` identificable y el navegador no deja ponerla.
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

export type RespuestaOFF =
  /** Hay ficha. Sin convertir: quien pregunta decide qué hace con ella. */
  | { estado: "encontrado"; producto: ProductoOFF }
  /** Open Food Facts no conoce ninguna de las formas del código. */
  | { estado: "no_encontrado" }
  /** No se ha podido preguntar: sin red, caído o demasiadas peticiones. */
  | { estado: "sin_respuesta"; motivo: string };

/**
 * Prueba las formas del código en orden y se queda con la primera que responda.
 *
 * @param consultas las de `normalizarEan`: el código tal cual y sus variantes.
 */
export async function consultarOpenFoodFacts(consultas: string[]): Promise<RespuestaOFF> {
  let ultimoMotivo = "";

  for (const codigo of consultas) {
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
        motivo:
          e instanceof Error && e.name === "TimeoutError"
            ? "Open Food Facts ha tardado demasiado."
            : "No se ha podido conectar con Open Food Facts.",
      };
    }

    if (respuesta.status === 429)
      return {
        estado: "sin_respuesta",
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

    return { estado: "encontrado", producto: cuerpo.product };
  }

  if (ultimoMotivo && ultimoMotivo !== "no encontrado")
    return { estado: "sin_respuesta", motivo: ultimoMotivo };

  return { estado: "no_encontrado" };
}
