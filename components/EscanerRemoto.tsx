"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { clienteNavegador } from "@/lib/supabase/cliente";
import { useCamaraCodigos } from "./useCamaraCodigos";

/**
 * La pantalla del móvil cuando llega por el QR.
 *
 * El móvil hace **solo de cámara**. Lee el código, lo manda y sigue leyendo; lo
 * que se ve, se comprueba y se guarda pasa entero en el otro dispositivo, que
 * es donde está la persona sentada. Por eso aquí no hay ficha del producto, ni
 * botón de guardar, ni campo para teclear nada: sería pedirle que trabaje en la
 * pantalla pequeña habiendo una grande delante.
 *
 * Esta página funciona **sin sesión iniciada**. Lo único que puede hacer es
 * llamar a las tres funciones de la migración 0009, que comprueban el vale y no
 * devuelven ningún dato. Es lo que permite que abrir el QR con la cámara del
 * móvil sea todo el trámite.
 */

type Fase =
  | { nombre: "comprobando" }
  | { nombre: "leyendo" }
  | { nombre: "a_mano" }
  | { nombre: "fin"; texto: string };

/** Lo que puede responder `estado_escaneo`, traducido a algo que se entienda. */
const PORQUE: Record<string, string> = {
  no_existe: "Este enlace no vale. Vuelve a pedir el código QR en el ordenador.",
  caducada: "El enlace ha caducado. Vuelve a pedir el código QR en el ordenador.",
  cerrada: "El escaneo se ha terminado desde el ordenador.",
};

export default function EscanerRemoto({ token }: { token: string }) {
  const [fase, setFase] = useState<Fase>({ nombre: "comprobando" });
  const [enviados, setEnviados] = useState<string[]>([]);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const activa = useRef(true);

  const terminar = useCallback((texto: string) => {
    activa.current = false;
    setFase({ nombre: "fin", texto });
  }, []);

  // --- comprobar el vale al llegar, y de vez en cuando después -------------
  useEffect(() => {
    activa.current = true;
    const supabase = clienteNavegador();

    const mirar = async (marcar: boolean) => {
      const { data, error } = await supabase.rpc("estado_escaneo", {
        p_token: token,
        p_marcar: marcar,
      });
      if (!activa.current) return;
      if (error) {
        setAviso("No hay conexión con el servidor.");
        return;
      }
      setAviso(null);
      if (data === "ok") setFase((f) => (f.nombre === "comprobando" ? { nombre: "leyendo" } : f));
      else terminar(PORQUE[String(data)] ?? "Este enlace ya no vale.");
    };

    void mirar(true);
    // Cada cinco segundos: es lo que tarda en notarse que el ordenador ha
    // cerrado. Más a menudo no aporta y gasta batería.
    const t = setInterval(() => void mirar(false), 5000);
    return () => {
      activa.current = false;
      clearInterval(t);
    };
  }, [token, terminar]);

  // --- mandar cada código que se lee ---------------------------------------
  const mandar = useCallback(
    async (codigo: string) => {
      const supabase = clienteNavegador();
      const { data, error } = await supabase.rpc("enviar_escaneo", {
        p_token: token,
        p_codigo: codigo,
      });
      if (!activa.current) return;

      if (error) {
        setAviso("No se ha podido mandar. Comprueba la conexión.");
        return;
      }
      if (data !== "ok") {
        terminar(PORQUE[String(data)] ?? "Este enlace ya no vale.");
        return;
      }

      setAviso(null);
      setUltimo(codigo);
      setEnviados((antes) => (antes.includes(codigo) ? antes : [...antes, codigo]));
      // Un toque corto: con el móvil en la mano y mirando el envase, no se está
      // mirando la pantalla. Es la única señal que llega sin mirar.
      navigator.vibrate?.(60);
    },
    [token, terminar],
  );

  const camara = useCamaraCodigos({ activa: fase.nombre === "leyendo", onCodigo: mandar });

  async function pedirEscribirAMano() {
    activa.current = false;
    const supabase = clienteNavegador();
    await supabase.rpc("pedir_escribir_a_mano", { p_token: token });
    setFase({ nombre: "a_mano" });
  }

  // ------------------------------------------------------------- terminado --
  if (fase.nombre === "a_mano" || fase.nombre === "fin")
    return (
      <div className="remoto acabado">
        <div className="cartel">
          <p className="grande">
            {fase.nombre === "a_mano"
              ? "Sigue en el otro dispositivo"
              : "Se ha terminado el escaneo"}
          </p>
          <p className="tenue">
            {fase.nombre === "a_mano"
              ? "La cámara ya está apagada. El código se escribe a mano allí, en la pantalla grande."
              : fase.texto}
          </p>
          {enviados.length > 0 && (
            <p className="tenue">
              {enviados.length === 1
                ? "Se mandó 1 código."
                : `Se mandaron ${enviados.length} códigos.`}
            </p>
          )}
          <p className="tenue">Ya puedes cerrar esta pestaña.</p>
        </div>
      </div>
    );

  // -------------------------------------------------------------- leyendo --
  return (
    <div className="remoto">
      <div className="visor">
        <video ref={camara.video} playsInline muted autoPlay aria-label="Vista de la cámara" />
        <div className="mirilla" aria-hidden />
        {(fase.nombre === "comprobando" || camara.estado === "arrancando") && (
          <p className="capa">
            {fase.nombre === "comprobando" ? "Comprobando el enlace…" : "Abriendo la cámara…"}
          </p>
        )}
        {camara.fallo && (
          <div className="capa">
            <p>{camara.fallo}</p>
            <p className="tenue">Escribe el código en el otro dispositivo.</p>
          </div>
        )}
      </div>

      <div className="pie">
        {/* Lo que se acaba de mandar, bien grande. Es la confirmación de que la
            lectura ha salido, sin tener que mirar el ordenador. */}
        {ultimo ? (
          <p className="enviado">
            <strong>Enviado</strong>
            <span className="cifra">{ultimo}</span>
            <span className="tenue">Confírmalo en el otro dispositivo</span>
          </p>
        ) : (
          <p className="tenue instruccion">
            Apunta al código de barras. Lo que leas aparecerá en el otro dispositivo.
          </p>
        )}

        {enviados.length > 1 && (
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>
            Van {enviados.length} códigos. Puedes seguir escaneando.
          </p>
        )}

        {aviso && <p className="aviso">{aviso}</p>}

        {camara.linterna !== null && (
          <button type="button" onClick={camara.alternarLinterna}>
            {camara.linterna ? "Apagar la luz" : "Encender la luz"}
          </button>
        )}

        {/* En el móvil esto NO abre un campo: cierra el móvil y le dice al
            ordenador que lo abra allí. Teclear trece dígitos donde ya estás
            sentado es más fácil que en el teléfono. */}
        <button type="button" className="azul grande" onClick={pedirEscribirAMano}>
          Cerrar cámara y escribirlo en el otro dispositivo
        </button>

        <button
          type="button"
          className="peligro grande"
          onClick={() => terminar("Has terminado desde el móvil.")}
        >
          Terminar
        </button>
      </div>
    </div>
  );
}
