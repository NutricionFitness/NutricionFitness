-- ---------------------------------------------------------------------------
-- 0011 — El comparador público
--
-- Una página sin sesión donde cualquiera puede buscar un alimento, ver sus
-- macros y compararlo con otro. Eso obliga a que el rol `anon` pueda leer
-- **algo** del catálogo, y ahí está todo lo que decide este fichero.
--
-- ## Qué se publica, y por qué no es «la tabla»
--
-- El encargo era «BEDCA y todos los míos». Traducido a política, la tentación
-- es `create policy ... for select to anon using (true)`: una línea, y publica
-- la tabla entera **de todas las cuentas**, presentes y futuras. Hoy hay una,
-- pero el registro se puede abrir mañana y el ingrediente que otra persona
-- escanee de la nevera de su cliente no tiene por qué acabar en internet.
--
-- Así que se publica lo que el dueño diga:
--
--   · los ingredientes **sin dueño** —el catálogo de BEDCA— siempre, y
--   · los de las cuentas que hayan encendido `catalogo_publico`.
--
-- El interruptor **nace apagado para todo el mundo**, incluida la cuenta que ya
-- existe, y se enciende desde `/cuenta`. La primera versión de esta migración
-- lo encendía sola para las cuentas existentes —«hoy solo hay una, la de
-- Carlos»— y eso está mal por dos motivos: la migración se puede ejecutar en
-- un proyecto donde haya una cuenta de prueba olvidada, y sobre todo, publicar
-- datos es de esas cosas que no se hacen en nombre de nadie. Cuesta un clic y
-- se ve encendido en la pantalla; una migración silenciosa no se ve nunca.
--
-- ## Y por qué funciones y no una política sobre la tabla
--
-- Mismo motivo que en la 0009. Una política para `anon` sobre `ingredientes`
-- deja hacer `select *` con cualquier filtro: contar cuántos hay, listarlos
-- todos, ordenarlos por fecha, paginar el catálogo entero. Estas dos funciones
-- son la superficie completa, devuelven columnas contadas y traen como mucho
-- 60 filas por llamada.
--
-- No hay `insert`, `update` ni `delete` para `anon` en ninguna parte, ni forma
-- de saber de quién es un ingrediente: `owner_id` no sale.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- El interruptor, por cuenta
-- ---------------------------------------------------------------------------
create table if not exists public.cuentas (
  owner_id         uuid primary key default auth.uid()
                   references auth.users(id) on delete cascade,
  -- Si tus ingredientes propios salen en el comparador público.
  catalogo_publico boolean not null default false,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);

create trigger cuentas_tocar before update on public.cuentas
  for each row execute function public.tocar_actualizado();

alter table public.cuentas enable row level security;

-- Cada uno la suya, y solo la suya. `anon` no la toca: quien la lee es la
-- función de abajo, que se salta el RLS porque es `security definer`.
create policy cuentas_propias on public.cuentas
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on public.cuentas to authenticated;

-- Fila para cada cuenta que ya existe, apagada: así el interruptor de
-- `/cuenta` tiene algo que leer desde el primer momento y enseña su estado
-- real en vez de un hueco.
insert into public.cuentas (owner_id, catalogo_publico)
select id, false from auth.users
on conflict (owner_id) do nothing;

-- ---------------------------------------------------------------------------
-- Qué es «público», en un solo sitio
--
-- Una vista y no una condición repetida en cada función: si mañana cambia la
-- regla, cambia aquí y las dos funciones la heredan. `security_invoker = off`
-- porque la leen funciones `definer` en nombre de `anon`.
-- ---------------------------------------------------------------------------
create or replace view public.v_alimentos_publicos
with (security_invoker = off) as
  select i.id, i.nombre, i.nombre_norm, i.grupo, i.estado,
         i.prot_100, i.hc_100, i.grasa_100, i.fibra_100, i.alcohol_100,
         i.kcal_100, i.kcal_ref, i.porcion_comestible, i.codigo_bedca
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
  'alimento no es asunto de un desconocido.';

-- ---------------------------------------------------------------------------
-- Buscar por nombre
--
-- `limite` va acotado dentro y no se fía de lo que llegue: el argumento existe
-- para pedir menos, no para pedir el catálogo entero de una sentada.
-- ---------------------------------------------------------------------------
create or replace function public.buscar_alimentos_publico(
  texto  text,
  limite integer default 20
)
returns table (
  id bigint, nombre text, grupo text, estado text,
  prot_100 numeric, hc_100 numeric, grasa_100 numeric,
  fibra_100 numeric, alcohol_100 numeric, kcal_100 numeric,
  kcal_ref numeric, porcion_comestible numeric, codigo_bedca text
)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.nombre, v.grupo, v.estado,
         v.prot_100, v.hc_100, v.grasa_100, v.fibra_100, v.alcohol_100,
         v.kcal_100, v.kcal_ref, v.porcion_comestible, v.codigo_bedca
    from public.v_alimentos_publicos v
   -- Se busca sobre `nombre_norm` —minúsculas y sin tildes— porque es lo que
   -- hace que «platano» encuentre «Plátano». La normalización del texto que
   -- llega la hace la aplicación con la misma función que escribe la columna.
   where length(coalesce(trim(texto), '')) >= 2
     and v.nombre_norm like '%' || lower(trim(texto)) || '%'
   -- Los que empiezan por lo buscado primero: quien escribe «arroz» quiere
   -- «Arroz», no «Almidón de arroz».
   order by (v.nombre_norm like lower(trim(texto)) || '%') desc, v.nombre
   limit least(greatest(coalesce(limite, 20), 1), 40);
$$;

-- ---------------------------------------------------------------------------
-- Los candidatos con los que se compara
--
-- El comparador necesita puntuar el alimento elegido contra todo el catálogo,
-- y eso no se puede hacer en el navegador sin bajarse mil filas. Se hace en el
-- servidor de Next, que llama a esta función con la clave anónima: por eso
-- devuelve muchas filas de golpe y por eso son solo las columnas del cálculo.
--
-- Con `grupo` se acota a un grupo; sin él, entra el catálogo público entero.
-- ---------------------------------------------------------------------------
create or replace function public.candidatos_publicos(
  grupo_filtro text default null
)
returns table (
  id bigint, nombre text, grupo text, estado text,
  prot_100 numeric, hc_100 numeric, grasa_100 numeric, kcal_100 numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.nombre, v.grupo, v.estado,
         v.prot_100, v.hc_100, v.grasa_100, v.kcal_100
    from public.v_alimentos_publicos v
   where grupo_filtro is null or v.grupo = grupo_filtro
   order by v.nombre
   limit 1500;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
--
-- `revoke` primero porque PostgreSQL da permiso de ejecución a `public` —o sea,
-- a todo el mundo— en cuanto se crea una función. Lo que se concede después es
-- lo que hay.
-- ---------------------------------------------------------------------------
revoke all on function public.buscar_alimentos_publico(text, integer) from public;
revoke all on function public.candidatos_publicos(text)               from public;

grant execute on function public.buscar_alimentos_publico(text, integer) to anon, authenticated;
grant execute on function public.candidatos_publicos(text)               to anon, authenticated;

-- La vista NO se concede a `anon`: solo la leen las funciones de arriba, que
-- corren como su dueño. Si algún día se concediera, `anon` podría listar el
-- catálogo entero sin pasar por el límite de filas.
revoke all on public.v_alimentos_publicos from anon;
grant select on public.v_alimentos_publicos to authenticated;
