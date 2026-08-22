"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { leerFotograma } from "@/lib/codigo-barras/decodificar";
import { normalizarEan } from "@/lib/openfoodfacts/ean";

/**
 * La cámara leyendo códigos de barras.
 *
 * **Dos modos, nunca los dos a la vez.** La primera versión enseñaba el campo
 * para teclear el código debajo del visor, y en un móvil eso deja una franja de
 * dos centímetros a la que hay que llegar deslizando mientras la cámara sigue
 * encendida ocupando la pantalla. Ahora escribir a mano es una pantalla entera:
 * al pasar a ella la cámara **se apaga de verdad** —se paran las pistas del
 * flujo, así que se apaga también el piloto—, y el campo queda donde se ve.
 *
 * Otras dos cosas que condicionan el resto:
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

type Modo = "camara" | "manual";
type Estado = { fase: "arrancando" } | { fase: "leyendo"; nativo: boolean };

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
  const campo = useRef<HTMLInputElement>(null);
  const lienzo = useRef<HTMLCanvasElement | null>(null);
  const flujo = useRef<MediaStream | null>(null);
  const vivo = useRef(false);
  const anterior = useRef<string | null>(null);
  const entregado = useRef(false);

  const [modo, setModo] = useState<Modo>("camara");
  const [estado, setEstado] = useState<Estado>({ fase: "arrancando" });
  const [falloCamara, setFalloCamara] = useState<string | null>(null);
  const [linterna, setLinterna] = useState<boolean | null>(null); // null = no la hay
  const [tecleado, setTecleado] = useState("");
  const [falloCodigo, setFalloCodigo] = useState<string | null>(null);

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

  const cerrar = useCallback(() => {
    vivo.current = false;
    onCerrar();
  }, [onCerrar]);

  // Abrir el diálogo, una sola vez. `if (!open)` porque en desarrollo React
  // monta y desmonta dos veces, y `showModal()` sobre uno ya abierto lanza.
  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  // ------------------------------------------------------------- la cámara --
  // Atada al modo: al pasar a «manual» se ejecuta la limpieza, que para las
  // pistas del flujo. Eso es lo que apaga la cámara y su piloto de verdad; con
  // solo esconder el vídeo seguiría encendida.
  useEffect(() => {
    if (modo !== "camara") return;

    vivo.current = true;
    anterior.current = null;
    setEstado({ fase: "arrancando" });

    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        aMano(
          !window.isSecureContext
            ? "El navegador solo deja usar la cámara en páginas seguras (https)."
            : "Este navegador no da acceso a la cámara.",
        );
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
        // Si no hay cámara, no se deja un rectángulo negro con una excusa: se
        // pasa a lo que sí se puede hacer, que es teclear el código.
        aMano(
          nombre === "NotAllowedError"
            ? "No has dado permiso para usar la cámara. Se cambia en el candado de la barra de direcciones."
            : nombre === "NotFoundError"
              ? "Este aparato no tiene cámara."
              : nombre === "NotReadableError"
                ? "La cámara la está usando otra aplicación."
                : "No se ha podido abrir la cámara.",
        );
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
      setLinterna(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  // Al llegar a «escribir a mano», el cursor ya en el campo. En iOS puede que
  // el teclado no suba solo —solo lo abre un gesto directo—, y por eso el campo
  // es grande: tocarlo tiene que ser fácil.
  useEffect(() => {
    if (modo === "manual") campo.current?.focus();
  }, [modo]);

  /** Pasa a escribir a mano, contando por qué si es que la cámara ha fallado. */
  function aMano(motivo: string | null = null) {
    setFalloCamara(motivo);
    setModo("manual");
  }

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
      setFalloCodigo(
        "Ese código no cuadra. Son los 8 o 13 dígitos de debajo de las barras, " +
          "y el último es un dígito de control: si no encaja, hay alguno mal.",
      );
      return;
    }
    entregar(ean.codigo);
  }

  const cabecera = (titulo: string) => (
    <header>
      <h2>{titulo}</h2>
      {/* Rojo y con la palabra escrita, no un aspa. Se abre con el envase en
          una mano y el móvil en la otra: hay que poder salir sin apuntar. */}
      <button type="button" className="peligro cancelar" onClick={cerrar}>
        Cancelar
      </button>
    </header>
  );

  // ------------------------------------------------------ escribir a mano --
  if (modo === "manual")
    return (
      <dialog ref={dialogo} className="escaner" onClose={cerrar} onCancel={cerrar}>
        {cabecera("Escribir el código")}

        <div className="manual">
          {falloCamara && <p className="aviso-caja">{falloCamara}</p>}

          <label className="campo">
            <span className="etiqueta">Los dígitos de debajo de las barras</span>
            <input
              ref={campo}
              value={tecleado}
              inputMode="numeric"
              autoComplete="off"
              placeholder="8410179000015"
              onChange={(e) => {
                setTecleado(e.target.value);
                setFalloCodigo(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && mandarTecleado()}
            />
            <small>Son 8 o 13. Los espacios y los guiones dan igual.</small>
          </label>

          {falloCodigo && <p className="aviso">{falloCodigo}</p>}

          <button className="principal grande" onClick={mandarTecleado} disabled={!tecleado.trim()}>
            Buscar este código
          </button>

          <button
            type="button"
            className="azul"
            onClick={() => {
              // Se limpia el motivo: si la cámara vuelve a fallar, el efecto lo
              // pondrá otra vez, y si no, no debe quedarse un aviso viejo.
              setFalloCamara(null);
              setModo("camara");
            }}
          >
            Volver a la cámara
          </button>
        </div>
      </dialog>
    );

  // ------------------------------------------------------------- la cámara --
  return (
    <dialog ref={dialogo} className="escaner" onClose={cerrar} onCancel={cerrar}>
      {cabecera("Escanear un código de barras")}

      <div className="visor">
        <video ref={video} playsInline muted autoPlay aria-label="Vista de la cámara" />
        {/* La mirilla no recorta nada: solo dice dónde poner el código. El
            lector barre la franja central del fotograma, que es esta. */}
        <div className="mirilla" aria-hidden />
        {estado.fase === "arrancando" && <p className="capa">Abriendo la cámara…</p>}
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

        <button type="button" className="azul grande" onClick={() => aMano()}>
          Cerrar cámara y escribir a mano
        </button>
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
