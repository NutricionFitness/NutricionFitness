"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { leerFotograma } from "@/lib/codigo-barras/decodificar";
import { normalizarEan } from "@/lib/openfoodfacts/ean";

/**
 * Abrir la cámara y leer códigos de barras de lo que enfoque.
 *
 * Vive aparte porque hay **dos** escáneres que necesitan exactamente esto y se
 * diferencian solo en qué hacen con el código: el de este dispositivo, que lo
 * busca y cierra, y el del móvil, que lo manda al ordenador y sigue leyendo.
 * Duplicar el bucle habría sido duplicar también la gestión del flujo de vídeo,
 * que es donde están todas las trampas —apagar el piloto, iOS, permisos—.
 *
 * **Un código no se entrega hasta leerlo dos veces seguidas igual.** El dígito
 * de control caza casi todas las lecturas malas, pero «casi» no basta cuando la
 * consecuencia es meter otro alimento en la dieta de alguien; dos lecturas
 * iguales cuestan una décima de segundo.
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

/** Cuánto hay que dejar de ver un código para que vuelva a contar. */
const REPETIR_TRAS = 3000;

export type EstadoCamara = "apagada" | "arrancando" | "leyendo";

export function useCamaraCodigos({
  activa,
  onCodigo,
}: {
  activa: boolean;
  /** Se llama con el código ya comprobado. Puede llamarse varias veces. */
  onCodigo: (codigo: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const lienzo = useRef<HTMLCanvasElement | null>(null);
  const flujo = useRef<MediaStream | null>(null);
  const vivo = useRef(false);
  const anterior = useRef<string | null>(null);
  const ultimo = useRef<{ codigo: string; cuando: number } | null>(null);
  // En una referencia y no en las dependencias del efecto: si estuviera en las
  // dependencias, cada render del padre reiniciaría la cámara.
  const entregar = useRef(onCodigo);
  entregar.current = onCodigo;

  const [estado, setEstado] = useState<EstadoCamara>("apagada");
  const [nativo, setNativo] = useState(false);
  const [linterna, setLinterna] = useState<boolean | null>(null); // null = no la hay
  const [fallo, setFallo] = useState<string | null>(null);

  useEffect(() => {
    if (!activa) return;

    vivo.current = true;
    anterior.current = null;
    ultimo.current = null;
    setEstado("arrancando");
    setFallo(null);

    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setFallo(
          !window.isSecureContext
            ? "El navegador solo deja usar la cámara en páginas seguras (https)."
            : "Este navegador no da acceso a la cámara.",
        );
        setEstado("apagada");
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
        setFallo(
          nombre === "NotAllowedError"
            ? "No has dado permiso para usar la cámara. Se cambia en el candado de la barra de direcciones."
            : nombre === "NotFoundError"
              ? "Este aparato no tiene cámara."
              : nombre === "NotReadableError"
                ? "La cámara la está usando otra aplicación."
                : "No se ha podido abrir la cámara.",
        );
        setEstado("apagada");
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
      setLinterna(media.getVideoTracks()[0]?.getCapabilities?.().torch ? false : null);

      const hayNativo = Boolean(window.BarcodeDetector);
      setNativo(hayNativo);
      setEstado("leyendo");
      bucle(hayNativo);
    })();

    return () => {
      vivo.current = false;
      // Parar las pistas es lo que apaga la cámara **y su piloto**. Con solo
      // esconder el vídeo seguiría encendida y gastando batería.
      flujo.current?.getTracks().forEach((t) => t.stop());
      flujo.current = null;
      setLinterna(null);
      setEstado("apagada");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa]);

  async function bucle(hayNativo: boolean) {
    const detector = hayNativo ? new window.BarcodeDetector!({ formats: FORMATOS }) : null;

    while (vivo.current) {
      const v = video.current;
      if (!v || v.readyState < 2 || !v.videoWidth) {
        await esperar(120);
        continue;
      }

      let leido: string | null = null;
      try {
        leido = detector
          ? ((await detector.detect(v))[0]?.rawValue ?? null)
          : conLectorPropio(v, lienzo);
      } catch {
        // Un fotograma que falla no es nada: se mira el siguiente.
      }

      if (leido) {
        const ean = normalizarEan(leido);
        if (ean) {
          if (anterior.current === ean.codigo) {
            const u = ultimo.current;
            // El mismo envase delante de la cámara son cien lecturas seguidas.
            // Solo cuenta otra vez si ha dejado de verse un rato.
            const repetido =
              u?.codigo === ean.codigo && performance.now() - u.cuando < REPETIR_TRAS;
            if (!repetido) {
              ultimo.current = { codigo: ean.codigo, cuando: performance.now() };
              entregar.current(ean.codigo);
            }
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

  const alternarLinterna = useCallback(async () => {
    const pista = flujo.current?.getVideoTracks()[0];
    if (!pista) return;
    setLinterna((antes) => {
      if (antes === null) return null;
      const encendida = !antes;
      pista
        .applyConstraints({ advanced: [{ torch: encendida }] })
        .catch(() => setLinterna(null)); // decía que podía y no puede
      return encendida;
    });
  }, []);

  return { video, estado, nativo, linterna, alternarLinterna, fallo };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
