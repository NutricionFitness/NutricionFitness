/**
 * Medidas caseras: traducir entre gramos y «2 unidades».
 *
 * Las medidas NO se guardan en el componente. Si se guardaran, el primer ajuste
 * las desincronizaría —el motor mueve gramos, no unidades— y acabarías viendo
 * «2 huevos» junto a 87 g. Los gramos son el dato; la medida se deduce al
 * mostrar y se usa al escribir.
 */

export interface Medida {
  id: string;
  nombre: string;
  gramos: number;
  owner_id: string | null;
}

export interface Equivalencia {
  ingrediente_crudo_id: number;
  ingrediente_cocido_id: number;
  factor: number;
  agua_crudo: number | null;
  agua_cocido: number | null;
}

/** Cuántas medidas son esos gramos: 106 g de huevo → 2 unidades. */
export function enMedidas(gramos: number, medida: Medida): number {
  if (!medida || medida.gramos <= 0) return 0;
  return gramos / Number(medida.gramos);
}

/**
 * Etiqueta legible para una cantidad, o null si no cuadra con ninguna medida.
 *
 * Solo se enseña cuando el resultado es un número redondo o un medio: decir
 * «1,37 unidades de huevo» no ayuda a nadie, y decir «1 unidad» cuando son 72 g
 * sería mentir. En la duda, no se enseña nada y mandan los gramos.
 */
export function etiquetaMedida(
  gramos: number,
  medidas: Medida[] | null | undefined,
  tolerancia = 0.06,
): string | null {
  if (!medidas?.length || gramos <= 0) return null;

  let mejor: { texto: string; puntos: number } | null = null;
  for (const m of medidas) {
    const g = Number(m.gramos);
    if (!(g > 0)) continue;
    const n = gramos / g;
    if (n < 0.4 || n > 24) continue;
    // se admiten enteros y medios: 1, 1½, 2…
    const redondo = Math.round(n * 2) / 2;
    if (redondo <= 0) continue;
    const error = Math.abs(n - redondo) / redondo;
    if (error > tolerancia) continue;
    // Entre «½ cucharada» y «1 cucharadita», que encajan igual de bien, gana la
    // que sale en número entero: es como lo diría cualquiera.
    const puntos = (Number.isInteger(redondo) ? 0 : 1) + error;
    const texto = `${formatear(redondo)} ${m.nombre}`;
    if (!mejor || puntos < mejor.puntos) mejor = { texto, puntos };
  }
  return mejor?.texto ?? null;
}

function formatear(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const entero = Math.floor(n);
  return entero === 0 ? "½" : `${entero}½`;
}

/** La medida que conviene ofrecer por defecto al añadir un ingrediente. */
export function medidaPorDefecto(medidas: Medida[] | null | undefined): Medida | null {
  if (!medidas?.length) return null;
  // Las propias del usuario mandan sobre las de serie.
  const propias = medidas.filter((m) => m.owner_id !== null);
  return (propias.length ? propias : medidas)[0];
}

export interface Conversion {
  haciaCocido: boolean;
  ingredienteDestino: number;
  factor: number;
  gramosDestino: number;
}

/**
 * Si el ingrediente tiene pareja crudo/cocido, cómo sería el cambio.
 *
 * El factor son gramos de cocido por gramo de crudo, así que al pasar de cocido
 * a crudo se divide. Devuelve null cuando no hay equivalencia: la mayoría de los
 * alimentos del catálogo no la tienen y eso es normal.
 */
export function conversionDisponible(
  ingredienteId: number,
  gramos: number,
  equivalencias: Equivalencia[] | null | undefined,
): Conversion | null {
  if (!equivalencias?.length) return null;

  const comoCrudo = equivalencias.find((e) => e.ingrediente_crudo_id === ingredienteId);
  if (comoCrudo) {
    const f = Number(comoCrudo.factor);
    return {
      haciaCocido: true,
      ingredienteDestino: comoCrudo.ingrediente_cocido_id,
      factor: f,
      gramosDestino: Math.round(gramos * f * 10) / 10,
    };
  }

  const comoCocido = equivalencias.find((e) => e.ingrediente_cocido_id === ingredienteId);
  if (comoCocido) {
    const f = Number(comoCocido.factor);
    return {
      haciaCocido: false,
      ingredienteDestino: comoCocido.ingrediente_crudo_id,
      factor: 1 / f,
      gramosDestino: Math.round((gramos / f) * 10) / 10,
    };
  }
  return null;
}

/** Avisa si la dieta dice ir «en crudo» y hay ingredientes cocidos, o al revés. */
export function estadosIncoherentes(
  estadoDieta: string,
  estados: string[],
): { estado: string; n: number }[] {
  if (estadoDieta === "mixto") return [];
  const contrario = estadoDieta === "crudo" ? "cocido" : "crudo";
  const n = estados.filter((e) => e === contrario).length;
  return n > 0 ? [{ estado: contrario, n }] : [];
}
