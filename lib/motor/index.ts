/**
 * Motor de ajuste de dietas — App Nutrición.
 *
 * Port a TypeScript del motor de la fase 2. Sin dependencias: corre igual en el
 * navegador que en el servidor, así que el control de kcal puede recalcular al
 * instante sin una sola petición de red.
 *
 *     import { ajustar, energia, resumen } from "@/lib/motor";
 *
 *     const res = ajustar(dieta, 1700, { modo: "prioridades" });
 *     console.log(resumen(res));
 *
 * `ajustar` nunca modifica la dieta que recibe: devuelve una nueva.
 */

export {
  ErrorMotor,
  MACROS,
  comidas,
  esMovil,
  resumen,
  validarComponente,
  validarDieta,
  validarIngrediente,
} from "./modelo";
export type {
  Cambio,
  Componente,
  Dieta,
  Ingrediente,
  Macro,
  Modo,
  ModeloEnergia,
  Resultado,
} from "./modelo";

export {
  FACTORES,
  energia,
  gramosObjetivo,
  kcal100,
  limites,
  macros,
  matrices,
  porcentajes,
} from "./nutrientes";

export { DESCRIPCION, MODOS, pesos } from "./pesos";
export { alPaso, redondearAPasos } from "./redondeo";
export { ajustar } from "./solver";
export type { OpcionesAjuste } from "./solver";

export const VERSION = "0.3.0";
