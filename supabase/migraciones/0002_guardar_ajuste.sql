-- ============================================================================
-- Guardar un ajuste como nueva versión de la dieta.
--
-- Son cinco escrituras encadenadas: crear la dieta hija, copiar sus comidas,
-- copiar los componentes con los gramos nuevos y dejar constancia en el
-- historial. Hacerlo desde el cliente con cinco llamadas deja la puerta abierta
-- a que la tercera falle y quede una dieta a medias. Aquí es una sola
-- transacción: o entra todo, o no entra nada.
--
-- SECURITY INVOKER a propósito: la función se ejecuta con los permisos de quien
-- la llama, así que el RLS sigue aplicando. Una función SECURITY DEFINER aquí
-- sería un agujero por el que cualquiera podría clonar la dieta de otro.
-- ============================================================================

create or replace function public.guardar_ajuste(
  p_dieta_id      uuid,
  p_gramos        jsonb,          -- [{"id": "<componente>", "gramos": 123.45}, ...]
  p_nombre        text default null,
  p_kcal_objetivo numeric default null,
  p_modo          text    default 'prioridades',
  p_parametros    jsonb   default '{}'::jsonb,
  p_resultado     jsonb   default '{}'::jsonb,
  p_kcal_origen   numeric default null,
  p_kcal_final    numeric default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_padre    public.dietas%rowtype;
  v_nueva_id uuid;
  v_comida   record;
  v_nueva_comida_id uuid;
  v_gramos   numeric;
begin
  -- El RLS hace que esto no encuentre nada si la dieta no es de quien llama.
  select * into v_padre from public.dietas where id = p_dieta_id;
  if not found then
    raise exception 'La dieta % no existe o no es tuya', p_dieta_id
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_gramos) <> 'array' or jsonb_array_length(p_gramos) = 0 then
    raise exception 'Hacen falta los gramos de al menos un componente';
  end if;

  insert into public.dietas (
    owner_id, persona_id, nombre, descripcion, modelo_energia, estado_cantidades,
    kcal_objetivo, version, dieta_padre_id)
  values (
    v_padre.owner_id, v_padre.persona_id,
    coalesce(nullif(trim(p_nombre), ''),
             v_padre.nombre || ' · ' || round(coalesce(p_kcal_objetivo, 0)) || ' kcal'),
    v_padre.descripcion, v_padre.modelo_energia, v_padre.estado_cantidades,
    p_kcal_objetivo, v_padre.version + 1, v_padre.id)
  returning id into v_nueva_id;

  for v_comida in
    select * from public.comidas where dieta_id = p_dieta_id order by orden, nombre
  loop
    insert into public.comidas (dieta_id, nombre, orden)
    values (v_nueva_id, v_comida.nombre, v_comida.orden)
    returning id into v_nueva_comida_id;

    insert into public.componentes (
      comida_id, ingrediente_id, gramos, orden, bloqueado, prioridad,
      min_g, max_g, paso_g)
    select
      v_nueva_comida_id, c.ingrediente_id,
      -- si el ajuste no trae ese componente, se queda como estaba
      coalesce((select (g->>'gramos')::numeric
                from jsonb_array_elements(p_gramos) g
                where (g->>'id')::uuid = c.id), c.gramos),
      c.orden, c.bloqueado, c.prioridad, c.min_g, c.max_g, c.paso_g
    from public.componentes c
    where c.comida_id = v_comida.id;
  end loop;

  insert into public.ajustes (
    owner_id, dieta_id, dieta_resultado_id, kcal_origen, kcal_objetivo,
    kcal_final, modo, parametros, resultado, factible)
  values (
    v_padre.owner_id, p_dieta_id, v_nueva_id,
    coalesce(p_kcal_origen, 0), coalesce(p_kcal_objetivo, 0), p_kcal_final,
    p_modo, p_parametros, p_resultado, true);

  return v_nueva_id;
end $$;

grant execute on function public.guardar_ajuste(
  uuid, jsonb, text, numeric, text, jsonb, jsonb, numeric, numeric) to authenticated;
