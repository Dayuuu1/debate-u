# Debate al Rectorado · UNAMAD

Proyecto completo para **Vercel + PostgreSQL en Neon**, basado en HTML, CSS y JavaScript, con una API de Node.js. No requiere React ni ChatGPT para funcionar.

## Qué incluye

- Panel de moderación protegido por contraseña.
- Tres cronómetros independientes; solo un candidato puede tener un turno activo.
- Iniciar, pausar, reiniciar, sumar o restar segundos.
- Foto, flyer, nombre, cargo, color y diseño por candidato.
- Tótems verticales 9:16 con modo claro/oscuro y fondos institucionales.
- Enlaces de solo lectura para equipos diferentes.
- Configuración e imágenes guardadas en PostgreSQL.
- Acciones basadas en la hora del servidor, con control de versiones para evitar sobrescrituras simultáneas.
- Scripts de instalación, archivo SQL, pruebas automáticas y configuración de Vercel.

**Esta entrega es una copia independiente. No modifica el sitio anterior.** Los datos personalizados del navegador de la versión anterior no se migran automáticamente: carga otra vez los nombres y las fotos en esta instalación.

## 1. Requisitos

- Node.js 24 (`package.json` fija `24.x`; Vercel usa esa versión automáticamente).
- Cuenta de Neon: <https://console.neon.tech>.
- Cuenta de Vercel y, para el flujo recomendado, un repositorio de GitHub.

## 2. Crear la base de datos

1. Crea un proyecto PostgreSQL en Neon en la región **AWS US East 1 (N. Virginia)**. `vercel.json` ejecuta la API en `iad1` (Washington, D.C.); base y API en la misma zona evitan demoras en cada consulta.
2. Pulsa **Connect** y copia la cadena de conexión PostgreSQL. Puede ser la conexión con pooling.
3. Esa cadena será `DATABASE_URL`. Conserva `sslmode=require` si viene incluido.

Si tu base ya existe en otra región, cambia `"regions"` en `vercel.json` por la más cercana: São Paulo (`aws-sa-east-1`) → `gru1`; Ohio (`aws-us-east-2`) → `cle1`; Oregón (`aws-us-west-2`) → `pdx1`; Fráncfort (`aws-eu-central-1`) → `fra1`.

El adaptador de esta entrega usa el driver HTTP de **Neon**. Para PostgreSQL de otro proveedor hay que cambiar `lib/db.mjs` por un adaptador compatible; no basta con reemplazar la URL.

## 3. Configurar y ejecutar en tu PC

Descomprime el ZIP y abre una terminal en la carpeta que contiene `package.json`.

```bash
npm install
```

Si no existe `.env.local`, créalo a partir del ejemplo y genera una clave con `npm run secret`:

```powershell
Copy-Item .env.example .env.local   # PowerShell
cp .env.example .env.local          # macOS/Linux
npm run secret
```

Abre `.env.local` con tu editor y completa:

```dotenv
DATABASE_URL=postgresql://usuario:clave@tu-host.neon.tech/neondb?sslmode=require
ADMIN_PASSWORD="tu-contraseña-de-al-menos-12-caracteres"
SESSION_SECRET="pega-la-clave-generada-con-npm-run-secret"
```

Estas variables son privadas del servidor. No uses prefijos `VITE_` ni `NEXT_PUBLIC_`.

Prepara la base de datos y levanta el servidor:

```bash
npm run db:setup
npm run dev
```

Abre **http://localhost:3000** e ingresa con `ADMIN_PASSWORD`.

`db:setup` crea las tablas e inserta el debate inicial si no existe. Se puede volver a ejecutar: no borra la configuración existente. No abras `public/index.html` con doble clic; necesita la API.

## 4. Subir a Vercel

