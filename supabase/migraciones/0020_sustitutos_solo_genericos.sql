-- ==========================================================================
-- 0020 · «¿Por qué lo puedo cambiar?» vuelve a proponer solo genéricos
-- ==========================================================================
--
-- ## Lo que se vio
--
-- En el comparador público, con FRUTA (1 g de proteína, 10 de hidratos, 1 de
-- grasa) y «solo del mismo grupo» desmarcado, los diez sustitutos más parecidos
-- eran «Alitas de pollo», «Panela», «Mini croissant 23% mantequilla»,
-- «Guindillas», «Bionade elderberry»… todos con +0 / +0 / +0 y el mismo
-- reparto 8/75/17 que la fruta. No era un error de cálculo: esas filas del
-- volcado de Open Food Facts tienen **de verdad** 1/10/1, 2/20/2 o 0,5/5/0,5
-- por 100 g —alguien tecleó cifras de relleno—, y un producto cuyos macros son
-- exactamente proporcionales al de partida da distancia cero, así que gana a
-- cualquier fruta real. Y con 150.000 fichas sin revisar, siempre hay diez
-- así. El resultado era una lista de sustitutos que no servía para nada, y que
-- además desconcertaba: hay veinte «Alitas de pollo» sin marca en el catálogo,
-- y al buscar una a mano abajo salía otra, con otros números.
--
-- ## Lo que se hace
--
-- Lo mismo que ya hace la sustitución **dentro de una dieta** desde la 0018
-- (`buscarSustitutos` y `planSustitucion` en `app/dietas/[id]/acciones.ts`):
-- proponer solo genéricos —BEDCA y lo propio—, y dejar fuera el volcado.
-- Cambiar el arroz por «Galletas María 3.412 (Alteza)» es correcto y no es la
-- respuesta de nadie; ahí ya estaba decidido y aquí se aplica el mismo
-- criterio. `/ingredientes` lo dice en su texto: «sustituir y planificar sigue
-- usando solo los genéricos».
--
-- Lo que NO cambia: buscar por nombre (`buscar_alimentos_publico`) sigue
-- encontrando los productos de marca. Compararse contra uno concreto —«¿y esto
-- contra el yogur que compro?»— es justo para lo que sirve el volcado, y ese
-- bloque sigue igual.
--
-- La preselección de la 0018 se queda como está: con ~1.100 filas devuelve
-- «todo» y no estorba, y si algún día se quiere volver a meter el volcado en
-- los sustitutos, es quitar una línea. El índice `ingredientes_kcal_cubierto`
-- de esa migración (19 MB) existía para esta consulta y ya no lo usa nadie; se
-- deja por si se da marcha atrás, y se puede borrar sin más consecuencias.
--
-- Idempotente: se puede volver a aplicar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- La vista publica de dónde viene cada fila
--
-- `fuente` se añade al FINAL: `create or replace view` solo admite columnas
-- nuevas al final, y las funciones que la leen nombran las suyas, así que
-- ninguna se entera. `security_invoker = off` se repite porque un `replace`
-- sin la opción la dejaría en su valor por defecto y `anon` dejaría de poder
-- leerla a través de las funciones `definer`.
-- ---------------------------------------------------------------------------
create or replace view public.v_alimentos_publicos
with (security_invoker = off) as
  select i.id, i.nombre, i.nombre_norm, i.grupo, i.estado,
         i.prot_100, i.hc_100, i.grasa_100, i.fibra_100, i.alcohol_100,
         i.kcal_100, i.kcal_ref, i.porcion_comestible, i.codigo_bedca,
         i.fuente
    from public.ingredientes i
   where i.preferente
     and i.kcal_100 > 0
     and (
       i.owner_id is null
       or exists (
         select 1 from public.cuentas c
          where c.owner_id = i.owner_id and c.catalogo_publico
       )
     );

comment on view public.v_alimentos_publicos is
  'Lo que el comparador público puede enseñar. Sin owner_id: de quién es un '
  'alimento no es asunto de un desconocido. Con fuente: los sustitutos se '
  'proponen solo entre genéricos.';

