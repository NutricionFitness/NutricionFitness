/**
 * Generar un código QR. Modo byte, corrección M, versiones 1 a 10.
 *
 * Sin dependencias, como el lector de EAN y por la misma razón: aquí solo hace
 * falta meter una URL corta en un cuadrado, y eso es una función pura que se
 * puede probar hasta el último módulo. La batería de `codificar.test.ts`
 * compara la matriz que sale de aquí, casilla por casilla, con la de una
 * implementación de referencia sobre cientos de cadenas.
 *
 * Qué NO hace, a propósito:
 *
 * · Solo modo **byte**. Los modos numérico y alfanumérico aprietan más, pero
 *   una URL con minúsculas no cabe en el alfanumérico y el numérico no viene a
 *   cuento. Un modo menos es una tabla menos donde equivocarse.
 * · Solo corrección **M** (recupera ~15%). La L da un cuadrado más pequeño y la
 *   Q y la H uno más grande; en una pantalla de ordenador el tamaño no es el
 *   problema, y la M es la que aguanta que la foto salga torcida.
 * · Hasta la **versión 10**, que son 213 caracteres. Una URL que no quepa ahí
 *   es una URL que hay que acortar, no un QR que hay que agrandar: a partir de
 *   cierto tamaño los módulos son tan finos que la cámara no los separa.
 */

/** Nivel M. Los cuatro números que definen cada versión. */
interface Version {
  /** Palabras de corrección por bloque. */
  ec: number;
  /** [cuántos bloques, palabras de datos en cada uno] del primer grupo. */
  g1: [number, number];
  /** Lo mismo del segundo grupo, que muchas versiones no tienen. */
  g2: [number, number];
  /** Centros de los patrones de alineación. */
  alineacion: number[];
}

const VERSIONES: Version[] = [
  { ec: 10, g1: [1, 16], g2: [0, 0], alineacion: [] }, // 1
  { ec: 16, g1: [1, 28], g2: [0, 0], alineacion: [6, 18] },
  { ec: 26, g1: [1, 44], g2: [0, 0], alineacion: [6, 22] },
  { ec: 18, g1: [2, 32], g2: [0, 0], alineacion: [6, 26] },
  { ec: 24, g1: [2, 43], g2: [0, 0], alineacion: [6, 30] },
  { ec: 16, g1: [4, 27], g2: [0, 0], alineacion: [6, 34] },
  { ec: 18, g1: [4, 31], g2: [0, 0], alineacion: [6, 22, 38] },
  { ec: 22, g1: [2, 38], g2: [2, 39], alineacion: [6, 24, 42] },
  { ec: 22, g1: [3, 36], g2: [2, 37], alineacion: [6, 26, 46] },
  { ec: 26, g1: [4, 43], g2: [1, 44], alineacion: [6, 28, 50] }, // 10
];

/** Palabras de datos que caben en una versión, sumando sus dos grupos. */
const palabrasDatos = (v: Version) => v.g1[0] * v.g1[1] + v.g2[0] * v.g2[1];

// ------------------------------------------------------------- GF(256) -----
// La aritmética de los bytes de corrección. El campo es el de siempre en QR:
// polinomio primitivo 0x11D y generador 2.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const multiplicar = (a: number, b: number) =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];

/**
 * El polinomio generador de grado `n`: (x−α⁰)(x−α¹)…(x−αⁿ⁻¹).
 *
 * Los coeficientes van **de mayor a menor grado**, así que `g[0]` es siempre 1.
 * Es el orden que espera la división de `correccion`, y equivocarse aquí no da
 * ningún error: sale un código QR perfecto que no dice lo que tiene que decir.
 */
function generador(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const siguiente = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      siguiente[j] ^= g[j]; // el término en x
      siguiente[j + 1] ^= multiplicar(g[j], EXP[i]); // el término constante
    }
    g = siguiente;
  }
  return g;
}

