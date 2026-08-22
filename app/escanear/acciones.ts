"use server";

import { randomBytes } from "node:crypto";

import { clienteServidor } from "@/lib/supabase/servidor";

/**
 * El lado del ordenador del escaneo con otro dispositivo.
 *
 * El móvil no pasa por aquí: entra por las funciones de la migración 0009, que
 * son lo único que puede tocar alguien sin sesión iniciada.
 */

/** Cuánto vale un enlace. Lo justo para ir a por el móvil y escanear un rato. */
const MINUTOS = 15;

export interface SesionEscaneo {
  token: string;
  expira_en: string;
}

/**
 * Abre un vínculo y devuelve el vale que va dentro del QR.
 *
 * El token se genera aquí y no en la base para no depender de que `pgcrypto`
 * esté instalada y en la ruta de búsqueda, que en Supabase vive en otro
 * esquema. 18 bytes del generador criptográfico del sistema son 144 bits.
 */
export async function abrirSesionEscaneo(): Promise<SesionEscaneo> {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Hay que iniciar sesión.");

  // De paso, la limpieza. Son las sesiones propias —el RLS no deja otras— y
  // así la tabla no crece sola sin que nadie la mire.
  await supabase.from("sesiones_escaneo").delete().lt("expira_en", new Date().toISOString());

  const token = randomBytes(18).toString("hex");
  const expira_en = new Date(Date.now() + MINUTOS * 60_000).toISOString();

  const { error } = await supabase
    .from("sesiones_escaneo")
    .insert({ token, owner_id: user.id, expira_en });
  if (error) throw new Error(error.message);

  return { token, expira_en };
}

export interface NovedadesEscaneo {
  /** Los códigos nuevos, en el orden en que los leyó el móvil. */
  codigos: string[];
  /** El último identificador visto, para pedir a partir de ahí la próxima vez. */
  ultimo: number;
  /** ¿Ha abierto ya el móvil el enlace? */
  vinculada: boolean;
  /** El móvil ha pedido que el código se escriba aquí. */
  escribirAMano: boolean;
  /** La sesión ya no vale: caducada, cerrada o borrada. */
  terminada: boolean;
}

/**
 * Qué hay de nuevo desde la última vez.
 *
 * Se consulta cada dos segundos en vez de escuchar en tiempo real. Es una
 * decisión: el tiempo real de Supabase habría que configurarlo y probarlo
 * contra el proyecto de verdad, y esto son dos consultas diminutas cada dos
 * segundos durante los pocos minutos que dura un vínculo. Si algún día se
 * quiere instantáneo, se cambia solo esta función.
 */
export async function novedadesEscaneo(
  token: string,
  desde: number,
): Promise<NovedadesEscaneo> {
  const supabase = await clienteServidor();

  const [{ data: sesion }, { data: filas }] = await Promise.all([
    supabase
      .from("sesiones_escaneo")
      .select("vinculada_en, cerrada, peticion, expira_en")
      .eq("token", token)
      .maybeSingle(),
    supabase
      .from("escaneos")
      .select("id, codigo")
      .eq("token", token)
      .gt("id", desde)
      .order("id")
      .limit(50),
  ]);

  // Sin fila no hay sesión: o ha caducado y la ha limpiado alguien, o no es
  // tuya. En los dos casos, para el ordenador es lo mismo.
  if (!sesion)
    return { codigos: [], ultimo: desde, vinculada: false, escribirAMano: false, terminada: true };

  const nuevos = (filas ?? []) as { id: number; codigo: string }[];

  return {
    codigos: nuevos.map((f) => f.codigo),
    ultimo: nuevos.length ? Number(nuevos[nuevos.length - 1].id) : desde,
    vinculada: Boolean(sesion.vinculada_en),
    escribirAMano: sesion.peticion === "escribir_a_mano",
    terminada: Boolean(sesion.cerrada) || new Date(sesion.expira_en as string) < new Date(),
  };
}

/** El ordenador termina. Se borra la sesión y con ella su cola. */
export async function cerrarSesionEscaneo(token: string) {
  const supabase = await clienteServidor();
  await supabase.from("sesiones_escaneo").delete().eq("token", token);
}
