import { describe, expect, it } from "vitest";

import { aTramos, leerFotograma, leerLinea } from "./decodificar";

/**
 * El generador de esta batería está escrito a partir de los **códigos de bits**
 * del estándar, mientras que el lector trabaja con una tabla de **anchuras**.
 * Son dos formas distintas de escribir lo mismo, así que si una de las dos
 * estuviera mal, los tests no pasarían: no se están comprobando el uno al otro.
 */
const L = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
const complemento = (s: string) => [...s].map((c) => (c === "0" ? "1" : "0")).join("");
const R = L.map(complemento);
const G = R.map((s) => [...s].reverse().join(""));

const PARIDAD = [
  "000000", "001011", "001101", "001110", "010011",
  "011001", "011100", "010101", "010110", "011010",
];

/** Los 95 (o 67) módulos de un código, en unos y ceros. */
function aBits(codigo: string): string {
  const d = [...codigo].map(Number);

  if (codigo.length === 8)
    return (
      "101" +
      d.slice(0, 4).map((x) => L[x]).join("") +
      "01010" +
      d.slice(4).map((x) => R[x]).join("") +
      "101"
    );

  const paridad = PARIDAD[d[0]];
  return (
    "101" +
    d.slice(1, 7).map((x, i) => (paridad[i] === "1" ? G[x] : L[x])).join("") +
    "01010" +
    d.slice(7).map((x) => R[x]).join("") +
    "101"
  );
}

/** Una línea de grises: zona muda, código a `escala` píxeles por módulo, zona muda. */
function aLinea(codigo: string, escala = 3, muda = 30, negro = 20, blanco = 235): number[] {
  const bits = aBits(codigo);
  const px: number[] = new Array(muda).fill(blanco);
  for (const b of bits) for (let i = 0; i < escala; i++) px.push(b === "1" ? negro : blanco);
  return px.concat(new Array(muda).fill(blanco));
}

/** Desenfoque de caja: lo que deja una cámara de móvil sin llegar a enfocar. */
const desenfocar = (px: number[], radio = 1) =>
  px.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = -radio; k <= radio; k++)
      if (px[i + k] !== undefined) {
        s += px[i + k];
        n++;
      }
    return Math.round(s / n);
  });

const NUTELLA = "3017620422003";
const COCACOLA = "5449000000996";
const EAN8 = "96385074";

describe("tramos", () => {
  it("una línea sin contraste no da tramos", () => {
    // Un dedo tapando el objetivo, o la mesa.
    expect(aTramos(new Array(400).fill(128))).toEqual([]);
    expect(aTramos(new Array(400).fill(0).map((_, i) => 120 + (i % 3)))).toEqual([]);
  });

  it("una línea demasiado corta tampoco", () => {
    expect(aTramos([0, 255, 0])).toEqual([]);
  });
});

describe("leer una línea", () => {
  it("lee un EAN-13", () => {
    expect(leerLinea(aLinea(NUTELLA))).toBe(NUTELLA);
    expect(leerLinea(aLinea(COCACOLA))).toBe(COCACOLA);
  });

  it("lee un EAN-8", () => {
    expect(leerLinea(aLinea(EAN8))).toBe(EAN8);
  });

  it("lee a distintas distancias", () => {
    // La escala es cuántos píxeles mide un módulo: 2 es un código pequeño al
    // fondo del encuadre y 8 es el envase pegado al objetivo.
    for (const escala of [2, 3, 4, 6, 8, 11])
      expect(leerLinea(aLinea(NUTELLA, escala))).toBe(NUTELLA);
  });

  it("lee el código puesto del revés", () => {
    // Nadie gira el bote para escanear.
    expect(leerLinea([...aLinea(NUTELLA, 4)].reverse())).toBe(NUTELLA);
  });

  it("aguanta el desenfoque", () => {
    expect(leerLinea(desenfocar(aLinea(NUTELLA, 5), 1))).toBe(NUTELLA);
    expect(leerLinea(desenfocar(aLinea(NUTELLA, 8), 2))).toBe(NUTELLA);
  });

  it("aguanta poco contraste y luz irregular", () => {
    // Etiqueta gris bajo una lámpara que ilumina más por un lado.
    const base = aLinea(NUTELLA, 5, 30, 95, 160);
    const desigual = base.map((v, i) => Math.round(v * (1 - (i / base.length) * 0.25)));
    expect(leerLinea(desigual)).toBe(NUTELLA);
  });

  it("aguanta ruido", () => {
    // Ruido determinista: una batería que falla una vez de cada veinte no
    // sirve para nada.
    let semilla = 7;
    const aleatorio = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ruidosa = aLinea(NUTELLA, 6).map((v) => Math.max(0, Math.min(255, v + (aleatorio() - 0.5) * 40)));
    expect(leerLinea(ruidosa)).toBe(NUTELLA);
  });

  it("encuentra el código aunque no esté centrado", () => {
    const px = [...new Array(120).fill(240), ...aLinea(COCACOLA, 4), ...new Array(200).fill(210)];
    expect(leerLinea(px)).toBe(COCACOLA);
  });

  it("no inventa códigos donde no los hay", () => {
    expect(leerLinea(new Array(600).fill(255))).toBeNull();

    // Rayas regulares que no son un código: el patrón de una persiana, una
    // cortina, la trama de un mantel.
    const rayas = new Array(600).fill(0).map((_, i) => ((i >> 2) % 2 ? 30 : 230));
    expect(leerLinea(rayas)).toBeNull();

    // Ruido puro.
    let s = 3;
    const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    expect(leerLinea(new Array(800).fill(0).map(() => r() * 255))).toBeNull();
  });

  it("un módulo corrompido no cuela: lo caza el dígito de control", () => {
    // Se altera un tramo del código para simular una lectura mala. O no
    // decodifica, o decodifica otra cosa que no pasa el control: en ninguno de
    // los dos casos devuelve el código original alterado.
    const px = aLinea(NUTELLA, 6);
    for (let i = 60; i < 66; i++) px[i] = 235;
    expect(leerLinea(px)).not.toBe("3017620422004");
  });
});

