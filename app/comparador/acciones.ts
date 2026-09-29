"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  filtrosDePreseleccion,
  rankearPorMacro,
  rankearSustitutos,
  type Candidato,
  type Direccion,
} from "@/lib/dominio/sustituir";
import { kcalAtwater, normalizarNombre } from "@/app/ingredientes/tipos";
import { consultarOpenFoodFacts } from "@/lib/openfoodfacts/consultar";
import { convertir } from "@/lib/openfoodfacts/convertir";
import { normalizarEan } from "@/lib/openfoodfacts/ean";
import type { EstadoFormulario } from "@/app/login/tipos";
import {
  accesoComparador,
  DIAS_GALLETA,
  exigirAccesoComparador,
  GALLETA_COMPARADOR,
} from "@/lib/acceso-comparador";
import { normalizarCorreo } from "@/lib/correo";
import { clienteServidor } from "@/lib/supabase/servidor";
import type {
  AlimentoPublico,
  Orden,
  PaginaSustitutos,
  ResultadoCodigoPublico,
} from "./tipos";

/**
 * Lo que el comparador público puede pedirle a la base.
 *
 * Tres llamadas y ninguna tabla: `buscar_alimentos_publico` y
 * `candidatos_publicos` son funciones `SECURITY DEFINER` de la migración 0011,
 * y `alimento_publico_por_codigo` de la 0021. Son la superficie completa de lo
 * que puede hacer alguien sin sesión. El porqué está escrito en esas
 * migraciones; aquí solo se llaman.
 *
 * El cálculo lo hace `lib/dominio/sustituir`, el mismo que dentro de una dieta.
 * No hay una segunda implementación «para la página pública»: si un día se
 * afina el filtro de los sustitutos, se afina en los dos sitios a la vez.
 *
 * Y los candidatos son los mismos que dentro de una dieta: **genéricos**. El
 * volcado de Open Food Facts se busca por nombre —`buscar_alimentos_publico`,
 * para compararse contra un producto concreto— pero no se propone como
 * sustituto: `candidatos_publicos` lo deja fuera desde la 0020, igual que
 * `buscarSustitutos` en `app/dietas/[id]/acciones.ts` con su
 * `neq("fuente", "openfoodfacts")`. El porqué está en esa migración.
 *
 * Desde la 0023, además, cada acción mira antes quién llama
 * (`lib/acceso-comparador`): sesión iniciada o el correo de una persona. Las
 * de buscar y puntuar contestan vacío en vez de lanzar, porque la pantalla las
 * llama al teclear y no espera un error; a ellas solo se llega sin acceso si
 * se lo han quitado a alguien con la página ya abierta.
 */

// ----------------------------------------------------------------- la puerta

/**
 * Entrar con un correo.
 *
 * El mensaje de error sí dice «ese correo no tiene acceso», al contrario que el
 * de `entrar` en el login: aquí el correo es la clave entera y no hay una
 * contraseña que proteger no diciéndolo, y un «algo ha fallado» solo haría que
 * quien se ha equivocado de correo no lo supiera.
 */
export async function entrarComparador(
  _estado: EstadoFormulario,
  datos: FormData,
): Promise<EstadoFormulario> {
  const bruto = String(datos.get("correo") ?? "");
  if (!bruto.trim()) return { error: "Escribe tu correo." };
  const correo = normalizarCorreo(bruto);
  if (!correo) return { error: "Eso no parece un correo." };

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("correo_con_acceso_comparador", { correo });
  if (error) return { error: "No se ha podido comprobar el correo. Vuelve a probar en un momento." };
  if (data !== true)
    return {
      error:
        "Ese correo no tiene acceso al comparador. Si crees que debería, " +
        "pídele a tu entrenador que lo añada a tu ficha.",
    };

  (await cookies()).set(GALLETA_COMPARADOR, correo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DIAS_GALLETA * 24 * 60 * 60,
  });
  redirect("/comparador");
}

/** Olvidar el correo de este navegador. La sesión de la app, si la hay, no se toca. */
export async function salirComparador() {
  (await cookies()).delete(GALLETA_COMPARADOR);
  redirect("/comparador");
}

type FilaBusqueda = {
  id: number; nombre: string; grupo: string | null; estado: string | null;
  prot_100: unknown; hc_100: unknown; grasa_100: unknown;
  fibra_100: unknown; alcohol_100: unknown; kcal_100: unknown;
  kcal_ref: unknown; porcion_comestible: unknown; codigo_bedca: string | null;
};

/** Los `numeric` de PostgreSQL llegan como cadena. */
const num = (v: unknown): number => Number(v ?? 0);
const numOpt = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

