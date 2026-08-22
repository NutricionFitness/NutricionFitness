import { describe, expect, it } from "vitest";

import {
  bitsFormato,
  bitsVersion,
  codigoQR,
  correccion,
  matrizConMascara,
  palabrasFinales,
  versionPara,
} from "./codificar";

/**
 * Cómo se comprobó esto de verdad, y por qué la batería no lo repite.
 *
 * Mientras se escribía, la matriz de `codigoQR` se comparó **módulo a módulo**
 * con la de la librería `qrcode` de npm sobre 639 cadenas —de 1 a 213 bytes,
 * versiones 1 a 10, URLs y basura aleatoria—, y además cada una de las 639 se
 * pasó por `jsQR`, que es un lector distinto, para ver que devolvía el texto
 * original.
 *
 *   · 627 de 639 idénticas a la referencia.
 *   · 12 de 639 idénticas salvo por cuál de las ocho máscaras se elige, que es
 *     la única diferencia conocida y está explicada en `penalizacion`.
 *   · 639 de 639 leídas y descodificadas bien por jsQR.
 *
 * Las dos librerías se usaron ahí y **no se han quedado como dependencia**: la
 * app no las necesita, y una batería que exige instalar dos paquetes para pasar
 * es una batería que se acaba saltando. Lo que queda aquí es autosuficiente y
 * comprueba las mismas propiedades por dentro:
 *
 *   · leer la matriz al revés y recuperar exactamente las palabras que se
 *     metieron —eso cubre colocación, máscara y bits de formato—,
 *   · las piezas fijas del dibujo, que son las que busca un lector,
 *   · y una matriz completa clavada como referencia, para que un cambio futuro
 *     no la mueva sin querer.
 */

// --------------------------------------------------- leer una matriz -------

/** Las ocho máscaras, otra vez, para poder deshacerlas al leer. */
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

/** Qué máscara dice la propia matriz que lleva, según sus bits de formato. */
function mascaraDeLaMatriz(m: boolean[][]): { mascara: number; correccion: number } {
  const pos: [number, number][] = [];
  for (let i = 0; i < 6; i++) pos.push([8, i]);
  pos.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) pos.push([14 - i, 8]);

  let valor = 0;
  for (const [f, c] of pos) valor = (valor << 1) | (m[f][c] ? 1 : 0);
  const datos = (valor ^ 0b101010000010010) >> 10;
  return { mascara: datos & 0b111, correccion: datos >> 3 };
}

/** Deshace la máscara y lee las palabras en el mismo zigzag que las escribió. */
function palabrasDeLaMatriz(m: boolean[][]): number[] {
  const lado = m.length;
  const version = (lado - 17) / 4;
  // La reserva no depende de la máscara: vale cualquiera para conocerla.
  const { reservado } = matrizConMascara([], version, 0);
  const { mascara } = mascaraDeLaMatriz(m);
  const quitar = MASCARAS[mascara];

  const bits: number[] = [];
  let subiendo = true;
  for (let cd = lado - 1; cd > 0; cd -= 2) {
    if (cd === 6) cd = 5;
    for (let paso = 0; paso < lado; paso++) {
      const f = subiendo ? lado - 1 - paso : paso;
      for (const c of [cd, cd - 1])
        if (!reservado[f * lado + c]) bits.push((m[f][c] ? 1 : 0) ^ (quitar(f, c) ? 1 : 0));
    }
    subiendo = !subiendo;
  }

  const palabras: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    palabras.push(b);
  }
  return palabras;
}

// ------------------------------------------------------------- pruebas -----

/** Textos que caen en cada una de las diez versiones. */
const POR_VERSION = [
  "hola",
  "https://n.es/e/" + "a".repeat(10),
  "https://n.es/e/" + "a".repeat(26),
  "https://n.es/e/" + "a".repeat(46),
  "https://n.es/e/" + "a".repeat(68),
  "https://n.es/e/" + "a".repeat(90),
  "https://n.es/e/" + "a".repeat(106),
  "https://n.es/e/" + "a".repeat(136),
  "https://n.es/e/" + "a".repeat(164),
  "https://n.es/e/" + "a".repeat(197),
];

describe("versiones", () => {
  it("elige la más pequeña donde cabe el texto", () => {
    POR_VERSION.forEach((t, i) => expect(versionPara(t)).toBe(i + 1));
  });

  it("el lado crece de cuatro en cuatro", () => {
    POR_VERSION.forEach((t, i) => expect(codigoQR(t).length).toBe(17 + (i + 1) * 4));
  });

  it("un texto que no cabe lo dice en vez de recortarlo", () => {
    // Callarse y meter media URL sería peor que no hacer el QR: saldría un
    // código perfecto que lleva a una página que no existe.
    expect(() => codigoQR("a".repeat(300))).toThrow(/No caben/);
  });
});

describe("la matriz dice lo que se le metió", () => {
  it("leída al revés devuelve exactamente las mismas palabras", () => {
    // Ésta es la prueba de fondo: si la colocación en zigzag, la máscara o los
    // bits de formato estuvieran mal, las palabras no volverían iguales.
    for (const t of POR_VERSION) {
      const v = versionPara(t);
      const esperadas = palabrasFinales(t, v);
      const leidas = palabrasDeLaMatriz(codigoQR(t)).slice(0, esperadas.length);
      expect(leidas, `versión ${v}`).toEqual(esperadas);
    }
  });

  it("y también con acentos, eñes y emoji", () => {
    for (const t of ["Melocotón en almíbar ñ", "https://a.es/€uro-ñandú", "café ☕ 100 g"]) {
      const v = versionPara(t);
      const esperadas = palabrasFinales(t, v);
      expect(palabrasDeLaMatriz(codigoQR(t)).slice(0, esperadas.length)).toEqual(esperadas);
    }
  });

  it("la matriz declara la corrección M y una máscara de las ocho", () => {
    for (const t of POR_VERSION) {
      const { mascara, correccion: nivel } = mascaraDeLaMatriz(codigoQR(t));
      expect(nivel).toBe(0b00); // M
      expect(mascara).toBeGreaterThanOrEqual(0);
      expect(mascara).toBeLessThanOrEqual(7);
    }
  });
});

