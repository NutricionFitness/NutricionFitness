-- ============================================================================
-- Pruebas de aislamiento entre usuarios.
--
-- Una política de acceso que «parece correcta» no vale: hay que verla negar el
-- acceso. Estas pruebas crean dos usuarios con sus datos y comprueban que
-- ninguno alcanza los del otro por ninguna vía —ni directa, ni por la vista, ni
-- colando una fila en la dieta ajena, ni cambiándole el dueño a algo propio.
--
-- Cada bloque falla ruidosamente si el resultado no es el esperado.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

-- --- montaje ---------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ana@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'bruno@ejemplo.es')
on conflict do nothing;

-- Catálogo compartido (owner_id NULL), como lo cargará el script de ingesta.
insert into public.ingredientes (owner_id, codigo_bedca, nombre, nombre_norm, prot_100, hc_100, grasa_100)
values (null, 'X1', 'Arroz de prueba', 'arroz de prueba', 7, 78, 0.6),
       (null, 'X2', 'Pollo de prueba', 'pollo de prueba', 22, 0, 2.5);

do $$
declare v_ana uuid := '11111111-1111-1111-1111-111111111111';
begin
  -- datos de Ana
  insert into public.personas (id, owner_id, nombre)
    values ('aaaaaaa1-0000-0000-0000-000000000001', v_ana, 'Persona de Ana');
  insert into public.dietas (id, owner_id, persona_id, nombre)
    values ('aaaaaaa1-0000-0000-0000-000000000002', v_ana,
            'aaaaaaa1-0000-0000-0000-000000000001', 'Dieta de Ana');
  insert into public.comidas (id, dieta_id, nombre, orden)
    values ('aaaaaaa1-0000-0000-0000-000000000003',
            'aaaaaaa1-0000-0000-0000-000000000002', 'Comida', 0);
  insert into public.componentes (comida_id, ingrediente_id, gramos)
    select 'aaaaaaa1-0000-0000-0000-000000000003', id, 100
    from public.ingredientes where codigo_bedca = 'X1';
  insert into public.ingredientes (owner_id, codigo_bedca, nombre, nombre_norm, prot_100, hc_100, grasa_100)
    values (v_ana, 'PROPIO', 'Receta de Ana', 'receta de ana', 5, 5, 5);
end $$;

do $$
declare v_bruno uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into public.personas (id, owner_id, nombre)
    values ('bbbbbbb1-0000-0000-0000-000000000001', v_bruno, 'Persona de Bruno');
  insert into public.dietas (id, owner_id, persona_id, nombre)
    values ('bbbbbbb1-0000-0000-0000-000000000002', v_bruno,
            'bbbbbbb1-0000-0000-0000-000000000001', 'Dieta de Bruno');
  insert into public.comidas (id, dieta_id, nombre, orden)
    values ('bbbbbbb1-0000-0000-0000-000000000003',
            'bbbbbbb1-0000-0000-0000-000000000002', 'Cena', 0);
end $$;

-- --- 1. la energía es una columna generada: no se puede mentir --------------
do $$
declare v numeric;
begin
  select kcal_100 into v from public.ingredientes where codigo_bedca = 'X1';
  assert v = 4*7 + 4*78 + 9*0.6, format('kcal_100 mal calculada: %s', v);
end $$;

do $$
begin
  begin
    execute 'insert into public.ingredientes (codigo_bedca, nombre, nombre_norm, prot_100, hc_100, grasa_100, kcal_100)
             values (''NO'', ''x'', ''x'', 1, 1, 1, 999)';
    raise exception 'FALLO: se ha podido escribir kcal_100 a mano';
  exception when others then
    if sqlstate = 'P0001' then raise; end if;   -- era nuestro propio raise
  end;
end $$;

-- --- 2. las restricciones rechazan datos imposibles -------------------------
do $$
declare intentos text[] := array[
  'insert into public.ingredientes (nombre, nombre_norm, prot_100, hc_100, grasa_100) values (''x'',''x'',-1,0,0)',
  'insert into public.ingredientes (nombre, nombre_norm, prot_100, hc_100, grasa_100, estado) values (''x'',''x'',1,1,1,''inventado'')',
  'insert into public.dietas (owner_id, nombre, modelo_energia) values (''11111111-1111-1111-1111-111111111111'',''d'',''magia'')',
  'insert into public.componentes (comida_id, ingrediente_id, gramos) select ''aaaaaaa1-0000-0000-0000-000000000003'', id, -5 from public.ingredientes limit 1',
  'insert into public.componentes (comida_id, ingrediente_id, gramos, min_g, max_g) select ''aaaaaaa1-0000-0000-0000-000000000003'', id, 10, 90, 10 from public.ingredientes limit 1',
  'insert into public.componentes (comida_id, ingrediente_id, gramos, paso_g) select ''aaaaaaa1-0000-0000-0000-000000000003'', id, 10, 0 from public.ingredientes limit 1',
  'insert into public.perfiles_ajuste (owner_id, nombre, modo) values (''11111111-1111-1111-1111-111111111111'',''p'',''inventado'')',
  'insert into public.perfiles_ajuste (owner_id, nombre, macros_fijos) values (''11111111-1111-1111-1111-111111111111'',''q'',array[''vitaminas''])'
];
  s text;
  ok boolean;
