"use client";

import { useTransition } from "react";

import { borrarDieta, duplicarDieta } from "@/app/dietas/[id]/acciones";
import BotonPeligroso from "./BotonPeligroso";
import { IconoCopiar, IconoPapelera } from "./Iconos";

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
    <span className="acciones">
      <button
        className="icono"
        title="Duplicar la dieta"
        aria-label="Duplicar la dieta"
        disabled={pendiente}
        onClick={() => iniciar(() => duplicarDieta(dietaId))}
      >
        <IconoCopiar />
      </button>
      <BotonPeligroso
        clase="icono quitar"
        titulo="Eliminar la dieta"
        etiqueta={<IconoPapelera />}
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