1. Crea un repositorio de GitHub con el contenido de esta carpeta. No subas `.env.local` ni `node_modules`; `.gitignore` ya los excluye.
2. En Vercel, elige **Add New → Project** e importa el repositorio.
3. Selecciona **Other** como framework y la carpeta que contiene `package.json` como raíz.
4. Verifica: **Build Command:** `npm run build`; **Output Directory:** `public`; **Install Command:** `npm install` (o `npm ci`). El archivo `vercel.json` ya declara la configuración principal.
5. En **Environment Variables**, añade `DATABASE_URL`, `ADMIN_PASSWORD` y `SESSION_SECRET` para **Production**. Usa los mismos valores de `.env.local`.
6. Despliega. Si agregaste variables después, realiza un nuevo despliegue.

La base de datos debe estar inicializada antes de entrar al panel. Si `npm run db:setup` apuntó a la misma `DATABASE_URL`, ya está preparada.

Abre los tótems con el **dominio de producción** (por ejemplo `https://tu-proyecto.vercel.app`). Las URL de Preview están protegidas por defecto con el inicio de sesión de Vercel y un tótem no podría abrirlas.

Para probar previews de Vercel sin afectar el debate real, usa otra base de datos o una rama de Neon y sus variables para Preview. Si conectaste Neon desde el Marketplace de Vercel, revisa que Preview no comparta la `DATABASE_URL` de producción.

`.vercelignore` excluye pruebas, documentación y los PNG originales de los fondos: el sitio usa las versiones WebP (unos 70–100 KB en lugar de 1,7 MB).

## 5. Conectar los tótems

1. Entra al panel y configura los candidatos, tiempos y diseños.
2. Pulsa **Enlaces de tótems**.
3. Copia el enlace del candidato 1 y ábrelo en el navegador del primer tótem. Repite con los otros dos.
4. Configura las pantallas en orientación vertical y pulsa **Pantalla completa**.
5. Abre el panel del moderador unos minutos antes de empezar. Cada tótem está listo cuando su tarjeta en el panel indica **● Conectada** (puede tardar hasta 30 segundos).
6. Inicia y pausa los turnos desde el panel del moderador.

Desactiva la suspensión y el protector de pantalla en los equipos de los tótems.

Los tótems pueden estar en equipos distintos. Cada equipo necesita acceso al sitio y conexión a Internet; no es necesario que todos estén en la misma red local.

Para probar con equipos distintos mientras desarrollas en tu PC, usa un despliegue de Vercel. Un enlace `localhost` apunta a cada equipo local y no a la computadora del moderador.

Los enlaces de tótem permiten leer el estado y las imágenes, **no modificar el debate**. Son válidos durante 30 días. Al abrirse, el token se retira de la barra de direcciones y se conserva en esa pestaña. Para compartir, usa siempre el botón del panel, no la URL que queda en el tótem después de abrirlo. Para invalidar todos los enlaces y sesiones, cambia `SESSION_SECRET` en Vercel y vuelve a desplegar.

## 6. Sincronización y límites prácticos

- Mientras el panel del moderador está abierto (o lo estuvo en los últimos 10 minutos), cada pantalla consulta el servidor cada segundo. Una acción puede tardar alrededor de un segundo más la latencia de red en llegar a los tótems. No es un sistema de sincronización audiovisual por fotogramas.
- Sin panel abierto, los tótems consultan cada 30 segundos y muestran «esperando el panel del moderador»; nadie más puede cambiar el debate. Al abrir el panel vuelven a 1 segundo en un máximo de 30 segundos.
- El panel entra en reposo tras 3 horas sin uso del mouse o el teclado y sin ningún turno corriendo. Deja de consultar el servidor hasta que muevas el mouse o pulses una tecla.
- Cada consulta de estado es una sola petición a la base de datos.
- El servidor fija la hora de vencimiento. Cada navegador calcula la cuenta regresiva usando una compensación de reloj; no se escribe un registro por cada décima de segundo.
- Si se corta Internet, la pantalla continúa la última cuenta regresiva recibida y muestra un aviso. No recibe cambios nuevos hasta reconectar. El panel bloquea controles mientras está desconectado.
- El tiempo no se pausa automáticamente si se cierra el moderador: conserva la hora de vencimiento. Al volver a abrir, se recupera el estado de la base de datos.
- Dos paneles autorizados pueden ver el debate. Si mandan acciones simultáneas, una se confirma y la otra recibe un aviso para revisar el estado; no se reintentan comandos automáticamente.
- El aviso sonoro sale del navegador del moderador, después de una interacción. No silencia micrófonos ni controla una consola de audio.
- Las imágenes se reducen a un máximo de 2160 píxeles por lado y se comprimen antes de enviarse. El archivo comprimido debe pesar menos de 2 MB. Se guardan en PostgreSQL para no depender de otro servicio de almacenamiento.
- Las cargas antiguas se conservan aunque se reemplace una foto. Para grandes volúmenes conviene migrar archivos a un servicio de objetos y almacenar solo la referencia en PostgreSQL.
- El sondeo genera peticiones a Vercel y consultas a Neon: con 4 pantallas activas son unas 14 400 por hora. Aun con las consultas reducidas, las pestañas abiertas impiden que Neon se suspenda. Cierra paneles y tótems cuando termine el evento; revisa las cuotas vigentes de tus planes.

