"use client";

import { useActionState } from "react";

import { cambiarContrasena } from "@/app/login/acciones";
import type { EstadoFormulario } from "@/app/login/tipos";

export default function FormularioContrasena() {
  const inicial: EstadoFormulario = {};
  const [estado, accion, guardando] = useActionState(cambiarContrasena, inicial);

  return (
    <form action={accion} className="tarjeta rejilla">
      <h2 style={{ margin: 0 }}>Cambiar la contraseña</h2>
      <label>
        Nueva
        <input
          type="password"
          name="nueva"
          required
          minLength={8}
          autoComplete="new-password"
          style={{ width: "100%", marginTop: 6 }}
        />
      </label>
      <label>
        Repítela
        <input
          type="password"
          name="repetida"
          required
          minLength={8}
          autoComplete="new-password"
          style={{ width: "100%", marginTop: 6 }}
        />
      </label>
      <button className="principal" disabled={guardando}>
        {guardando ? "Guardando…" : "Guardar"}
      </button>
      {estado?.error && <p className="aviso">{estado.error}</p>}
      {estado?.ok && <p style={{ color: "var(--bien)" }}>{estado.ok}</p>}
    </form>
  );
}