function aAlimento(f: FilaBusqueda): AlimentoPublico {
  return {
    id: Number(f.id),
    nombre: f.nombre,
    grupo: f.grupo,
    estado: f.estado ?? "desconocido",
    prot: num(f.prot_100),
    hc: num(f.hc_100),
    grasa: num(f.grasa_100),
    fibra: num(f.fibra_100),
    alcohol: num(f.alcohol_100),
    kcal100: num(f.kcal_100),
    kcalRef: numOpt(f.kcal_ref),
    porcionComestible: numOpt(f.porcion_comestible),
    codigoBedca: f.codigo_bedca,
  };
}

/**
 * Busca alimentos por nombre.
 *
 * El texto se normaliza aquí —minúsculas y sin tildes— con la **misma** función
 * que escribe la columna `nombre_norm`. Si se normalizara de otra manera,
 * «platano» dejaría de encontrar «Plátano» sin que nada diera error.
 */
export async function buscarAlimentos(texto: string): Promise<AlimentoPublico[]> {
  const q = normalizarNombre(texto ?? "").trim();
  if (q.length < 2) return [];
  if (!(await accesoComparador())) return [];

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("buscar_alimentos_publico", {
    texto: q,
    limite: 20,
  });
  if (error || !data) return [];
  return (data as FilaBusqueda[]).map(aAlimento);
}

/**
 * Busca un alimento por su código de barras.
 *
 * Primero en el catálogo público —el volcado de Open Food Facts y lo propio
 * publicado ya llevan el código— y solo si no está, en Open Food Facts en
 * vivo. Es el mismo orden que el alta con sesión (`app/ingredientes/escanear`)
 * y por el mismo motivo: lo que ya está en la base no tiene por qué salir a
 * internet.
 *
 * Lo que llega en vivo **no se guarda**: aquí no hay sesión ni catálogo donde
 * guardarlo. Se convierte con el mismo conversor que el alta, se enseña con
 * sus avisos, y en cuanto se cambia de alimento desaparece. Por eso lleva
 * `id: 0`: no es una fila de la base y ningún candidato puede coincidir con él.
 *
 * Y los sustitutos no cambian: `sustitutosPublicos` puntúa contra
 * `candidatos_publicos`, que solo devuelve genéricos (0020). Escanear un
 * producto de marca enseña su ficha; lo que se propone para cambiarlo sigue
 * saliendo de BEDCA y de lo propio publicado.
 */
export async function alimentoPorCodigo(bruto: string): Promise<ResultadoCodigoPublico> {
  const ean = normalizarEan(bruto ?? "");
  if (!ean) return { estado: "codigo_invalido" };
  // Lanza: la pantalla ya trata un fallo de la acción como «no se ha podido
  // buscar», que es lo que hay que decir.
  await exigirAccesoComparador();

  // ------------------------------------------- 1. ¿está en el catálogo público?
  const supabase = await clienteServidor();
  const { data } = await supabase.rpc("alimento_publico_por_codigo", {
    codigos: ean.consultas,
  });
  // Un error aquí —la 0021 sin aplicar, la base caída— no es motivo para no
  // contestar: se pregunta fuera, que es lo que se haría con un código nuevo.
  const fila = (data as Array<FilaBusqueda & { codigo_barras: string; fuente: string }> | null)?.[0];
  if (fila)
    return {
      estado: "encontrado",
      alimento: aAlimento(fila),
      escaneo: {
        codigo: ean.codigo,
        origen: fila.fuente === "openfoodfacts" ? "volcado" : "propio",
        avisos: [],
      },
    };

  // ------------------------------------------------- 2. preguntar fuera
  const r = await consultarOpenFoodFacts(ean.consultas);
  if (r.estado === "sin_respuesta")
    return { estado: "sin_respuesta", codigo: ean.codigo, motivo: r.motivo };
  if (r.estado === "no_encontrado") return { estado: "no_encontrado", codigo: ean.codigo };

  const p = convertir(r.producto, ean.codigo);
  return {
    estado: "encontrado",
    alimento: {
      id: 0,
      nombre: p.nombre || `Producto ${ean.codigo}`,
      grupo: p.grupo,
      estado: p.estado,
      prot: p.prot_100,
      hc: p.hc_100,
      grasa: p.grasa_100,
      fibra: p.fibra_100,
      alcohol: p.alcohol_100,
      // La misma fórmula que la columna generada de la base: si se guardara,
      // saldría este número.
      kcal100: kcalAtwater(p),
      kcalRef: p.kcal_ref,
      porcionComestible: null,
      codigoBedca: null,
    },
    escaneo: { codigo: ean.codigo, origen: "en_vivo", avisos: p.avisos },
  };
}

