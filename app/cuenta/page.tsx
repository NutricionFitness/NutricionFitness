import { redirect } from "next/navigation";

import FormularioContrasena from "@/components/FormularioContrasena";
import { usuarioActual } from "@/lib/supabase/servidor";

export const dynamic = "force-dynamic";

export default async function Cuenta() {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/login");

  return (
    <div style={{ maxWidth: 460 }}>
      <h1>Tu cuenta</h1>
      <p className="sub">{usuario.email}</p>
      <FormularioContrasena />
    </div>
  );
}