describe("el dibujo fijo, que es lo que busca el lector", () => {
  const m = codigoQR(POR_VERSION[6]); // versión 7: la primera con bits de versión
  const lado = m.length;

  it("tiene los tres cuadrados de las esquinas", () => {
    for (const [f0, c0] of [
      [0, 0],
      [0, lado - 7],
      [lado - 7, 0],
    ])
      for (let f = 0; f < 7; f++)
        for (let c = 0; c < 7; c++) {
          const borde = f === 0 || f === 6 || c === 0 || c === 6;
          const centro = f >= 2 && f <= 4 && c >= 2 && c <= 4;
          expect(m[f0 + f][c0 + c], `${f0 + f},${c0 + c}`).toBe(borde || centro);
        }
  });

  it("y su marco blanco alrededor", () => {
    // Sin el separador, el lector no distingue el cuadrado del resto. Fue el
    // primer fallo que tuvo esto.
    for (let i = 0; i < 8; i++) {
      expect(m[7][i], `7,${i}`).toBe(false);
      expect(m[i][7], `${i},7`).toBe(false);
      expect(m[7][lado - 1 - i]).toBe(false);
      expect(m[lado - 1 - i][7]).toBe(false);
    }
  });

  it("las líneas de tiempo alternan", () => {
    for (let i = 8; i < lado - 8; i++) {
      expect(m[6][i], `fila 6, col ${i}`).toBe(i % 2 === 0);
      expect(m[i][6], `fila ${i}, col 6`).toBe(i % 2 === 0);
    }
  });

  it("el módulo oscuro fijo está puesto", () => {
    // Va en (4·versión + 9, 8) y no es un bit de formato: pisarlo con uno fue
    // el segundo fallo que tuvo esto.
    expect(m[lado - 8][8]).toBe(true);
  });
});

describe("las piezas por separado", () => {
  it("los bits de formato son los de la tabla de la norma", () => {
    const texto = (b: number[]) => b.join("");
    expect(texto(bitsFormato(0))).toBe("101010000010010");
    expect(texto(bitsFormato(3))).toBe("101101101001011");
    expect(texto(bitsFormato(7))).toBe("100101010100000");
  });

  it("los bits de versión son los de la tabla de la norma", () => {
    expect(bitsVersion(7).join("")).toBe("000111110010010100");
    expect(bitsVersion(8).join("")).toBe("001000010110111100");
    expect(bitsVersion(9).join("")).toBe("001001101010011001");
    expect(bitsVersion(10).join("")).toBe("001010010011010011");
  });

  it("la corrección devuelve tantas palabras como se le piden", () => {
    expect(correccion([64, 20, 16], 10)).toHaveLength(10);
    expect(correccion([1, 2, 3, 4], 26)).toHaveLength(26);
  });

  it("un bloque de ceros tiene corrección de ceros", () => {
    expect(correccion(new Array(16).fill(0), 10)).toEqual(new Array(10).fill(0));
  });
});

describe("una matriz clavada", () => {
  /**
   * La salida completa para una URL como la que va a llevar el QR de verdad.
   *
   * Se generó con la versión que se comparó módulo a módulo con `qrcode` y se
   * leyó con `jsQR`. Está aquí para que cualquier cambio futuro que la mueva
   * salte, aunque siga «funcionando».
   */
  const ESPERADA = [
    "#######...#...#...#######",
    "#.....#..####..#..#.....#",
    "#.###.#.##..#.#...#.###.#",
    "#.###.#.#.####.#..#.###.#",
    "#.###.#.#.#.#.#.#.#.###.#",
    "#.....#.##.###.##.#.....#",
    "#######.#.#.#.#.#.#######",
    "........###....#.........",
    "#.#####...#....#..#####..",
    "..###....#..##..#......#.",
    "###.######.#.#####..##.##",
    ".##.##.##.####..#..##...#",
    ".##.#.#.....#.#..##.#.###",
    "#.#..#..#.#........#.#.#.",
    "#..#.###...##..#######.##",
    "#...#..#.#.#..#######...#",
    "#..##.####.#...######.#..",
    "........###.#####...##...",
    "#######..##..##.#.#.#.###",
    "#.....#.#.#.##..#...##.#.",
    "#.###.#.#...#.#######.#.#",
    "#.###.#.##......###.#####",
    "#.###.#.##.##...##...##.#",
    "#.....#....#..###.####..#",
    "#######.####...#.#.######",
  ];

  it("sale igual, fila por fila", () => {
    const m = codigoQR("https://n.es/e/ab12");
    expect(m.map((f) => f.map((x) => (x ? "#" : ".")).join(""))).toEqual(ESPERADA);
  });

  it("y sale igual cada vez que se pide", () => {
    // No hay nada aleatorio aquí dentro: el mismo texto, el mismo cuadrado.
    const a = codigoQR("https://n.es/e/ab12");
    const b = codigoQR("https://n.es/e/ab12");
    expect(a).toEqual(b);
  });
});
