import { NextResponse, type NextRequest } from "next/server";

import { clienteServidor } from "@/lib/supabase/servidor";

/** Cierra el ciclo del enlace mágico: cambia el código por una sesión. */
export async function GET(peticion: NextRequest) {
  const { searchParams, origin } = new URL(peticion.url);
  const codigo = searchParams.get("code");
  const siguiente = searchParams.get("siguiente") ?? "/personas";

  if (codigo) {
    const supabase = await clienteServidor();
    const { error } = await supabase.auth.exchangeCodeForSession(codigo);
    if (!error) return NextResponse.redirect(`${origin}${siguiente}`);
  }
  return NextResponse.redirect(`${origin}/login?error=1`);
}
