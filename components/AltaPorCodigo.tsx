"use client";

import { useState, useTransition } from "react";

import { buscarPorCodigoBarras } from "@/app/ingredientes/escanear";
import type { AvisoEscaneo, PropuestaEscaneo } from "@/app/ingredientes/tipos";
import EscanerCodigoBarras from "./EscanerCodigoBarras";
import { IconoCodigoBarras } from "./Iconos";

/**
 * El botón de escanear y lo que pasa justo después.
 *
 * Hace el camino común —abrir la cámara, comprobar el código, preguntar— y
 * delega en quien lo use lo único que cambia entre las dos pantallas: qué se
 * hace con la propuesta. En el catálogo se rellena el formulario; dentro de una
 * dieta se enseña una tarjeta para dar de alta y añadir sin salir de la comida.
 *
 * Lo que NO hace, aquí ni en ningún sitio: guardar solo. Open Food Facts lo
 * rellena la gente y hay fichas mal; siempre hay un paso donde se ven los
 * números antes de que entren en el catálogo.
 */
export default function AltaPorCodigo({
  etiqueta = "Escanear código",
  onEnCatalogo,
  onPropuesta,
  onSinFicha,
}: {
  etiqueta?: string;
  /** El código ya estaba dado de alta: no se pregunta fuera ni se duplica. */
  onEnCatalogo: (id: number, nombre: string) => void;
  /** Hay ficha en Open Food Facts. Se propone, no se ha guardado nada. */
  onPropuesta: (propuesta: PropuestaEscaneo) => void;
  /** No hay ficha, pero el código es válido y sirve para darlo de alta a mano. */
  onSinFicha?: (codigo: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; tono: "aviso" | "tenue" } | null>(null);
  const [buscando, iniciar] = useTransition();

  function alLeer(codigo: string) {
    setAbierto(false);
    setMensaje(null);

    iniciar(async () => {
      try {
        const r = await buscarPorCodigoBarras(codigo);

        switch (r.estado) {
          case "en_catalogo":
            onEnCatalogo(r.ingrediente.id, r.ingrediente.nombre);
            setMensaje({
              texto: `«${r.ingrediente.nombre}» ya estaba en tu catálogo.`,
              tono: "tenue",
            });
            return;

          case "encontrado":
            onPropuesta(r.propuesta);
            return;

          case "no_encontrado":
            onSinFicha?.(r.codigo);
            setMensaje({
              texto:
                `Open Food Facts no conoce el código ${r.codigo}. Puedes darlo de alta a ` +
                "mano copiando la tabla del envase; el código se guarda igual y el " +
                "siguiente escaneo ya lo encontrará.",
              tono: "aviso",
            });
            return;

          case "sin_respuesta":
            setMensaje({ texto: r.motivo, tono: "aviso" });
            return;

          default:
            setMensaje({
              texto: "Ese código no es válido. Vuelve a escanearlo o tecléalo.",
              tono: "aviso",
            });
        }
      } catch {
        setMensaje({ texto: "No se ha podido consultar el código.", tono: "aviso" });
      }
    });
  }

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} disabled={buscando}>
        <IconoCodigoBarras />
        <span>{buscando ? "Buscando…" : etiqueta}</span>
      </button>

      {mensaje && (
        <p className={mensaje.tono === "aviso" ? "aviso" : "tenue"} style={{ fontSize: 13 }}>
          {mensaje.texto}
        </p>
      )}

      {abierto && (
        <EscanerCodigoBarras onCodigo={alLeer} onCerrar={() => setAbierto(false)} />
      )}
    </>
  );
}

/**
 * Lo que el conversor tiene que decir sobre la ficha que acaba de traer.
 *
 * Va en ámbar y no en rojo a propósito: el rojo de esta app es de las alergias
 * y de los borrados, y gastarlo aquí le quitaría fuerza allí. Los avisos graves
 * se distinguen por el texto en negrita, no por otro color.
 */
export function AvisosEscaneo({ avisos }: { avisos: AvisoEscaneo[] }) {
  if (!avisos.length) return null;

  const graves = avisos.filter((a) => a.gravedad === "alto");
  return (
    <div className="aviso-caja avisos-escaneo">
      <div>
        <strong>
          {graves.length
            ? "Revisa esto antes de guardar"
            : "Un par de cosas de esta ficha"}
        </strong>
        <ul>
          {avisos.map((a) => (
            <li key={a.clave} className={a.gravedad === "alto" ? "grave" : undefined}>
              {a.texto}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