/** Las `n` palabras de corrección de un bloque de datos. */
export function correccion(datos: number[], n: number): number[] {
  const g = generador(n);
  const resto = new Array(n).fill(0);

  for (const byte of datos) {
    const factor = byte ^ resto[0];
    resto.shift();
    resto.push(0);
    if (factor !== 0) for (let i = 0; i < n; i++) resto[i] ^= multiplicar(g[i + 1], factor);
  }
  return resto;
}

// ------------------------------------------------------- los datos --------

/** Convierte el texto a bytes UTF-8. */
const aBytes = (texto: string) => Array.from(new TextEncoder().encode(texto));

/** La versión más pequeña donde caben estos bytes. */
function elegirVersion(bytes: number): number {
  for (let v = 1; v <= VERSIONES.length; v++) {
    // Indicador de modo (4 bits) + cuenta de caracteres (8 bits hasta la v9,
    // 16 desde la v10) + los datos.
    const cabecera = 4 + (v >= 10 ? 16 : 8);
    if (palabrasDatos(VERSIONES[v - 1]) * 8 >= cabecera + bytes * 8) return v;
  }
  throw new Error(
    `No caben ${bytes} bytes en un QR de hasta versión 10 con corrección M. ` +
      "Acorta el texto: un QR más grande tampoco se leería bien.",
  );
}

/** La secuencia de bits del mensaje, ya rellena hasta llenar la versión. */
function bitsDelMensaje(bytes: number[], version: number): number[] {
  const v = VERSIONES[version - 1];
  const capacidad = palabrasDatos(v) * 8;
  const bits: number[] = [];
  const meter = (valor: number, cuantos: number) => {
    for (let i = cuantos - 1; i >= 0; i--) bits.push((valor >> i) & 1);
  };

  meter(0b0100, 4); // modo byte
  meter(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) meter(b, 8);

  // Terminador: hasta cuatro ceros, y solo si sobra sitio.
  meter(0, Math.min(4, capacidad - bits.length));
  // Hasta completar el byte.
  while (bits.length % 8 !== 0) bits.push(0);
  // Y el relleno de la norma, alternando estos dos bytes hasta el final.
  const relleno = [0xec, 0x11];
  for (let i = 0; bits.length < capacidad; i++) meter(relleno[i % 2], 8);

  return bits;
}

/** De bits a bytes. */
const aPalabras = (bits: number[]) => {
  const salida: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    salida.push(b);
  }
  return salida;
};

/**
 * Reparte los datos en bloques, calcula su corrección y lo entrelaza todo.
 *
 * El entrelazado es lo que hace que una mancha en el papel estropee un poco de
 * cada bloque en vez de un bloque entero: cada bloque tiene su propia
 * corrección, y repartidos así ninguno se lleva todo el daño.
 */
export function palabrasFinales(texto: string, version: number): number[] {
  const v = VERSIONES[version - 1];
  const palabras = aPalabras(bitsDelMensaje(aBytes(texto), version));

  const bloques: number[][] = [];
  let i = 0;
  for (const [cuantos, tamano] of [v.g1, v.g2])
    for (let b = 0; b < cuantos; b++) {
      bloques.push(palabras.slice(i, i + tamano));
      i += tamano;
    }

  const ecs = bloques.map((b) => correccion(b, v.ec));

  const salida: number[] = [];
  const masLargo = Math.max(...bloques.map((b) => b.length));
  for (let c = 0; c < masLargo; c++)
    for (const b of bloques) if (c < b.length) salida.push(b[c]);
  for (let c = 0; c < v.ec; c++) for (const e of ecs) salida.push(e[c]);

  return salida;
}

// -------------------------------------------------------- la matriz -------

/** −1 = libre, 0 = claro, 1 = oscuro. Las reservadas van marcadas aparte. */
export type Lienzo = { m: Int8Array; reservado: Uint8Array; lado: number };

const en = (l: Lienzo, f: number, c: number) => f * l.lado + c;

function poner(l: Lienzo, f: number, c: number, valor: number, reservar = true) {
  l.m[en(l, f, c)] = valor;
  if (reservar) l.reservado[en(l, f, c)] = 1;
}