const DIRECCIONES: Record<Exclude<Orden, "parecido">, Direccion> = {
  mas_prot: { macro: "prot", sentido: "mas" },
  menos_prot: { macro: "prot", sentido: "menos" },
  mas_hc: { macro: "hc", sentido: "mas" },
  menos_hc: { macro: "hc", sentido: "menos" },
  mas_grasa: { macro: "grasa", sentido: "mas" },
  menos_grasa: { macro: "grasa", sentido: "menos" },
};

/**
 * Los sustitutos de un alimento, de diez en diez.
 *
 * Se puntúa el catálogo entero y se devuelve la página pedida. Puntuar mil
 * candidatos son unos milisegundos, así que no compensa guardar nada entre
 * llamadas: «buscar más» vuelve a puntuar y corta más abajo, y así el resultado
 * no depende de un estado que puede haber caducado.
 */
export async function sustitutosPublicos(datos: {
  alimento: AlimentoPublico;
  gramos: number;
  soloMismoGrupo: boolean;
  orden: Orden;
  /** Cuántos saltarse: 0 para los diez primeros, 10 para los siguientes. */
  desde?: number;
}): Promise<PaginaSustitutos> {
  const vacio: PaginaSustitutos = { sustitutos: [], total: 0, mirados: 0 };
  if (!(datos.gramos > 0) || !(datos.alimento.kcal100 > 0)) return vacio;
  if (!(await accesoComparador())) return vacio;

  const yo: Candidato = {
    id: datos.alimento.id,
    nombre: datos.alimento.nombre,
    grupo: datos.alimento.grupo,
    estado: datos.alimento.estado,
    prot: datos.alimento.prot,
    hc: datos.alimento.hc,
    grasa: datos.alimento.grasa,
    kcal100: datos.alimento.kcal100,
  };

  // La banda de cantidad se aprieta a la mitad y el doble, en vez del cuarto y
  // el cuádruple que usa el panel de dentro de una dieta. Ahí la pregunta es
  // «no tengo esto, ¿qué pongo?» y una cantidad rara puede valer; aquí la
  // pregunta es «¿por qué lo cambio?», y la respuesta tiene que ser una ración
  // parecida. Medido contra el catálogo: con la banda ancha, «arroz con más
  // proteína» contestaba **297 g de ajo**; con ésta, sémola y cereales, y «pan
  // con más proteína» contesta guisante, judías y lentejas.
  const opciones = { limite: 500, minRelativo: 0.5, maxRelativo: 2 };
  const direccion = datos.orden === "parecido" ? undefined : DIRECCIONES[datos.orden];

  const supabase = await clienteServidor();
  // Desde el volcado de Open Food Facts el catálogo público son 150.000 filas y
  // no 1.090: traérselo entero para puntuarlo aquí son megabytes por consulta.
  // La base **preselecciona** con los filtros que este mismo módulo describe
  // —`filtrosDePreseleccion`—, y el orden lo sigue decidiendo el dominio con lo
  // que llegue. No hay una segunda fórmula: hay una prueba que exige que las
  // dos den exactamente lo mismo. (Desde la 0020 el volcado ya no es candidato
  // y vuelven a ser ~1.100 filas; la preselección se queda, que no estorba.)
  const { data, error } = await supabase.rpc("candidatos_publicos", {
    grupo_filtro: datos.soloMismoGrupo ? datos.alimento.grupo : null,
    preseleccion: filtrosDePreseleccion(yo, datos.gramos, opciones, direccion),
  });
  if (error || !data) return vacio;

  const candidatos = (data as Array<{
    id: number; nombre: string; grupo: string | null; estado: string | null;
    prot_100: unknown; hc_100: unknown; grasa_100: unknown; kcal_100: unknown;
  }>).map((f) => ({
    id: Number(f.id),
    nombre: f.nombre,
    grupo: f.grupo,
    estado: f.estado ?? "desconocido",
    prot: num(f.prot_100),
    hc: num(f.hc_100),
    grasa: num(f.grasa_100),
    kcal100: num(f.kcal_100),
  }));

  // Se corta aquí: `limite` alto, no «diez». Así se puede decir cuántos hay en
  // total, que es lo que hace honesto el botón de «buscar más» —y lo que
  // permite apagarlo cuando ya no queda nada—.
  const todos = direccion
    ? rankearPorMacro(yo, datos.gramos, candidatos, direccion, opciones)
    : rankearSustitutos(yo, datos.gramos, candidatos, opciones);

  const desde = Math.max(0, datos.desde ?? 0);
  return {
    sustitutos: todos.slice(desde, desde + 10),
    total: todos.length,
    mirados: candidatos.length,
  };
}
