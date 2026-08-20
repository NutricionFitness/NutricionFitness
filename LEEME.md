# Fase 4 — Supabase y la aplicación

La app completa: esquema con control de acceso, catálogo de ingredientes,
autenticación y las pantallas de personas, dietas y ajuste.

**El motor corre en el navegador.** Mover el control de kilocalorías no consulta
al servidor: recalcula el ajuste entero y pinta la propuesta al momento.

```
npm install
cp .env.example .env.local        # y rellenas las claves de Supabase
npm run cargar-ingredientes       # sube los 2.157 ingredientes (una vez)
npm run dev
```

---

## Puesta en marcha, paso a paso

### 1. Proyecto en Supabase

En [supabase.com](https://supabase.com), proyecto nuevo. **Elige región europea**
(Frankfurt o Ireland): vas a guardar dietas de personas identificadas desde
España, y tenerlo en la UE te ahorra toda una conversación sobre transferencias
internacionales de datos.

### 2. Migraciones

En el **SQL Editor** de Supabase, ejecuta en este orden:

1. `supabase/migraciones/0001_esquema.sql`
2. `supabase/migraciones/0002_guardar_ajuste.sql`
3. `supabase/migraciones/0003_linaje.sql`

Si ya tenías la base creada de antes, te basta con ejecutar la que falte: cada
migración es independiente y se puede volver a ejecutar sin romper nada.

No ejecutes nada de `supabase/pruebas/`: eso es el andamio para probar en local.

### 3. Claves

De **Project Settings → API** a tu `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

La `service_role` **solo** la usa el script de carga. Nunca va al navegador ni
al repositorio: se salta el control de acceso por diseño.

### 4. Catálogo de ingredientes

```
npm run cargar-ingredientes
```

Sube los 2.157 ingredientes utilizables de la fase 1 con `owner_id` nulo, que es
como se marca el catálogo compartido: lo lee cualquiera que haya entrado, no lo
modifica nadie. Es idempotente, puedes relanzarlo.

Al terminar comprueba que la base calcula bien la energía de un ingrediente
conocido. Si eso falla, algo se ha cargado mal y lo dice.

### 5. Tu usuario

La app entra con **correo y contraseña**. El registro público está cerrado a
propósito: es tu herramienta de trabajo, no un servicio abierto.

En Supabase, **Authentication → Providers → Email**:

- *Enable Email provider*: activado.
- *Confirm email*: puedes dejarlo activado; da igual, porque el usuario lo vas a
  crear tú ya confirmado.

En **Authentication → Users → Add user → Create new user**:

- Correo y contraseña.
- Marca **Auto Confirm User**. Si no lo marcas, no podrás entrar hasta confirmar
  desde un correo.

Y en **Authentication → Providers → Email**, desactiva *Allow new users to sign
up*: sin eso, cualquiera que dé con la URL puede crearse una cuenta.

Para más adelante, si necesitas dar acceso a alguien más, es el mismo camino:
crear el usuario desde el panel. Cada usuario ve solo sus personas y sus dietas
—eso es lo que garantizan las políticas de acceso, y está probado—.

**Solo hay un momento en que la app manda un correo**: cuando pulsas «He olvidado
la contraseña». Para que ese enlace funcione, en **Authentication → URL
Configuration** añade a *Redirect URLs*:

```
http://localhost:3000/auth/callback
https://TU-APP.vercel.app/auth/callback
```

La sesión se mantiene: no tienes que entrar cada vez que abres la app. Si quieres
que dure más antes de pedirte la contraseña otra vez, sube *JWT expiry* en
**Authentication → Sessions**.

### 6. Vercel

Importas el repositorio, pegas las dos variables `NEXT_PUBLIC_*` (la
`service_role` **no**), y eliges región europea también aquí. A partir de ahí,
`git push` despliega.

---

## Lo que hay dentro

```
supabase/
  migraciones/0001_esquema.sql          tablas, restricciones, RLS
  migraciones/0002_guardar_ajuste.sql   guardar un ajuste como versión nueva
  migraciones/0003_linaje.sql           árbol de versiones y totales por comida
  pruebas/                              andamio y pruebas contra PostgreSQL local
  datos/ingredientes.json.gz            catálogo de la fase 1
scripts/cargar-ingredientes.mjs
lib/
  motor/          el motor de la fase 3, sin tocar
  dominio/        conversión filas ↔ motor y comparador  (28 tests)
  supabase/       clientes de navegador y servidor
app/
  login, cuenta, personas, personas/[id], dietas/[id],
  dietas/[id]/historial, comparar, ingredientes
components/
  EditorDieta.tsx          la pantalla de trabajo
  DietaVacia.tsx           una dieta recién creada, antes del primer ingrediente
  BuscadorIngrediente.tsx
  FormularioContrasena.tsx
middleware.ts              refresca la sesión y cierra el paso
```

---

## Decisiones que merecen explicación

### La energía la calcula la base

`ingredientes.kcal_100` es una **columna generada**:

```sql
kcal_100 numeric generated always as
  (4*prot_100 + 4*hc_100 + 9*grasa_100 + 7*alcohol_100) stored
```

No se puede escribir a mano —hay una prueba que lo intenta y comprueba que la
base lo rechaza—, así que no puede desincronizarse de los macros. Es el
principio del concepto («la energía se calcula, nunca se almacena») aplicado
donde de verdad se sostiene solo.

### El control de acceso se probó, no se supuso

Una política que «parece correcta» no vale. Las pruebas montan dos usuarios con
sus datos y comprueban que ninguno alcanza los del otro: ni leyendo, ni por la
vista de totales, ni colando una comida en la dieta ajena, ni creando algo a
nombre de otro, ni regalando una dieta propia cambiándole el dueño.

Y hay un **control negativo**: si se afloja una política a propósito, las pruebas
fallan. Una batería que pasa siempre no demuestra nada.

Un detalle que se escapa fácil: las vistas de PostgreSQL se ejecutan por defecto
con los permisos de quien las creó, así que `v_dietas_totales` lleva
`security_invoker = true`. Sin eso sería un agujero por el que se ven los
totales de las dietas de otros.

### Guardar un ajuste es una sola transacción

Crear la dieta hija, copiar sus comidas, copiar los componentes con los gramos
nuevos y anotar el historial son cinco escrituras. Hechas desde el cliente, que
falle la tercera deja una dieta a medias. Están dentro de `guardar_ajuste()`, con
`SECURITY INVOKER` para que el control de acceso siga aplicando —una función
`SECURITY DEFINER` aquí permitiría clonar la dieta de cualquiera—.

Hay una prueba que corta a mitad y comprueba que no queda nada suelto.

### Correo y contraseña, no enlace mágico

La primera versión entraba con un enlace enviado al correo. Sobre el papel es más
seguro —no hay contraseña que robar— pero en la práctica significaba pedir el
correo y esperar un mensaje cada vez, y eso para una herramienta que se abre
varias veces al día es un peaje absurdo.

Ahora es usuario y contraseña, con el registro público cerrado. El mensaje de
error al fallar es genérico a propósito: distinguir «ese correo no existe» de «la
contraseña no es esa» le diría a un desconocido qué cuentas hay dadas de alta.

### Los `numeric` de PostgreSQL llegan como cadenas

Es la trampa más silenciosa de todas. PostgreSQL serializa `numeric` como texto
para no perder precisión, así que `"80" + "10"` da `"8010"` en vez de `90`. Todo
número pasa por `aNumero()`, que además rechaza nulos y basura en vez de dejar
correr un `NaN` que reaparecería tres pantallas más allá. Hay un test que fija
esa avería para que nadie la reintroduzca.

### El orden de los componentes es la clave para guardar

El motor devuelve los resultados en el mismo orden en que recibe la dieta, y ese
orden es lo que permite volver a casar cada gramaje con su fila. Por eso `aDieta`
ordena de forma estable y devuelve los ids en paralelo, y `gramosAGuardar`
**revienta** si las longitudes no coinciden. Guardar gramos cruzados en silencio
sería el peor fallo posible de esta aplicación.

### Comparar versiones es un problema de emparejar, no de restar

Al guardar un ajuste se **clona** la dieta, así que la versión nueva tiene los
mismos alimentos con identificadores distintos. Emparejar por id no sirve de
nada: hay que casarlos por comida e ingrediente, y contemplar que entre una
versión y otra se haya añadido o quitado algo, porque nada impide editar una
versión después de crearla.

`compararDietas()` hace eso, incluido el caso de que el mismo alimento aparezca
dos veces en la misma comida —se emparejan en orden de aparición—. Son 10 tests,
uno de ellos comprobando que comparar en el sentido contrario invierte los
signos.

### El linaje se recorre en dos pasos

Las versiones forman un árbol encadenado por `dieta_padre_id`. Desde la versión
3 quieres ver también de dónde viene, no solo lo que cuelga de ella, así que
`linaje_dieta()` primero sube hasta la raíz y luego baja recogiéndolo todo. Con
`SECURITY INVOKER`, para que nadie vea el linaje de otro —probado en los dos
sentidos—.

### Una dieta nueva nace con sus cinco comidas

Crear una dieta y encontrarse una pantalla en blanco es un mal comienzo. Se
crean desayuno, media mañana, comida, merienda y cena.

---

## Probar el esquema en local

Sin tocar Supabase, contra un PostgreSQL cualquiera:

```bash
psql -d appnut -f supabase/pruebas/00_stub_auth.sql        # imita el esquema auth
psql -d appnut -f supabase/migraciones/0001_esquema.sql
psql -d appnut -f supabase/migraciones/0002_guardar_ajuste.sql
psql -d appnut -f supabase/pruebas/01_rls.sql              # aislamiento
psql -d appnut -f supabase/pruebas/02_guardar_ajuste.sql   # versionado
```

`00_stub_auth.sql` imita lo mínimo del esquema `auth` de Supabase (la tabla de
usuarios y `auth.uid()`) para poder ejercitar las políticas de verdad. **No lo
subas a Supabase**: allí ya existe.

---

## Qué falta

- **Medidas caseras y factores crudo↔cocido**: 1 huevo = 53 g comestibles,
  arroz crudo → cocido. Quita la fuente de error más común del día a día.
- **Sustitución de ingredientes**: la función que resuelve el techo del reparto
  de macros que encontramos en la fase 0.
- **Pulido**: renombrar y borrar dietas y personas, límites mínimo y máximo por
  componente, reordenar.