/** Los tres cuadrados de las esquinas, con su separador blanco. */
function patronBusqueda(l: Lienzo, f0: number, c0: number) {
  for (let f = -1; f <= 7; f++)
    for (let c = -1; c <= 7; c++) {
      const ff = f0 + f;
      const cc = c0 + c;
      if (ff < 0 || cc < 0 || ff >= l.lado || cc >= l.lado) continue;
      // El anillo de fuera (−1 y 7) es el separador, y va siempre claro. Sin
      // esta comprobación, `borde` lo pinta oscuro y el patrón deja de tener
      // el marco blanco por el que el lector lo reconoce.
      const dentro = f >= 0 && f <= 6 && c >= 0 && c <= 6;
      const borde = f === 0 || f === 6 || c === 0 || c === 6;
      const centro = f >= 2 && f <= 4 && c >= 2 && c <= 4;
      poner(l, ff, cc, dentro && (borde || centro) ? 1 : 0);
    }
}

function patronAlineacion(l: Lienzo, f0: number, c0: number) {
  for (let f = -2; f <= 2; f++)
    for (let c = -2; c <= 2; c++) {
      const borde = Math.abs(f) === 2 || Math.abs(c) === 2;
      poner(l, f0 + f, c0 + c, borde || (f === 0 && c === 0) ? 1 : 0);
    }
}

/** Los 15 bits de formato: nivel de corrección, máscara y su BCH. */
export function bitsFormato(mascara: number): number[] {
  // 00 es el nivel M. Los cinco bits de datos son nivel + máscara.
  const datos = (0b00 << 3) | mascara;
  let bch = datos << 10;
  for (let i = 4; i >= 0; i--) if ((bch >> (i + 10)) & 1) bch ^= 0b10100110111 << i;
  const valor = ((datos << 10) | bch) ^ 0b101010000010010;
  return Array.from({ length: 15 }, (_, i) => (valor >> (14 - i)) & 1);
}

/** Los 18 bits de versión, que solo llevan los QR de la 7 en adelante. */
export function bitsVersion(version: number): number[] {
  let bch = version << 12;
  for (let i = 5; i >= 0; i--) if ((bch >> (i + 12)) & 1) bch ^= 0b1111100100101 << i;
  const valor = (version << 12) | bch;
  return Array.from({ length: 18 }, (_, i) => (valor >> (17 - i)) & 1);
}

const MASCARAS: ((f: number, c: number) => boolean)[] = [
  (f, c) => (f + c) % 2 === 0,
  (f) => f % 2 === 0,
  (_f, c) => c % 3 === 0,
  (f, c) => (f + c) % 3 === 0,
  (f, c) => (Math.floor(f / 2) + Math.floor(c / 3)) % 2 === 0,
  (f, c) => ((f * c) % 2) + ((f * c) % 3) === 0,
  (f, c) => (((f * c) % 2) + ((f * c) % 3)) % 2 === 0,
  (f, c) => (((f + c) % 2) + ((f * c) % 3)) % 2 === 0,
];

/** El lienzo con todo lo fijo puesto y lo variable reservado. */
function lienzoBase(version: number): Lienzo {
  const lado = 17 + version * 4;
  const l: Lienzo = {
    m: new Int8Array(lado * lado).fill(-1),
    reservado: new Uint8Array(lado * lado),
    lado,
  };

  patronBusqueda(l, 0, 0);
  patronBusqueda(l, 0, lado - 7);
  patronBusqueda(l, lado - 7, 0);

  // Las líneas de tiempo: la referencia con la que el lector mide el módulo.
  for (let i = 8; i < lado - 8; i++) {
    poner(l, 6, i, i % 2 === 0 ? 1 : 0);
    poner(l, i, 6, i % 2 === 0 ? 1 : 0);
  }

  const centros = VERSIONES[version - 1].alineacion;
  for (const f of centros)
    for (const c of centros) {
      // Los tres que caerían encima de un patrón de búsqueda no se ponen.
      const enBusqueda =
        (f <= 8 && c <= 8) || (f <= 8 && c >= lado - 9) || (f >= lado - 9 && c <= 8);
      if (!enBusqueda) patronAlineacion(l, f, c);
    }

  // El módulo oscuro de siempre, y el sitio de los bits de formato.
  poner(l, lado - 8, 8, 1);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) poner(l, 8, i, 0);
    if (i !== 6) poner(l, i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    poner(l, 8, lado - 1 - i, 0);
    if (lado - 1 - i !== lado - 8) poner(l, lado - 1 - i, 8, 0);
  }

  if (version >= 7) {
    const bits = bitsVersion(version);
    // Se escriben del bit menos significativo en adelante, y de ahí el 17−i.
    for (let i = 0; i < 18; i++) {
      const bit = bits[17 - i];
      const f = Math.floor(i / 3);
      const c = lado - 11 + (i % 3);
      poner(l, f, c, bit);
      poner(l, c, f, bit);
    }
  }

  return l;
}

