# MUGA — Posicionamiento, Atributos Competitivos y Direccion de UI

*Generado: 2026-03-23*

---

# 1. POSICIONAMIENTO ESTRATEGICO

## 1.1 La propuesta de valor en una frase

> **"Las features de Bitly Premium por el precio de una cerveza al mes."**

MUGA no compite por ser el shortener mas barato (Short.io ya ofrece $5/mes). Compite por ser el que da MAS VALOR por dolar gastado, con la extension de navegador como puerta de entrada gratuita.

## 1.2 Tres pilares de posicionamiento

### Pilar 1 — Browser-Native (Extension como core, no como add-on)

Ningun competidor nacio con la extension como el centro del producto. T.LY la anadio despues. Bitly la tiene rota. Dub.co no tiene ninguna.

MUGA ya tiene una extension funcional con 380 tests que limpia URLs. Esa extension es el gancho: el usuario la instala por la limpieza → descubre el shortening → eventualmente paga.

**Mensaje**: "Tu primer contacto con MUGA es una extension que hace tu navegacion mas limpia. El shortening viene gratis con ella."

### Pilar 2 — Radical Transparency in Pricing

Los competidores juegan a confundir:
- Bitly tiene 6+ variables de pricing (links, QR codes, landing pages, back-halves, redirects, API calls)
- Rebrandly tiene "engagement data points" (nadie sabe que es)
- Dub.co cobra por "tracked events" (no es lo mismo que clicks)

MUGA tiene UN SOLO eje: **links/mes**. Todo lo demas es ilimitado en cada tier.

**Mensaje**: "Sin trucos. Sin limites ocultos. Un precio, todo incluido."

### Pilar 3 — Premium Feel, Indie Price

El diseno y la experiencia deben sentirse como Vercel o Linear (productos premium que generan confianza), pero el precio es indie ($9/mes).

**Mensaje**: "Parece caro. Cuesta $9."

## 1.3 Tabla de posicionamiento vs competidores

| Atributo | Bitly | T.LY | Dub.co | MUGA |
|----------|-------|------|--------|------|
| **Percepcion** | Corporativo, caro | Indie, barato | Dev-tool, moderno | Premium, accesible |
| **Punto de entrada** | Web signup | Extension | GitHub/PH | Extension (limpieza URLs) |
| **Fortaleza** | Brand recognition | Precio bajo | Open source | Extension nativa + valor/precio |
| **Debilidad** | Precio abusivo | UX amateur | Sin extension | Marca desconocida |
| **Audiencia** | Enterprise | Solo-preneurs | Developers | Marketers + Devs + Agencias |

## 1.4 Enemigo publico: el "tracking tax"

MUGA tiene un narrativa natural que ningun competidor puede copiar:

> "Las URLs estan rotas. Llenas de tracking, referrals, y basura. Nosotros las limpiamos gratis. Y cuando necesitas acortarlas, te damos analytics de verdad sin cobrarte $300/mes."

Esta narrativa conecta la extension (limpieza) con el SaaS (shortening + analytics) de forma organica.

---

# 2. ATRIBUTOS COMPETITIVOS DEL SERVICIO

## 2.1 Atributos que DEBE tener la web (marketing site)

### A. Velocidad percibida
- **Target**: Lighthouse score >95 en mobile
- **Como**: Next.js con Static Generation para paginas de marketing, imagenes en WebP/AVIF, zero JS innecesario
- **Por que**: Dub.co tiene una web rapida. Bitly y Rebrandly son lentas. La velocidad ES el mensaje para un producto que promete <20ms de redireccion.

### B. Demo interactiva sin signup
- **Target**: El usuario puede acortar 1 URL sin crear cuenta
- **Como**: Input field en el hero que acorta una URL real y muestra el resultado inmediatamente
- **Por que**: T.LY hace esto y convierte usuarios curiosos. Bitly requiere signup. Reducir friccion al maximo.

