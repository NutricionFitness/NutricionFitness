import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente de Supabase para componentes de servidor, acciones y route handlers.
 *
 * Usa la clave pública (anon). Toda la protección viene del RLS del esquema, no
 * de esconder la clave: por eso las políticas se probaron una a una contra un
 * PostgreSQL real antes de escribir esta línea.
 */
export async function clienteServidor() {
  const almacen = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => almacen.getAll(),
        setAll: (galletas: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            galletas.forEach(({ name, value, options }) =>
              almacen.set(name, value, options),
            );
          } catch {
            // En un componente de servidor no se pueden escribir cookies.
            // El middleware ya refresca la sesión, así que se puede ignorar.
          }
        },
      },
    },
  );
}

/** El usuario de la sesión, o null. */
export async function usuarioActual() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
