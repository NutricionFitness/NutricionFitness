import { describe, expect, it } from "vitest";

import { opcionDeComida } from "./opciones";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * En qué opción entra un ingrediente, contra un Supabase de mentira.
 *
 * Existe por un fallo de producción: una dieta recién creada **no aceptaba su
 * primer ingrediente**. La consulta anidaba `opciones` dentro de `comidas` y
 * desde la 0012 hay dos claves ajenas entre esas tablas, así que PostgREST no
 * elige; el error no se miraba, la fila entraba con `opcion_id` nulo y reventaba
 * el disparador con «la opción <NULL> no existe».
 *
 * Lo que se comprueba aquí es lo que no se pudo comprobar en la fase 21: qué
 * hace este código **cuando la consulta falla**. Para eso no hace falta
 * PostgREST, hace falta un cliente que devuelva un error.
 */

type Respuesta = { data: unknown; error: { message: string } | null };

/** Apunta qué tablas se han pedido, para poder fijar que no se anida nada. */
function clienteFalso(respuestas: { comidas?: Respuesta; opciones?: Respuesta }) {
  const selects: string[] = [];

  const cliente = {
    from(tabla: string) {
      return {
        select(sel: string) {
          selects.push(`${tabla}: ${sel}`);
          const r = respuestas[tabla as "comidas" | "opciones"] ?? { data: null, error: null };
          const encadenable = {
            eq: () => encadenable,
            order: () => encadenable,
            limit: async () => r,
            maybeSingle: async () => r,
            single: async () => r,
          };
          return encadenable;
        },
      };
    },
  };

  return { cliente: cliente as unknown as SupabaseClient, selects };
}

describe("en qué opción entra el ingrediente", () => {
  it("en la activa de la comida, cuando la hay", async () => {
    const { cliente } = clienteFalso({
      comidas: { data: { opcion_activa_id: "o7" }, error: null },
    });
    expect(await opcionDeComida(cliente, "m1")).toEqual({ id: "o7", error: null });
  });

  it("y no anida `opciones` dentro de `comidas`: son dos consultas planas", async () => {
    const { cliente, selects } = clienteFalso({
      comidas: { data: { opcion_activa_id: null }, error: null },
      opciones: { data: [{ id: "o1" }], error: null },
    });
    await opcionDeComida(cliente, "m1");

    // Es LA regla de la fase 21: con dos claves ajenas PostgREST no elige.
    expect(selects.some((s) => s.startsWith("comidas") && s.includes("opciones ("))).toBe(false);
    expect(selects).toEqual(["comidas: opcion_activa_id", "opciones: id, orden, creado_en"]);
  });

  it("en la primera cuando no hay activa marcada", async () => {
    const { cliente } = clienteFalso({
      comidas: { data: { opcion_activa_id: null }, error: null },
      opciones: { data: [{ id: "o1" }], error: null },
    });
    expect(await opcionDeComida(cliente, "m1")).toEqual({ id: "o1", error: null });
  });

  // --- y lo que de verdad se rompió -----------------------------------------
  it("si la consulta de la comida falla, lo DICE en vez de seguir con nulo", async () => {
    const { cliente } = clienteFalso({
      comidas: { data: null, error: { message: "Could not embed because more than one relationship was found" } },
    });
    const r = await opcionDeComida(cliente, "m1");
    expect(r.id).toBeNull();
    expect(r.error).toContain("more than one relationship");
  });

  it("si la de opciones falla, también", async () => {
    const { cliente } = clienteFalso({
      comidas: { data: { opcion_activa_id: null }, error: null },
      opciones: { data: null, error: { message: "boom" } },
    });
    const r = await opcionDeComida(cliente, "m1");
    expect(r.id).toBeNull();
    expect(r.error).toContain("boom");
  });

  it("una comida sin ninguna opción se explica, no revienta el disparador", async () => {
    const { cliente } = clienteFalso({
      comidas: { data: { opcion_activa_id: null }, error: null },
      opciones: { data: [], error: null },
    });
    const r = await opcionDeComida(cliente, "m1");
    expect(r.id).toBeNull();
    expect(r.error).toContain("0012_opciones_comida.sql");
  });

  it("y una comida que ya no existe lo dice con esas palabras", async () => {
    const { cliente } = clienteFalso({ comidas: { data: null, error: null } });
    const r = await opcionDeComida(cliente, "m1");
    expect(r.id).toBeNull();
    expect(r.error).toBe("Esa comida ya no existe.");
  });
});
