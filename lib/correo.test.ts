import { describe, expect, it } from "vitest";

import { normalizarCorreo } from "./correo";

describe("normalizarCorreo", () => {
  it("quita espacios y pasa a minúsculas, como exige la base", () => {
    expect(normalizarCorreo("  Ana@Ejemplo.ES ")).toBe("ana@ejemplo.es");
  });

  it("vacío o nulo es null", () => {
    expect(normalizarCorreo("")).toBeNull();
    expect(normalizarCorreo("   ")).toBeNull();
    expect(normalizarCorreo(null)).toBeNull();
    expect(normalizarCorreo(undefined)).toBeNull();
  });

  it("lo que no tiene pinta de correo es null", () => {
    expect(normalizarCorreo("anaejemplo.es")).toBeNull();
    expect(normalizarCorreo("ana@ejemplo")).toBeNull();
    expect(normalizarCorreo("ana @ejemplo.es")).toBeNull();
    expect(normalizarCorreo("ana@@ejemplo.es")).toBeNull();
  });

  it("no acepta más de 254 caracteres, igual que la base", () => {
    expect(normalizarCorreo(`${"a".repeat(250)}@b.es`)).toBeNull();
  });
});
