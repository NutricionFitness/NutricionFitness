import { redirect } from "next/navigation";

import CatalogoPublico from "@/components/CatalogoPublico";
import FormularioContrasena from "@/components/FormularioContrasena";
import { clienteServidor, usuarioActual } from "@/lib/supabase/servidor";

export const dynamic = "force-dynamic";

export default async function Cuenta() {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/login");

  // Si falta la migración 0011 la consulta falla y se lee como «apagado», que
  // es lo correcto: sin tabla no hay nada publicado.
  const supabase = await clienteServidor();
  const { data: cuenta } = await supabase
    .from("cuentas")
    .select("catalogo_publico")
    .eq("owner_id", usuario.id)
    .maybeSingle();

  return (
    <div style={{ maxWidth: 460 }}>
      <h1>Tu cuenta</h1>
      <p className="sub">{usuario.email}</p>
      <FormularioContrasena />
      <hr />
      <CatalogoPublico
        inicial={Boolean((cuenta as { catalogo_publico?: boolean } | null)?.catalogo_publico)}
      />
    </div>
  );
}
