/**
 * Sustitución de ingredientes.
 *
 * Cierra el hallazgo de la fase 0: moviendo gramos de los mismos alimentos hay
 * un techo. Pedir 35% de proteína a una dieta que va por el 26% no se consigue
 * ajustando cantidades —el motor lo dice y avisa—; hace falta cambiar QUÉ
 * alimentos hay.
 *
 * La primitiva es la sustitución **isoenergética**: cambiar A por B en la
 * cantidad que aporta las mismas kilocalorías. Así el total no se mueve y lo
 * único que cambia es el reparto de macros, que es justo lo que se quiere
 * controlar. Con eso se responden las dos preguntas útiles:
 *
 *   · «no tengo merluza, ¿por qué la cambio?»  → el sustituto que menos altera
 *   · «no llego al 35% de proteína»            → el cambio que más acerca
 */

export interface Candidato {
  id: number;
  nombre: string;
  grupo: string | null;
  estado: string;
  prot: number;
  hc: number;
  grasa: number;
  /** kcal por 100 g; en la base es columna generada, aquí llega ya calculada. */
  kcal100: number;
}

export interface Macros {
  prot: number;
  hc: number;
  grasa: number;
}

export interface Sustitucion {
  candidato: Candidato;
  /** Gramos del sustituto que aportan la misma energía. */
  gramos: number;
  /** Cuánto cambia cada macro de la dieta, en gramos. */
  delta: Macros;
  /** 0 = no altera nada. Sin unidad: sirve para ordenar. */
  distancia: number;
  /** Solo en modo dirigido: cuánto acerca al objetivo. Negativo = aleja. */
  mejora?: number;
}

const FACTOR = { prot: 4, hc: 4, grasa: 9 } as const;
const MACROS = ["prot", "hc", "grasa"] as const;

/**
 * Gramos del candidato que aportan la misma energía que `gramos` del actual.
 * Devuelve null si el candidato no aporta energía: nada de él iguala a un arroz.
 */
export function gramosIsoenergeticos(
  kcal100Actual: number,
  gramos: number,
  kcal100Candidato: number,
): number | null {
  if (!(kcal100Candidato > 0)) return null;
  return (gramos * kcal100Actual) / kcal100Candidato;
}

function macrosDe(c: Pick<Candidato, "prot" | "hc" | "grasa">, gramos: number): Macros {
  return {
    prot: (c.prot * gramos) / 100,
    hc: (c.hc * gramos) / 100,
    grasa: (c.grasa * gramos) / 100,
  };
}

export interface OpcionesSustitucion {
  /** Rango de gramos admisible respecto a la cantidad original. */
  minRelativo?: number;
  maxRelativo?: number;
  /** Cuántas propuestas devolver. */
  limite?: number;
  /** Escala para normalizar el cambio de macros: los totales de la dieta. */
  referencia?: Macros;
  /**
   * Mejora mínima, en puntos porcentuales sumados, para que una sustitución
   * dirigida merezca proponerse.
   *
   * No es un detalle: cambiar 100 g de arroz por 313 g de pollo triplica la
   * proteína y aun así solo acerca 0,1 puntos al objetivo, porque de paso hunde
   * los hidratos. Ofrecer eso como «te ayuda» sería engañoso.
   */
  mejoraMinima?: number;
  /**
   * Tope absoluto de gramos. Ningún componente de una dieta real pasa de aquí,
   * por muy isoenergético que salga el cambio.
   */
  maxGramosAbsoluto?: number;
  /**
   * Grupos que no se proponen al cruzar de un grupo a otro.
   *
   * El café soluble en polvo, los cubitos de caldo o la levadura tienen un
   * perfil de macros estupendo por 100 g, y el algoritmo, si le dejas, propone
   * 258 g de café soluble para subir la proteína. Es correcto y es absurdo:
   * nadie se come eso. Dentro del mismo grupo sí valen —si estás cambiando un
   * café, otro café es una respuesta razonable—.
   */
  gruposExcluidosAlCruzar?: string[];
}

const POR_DEFECTO = {
  // Cambiar 80 g de arroz por 900 g de lechuga es isoenergético y no sirve para
  // nada. Fuera de esta banda, la sustitución deja de ser realista.
  minRelativo: 0.25,
  maxRelativo: 4,
  limite: 8,
  mejoraMinima: 0.5,
  maxGramosAbsoluto: 500,
  gruposExcluidosAlCruzar: ["Bebidas", "Salsas y condimentos", "Suplementos"],
};

function evaluar(
  actual: Candidato,
  gramos: number,
  candidato: Candidato,
  opciones: OpcionesSustitucion,
): Sustitucion | null {
  if (candidato.id === actual.id) return null;
  const g = gramosIsoenergeticos(actual.kcal100, gramos, candidato.kcal100);
  if (g === null) return null;

  const min = opciones.minRelativo ?? POR_DEFECTO.minRelativo;
  const max = opciones.maxRelativo ?? POR_DEFECTO.maxRelativo;
  if (g < gramos * min || g > gramos * max) return null;
  if (g > (opciones.maxGramosAbsoluto ?? POR_DEFECTO.maxGramosAbsoluto)) return null;

  const excluidos = opciones.gruposExcluidosAlCruzar ?? POR_DEFECTO.gruposExcluidosAlCruzar;
  if (candidato.grupo !== actual.grupo && candidato.grupo && excluidos.includes(candidato.grupo))
    return null;

  const antes = macrosDe(actual, gramos);
  const despues = macrosDe(candidato, g);
  const delta: Macros = {
    prot: despues.prot - antes.prot,
    hc: despues.hc - antes.hc,
    grasa: despues.grasa - antes.grasa,
  };

  // La escala importa: 5 g de proteína pesan mucho en una dieta de 60 g y poco
  // en una de 150. Si no hay referencia, se usa el propio componente.
  const ref = opciones.referencia ?? {
    prot: Math.max(antes.prot, 1),
    hc: Math.max(antes.hc, 1),
    grasa: Math.max(antes.grasa, 1),
  };
  const distancia = MACROS.reduce(
    (s, m) => s + Math.abs(delta[m]) / Math.max(ref[m], 1),
    0,
  );

  return { candidato, gramos: Math.round(g * 10) / 10, delta, distancia };
}

