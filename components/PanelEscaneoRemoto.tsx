"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  abrirSesionEscaneo,
  abrirSesionEscaneoAnonima,
  cerrarSesionEscaneo,
  cerrarSesionEscaneoAnonima,
  novedadesEscaneo,
  novedadesEscaneoAnonimo,
} from "@/app/escanear/acciones";
import CodigoQR from "./CodigoQR";

/**
 * El lado del ordenador: enseñar el QR y recoger lo que manda el móvil.
 *
 * Guarda el vínculo en `sessionStorage` a propósito. En una dieta, este panel
 * se desmonta en cuanto llega un producto —la tarjeta de revisión ocupa su
 * sitio— y volvería a montarse después; sin recordar el vínculo habría que
 * volver a escanear el QR para cada alimento, que es justo lo que se quería
 * evitar. Los códigos que lleguen mientras tanto no se pierden: esperan en la
 * cola de la base y se recogen al volver.
 *
 * Se consulta cada dos segundos. No es tiempo real, y es una decisión: el
 * tiempo real de Supabase habría que configurarlo y probarlo contra el proyecto
 * de verdad, y esto son dos consultas diminutas mientras dura el vínculo.
 *
 * **Dos modos, un solo panel.** Con `modo="publico"` —el comparador, sin
 * sesión— el vínculo se abre, se sondea y se cierra por las funciones de la
 * 0022 en vez de por las tablas; todo lo demás, el QR, el móvil, la cola, es
 * idéntico. Las claves de `sessionStorage` van por modo para que un vínculo
 * con dueño no se intente retomar desde el comparador, que no lo vería.
 */

export type ModoPanel = "sesion" | "publico";

const ACCIONES = {
  sesion: {
    abrir: abrirSesionEscaneo,
    novedades: novedadesEscaneo,
    cerrar: cerrarSesionEscaneo,
  },
  publico: {
    abrir: abrirSesionEscaneoAnonima,
    novedades: novedadesEscaneoAnonimo,
    cerrar: cerrarSesionEscaneoAnonima,
  },
} as const;

const claves = (modo: ModoPanel) => ({
  token: modo === "publico" ? "escaneo.publico.token" : "escaneo.token",
  ultimo: modo === "publico" ? "escaneo.publico.ultimo" : "escaneo.ultimo",
});

/** `sessionStorage` lanza en ventanas privadas de algunos navegadores. */
const recordar = (clave: string, valor: string | null) => {
  try {
    if (valor === null) sessionStorage.removeItem(clave);
    else sessionStorage.setItem(clave, valor);
  } catch {
    /* sin memoria: el vínculo dura lo que dure el panel, y ya está */
  }
};
const recordado = (clave: string) => {
  try {
    return sessionStorage.getItem(clave);
  } catch {
    return null;
  }
};