begin
  foreach s in array intentos loop
    ok := false;
    begin execute s; exception when others then ok := true; end;
    assert ok, format('FALLO: la base aceptó algo que no debía -> %s', s);
  end loop;
end $$;

-- --- 3. aislamiento entre usuarios -----------------------------------------
set role authenticated;
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';

do $$
declare n integer;
begin
  select count(*) into n from public.personas;
  assert n = 1, format('Ana debería ver 1 persona, ve %s', n);

  select count(*) into n from public.dietas;
  assert n = 1, format('Ana debería ver 1 dieta, ve %s', n);

  select count(*) into n from public.comidas;
  assert n = 1, format('Ana debería ver 1 comida, ve %s', n);

  select count(*) into n from public.comidas
    where dieta_id = 'bbbbbbb1-0000-0000-0000-000000000002';
  assert n = 0, 'FALLO: Ana ve las comidas de Bruno';

  select count(*) into n from public.v_dietas_totales;
  assert n = 1, format('FALLO: la vista se salta el RLS, Ana ve %s dietas', n);

  -- catálogo compartido (2) + el suyo propio (1); el de Bruno no existe
  select count(*) into n from public.ingredientes;
  assert n = 3, format('Ana debería ver 3 ingredientes, ve %s', n);
end $$;

-- --- 4. no se puede escribir en lo ajeno -----------------------------------
do $$
declare ok boolean;
begin
  -- colar una comida en la dieta de Bruno
  ok := false;
  begin
    insert into public.comidas (dieta_id, nombre)
      values ('bbbbbbb1-0000-0000-0000-000000000002', 'Intrusa');
  exception when others then ok := true; end;
  assert ok, 'FALLO: Ana ha metido una comida en la dieta de Bruno';

  -- colar un componente en la comida de Bruno
  ok := false;
  begin
    insert into public.componentes (comida_id, ingrediente_id, gramos)
      select 'bbbbbbb1-0000-0000-0000-000000000003', id, 50
      from public.ingredientes where codigo_bedca = 'X1';
  exception when others then ok := true; end;
  assert ok, 'FALLO: Ana ha metido un componente en la comida de Bruno';

  -- crear algo poniéndole a Bruno de dueño
  ok := false;
  begin
    insert into public.personas (owner_id, nombre)
      values ('22222222-2222-2222-2222-222222222222', 'Suplantada');
  exception when others then ok := true; end;
  assert ok, 'FALLO: Ana ha creado una persona a nombre de Bruno';

  -- regalarle a Bruno una dieta propia
  ok := false;
  begin
    update public.dietas set owner_id = '22222222-2222-2222-2222-222222222222'
      where id = 'aaaaaaa1-0000-0000-0000-000000000002';
    ok := not found;
  exception when others then ok := true; end;
  assert ok, 'FALLO: Ana ha cambiado el dueño de una dieta';
end $$;

-- --- 5. borrar lo ajeno no borra nada ---------------------------------------
do $$
declare n integer;
begin
  delete from public.personas where id = 'bbbbbbb1-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'FALLO: Ana ha borrado una persona de Bruno';

  delete from public.ingredientes where codigo_bedca = 'X1';
  get diagnostics n = row_count;
  assert n = 0, 'FALLO: Ana ha borrado un ingrediente del catálogo compartido';
end $$;

-- --- 6. lo propio sí se puede tocar -----------------------------------------
do $$
declare n integer;
begin
  update public.dietas set nombre = 'Dieta de Ana v2'
    where id = 'aaaaaaa1-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  assert n = 1, 'Ana no ha podido renombrar su propia dieta';

  insert into public.comidas (dieta_id, nombre)
    values ('aaaaaaa1-0000-0000-0000-000000000002', 'Cena');
  insert into public.personas (nombre) values ('Otra de Ana');   -- owner_id por defecto
  select count(*) into n from public.personas;
  assert n = 2, format('Ana debería ver 2 personas, ve %s', n);
end $$;

-- --- 7. lo mismo desde el otro lado -----------------------------------------
set app.usuario_actual = '22222222-2222-2222-2222-222222222222';

do $$
declare n integer;
begin
  select count(*) into n from public.personas;
  assert n = 1, format('Bruno debería ver 1 persona, ve %s', n);

  select count(*) into n from public.ingredientes;
  assert n = 2, format('Bruno solo debería ver el catálogo compartido, ve %s', n);

  select count(*) into n from public.ingredientes where codigo_bedca = 'PROPIO';
  assert n = 0, 'FALLO: Bruno ve un ingrediente propio de Ana';
end $$;

-- --- 8. sin sesión no se ve nada -------------------------------------------
set app.usuario_actual = '';

do $$
declare n integer;
begin
  select count(*) into n from public.personas; assert n = 0, 'FALLO: sin sesión se ven personas';
  select count(*) into n from public.dietas;   assert n = 0, 'FALLO: sin sesión se ven dietas';
  select count(*) into n from public.componentes; assert n = 0, 'FALLO: sin sesión se ven componentes';
end $$;

reset role;
select 'TODAS LAS PRUEBAS DE RLS PASAN' as resultado;
