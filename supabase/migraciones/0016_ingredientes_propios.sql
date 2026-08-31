-- ============================================================================
-- 0016 · Una cuenta puede tener más de un ingrediente propio
-- ============================================================================
--
-- ## El fallo
--
-- Desde la 0001, `ingredientes` llevaba
--
--     constraint ingredientes_codigo_unico
--       unique nulls not distinct (owner_id, codigo_bedca)
--
-- y **ningún ingrediente propio tiene código de BEDCA**: ni los que se escriben
-- a mano ni los que entran por código de barras —esos llevan `codigo_barras`,
-- que es otra columna—. Con `NULLS NOT DISTINCT` dos nulos cuentan como
-- iguales, así que el segundo ingrediente propio de una cuenta chocaba contra
-- el primero:
--
--     duplicate key value violates unique constraint "ingredientes_codigo_unico"
--
-- O sea: **una cuenta solo podía tener un ingrediente propio**. Reproducido
-- contra este esquema, con la 0001 a la 0014 aplicadas.
--
-- La fase 14 ya sabía cómo se hace —su índice `ingredientes_codigo_barras_unico`
-- lleva `where codigo_barras is not null`— pero solo lo aplicó al índice que
-- añadía. Es la lección de la fase 24 otra vez: un arreglo puntual hay que
-- buscarlo en todo el repo.
--
-- ## El arreglo
--
-- El mismo patrón: **índice parcial**. Lo que la restricción quería decir es
-- «un código de BEDCA no se repite dentro del mismo ámbito», y una fila sin
-- código no tiene ámbito que proteger.
--
--   · `nulls not distinct` se queda, y ahora solo afecta a `owner_id`: dos
--     filas del catálogo compartido (`owner_id` nulo) con el mismo código
--     siguen chocando, que es lo que protege a BEDCA de una carga repetida.
--   · `where codigo_bedca is not null` deja fuera del índice a los propios,
--     que pueden ser todos los que hagan falta.
--
-- ## Y por qué hay una función nueva
--
-- `scripts/cargar-ingredientes.mjs` era idempotente porque hacía `upsert` con
-- `onConflict: "owner_id,codigo_bedca"`. PostgreSQL **no puede inferir un
-- índice parcial** en un `on conflict` que no lleve su `where`, y PostgREST no
-- deja escribirlo. Así que el `on conflict` se escribe aquí, con su predicado,
-- y el cargador llama a esta función en vez de hacer el upsert.
--
-- De paso, la protección de lo corregido a mano —que hasta ahora vivía solo en
-- el script— pasa a estar también en la base: el `do update` no toca las filas
-- con `editado_a_mano`. Una salvaguarda que solo vive en el cliente es una
-- salvaguarda que se salta quien no use ese cliente.
--
-- Idempotente: se puede volver a aplicar.
-- ============================================================================

alter table public.ingredientes
  drop constraint if exists ingredientes_codigo_unico;
drop index if exists public.ingredientes_codigo_unico;

create unique index if not exists ingredientes_codigo_unico
  on public.ingredientes (owner_id, codigo_bedca) nulls not distinct
  where codigo_bedca is not null;

comment on index public.ingredientes_codigo_unico is
  'Un código de BEDCA no se repite dentro del mismo ámbito. Parcial a '
  'propósito: los ingredientes propios no llevan código, y sin el WHERE dos '
  'nulos chocaban entre sí y una cuenta solo podía tener uno.';

-- ---------------------------------------------------------------------------
-- La carga del catálogo compartido
-- ---------------------------------------------------------------------------
-- `security invoker`: la llama el script con la clave de servicio, que se salta
-- el RLS de todos modos. Con una sesión normal, el RLS de `ingredientes` sigue
-- mandando —`with check (owner_id = auth.uid())`—, así que un usuario no puede
-- usarla para colar filas en el catálogo compartido. No lleva `revoke`: el
-- permiso no es lo que la protege, y un `revoke ... from anon` no quitaría nada
-- (lección de la fase 22).
create or replace function public.cargar_catalogo_bedca(p_filas jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_n integer;
begin
  if jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Se esperaba un array de ingredientes';
  end if;

  insert into public.ingredientes (
    owner_id, codigo_bedca, nombre, nombre_norm, nombre_en, grupo, estado,
    origen, preferente, completitud, langual, porcion_comestible,
    prot_100, hc_100, grasa_100, fibra_100, alcohol_100,
    ags_100, agua_100, sodio_100, kcal_ref)
  select
    f.owner_id, f.codigo_bedca, f.nombre, f.nombre_norm, f.nombre_en, f.grupo,
    f.estado, f.origen, f.preferente, f.completitud, f.langual,
    f.porcion_comestible, f.prot_100, f.hc_100, f.grasa_100, f.fibra_100,
    f.alcohol_100, f.ags_100, f.agua_100, f.sodio_100, f.kcal_ref
  from jsonb_populate_recordset(null::public.ingredientes, p_filas) f
  on conflict (owner_id, codigo_bedca) where codigo_bedca is not null
  do update set
    nombre             = excluded.nombre,
    nombre_norm        = excluded.nombre_norm,
    nombre_en          = excluded.nombre_en,
    grupo              = excluded.grupo,
    estado             = excluded.estado,
    origen             = excluded.origen,
    preferente         = excluded.preferente,
    completitud        = excluded.completitud,
    langual            = excluded.langual,
    porcion_comestible = excluded.porcion_comestible,
    prot_100           = excluded.prot_100,
    hc_100             = excluded.hc_100,
    grasa_100          = excluded.grasa_100,
    fibra_100          = excluded.fibra_100,
    alcohol_100        = excluded.alcohol_100,
    ags_100            = excluded.ags_100,
    agua_100           = excluded.agua_100,
    sodio_100          = excluded.sodio_100,
    kcal_ref           = excluded.kcal_ref
  -- Lo corregido a mano desde la app es más reciente que la fuente: la carga no
  -- lo pisa. El script ya lo filtraba; aquí no depende de que lo haga.
  where public.ingredientes.editado_a_mano is not true;

  get diagnostics v_n = row_count;
  return v_n;
end $$;