/** Coloca las palabras en zigzag de dos columnas, de abajo a la derecha. */
function colocarDatos(l: Lienzo, palabras: number[]) {
  const bits: number[] = [];
  for (const p of palabras) for (let i = 7; i >= 0; i--) bits.push((p >> i) & 1);

  let i = 0;
  let subiendo = true;
  for (let cd = l.lado - 1; cd > 0; cd -= 2) {
    // La columna 6 es la línea de tiempo vertical: no lleva datos y se salta
    // entera, así que el par de columnas se corre uno a la izquierda.
    if (cd === 6) cd = 5;
    for (let paso = 0; paso < l.lado; paso++) {
      const f = subiendo ? l.lado - 1 - paso : paso;
      for (const c of [cd, cd - 1])
        if (!l.reservado[en(l, f, c)]) {
          l.m[en(l, f, c)] = i < bits.length ? bits[i] : 0;
          i++;
        }
    }
    subiendo = !subiendo;
  }
}

/** Lo mal que se lee una matriz. Cuanto menos, mejor: la norma manda elegir. */
export function penalizacion(m: Int8Array, lado: number): number {
  const v = (f: number, c: number) => m[f * lado + c];
  let total = 0;

  // 1 — rachas del mismo color de cinco o más.
  for (let i = 0; i < lado; i++)
    for (const porFilas of [true, false]) {
      let color = -1;
      let racha = 0;
      for (let j = 0; j < lado; j++) {
        const x = porFilas ? v(i, j) : v(j, i);
        if (x === color) racha++;
        else {
          if (racha >= 5) total += racha - 2;
          color = x;
          racha = 1;
        }
      }
      if (racha >= 5) total += racha - 2;
    }

  // 2 — cuadrados de 2×2 de un solo color.
  for (let f = 0; f < lado - 1; f++)
    for (let c = 0; c < lado - 1; c++) {
      const x = v(f, c);
      if (x === v(f, c + 1) && x === v(f + 1, c) && x === v(f + 1, c + 1)) total += 3;
    }

  // 3 — el dibujo que se confunde con un patrón de búsqueda.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < lado; i++)
    for (let j = 0; j <= lado - 11; j++)
      for (const porFilas of [true, false]) {
        let esA = true;
        let esB = true;
        for (let k = 0; k < 11; k++) {
          const x = porFilas ? v(i, j + k) : v(j + k, i);
          if (x !== A[k]) esA = false;
          if (x !== B[k]) esB = false;
        }
        if (esA) total += 40;
        if (esB) total += 40;
      }

  /*
   * 4 — cuánto se aleja del 50% de módulos oscuros.
   *
   * Tal como lo dice la norma: se cogen los múltiplos de cinco de arriba y de
   * abajo del porcentaje, se mira lo que dista cada uno del 50 y se toma el
   * menor. Es más rodeo que un `floor` sobre la diferencia, pero no es lo
   * mismo: con un 52% exacto la norma da 0 y el atajo da 10.
   *
   * Esto es lo único en lo que este fichero se aparta de la librería `qrcode`
   * de npm, que usa `|ceil(p/5) − 10|`. Se comprobó: forzando aquí su fórmula,
   * las 639 matrices de la batería salen idénticas a las suyas. Con la de la
   * norma, 12 de esas 639 eligen otra máscara —igual de válida, porque la
   * máscara no cambia lo que dice el código— y las 639 se siguen leyendo.
   */
  let oscuros = 0;
  for (let i = 0; i < m.length; i++) if (m[i] === 1) oscuros++;
  const porciento = (oscuros * 100) / (lado * lado);
  const abajo = Math.floor(porciento / 5) * 5;
  total += (Math.min(Math.abs(abajo - 50), Math.abs(abajo + 5 - 50)) / 5) * 10;

  return total;
}