### C. Comparativas agresivas pero honestas
- **Target**: 5 paginas /vs/ con datos reales de competidores
- **Como**: Tablas de comparacion con precios actualizados, links a fuentes
- **Por que**: SEO de alta intencion de compra ("bitly alternative", "tly alternative"). Dub.co ya hace esto bien — MUGA debe hacerlo mejor.

### D. Pricing cristalino
- **Target**: Un usuario entiende los 3 planes en <10 segundos
- **Como**: 3 columnas, un numero grande (links/mes), todo lo demas "incluido"
- **Por que**: Rebrandly necesita una tabla de 20 filas. MUGA necesita 5. La simplicidad VENDE.

### E. Proof points inmediatos
- **Target**: Credibilidad antes de signup
- **Como**: Numero de extension installs (counter real), velocidad de redirect demostrada (widget live), logos de "as seen on" cuando se tengan
- **Por que**: MUGA es nueva — necesita trust signals desde el dia 1.

### F. Blog como maquina SEO
- **Target**: 20 articulos en los primeros 6 meses
- **Como**: MDX con Next.js, imagenes OG auto-generadas, schema markup
- **Por que**: T.LY crecio por SEO. Bitly domina long-tail. MUGA necesita content marketing desde el Sprint 4.

## 2.2 Atributos que DEBE tener el servicio (producto)

### A. Redireccion sub-20ms
- **Como**: Cloudflare Workers + KV en edge global
- **Por que**: Es el atributo tecnico mas facil de demostrar y mas dificil de rebatir. Bitly tarda 131ms. MUGA tarda <20ms. Eso se puede mostrar en la landing con un test en vivo.

### B. Analytics sin paywall
- Geo (pais, ciudad), dispositivo, browser, OS, referrer — en TODOS los planes incluyendo Free
- **Por que**: Bitly cobra $199/mes por analytics de ciudad. Es el gap mas grande del mercado.

### C. Links que nunca expiran
- En el plan Free, los links son permanentes. Sin ads intersticiales. Sin bait-and-switch.
- **Por que**: T.LY expira links gratuitos. Bitly pone ads. MUGA no hace ninguna de las dos cosas. Trust diferenciador.

### D. Extension que da valor diario
- La extension limpia URLs SIEMPRE (gratis, sin cuenta). El shortening es el bonus.
- **Por que**: T.LY prueba que una extension popular genera 450K usuarios organicos. Pero su extension solo acorta — no da valor diario. MUGA si.

### E. API desde el dia 1
- REST API documentada con OpenAPI spec, SDKs en TypeScript/Python, rate limiting transparente
- **Por que**: Los developers son los mejores evangelistas. Dub.co lo sabe y sus SDKs en 5 lenguajes son parte de su exito.

### F. Dominio limpio sin spam
- Monitoreo proactivo de links abusivos, blacklist de dominios de phishing, tasa de abuso <0.1%
- **Por que**: rebrand.ly esta bloqueado en Facebook. bit.ly esta bloqueado en firewalls corporativos. t.ly esta bloqueado por admins de red. mug.ag debe mantenerse limpio.

### G. Uptime >99.9%
- Cloudflare Workers tiene SLA global. Supabase tiene 99.9% en Pro. No necesitamos infra propia.
- **Por que**: Replug desactivo cuentas sin aviso. Short.io banea cuentas de forma agresiva. La fiabilidad es table stakes.

---

# 3. FASES DE DESARROLLO (DETALLADAS)

## Fase 0 — Foundation (Semana 1)

**Entregable**: Monorepo funcional, Worker de redireccion en mug.ag, KV con link de prueba.

| Tarea | Detalle | Criterio de done |
|-------|---------|-----------------|
| Monorepo Turborepo | pnpm workspaces, apps/web + apps/worker + apps/extension | `pnpm build` sin errores |
| Cloudflare Worker | Handler de redireccion con KV lookup | `wrangler dev` + localhost/test redirige |
| Supabase schema | 15 tablas con RLS, migrations, types generados | Schema visible en Supabase dashboard |
| DNS mug.ag | Route en CF Workers, SSL Full Strict | `curl -I mug.ag/test` → 301 |

