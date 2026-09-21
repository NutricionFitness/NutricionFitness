-- ==========================================================================
-- 0021 · El comparador público busca también por código de barras
-- ==========================================================================
--
-- ## Lo que se quiere
--
-- En el comparador —la página sin sesión— poder escanear el código de barras
-- de un envase, o teclearlo, y que salga la ficha de ese producto igual que si
-- se hubiera buscado por nombre: sus macros, «¿por qué lo puedo cambiar?» y el
-- cara a cara con otro. Y lo mismo en el segundo hueco, el de «compáralo con
-- uno concreto».
--
-- ## Lo que hace falta de la base, y por qué es tan poco
--
-- El volcado de Open Food Facts (0018) ya está en el catálogo compartido con
-- su `codigo_barras`, y los ingredientes propios que se dan de alta escaneando
-- (0008) también lo llevan. Así que casi todo lo que alguien escanee en un
-- supermercado español **ya está en la base**; solo falta poder preguntarlo
-- sin sesión.
--
-- Y sin sesión solo se puede preguntar por las funciones `security definer` de
-- la 0011: `anon` no lee `ingredientes` ni la vista. Aquí se añade una tercera
-- puerta, del mismo tamaño que las otras: un código, una fila como mucho, y
-- ninguna forma de listar nada. Devuelve las mismas columnas que
-- `buscar_alimentos_publico` más el código y la `fuente`, porque la pantalla
-- tiene que poder decir «esto es del volcado y nadie lo ha revisado».
--
-- Lo que la base NO hace: salir a internet. Si el código no está en el
-- catálogo público, es la aplicación —en el servidor de Next, como ya hace el
-- alta con sesión— la que pregunta a Open Food Facts en vivo.
--
-- ## Lo que no cambia
--
-- Los sustitutos. `candidatos_publicos` sigue proponiendo solo genéricos
-- (0020): escanear un yogur de marca enseña **su** ficha, y lo que se propone
-- para cambiarlo sale de BEDCA y de lo propio publicado, no del volcado.
--
-- Idempotente: se puede volver a aplicar.
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- La vista pública, con el código de barras
--
-- Al FINAL, como `fuente` en la 0020: `create or replace view` solo admite
-- columnas nuevas al final, y `security_invoker = off` se repite porque un
-- `replace` sin la opción la dejaría en su valor por defecto y `anon` dejaría
-- de poder leerla a través de las funciones `definer`.
-- ---------------------------------------------------------------------------
create or replace view public.v_alimentos_publicos
with (security_invoker = off) as
  select i.id, i.nombre, i.nombre_norm, i.grupo, i.estado,
         i.prot_100, i.hc_100, i.grasa_100, i.fibra_100, i.alcohol_100,
         i.kcal_100, i.kcal_ref, i.porcion_comestible, i.codigo_bedca,
         i.fuente,
         i.codigo_barras
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
  'proponen solo entre genéricos. Con codigo_barras: se puede buscar por él.';

-- ---------------------------------------------------------------------------
-- Buscar por código de barras
--
-- Recibe una lista y no un código porque el mismo envase puede estar guardado
-- de dos maneras: tal cual se imprime, o rellenado con ceros hasta 13, que es
-- como Open Food Facts guarda casi todo. La aplicación ya sabe cuáles son las
-- formas que hay que probar (`normalizarEan` en `lib/openfoodfacts/ean.ts`) y
-- las manda todas de una vez; probarlas de una en una serían tres viajes.
--
-- Si hay más de una fila con el código —un producto del volcado y el mismo
-- producto dado de alta a mano por una cuenta que publica su catálogo—, gana
-- el que ha mirado una persona: `fuente <> 'openfoodfacts'` primero. Después,
-- el código en la forma en que se leyó antes que sus variantes.
--
-- La lista va acotada a cinco: `normalizarEan` manda dos o tres, y una función
-- abierta a `anon` no tiene por qué aceptar diez mil.
-- ---------------------------------------------------------------------------
create or replace function public.alimento_publico_por_codigo(codigos text[])
returns table (
  id bigint, nombre text, grupo text, estado text,
  prot_100 numeric, hc_100 numeric, grasa_100 numeric,
  fibra_100 numeric, alcohol_100 numeric, kcal_100 numeric,
  kcal_ref numeric, porcion_comestible numeric, codigo_bedca text,
  codigo_barras text, fuente text
)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.nombre, v.grupo, v.estado,
         v.prot_100, v.hc_100, v.grasa_100, v.fibra_100, v.alcohol_100,
         v.kcal_100, v.kcal_ref, v.porcion_comestible, v.codigo_bedca,
         v.codigo_barras, v.fuente
    from public.v_alimentos_publicos v
   where codigos is not null
     and cardinality(codigos) between 1 and 5
     and v.codigo_barras = any (codigos)
   order by (v.fuente = 'openfoodfacts'),
            array_position(codigos, v.codigo_barras),
            v.id
   limit 1;
$$;

comment on function public.alimento_publico_por_codigo(text[]) is
  'El alimento del catalogo publico con ese codigo de barras, en cualquiera '
  'de las formas que se pasen (tal cual, rellenado a 13). Una fila como mucho. '
  'Es la tercera puerta de anon, junto a buscar_alimentos_publico y '
  'candidatos_publicos (0011).';

-- ---------------------------------------------------------------------------
-- Permisos
--
-- `revoke` primero porque PostgreSQL da permiso de ejecución a `public` en
-- cuanto se crea una función. La vista sigue sin concederse a `anon`.
-- ---------------------------------------------------------------------------
revoke all on function public.alimento_publico_por_codigo(text[]) from public;
grant execute on function public.alimento_publico_por_codigo(text[]) to anon, authenticated;

revoke all on public.v_alimentos_publicos from anon;
grant select on public.v_alimentos_publicos to authenticated;
