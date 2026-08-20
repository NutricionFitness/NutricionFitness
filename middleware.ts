import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresca la sesión en cada petición y cierra el paso a quien no ha entrado.
 *
 * Va aquí y no en cada página porque olvidarse en una sola página es todo lo que
 * hace falta para dejar un agujero.
 */
const PUBLICAS = ["/login", "/auth"];

export async function middleware(peticion: NextRequest) {
  let respuesta = NextResponse.next({ request: peticion });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => peticion.cookies.getAll(),
        setAll: (galletas: { name: string; value: string; options: CookieOptions }[]) => {
          galletas.forEach(({ name, value }) => peticion.cookies.set(name, value));
          respuesta = NextResponse.next({ request: peticion });
          galletas.forEach(({ name, value, options }) =>
            respuesta.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ruta = peticion.nextUrl.pathname;
  const esPublica = PUBLICAS.some((p) => ruta.startsWith(p));

  if (!user && !esPublica) {
    const destino = peticion.nextUrl.clone();
    destino.pathname = "/login";
    destino.searchParams.set("siguiente", ruta);
    return NextResponse.redirect(destino);
  }
  if (user && ruta === "/login") {
    const destino = peticion.nextUrl.clone();
    destino.pathname = "/personas";
    destino.search = "";
    return NextResponse.redirect(destino);
  }
  return respuesta;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