## Fase 1 — MVP cobrable (Semanas 2-3)

**Entregable**: Un usuario puede registrarse, crear links, ver clicks, y pagar Pro.

| Tarea | Detalle | Criterio de done |
|-------|---------|-----------------|
| Auth (Clerk) | Signup, login, webhook sync con Supabase | Usuario aparece en DB tras registro |
| Dashboard links | Crear link, listar, copiar, paginar | CRUD funcional, slug aleatorio si no se proporciona |
| Analytics asincrono | ctx.waitUntil() en Worker, CF Analytics Engine | Click registrado en Analytics Engine |
| Stripe checkout | Plan Pro $9/mes, webhooks, customer portal | Checkout → pago → plan actualizado |
| Landing page | Hero + features + pricing + CTA | muga.link carga en <2s, Lighthouse >90 |
| Deploy | CF Pages (web) + Workers (redirect) | End-to-end funcional en produccion |

## Fase 2 — Paridad competitiva (Semanas 4-6)

**Entregable**: Analytics graficos, custom domains, QR codes, API publica, extension integrada.

| Tarea | Detalle | Criterio de done |
|-------|---------|-----------------|
| Analytics dashboard | Graficos timeseries, geo, dispositivos, referrers | Pagina /analytics con datos reales |
| Custom domains | Add domain, verify DNS, CF Custom Hostnames | Link en custom domain redirige |
| QR codes | Generacion SVG/PNG, sin marca de agua | Download funcional, preview en dashboard |
| API keys | CRUD de keys, auth por Bearer token, rate limiting | curl con API key crea un link |
| Extension + cuenta | Login por API key, shortening via API | Extension acorta URL con cuenta conectada |

## Fase 3 — Diferenciacion (Semanas 7-10)

**Entregable**: Features que ningun competidor ofrece en el mismo rango de precio.

| Tarea | Detalle | Criterio de done |
|-------|---------|-----------------|
| Retargeting pixels | Meta/Google pixel fires via HTML interstitial | Pixel aparece en Meta Events Manager |
| Smart links | Geo-redirect (CF headers) + device-redirect (UA) | US→url1, DE→url2 funcional |
| Workspaces | Multi-workspace, invitaciones, roles | 2 usuarios en 1 workspace ven mismos links |
| CTA overlays | Banner basico via interstitial (no iframe) | CTA visible sobre pagina destino |
| Plan Agency | Stripe product, 10 workspaces, 10 usuarios | Checkout Agency funcional |

## Fase 4 — Traccion (Semanas 11-16)

**Entregable**: SEO implementado, contenido publicado, extension en stores, email onboarding.

| Tarea | Detalle | Criterio de done |
|-------|---------|-----------------|
| SEO tecnico | sitemap, robots, schema, OG tags, canonicals | Google Search Console sin errores |
| Comparativas /vs/ | 5 paginas con datos reales de competidores | Indexadas y rankeando en Google |
| Blog (5 articulos) | MDX, >1500 palabras, schema Article | 5 posts publicados y indexados |
| Extension en stores | Chrome Web Store + Firefox Add-ons | Disponible para descarga publica |
| Email onboarding | 3 emails (bienvenida, primer link, upgrade) | Nuevo usuario recibe los 3 emails |

## Fase 5 — Escala (Semanas 17-24)

**Entregable**: Product Hunt launch, 100 clientes pago, $1.5K+ MRR.

| Tarea | Detalle | Criterio de done |
|-------|---------|-----------------|
| Product Hunt | Assets + launch + responder comments 8h | Top 5 del dia |
| Link-in-bio | Bio pages tipo Linktree/OneLinks | Pagina publica con links del usuario |
| A/B testing links | Split traffic entre 2 URLs, medir CTR | Dashboard muestra winner |
| Webhooks publicos | Notificar clicks en real-time via HTTP | Webhook se dispara al hacer click |
| i18n dashboard | Espanol como segundo idioma | Toggle ES/EN funcional |

---

# 4. DIRECCION DE UI Y DISENO

## 4.1 Filosofia de diseno: "Calm Premium"

