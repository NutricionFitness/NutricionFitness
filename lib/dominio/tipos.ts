/** Filas tal y como salen de la base. */

export interface FilaIngrediente {
  id: number;
  owner_id: string | null;
  codigo_bedca: string | null;
  nombre: string;
  nombre_norm: string;
  nombre_en: string | null;
  grupo: string | null;
  estado: string;
  prot_100: number;
  hc_100: number;
  grasa_100: number;
  fibra_100: number;
  alcohol_100: number;
  ags_100: number | null;
  agua_100: number | null;
  sodio_100: number | null;
  kcal_ref: number | null;
  kcal_100: number;
  porcion_comestible: number | null;
  origen: string | null;
  preferente: boolean;
  revisado: boolean;
  /** Las medidas caseras vienen anidadas cuando la consulta las pide. */
  medidas_caseras?: Array<{
    id: string;
    nombre: string;
    gramos: number;
    owner_id: string | null;
  }>;
}

export interface FilaPersona {
  id: string;
  owner_id: string;
  nombre: string;
  notas: string | null;
  activa: boolean;
  creado_en: string;
}

export interface FilaDieta {
  id: string;
  owner_id: string;
  persona_id: string | null;
  nombre: string;
  descripcion: string | null;
  /** Si la nota de la dieta se imprime en la hoja. Apagado por defecto. */
  nota_en_hoja: boolean;
  modelo_energia: "atwater" | "declarada";
  estado_cantidades: "crudo" | "cocido" | "mixto";
  kcal_objetivo: number | null;
  version: number;
  dieta_padre_id: string | null;
  archivada: boolean;
  creado_en: string;
}

export interface FilaComida {
  id: string;
  dieta_id: string;
  nombre: string;
  orden: number;
  /**
   * Qué opción se está viendo. Puede llegar nula —si se borró la activa— y
   * entonces manda la primera por orden.
   */
  opcion_activa_id?: string | null;
}

/** Una alternativa dentro de una comida. La de menor `orden` es la referencia. */
export interface FilaOpcion {
  id: string;
  comida_id: string;
  nombre: string;
  orden: number;
}

export interface FilaComponente {
  id: string;
  comida_id: string;
  /** De qué opción de esa comida es. Obligatoria desde la migración 0012. */
  opcion_id?: string | null;
  ingrediente_id: number;
  gramos: number;
  orden: number;
  bloqueado: boolean;
  prioridad: number;
  min_g: number | null;
  max_g: number | null;
  paso_g: number;
}

/** Un componente con su ingrediente, tal y como llega de la consulta. */
export type ComponenteConIngrediente = FilaComponente & { ingredientes: FilaIngrediente };

/**
 * Lo que devuelve la consulta que trae una dieta entera de una vez.
 *
 * `componentes` trae los de **todas** las opciones, no solo los de la activa:
 * la pantalla necesita poder pintar las pestañas y comprobar equivalencias sin
 * volver al servidor, y el ajuste tiene que cuadrarlas todas. Quien se queda
 * solo con la activa es `aDieta`, que es quien habla con el motor.
 */
export interface DietaCompleta extends FilaDieta {
  comidas: Array<
    FilaComida & {
      opciones?: FilaOpcion[];
      componentes: ComponenteConIngrediente[];
    }
  >;
}

/**
 * Una opción guardada para reutilizar (fase 23).
 *
 * No lleva kcal: se calculan con el motor al mostrarla. Un ingrediente se puede
 * corregir desde la fase 12, así que una cifra guardada envejecería en
 * silencio; y `modelo_energia` es de la dieta, no de la plantilla, así que la
 * misma plantilla vale distinto en dos dietas.
 */
export interface FilaPlantilla {
  id: string;
  owner_id: string;
  nombre: string;
  /** Para qué comida se pensó. Ordena el selector, no lo filtra. */
  comida_sugerida: string | null;
  estado_cantidades: "crudo" | "cocido" | "mixto";
  notas: string | null;
  creado_en: string;
  actualizado_en: string;
  /** Vienen anidados cuando la consulta los pide. */
  plantilla_componentes?: FilaPlantillaComponente[];
}

/** Lo que lleva dentro una plantilla: `componentes` menos comida y opción. */
export interface FilaPlantillaComponente {
  id: string;
  plantilla_id: string;
  ingrediente_id: number;
  gramos: number;
  orden: number;
  bloqueado: boolean;
  prioridad: number;
  min_g: number | null;
  max_g: number | null;
  paso_g: number;
  /** El ingrediente entero, cuando la consulta lo trae anidado. */
  ingredientes?: FilaIngrediente;
}
