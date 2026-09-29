"use server";

import { randomBytes } from "node:crypto";

import { exigirAccesoComparador } from "@/lib/acceso-comparador";
import { clienteServidor } from "@/lib/supabase/servidor";

/**
 * El lado del ordenador del escaneo con otro dispositivo.
 *
 * El móvil no pasa por aquí: entra por las funciones de la migración 0009, que
 * son lo único que puede tocar alguien sin sesión iniciada.
 *
 * Hay dos juegos de tres acciones, y hacen lo mismo:
 *
 *   · `abrirSesionEscaneo` / `novedadesEscaneo` / `cerrarSesionEscaneo` — con
 *     sesión, contra las tablas y bajo el RLS de la 0009. Es lo de siempre.
 *   · Las mismas con `Anonima`/`Anonimo` — sin sesión, para el comparador
 *     público, contra las tres funciones `security definer` de la 0022. La
 *     sesión que abren no es de nadie y solo se llega a ella con el token.
 *
 * Son dos juegos y no uno que mire si hay usuario a propósito: mirarlo cuesta
 * una consulta a Auth en cada sondeo —cada dos segundos—, y sobre todo, el
 * comparador no tiene por qué tocar una tabla ni aunque quien lo abra haya
 * entrado. Quien monta el panel sabe en qué página está y elige.
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
      // De uno en uno a propósito. `desde` avanza en cuanto se recoge un
      // código, así que recoger cincuenta de golpe y que el ordenador se
      // desmonte a mitad —dentro de una dieta pasa: la tarjeta de revisión
      // ocupa el sitio del panel— dejaría los demás dados por consumidos y
      // perdidos. Uno cada dos segundos sobra para lo que se tarda en
      // confirmar un producto.
      .limit(1),
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

// ------------------------------------------------------------- sin sesión --

/**
 * Abre un vínculo sin dueño. Mismo token —144 bits del sistema—, misma
 * caducidad; lo que cambia es que lo guarda la función de la 0022 en vez de
 * un `insert` que `anon` no puede hacer.
 *
 * Solo abrirlo exige acceso al comparador (0023). Sondear y cerrar van por el
 * token, que ya solo tiene quien lo ha abierto, y mirarlo cada dos segundos
 * sería una consulta más en cada sondeo sin cerrar nada que no esté cerrado.
 */
export async function abrirSesionEscaneoAnonima(): Promise<SesionEscaneo> {
  await exigirAccesoComparador();
  const supabase = await clienteServidor();
  const token = randomBytes(18).toString("hex");

  const { data, error } = await supabase.rpc("abrir_escaneo_anonimo", { p_token: token });
  if (error || !data) throw new Error(error?.message ?? "No se ha podido abrir el vínculo.");

  return { token, expira_en: String(data) };
}

/** Lo que devuelve `novedades_escaneo_anonimo`. */
type NovedadesAnonimas = {
  existe: boolean;
  vinculada?: boolean;
  escribir_a_mano?: boolean;
  terminada?: boolean;
  codigo?: { id: number; codigo: string } | null;
};

/**
 * Qué hay de nuevo en una sesión sin dueño. La misma forma de respuesta que
 * `novedadesEscaneo`, para que el panel no distinga.
 */
export async function novedadesEscaneoAnonimo(
  token: string,
  desde: number,
): Promise<NovedadesEscaneo> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("novedades_escaneo_anonimo", {
    p_token: token,
    p_desde: desde,
  });
  const n = data as NovedadesAnonimas | null;

  if (error || !n || !n.existe)
    return { codigos: [], ultimo: desde, vinculada: false, escribirAMano: false, terminada: true };

  return {
    codigos: n.codigo ? [n.codigo.codigo] : [],
    ultimo: n.codigo ? Number(n.codigo.id) : desde,
    vinculada: Boolean(n.vinculada),
    escribirAMano: Boolean(n.escribir_a_mano),
    terminada: Boolean(n.terminada),
  };
}

/** El ordenador sin sesión termina. Solo borra sesiones sin dueño. */
export async function cerrarSesionEscaneoAnonima(token: string) {
  const supabase = await clienteServidor();
  await supabase.rpc("cerrar_escaneo_anonimo", { p_token: token });
}