La UI de MUGA sigue la filosofia de **Calm Design** — menos en pantalla, mas en foco. Inspirada por Linear (precision), Vercel (claridad), y Stripe (confianza).

**Principios:**
1. **Cada elemento justifica su existencia** — si no mueve al usuario hacia su objetivo, se elimina
2. **Progressive disclosure** — complejidad disponible pero nunca impuesta
3. **Dark-first** — el 45% de SaaS nuevos lideran con dark mode. MUGA tambien.
4. **Delight sutil** — micro-animaciones que dan feedback, no que distraen

## 4.2 Sistema de diseno

### Tipografia

**Font principal: Geist Sans** (Vercel)
- Mas moderna que Inter, mejor legibilidad en small sizes
- Gratis, optimizada para UI, instalable via npm
- La misma familia que usa Vercel, v0, y el ecosistema Next.js

**Font monospace: Geist Mono** (Vercel)
- Para slugs de links (mug.ag/abc123), API keys, code snippets
- `font-variant-numeric: tabular-nums` para datos numericos (clicks, stats)

**Escala tipografica:**
```
Hero headline:    64px / 700 / -0.02em tracking
Section headline: 40px / 600 / -0.02em
Card title:       20px / 600 / -0.01em
Body text:        16px / 400 / 0
Small/caption:    14px / 400 / 0.01em
Mono/data:        14px / 400 / Geist Mono
```

### Paleta de color

**Modo oscuro (por defecto):**
```
Background 1:    #0a0a0a    (negro profundo, casi-negro)
Background 2:    #141414    (superficie elevada — cards, modals)
Background 3:    #1a1a1a    (hover states, sidebar)
Border:          #262626    (bordes sutiles)
Border hover:    #3a3a3a    (bordes interactivos)
Text primary:    #ededed    (blanco suave, no puro)
Text secondary:  #a1a1a1    (labels, placeholders)
Text muted:      #666666    (timestamps, metadata)
```

**Colores de acento:**
```
Brand primary:   #3b82f6    (azul vibrante — CTAs principales)
Brand hover:     #2563eb    (azul mas oscuro al hover)
Success:         #22c55e    (verde — link creado, copiado)
Warning:         #f59e0b    (ambar — limites cerca)
Error:           #ef4444    (rojo — errores, deletes)
Pro badge:       #a855f7    (purpura — plan Pro)
Agency badge:    #f97316    (naranja — plan Agency)
```

**Modo claro (secundario):**
```
Background 1:    #ffffff
Background 2:    #fafafa
Background 3:    #f5f5f5
Border:          #e5e5e5
Text primary:    #0a0a0a
Text secondary:  #525252
```

**Gradientes de marca:**
```css
/* Hero gradient background */
.hero-gradient {
  background: radial-gradient(
    ellipse 80% 50% at 50% -20%,
    rgba(59, 130, 246, 0.15),
    transparent
  );
}

/* Card glow en hover */
.card-glow:hover {
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3),
              0 0 40px -10px rgba(59, 130, 246, 0.15);
}

/* Badge gradient Pro */
.badge-pro {
  background: linear-gradient(135deg, #a855f7, #6366f1);
}
```

### Layout system

**Bento Grid para la landing:**
```
+---------------------------+----------+
|                           |          |
|    Feature principal      |  Stats   |
|    (Analytics preview)    | (speed)  |
|                           |          |
+-------------+-------------+----------+
|             |             |          |
| Extension   | QR Codes    | Custom   |
| preview     | preview     | Domains  |
|             |             |          |
+-------------+-------------+----------+
```

- Gap uniforme: 16px
- Border radius uniforme: 12px (cards), 8px (botones), 6px (inputs)
- Padding interno cards: 24px

**Dashboard layout:**
```
+--------+------------------------------------------+
|        |  Header (workspace selector + user)       |
|        +------------------------------------------+
|  Side  |                                          |
|  bar   |  Content area                            |
|        |  (max-width: 1200px, centered)           |
| 240px  |                                          |
|        |                                          |
|        |                                          |
+--------+------------------------------------------+
```

