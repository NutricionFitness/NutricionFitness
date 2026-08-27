"use client";

import { useState, useTransition } from "react";

import { actualizarPersona, borrarPersona } from "@/app/personas/acciones";
import BotonPeligroso from "./BotonPeligroso";

export default function CabeceraPersona({
  persona,
  nDietas,
}: {
  persona: { id: string; nombre: string; notas: string | null; peso_kg: number | null };
  nDietas: number;
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(persona.nombre);
  const [editandoPeso, setEditandoPeso] = useState(false);
  const [peso, setPeso] = useState(persona.peso_kg === null ? "" : String(persona.peso_kg));
  const [pendiente, iniciar] = useTransition();

  function guardar() {
    iniciar(() =>
      actualizarPersona(persona.id, { nombre: nombre.trim() }).then(() => setEditando(false)),
    );
  }

  // Vacío es un valor válido: «no lo sé» no es lo mismo que cero, y la app
  // enseña «—» en vez de inventarse un número.
  const pesoLimpio = peso.trim() === "" ? null : Number(peso.replace(",", "."));
  const pesoValido =
    pesoLimpio === null || (Number.isFinite(pesoLimpio) && pesoLimpio > 0 && pesoLimpio <= 400);

  function guardarPeso() {
    if (!pesoValido) return;
    iniciar(() =>
      actualizarPersona(persona.id, { peso_kg: pesoLimpio }).then(() => setEditandoPeso(false)),
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
          <button
            className="enlace"
            style={{ fontSize: 13.5, fontWeight: 400 }}
            onClick={() => setEditando(true)}
          >
            renombrar
          </button>
        </h1>
      )}

      <div className="fila sub" style={{ gap: 12, marginTop: 8 }}>
        <span className="chip">
          {nDietas} {nDietas === 1 ? "dieta" : "dietas"}
        </span>

        {/* El peso vive aquí, junto al nombre, porque no es un dato de una
            dieta: es de la persona, y lo usan todas sus dietas para poder leer
            los macros en gramos por kilo. */}
        {editandoPeso ? (
          <span className="fila" style={{ gap: 6 }}>
            <input
              value={peso}
              autoFocus
              inputMode="decimal"
              placeholder="kg"
              aria-label="Peso en kilos"
              onChange={(e) => setPeso(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") guardarPeso();
                if (e.key === "Escape") {
                  setPeso(persona.peso_kg === null ? "" : String(persona.peso_kg));
                  setEditandoPeso(false);
                }
              }}
              style={{ width: 88 }}
            />
            <button
              className="principal"
              onClick={guardarPeso}
              disabled={pendiente || !pesoValido}
            >
              Guardar
            </button>
            <button
              onClick={() => {
                setPeso(persona.peso_kg === null ? "" : String(persona.peso_kg));
                setEditandoPeso(false);
              }}
            >
              Cancelar
            </button>
            {!pesoValido && (
              <span className="aviso" style={{ fontSize: 12.5 }}>
                Entre 1 y 400 kg, o vacío.
              </span>
            )}
          </span>
        ) : (
          <button
            className="enlace"
            onClick={() => setEditandoPeso(true)}
            title="Sirve para leer los macros de sus dietas en gramos por kilo de peso"
          >
            {persona.peso_kg === null
              ? "poner peso"
              : `${persona.peso_kg.toLocaleString("es-ES")} kg`}
          </button>
        )}

        <BotonPeligroso
          clase="enlace peligroso"
          etiqueta="Eliminar persona"
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
