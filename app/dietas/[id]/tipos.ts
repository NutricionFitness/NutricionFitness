/**
 * Los tipos del plan de cambios.
 *
 * Viven aquí y no en `acciones.ts` porque un fichero `"use server"` solo puede
 * exportar funciones asíncronas: cualquier otra cosa —una interfaz incluida—
 * hace fallar la compilación. Es el mismo motivo por el que existe
 * `app/ingredientes/tipos.ts`.
 */

import type { PasoDelPlan, Plan } from "@/lib/dominio/plan-sustitucion";
import type { Macros } from "@/lib/dominio/sustituir";

/** Un paso, más lo que hay que saber de él en materia de alergias. */
export interface PasoConAlergias extends PasoDelPlan {
  /**
   * El sustituto tiene los alérgenos revisados a mano.
   *
   * Los que no lo están se proponen igual —dejarlos fuera vaciaría media
   * propuesta—, pero se dicen: lo que se sabe de ellos viene deducido de la
   * fuente y del nombre, y eso no es lo mismo que estar comprobado.
   */
  revisado: boolean;
}

export interface PlanDeCambios extends Omit<Plan, "pasos"> {
  pasos: PasoConAlergias[];
  /** Cuántos alimentos se apartaron por chocar con una alergia declarada. */
  fueraPorAlergia: number;
  /** Cuántos de los propuestos no tienen los alérgenos revisados. */
  sinRevisar: number;
  /** Cuántos componentes de la dieta se han podido mirar. */
  mirados: number;
}

/** Un componente tal y como se lo manda la pantalla al servidor. */
export interface ComponenteParaPlan {
  componenteId: string;
  comida: string;
  ingredienteId: number;
  gramos: number;
  /** Falso si está bloqueado: entonces ni el motor ni esto le tocan. */
  movible: boolean;
}

/**
 * La foto de la dieta con la que se abre el plan.
 *
 * Se hace **al pulsar el botón** y no se recalcula. El plan vive dentro del
 * cajón de ajuste, que tiene deslizantes: si esto se rehiciera en cada render,
 * el plan se volvería a buscar cada vez que se mueve el control de kcal y
 * cambiaría bajo la mano mientras se está leyendo.
 */
export interface DatosPlan {
  componentes: ComponenteParaPlan[];
  macrosDieta: Macros;
  energiaDieta: number;
  objetivoPct: Partial<Macros>;
  /** Los alérgenos de la persona de esta dieta. */
  alergenos: number[];
  conAlergias: boolean;
}
