"use client";

import { useState, useTransition } from "react";

import { actualizarPersona, borrarPersona } from "@/app/personas/acciones";
import BotonPeligroso from "./BotonPeligroso";

export default function CabeceraPersona({
  persona,
  nDietas,
}: {
  persona: { id: string; nombre: string; notas: string | null };
  nDietas: number;
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(persona.nombre);
  const [pendiente, iniciar] = useTransition();

  function guardar() {
    iniciar(() =>
      actualizarPersona(persona.id, { nombre: nombre.trim() }).then(() => setEditando(false)),
    );
  }

  return (
    <>
      {editando ? (
        <div className="fila" style={{ margin: "4px 0 2px" }}>
          <input
            value={nombre}
            autoFocus
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") guardar();
              if (e.key === "Escape") setEditando(false);
            }}
            style={{ fontSize: 20, minWidth: 300 }}
          />
          <button className="principal" onClick={guardar} disabled={pendiente || !nombre.trim()}>
            Guardar
          </button>
          <button onClick={() => { setNombre(persona.nombre); setEditando(false); }}>
            Cancelar
          </button>
        </div>
      ) : (
        <h1 style={{ marginBottom: 2 }}>
          {persona.nombre}{" "}
          <button className="enlace" style={{ fontSize: 14 }} onClick={() => setEditando(true)}>
            renombrar
          </button>
        </h1>
      )}

      <div className="fila sub" style={{ gap: 14 }}>
        <span>{nDietas} {nDietas === 1 ? "dieta" : "dietas"}</span>
        <BotonPeligroso
          etiqueta="borrar persona"
          aviso={
            nDietas === 0
              ? "No tiene dietas: no se pierde nada más."
              : `Se borrarán también sus ${nDietas} ${nDietas === 1 ? "dieta" : "dietas"} y todo su historial.`
          }
          onConfirmar={() => borrarPersona(persona.id)}
        />
      </div>
    </>
  );
}
