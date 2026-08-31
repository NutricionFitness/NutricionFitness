"use client";

import { useActionState, useState } from "react";

import { entrar, pedirRestablecer } from "./acciones";
import type { EstadoFormulario } from "./tipos";

const inicial: EstadoFormulario = {};

export default function Login() {
  const [estado, accionEntrar, entrando] = useActionState(entrar, inicial);
  const [estadoOlvido, accionOlvido, enviandoOlvido] = useActionState(
    pedirRestablecer,
    inicial,
  );
  const [olvidada, setOlvidada] = useState(false);

  const siguiente =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("siguiente") ?? "/personas"
      : "/personas";
  const origen = typeof window !== "undefined" ? window.location.origin : "";

  if (olvidada)
    return (
      <div style={{ maxWidth: 380, margin: "56px auto" }}>
        <h1>Recuperar la contraseña</h1>
        <p className="sub">Te mandamos un enlace para elegir una nueva.</p>
        <form action={accionOlvido} className="tarjeta rejilla">
          <input type="hidden" name="origen" value={origen} />
          <label>
            Correo
            <input
              type="email"
              name="correo"
              required
              autoFocus
              style={{ width: "100%", marginTop: 6 }}
            />
          </label>
          <button className="principal" disabled={enviandoOlvido}>
            {enviandoOlvido ? "Enviando…" : "Enviar enlace"}
          </button>
          {estadoOlvido?.error && <p className="aviso">{estadoOlvido.error}</p>}
          {estadoOlvido?.ok && <p style={{ color: "var(--bien)" }}>{estadoOlvido.ok}</p>}
          <button type="button" onClick={() => setOlvidada(false)}>
            Volver
          </button>
        </form>
      </div>
    );

  return (
    <div style={{ maxWidth: 380, margin: "56px auto" }}>
      <h1>Entrar</h1>
      <p className="sub">Con tu usuario y tu contraseña.</p>
      <p style={{ fontSize: "0.8rem" }}>Acceso restringido para entrenadores. Si quieres acceder al comparador público pincha arriba en la pestaña <a href="https://nutricion-fitness.vercel.app/comparador"><em>Comparador</em></a>.</p>

      <form action={accionEntrar} className="tarjeta rejilla">
        <input type="hidden" name="siguiente" value={siguiente} />
        <label>
          Correo
          <input
            type="email"
            name="correo"
            required
            autoFocus
            autoComplete="username"
            style={{ width: "100%", marginTop: 6 }}
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            name="contrasena"
            required
            autoComplete="current-password"
            style={{ width: "100%", marginTop: 6 }}
          />
        </label>
        <button className="principal" disabled={entrando}>
          {entrando ? "Entrando…" : "Entrar"}
        </button>
        {estado?.error && <p className="aviso">{estado.error}</p>}
      </form>

      <p className="suave" style={{ fontSize: 13, marginTop: 14 }}>
        <button type="button" className="enlace" onClick={() => setOlvidada(true)}>
          He olvidado la contraseña
        </button>
      </p>
    </div>
  );
}
