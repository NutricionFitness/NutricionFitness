"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { leerFotograma } from "@/lib/codigo-barras/decodificar";
import { normalizarEan } from "@/lib/openfoodfacts/ean";
import { IconoCerrar } from "./Iconos";

/**
 * La cámara leyendo códigos de barras.
 *
 * Tres cosas que condicionan todo lo demás:
 *
 * · **Va en un `<dialog>` abierto con `showModal()`**, no en un `div` flotante.
 *   Un `<dialog>` modal se pinta en la capa superior del navegador, así que no
 *   lo puede recortar ningún `overflow: hidden` de un antepasado ni lo descoloca
 *   ningún `transform`. En la fase 11 el buscador de ingredientes se quedó sin
 *   poder pulsarse justo por eso, y el escáner se abre desde el mismo sitio.
 *
 * · **Un código no se acepta hasta leerlo dos veces seguidas igual.** El dígito
 *   de control caza casi todas las lecturas malas, pero «casi» no basta cuando
 *   la consecuencia es meter otro alimento en la dieta de alguien. Dos lecturas
 *   iguales cuestan una décima de segundo.
 *
 * · **Siempre se puede teclear el código.** Un envase arrugado, un código
 *   rayado o un móvil sin cámara no pueden ser un callejón sin salida.
 */

/** `BarcodeDetector` aún no está en los tipos del DOM. Lo justo para usarlo. */
interface DetectorNativo {
  detect(fuente: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: {
      new (opciones?: { formats?: string[] }): DetectorNativo;
      getSupportedFormats?(): Promise<string[]>;
    };
  }
  /**
   * La linterna tampoco está en los tipos del DOM: solo la tienen las cámaras
   * traseras de los móviles y la especificación sigue sin cerrarse. Se declara
   * aquí en vez de forzar el tipo en cada uso, que es lo que esconde errores.
   */
  interface MediaTrackConstraintSet {
    torch?: boolean;
  }
  interface MediaTrackCapabilities {
    torch?: boolean;
  }
}

const FORMATOS = ["ean_13", "ean_8", "upc_a", "upc_e"];

type Estado =
  | { fase: "arrancando" }
  | { fase: "leyendo"; nativo: boolean }
  | { fase: "fallo"; texto: string };

