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
}

export interface FilaComponente {
  id: string;
  comida_id: string;
  ingrediente_id: number;
  gramos: number;
  orden: number;
  bloqueado: boolean;
  prioridad: number;
  min_g: number | null;
  max_g: number | null;
  paso_g: number;
}

/** Lo que devuelve la consulta que trae una dieta entera de una vez. */
export interface DietaCompleta extends FilaDieta {
  comidas: Array<
    FilaComida & {
      componentes: Array<FilaComponente & { ingredientes: FilaIngrediente }>;
    }
  >;
}
