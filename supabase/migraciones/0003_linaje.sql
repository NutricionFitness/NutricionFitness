-- ============================================================================
-- Linaje de versiones de una dieta.
--
-- Cada ajuste guardado crea una dieta hija encadenada por `dieta_padre_id`, así
-- que las versiones de una misma dieta forman un árbol. Desde cualquier nodo
-- hay que poder ver la familia entera, no solo los descendientes: si estás
-- mirando la versión 3, quieres ver también de dónde viene.
--
-- Se hace en dos pasos: subir hasta la raíz y luego bajar recogiéndolo todo.
--
-- SECURITY INVOKER: la función lee `dietas` con los permisos de quien llama, así
-- que el control de acceso sigue aplicando y nadie ve el linaje de otro.
-- ============================================================================

create or replace function public.linaje_dieta(p_dieta_id uuid)
returns table (
  id             uuid,
  persona_id     uuid,
  nombre         text,
  version        integer,
  dieta_padre_id uuid,
  kcal_objetivo  numeric,
  archivada      boolean,
  creado_en      timestamptz,
  profundidad    integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive
  -- 1. desde la dieta pedida, subir de padre en padre
  ascendencia as (
    select d.id, d.dieta_padre_id
      from public.dietas d
     where d.id = p_dieta_id
    union all
    select p.id, p.dieta_padre_id
      from public.dietas p
      join ascendencia a on p.id = a.dieta_padre_id
  ),
  -- 2. la raíz es la primera sin padre. Si la cadena está rota porque se borró
  --    una versión intermedia, la raíz alcanzable hace igual de bien su papel.
  raiz as (
    select coalesce(
      (select a.id from ascendencia a where a.dieta_padre_id is null limit 1),
      (select a.id from ascendencia a order by a.id limit 1),
      p_dieta_id
    ) as id
  ),
  -- 3. desde la raíz, bajar recogiendo toda la descendencia
  familia as (
    select d.*, 0 as profundidad
      from public.dietas d
     where d.id = (select id from raiz)
    union all
    select h.*, f.profundidad + 1
      from public.dietas h
      join familia f on h.dieta_padre_id = f.id
  )
  select f.id, f.persona_id, f.nombre, f.version, f.dieta_padre_id,
         f.kcal_objetivo, f.archivada, f.creado_en, f.profundidad
    from familia f
   order by f.version, f.creado_en;
$$;

grant execute on function public.linaje_dieta(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- Totales de una dieta por comida.
--
-- El total del día no basta: en dietética importa cómo se reparte entre
-- comidas, y esa cifra no se puede sacar de la vista global.
-- ----------------------------------------------------------------------------
create or replace view public.v_comidas_totales
with (security_invoker = true) as
select
  m.id       as comida_id,
  m.dieta_id,
  m.nombre,
  m.orden,
  coalesce(sum(c.gramos * i.kcal_100  / 100), 0)::numeric(12,3) as kcal,
  coalesce(sum(c.gramos * i.prot_100  / 100), 0)::numeric(12,3) as prot,
  coalesce(sum(c.gramos * i.hc_100    / 100), 0)::numeric(12,3) as hc,
  coalesce(sum(c.gramos * i.grasa_100 / 100), 0)::numeric(12,3) as grasa,
  count(c.id) as n_componentes
from public.comidas m
left join public.componentes  c on c.comida_id      = m.id
left join public.ingredientes i on i.id             = c.ingrediente_id
group by m.id, m.dieta_id, m.nombre, m.orden;

grant select on public.v_comidas_totales to authenticated;
