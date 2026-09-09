-- ============================================================================
-- 0018 · El volcado de Open Food Facts en el catálogo compartido
-- ============================================================================
--
-- La fase 14 trajo productos de Open Food Facts **de uno en uno**: escaneas un
-- envase, miras los avisos, confirmas y se da de alta con tu `owner_id`. Esto
-- es lo contrario: meter de golpe todos los productos que se venden en España
-- en el catálogo compartido, para que escanear encuentre el producto sin salir
-- a internet y para que se puedan buscar por nombre.
--
-- ## Lo que cambia de significado
--
-- Hasta hoy `owner_id is null` quería decir «BEDCA», y el catálogo compartido
-- eran 1.090 alimentos genéricos revisados. A partir de aquí también quiere
-- decir «un producto envasado que ha tecleado un desconocido a partir de una
-- foto». Son dos cosas muy distintas y el código las tiene que poder separar,
-- porque hay sitios donde solo vale la primera.
--
-- ## Y por qué una columna nueva y no `origen`
--
-- `origen` ya está ocupada, y con otro significado: en BEDCA guarda la
-- **sub-fuente** de cada ficha —UGR, CESNID, UCM, BEDCA2—, y en los productos
-- escaneados guarda `'openfoodfacts'`. Con eso, «esta fila es del volcado» solo
-- se podría escribir como `origen = 'openfoodfacts' and owner_id is null`: dos
-- columnas, una de ellas ya con dos sentidos, y un predicado compuesto repetido
-- en cinco consultas. Es exactamente la clase de cosa que en la fase 25 costó
-- veinticuatro fases descubrir.
--
-- `fuente` dice **cómo entró la fila en la base**, que es lo que de verdad hay
-- que preguntar:
--
--   · `bedca`         — el catálogo de composición de alimentos genéricos.
--   · `openfoodfacts` — el volcado masivo. Nadie lo ha mirado.
--   · `propio`        — lo creó una persona en esta app, a mano o confirmando
--                       un escaneo. Que lo confirmara es lo que lo hace propio.
--
-- Idempotente: se puede volver a aplicar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- La columna
-- ---------------------------------------------------------------------------
alter table public.ingredientes
  add column if not exists fuente text not null default 'propio';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ingredientes_fuente_check') then
    alter table public.ingredientes
      add constraint ingredientes_fuente_check
      check (fuente in ('bedca', 'openfoodfacts', 'propio'));
  end if;
end $$;

