"use client";

import { useActionState } from "react";

import { entrarComparador } from "@/app/comparador/acciones";
import type { EstadoFormulario } from "@/app/login/tipos";

const inicial: EstadoFormulario = {};

/**
 * La puerta del comparador para quien no ha entrado en la app: un correo, y
 * vale si es el de alguna persona dada de alta (migración 0023). Se pide una
 * vez; después lo recuerda este navegador.
 */
export default function AccesoComparador() {
  const [estado, accion, entrando] = useActionState(entrarComparador, inicial);

  return (
    <div className="entrada" style={{ marginTop: 8 }}>
      <form action={accion} className="tarjeta rejilla">
        <p style={{ margin: 0 }}>
          El comparador es para las personas que llevamos. Entra con el correo
          que le diste a tu entrenador.
        </p>
        <label>
          Correo
          <input
            type="email"
            name="correo"
            required
            autoFocus
            autoComplete="email"
            style={{ width: "100%", marginTop: 6 }}
          />
        </label>
        <button className="principal" disabled={entrando}>
          {entrando ? "Comprobando…" : "Entrar al comparador"}
        </button>
        {estado?.error && <p className="aviso">{estado.error}</p>}
      </form>
    </div>
  );
}