- Sidebar: colapsable en mobile, iconos + labels
- Content: max-width 1200px, padding 32px
- Tablas: bordes sutiles, hover row, acciones al final

### Componentes clave

**Boton primario:**
```css
.btn-primary {
  background: #3b82f6;
  color: #ffffff;
  border-radius: 8px;
  padding: 10px 20px;
  font-weight: 500;
  font-size: 14px;
  transition: all 150ms ease;
  /* Hover: scale 1.02 + color shift */
}
.btn-primary:hover {
  background: #2563eb;
  transform: scale(1.02);
}
.btn-primary:active {
  transform: scale(0.98);
}
```

**Input field:**
```css
.input {
  background: #141414;
  border: 1px solid #262626;
  border-radius: 8px;
  padding: 10px 14px;
  color: #ededed;
  font-size: 14px;
  transition: border-color 150ms;
}
.input:focus {
  border-color: #3b82f6;
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
```

**Card (link item):**
```css
.link-card {
  background: #141414;
  border: 1px solid #262626;
  border-radius: 12px;
  padding: 16px 20px;
  transition: all 150ms;
}
.link-card:hover {
  border-color: #3a3a3a;
  background: #1a1a1a;
}
```

**Copy button animation:**
```
[Click] → icono cambia de clipboard a checkmark
       → texto cambia de "Copy" a "Copied!"
       → color cambia de neutral a verde (#22c55e)
       → vuelve a estado original en 2s
```

### Micro-animaciones

1. **Page transitions**: fade-in 200ms al navegar entre paginas del dashboard
2. **Link creado**: card aparece con slide-up + fade-in desde abajo
3. **Click counter**: numero incrementa con animacion tipo "odometer" (digit roll)
4. **Copy feedback**: checkmark bounce suave (spring animation)
5. **Loading**: skeleton screens que mantienen layout (no spinners)
6. **Toast notifications**: slide-in desde arriba-derecha, auto-dismiss 4s
7. **Chart animations**: lineas se dibujan de izquierda a derecha al cargar (500ms)
8. **Empty states**: ilustracion SVG minimalista + copy amigable

### Iconos

**Libreria: Lucide React** (fork de Feather Icons)
- Consistentes con el estilo minimal
- 1px stroke weight por defecto (mas ligero que Heroicons)
- Tamaño estandar: 16px (inline), 20px (botones), 24px (sidebar)

## 4.3 Stack de UI/Frontend

### Libreria de componentes: shadcn/ui

**Por que shadcn/ui y no alternativas:**

| Opcion | Ventaja | Desventaja | Decision |
|--------|---------|------------|----------|
| **shadcn/ui** | Codigo propio (no dependencia), Tailwind-first, Radix primitives, enorme ecosystem | Requiere setup inicial | **Elegido** |
| DaisyUI | Pre-styled, rapido de prototipar | Demasiado opinionated, dificil de customizar | Descartado |
| HeroUI | Bonito por defecto | Menos control, menos adopcion | Descartado |
| Magic UI | Animaciones increibles | Demasiado pesado para un dashboard de productividad | Parcialmente (solo animaciones de landing) |
| Headless UI | Maximo control | Demasiado trabajo de styling | Descartado |

**Componentes shadcn/ui a usar:**
- Button, Input, Label, Select, Switch, Checkbox
- Dialog (modals), Sheet (side panels), Popover, Tooltip
- Table, Tabs, Badge, Avatar
- Command (Cmd+K palette), Toast
- Card, Separator, Skeleton

**Componente adicional: Magic UI** (solo para la landing page)
- Animaciones de hero (text reveal, gradient borders)
- Bento grid animated cards
- Marquee de logos
- Number ticker (contador de installs/clicks)

### Graficos: Recharts

- Nativo de React, ligero (~40KB gzip)
- API declarativa, facil de estilizar con Tailwind
- Responsive por defecto
- Soporta: LineChart, BarChart, PieChart, AreaChart, Treemap

### Command Palette (Cmd+K)