-- ---------------------------------------------------------------------------
-- Los candidatos, sin el volcado
--
-- Es la función de la 0018 con una condición más. Todo lo demás —la banda de
-- kcal escrita sobre los gramos, el tope absoluto, los grupos excluidos, el
-- movimiento mínimo del macro y el orden por la misma distancia que el
-- dominio— se copia tal cual, y por el mismo motivo por el que está en
-- `plpgsql` y no en `sql`.
-- ---------------------------------------------------------------------------
create or replace function public.candidatos_publicos(
  grupo_filtro text    default null,
  preseleccion jsonb   default null,
  tope         integer default 750
)
returns table (
  id bigint, nombre text, grupo text, estado text,
  prot_100 numeric, hc_100 numeric, grasa_100 numeric, kcal_100 numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k      numeric := (preseleccion->>'kcal')::numeric;
  g      numeric := (preseleccion->>'gramos')::numeric;
  rprot  numeric := coalesce((preseleccion->>'prot')::numeric,  0);
  rhc    numeric := coalesce((preseleccion->>'hc')::numeric,    0);
  rgrasa numeric := coalesce((preseleccion->>'grasa')::numeric, 0);
  rgrupo text    := preseleccion->>'grupo';
  minrel numeric := (preseleccion->>'minRelativo')::numeric;
  maxrel numeric := (preseleccion->>'maxRelativo')::numeric;
  maxg   numeric := (preseleccion->>'maxGramos')::numeric;
  excl   text[]  := case when preseleccion ? 'gruposExcluidos'
                    then array(select jsonb_array_elements_text(preseleccion->'gruposExcluidos'))
                    end;
  mcol   text    := preseleccion#>>'{macro,col}';
  mfac   numeric := (preseleccion#>>'{macro,factor}')::numeric;
  msig   numeric := (preseleccion#>>'{macro,signo}')::numeric;
  mpart  numeric := (preseleccion#>>'{macro,partida}')::numeric;
  mmin   numeric := (preseleccion#>>'{macro,minimo}')::numeric;
  kf     float8  := k::float8;
  gf     float8  := g::float8;
  aprot  float8  := rprot::float8  * g::float8 / 100;
  ahc    float8  := rhc::float8    * g::float8 / 100;
  agrasa float8  := rgrasa::float8 * g::float8 / 100;
  n      integer := least(greatest(coalesce(tope, 750), 1), 3000);
begin
  if k is null then
    -- Sin preselección, lo de antes de la 0018: el catálogo, por nombre.
    return query
      select v.id, v.nombre, v.grupo, v.estado,
             v.prot_100, v.hc_100, v.grasa_100, v.kcal_100
        from public.v_alimentos_publicos v
       where (grupo_filtro is null or v.grupo = grupo_filtro)
         -- Solo genéricos. Ver la cabecera.
         and v.fuente <> 'openfoodfacts'
       order by v.nombre
       limit n;
    return;
  end if;

  return query
    select v.id, v.nombre, v.grupo, v.estado,
           v.prot_100, v.hc_100, v.grasa_100, v.kcal_100
      from public.v_alimentos_publicos v
     where (grupo_filtro is null or v.grupo = grupo_filtro)
       -- Solo genéricos. Ver la cabecera. Es la única línea que la 0018 no
       -- tenía; con ella, el índice parcial `ingredientes_genericos` de esa
       -- misma migración es el que resuelve la consulta.
       and v.fuente <> 'openfoodfacts'
       and v.kcal_100 > 0
       and (minrel is null or v.kcal_100 <= k / minrel)
       and (maxrel is null or v.kcal_100 >= k / maxrel)
       and (maxg   is null or v.kcal_100 >= g * k / maxg)
       and (
         excl is null or v.grupo is null
         or v.grupo is not distinct from rgrupo
         or not (v.grupo = any (excl))
       )
       and (
         mcol is null
         or msig * (
              100 * mfac * (case mcol
                              when 'prot' then v.prot_100
                              when 'hc'   then v.hc_100
                              else             v.grasa_100
                            end) / v.kcal_100
              - mpart
            ) >= mmin
       )
     order by
       abs(v.prot_100::float8  * (gf * kf / v.kcal_100::float8) / 100 - aprot)  / greatest(aprot,  1)
     + abs(v.hc_100::float8    * (gf * kf / v.kcal_100::float8) / 100 - ahc)    / greatest(ahc,    1)
     + abs(v.grasa_100::float8 * (gf * kf / v.kcal_100::float8) / 100 - agrasa) / greatest(agrasa, 1),
       v.nombre
     limit n;
end $$;

comment on function public.candidatos_publicos(text, jsonb, integer) is
  'Preselecciona candidatos para el comparador publico con la misma expresion '
  'que ordena en lib/dominio/sustituir y con los mismos filtros que quitan '
  'candidatos. Solo genericos: el volcado de Open Food Facts no se propone '
  'como sustituto (0020). No decide que se ensena: el dominio vuelve a puntuar '
  'lo que salga de aqui.';

-- Los permisos no cambian con un `replace`, pero se dejan escritos: si alguien
-- copia esta función a un proyecto nuevo, que no herede el `execute` a
-- `public` que PostgreSQL da por defecto.
revoke all on function public.candidatos_publicos(text, jsonb, integer) from public;
grant execute on function public.candidatos_publicos(text, jsonb, integer) to anon, authenticated;

revoke all on public.v_alimentos_publicos from anon;
grant select on public.v_alimentos_publicos to authenticated;
