"use client";

import { useEffect, useRef, useState } from "react";

import { normalizarEan } from "@/lib/openfoodfacts/ean";
import { useCamaraCodigos } from "./useCamaraCodigos";

/**
 * La cámara de este dispositivo leyendo un código de barras.
 *
 * **Dos modos, nunca los dos a la vez.** La primera versión enseñaba el campo
 * para teclear el código debajo del visor, y en un móvil eso deja una franja de
 * dos centímetros a la que hay que llegar deslizando mientras la cámara sigue
 * encendida ocupando la pantalla. Ahora escribir a mano es una pantalla entera:
 * al pasar a ella la cámara se apaga de verdad —el hook para las pistas del
 * flujo, así que se apaga también el piloto— y el campo queda donde se ve.
 *
 * **Va en un `<dialog>` abierto con `showModal()`**, no en un `div` flotante.
 * Un `<dialog>` modal se pinta en la capa superior del navegador, así que no lo
 * puede recortar ningún `overflow: hidden` de un antepasado ni lo descoloca
 * ningún `transform`. En la fase 11 el buscador de ingredientes se quedó sin
 * poder pulsarse justo por eso, y el escáner se abre desde el mismo sitio.
 */
type Modo = "camara" | "manual";

export default function EscanerCodigoBarras({
  onCodigo,
  onCerrar,
  modoInicial = "camara",
}: {
  /** Se llama una vez, con el código ya comprobado. */
  onCodigo: (codigo: string) => void;
  onCerrar: () => void;
  /** `manual` cuando se llega aquí desde el móvil pidiendo teclearlo. */
  modoInicial?: Modo;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const entregado = useRef(false);

  const [modo, setModo] = useState<Modo>(modoInicial);
  const [tecleado, setTecleado] = useState("");
  const [falloCodigo, setFalloCodigo] = useState<string | null>(null);

  // Una sola entrega: sin esto, dos fotogramas seguidos con el mismo código
  // llamarían dos veces y se crearían dos ingredientes.
  const entregar = (codigo: string) => {
    if (entregado.current) return;
    entregado.current = true;
    onCodigo(codigo);
  };

  const camara = useCamaraCodigos({ activa: modo === "camara", onCodigo: entregar });

  // Abrir el diálogo, una sola vez. `if (!open)` porque en desarrollo React
  // monta y desmonta dos veces, y `showModal()` sobre uno ya abierto lanza.
  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Si no hay cámara, no se deja un rectángulo negro con una excusa: se pasa a
  // lo que sí se puede hacer, que es teclear el código.
  useEffect(() => {
    if (camara.fallo) setModo("manual");
  }, [camara.fallo]);

  // Al llegar a «escribir a mano», el cursor ya en el campo. En iOS puede que
  // el teclado no suba solo —solo lo abre un gesto directo—, y por eso el campo
  // es grande: tocarlo tiene que ser fácil.
  useEffect(() => {
    if (modo === "manual") campo.current?.focus();
  }, [modo]);

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
      <button type="button" className="peligro cancelar" onClick={onCerrar}>
        Cancelar
      </button>
    </header>
  );

  // ------------------------------------------------------ escribir a mano --
  if (modo === "manual")
    return (
      <dialog ref={dialogo} className="escaner" onClose={onCerrar} onCancel={onCerrar}>
        {cabecera("Escribir el código")}

        <div className="manual">
          {camara.fallo && <p className="aviso-caja">{camara.fallo}</p>}

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

          <button type="button" className="azul" onClick={() => setModo("camara")}>
            Volver a la cámara
          </button>
        </div>
      </dialog>
    );

  // ------------------------------------------------------------- la cámara --
  return (
    <dialog ref={dialogo} className="escaner" onClose={onCerrar} onCancel={onCerrar}>
      {cabecera("Escanear un código de barras")}

      <div className="visor">
        <video ref={camara.video} playsInline muted autoPlay aria-label="Vista de la cámara" />
        {/* La mirilla no recorta nada: solo dice dónde poner el código. El
            lector barre la franja central del fotograma, que es esta. */}
        <div className="mirilla" aria-hidden />
        {camara.estado === "arrancando" && <p className="capa">Abriendo la cámara…</p>}
      </div>

      <div className="pie">
        {camara.estado === "leyendo" && (
          <p className="tenue instruccion">
            Pon el código dentro del recuadro, plano y bien iluminado.
            {!camara.nativo && " Este navegador no trae lector, se usa el de la app."}
          </p>
        )}

        {camara.linterna !== null && (
          <button type="button" onClick={camara.alternarLinterna}>
            {camara.linterna ? "Apagar la luz" : "Encender la luz"}
          </button>
        )}

        <button type="button" className="azul grande" onClick={() => setModo("manual")}>
          Cerrar cámara y escribir a mano
        </button>
      </div>
    </dialog>
  );
}
