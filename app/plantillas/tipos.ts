/**
 * Los tipos de la pantalla de plantillas.
 *
 * Viven aquí y no en `acciones.ts` porque un fichero `"use server"` solo puede
 * exportar funciones asíncronas. Mismo motivo que `app/dietas/[id]/tipos.ts`.
 */

import type { FilaPlantillaComponente } from "@/lib/dominio/tipos";

/**
 * Una plantilla como se ve en su pantalla.
 *
 * Trae sus componentes con el ingrediente dentro y **ninguna cifra calculada**:
 * las kcal y el reparto los saca la pantalla con el motor. Aquí no hay dieta de
 * destino, así que se calculan con Atwater, que es el modelo por defecto; en
 * una dieta con `modelo_energia = 'declarada'` la misma plantilla puede valer
 * un poco distinto, y por eso el selector de importar las vuelve a calcular
 * con el modelo de esa dieta.
 */
export interface PlantillaGuardada {
  id: string;
  nombre: string;
  comidaSugerida: string | null;
  estadoCantidades: "crudo" | "cocido" | "mixto";
  notas: string | null;
  creadoEn: string;
  actualizadoEn: string;
  componentes: FilaPlantillaComponente[];
}