Implementar desde el dia 1 usando el componente Command de shadcn/ui (basado en cmdk):

**Acciones disponibles:**
- Crear nuevo link
- Buscar links existentes
- Ir a Analytics, Domains, Settings
- Copiar ultimo link creado
- Cambiar workspace
- Abrir documentacion

**Por que**: Linear hizo popular el Cmd+K. El 100% de SaaS modernos en 2026 lo tienen. Es la senal de que el producto esta hecho para power users.

## 4.4 Paginas clave y su diseno

### Landing page (muga.link)

```
SECCION 1 — Hero
+-------------------------------------------------------+
|                                                       |
|   [Logo MUGA]    Features  Pricing  Blog    [Login]   |
|                                                       |
|        Make URLs Great Again                          |
|                                                       |
|   The fastest URL shortener with enterprise           |
|   features at indie prices. Free forever.             |
|                                                       |
|   +---------------------------------------------+    |
|   | https://example.com/very-long-tracking...    |    |
|   |                                 [Shorten] |    |
|   +---------------------------------------------+    |
|                                                       |
|   [Start Free]           [See Pricing]                |
|                                                       |
|   radial gradient azul sutil desde arriba             |
+-------------------------------------------------------+

SECCION 2 — Social proof bar
+-------------------------------------------------------+
| "X extension installs" · "<20ms redirects" · "Free"   |
+-------------------------------------------------------+

SECCION 3 — Bento Grid de features
+---------------------------+---------------------------+
|                           |                           |
|  [icono rayo]             |  [mini grafico]           |
|  Lightning Fast            |  Free Analytics           |
|  <20ms redirects via      |  Geo, device, referrer    |
|  Cloudflare edge          |  on every plan            |
|                           |                           |
+--------------+------------+--------------+------------+
|              |            |              |            |
|  [icono      |  [QR       |  [extension  |  [pixel    |
|   dominio]   |   preview] |   icon]      |   icon]    |
|  Custom      |  QR Codes  |  Browser     |  Retarget  |
|  Domains     |  No watermark| Extension  |  Pixels    |
|              |            |              |            |
+--------------+------------+--------------+------------+

SECCION 4 — Comparativa
+-------------------------------------------------------+
|          MUGA vs la competencia                       |
|                                                       |
|  Feature    | MUGA   | Bitly  | T.LY  | Dub.co      |
|  Free links | 100/mo | 5/mo   | Ltd   | 25/mo       |
|  Analytics  | Free   | $199   | $5    | $25         |
|  QR codes   | Free   | $$$    | Free  | Free        |
|  Price      | $9/mo  | $29/mo | $5/mo | $25/mo      |
|                                                       |
+-------------------------------------------------------+

SECCION 5 — Pricing
+-------------------------------------------------------+
|                                                       |
|  +----------+  +-----------+  +----------+            |
|  |   FREE   |  |    PRO    |  |  AGENCY  |            |
|  |   $0     |  |   $9/mo   |  |  $29/mo  |            |
|  |          |  |  POPULAR  |  |          |            |
|  | 100 links|  | 1K links  |  | 10K links|            |
|  | 7d stats |  | 1yr stats |  | 2yr stats|            |
|  | 1 domain |  | 3 domains |  | 10 domains|           |
|  |          |  |           |  | 10 users |            |
|  | [Start]  |  | [Upgrade] |  | [Contact]|            |
|  +----------+  +-----------+  +----------+            |
|                                                       |
|  "Everything unlimited except link volume."           |
+-------------------------------------------------------+

SECCION 6 — CTA final
+-------------------------------------------------------+
|                                                       |
|   Ready to make your URLs great again?                |
|                                                       |
|   [Start Shortening — Free]                           |
|                                                       |
|   "No credit card. No tracking. No BS."               |
|                                                       |
+-------------------------------------------------------+

FOOTER
+-------------------------------------------------------+
| Product: Features, Pricing, API, Blog, Changelog      |
| Compare: vs Bitly, vs T.LY, vs Dub, vs Rebrandly     |
| Legal: Privacy, Terms                                 |
| Social: GitHub (extension), X/Twitter                 |
|                                                       |
| "Made with obstinacy. No VC. No BS."                  |
+-------------------------------------------------------+
```