/**
 * Sustitutos que menos alteran la dieta, de más a menos parecido.
 *
 * Es la respuesta a «no tengo esto, ¿por qué lo cambio?».
 */
export function rankearSustitutos(
  actual: Candidato,
  gramos: number,
  candidatos: Candidato[],
  opciones: OpcionesSustitucion = {},
): Sustitucion[] {
  if (!(gramos > 0) || !(actual.kcal100 > 0)) return [];
  const out: Sustitucion[] = [];
  for (const c of candidatos) {
    const s = evaluar(actual, gramos, c, opciones);
    if (s) out.push(s);
  }
  out.sort((a, b) => a.distancia - b.distancia || a.candidato.nombre.localeCompare(b.candidato.nombre));
  return out.slice(0, opciones.limite ?? POR_DEFECTO.limite);
}

/** Distancia del reparto actual al objetivo, en puntos porcentuales de energía. */
export function distanciaAlObjetivo(
  macros: Macros,
  energia: number,
  objetivoPct: Partial<Macros>,
): number {
  if (!(energia > 0)) return Infinity;
  let d = 0;
  for (const m of MACROS) {
    const pedido = objetivoPct[m];
    if (pedido === undefined) continue;
    const pedidoPct = pedido <= 1.5 ? pedido * 100 : pedido;
    const actual = (100 * FACTOR[m] * macros[m]) / energia;
    d += Math.abs(actual - pedidoPct);
  }
  return d;
}

/**
 * ¿Tiene sentido siquiera buscar «lo que más acerca» a este objetivo?
 *
 * Existe porque el panel de sustitución ofrecía el modo dirigido en
 * situaciones donde **no podía funcionar**, y la respuesta era siempre la
 * misma: «ningún cambio acerca al reparto pedido». Pasaba en dos casos:
 *
 *   · sin reparto pedido —el objetivo llegaba vacío—, y
 *   · con el reparto pedido igual al que ya tiene la dieta, que es lo que
 *     manda la pantalla cuando se activa el control de macros sin pedir otro.
 *
 * En los dos, la distancia de partida es cero. Y si la partida es cero,
 * ninguna sustitución puede restarle nada: `mejora` sale cero o negativa y
 * todas se descartan. No era un fallo del cálculo; era ofrecer un botón que no
 * podía contestar otra cosa.
 *
 * El margen no es un número redondo elegido a ojo: es la **misma** mejora
 * mínima que exige `rankearHaciaObjetivo`. Si la distancia de partida no llega
 * a ella, la mejor sustitución posible —la que llevara la dieta exactamente al
 * objetivo— tampoco la alcanzaría, así que no hay nada que ofrecer.
 */
export function mereceDirigido(
  macrosDieta: Macros,
  energiaDieta: number,
  objetivoPct: Partial<Macros> | null | undefined,
  margen: number = POR_DEFECTO.mejoraMinima,
): boolean {
  if (!(energiaDieta > 0)) return false;
  if (!objetivoPct || !MACROS.some((m) => objetivoPct[m] !== undefined)) return false;
  return distanciaAlObjetivo(macrosDieta, energiaDieta, objetivoPct) >= margen;
}

/**
 * Sustituciones que más acercan al reparto de macros pedido.
 *
 * Es la respuesta a «el ajuste dice que no llego al 35% de proteína».
 *
 * Como el cambio es isoenergético, la energía de la dieta no se mueve, así que
 * comparar repartos antes y después es legítimo: solo cambia el numerador.
 * Solo se devuelven las que mejoran de verdad; ofrecer un cambio que aleja del
 * objetivo sería peor que no ofrecer nada.
 */
export function rankearHaciaObjetivo(
  actual: Candidato,
  gramos: number,
  candidatos: Candidato[],
  macrosDieta: Macros,
  energiaDieta: number,
  objetivoPct: Partial<Macros>,
  opciones: OpcionesSustitucion = {},
): Sustitucion[] {
  if (!(gramos > 0) || !(actual.kcal100 > 0) || !(energiaDieta > 0)) return [];

  const partida = distanciaAlObjetivo(macrosDieta, energiaDieta, objetivoPct);
  const out: Sustitucion[] = [];

  for (const c of candidatos) {
    const s = evaluar(actual, gramos, c, { ...opciones, referencia: macrosDieta });
    if (!s) continue;
    const nuevos: Macros = {
      prot: macrosDieta.prot + s.delta.prot,
      hc: macrosDieta.hc + s.delta.hc,
      grasa: macrosDieta.grasa + s.delta.grasa,
    };
    const mejora = partida - distanciaAlObjetivo(nuevos, energiaDieta, objetivoPct);
    if (mejora < (opciones.mejoraMinima ?? POR_DEFECTO.mejoraMinima)) continue;
    out.push({ ...s, mejora: Math.round(mejora * 100) / 100 });
  }

  out.sort((a, b) => (b.mejora ?? 0) - (a.mejora ?? 0));
  return out.slice(0, opciones.limite ?? POR_DEFECTO.limite);
}
