import { describe, expect, it } from "vitest";

import { cargarDieta } from "./dieta";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * El cargador de dietas, contra un Supabase de mentira.
 *
 * Existe por un 404. La consulta anidaba `opciones` dentro de `comidas`, y
 * desde la migración 0012 hay **dos** claves ajenas entre esas dos tablas
 * —`opciones.comida_id` y `comidas.opcion_activa_id`—, así que PostgREST no
 * sabe cuál usar y devuelve un error. La página lo traducía a `notFound()` y
 * salía un 404 pelado al abrir cualquier dieta.
 *
 * Lo que se comprueba aquí es lo que no se pudo comprobar entonces: qué hace
 * este código cuando la consulta falla. No hace falta PostgREST para eso —hace
 * falta un cliente que devuelva un error— y por eso se puede probar.
 */

type Respuesta = { data: unknown; error: { message: string } | null };

/**
 * Un cliente falso que apunta qué se le ha pedido.
 *
 * `dietas` responde con lo que diga `dietas`, mirando si el `select` incluye
 * `opcion_id` —así se puede imitar una base sin la migración 0012, que es donde
 * falla— y las tablas planas con lo que haya en `tablas`.
 */
function clienteFalso(opciones: {
  dietas: (select: string) => Respuesta;
  tablas?: Record<string, Respuesta>;
}) {
  const pedidos: string[] = [];

  const cliente = {
    from(tabla: string) {
      return {
        select(sel: string) {
          pedidos.push(`${tabla}:${sel.includes("opcion_id") ? "con-opciones" : "sin-opciones"}`);
          const plano = opciones.tablas?.[tabla] ?? { data: [], error: null };
          return {
            eq: () => ({ single: async () => opciones.dietas(sel) }),
            in: async () => plano,
          };
        },
      };
    },
  };

  return { cliente: cliente as unknown as SupabaseClient, pedidos };
}

const DIETA = {
  id: "d1",
  nombre: "Dieta",
  comidas: [
    { id: "m1", dieta_id: "d1", nombre: "Desayuno", orden: 0, componentes: [] },
    { id: "m2", dieta_id: "d1", nombre: "Cena", orden: 1, componentes: [] },
  ],
};

describe("con la migración 0012 aplicada", () => {
  it("trae la dieta y le cuelga sus opciones", async () => {
    const { cliente } = clienteFalso({
      dietas: () => ({ data: DIETA, error: null }),
      tablas: {
        opciones: {
          data: [
            { id: "o1", comida_id: "m1", nombre: "Opción 1", orden: 0 },
            { id: "o2", comida_id: "m1", nombre: "Con avena", orden: 1 },
            { id: "o3", comida_id: "m2", nombre: "Opción 1", orden: 0 },
          ],
          error: null,
        },
        comidas: {
          data: [
            { id: "m1", opcion_activa_id: "o2" },
            { id: "m2", opcion_activa_id: "o3" },
          ],
          error: null,
        },
      },
    });

    const r = await cargarDieta(cliente, "d1", "id, nombre");
    expect(r.error).toBeNull();
    expect(r.faltaMigracion).toBe(false);
    expect(r.dieta!.comidas[0].opciones).toHaveLength(2);
    expect(r.dieta!.comidas[0].opcion_activa_id).toBe("o2");
    expect(r.dieta!.comidas[1].opciones).toHaveLength(1);
  });

  it("las opciones van a su comida y no a la de al lado", async () => {
    const { cliente } = clienteFalso({
      dietas: () => ({ data: DIETA, error: null }),
      tablas: {
        opciones: {
          data: [
            { id: "o1", comida_id: "m1", nombre: "Opción 1", orden: 0 },
            { id: "o3", comida_id: "m2", nombre: "Opción 1", orden: 0 },
          ],
          error: null,
        },
        comidas: { data: [], error: null },
      },
    });
    const r = await cargarDieta(cliente, "d1", "id, nombre");
    expect(r.dieta!.comidas[0].opciones!.map((o) => o.id)).toEqual(["o1"]);
    expect(r.dieta!.comidas[1].opciones!.map((o) => o.id)).toEqual(["o3"]);
  });

  it("una comida sin opción activa se queda a null, no revienta", async () => {
    const { cliente } = clienteFalso({
      dietas: () => ({ data: DIETA, error: null }),
      tablas: {
        opciones: { data: [{ id: "o1", comida_id: "m1", nombre: "Opción 1", orden: 0 }], error: null },
        comidas: { data: [{ id: "m1", opcion_activa_id: null }], error: null },
      },
    });
    const r = await cargarDieta(cliente, "d1", "id, nombre");
    expect(r.dieta!.comidas[0].opcion_activa_id).toBeNull();
    expect(r.dieta!.comidas[1].opciones).toEqual([]);
  });
});