export default function EscanerCodigoBarras({
  onCodigo,
  onCerrar,
}: {
  /** Se llama una vez, con el código ya comprobado. */
  onCodigo: (codigo: string) => void;
  onCerrar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const lienzo = useRef<HTMLCanvasElement | null>(null);
  const flujo = useRef<MediaStream | null>(null);
  const vivo = useRef(true);
  const anterior = useRef<string | null>(null);
  const entregado = useRef(false);

  const [estado, setEstado] = useState<Estado>({ fase: "arrancando" });
  const [linterna, setLinterna] = useState<boolean | null>(null); // null = no la hay
  const [tecleado, setTecleado] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);

  // Una sola entrega: sin esto, dos fotogramas seguidos con el mismo código
  // llamarían dos veces y se crearían dos ingredientes.
  const entregar = useCallback(
    (codigo: string) => {
      if (entregado.current) return;
      entregado.current = true;
      vivo.current = false;
      onCodigo(codigo);
    },
    [onCodigo],
  );

  // ------------------------------------------------------------- la cámara --
  useEffect(() => {
    vivo.current = true;
    dialogo.current?.showModal();

    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setEstado({
          fase: "fallo",
          texto: !window.isSecureContext
            ? "El navegador solo deja usar la cámara en páginas seguras (https)."
            : "Este navegador no da acceso a la cámara.",
        });
        return;
      }

      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          video: {
            // `ideal` y no `exact`: en un portátil no hay cámara trasera y con
            // `exact` la llamada falla en vez de dar la que haya.
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (e) {
        const nombre = e instanceof Error ? e.name : "";
        setEstado({
          fase: "fallo",
          texto:
            nombre === "NotAllowedError"
              ? "No has dado permiso para usar la cámara. Se cambia en el candado de la barra de direcciones."
              : nombre === "NotFoundError"
                ? "Este aparato no tiene cámara."
                : nombre === "NotReadableError"
                  ? "La cámara la está usando otra aplicación."
                  : "No se ha podido abrir la cámara.",
        });
        return;
      }

      if (!vivo.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }

      flujo.current = media;
      const v = video.current;
      if (v) {
        v.srcObject = media;
        // En iOS `play()` puede rechazar si la pestaña pierde el foco justo
        // aquí. No es motivo para tirar todo el escáner.
        try {
          await v.play();
        } catch {
          /* el bucle sigue: si hay fotogramas, se leen */
        }
      }

      // La linterna solo existe en las cámaras traseras de los móviles.
      const pista = media.getVideoTracks()[0];
      setLinterna(pista?.getCapabilities?.().torch ? false : null);

      const nativo = Boolean(window.BarcodeDetector);
      setEstado({ fase: "leyendo", nativo });
      bucle(nativo);
    })();

    return () => {
      vivo.current = false;
      flujo.current?.getTracks().forEach((t) => t.stop());
      flujo.current = null;
    };
    // Se monta y se desmonta entero: no hay dependencias que puedan cambiar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------- el bucle --
  async function bucle(nativo: boolean) {
    const detector = nativo ? new window.BarcodeDetector!({ formats: FORMATOS }) : null;

    while (vivo.current) {
      const v = video.current;
      if (!v || v.readyState < 2 || !v.videoWidth) {
        await esperar(120);
        continue;
      }

      let leido: string | null = null;
      try {
        leido = detector ? await conDetector(detector, v) : conLectorPropio(v, lienzo);
      } catch {
        // Un fotograma que falla no es nada: se mira el siguiente.
      }

      if (leido) {
        const ean = normalizarEan(leido);
        if (ean) {
          // La confirmación: dos lecturas seguidas iguales.
          if (anterior.current === ean.codigo) {
            entregar(ean.codigo);
            return;
          }
          anterior.current = ean.codigo;
        }
      } else {
        anterior.current = null;
      }

      // Sin pausa el bucle se come la batería y no lee más rápido: la cámara
      // no da más de 30 fotogramas por segundo.
      await esperar(leido ? 60 : 110);
    }
  }

  // ------------------------------------------------------------ la linterna --
  async function alternarLinterna() {
    const pista = flujo.current?.getVideoTracks()[0];
    if (!pista || linterna === null) return;
    const encendida = !linterna;
    try {
      await pista.applyConstraints({ advanced: [{ torch: encendida }] });
      setLinterna(encendida);
    } catch {
      setLinterna(null); // decía que podía y no puede: se quita el botón
    }
  }

  // -------------------------------------------------------------- teclearlo --
  function mandarTecleado() {
    const ean = normalizarEan(tecleado);
    if (!ean) {
      setFallo(
        "Ese código no cuadra. Son los 8 o 13 dígitos de debajo de las barras, " +
          "y el último es un dígito de control: si no encaja, hay alguno mal.",
      );
      return;
    }
    entregar(ean.codigo);
  }

  const cerrar = () => {
    vivo.current = false;
    onCerrar();
  };

  return (
    <dialog ref={dialogo} className="escaner" onClose={cerrar} onCancel={cerrar}>
      <header>
        <h2>Escanear un código de barras</h2>
        <button type="button" className="cerrar" onClick={cerrar} title="Cerrar" aria-label="Cerrar">
          <IconoCerrar />
        </button>
      </header>

      <div className="visor">
        <video ref={video} playsInline muted autoPlay aria-label="Vista de la cámara" />
        {/* La mirilla no recorta nada: solo dice dónde poner el código. El
            lector barre la franja central del fotograma, que es esta. */}
        <div className="mirilla" aria-hidden />

        {estado.fase === "arrancando" && <p className="capa">Abriendo la cámara…</p>}
        {estado.fase === "fallo" && (
          <div className="capa">
            <p>{estado.texto}</p>
            <p className="tenue">Puedes teclear el código aquí debajo.</p>
          </div>
        )}
      </div>

      <div className="pie">
        {estado.fase === "leyendo" && (
          <p className="tenue instruccion">
            Pon el código dentro del recuadro, plano y bien iluminado.
            {!estado.nativo && " Este navegador no trae lector, se usa el de la app."}
          </p>
        )}

        {linterna !== null && (
          <button type="button" onClick={alternarLinterna}>
            {linterna ? "Apagar la luz" : "Encender la luz"}
          </button>
        )}

        <div className="a-mano">
          <label className="campo">
            <span className="etiqueta">…o teclea los dígitos de debajo de las barras</span>
            <span className="fila">
              <input
                value={tecleado}
                inputMode="numeric"
                autoComplete="off"
                placeholder="8410179000015"
                onChange={(e) => {
                  setTecleado(e.target.value);
                  setFallo(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && mandarTecleado()}
              />
              <button type="button" className="principal" onClick={mandarTecleado} disabled={!tecleado.trim()}>
                Buscar
              </button>
            </span>
          </label>
          {fallo && <p className="aviso">{fallo}</p>}
        </div>
      </div>
    </dialog>
  );
}

// ------------------------------------------------------------------ apoyos --

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** El lector del navegador, cuando lo hay. Es mejor que el nuestro. */
async function conDetector(detector: DetectorNativo, v: HTMLVideoElement) {
  const encontrados = await detector.detect(v);
  return encontrados[0]?.rawValue ?? null;
}

/**
 * El lector propio: se copia el fotograma a un lienzo y se leen sus píxeles.
 *
 * El lienzo se reduce a 640 px de ancho. Más resolución no ayuda —un módulo de
 * un EAN mide de sobra a 640— y sí multiplica los píxeles que hay que recorrer.
 */
function conLectorPropio(
  v: HTMLVideoElement,
  ref: { current: HTMLCanvasElement | null },
): string | null {
  const ancho = Math.min(640, v.videoWidth);
  const alto = Math.round((v.videoHeight / v.videoWidth) * ancho);

  let c = ref.current;
  if (!c) {
    c = document.createElement("canvas");
    ref.current = c;
  }
  if (c.width !== ancho || c.height !== alto) {
    c.width = ancho;
    c.height = alto;
  }

  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(v, 0, 0, ancho, alto);

  return leerFotograma(ctx.getImageData(0, 0, ancho, alto).data, ancho, alto);
}