### Dashboard

```
+--------+------------------------------------------+
|        |  [Workspace v] [Search]  Cmd+K  [Avatar] |
| MUGA   +------------------------------------------+
|        |                                          |
| Links  |  Your Links                [+ New Link]  |
| -----  |                                          |
| Analyt |  +------------------------------------+  |
| ics    |  | mug.ag/launch    →  muga.link      |  |
|        |  | 1,234 clicks · 2d ago    [Copy][QR] |  |
| Domain |  +------------------------------------+  |
| s      |  | mug.ag/pricing   →  muga.link/pri..|  |
|        |  | 567 clicks · 5d ago      [Copy][QR] |  |
| QR     |  +------------------------------------+  |
| Codes  |  | mug.ag/demo      →  demo.example..  |  |
|        |  | 89 clicks · 1w ago       [Copy][QR] |  |
| Pixels |  +------------------------------------+  |
|        |                                          |
| -----  |  Showing 1-20 of 45 links    [< 1 2 >]  |
| Settin |                                          |
| gs     |                                          |
+--------+------------------------------------------+

Colores:
- Sidebar: bg #0a0a0a, active item: bg #141414 + left border blue
- Content: bg #0a0a0a
- Cards: bg #141414, border #262626
- Hover cards: bg #1a1a1a, border #3a3a3a
- Links (URLs): text #3b82f6
- Click count: text #a1a1a1, Geist Mono
- Badges: Pro purple, Agency orange
```

### Analytics page

```
+--------+------------------------------------------+
|        |  Analytics for "mug.ag/launch"            |
| MUGA   |                                          |
|        |  [7 days] [30 days] [90 days] [Custom]   |
| ...    |                                          |
|        |  +------------------------------------+  |
|        |  |  1,234 clicks   456 unique          |  |
|        |  |  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  |  |
|        |  |  Line chart: clicks over time      |  |
|        |  |  Animated draw-in effect            |  |
|        |  +------------------------------------+  |
|        |                                          |
|        |  +----------------+ +-----------------+  |
|        |  | Top Countries  | | Devices         |  |
|        |  | US  [====] 45% | | Mobile  [==] 62%|  |
|        |  | DE  [==]   20% | | Desktop [=] 30% |  |
|        |  | ES  [=]    12% | | Tablet  [ ]  8% |  |
|        |  | UK  [=]    8%  | |                 |  |
|        |  +----------------+ +-----------------+  |
|        |                                          |
|        |  +------------------------------------+  |
|        |  | Top Referrers                      |  |
|        |  | twitter.com        423 clicks      |  |
|        |  | direct             312 clicks      |  |
|        |  | google.com         189 clicks      |  |
|        |  +------------------------------------+  |
+--------+------------------------------------------+
```

### Modal de crear link

```
+--------------------------------------------+
|  Create New Link                     [x]   |
|                                            |
|  Destination URL *                         |
|  +--------------------------------------+  |
|  | https://                              |  |
|  +--------------------------------------+  |
|                                            |
|  Short Link                                |
|  +--------------------+  +--------------+  |
|  | mug.ag        [v]  |  | (auto)       |  |
|  +--------------------+  +--------------+  |
|  domain selector        custom slug        |
|                                            |
|  [v] Advanced Options                      |
|  +-----------------------------------------|
|  | Title:     [                        ]   |
|  | Tags:      [tag1] [tag2] [+ Add]       |
|  | Password:  [                        ]   |
|  | Expires:   [Never              [v]] |   |
|  | UTM:       [Source] [Medium] [Camp.] |   |
|  +-----------------------------------------|
|                                            |
|  [Cancel]              [Create Link]       |
+--------------------------------------------+
```

## 4.5 Tecnologias de diseno y desarrollo frontend

### Stack definitivo