## 7. Archivos principales

| Ruta | Función |
| --- | --- |
| `public/index.html` | Interfaz, formularios y acceso |
| `public/app.js` | Controles del moderador y vistas de tótems |
| `public/cloud.js` | Comunicación con API, sincronización y enlaces |
| `public/totem.js` | Composición visual y carga de imágenes |
| `public/*.css` | Diseño, temas e identidad UNAMAD |
| `public/assets/` | Logos y fondos incluidos |
| `api/debate.js` | Entrada de la función de Vercel |
| `lib/handler.mjs` | Rutas, permisos, imágenes y comandos |
| `lib/state.mjs` | Reglas de tiempo y validaciones |
| `lib/repository.mjs` | Consultas SQL y control de versiones |
| `lib/db.mjs` | Adaptador de Neon |
| `lib/auth.mjs` | Contraseña, cookie y tokens de tótem |
| `db/001_initial.sql` | Tablas PostgreSQL |
| `scripts/setup-db.mjs` | Inicialización de tablas y primer debate |
| `vercel.json` | Configuración del despliegue |
| `.env.example` | Variables que debes completar |

## 8. Verificaciones

```bash
npm test
npm run build
```

Las pruebas de API usan PGlite (motor PostgreSQL local de pruebas) y no requieren tus credenciales. Cubren permisos, contraseña, tokens, vencimientos, pausas, conflictos entre paneles, imágenes y persistencia. También hay pruebas de interacción de la interfaz con un DOM simulado; no sustituyen una prueba visual en un navegador. El build comprueba la sintaxis y los recursos del proyecto.

La entrega no incluye una cuenta de Neon configurada ni un despliegue de Vercel en tu cuenta. Debes completar esas variables. La conexión real a Neon y la validación visual en tus monitores se realizan después de desplegar.

## Solución rápida de problemas

| Mensaje | Qué revisar |
| --- | --- |
| Falta configurar variables | Completa las tres variables; la clave de sesión debe tener 32 caracteres o más y la contraseña al menos 12. Redeploy en Vercel. |
| No se pudo acceder a la base | Revisa `DATABASE_URL`, ejecuta `npm run db:setup` y comprueba que la base esté disponible. |
| Contraseña incorrecta | Usa el valor de `ADMIN_PASSWORD` del entorno desplegado, no tu cuenta de Vercel. |
| Enlace de tótem inválido | Genera y copia un enlace nuevo desde el panel. |
| Una acción no se confirmó | Revisa el estado que llegó del servidor antes de repetir; pudo haberse confirmado durante un corte de red. |
| Las fotos anteriores no aparecen | La versión antigua guardaba imágenes en el navegador de otro sitio. Súbelas de nuevo a esta instalación. |
| No abre una ventana | Permite ventanas emergentes o utiliza «Enlaces de tótems». |

Documentación de referencia: [Vercel Functions](https://vercel.com/docs/functions/runtimes/node-js), [vercel.json](https://vercel.com/docs/project-configuration/vercel-json), [Neon Serverless Driver](https://github.com/neondatabase/serverless).
