-- Pruebas de medidas caseras y equivalencias de cocción.
\set ON_ERROR_STOP on

-- Datos de partida: dos ingredientes del catálogo compartido.
insert into public.ingredientes (owner_id, codigo_bedca, nombre, nombre_norm,
                                 prot_100, hc_100, grasa_100, agua_100, estado)
values (null, 'ARZ-C', 'Arroz de prueba, crudo',  'arroz de prueba crudo',  7, 78, 0.6, 12, 'crudo'),
       (null, 'ARZ-H', 'Arroz de prueba, hervido','arroz de prueba hervido', 2.4, 28, 0.2, 70, 'cocido');

insert into public.medidas_caseras (ingrediente_id, owner_id, nombre, gramos)
select id, null, 'cazo (en crudo)', 70 from public.ingredientes where codigo_bedca = 'ARZ-C';

insert into public.equivalencias_coccion
  (ingrediente_crudo_id, ingrediente_cocido_id, factor, agua_crudo, agua_cocido)
select cr.id, co.id, round((100-12)::numeric / (100-70), 3), 12, 70
  from public.ingredientes cr, public.ingredientes co
 where cr.codigo_bedca = 'ARZ-C' and co.codigo_bedca = 'ARZ-H';

-- --- restricciones ----------------------------------------------------------
do $$
declare s text; ok boolean;
declare intentos text[] := array[
  'insert into public.medidas_caseras (ingrediente_id, nombre, gramos) select id, ''x'', 0 from public.ingredientes limit 1',
  'insert into public.medidas_caseras (ingrediente_id, nombre, gramos) select id, ''x'', -5 from public.ingredientes limit 1',
  'insert into public.medidas_caseras (ingrediente_id, nombre, gramos) select id, ''  '', 10 from public.ingredientes limit 1',
  'insert into public.equivalencias_coccion (ingrediente_crudo_id, ingrediente_cocido_id, factor) select id, id, 2 from public.ingredientes limit 1',
  'insert into public.equivalencias_coccion (ingrediente_crudo_id, ingrediente_cocido_id, factor) select (select id from public.ingredientes where codigo_bedca=''ARZ-C''), (select id from public.ingredientes where codigo_bedca=''ARZ-H''), 99'
];
begin
  foreach s in array intentos loop
    ok := false;
    begin execute s; exception when others then ok := true; end;
    assert ok, format('FALLO: la base aceptó algo que no debía -> %s', s);
  end loop;
end $$;

-- --- no se puede repetir la misma medida para el mismo ingrediente ----------
do $$
declare ok boolean := false;
begin
  begin
    insert into public.medidas_caseras (ingrediente_id, owner_id, nombre, gramos)
    select id, null, 'cazo (en crudo)', 80 from public.ingredientes where codigo_bedca = 'ARZ-C';
  exception when others then ok := true; end;
  assert ok, 'FALLO: se ha podido duplicar la medida de serie';
end $$;

-- --- el factor derivado tiene sentido ---------------------------------------
do $$
declare f numeric;
begin
  select factor into f from public.equivalencias_coccion;
  -- 88 g de materia seca en crudo, 30 en cocido -> casi 3 g cocidos por g crudo
  assert abs(f - 2.933) < 0.01, format('el factor debería rondar 2,93 y es %s', f);
end $$;

-- --- acceso -----------------------------------------------------------------
set role authenticated;
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';

do $$
declare n integer; v_ing bigint;
begin
  select id into v_ing from public.ingredientes where codigo_bedca = 'ARZ-C';

  -- las medidas de serie las ve todo el mundo
  select count(*) into n from public.medidas_caseras where ingrediente_id = v_ing;
  assert n = 1, format('Ana debería ver la medida de serie, ve %s', n);

  -- puede añadir la suya
  insert into public.medidas_caseras (ingrediente_id, nombre, gramos, owner_id)
  values (v_ing, 'mi cazo', 85, auth.uid());
  select count(*) into n from public.medidas_caseras where ingrediente_id = v_ing;
  assert n = 2, 'Ana no ve su propia medida';

  -- pero no puede tocar la de serie
  update public.medidas_caseras set gramos = 999 where owner_id is null;
  get diagnostics n = row_count;
  assert n = 0, 'FALLO: Ana ha modificado una medida de serie';

  delete from public.medidas_caseras where owner_id is null;
  get diagnostics n = row_count;
  assert n = 0, 'FALLO: Ana ha borrado una medida de serie';

  -- ni crear una a nombre de otro
  begin
    insert into public.medidas_caseras (ingrediente_id, nombre, gramos, owner_id)
    values (v_ing, 'ajena', 50, '22222222-2222-2222-2222-222222222222');
    raise exception 'FALLO: Ana ha creado una medida a nombre de Bruno';
  exception when others then
    if sqlstate = 'P0001' then raise; end if;
  end;

  -- las equivalencias se leen
  select count(*) into n from public.equivalencias_coccion;
  assert n = 1, 'no se ven las equivalencias';
end $$;

-- --- lo que añade Ana no lo ve Bruno ----------------------------------------
set app.usuario_actual = '22222222-2222-2222-2222-222222222222';
do $$
declare n integer;
begin
  select count(*) into n from public.medidas_caseras where nombre = 'mi cazo';
  assert n = 0, 'FALLO: Bruno ve una medida propia de Ana';
  select count(*) into n from public.medidas_caseras where owner_id is null;
  assert n = 1, 'Bruno debería seguir viendo las de serie';
end $$;

reset role;
select 'PRUEBAS DE MEDIDAS Y EQUIVALENCIAS OK' as resultado;