```
Framework:       Next.js 15 (App Router, Server Components)
Styling:         Tailwind CSS v4
Componentes:     shadcn/ui (base) + Magic UI (landing animations)
Icons:           Lucide React
Font:            Geist Sans + Geist Mono (npm: geist)
Graficos:        Recharts
Animaciones:     Framer Motion (page transitions, micro-interactions)
Forms:           React Hook Form + Zod (validation)
State:           SWR (server state) + Zustand (client state minimal)
Command palette: cmdk (via shadcn/ui Command)
Toasts:          Sonner (via shadcn/ui)
Date picker:     date-fns + shadcn Calendar
Theme:           next-themes (dark/light toggle)
OG images:       @vercel/og (dynamic OG image generation)
MDX:             next-mdx-remote (blog)
```

### Responsive breakpoints

```
Mobile:   < 768px   (sidebar oculta, hamburger menu)
Tablet:   768-1024px (sidebar colapsada a iconos)
Desktop:  > 1024px   (sidebar expandida)
Wide:     > 1440px   (content max-width 1200px, centrado)
```

### Performance targets

```
Lighthouse (mobile):
  Performance:    > 95
  Accessibility:  > 95
  Best Practices: > 95
  SEO:            > 95

Core Web Vitals:
  LCP:  < 1.5s
  FID:  < 50ms
  CLS:  < 0.05

Bundle:
  First load JS: < 100KB (marketing pages)
  Dashboard JS:  < 200KB (con graficos)
```

---

# 5. INSPIRACIONES DE REFERENCIA

## Productos a estudiar y emular

| Producto | Que copiar | Que NO copiar |
|----------|------------|---------------|
| **Linear** | Precision tipografica, Cmd+K, calm design, animaciones sutiles | Complejidad de onboarding |
| **Vercel** | Dashboard limpio, dark mode, Geist font, velocidad | Pricing confuso por proyecto |
| **Stripe** | Documentacion de API, confianza visual, progresive disclosure | Sobrecarga de features |
| **Dub.co** | Feature comparison pages, pricing clarity, modern aesthetic | AGPL, Vercel lock-in |
| **Raycast** | Extension marketplace feel, snappy UI, keyboard shortcuts | Desktop-only |
| **Cal.com** | Open-source credibility, booking flow UX | Demasiadas opciones de config |

## Anti-patrones a evitar

1. **No seas Bitly**: UI anticuada, pricing confuso, free plan hostil
2. **No seas T.LY**: UX amateur, bait-and-switch, dashboard sin pulir
3. **No seas Rebrandly**: Demasiadas variables de pricing, "engagement data points"
4. **No seas Sniply**: CTAs que no funcionan (iframe blocking), soporte fantasma
5. **No seas Replug**: UI de 2002, features rotos, sin presencia en comunidades

---

# 6. RESUMEN DE DECISIONES

| Decision | Eleccion | Razon |
|----------|----------|-------|
| Tema por defecto | Dark mode | 45% de SaaS nuevos, alineado con target tech-savvy |
| Font | Geist Sans/Mono | Mas moderna que Inter, ecosistema Vercel/Next.js |
| Componentes | shadcn/ui | Codigo propio, maximo control, Tailwind-native |
| Landing layout | Bento grid | Tendencia dominante 2026, modular, visual |
| Dashboard | Calm design / sidebar | Linear-inspired, progressive disclosure |
| Graficos | Recharts | Ligero, React-native, customizable con Tailwind |
| Animaciones | Framer Motion | Standard de industria, performant, declarativo |
| Landing extras | Magic UI | Animaciones de hero sin peso en el dashboard |
| Palette | Azul primario sobre dark | Confianza + modernidad. No rojo (agresivo), no verde (aburrido) |
| Command palette | Cmd+K desde dia 1 | Power user signal, Linear-style |
| Icons | Lucide (1px stroke) | Mas ligero que Heroicons, consistente con minimal |

---

*Este documento complementa el [MUGA-Master-Plan.md](MUGA-Master-Plan.md) con el detalle de posicionamiento, atributos competitivos, y direccion visual del producto.*
