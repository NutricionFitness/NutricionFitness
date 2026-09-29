import { cookies } from "next/headers";

import { clienteServidor } from "@/lib/supabase/servidor";

/**
 * Quién puede usar el comparador (migración 0023).
 *
 * Dos maneras de pasar:
 *
 *   · Con sesión: quien ha entrado en la app con su usuario y su contraseña.
 *   · Con un correo: el de alguna persona activa de `personas`. Se pide una vez
 *     y se guarda en una cookie `httpOnly`.
 *
 * La cookie guarda **el correo tal cual**, sin firmar, y es a propósito: el
 * correo es la clave, así que firmarlo no protegería nada que no proteja ya
 * teclearlo en el formulario. Lo que sí importa es que se vuelve a preguntar a
 * la base **cada vez**: si a la persona se le quita el correo o se desactiva,
 * pierde el acceso en la siguiente petición, sin esperar a que caduque nada.
 *
 * Se mira en la página y en cada acción de servidor del comparador, no en el
 * middleware: las acciones se pueden llamar sin pasar por la página, y el
 * middleware no sabe de ellas más que la ruta.
 */

export const GALLETA_COMPARADOR = "acceso_comparador";

/** Lo que dura la cookie. Se revalida en cada petición, así que puede ser larga. */
export const DIAS_GALLETA = 90;

export type AccesoComparador = { via: "sesion" } | { via: "correo"; correo: string };

export async function accesoComparador(): Promise<AccesoComparador | null> {
  const supabase = await clienteServidor();

  // La sesión primero: sin cookie de Supabase, `getUser` contesta sin salir a
  // la red, así que para quien entra con correo no cuesta nada.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return { via: "sesion" };

  const correo = (await cookies()).get(GALLETA_COMPARADOR)?.value;
  if (!correo) return null;

  // Un error —la 0023 sin aplicar, la base caída— es un «no»: la puerta se
  // queda cerrada, no abierta.
  const { data, error } = await supabase.rpc("correo_con_acceso_comparador", { correo });
  return !error && data === true ? { via: "correo", correo } : null;
}

/** Para las acciones: lanza si no hay acceso. */
export async function exigirAccesoComparador(): Promise<AccesoComparador> {
  const acceso = await accesoComparador();
  if (!acceso) throw new Error("Sin acceso al comparador.");
  return acceso;
}