describe("a lo bruto", () => {
  /** Números pseudoaleatorios repetibles: una batería que falla una vez de
   *  cada veinte no sirve para nada. */
  const dado = (semilla: number) => {
    let s = semilla;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  };
  const control = (c: string) => {
    let s = 0;
    for (let i = c.length - 1, p = 3; i >= 0; i--, p = p === 3 ? 1 : 3) s += Number(c[i]) * p;
    return (10 - (s % 10)) % 10;
  };

  it("lee bien los diez patrones de paridad, a cualquier distancia", () => {
    // El primer dígito de un EAN-13 no está dibujado: se deduce de si cada uno
    // de los seis de la izquierda usa el código L o el G. Es la parte del
    // formato donde es fácil equivocarse y donde un fallo saldría solo con
    // ciertos códigos, así que se prueban los diez casos.
    const r = dado(11);
    let bien = 0;
    let total = 0;
    for (let primero = 0; primero < 10; primero++)
      for (let n = 0; n < 40; n++) {
        let cuerpo = String(primero);
        for (let i = 0; i < 11; i++) cuerpo += Math.floor(r() * 10);
        const codigo = cuerpo + control(cuerpo);
        total++;
        if (leerLinea(aLinea(codigo, 2 + Math.floor(r() * 8))) === codigo) bien++;
      }
    expect(bien).toBe(total);
  });

  it("no da un solo falso positivo sobre ruido y texturas", () => {
    // Lo que más importa: leer mal un código mete un alimento equivocado en
    // una dieta, y eso no lo ve nadie hasta que es tarde.
    const r = dado(3);
    let falsos = 0;
    for (let n = 0; n < 900; n++) {
      const px =
        n % 3 === 0
          ? new Array(640).fill(0).map(() => r() * 255)
          : n % 3 === 1
            ? new Array(640).fill(0).map((_, i) => ((i >> (1 + Math.floor(r() * 4))) % 2 ? 30 : 230))
            : new Array(640).fill(0).map((_, i) => 128 + 80 * Math.sin(i / (2 + r() * 6)));
      if (leerLinea(px) !== null) falsos++;
    }
    expect(falsos).toBe(0);
  });
});

describe("leer un fotograma", () => {
  /** Un fotograma RGBA con el código repetido en todas sus filas. */
  function aFotograma(codigo: string, escala = 4, alto = 200, desplazar = 0) {
    const linea = aLinea(codigo, escala);
    const ancho = linea.length;
    const datos = new Uint8ClampedArray(ancho * alto * 4);
    for (let y = 0; y < alto; y++)
      for (let x = 0; x < ancho; x++) {
        const p = (y * ancho + x) * 4;
        // Fuera de la banda del código, papel liso.
        const dentro = y > alto * 0.2 + desplazar && y < alto * 0.8 + desplazar;
        const v = dentro ? linea[x] : 240;
        datos[p] = datos[p + 1] = datos[p + 2] = v;
        datos[p + 3] = 255;
      }
    return { datos, ancho, alto };
  }

  it("lee el código de un fotograma", () => {
    const { datos, ancho, alto } = aFotograma(NUTELLA);
    expect(leerFotograma(datos, ancho, alto)).toBe(NUTELLA);
  });

  it("lo encuentra aunque el código no esté justo en el centro", () => {
    const { datos, ancho, alto } = aFotograma(COCACOLA, 4, 240, 30);
    expect(leerFotograma(datos, ancho, alto)).toBe(COCACOLA);
  });

  it("con un fotograma en blanco no devuelve nada", () => {
    const ancho = 400;
    const alto = 200;
    const datos = new Uint8ClampedArray(ancho * alto * 4).fill(250);
    expect(leerFotograma(datos, ancho, alto)).toBeNull();
  });
});