describe("sin la migración 0012", () => {
  it("vuelve a pedirla sin opciones en vez de caerse", async () => {
    // Es EL caso del 404: la primera consulta falla porque no existe la
    // columna. La pantalla tiene que abrirse igual.
    const { cliente, pedidos } = clienteFalso({
      dietas: (sel) =>
        sel.includes("opcion_id")
          ? { data: null, error: { message: 'column componentes.opcion_id does not exist' } }
          : { data: DIETA, error: null },
    });

    const r = await cargarDieta(cliente, "d1", "id, nombre");
    expect(r.dieta).not.toBeNull();
    expect(r.faltaMigracion).toBe(true);
    expect(r.error).toBeNull();
    // Y se ha intentado primero con opciones, después sin ellas.
    expect(pedidos.slice(0, 2)).toEqual(["dietas:con-opciones", "dietas:sin-opciones"]);
  });

  it("no pregunta por las opciones si ya sabe que no están", async () => {
    const { cliente, pedidos } = clienteFalso({
      dietas: (sel) =>
        sel.includes("opcion_id")
          ? { data: null, error: { message: "no existe" } }
          : { data: DIETA, error: null },
    });
    await cargarDieta(cliente, "d1", "id, nombre");
    expect(pedidos.filter((p) => p.startsWith("opciones:"))).toHaveLength(0);
  });

  it("si falla la consulta de opciones, la dieta se abre igual", async () => {
    // La tabla `opciones` puede no existir aunque el resto sí: media migración
    // aplicada. No es motivo para no poder ver la dieta.
    const { cliente } = clienteFalso({
      dietas: () => ({ data: DIETA, error: null }),
      tablas: {
        opciones: { data: null, error: { message: 'relation "opciones" does not exist' } },
        comidas: { data: [], error: null },
      },
    });
    const r = await cargarDieta(cliente, "d1", "id, nombre");
    expect(r.dieta).not.toBeNull();
    expect(r.faltaMigracion).toBe(true);
  });
});

describe("cuando de verdad no se puede", () => {
  it("un error que no es de la migración se devuelve, no se traga", async () => {
    // Antes TODO error acababa en `notFound()`, y por eso el fallo salía como
    // un 404 mudo en vez de decir qué pasaba.
    const { cliente } = clienteFalso({
      dietas: () => ({ data: null, error: { message: "se cayó la base" } }),
    });
    const r = await cargarDieta(cliente, "d1", "id, nombre");
    expect(r.dieta).toBeNull();
    expect(r.error).toBe("se cayó la base");
  });

  it("una dieta que no existe devuelve null sin error: eso sí es un 404", async () => {
    const { cliente } = clienteFalso({ dietas: () => ({ data: null, error: null }) });
    const r = await cargarDieta(cliente, "d1", "id, nombre");
    expect(r.dieta).toBeNull();
    expect(r.error).toBeNull();
    expect(r.faltaMigracion).toBe(false);
  });

  it("una dieta sin comidas no va a buscar opciones de nada", async () => {
    const { cliente, pedidos } = clienteFalso({
      dietas: () => ({ data: { id: "d1", nombre: "Vacía", comidas: [] }, error: null }),
    });
    const r = await cargarDieta(cliente, "d1", "id, nombre");
    expect(r.dieta).not.toBeNull();
    expect(pedidos.filter((p) => p.startsWith("opciones:"))).toHaveLength(0);
  });
});
