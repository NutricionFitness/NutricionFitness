"use client";

import { useEffect, useRef, useState } from "react";

import { alimentoPorCodigo } from "@/app/comparador/acciones";
import type { AlimentoPublico, Escaneo } from "@/app/comparador/tipos";
import EscanerCodigoBarras from "./EscanerCodigoBarras";
import { IconoCodigoBarras } from "./Iconos";

/**
 * Escanear —o teclear— un código de barras en el comparador público.
 *
 * Es el hermano pequeño de `AltaPorCodigo`, y lo que le falta es a propósito:
 *
 *   · No pregunta «¿con la cámara de otro dispositivo?». El escaneo remoto
 *     abre una sesión en la base (0009) y eso pide haber entrado; aquí no ha
 *     entrado nadie. La cámara de este aparato, o los dedos.
 *   · No hay cola: se lee un código y se busca ese. En el catálogo los códigos
 *     se encadenan porque se está dando de alta la compra entera; aquí se
 *     compara un producto y luego, si acaso, otro.
 *   · No propone dar de alta nada. No hay dónde.
 *
 * Dos entradas y no una porque son dos gestos distintos: en el móvil se
 * escanea, y en un ordenador con cámara —que abriría la webcam para nada—
 * quien tiene el envase delante prefiere teclear los trece dígitos. El
 * escáner ya sabe pasar de una cosa a la otra; esto solo decide con cuál
 * empieza.
 */
export default function CodigoBarrasPublico({
  onAlimento,
}: {
  /** Hay ficha. Lo que se diga de ella —de dónde sale, los avisos— va en `escaneo`. */
  onAlimento: (alimento: AlimentoPublico, escaneo: Escaneo) => void;
}) {
  const [vista, setVista] = useState<"cerrado" | "camara" | "manual">("cerrado");
  const [buscando, setBuscando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Si el padre desmonta esto con una consulta en el aire —cambia de alimento,
  // se quita el segundo— la respuesta no tiene que escribir en nada.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  async function alCodigo(codigo: string) {
    setVista("cerrado");
    setMensaje(null);
    setBuscando(codigo);

    let r: Awaited<ReturnType<typeof alimentoPorCodigo>>;
    try {
      r = await alimentoPorCodigo(codigo);
    } catch {
      // La acción no responde —sin red, el servidor caído—. En una página
      // abierta no hay dónde caer: se dice y se deja el botón libre.
      if (!montado.current) return;
      setBuscando(null);
      setMensaje("No se ha podido buscar el código. Comprueba la conexión y vuelve a probar.");
      return;
    }
    if (!montado.current) return;
    setBuscando(null);

    switch (r.estado) {
      case "encontrado":
        onAlimento(r.alimento, r.escaneo);
        return;
      case "no_encontrado":
        setMensaje(
          `Ni el catálogo ni Open Food Facts conocen el código ${r.codigo}. ` +
            "Puedes buscar el producto por su nombre, o uno parecido.",
        );
        return;
      case "sin_respuesta":
        // `motivo` ya es una frase entera («Open Food Facts ha tardado demasiado.»).
        setMensaje(`El código ${r.codigo} no está en el catálogo. ${r.motivo}`);
        return;
      default:
        setMensaje("Ese código no es válido. Vuelve a escanearlo o compruébalo dígito a dígito.");
    }
  }

  return (
    <>
      <div className="por-codigo">
        <button type="button" onClick={() => setVista("camara")} disabled={buscando !== null}>
          <IconoCodigoBarras />
          {/* Con el código a la vista: si algo se atasca, se ve en cuál. */}
          <span>{buscando ? `Buscando ${buscando}…` : "Escanear código de barras"}</span>
        </button>
        <button
          type="button"
          className="enlace"
          onClick={() => setVista("manual")}
          disabled={buscando !== null}
        >
          o escríbelo
        </button>
      </div>

      {mensaje && <p className="aviso mensaje-codigo">{mensaje}</p>}

      {vista !== "cerrado" && (
        <EscanerCodigoBarras
          modoInicial={vista}
          onCodigo={alCodigo}
          onCerrar={() => setVista("cerrado")}
        />
      )}
    </>
  );
}
