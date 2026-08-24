"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buscarPorCodigoBarras } from "@/app/ingredientes/escanear";
import type { AvisoEscaneo, PropuestaEscaneo } from "@/app/ingredientes/tipos";
import { colaDeCodigos, type ColaCodigos, type EstadoCola } from "@/lib/cola-codigos";
import EscanerCodigoBarras from "./EscanerCodigoBarras";
import PanelEscaneoRemoto from "./PanelEscaneoRemoto";
import { IconoCodigoBarras } from "./Iconos";

/**
 * El botón de escanear y lo que pasa justo después.
 *
 * Hace el camino común —elegir con qué cámara, comprobar el código,
 * preguntar— y delega en quien lo use lo único que cambia entre las dos
 * pantallas: qué se hace con la propuesta. En el catálogo se rellena el
 * formulario; dentro de una dieta se enseña una tarjeta para dar de alta y
 * añadir sin salir de la comida.
 *
 * Lo que NO hace, aquí ni en ningún sitio: guardar solo. Open Food Facts lo
 * rellena la gente y hay fichas mal; siempre hay un paso donde se ven los
 * números antes de que entren en el catálogo.
 */

type Vista =
  | "cerrado"
  /** «¿Con la cámara de aquí o con la de otro dispositivo?» */
  | "preguntando"
  | "aqui"
  /** Aquí, pero directo a teclearlo: lo ha pedido el móvil. */
  | "aqui_manual"
  | "remoto";

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
  const [vista, setVista] = useState<Vista>("cerrado");
  const [mensaje, setMensaje] = useState<{ texto: string; tono: "aviso" | "tenue" } | null>(null);

  // En una referencia para que el trabajador de la cola no tenga que
  // reconstruirse cada vez que el padre vuelve a pintar.
  const avisar = useRef({ onEnCatalogo, onPropuesta, onSinFicha });
  avisar.current = { onEnCatalogo, onPropuesta, onSinFicha };

  /**
   * La cola de códigos por mirar.
   *
   * La lógica está en `lib/cola-codigos.ts`, fuera de React y con su batería.
   * No es una manía: la primera versión de esto era un `useEffect` con
   * `[cola, buscando]` en las dependencias que hacía `setBuscando(true)`
   * dentro, y eso hace que React ejecute la limpieza del efecto anterior y
   * cancele su propia consulta. El código llegaba, se contaba en pantalla, y
   * no aparecía nada. Un fallo así no se ve leyendo el código y no se puede
   * probar sin montar medio navegador; sacándolo de aquí, sí.
   *
   * Lo que queda en React son tres líneas sin nada que se pueda torcer.
   */
  const [cuantos, setCuantos] = useState<EstadoCola>({ mirando: null, pendientes: 0 });
  const montado = useRef(true);
  const cola = useRef<ColaCodigos | null>(null);

  const laCola = () => {
    if (cola.current) return cola.current;

    cola.current = colaDeCodigos(
      async (codigo) => {
        const r = await buscarPorCodigoBarras(codigo);
        if (!montado.current) return;

        switch (r.estado) {
          case "en_catalogo":
            avisar.current.onEnCatalogo(r.ingrediente.id, r.ingrediente.nombre);
            setMensaje({
              texto: `«${r.ingrediente.nombre}» ya estaba en tu catálogo.`,
              tono: "tenue",
            });
            return;

          case "encontrado":
            setMensaje(null);
            avisar.current.onPropuesta(r.propuesta);
            return;

          case "no_encontrado":
            avisar.current.onSinFicha?.(r.codigo);
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
              texto: `El código ${codigo} no es válido. Vuelve a escanearlo o tecléalo.`,
              tono: "aviso",
            });
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

  /** Lo que llega de la cámara de aquí: un código y se cierra. */
  function alLeerAqui(codigo: string) {
    setVista("cerrado");
    encolar(codigo);
  }

  return (
    <>
      <button type="button" onClick={() => setVista("preguntando")} disabled={Boolean(cuantos.mirando)}>
        <IconoCodigoBarras />
        {/* Con el código a la vista: si algo se atasca, se ve en cuál. */}
        <span>{cuantos.mirando ? `Buscando ${cuantos.mirando}…` : etiqueta}</span>
      </button>

      {mensaje && (
        <p className={mensaje.tono === "aviso" ? "aviso" : "tenue"} style={{ fontSize: 13 }}>
          {mensaje.texto}
        </p>
      )}

      {cuantos.pendientes > 1 && (
        <p className="tenue" style={{ fontSize: 13 }}>
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
        <PanelEscaneoRemoto
          onCodigo={encolar}
          onEscribirAMano={() => setVista("aqui_manual")}
          onCerrar={() => setVista("cerrado")}
        />
      )}
    </>
  );
}

/**
 * La pregunta de antes de encender nada.
 *
 * Sale siempre, incluso en el móvil, porque desde el móvil también se puede
 * querer usar otro aparato —una tableta apoyada, un segundo teléfono—. Y
 * porque una pregunta que unas veces sale y otras no es peor que una que sale
 * siempre: se aprende dónde está el botón.
 */
function ElegirCamara({
  onAqui,
  onOtro,
  onCerrar,
}: {
  onAqui: () => void;
  onOtro: () => void;
  onCerrar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog ref={dialogo} className="elegir-camara" onClose={onCerrar} onCancel={onCerrar}>
      <h2>¿Quieres usar la cámara de otro dispositivo para escanear?</h2>
      <p className="tenue">
        Si estás en el ordenador, sale a cuenta: el móvil hace de cámara y el
        producto aparece aquí para que lo revises.
      </p>
      <div className="opciones">
        <button type="button" className="azul grande" onClick={onOtro}>
          Sí, usar otro dispositivo
        </button>
        <button type="button" className="grande" onClick={onAqui}>
          No, continuar aquí
        </button>
      </div>
      <button type="button" className="enlace" onClick={onCerrar}>
        Cancelar
      </button>
    </dialog>
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
          {graves.length ? "Revisa esto antes de guardar" : "Un par de cosas de esta ficha"}
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
