-- ============================================================================
-- Duplicar una dieta.
--
-- En la práctica una dieta nueva casi nunca se empieza en blanco: se parte de
-- otra parecida. Copiar comidas y componentes son N escrituras, así que va en
-- una función por lo mismo que `guardar_ajuste`: que un fallo a mitad no deje
-- una dieta a medias.
--
-- No es lo mismo que guardar un ajuste. Aquella crea una VERSIÓN —queda colgada
-- de su madre por `dieta_padre_id` y suma uno a `version`—. Ésta crea una dieta
-- INDEPENDIENTE, sin madre y en versión 1: es una plantilla, no un paso del
-- historial. Mezclar las dos cosas ensuciaría el árbol de versiones.
-- ============================================================================

create or replace function public.duplicar_dieta(
  p_dieta_id  uuid,
  p_nombre    text default null,
  p_persona_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_origen  public.dietas%rowtype;
  v_nueva   uuid;
  v_comida  record;
  v_nueva_comida uuid;
begin
  -- Con RLS, si la dieta no es de quien llama esto no encuentra nada.
  select * into v_origen from public.dietas where id = p_dieta_id;
  if not found then
    raise exception 'La dieta % no existe o no es tuya', p_dieta_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.dietas (
    owner_id, persona_id, nombre, descripcion, modelo_energia,
    estado_cantidades, kcal_objetivo, version, dieta_padre_id)
  values (
    v_origen.owner_id,
    coalesce(p_persona_id, v_origen.persona_id),
    coalesce(nullif(trim(p_nombre), ''), v_origen.nombre || ' (copia)'),
    v_origen.descripcion, v_origen.modelo_energia, v_origen.estado_cantidades,
    v_origen.kcal_objetivo,
    1,      -- una copia empieza de cero
    null)   -- y sin madre: no es una versión de nada
  returning id into v_nueva;

  for v_comida in
    select * from public.comidas where dieta_id = p_dieta_id order by orden, nombre
  loop
    insert into public.comidas (dieta_id, nombre, orden)
    values (v_nueva, v_comida.nombre, v_comida.orden)
    returning id into v_nueva_comida;

    insert into public.componentes (
      comida_id, ingrediente_id, gramos, orden, bloqueado, prioridad,
      min_g, max_g, paso_g)
    select v_nueva_comida, c.ingrediente_id, c.gramos, c.orden, c.bloqueado,
           c.prioridad, c.min_g, c.max_g, c.paso_g
    from public.componentes c
    where c.comida_id = v_comida.id;
  end loop;

  return v_nueva;
end $$;

grant execute on function public.duplicar_dieta(uuid, text, uuid) to authenticated;
