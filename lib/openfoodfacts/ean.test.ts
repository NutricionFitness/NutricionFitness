import { describe, expect, it } from "vitest";

import { digitoControl, normalizarEan } from "./ean";

/**
 * Los códigos de esta batería son reales y públicos, no inventados con la
 * misma función que se está probando: si el cálculo del dígito de control
 * estuviera mal, una batería autoconsistente pasaría igual.
 */
const NUTELLA = "3017620422003"; // EAN-13
const COCACOLA = "5449000000996"; // EAN-13
const EAN8 = "96385074"; // el ejemplo canónico de EAN-8
const UPCA = "036000291452"; // UPC-A de 12 dígitos

describe("dígito de control", () => {
  it("cuadra con códigos reales de 13 dígitos", () => {
    expect(digitoControl(NUTELLA.slice(0, -1))).toBe(3);
    expect(digitoControl(COCACOLA.slice(0, -1))).toBe(6);
  });

  it("cuadra igual con 8 y con 12 dígitos", () => {
    // La alternancia se cuenta desde la derecha justamente para que la
    // longitud no cambie la regla.
    expect(digitoControl(EAN8.slice(0, -1))).toBe(4);
    expect(digitoControl(UPCA.slice(0, -1))).toBe(2);
  });
});

describe("normalizar", () => {
  it("acepta un EAN-13 correcto", () => {
    expect(normalizarEan(NUTELLA)?.codigo).toBe(NUTELLA);
  });

  it("rechaza un dígito mal leído", () => {
    // Este es el caso que justifica todo el fichero: la cámara lee un 4 donde
    // hay un 3 y, sin esta comprobación, se añade otro producto a la dieta.
    expect(normalizarEan("3017620422004")).toBeNull();
    expect(normalizarEan("3017620432003")).toBeNull();
    // El mismo control funciona en las otras longitudes.
    expect(normalizarEan("301762042200")).toBeNull(); // 12, control malo
    expect(normalizarEan("30176204220034")).toBeNull(); // 14, control malo
  });

  it("tolera lo que teclea una persona", () => {
    expect(normalizarEan(" 3017 6204 22003 ")?.codigo).toBe(NUTELLA);
    expect(normalizarEan("3-017620-422003")?.codigo).toBe(NUTELLA);
  });

  it("rechaza longitudes que no son de ningún GTIN", () => {
    // Se descartan por la longitud, antes de mirar ningún dígito de control:
    // 9, 10 y 11 dígitos no son ningún formato.
    expect(normalizarEan("123456789")).toBeNull();
    expect(normalizarEan("12345")).toBeNull();
    expect(normalizarEan("")).toBeNull();
    expect(normalizarEan("no es un código")).toBeNull();
  });

  it("rechaza el código de relleno", () => {
    // Un escáner que ha leído una sombra devuelve ceros, y los ceros pasan el
    // dígito de control tan ricamente.
    expect(normalizarEan("0000000000000")).toBeNull();
    expect(normalizarEan("00000000")).toBeNull();
  });

  it("un EAN-8 se pregunta también relleno hasta 13", () => {
    const r = normalizarEan(EAN8)!;
    expect(r.codigo).toBe(EAN8);
    expect(r.consultas).toEqual([EAN8, "0000096385074"]);
  });

  it("un UPC-A se pregunta también como EAN-13", () => {
    const r = normalizarEan(UPCA)!;
    expect(r.codigo).toBe(UPCA);
    expect(r.consultas).toEqual([UPCA, "0036000291452"]);
    // Rellenar con ceros por la izquierda no cambia el dígito de control,
    // porque un cero no suma. Así que el relleno sigue siendo un código válido.
    expect(normalizarEan("0036000291452")?.codigo).toBe("0036000291452");
  });

  it("de un GTIN-14 se saca el producto que lleva dentro", () => {
    // Indicador 0: el dígito de control no cambia, así que el GTIN-14 es
    // literalmente un cero delante del EAN-13.
    const caja0 = "0" + NUTELLA;
    expect(normalizarEan(caja0)?.consultas).toContain(NUTELLA);

    // Indicador 3 —una caja—: aquí el dígito de control SÍ cambia. Heredarlo
    // daría un código que no existe; hay que recalcularlo.
    const cuerpo = NUTELLA.slice(0, 12);
    const caja3 = "3" + cuerpo + digitoControl("3" + cuerpo);
    const r = normalizarEan(caja3)!;
    expect(r.codigo).toBe(caja3);
    expect(r.consultas).toContain(NUTELLA);
  });

  it("no repite consultas", () => {
    const r = normalizarEan(NUTELLA)!;
    expect(r.consultas).toEqual([NUTELLA]);
    expect(new Set(r.consultas).size).toBe(r.consultas.length);
  });
});
