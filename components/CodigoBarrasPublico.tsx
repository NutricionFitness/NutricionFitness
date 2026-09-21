"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { alimentoPorCodigo } from "@/app/comparador/acciones";
import type { AlimentoPublico, Escaneo } from "@/app/comparador/tipos";
import { colaDeCodigos, type ColaCodigos, type EstadoCola } from "@/lib/cola-codigos";
import ElegirCamara from "./ElegirCamara";
import EscanerCodigoBarras from "./EscanerCodigoBarras";
import { IconoCodigoBarras } from "./Iconos";
import PanelEscaneoRemoto from "./PanelEscaneoRemoto";

/**
 * Escanear —o teclear— un código de barras en el comparador público.
 *
 * Es `AltaPorCodigo` sin lo que aquí no tiene sentido. El camino es el mismo:
 * la pregunta de «¿con la cámara de aquí o con la de otro dispositivo?», la
 * cámara de aquí o el QR para el móvil, la cola que mira los códigos de uno
 * en uno. Lo que cambia es lo que se hace con el resultado: no se propone dar
 * de alta nada —no hay dónde—, se enseña la ficha y ya.
 *
 * El escaneo con otro dispositivo va por las funciones sin sesión de la 0022
 * (`modo="publico"` del panel): la sesión que se abre no es de nadie y solo se
 * llega a ella con el token del QR.
 *
 * **Un código por hueco.** Dentro de una dieta el panel del QR se queda
 * abierto y los productos van entrando en fila; aquí cada hueco es un solo
 * producto, así que en cuanto llega uno se cierra el panel. El vínculo con el
 * móvil NO se termina: queda en `sessionStorage`, y al pedir «otro
 * dispositivo» en el segundo hueco se retoma sin volver a escanear el QR.
 *
 * Y además del botón, «o escríbelo»: en un ordenador con webcam, quien tiene
 * el envase delante prefiere teclear trece dígitos a que se encienda la
 * cámara. El escáner ya sabe pasar de una cosa a la otra; esto solo decide con
 * cuál empieza.
 */

type Vista =
  | "cerrado"
  /** «¿Con la cámara de aquí o con la de otro dispositivo?» */
  | "preguntando"
  | "aqui"
  /** Aquí, pero directo a teclearlo: lo ha pedido el móvil, o el enlace. */
  | "aqui_manual"
  | "remoto";

export default function CodigoBarrasPublico({
  onAlimento,
}: {
  /** Hay ficha. Lo que se diga de ella —de dónde sale, los avisos— va en `escaneo`. */
  onAlimento: (alimento: AlimentoPublico, escaneo: Escaneo) => void;
}) {
  const [vista, setVista] = useState<Vista>("cerrado");
  const [mensaje, setMensaje] = useState<string | null>(null);

  // En una referencia para que el trabajador de la cola no tenga que
  // reconstruirse cada vez que el padre vuelve a pintar.
  const avisar = useRef(onAlimento);
  avisar.current = onAlimento;

  /**
   * La cola de códigos por mirar. La misma de `AltaPorCodigo`, y por lo
   * mismo: el móvil puede mandar dos seguidos, y dos consultas en el aire que
   * vuelven en cualquier orden pondrían en la ficha el que no es.
   */
  const [cuantos, setCuantos] = useState<EstadoCola>({ mirando: null, pendientes: 0 });
  const montado = useRef(true);
  const cola = useRef<ColaCodigos | null>(null);

  const laCola = () => {
    if (cola.current) return cola.current;

    cola.current = colaDeCodigos(
      async (codigo) => {
        let r: Awaited<ReturnType<typeof alimentoPorCodigo>>;
        try {
          r = await alimentoPorCodigo(codigo);
        } catch {
          // La acción no responde —sin red, el servidor caído—. En una página
          // abierta no hay dónde caer: se dice y se deja el botón libre.
          if (montado.current)
            setMensaje("No se ha podido buscar el código. Comprueba la conexión y vuelve a probar.");
          return;
        }
        if (!montado.current) return;

        switch (r.estado) {
          case "encontrado":
            setMensaje(null);
            // Un código por hueco: el panel del QR se cierra, el vínculo no.
            setVista("cerrado");
            avisar.current(r.alimento, r.escaneo);
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
            setMensaje(
              `El código ${codigo} no es válido. Vuelve a escanearlo o compruébalo dígito a dígito.`,
            );
        }
      },
      (e) => {
        if (montado.current) setCuantos(e);
      },
    );
    return cola.current;
  };

  const encolar = useCallback((codigo: string) => laCola().encolar(codigo), []);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      cola.current?.parar();
      // A null para que se vuelva a crear si React remonta el componente, que
      // es lo que hace en desarrollo con el modo estricto.
      cola.current = null;
    };
  }, []);

  /** Lo que llega de la cámara de aquí, o de los dedos: un código y se cierra. */
  function alLeerAqui(codigo: string) {
    setVista("cerrado");
    setMensaje(null);
    encolar(codigo);
  }

  return (
    <>
      <div className="por-codigo">
        <button
          type="button"
          onClick={() => setVista("preguntando")}
          disabled={Boolean(cuantos.mirando)}
        >
          <IconoCodigoBarras />
          {/* Con el código a la vista: si algo se atasca, se ve en cuál. */}
          <span>{cuantos.mirando ? `Buscando ${cuantos.mirando}…` : "Escanear código de barras"}</span>
        </button>
        <button
          type="button"
          className="enlace"
          onClick={() => setVista("aqui_manual")}
          disabled={Boolean(cuantos.mirando)}
        >
          o escríbelo
        </button>
      </div>

      {mensaje && <p className="aviso mensaje-codigo">{mensaje}</p>}

      {cuantos.pendientes > 1 && (
        <p className="tenue mensaje-codigo">
          {cuantos.pendientes - 1} código{cuantos.pendientes > 2 ? "s" : ""} más esperando.
        </p>
      )}

      {vista === "preguntando" && (
        <ElegirCamara
          onAqui={() => setVista("aqui")}
          onOtro={() => setVista("remoto")}
          onCerrar={() => setVista("cerrado")}
        />
      )}

      {(vista === "aqui" || vista === "aqui_manual") && (
        <EscanerCodigoBarras
          modoInicial={vista === "aqui_manual" ? "manual" : "camara"}
          onCodigo={alLeerAqui}
          onCerrar={() => setVista("cerrado")}
        />
      )}

      {vista === "remoto" && (
        // En su fila, debajo del buscador: ver `.fila-panel` en la hoja.
        <div className="fila-panel">
          <PanelEscaneoRemoto
            modo="publico"
            onCodigo={(codigo) => {
              setMensaje(null);
              encolar(codigo);
            }}
            onEscribirAMano={() => setVista("aqui_manual")}
            onCerrar={() => setVista("cerrado")}
          />
        </div>
      )}
    </>
  );
}