comment on column public.ingredientes.fuente is
  'Cómo entró la fila. ''bedca'': el catálogo de alimentos genéricos. '
  '''openfoodfacts'': el volcado masivo de productos envasados, sin revisar '
  'por nadie. ''propio'': lo creó una persona en la app, a mano o confirmando '
  'un escaneo. No es lo mismo que `origen`, que en BEDCA guarda la sub-fuente '
  'de cada ficha (UGR, CESNID, UCM).';

-- El reparto de lo que ya hay. Todo lo que tiene código de BEDCA es de BEDCA;
-- lo demás lo creó alguien —incluidos los escaneados uno a uno, que llevan
-- `origen = ''openfoodfacts''` pero los confirmó una persona—.
update public.ingredientes
   set fuente = 'bedca'
 where codigo_bedca is not null
   and fuente <> 'bedca';

-- ---------------------------------------------------------------------------
-- Los índices que el volcado hace necesarios
-- ---------------------------------------------------------------------------
-- 1. El catálogo efectivo, que es lo que lee el motor de sustitución y el plan
--    de dieta. Hoy son 1.090 filas y las consultas se las traen enteras con
--    `limit(1200)`; con el volcado dentro, ese límite dejaría de ser «todo» y
--    pasaría a ser un trozo arbitrario **sin dar error**. Las consultas añaden
--    `fuente <> 'openfoodfacts'` y este índice parcial las deja igual de
--    baratas que antes del volcado.
create index if not exists ingredientes_genericos
  on public.ingredientes (id)
  where preferente and fuente <> 'openfoodfacts';

comment on index public.ingredientes_genericos is
  'El catálogo con el que se sustituye y se planifica: genéricos de BEDCA y '
  'propios. Los productos de marca del volcado no entran ahí.';

-- 2. `/ingredientes` ordena por nombre y pagina. Con 1.090 filas daba igual;
--    con el volcado, sin índice, cada página es una ordenación de todo.
create index if not exists ingredientes_nombre
  on public.ingredientes (nombre);

-- 3. El comparador público recorre el catálogo público filtrando por una banda
--    de `kcal_100` y ordenando por una expresión sobre los macros. Con 151.000
--    filas eso son ~70.000 candidatos por consulta, así que el índice lleva
--    dentro (`include`) todo lo que la consulta lee: se resuelve sin tocar la
--    tabla. Cuesta 19 MB y vale 125 ms por consulta (480 → 355, medido con
--    150.000 productos).
create index if not exists ingredientes_kcal_cubierto
  on public.ingredientes (kcal_100)
  include (id, nombre, grupo, estado, prot_100, hc_100, grasa_100, owner_id)
  where preferente and kcal_100 > 0;

-- ---------------------------------------------------------------------------
-- La carga
--
-- Mismo patrón que `cargar_catalogo_bedca` de la 0016, y por el mismo motivo:
-- el índice único es **parcial** —`where codigo_barras is not null`— y
-- PostgreSQL no puede inferir un índice parcial en un `on conflict` que no
-- lleve su `where`, que PostgREST no deja escribir. Así que el `on conflict` se
-- escribe aquí.
--
-- Tres cosas que el `do update` NO pisa nunca:
--
--   · lo corregido a mano (`editado_a_mano`), que es más reciente que la fuente;
--   · lo que no sea del volcado (`fuente = 'openfoodfacts'`), para que una
--     recarga no pueda tocar una ficha de BEDCA que comparta código por error;
--   · `revisado` y `alergenos_revisados`, que son de quien los haya mirado.
-- ---------------------------------------------------------------------------
create or replace function public.cargar_productos_off(p_filas jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_n integer;
begin
  if jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Se esperaba un array de productos';
  end if;

  insert into public.ingredientes (
    owner_id, fuente, origen, codigo_barras, nombre, nombre_norm, grupo, estado,
    prot_100, hc_100, grasa_100, fibra_100, alcohol_100,
    ags_100, agua_100, sodio_100, kcal_ref, porcion_comestible,
    preferente, revisado, alergenos_revisados, editado_a_mano, notas)
  select
    null, 'openfoodfacts', 'openfoodfacts', f.codigo_barras, f.nombre,
    f.nombre_norm, f.grupo, f.estado,
    f.prot_100, f.hc_100, f.grasa_100, f.fibra_100, f.alcohol_100,
    f.ags_100, f.agua_100, f.sodio_100, f.kcal_ref, f.porcion_comestible,
    -- `preferente` es lo que mira el catálogo y el buscador: sin esto el
    -- volcado se guardaría y no aparecería en ninguna parte (lección de la
    -- fase 12).
    true,
    -- El dato lo ha tecleado un desconocido a partir de una foto de una
    -- etiqueta. Hasta que alguien lo mire, sigue siendo eso.
    false, false, false,
    f.notas
  from jsonb_populate_recordset(null::public.ingredientes, p_filas) f
  where f.codigo_barras is not null
  on conflict (owner_id, codigo_barras) where codigo_barras is not null
  do update set
    nombre             = excluded.nombre,
    nombre_norm        = excluded.nombre_norm,
    grupo              = excluded.grupo,
    estado             = excluded.estado,
    prot_100           = excluded.prot_100,
    hc_100             = excluded.hc_100,
    grasa_100          = excluded.grasa_100,
    fibra_100          = excluded.fibra_100,
    alcohol_100        = excluded.alcohol_100,
    ags_100            = excluded.ags_100,
    agua_100           = excluded.agua_100,
    sodio_100          = excluded.sodio_100,
    kcal_ref           = excluded.kcal_ref,
    porcion_comestible = excluded.porcion_comestible,
    notas              = excluded.notas
  where public.ingredientes.editado_a_mano is not true
    and public.ingredientes.fuente = 'openfoodfacts';

  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.cargar_productos_off(jsonb) is
  'Carga un lote del volcado de Open Food Facts en el catálogo compartido. '
  'Idempotente. No pisa lo corregido a mano ni nada que no sea del volcado.';

-- ---------------------------------------------------------------------------
-- Los alérgenos que declara la etiqueta
--
-- Van con `origen = 'declarado'` (valor de la 0008): la derivación por LanguaL
-- solo borra lo suyo, así que relanzar `derivar-alergenos.mjs` no se los lleva
-- —y no podría deducir ninguno en su lugar, porque un producto de OFF no tiene
-- código LanguaL—.
--
-- Se borra y se vuelve a poner lo `'declarado'` de esos productos en cada
-- carga: si la etiqueta ha cambiado y ya no lleva leche, la fila vieja tiene
-- que irse. Lo `'manual'` y lo `'derivado'` no se tocan.
--
-- ## Dos sentencias, y no una con CTE
--
-- La tentación es meter el `delete` y el `insert` en un solo `with`. No vale:
-- dentro de una misma sentencia, el índice único sigue viendo las filas que el
-- `delete` acaba de quitar, así que el `on conflict do nothing` se saltaría
-- justo las que hay que volver a poner. Tienen que ser dos.
--
-- ## Y sin tabla temporal
--
-- La primera versión resolvía el jsonb en una `temporary table` y la vaciaba
-- con `delete from _off_alerg;`. Contra un PostgreSQL pelado funciona; contra
-- Supabase **no**, porque ahí está cargado `safeupdate` y un `delete` sin
-- `where` se rechaza con «DELETE requires a WHERE clause». Salió a la primera
-- carga de verdad, no en la batería.
--
-- Parsear el jsonb dos veces cuesta menos que una tabla temporal y quita el
-- problema de raíz. No hay lógica duplicada: las dos sentencias dicen cosas
-- distintas.
-- ---------------------------------------------------------------------------
create or replace function public.cargar_alergenos_off(p_filas jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_n integer;
begin
  if jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Se esperaba un array de {codigo_barras, alergenos}';
  end if;

  -- Lo declarado que había para estos productos, fuera. Solo de los del
  -- volcado: un ingrediente propio con el mismo código es de su dueño.
  delete from public.ingrediente_alergenos ia
   using public.ingredientes i
   where ia.ingrediente_id = i.id
     and ia.origen = 'declarado'
     and i.owner_id is null
     and i.fuente = 'openfoodfacts'
     and i.codigo_barras in (
       select f.codigo_barras
         from jsonb_to_recordset(p_filas) as f(codigo_barras text, alergenos jsonb)
        where f.codigo_barras is not null
     );

  insert into public.ingrediente_alergenos (ingrediente_id, alergeno_id, origen)
  select i.id, a.id, 'declarado'
    from jsonb_to_recordset(p_filas) as f(codigo_barras text, alergenos jsonb)
    cross join lateral jsonb_array_elements_text(coalesce(f.alergenos, '[]'::jsonb)) as c(codigo)
    join public.ingredientes i
      on i.codigo_barras = f.codigo_barras
     and i.owner_id is null
     and i.fuente = 'openfoodfacts'
    join public.alergenos a
      on a.codigo = c.codigo
     and a.owner_id is null
  on conflict (ingrediente_id, alergeno_id) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Los grupos del catálogo, en la base
--
-- `app/ingredientes/grupos.ts` se traía la columna `grupo` de **todas** las
-- filas y las resumía en JavaScript, con un `limit(5000)` de red por si acaso.
-- Con 1.090 filas era más barato que montar una vista, y está escrito así en la
-- fase 12. Con el volcado dentro deja de serlo por dos motivos: son megabytes
-- por cada carga de página, y sobre todo el `limit` **recorta** —quince grupos
-- deducidos de las primeras 5.000 filas de 150.000 pueden ser trece—.
--
-- Un `select distinct` es lo que PostgREST no sabe hacer, no lo que PostgreSQL
-- no sabe hacer.
-- ---------------------------------------------------------------------------
create or replace function public.grupos_catalogo()
returns table (grupo text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct i.grupo
    from public.ingredientes i
   where i.preferente
     and i.grupo is not null
     and i.grupo <> ''
   order by 1;
$$;

-- ---------------------------------------------------------------------------
-- Asignar un alérgeno a todo lo que sale de un filtro
--
-- `asignarAlergenoAFiltro` se traía los ids con `limit(5000)` y luego insertaba.
-- Con el volcado, un filtro puede sacar más de 5.000 y la pantalla diría «hecho»
-- habiendo marcado una parte. Un alérgeno marcado a medias es peor que no
-- marcado: la pantalla que avisa en rojo se calla justo donde no debe.
--
-- Aquí no hay lista intermedia: el filtro se resuelve y se inserta en la misma
-- sentencia, así que o entra todo o no entra nada.
--
-- `security invoker` a propósito: el RLS de `ingredientes` y el de
-- `ingrediente_alergenos` siguen mandando, y el filtro solo puede alcanzar lo
-- que quien llama ya podía ver.
-- ---------------------------------------------------------------------------
create or replace function public.asignar_alergeno_a_filtro(
  p_texto     text,
  p_grupos    text[],
  p_alergeno  bigint,
  p_quitar    boolean default false
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n integer;
  v_q text := nullif(trim(coalesce(p_texto, '')), '');
begin
  -- La tabla temporal está para resolver el filtro **una vez**, de modo que
  -- quitar y poner alcancen exactamente las mismas filas.
  --
  -- Se vacía con `truncate` y no con `delete`: en Supabase está cargado
  -- `safeupdate`, y un `delete` sin `where` se rechaza con «DELETE requires a
  -- WHERE clause». Con `on commit drop` y una transacción por llamada de
  -- PostgREST esto casi nunca tiene nada que vaciar, pero «casi nunca» no es
  -- «nunca»: dos llamadas dentro de la misma transacción la encontrarían con
  -- las filas de la anterior.
  create temporary table if not exists _alerg_filtro (id bigint) on commit drop;
  truncate table _alerg_filtro;

  insert into _alerg_filtro (id)
  select i.id
    from public.ingredientes i
   where i.preferente
     and (v_q is null or i.nombre_norm like '%' || v_q || '%')
     and (p_grupos is null or cardinality(p_grupos) = 0 or i.grupo = any (p_grupos));

  if p_quitar then
    delete from public.ingrediente_alergenos ia
     where ia.alergeno_id = p_alergeno
       and ia.ingrediente_id in (select f.id from _alerg_filtro f);
  else
    insert into public.ingrediente_alergenos (ingrediente_id, alergeno_id, origen)
    select f.id, p_alergeno, 'manual' from _alerg_filtro f
    on conflict (ingrediente_id, alergeno_id) do nothing;
  end if;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- El comparador público, con productos de marca dentro
--
-- `v_alimentos_publicos` no cambia: publica lo que no tiene dueño más lo de las
-- cuentas que hayan encendido `catalogo_publico`, y el volcado no tiene dueño.
-- Lo que sí deja de valer es `candidatos_publicos`, que traía
--
--     order by v.nombre limit 1500
--
-- Con 1.090 filas eso era «el catálogo entero» y el `limit` era una red de
-- seguridad. Con el volcado dentro serían 1.500 productos que empiezan por
-- cifra y por A, y el comparador contestaría con eso sin decir que ha mirado
-- una milésima parte del catálogo. Es el fallo de la fase 16 otra vez: un
-- límite que era «todo» y deja de serlo no da error, da respuestas malas.
--
-- ## Qué se hace en su lugar
--
-- El ranking sigue estando **en un solo sitio**, `lib/dominio/sustituir`. Aquí
-- no se decide qué se enseña: se preselecciona.
--
-- La preselección no es una aproximación: es la **misma** expresión que ordena
-- en el dominio. Escrita allí,
--
--     g          = gramos · kcal_ref / kcal_cand          (isoenergético)
--     antes_m    = ref_m · gramos / 100
--     despues_m  = cand_m · g / 100
--     distancia  = Σ_m |despues_m − antes_m| / max(antes_m, 1)
--
-- y como `gramos`, `kcal_ref` y los `ref_m` son constantes dentro de una misma
-- consulta, ordenar por eso es ordenar por
--
--     Σ_m |cand_m · kcal_ref / kcal_cand − ref_m| · (gramos/100) / max(antes_m, 1)
--
-- que es lo que se escribe abajo. Los tres filtros del dominio que **quitan**
-- candidatos —la banda de gramos, el tope de 500 g y los grupos excluidos al
-- cruzar— se aplican aquí también, porque si no la preselección podría dejar
-- fuera algo que el dominio sí habría enseñado.
--
-- Con eso, los `tope` primeros de aquí son exactamente los `tope` primeros de
-- allí, y el dominio vuelve a puntuarlos y a cortarlos. Hay una prueba que lo
-- exige contra el catálogo de verdad; si algún día se toca la fórmula del
-- dominio y no esta, esa prueba se pone roja.
--
-- Los parámetros de la banda llegan de fuera, no se escriben aquí: los números
-- (0,5 y 2 en el comparador, 0,25 y 4 dentro de una dieta) viven en el dominio
-- y este fichero no tiene por qué saberlos.
-- ---------------------------------------------------------------------------
drop function if exists public.candidatos_publicos(text);

create or replace function public.candidatos_publicos(
  grupo_filtro text    default null,
  -- Los parámetros de la preselección, tal y como los usa el dominio. Van en
  -- un solo `jsonb` y no en trece argumentos porque los pone el mismo sitio que
  -- llama a `rankearSustitutos`, y así se ve de un vistazo que son los mismos.
  -- Sin él, la función se comporta como antes de la 0018.
  preseleccion jsonb   default null,
  -- 750 y no 1.500: con todos los filtros que quitan candidatos aplicados
  -- aquí, los N primeros de esta función son exactamente los N primeros del
  -- dominio, y el dominio corta en 500. El margen es por si alguien sube ese
  -- límite sin acordarse de este.
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
  -- `plpgsql` y no `sql` a propósito. Con los valores dentro de un CTE, el
  -- planificador no los ve al planificar y la banda de kcal deja de poder usar
  -- el índice de kcal: se recorren las 151.000 filas. Medido con 150.000
  -- productos: 1.466 ms así, contra 355 ms sacando los valores a variables,
  -- que es lo que hace que la comparación sea un parámetro y el índice sirva.
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
  -- Los macros del alimento de referencia a esos gramos: constantes dentro de
  -- una misma consulta, y el denominador de la distancia sale de ellos.
  kf     float8  := k::float8;
  gf     float8  := g::float8;
  aprot  float8  := rprot::float8  * g::float8 / 100;
  ahc    float8  := rhc::float8    * g::float8 / 100;
  agrasa float8  := rgrasa::float8 * g::float8 / 100;
  n      integer := least(greatest(coalesce(tope, 750), 1), 3000);
begin
  if k is null then
    -- Sin preselección, lo de antes de la 0018.
    return query
      select v.id, v.nombre, v.grupo, v.estado,
             v.prot_100, v.hc_100, v.grasa_100, v.kcal_100
        from public.v_alimentos_publicos v
       where grupo_filtro is null or v.grupo = grupo_filtro
       order by v.nombre
       limit n;
    return;
  end if;

  return query
    select v.id, v.nombre, v.grupo, v.estado,
           v.prot_100, v.hc_100, v.grasa_100, v.kcal_100
      from public.v_alimentos_publicos v
     where (grupo_filtro is null or v.grupo = grupo_filtro)
       and v.kcal_100 > 0
       -- La banda de gramos, escrita sobre kcal: g = gramos·k/kcal_cand.
       and (minrel is null or v.kcal_100 <= k / minrel)
       and (maxrel is null or v.kcal_100 >= k / maxrel)
       -- El tope absoluto de gramos, escrito igual.
       and (maxg   is null or v.kcal_100 >= g * k / maxg)
       -- Los grupos que no se proponen al cruzar de grupo.
       and (
         excl is null or v.grupo is null
         or v.grupo is not distinct from rgrupo
         or not (v.grupo = any (excl))
       )
       -- Y el mínimo de movimiento del macro, cuando se pide una dirección
       -- («como esto pero con más proteína»). Este filtro faltaba en la primera
       -- versión y lo cazó la prueba de equivalencia: sin él, los
       -- preseleccionados eran los más parecidos, casi ninguno movía el macro
       -- lo suficiente, y el comparador contestaba «no hay» donde sí había.
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
     -- En `float8` y no en `numeric`: esto solo ordena, no se enseña, y la
     -- aritmética decimal exacta cuesta el triple sobre decenas de miles de
     -- filas.
     -- Las operaciones van en el MISMO orden que en `evaluar()`: primero los
     -- gramos isoenergéticos, luego los macros de cada lado, luego la resta.
     -- Algebraicamente da igual; en coma flotante no, y con candidatos casi
     -- empatados —150 aceites de oliva de marcas distintas— un empate que se
     -- rompe de otra manera cambia qué entra en la preselección. Lo cazó la
     -- prueba de equivalencia al pasar la expresión a `float8`.
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
  'candidatos. No decide que se ensena: el dominio vuelve a puntuar lo que '
  'salga de aqui. Hay una prueba que exige que los dos den lo mismo.';

revoke all on function public.candidatos_publicos(text, jsonb, integer) from public;
grant execute on function public.candidatos_publicos(text, jsonb, integer) to anon, authenticated;

-- `grupos_catalogo` y `asignar_alergeno_a_filtro` son de la app con sesión.
-- No se le conceden a `anon`, que no tiene permiso sobre las tablas y por tanto
-- tampoco podría usarlas: son `security invoker`.
