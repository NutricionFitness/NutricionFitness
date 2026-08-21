"use client";

import { useTransition } from "react";

import { borrarDieta, duplicarDieta } from "@/app/dietas/[id]/acciones";
import BotonPeligroso from "./BotonPeligroso";

/** Duplicar y borrar desde el listado, sin tener que entrar en la dieta. */
export default function AccionesDieta({
  dietaId,
  personaId,
  tieneVersiones,
}: {
  dietaId: string;
  personaId: string | null;
  tieneVersiones: boolean;
}) {
  const [pendiente, iniciar] = useTransition();

  return (
    <span className="fila" style={{ gap: 10, justifyContent: "flex-end" }}>
      <button
        className="enlace"
        disabled={pendiente}
        onClick={() => iniciar(() => duplicarDieta(dietaId))}
      >
        duplicar
      </button>
      <BotonPeligroso
        etiqueta="borrar"
        aviso={
          tieneVersiones
            ? "Se borra solo esta versión; las demás se conservan."
            : "Se borra con sus comidas y componentes."
        }
        onConfirmar={() => borrarDieta(dietaId, personaId)}
      />
    </span>
  );
}