/**
 * El código QR de un texto, como matriz de booleanos (true = módulo oscuro).
 *
 * No incluye la zona muda: el borde blanco lo pone quien lo dibuja, que es
 * quien sabe de cuánto dispone.
 */
/**
 * La matriz de una versión con una máscara concreta.
 *
 * Se saca aparte de `codigoQR` para poder probar las ocho máscaras por
 * separado: si una falla, con solo la mejor no habría manera de saber cuál.
 */
export function matrizConMascara(
  palabras: number[],
  version: number,
  mascara: number,
): Lienzo {
  const l = lienzoBase(version);
  colocarDatos(l, palabras);

  const f = MASCARAS[mascara];
  for (let fila = 0; fila < l.lado; fila++)
    for (let col = 0; col < l.lado; col++)
      if (!l.reservado[en(l, fila, col)] && f(fila, col)) l.m[en(l, fila, col)] ^= 1;

  const formato = bitsFormato(mascara);
  for (let i = 0; i < 15; i++) {
    // El más significativo primero: el primer bit de la cadena de formato va
    // en (8,0), no el último.
    const bit = formato[i];
    // Copia de arriba a la izquierda, saltando la línea de tiempo.
    if (i < 6) l.m[en(l, 8, i)] = bit;
    else if (i < 8) l.m[en(l, 8, i + 1)] = bit;
    else if (i === 8) l.m[en(l, 7, 8)] = bit;
    else l.m[en(l, 14 - i, 8)] = bit;
    // Y la copia repartida entre las otras dos esquinas: **siete** módulos
    // hacia arriba desde abajo y ocho hacia la derecha. No ocho y siete: el
    // octavo de la columna es el módulo oscuro fijo, que no es un bit de
    // formato y no se puede pisar.
    if (i < 7) l.m[en(l, l.lado - 1 - i, 8)] = bit;
    else l.m[en(l, 8, l.lado - 15 + i)] = bit;
  }

  return l;
}

/** La versión que le toca a un texto. */
export const versionPara = (texto: string) => elegirVersion(aBytes(texto).length);

/**
 * El código QR de un texto, como matriz de booleanos (true = módulo oscuro).
 *
 * Se prueban las ocho máscaras y gana la que menos penalización saca, que es
 * lo que manda la norma: la máscara no cambia lo que dice el código, solo
 * reparte los módulos para que no salgan manchas grandes ni dibujos que se
 * confundan con un patrón de búsqueda.
 *
 * No incluye la zona muda: el borde blanco lo pone quien lo dibuja, que es
 * quien sabe de cuánto dispone.
 */
export function codigoQR(texto: string): boolean[][] {
  const version = versionPara(texto);
  const palabras = palabrasFinales(texto, version);

  let mejor: Lienzo | null = null;
  let mejorPuntos = Infinity;

  for (let mascara = 0; mascara < 8; mascara++) {
    const l = matrizConMascara(palabras, version, mascara);
    const puntos = penalizacion(l.m, l.lado);
    if (puntos < mejorPuntos) {
      mejor = l;
      mejorPuntos = puntos;
    }
  }

  const l = mejor!;
  return Array.from({ length: l.lado }, (_, f) =>
    Array.from({ length: l.lado }, (_, c) => l.m[en(l, f, c)] === 1),
  );
}