export default function PanelEscaneoRemoto({
  onCodigo,
  onEscribirAMano,
  onCerrar,
  modo = "sesion",
}: {
  /** Un código que ha leído el móvil. Puede llamarse varias veces. */
  onCodigo: (codigo: string) => void;
  /** El móvil ha pedido teclearlo aquí. */
  onEscribirAMano: () => void;
  onCerrar: () => void;
  /** `publico` en el comparador, que no tiene sesión. */
  modo?: ModoPanel;
}) {
  const acciones = ACCIONES[modo];
  const { token: CLAVE_TOKEN, ultimo: CLAVE_ULTIMO } = claves(modo);

  const [token, setToken] = useState<string | null>(null);
  const [vinculada, setVinculada] = useState(false);
  const [verQR, setVerQR] = useState(true);
  const [fallo, setFallo] = useState<string | null>(null);
  const [recibidos, setRecibidos] = useState(0);
  const ultimo = useRef(0);
  const vivo = useRef(true);
  // En una referencia para que un render del padre no reinicie el sondeo.
  const avisar = useRef({ onCodigo, onEscribirAMano });
  avisar.current = { onCodigo, onEscribirAMano };

  const olvidar = useCallback(() => {
    recordar(CLAVE_TOKEN, null);
    recordar(CLAVE_ULTIMO, null);
  }, [CLAVE_TOKEN, CLAVE_ULTIMO]);

  // --- abrir el vínculo, o retomar el que hubiera ---------------------------
  useEffect(() => {
    vivo.current = true;

    const guardado = recordado(CLAVE_TOKEN);
    if (guardado) {
      ultimo.current = Number(recordado(CLAVE_ULTIMO) ?? 0) || 0;
      setToken(guardado);
      // Ya vinculado antes: no hace falta volver a enseñar el QR.
      setVerQR(false);
      setVinculada(true);
      return;
    }

    acciones
      .abrir()
      .then((s) => {
        if (!vivo.current) return;
        ultimo.current = 0;
        recordar(CLAVE_TOKEN, s.token);
        recordar(CLAVE_ULTIMO, "0");
        setToken(s.token);
      })
      .catch(() => vivo.current && setFallo("No se ha podido abrir el vínculo."));

    return () => {
      vivo.current = false;
    };
    // El modo no cambia con el panel montado: se fija al montarlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- sondear ---------------------------------------------------------------
  useEffect(() => {
    if (!token) return;
    vivo.current = true;

    const mirar = async () => {
      let n;
      try {
        n = await acciones.novedades(token, ultimo.current);
      } catch {
        return; // un fallo suelto de red no tira el vínculo
      }
      if (!vivo.current) return;

      if (n.ultimo !== ultimo.current) {
        ultimo.current = n.ultimo;
        recordar(CLAVE_ULTIMO, String(n.ultimo));
      }
      if (n.vinculada) {
        setVinculada(true);
        setVerQR(false);
      }
      if (n.codigos.length) {
        setRecibidos((x) => x + n.codigos.length);
        for (const c of n.codigos) avisar.current.onCodigo(c);
      }
      if (n.escribirAMano) {
        olvidar();
        avisar.current.onEscribirAMano();
        return;
      }
      if (n.terminada) {
        olvidar();
        setFallo("El vínculo se ha terminado desde el móvil.");
        setToken(null);
      }
    };

    void mirar();
    const t = setInterval(() => void mirar(), 2000);
    return () => {
      vivo.current = false;
      clearInterval(t);
    };
    // `acciones` y las claves salen de `modo`, que es fijo mientras vive el panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, olvidar]);

  function terminar() {
    if (token) void acciones.cerrar(token);
    olvidar();
    onCerrar();
  }

  const url = token && typeof window !== "undefined" ? `${window.location.origin}/escanear/${token}` : null;

  return (
    <div className="panel-remoto">
      <div className="cabeza">
        <strong>Escanear con otro dispositivo</strong>
        <button type="button" className="peligro cancelar" onClick={terminar}>
          Terminar
        </button>
      </div>

      {fallo && <p className="aviso">{fallo}</p>}

      {!token && !fallo && <p className="tenue">Abriendo el vínculo…</p>}

      {url && verQR && (
        <>
          <p className="tenue">
            Apunta con la cámara del móvil a este código. Se abrirá una página
            que solo sirve para leer códigos de barras: no hace falta iniciar
            sesión ni instalar nada.
          </p>
          <div className="cuadro-qr">
            <CodigoQR texto={url} tamano={200} />
          </div>
          <p className="tenue enlace-corto">
            O escribe en el móvil: <span className="cifra">{url.replace(/^https?:\/\//, "")}</span>
          </p>
        </>
      )}

      {url && !verQR && (
        <p className="vinculado">
          <span className="punto" aria-hidden />
          <span>
            {vinculada ? "Móvil conectado." : "Vínculo abierto."} Escanea allí y los
            productos aparecerán aquí.
          </span>
        </p>
      )}

      {recibidos > 0 && (
        <p className="tenue" style={{ margin: 0, fontSize: 13 }}>
          {recibidos === 1 ? "Ha llegado 1 código." : `Han llegado ${recibidos} códigos.`}
        </p>
      )}

      {url && !verQR && (
        <button type="button" className="enlace" onClick={() => setVerQR(true)}>
          Ver otra vez el código QR
        </button>
      )}

      <p className="tenue caduca">El enlace vale quince minutos.</p>
    </div>
  );
}
