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

// ---------------------------------------------------------------------------
// Transferir una dieta a otra persona (fase 22)
// ---------------------------------------------------------------------------

/** Un alérgeno de la persona de destino que esta dieta lleva dentro. */
export interface ChoqueAlergia {
  alergeno: string;
  /** Cuántos ingredientes distintos de la dieta lo llevan. */
  ingredientes: number;
}

/** Una persona a la que se le puede pasar la dieta. */
export interface PersonaDestino {
  id: string;
  nombre: string;
  pesoKg: number | null;
  /** Vacío si esta dieta no choca con ninguna de sus alergias. */
  choques: ChoqueAlergia[];
}

/**
 * Todo lo que el diálogo necesita, en una sola ida al servidor.
 *
 * Se pide **al pulsar el botón**, no en un efecto del diálogo y no en la página:
 *
 *  · en la página sería trabajo en cada carga del listado para algo que casi
 *    nunca se abre;
 *  · en un efecto sería la trampa de la fase 16, y además el cruce de alergias
 *    tendría que rehacerse cada vez que se cambia de persona en el selector.
 *
 * Por eso viene el cruce de **todos** los destinos posibles de una vez: son dos
 * consultas más, no una por persona, y el diálogo se queda sin nada que
 * consultar mientras está abierto.
 */
export interface DatosTransferencia {
  dietaNombre: string;
  /** Qué número de versión es la que se está transfiriendo. */
  version: number;
  /** Nula si la dieta no cuelga de ninguna persona, que el esquema lo permite. */
  origen: { id: string; nombre: string; pesoKg: number | null } | null;
  /** Cuántas dietas tiene el árbol de versiones entero. */
  versiones: number;
  /** Cuántas cuelgan directamente de esta. */
  hijas: number;
  /** El nombre de su madre, para poder decir de quién pasarían a colgar. */
  nombrePadre: string | null;
  /** Cuántos ingredientes de la dieta no tienen los alérgenos revisados. */
  sinRevisar: number;
  /** Las personas de la cuenta menos la que ya la tiene. */
  destinos: PersonaDestino[];
}

/** Las tres cosas que se pueden hacer, tal y como se eligen en el diálogo. */
export type AlcanceTransferencia = "linaje" | "sola" | "copia";
