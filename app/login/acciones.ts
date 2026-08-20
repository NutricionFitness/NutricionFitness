"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { clienteServidor } from "@/lib/supabase/servidor";
import type { EstadoFormulario } from "./tipos";

/**
 * Entrar con correo y contraseña.
 *
 * Va en una acción de servidor y no en el navegador para que la cookie de sesión
 * la escriba el servidor: así la primera página ya se renderiza con la sesión
 * puesta, sin el parpadeo de entrar y que la pantalla siga vacía un instante.
 */
export async function entrar(
  _estado: EstadoFormulario,
  datos: FormData,
): Promise<EstadoFormulario> {
  const correo = String(datos.get("correo") ?? "").trim();
  const contrasena = String(datos.get("contrasena") ?? "");
  const siguiente = String(datos.get("siguiente") ?? "/personas");

  if (!correo || !contrasena) return { error: "Faltan el correo o la contraseña." };

  const supabase = await clienteServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: correo,
    password: contrasena,
  });

  if (error) {
    // Mensaje genérico a propósito: distinguir «no existe ese usuario» de
    // «la contraseña no es esa» le dice a un desconocido qué correos están dados
    // de alta.
    return { error: "Correo o contraseña incorrectos." };
  }

  revalidatePath("/", "layout");
  redirect(siguiente.startsWith("/") ? siguiente : "/personas");
}

export async function salir() {
  const supabase = await clienteServidor();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/** Enlace de recuperación. Es el único momento en que hace falta el correo. */
export async function pedirRestablecer(
  _estado: EstadoFormulario,
  datos: FormData,
): Promise<EstadoFormulario> {
  const correo = String(datos.get("correo") ?? "").trim();
  if (!correo) return { error: "Escribe tu correo." };

  const supabase = await clienteServidor();
  const origen = String(datos.get("origen") ?? "");
  const { error } = await supabase.auth.resetPasswordForEmail(correo, {
    redirectTo: `${origen}/auth/callback?siguiente=/cuenta`,
  });
  if (error) return { error: error.message };
  return { ok: "Te hemos enviado un enlace para elegir una contraseña nueva." };
}

export async function cambiarContrasena(
  _estado: EstadoFormulario,
  datos: FormData,
): Promise<EstadoFormulario> {
  const nueva = String(datos.get("nueva") ?? "");
  const repetida = String(datos.get("repetida") ?? "");

  if (nueva.length < 8) return { error: "La contraseña necesita al menos 8 caracteres." };
  if (nueva !== repetida) return { error: "Las dos contraseñas no coinciden." };

  const supabase = await clienteServidor();
  const { error } = await supabase.auth.updateUser({ password: nueva });
  if (error) return { error: error.message };
  return { ok: "Contraseña actualizada." };
}
