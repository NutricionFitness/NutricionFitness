"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  borrarDieta,
  datosParaTransferir,
  duplicarDieta,
} from "@/app/dietas/[id]/acciones";
import type { DatosTransferencia } from "@/app/dietas/[id]/tipos";
import BotonPeligroso from "./BotonPeligroso";
import DialogoTransferir from "./DialogoTransferir";
import { IconoCopiar, IconoPapelera, IconoTransferir } from "./Iconos";

/** Transferir, duplicar y borrar desde el listado, sin tener que entrar en la dieta. */
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
  const [datos, setDatos] = useState<DatosTransferencia | null>(null);
  const router = useRouter();

  return (
    // El `<dialog>` cuelga de la celda y no del `<span>`: un `span` solo puede
    // llevar dentro contenido de frase, y un `dialog` no lo es.
    <>
      <span className="acciones">
        <button
          className="icono"
          title="Transferir a otra persona"
          aria-label="Transferir a otra persona"
          disabled={pendiente}
          // Los datos se piden aquí, al pulsar, y no dentro del diálogo: así el
          // listado no paga en cada carga un cruce de alergias que casi nunca se
          // mira, y el diálogo no tiene ningún efecto que consulte —que es de
          // donde salieron los dos fallos de la fase 16—.
          onClick={() =>
            iniciar(async () => {
              setDatos(await datosParaTransferir(dietaId));
            })
          }
        >
          <IconoTransferir />
        </button>
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

      {datos && (
        <DialogoTransferir
          datos={datos}
          dietaId={dietaId}
          onCerrar={() => setDatos(null)}
          onHecho={() => {
            setDatos(null);
            // La dieta ya no está en esta lista —o hay una nueva en otra
            // persona—, así que lo que se está mirando ya no es verdad.
            router.refresh();
          }}
        />
      )}
    </>
  );
}
