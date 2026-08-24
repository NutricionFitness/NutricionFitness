import { describe, expect, it, vi } from "vitest";

import { colaDeCodigos, type EstadoCola } from "./cola-codigos";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un `procesar` que tarda lo que se le diga y apunta lo que le llega. */
function espia(
  opciones: { tarda?: number; falla?: (codigo: string) => boolean } = {},
) {
  const { tarda = 5, falla = () => false } = opciones;
  const vistos: string[] = [];
  const procesar = async (codigo: string) => {
    await esperar(tarda);
    if (falla(codigo)) throw new Error("sin red");
    vistos.push(codigo);
  };
  return { vistos, procesar };
}

const A = "3017620422003";
const B = "5449000000996";
const C = "96385074";

describe("la cola de códigos", () => {
  it("procesa un código", async () => {
    const { vistos, procesar } = espia();
    const cola = colaDeCodigos(procesar);
    cola.encolar(A);
    await esperar(40);
    expect(vistos).toEqual([A]);
  });

  it("procesa varios en el orden en que llegaron", async () => {
    const { vistos, procesar } = espia();
    const cola = colaDeCodigos(procesar);
    cola.encolar(A);
    cola.encolar(B);
    cola.encolar(C);
    await esperar(80);
    expect(vistos).toEqual([A, B, C]);
  });

  it("nunca procesa dos a la vez", async () => {
    let dentro = 0;
    let maximo = 0;
    const cola = colaDeCodigos(async () => {
      dentro++;
      maximo = Math.max(maximo, dentro);
      await esperar(10);
      dentro--;
    });
    cola.encolar(A);
    cola.encolar(B);
    cola.encolar(C);
    await esperar(90);
    expect(maximo).toBe(1);
  });

  it("los que llegan mientras trabaja no se pierden", async () => {
    // Éste es el caso del móvil: se escanea otro producto antes de que el
    // ordenador haya terminado con el anterior.
    const { vistos, procesar } = espia({ tarda: 30 });
    const cola = colaDeCodigos(procesar);
    cola.encolar(A);
    await esperar(10);
    cola.encolar(B);
    await esperar(100);
    expect(vistos).toEqual([A, B]);
  });

  it("no repite un código que ya está esperando", async () => {
    const { vistos, procesar } = espia({ tarda: 30 });
    const cola = colaDeCodigos(procesar);
    cola.encolar(A);
    cola.encolar(A);
    await esperar(100);
    expect(vistos).toEqual([A]);
  });

  it("uno que falla no atasca a los de detrás", async () => {
    const { vistos, procesar } = espia({ falla: (c) => c === A });
    const cola = colaDeCodigos(procesar);
    cola.encolar(A);
    cola.encolar(B);
    await esperar(60);
    expect(vistos).toEqual([B]);
  });

  it("al terminar deja de decir que está mirando algo", async () => {
    // El síntoma que se vio en producción: el botón se quedaba en «Buscando…»
    // para siempre y el código no llegaba a ninguna parte.
    const estados: EstadoCola[] = [];
    const { procesar } = espia();
    const cola = colaDeCodigos(procesar, (e) => estados.push({ ...e }));
    cola.encolar(A);
    await esperar(40);

    const ultimo = estados[estados.length - 1];
    expect(ultimo).toEqual({ mirando: null, pendientes: 0 });
    // Y por el camino ha dicho en cuál estaba.
    expect(estados.some((e) => e.mirando === A)).toBe(true);
  });

  it("cuenta lo que queda por mirar", async () => {
    const estados: EstadoCola[] = [];
    const { procesar } = espia({ tarda: 20 });
    const cola = colaDeCodigos(procesar, (e) => estados.push({ ...e }));
    cola.encolar(A);
    cola.encolar(B);
    cola.encolar(C);
    expect(estados[estados.length - 1].pendientes).toBe(3);
    await esperar(150);
    expect(estados[estados.length - 1].pendientes).toBe(0);
  });

  it("parar deja de procesar y de avisar", async () => {
    const { vistos, procesar } = espia({ tarda: 20 });
    const alCambiar = vi.fn();
    const cola = colaDeCodigos(procesar, alCambiar);
    cola.encolar(A);
    cola.encolar(B);
    await esperar(5);
    cola.parar();
    const avisosAlParar = alCambiar.mock.calls.length;

    await esperar(120);
    // Se estaba procesando A cuando se paró: puede terminar, pero B no entra.
    expect(vistos).not.toContain(B);
    expect(alCambiar.mock.calls.length).toBe(avisosAlParar);
  });

  it("después de parar, encolar no hace nada", async () => {
    const { vistos, procesar } = espia();
    const cola = colaDeCodigos(procesar);
    cola.parar();
    cola.encolar(A);
    await esperar(40);
    expect(vistos).toEqual([]);
  });

  it("se puede volver a usar después de vaciarse", async () => {
    // En una dieta se escanea, se confirma, y se vuelve a escanear. La cola
    // tiene que arrancar otra vez sin haberla tocado.
    const { vistos, procesar } = espia();
    const cola = colaDeCodigos(procesar);
    cola.encolar(A);
    await esperar(40);
    cola.encolar(B);
    await esperar(40);
    expect(vistos).toEqual([A, B]);
  });
});
