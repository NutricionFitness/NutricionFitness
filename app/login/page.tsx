"use client";

import { useState } from "react";

import { clienteNavegador } from "@/lib/supabase/cliente";

/**
 * Entrada por enlace mágico.
 *
 * Sin contraseñas a propósito: no hay que almacenarlas, ni recuperarlas, ni
 * preocuparse de que alguien reutilice una. Para una app de uso profesional con
 * pocas cuentas es la opción con menos superficie de problemas.
 */
export default function Login() {
  const [correo, setCorreo] = useState("");
  const [estado, setEstado] = useState<"quieto" | "enviando" | "enviado" | "error">("quieto");
  const [mensaje, setMensaje] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEstado("enviando");
    const supabase = clienteNavegador();
    const siguiente = new URLSearchParams(window.location.search).get("siguiente") ?? "/personas";
    const { error } = await supabase.auth.signInWithOtp({
      email: correo.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?siguiente=${encodeURIComponent(siguiente)}`,
      },
    });
    if (error) {
      setEstado("error");
      setMensaje(error.message);
    } else {
      setEstado("enviado");
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "60px auto" }}>
      <h1>Entrar</h1>
      <p className="sub">Te mandamos un enlace al correo. No hay contraseña que recordar.</p>

      {estado === "enviado" ? (
        <div className="tarjeta">
          <p style={{ margin: 0 }}>
            Enlace enviado a <strong>{correo}</strong>. Ábrelo en este mismo navegador.
          </p>
        </div>
      ) : (
        <form onSubmit={enviar} className="tarjeta rejilla">
          <label>
            Correo
            <input
              type="email"
              required
              autoFocus
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="tu@correo.es"
              style={{ width: "100%", marginTop: 6 }}
            />
          </label>
          <button className="principal" disabled={estado === "enviando"}>
            {estado === "enviando" ? "Enviando…" : "Enviar enlace"}
          </button>
          {estado === "error" && <p className="aviso">{mensaje}</p>}
        </form>
      )}
    </div>
  );
}
