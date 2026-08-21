-- Pruebas de duplicación y de lo que arrastra un borrado.
\set ON_ERROR_STOP on

set role authenticated;
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';

-- Cada prueba monta lo suyo: depender de lo que dejaron las anteriores es lo
-- que rompió una prueba en la fase 5.
do $$
declare
  v_persona uuid;
  v_dieta   uuid;
  v_comida  uuid;
  v_copia   uuid;
  n         integer;
  v_version integer;
  v_padre   uuid;
  v_estado  text;
begin
  insert into public.personas (nombre) values ('Persona pulido') returning id into v_persona;
  insert into public.dietas (persona_id, nombre, estado_cantidades)
    values (v_persona, 'Plantilla', 'cocido') returning id into v_dieta;
  insert into public.comidas (dieta_id, nombre, orden)
    values (v_dieta, 'Comida', 0) returning id into v_comida;
  insert into public.componentes (comida_id, ingrediente_id, gramos, prioridad, min_g, max_g, paso_g)
    select v_comida, id, 120, 3, 90, 150, 1 from public.ingredientes where codigo_bedca = 'X1';

  v_copia := public.duplicar_dieta(v_dieta, 'Copia de trabajo');
  assert v_copia is not null, 'no devolvió id';

  select count(*) into n from public.comidas where dieta_id = v_copia;
  assert n = 1, format('debería copiar 1 comida, copió %s', n);

  -- las reglas de ajuste viajan con el componente: si no, la copia parece igual
  -- y se comporta distinto en cuanto la ajustas
  select count(*) into n
    from public.componentes c join public.comidas m on m.id = c.comida_id
   where m.dieta_id = v_copia and c.gramos = 120 and c.prioridad = 3
     and c.min_g = 90 and c.max_g = 150 and c.paso_g = 1;
  assert n = 1, 'la copia ha perdido las reglas de ajuste del componente';

  select version, dieta_padre_id, estado_cantidades
    into v_version, v_padre, v_estado
    from public.dietas where id = v_copia;

  -- Una copia NO es una versión: empieza en 1 y sin madre.
  assert v_version = 1, format('la copia debería ser versión 1, es %s', v_version);
  assert v_padre is null, 'la copia no debería colgar de ninguna madre';
  assert v_estado = 'cocido', 'la copia debería heredar el estado de las cantidades';

  -- y la original queda intacta
  select count(*) into n from public.comidas where dieta_id = v_dieta;
  assert n = 1, 'la original no debería haberse tocado';
end $$;

-- --- no se puede duplicar la dieta de otro ----------------------------------
do $$
declare ok boolean := false;
begin
  begin
    perform public.duplicar_dieta('bbbbbbb1-0000-0000-0000-000000000002');
  exception when others then ok := true;
  end;
  assert ok, 'FALLO: Ana ha podido duplicar la dieta de Bruno';
end $$;

-- --- borrar una dieta no toca a sus versiones hijas -------------------------
do $$
declare
  v_persona uuid; v_madre uuid; v_comida uuid; v_hija uuid; v_comp uuid; n integer;
begin
  insert into public.personas (nombre) values ('Persona borrado') returning id into v_persona;
  insert into public.dietas (persona_id, nombre) values (v_persona, 'Madre') returning id into v_madre;
  insert into public.comidas (dieta_id, nombre) values (v_madre, 'Comida') returning id into v_comida;
  insert into public.componentes (comida_id, ingrediente_id, gramos)
    select v_comida, id, 100 from public.ingredientes where codigo_bedca = 'X1'
    returning id into v_comp;

  v_hija := public.guardar_ajuste(
    v_madre, jsonb_build_array(jsonb_build_object('id', v_comp, 'gramos', 80)),
    'Hija', 500, 'prioridades', '{}'::jsonb, '{}'::jsonb, 600, 501);

  delete from public.dietas where id = v_madre;

  select count(*) into n from public.dietas where id = v_hija;
  assert n = 1, 'FALLO: borrar la madre se ha llevado la versión hija por delante';

  select count(*) into n from public.dietas where id = v_hija and dieta_padre_id is null;
  assert n = 1, 'la hija debería quedar sin madre, no apuntando a una dieta borrada';
end $$;

-- --- borrar una persona sí se lleva sus dietas ------------------------------
do $$
declare v_persona uuid; v_dieta uuid; v_comida uuid; n integer;
begin
  insert into public.personas (nombre) values ('Persona en cascada') returning id into v_persona;
  insert into public.dietas (persona_id, nombre) values (v_persona, 'Suya') returning id into v_dieta;
  insert into public.comidas (dieta_id, nombre) values (v_dieta, 'Comida') returning id into v_comida;
  insert into public.componentes (comida_id, ingrediente_id, gramos)
    select v_comida, id, 100 from public.ingredientes where codigo_bedca = 'X1';

  delete from public.personas where id = v_persona;

  select count(*) into n from public.dietas where id = v_dieta;
  assert n = 0, 'borrar la persona debería llevarse sus dietas';
  select count(*) into n from public.comidas where id = v_comida;
  assert n = 0, 'y sus comidas';
  -- por eso la interfaz avisa de cuántas dietas se van a perder antes de borrar
end $$;

reset role;
select 'PRUEBAS DE DUPLICAR Y BORRAR OK' as resultado;
