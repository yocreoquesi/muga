# MUGA: Fair to Every Click
## Master Plan: Competitive Intelligence + Development Strategy

*Generated: 2026-03-23*
*Version: 1.0*

---

# FASE 1: INTELIGENCIA COMPETITIVA

---

## 1. Bitly

### Pricing
- **Free**: $0/mes: 5 links/mes, 2 QR codes, 0 custom domains, 1,000 API req/mes, sin historial de datos
- **Core**: $10/mes (solo anual): 100 links/mes, 5 QR codes, 30 dias historial, 5,000 API req/mes
- **Growth**: $29/mes anual ($35 mensual): 500 links/mes, 10 QR codes, 1 custom domain gratis, 120 dias historial, 25,000 API req/mes, bulk creation (100 links/upload)
- **Premium**: $199/mes anual ($300 mensual): 3,000 links/mes, 200 QR codes, analytics ciudad/dispositivo, deep linking, campanas, 1 ano historial, 50,000 API req/mes
- **Enterprise**: pricing custom: 2 anos historial, SSO, webhooks, SLA 99.9%, dedicated CSM
- **Modelo**: Freemium con free plan extremadamente limitado. Interstitial ads en links gratuitos desde 2025.
- **Revenue estimado**: ARPU Core ~$120/ano, Growth ~$348/ano, Premium ~$2,388/ano

### Features diferencial
- Brand recognition masiva (el shortener mas conocido)
- QR codes con logo personalizado (plans de pago)
- Landing pages integradas
- UTM builder
- Mobile deep linking (Premium+)
- API madura y bien documentada
- Campanas y dashboards personalizados (Premium+)
- Link-in-bio (landing pages)

### Gaps y quejas de usuarios
- **Precio excesivo**: $199/mes por analytics de ciudad/dispositivo. Competidores lo ofrecen a $20-50/mes
- **Free plan inutilizable**: 5 links/mes es insultantemente bajo, ads intersticiales en links gratuitos
- **Analytics retrasados**: no actualizan en tiempo real
- **Extension problematica**: errores internos frecuentes, problemas OAuth, funciones eliminadas en updates
- **QR codes con marca de agua** en plan gratuito
- **Sin geo-redirect** en planes basicos
- **Historial de datos limitado**: solo 30 dias en Core, 120 en Growth

### Stack tecnico detectado
- Infraestructura: Google Cloud (via: 1.1 google en headers)
- IPs propias: 67.199.248.x
- CDN: Google Cloud CDN
- Redirect: HTTP 301

### Velocidad de redireccion
- **~131ms** time_starttransfer (desde Madrid, Espana)
- DNS resolution lenta desde algunas redes (~15s timeout, luego fallback)

### Oportunidad para MUGA
- **Precio**: El gap mas enorme del mercado. Bitly cobra $199/mes por analytics que Dub.co da en su plan de $25/mes. MUGA puede ofrecer analytics de ciudad/dispositivo desde $9/mes.
- **Free plan**: Ofrecer 50-100 links/mes gratis vs 5 de Bitly es un diferenciador inmediato.
- **Extension**: La extension de Bitly tiene problemas recurrentes de OAuth y errores. MUGA nace como extension-first.
- **Mensaje**: "Bitly te cobra $300/mes. MUGA te da lo mismo por $19."

---

## 2. T.LY

### Pricing
- **Free**: Extension gratuita, shortening basico sin cuenta
- **Hobby**: $5/mes: 500 links/mes, custom domains con SSL, Smart URLs, API, QR codes, analytics, retargeting
- **Basic**: $20/mes: 4,000 links/mes, todo lo de Hobby ampliado
- **Pro**: $50/mes: 10,000 links/mes, team management, soporte prioritario
- **Modelo**: Freemium (extension gratis + SaaS de pago). Trial 5 dias en plans de pago.
- **Revenue**: ~$15,000 MRR ($180K ARR) con ~600 clientes de pago estimados

### Features diferencial
- **Dominio mas corto posible**: t.ly (4 caracteres): marketing strong
- **Extension de navegador muy popular**: 330,000+ usuarios activos
- **Smart URLs** (geo/device redirect) en TODOS los planes de pago
- **OneLinks** (link-in-bio)
- **Retargeting pixels** incluidos desde el plan mas barato ($5/mes)
- **Todos los features desbloqueados** en todos los planes. Solo varian los limites de volumen
- **Pricing agresivo**: 50% mas barato que la media del mercado

### Gaps y quejas de usuarios
- **Conversion baja**: El fundador admite que convertir usuarios free de la extension a pagadores es muy dificil
- **UX del dashboard**: Interfaz funcional pero no pulida, no es "premium feeling"
- **Soporte limitado**: Un solo fundador, sin equipo
- **Sin workspaces/equipos** en planes basicos
- **Marca percibida como "indie"**: enterprises no confian

### Stack tecnico detectado
- Backend: **Laravel** (PHP) + **Vue.js**
- Hosting: **DigitalOcean**
- CDN: **Cloudflare** (cf-ray headers)
- Email: Mailgun
- Payments: Stripe
- Blog: WordPress
- Coste infra: ~$800/mes (todos sus proyectos)

### Velocidad de redireccion
- **~60ms** time_starttransfer (Cloudflare, PoP Madrid)
- Nota: Cloudflare challenge activado en curl (403), redirect real para navegadores mas rapido

### Oportunidad para MUGA
- **Extension como canal de captacion**: T.LY demostro que una extension popular puede generar 350K usuarios. MUGA ya tiene una extension funcional con un hook diferente (limpieza de URLs + shortening).
- **UX premium**: T.LY parece "indie project". MUGA puede posicionarse con UX mas pulida para capturar el segmento que quiere calidad visual.
- **Modelo hibrido**: MUGA combina limpieza de tracking params (uso diario) + shortening (uso ocasional). Mas engagement con la extension.
- **Vulnerabilidad**: T.LY depende de un solo fundador sin equipo. Si escala, sera un cuello de botella.

---

## 3. Rebrandly

### Pricing
- **Free**: $0/mes: 10 links/mes, 10 QR codes, 1 custom domain, 100 clicks analytics/mes
- **Essentials**: $8/mes anual ($11 mensual): 250 links/mes, 2 custom domains, 10K clicks analytics
- **Professional**: $22/mes anual ($32 mensual): 1,500 links/mes, 3 custom domains, 25K clicks, password protection, link expiration, webhooks, traffic routing
- **Growth**: $69/mes anual ($99 mensual): 3,500 links/mes, 10 custom domains, 150K clicks analytics, 5 workspaces, 5 teammates, mobile deep linking
- **Enterprise**: Custom: unlimited todo, SSO, HIPAA, dedicated CSM
- **Modelo**: Freemium con progression natural entre tiers.

### Features diferencial
- **Branded links** como core value prop: fuerte en branding corporativo
- **Link galleries** (link-in-bio agrupadas)
- **AI scheduling suggestions**
- **Traffic routing** (geo/device redirect en Professional+)
- **Custom back-halves** incluidos
- **Link destination edits** (cambiar destino post-creacion)

### Gaps y quejas de usuarios
- **Analytics limitados en planes bajos**: Solo 100 clicks/mes en free, 10K en Essentials
- **Sin retargeting pixels** en planes basicos
- **Pricing confuso**: Muchos limites cruzados (links, clicks, edits, galleries, tags)
- **Extension basica**: Funcional pero sin features avanzados
- **Webhooks solo desde Professional** ($22/mes)
- **UX del dashboard anticuada** comparada con Dub.co

### Stack tecnico detectado
- CDN: **Cloudflare** (cf-ray headers, PoP Madrid)
- Redirect domain: rebrand.ly via Cloudflare

### Velocidad de redireccion
- **~59ms** time_starttransfer (Cloudflare, PoP Madrid)
- La mas rapida de los competidores (Cloudflare edge)

### Oportunidad para MUGA
- **Simplificacion de pricing**: Rebrandly tiene demasiadas variables (links, clicks, edits, galleries, tags). MUGA puede ofrecer "todo ilimitado excepto volumen de links".
- **Retargeting democratizado**: Rebrandly no ofrece pixels en planes basicos. MUGA puede incluirlos desde el plan gratuito.
- **API y webhooks desde el inicio**: No gate-keep integraciones tecnicas.

---

## 4. Short.io

### Pricing
- **Free**: $0/mes: 1,000 links total, 50K clicks/mes, 5 custom domains, 1 usuario
- **Hobby**: $5/mes: 2,500 links, 100K clicks, 7 domains, geo-targeting pais, referrer hiding
- **Pro**: $18/mes: links ilimitados, clicks ilimitados, 10 domains, password protection, link expiration, link cloaking
- **Team** (popular): $48/mes: todo ilimitado, 50 domains, usuarios ilimitados, geo ciudad/region, deep links, E2E encryption, SLA 99.9%
- **Enterprise**: $148/mes: domains ilimitados, multi-teams, SSO, raw S3 export
- **Modelo**: Freemium generoso. Trial 7 dias en plans de pago. Sin tarjeta requerida.

### Features diferencial
- **Free plan generoso**: 1,000 links + 50K clicks es el mejor free plan del mercado
- **5 custom domains en free**: unico en el mercado
- **Link automation** (bulk creation)
- **Raw data export a S3** (Enterprise)
- **E2E encryption** (Team+)
- **QR codes y UTM builder** en todos los planes
- **API en todos los planes**

### Gaps y quejas de usuarios
- **UX del dashboard**: Funcional pero no moderna
- **Analytics basicos** comparados con Bitly/Dub
- **Sin retargeting pixels** nativos
- **Sin CTA overlays**
- **Sin link-in-bio**
- **Marca poco conocida** fuera del nicho tecnico

### Stack tecnico detectado
- CDN: **AWS CloudFront** (x-amz-cf-pop: MAD53-P7)
- Hosting: AWS
- Headers: x-cache, x-amz-cf-id
- Seguridad: XSS protection, SAMEORIGIN frame

### Velocidad de redireccion
- **~66ms** time_starttransfer (CloudFront, PoP Madrid)

### Oportunidad para MUGA
- **Copiar el free plan generoso**: Short.io demuestra que un free plan con 1,000 links atrae mucho mas volumen que los 5 links de Bitly. MUGA debe ser igual de generoso o mas.
- **Anadir lo que Short.io no tiene**: retargeting pixels, CTA overlays, link-in-bio.
- **Marketing superior**: Short.io tiene mal marketing y poca visibilidad. Con el mismo producto pero mejor posicionamiento, MUGA puede capturar su publico.

---

## 5. Dub.co

### Pricing
- **Free**: $0: 25 links/mes, 1K tracked events/mes, 3 custom domains, 1 usuario, 30 dias analytics
- **Pro**: $25/mes anual: 1K links/mes, 50K events, 10 domains, 3 usuarios, 1 ano analytics, 600 API req/min
- **Business**: $75/mes anual: 10K links/mes, 250K events, 100 domains, 10 usuarios, 3 anos analytics
- **Advanced**: $250/mes anual: 50K links/mes, 1M events, 250 domains, 20 usuarios, 5 anos analytics
- **Enterprise**: Custom: todo ilimitado
- **Modelo**: Freemium + Open Source. El mas moderno del mercado.

### Features diferencial
- **Open source** (GitHub, 20K+ stars): confianza y transparencia
- **Real-time analytics** con Tinybird
- **Conversion tracking** nativo
- **A/B testing** de links
- **Device/geo targeting** en todos los planes
- **Password protection** en todos los planes
- **Link cloaking** en todos los planes
- **Custom QR codes** en todos los planes
- **UTM templates**
- **Dub Partners**: sistema de affiliates integrado
- **API moderna y bien documentada**
- **Self-hostable** (Docker)
- **UI/UX la mejor del mercado**: diseno moderno, dark mode, rapido

### Gaps y quejas de usuarios
- **Relatively nuevo**: menos track record que Bitly
- **Sin extension de navegador** dedicada (o basica)
- **Vercel lock-in** para el stack completo
- **Self-hosting complejo** (requiere Tinybird, Upstash, Vercel)
- **Sin CTA overlays**
- **Sin link-in-bio** nativo
- **Pricing de eventos** confuso: tracked events vs clicks vs links

### Stack tecnico detectado
- **Framework**: Next.js 14 + React 18 + TypeScript
- **Styling**: Tailwind CSS
- **Deployment**: **Vercel** (x-vercel-id en headers)
- **Database**: PostgreSQL via **Prisma ORM**
- **Analytics engine**: **Tinybird** (columnar DB para eventos)
- **Background jobs**: **Upstash QStash**
- **Storage**: **Cloudflare R2**
- **Monitoring**: PostHog + Plausible
- **Auth**: NextAuth.js
- **License**: AGPL-3.0

### Velocidad de redireccion
- **~78ms** time_starttransfer (Vercel Edge, PoP Madrid)
- Nota: Vercel challenge activado en curl (403)

### Oportunidad para MUGA
- **Extension nativa**: Dub.co NO tiene extension de navegador integrada. Este es el gap mas grande. MUGA nace como extension-first.
- **Simplicidad de stack**: Dub requiere Tinybird + Upstash + Vercel + Prisma para self-hosting. MUGA con Cloudflare Workers + KV + Supabase es mas simple y barato.
- **Pricing mas simple**: "links/mes" es mas facil de entender que "tracked events".
- **No AGPL**: Si MUGA es open source, usar MIT o Apache 2.0 permite mas adopcion que AGPL.

---

## 6. Sniply

### Pricing
- **Basic**: $9/mes anual: 250 links/mes, 5 CTAs, 5K CTA impressions/mes, 1 user, 1 custom domain
- **Pro** (popular): $29/mes anual: links ilimitados, 30 CTAs, 20K impressions, 3 users, 5 domains
- **Business**: $59/mes anual: links ilimitados, 100 CTAs, 50K impressions, 10 users, 20 domains
- **Enterprise**: Custom: todo ilimitado, API access
- **Trial**: 14 dias gratis en cualquier plan
- **Modelo**: Trial-to-paid, sin free plan permanente.

### Features diferencial
- **CTA overlays** como CORE del producto: unico enfoque en el mercado
- Los overlays aparecen sobre el contenido del destino (no redirects simples)
- **Retargeting pixels** integrados en links
- **Lead generation overlay** (captura emails)
- **A/B testing de CTAs** (Pro+)
- **Integraciones**: Mailchimp, HubSpot, Zapier
- **Browser extensions** (Chrome, Firefox)

### Gaps y quejas de usuarios
- **No es un shortener puro**: es un CTA tool con shortening
- **Overlays pueden ser bloqueados** por adblockers
- **Sin analytics avanzados** de clicks (geo, dispositivo limitados)
- **Sin custom domains** en Basic
- **Pricing alto** para lo que ofrece como shortener puro
- **UX anticuada**

### Stack tecnico detectado
- CDN: **Cloudflare** (cf-ray headers, PoP Madrid)
- Redirect: HTTP 302 (no 301: necesario para inyectar overlay)

### Velocidad de redireccion
- **~191ms** time_starttransfer (Cloudflare, PoP Madrid)
- Mas lenta que competidores puros (inyecta overlay HTML)

### Oportunidad para MUGA
- **CTA overlays como feature premium**: Incluir CTA overlays basicos en el plan Pro de MUGA ($19/mes) vs $29/mes de Sniply.
- **Combinacion shortener + CTA**: Sniply es solo CTA. MUGA puede ser shortener completo + CTA como bonus.

---

## 7. Replug

### Pricing
- **Free**: $0/mes: 100 links, 2 bio links, 10 QR codes, 1K clicks/mes, 3 custom domains
- **Essentials**: $9/mes anual: 1K links, 10 bio links, 100 QR codes, 10K clicks/mes, 1 retargeting pixel, 5 domains, 1 free .link domain
- **Scale**: $23/mes anual: links ilimitados, bio links ilimitados, 50K clicks/mes, pixels ilimitados, 15 domains, 3 workspaces, 3 usuarios
- **Agency**: $79/mes anual: 250K clicks/mes, 50 domains, 10 workspace kits, 10 usuarios, 10 .link domains
- **Enterprise**: Custom
- **Modelo**: Freemium con escalado por workspaces.

### Features diferencial
- **Retargeting pixels** como feature central: Meta, Google, LinkedIn, Twitter pixels
- **Bio links** completos (link-in-bio)
- **Smart QR codes** dinamicos
- **Workspace kits** (plan Agency): ideal para agencias con multiples clientes
- **Dominios .link gratuitos** incluidos en planes de pago
- **Campanas** con organizacion
- **Click limit por link**
- **A/B testing de links**

### Gaps y quejas de usuarios
- **Click limits** como mecanismo de monetizacion principal: frustrante
- **Marca poco conocida**
- **Sin CTA overlays** (a diferencia de Sniply)
- **Dashboard funcional pero no destacable**
- **Documentacion limitada**
- **API restringida a Enterprise**

### Stack tecnico detectado
- Hosting: **AWS** (IPs 2600:1f1c)
- No CloudFront (IPs directas de AWS)

### Velocidad de redireccion
- No testada directamente (requiere link activo)

### Oportunidad para MUGA
- **Retargeting para todos**: Replug gate-keeps pixels al plan de $9/mes. MUGA puede incluirlo en free.
- **Mejor pricing por workspace**: $79/mes por 10 workspaces es caro. MUGA puede ofrecer workspaces ilimitados en plan Agency por $49/mes.
- **API abierta**: No esconder la API detras de Enterprise.

---

## TABLA COMPARATIVA MAESTRA

| Aspecto | Bitly | T.LY | Rebrandly | Short.io | Dub.co | Sniply | Replug |
|---------|-------|------|-----------|----------|--------|--------|--------|
| **Free links/mes** | 5 | Unlimited (ext) | 10 | 1,000 total | 25 | 0 (trial) | 100 |
| **Plan entry** | $10/mes | $5/mes | $8/mes | $5/mes | $25/mes | $9/mes | $9/mes |
| **Plan popular** | $29/mes | $20/mes | $22/mes | $48/mes | $75/mes | $29/mes | $23/mes |
| **Plan top** | $199/mes | $50/mes | $69/mes | $148/mes | $250/mes | $59/mes | $79/mes |
| **Custom domains (free)** | 0 | 0 | 1 | 5 | 3 | 0 | 3 |
| **Analytics geo** | Premium ($199) | Todos pagos | Professional ($22) | Team ($48) | Todos | Limitado | Todos pagos |
| **Retargeting pixels** | No | Todos pagos | No | No | No nativo | Si | Essentials ($9) |
| **QR codes** | Si (marca agua free) | Si | Si | Si | Si | No | Si |
| **A/B testing** | No | No | No | No | Si (todos) | Si (Pro+) | Si |
| **CTA overlays** | No | No | No | No | No | Si (core) | No |
| **Link-in-bio** | Si (landing) | Si (OneLinks) | Si (galleries) | No | No | No | Si |
| **API (free)** | Si (1K/mes) | No | No info | Si | Si | No | No |
| **Extension usuarios** | ~100K+ | 330K+ | Desconocido | Desconocido | Basica/No | Si | Desconocido |
| **Open source** | No | No | No | No | Si (AGPL) | No | No |
| **Infra** | Google Cloud | CF + DO | Cloudflare | AWS CloudFront | Vercel | Cloudflare | AWS |
| **Redirect speed** | ~131ms | ~60ms | ~59ms | ~66ms | ~78ms | ~191ms | N/A |

---

# FASE 2: IDENTIFICACION DE GAPS Y POSICIONAMIENTO

---

## Posicionamiento MUGA

### Declaracion de posicionamiento
**"Enterprise link features, indie pricing, browser-native."**

### Top 5 gaps del mercado (ordenados por impacto)

#### 1. Gap de precio en analytics avanzados
- **Impacto**: ALTO: El 80% de las quejas sobre Bitly son de precio
- **El problema**: Bitly cobra $199/mes por analytics de ciudad/dispositivo. Dub cobra $25/mes. Hay un enorme espacio entre $0 y $25.
- **Como MUGA lo resuelve**: Analytics de geo/dispositivo/referrer incluidos en el plan Free (con retencion 7 dias) y completos desde $9/mes (retencion 1 ano). Esto ataca directamente al 90% de la base de Bitly que paga por analytics.

#### 2. Gap de extension de navegador nativa
- **Impacto**: ALTO: T.LY demostro que una extension puede generar 350K usuarios organicos
- **El problema**: Ningun competidor tiene una extension de navegador que sea el core del producto desde el dia 1. T.LY la tiene pero es un add-on. Dub.co no tiene. Bitly tiene una extension buggy.
- **Como MUGA lo resuelve**: MUGA ya tiene una extension funcional (limpieza de URLs) con base de codigo lista. Anadir shortening convierte cada limpieza de URL en una oportunidad de conversion. El usuario ya instalo la extension por la limpieza. El shortening es el upgrade natural.

#### 3. Gap de retargeting democratizado
- **Impacto**: MEDIO-ALTO: Los marketers pagan por retargeting, pero esta detras de paywalls
- **El problema**: Retargeting pixels estan gate-kept: Replug desde $9/mes, T.LY desde $5/mes, Bitly no lo ofrece, Dub.co no nativo. Short.io y Rebrandly no lo tienen.
- **Como MUGA lo resuelve**: Retargeting pixels (Meta, Google, LinkedIn) incluidos en el plan Free (1 pixel) y ilimitados desde Pro ($9/mes). Esto es el feature que mas diferencia genera para marketers.

#### 4. Gap de free plan viable
- **Impacto**: MEDIO: El free plan es la puerta de entrada
- **El problema**: Bitly da 5 links/mes. Rebrandly da 10. Dub da 25. Solo Short.io da 1,000 pero sin analytics.
- **Como MUGA lo resuelve**: Free plan con 100 links/mes, analytics basicos (7 dias), 1 custom domain, 1 retargeting pixel, QR codes ilimitados, API (100 req/dia). Suficientemente generoso para que el usuario dependa del producto antes de pagar.

#### 5. Gap de simplicidad en pricing
- **Impacto**: MEDIO: El pricing confuso causa churn
- **El problema**: Rebrandly tiene 6 variables (links, clicks, edits, galleries, tags, domains). Dub tiene "tracked events" que confunde. Bitly limita QR codes separado de links.
- **Como MUGA lo resuelve**: Un solo eje de pricing: **links/mes**. Todo lo demas ilimitado en cada tier. Sin limites de clicks, sin limites de QR codes, sin limites de analytics. Simple.

### Features diferenciales prioritarios para el MVP

Ordenados por impacto/esfuerzo (alto impacto + bajo esfuerzo primero):

1. **Motor de redireccion ultra-rapido** (CF Workers, <20ms): diferenciador tecnico
2. **Extension de navegador integrada**: ya existe, solo anadir shortening
3. **Analytics de clicks** (geo, dispositivo, referrer): en TODOS los planes
4. **Custom domains**: desde el plan Free
5. **QR codes dinamicos**: sin marca de agua, todos los planes
6. **Retargeting pixels**: desde Free (1 pixel)
7. **API publica**: desde Free (con rate limiting)
8. **Smart links** (geo/device redirect): desde Pro
9. **Password protection + link expiration**: todos los planes
10. **Workspaces multi-usuario**: plan Agency

### Usuarios objetivo primarios (ICP)

#### ICP 1: Indie Marketer / Solopreneur
- **Rol**: Fundador, marketer freelance, creador de contenido
- **Empresa**: 1-5 personas, $0-50K revenue
- **Problema**: Usa Bitly free y se queda sin links. No puede justificar $29/mes por Growth.
- **Contexto**: Gestiona 3-5 campanas simultaneas, necesita analytics basicos, QR codes para materiales fisicos
- **Trigger de compra**: Llega al limite del free plan + necesita custom domain
- **MUGA plan**: Pro ($9/mes)

#### ICP 2: Agencia digital pequena
- **Rol**: Account manager, social media manager
- **Empresa**: 5-20 personas, agencia de marketing digital
- **Problema**: Necesita workspaces separados por cliente, custom domains por cliente, retargeting pixels
- **Contexto**: Gestiona 10-30 clientes, cada uno con su propio dominio y campanas
- **Trigger de compra**: Necesita multi-workspace + retargeting + reportes por cliente
- **MUGA plan**: Agency ($29/mes)

#### ICP 3: Developer / Technical founder
- **Rol**: CTO, full-stack developer, indie hacker
- **Empresa**: Startup early-stage
- **Problema**: Necesita API para integrar shortening en su producto. Bitly API es cara y limitada.
- **Contexto**: Quiere self-hostable o API generosa, no quiere vendor lock-in
- **Trigger de compra**: API rate limits del free plan + necesita webhooks
- **MUGA plan**: Pro ($9/mes) por la API

### Precio recomendado por tier basado en el analisis

#### Free: $0/mes
- 100 links/mes
- Clicks ilimitados
- Analytics basicos (geo, dispositivo, referrer): retencion 7 dias
- 1 custom domain
- 1 retargeting pixel (Meta o Google)
- QR codes ilimitados (sin marca de agua)
- API: 100 req/dia
- Extension de navegador completa
- **Por que**: Mas generoso que Bitly (5 links), Rebrandly (10), Dub (25). Suficiente para que un indie marketer use el producto activamente y dependa de el antes de pagar. El analytics de 7 dias crea urgencia de upgrade.

#### Pro: $9/mes (anual $7/mes)
- 1,000 links/mes
- Analytics completos: retencion 1 ano
- 3 custom domains
- Retargeting pixels ilimitados
- Smart links (geo/device redirect)
- Password protection + link expiration
- API: 1,000 req/dia
- A/B testing de links
- Webhooks
- **Por que**: $9/mes es 64% mas barato que Dub Pro ($25), 10% mas barato que Rebrandly Essentials ($8) pero con 4x mas links. El punto de precio magico para indie hackers. Incluye TODO lo que Bitly cobra $199/mes (analytics avanzados).

#### Agency: $29/mes (anual $24/mes)
- 10,000 links/mes
- 10 workspaces (separacion por cliente)
- 10 custom domains
- 10 usuarios
- Analytics completos: retencion 2 anos
- CTA overlays basicos
- API: 10,000 req/dia
- Exportacion de datos
- Soporte prioritario
- **Por que**: $29/mes es el precio al que Bitly ofrece su plan Growth (500 links, sin workspaces). MUGA ofrece 20x mas links + workspaces + retargeting por el mismo precio. Para agencias, esto es un no-brainer.

#### Enterprise: Custom
- Todo ilimitado
- SSO/SAML
- SLA 99.99%
- API custom rate limits
- Raw data export
- Dedicated account manager
- **Por que**: Solo cuando haya demanda real. No priorizar hasta $5K MRR.

---

# FASE 3: ARQUITECTURA TECNICA

---

## Stack validado y justificado

### Motor de redireccion: Cloudflare Workers + KV
- **Justificacion**: <20ms P50 latency globalmente, 300+ PoPs, cold start <1ms (V8 isolates). Free tier: 100K req/dia. $5/mes = 10M req/mes. El mas rapido y barato para redirects.
- **Alternativas descartadas**: Vercel Edge (78ms en tests, ~3x mas lento), AWS CloudFront + Lambda@Edge (150-400ms cold starts), Fastly (pricing menos transparente, menos PoPs)
- **Benchmark**: T.LY usa Cloudflare (60ms), Rebrandly usa Cloudflare (59ms). Valida la eleccion

### Base de datos: Supabase (PostgreSQL)
- **Justificacion**: Free tier generoso (500MB, 50K MAU), PostgreSQL completo, Row Level Security, Realtime, Auth integrado, API auto-generada. Elimina la necesidad de un ORM o backend separado.
- **Alternativas descartadas**: PlanetScale (MySQL, menos features), Neon (bueno pero Supabase tiene mas ecosystem), Turso (SQLite, demasiado limitado para SaaS multi-tenant)

### Cache hot links: Cloudflare KV (no Upstash Redis)
- **Justificacion**: KV esta integrado nativamente con Workers: zero latency extra. No necesitamos Redis si los Workers ya tienen KV con 100K reads/dia gratis. Simplifica el stack eliminando una dependencia.
- **Cambio vs stack propuesto**: Eliminamos Upstash Redis. KV es suficiente para cache de links. Si necesitamos Redis para rate limiting o sessions en el futuro, anadimos entonces.

### Frontend dashboard: Next.js 15 + Tailwind CSS
- **Justificacion**: Next.js es el standard para SaaS dashboards. App Router + Server Components para rendimiento. Tailwind para velocidad de desarrollo con AI. El 90% de los templates de SaaS son Next.js + Tailwind.
- **Alternativas descartadas**: Nuxt (menos ecosystem SaaS), SvelteKit (menos templates/componentes), Remix (menos adopcion)

### Auth: Clerk
- **Justificacion**: Mejor DX del mercado para Next.js. Free tier hasta 10K MAU. Maneja OAuth, MFA, organizaciones, invitaciones: todo lo que necesitamos para workspaces. Supabase Auth es bueno pero Clerk es superior en UX.
- **Coste**: Free hasta 10K MAU, luego $0.02/MAU. Con 10K usuarios = $0. Con 50K = $800/mes. Escala con revenue.

### Pagos: Stripe Checkout (sin Billing)
- **Justificacion**: Stripe Checkout maneja toda la UI de pago. Sin usar Stripe Billing evitamos el 0.7% extra sobre cada transaccion. Gestionamos las suscripciones con webhooks + tabla en Supabase.
- **Implementacion**: Checkout Sessions para signup, Customer Portal para gestion, Webhooks para sincronizar estado.

### Email: Resend
- **Justificacion**: API moderna, 3K emails/mes gratis, pricing simple ($20/mes = 50K emails). Ideal para onboarding, notificaciones, reportes.

### Analytics de clicks: Cloudflare Analytics Engine
- **Justificacion**: Integrado nativamente con Workers. Sin latencia extra en la redireccion (async write). 25 propiedades por evento. Free con Workers Paid ($5/mes). Elimina la necesidad de Tinybird (que Dub.co usa y que complica el self-hosting).
- **Alternativas descartadas**: Tinybird (potente pero anade complejidad y coste), ClickHouse self-hosted (overengineering para esta fase)

### Analytics web (dashboard): Plausible Cloud
- **Justificacion**: Privacy-first, GDPR compliant, ligero. $9/mes hasta 10K pageviews. No queremos Google Analytics en un producto que limpia tracking.

### Monorepo: Turborepo
- **Justificacion**: Standard para monorepos TypeScript. Cache inteligente, paralelizacion de builds. Zero config con Vercel/Cloudflare.

### Deployment
- **Worker de redireccion**: Cloudflare Workers (global edge)
- **Frontend dashboard + API**: Cloudflare Pages (con Functions)
- **Justificacion**: Todo en Cloudflare simplifica DNS, SSL, deployment. Pages tiene free tier generoso (500 builds/mes, bandwidth ilimitado).

### Dominios
- **Links acortados activos**: `mug.ag` (dominio principal), `out.pw`, `tap.pw`, `jab.pw` (alternativos)
- **Plataforma/dashboard**: `muga.link`
- **API**: `api.muga.link`

---

## Schema de base de datos

```sql
-- ============================================
-- MUGA Database Schema: Supabase PostgreSQL
-- ============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USERS (managed by Clerk, synced via webhook)
-- ============================================
CREATE TABLE users (
    id TEXT PRIMARY KEY,                    -- Clerk user ID
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    avatar_url TEXT,
    plan TEXT NOT NULL DEFAULT 'free'       -- 'free', 'pro', 'agency', 'enterprise'
        CHECK (plan IN ('free', 'pro', 'agency', 'enterprise')),
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    stripe_subscription_status TEXT,        -- 'active', 'past_due', 'canceled', 'trialing'
    links_created_this_month INT NOT NULL DEFAULT 0,
    links_limit INT NOT NULL DEFAULT 100,  -- varies by plan
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- WORKSPACES
-- ============================================
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free'
        CHECK (plan IN ('free', 'pro', 'agency', 'enterprise')),
    logo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_members (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

-- ============================================
-- CUSTOM DOMAINS
-- ============================================
CREATE TABLE domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    domain TEXT NOT NULL UNIQUE,            -- e.g., "links.acme.com"
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    verification_token TEXT,
    ssl_status TEXT DEFAULT 'pending',      -- 'pending', 'active', 'failed'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_domains_workspace ON domains(workspace_id);

-- ============================================
-- LINKS
-- ============================================
CREATE TABLE links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    domain TEXT NOT NULL DEFAULT 'mug.ag',  -- serving domain
    slug TEXT NOT NULL,                     -- short code, e.g., "abc123"
    url TEXT NOT NULL,                      -- destination URL
    title TEXT,                             -- user-defined or auto-fetched
    description TEXT,
    image_url TEXT,                         -- OG image for previews

    -- Link settings
    password TEXT,                          -- bcrypt hash if password-protected
    expires_at TIMESTAMPTZ,
    archived BOOLEAN NOT NULL DEFAULT FALSE,

    -- Smart link / geo-redirect (JSONB for flexibility)
    -- Format: {"US": "https://...", "DE": "https://...", "default": "https://..."}
    geo_targets JSONB,
    -- Format: {"ios": "https://...", "android": "https://...", "default": "https://..."}
    device_targets JSONB,

    -- A/B testing
    ab_test_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ab_url TEXT,                            -- alternative destination
    ab_split INT DEFAULT 50,               -- percentage to variant A (0-100)

    -- Tracking
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,

    -- CTA overlay
    cta_id UUID REFERENCES ctas(id) ON DELETE SET NULL,

    -- Metadata
    user_id TEXT NOT NULL REFERENCES users(id),
    clicks INT NOT NULL DEFAULT 0,         -- denormalized counter for fast reads
    last_clicked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(domain, slug)
);

CREATE INDEX idx_links_workspace ON links(workspace_id);
CREATE INDEX idx_links_domain_slug ON links(domain, slug);
CREATE INDEX idx_links_user ON links(user_id);
CREATE INDEX idx_links_created ON links(created_at DESC);

-- ============================================
-- TAGS
-- ============================================
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, name)
);

CREATE TABLE link_tags (
    link_id UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (link_id, tag_id)
);

-- ============================================
-- RETARGETING PIXELS
-- ============================================
CREATE TABLE pixels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL
        CHECK (type IN ('meta', 'google', 'linkedin', 'twitter', 'tiktok', 'custom')),
    pixel_id TEXT NOT NULL,                -- the actual pixel/tag ID
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE link_pixels (
    link_id UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    pixel_id UUID NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
    PRIMARY KEY (link_id, pixel_id)
);

-- ============================================
-- CTA OVERLAYS
-- ============================================
CREATE TABLE ctas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'banner'
        CHECK (type IN ('banner', 'modal', 'button', 'form')),
    config JSONB NOT NULL,                 -- {headline, body, cta_text, cta_url, position, colors}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- QR CODES
-- ============================================
CREATE TABLE qr_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    link_id UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    style JSONB NOT NULL DEFAULT '{}',     -- {fg_color, bg_color, logo_url, corner_style}
    svg_url TEXT,                           -- stored in R2/S3
    png_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(link_id)
);

-- ============================================
-- API KEYS
-- ============================================
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,          -- sha256 hash of the key
    key_prefix TEXT NOT NULL,               -- first 8 chars for identification
    scopes TEXT[] NOT NULL DEFAULT '{links:read,links:write}',
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- CAMPAIGNS
-- ============================================
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE campaign_links (
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    link_id UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, link_id)
);

-- ============================================
-- CLICK EVENTS (summary table: detail in CF Analytics Engine)
-- ============================================
-- Daily aggregates synced from Cloudflare Analytics Engine
CREATE TABLE click_stats_daily (
    link_id UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    clicks INT NOT NULL DEFAULT 0,
    unique_visitors INT NOT NULL DEFAULT 0,
    -- Top breakdowns (JSONB for flexibility)
    countries JSONB,       -- {"US": 150, "DE": 80, "ES": 45}
    cities JSONB,          -- {"New York": 50, "Berlin": 30}
    devices JSONB,         -- {"mobile": 200, "desktop": 150, "tablet": 20}
    browsers JSONB,        -- {"Chrome": 180, "Safari": 100, "Firefox": 40}
    os JSONB,              -- {"iOS": 120, "Windows": 100, "Android": 80}
    referrers JSONB,       -- {"twitter.com": 100, "direct": 80, "google.com": 40}
    PRIMARY KEY (link_id, date)
);

CREATE INDEX idx_click_stats_date ON click_stats_daily(date DESC);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE links ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE pixels ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctas ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- Users can only see workspaces they are members of
CREATE POLICY workspace_member_policy ON workspaces
    FOR ALL USING (
        id IN (
            SELECT workspace_id FROM workspace_members
            WHERE user_id = auth.uid()
        )
    );

-- Links visible only within user's workspaces
CREATE POLICY link_workspace_policy ON links
    FOR ALL USING (
        workspace_id IN (
            SELECT workspace_id FROM workspace_members
            WHERE user_id = auth.uid()
        )
    );
```

---

## API endpoints (v1)

Base URL: `https://api.muga.link/v1`

Auth: Bearer token (API key) en header `Authorization: Bearer muga_xxx`

### Links
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/links` | Create a short link | Required |
| GET | `/links` | List links (paginated, filterable) | Required |
| GET | `/links/:id` | Get link details | Required |
| PATCH | `/links/:id` | Update link | Required |
| DELETE | `/links/:id` | Delete link | Required |
| POST | `/links/bulk` | Create multiple links | Required (Pro+) |
| GET | `/links/:id/stats` | Get link analytics | Required |
| GET | `/links/:id/stats/timeseries` | Get click timeseries | Required |
| GET | `/links/:id/stats/countries` | Get clicks by country | Required |
| GET | `/links/:id/stats/devices` | Get clicks by device | Required |
| GET | `/links/:id/stats/referrers` | Get clicks by referrer | Required |

### Domains
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/domains` | Add custom domain | Required |
| GET | `/domains` | List domains | Required |
| GET | `/domains/:id` | Get domain details + verification status | Required |
| DELETE | `/domains/:id` | Remove domain | Required |
| POST | `/domains/:id/verify` | Trigger domain verification | Required |

### QR Codes
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/links/:id/qr` | Generate QR code for link | Required |
| GET | `/links/:id/qr` | Get QR code (SVG/PNG) | Public |

### Workspaces
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/workspaces` | Create workspace | Required (Agency+) |
| GET | `/workspaces` | List user workspaces | Required |
| PATCH | `/workspaces/:id` | Update workspace | Required (admin+) |
| DELETE | `/workspaces/:id` | Delete workspace | Required (owner) |
| POST | `/workspaces/:id/invite` | Invite member | Required (admin+) |
| DELETE | `/workspaces/:id/members/:uid` | Remove member | Required (admin+) |

### Tags
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/tags` | Create tag | Required |
| GET | `/tags` | List tags | Required |
| DELETE | `/tags/:id` | Delete tag | Required |

### Pixels
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/pixels` | Add retargeting pixel | Required |
| GET | `/pixels` | List pixels | Required |
| DELETE | `/pixels/:id` | Remove pixel | Required |

### Webhooks
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/webhooks` | Register webhook URL | Required (Pro+) |
| GET | `/webhooks` | List webhooks | Required |
| DELETE | `/webhooks/:id` | Remove webhook | Required |

### Account
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/me` | Get current user + plan info | Required |
| GET | `/me/usage` | Get current month usage | Required |

---

## Arquitectura de analytics asincrono

```
User clicks mug.ag/abc123
         |
         v
+-------------------+
| Cloudflare Worker  |
| (edge, <20ms)     |
|                    |
| 1. Lookup slug     |
|    in KV cache     |
|                    |
| 2. Return 301      |
|    redirect        |
|    immediately     |
|                    |
| 3. ctx.waitUntil(  |<-- Non-blocking! Redirect already sent
|    logClick()      |
|    )               |
+-------------------+
         |
         v (async, after redirect)
+-------------------+
| Analytics Engine   |
| (CF native)       |
|                    |
| Write event:       |
| - link_id          |
| - timestamp        |
| - country (CF hdr) |
| - city (CF hdr)    |
| - device (UA)      |
| - browser (UA)     |
| - os (UA)          |
| - referrer         |
| - ip_hash          |
+-------------------+
         |
         v (cron, every 6h)
+-------------------+
| Aggregation Worker |
| (scheduled)        |
|                    |
| Query Analytics    |
| Engine, aggregate  |
| into daily stats,  |
| write to Supabase  |
| click_stats_daily  |
+-------------------+
         |
         v
+-------------------+
| Supabase           |
| (PostgreSQL)       |
|                    |
| click_stats_daily  |
| Serves dashboard   |
| queries            |
+-------------------+
```

**Flujo detallado:**

1. **Click llega** al Worker en el edge mas cercano al usuario
2. **KV lookup** del slug → obtiene URL destino + link_id + configuracion (geo/device targets, password, expiry)
3. **301 redirect** enviado inmediatamente al usuario. Latencia total <20ms
4. **`ctx.waitUntil()`** ejecuta el logging de forma asincrona: NO bloquea la respuesta
5. El evento se escribe en **Cloudflare Analytics Engine** con toda la metadata (geo viene de los headers CF-IPCountry y CF-IPCity, device/browser del User-Agent)
6. **Cron Worker** (cada 6 horas) agrega datos del Analytics Engine en resumenes diarios y los escribe en la tabla `click_stats_daily` de Supabase
7. El **dashboard** consulta Supabase para mostrar graficos y tablas

**Retargeting pixels**: Cuando un link tiene pixels asociados, el Worker NO hace 301 directo. En su lugar, sirve una pagina HTML minima que:
- Carga los pixels (Meta, Google, etc.)
- Espera 100ms
- Redirige via JavaScript `window.location.replace(url)`
- Latencia total: ~200ms (aceptable para links con retargeting)

---

## Estructura del monorepo

```
muga/
├── apps/
│   ├── web/                    # Next.js 15: Dashboard + Landing + Blog
│   │   ├── app/
│   │   │   ├── (dashboard)/    # Authenticated dashboard routes
│   │   │   │   ├── links/
│   │   │   │   ├── analytics/
│   │   │   │   ├── domains/
│   │   │   │   ├── settings/
│   │   │   │   └── layout.tsx
│   │   │   ├── (marketing)/    # Public landing pages
│   │   │   │   ├── page.tsx    # Homepage muga.link
│   │   │   │   ├── pricing/
│   │   │   │   ├── blog/
│   │   │   │   └── vs/         # Comparison pages (MUGA vs Bitly, etc.)
│   │   │   ├── api/
│   │   │   │   ├── v1/         # Public API routes
│   │   │   │   └── webhooks/   # Stripe + Clerk webhooks
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   ├── lib/
│   │   └── package.json
│   │
│   ├── worker/                 # Cloudflare Worker: Redirect engine
│   │   ├── src/
│   │   │   ├── index.ts        # Main handler: lookup + redirect + async log
│   │   │   ├── analytics.ts    # Click event logging to Analytics Engine
│   │   │   ├── geo.ts          # Geo/device targeting logic
│   │   │   ├── pixel.ts        # Retargeting pixel HTML renderer
│   │   │   └── password.ts     # Password-protected link handler
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   └── extension/              # Browser extension (Chrome + Firefox)
│       ├── src/
│       │   ├── manifest.json
│       │   ├── background/
│       │   │   └── service-worker.js
│       │   ├── popup/
│       │   │   ├── popup.html
│       │   │   ├── popup.css
│       │   │   └── popup.js    # Shorten current URL + clean it
│       │   ├── content/
│       │   │   └── cleaner.js  # Existing URL cleaning logic
│       │   └── lib/
│       │       ├── affiliates.js
│       │       ├── cleaner.js
│       │       ├── api.js      # MUGA API client
│       │       └── storage.js
│       ├── icons/
│       └── package.json
│
├── packages/
│   ├── db/                     # Database schema + types
│   │   ├── schema.sql
│   │   ├── migrations/
│   │   ├── types.ts            # Generated TypeScript types
│   │   └── package.json
│   │
│   ├── ui/                     # Shared UI components
│   │   ├── src/
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── card.tsx
│   │   │   ├── modal.tsx
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── config/                 # Shared configs
│       ├── eslint/
│       ├── tsconfig/
│       ├── tailwind/
│       └── package.json
│
├── turbo.json
├── package.json
├── pnpm-workspace.yaml
└── .github/
    └── workflows/
        ├── ci.yml              # Test + lint on PR
        ├── deploy-worker.yml   # Deploy redirect worker
        └── deploy-web.yml      # Deploy dashboard
```

---

## Decision open-source vs closed-source

### Recomendacion: **Closed-source core, extension open-source**

| Factor | Open Source (como Dub.co) | Closed Source | MUGA Hibrido |
|--------|--------------------------|---------------|--------------|
| Traccion inicial | Alta (GitHub stars, HN) | Baja | Media |
| Confianza devs | Alta | Baja | Alta (extension abierta) |
| Riesgo de forks | Alto (AGPL mitiga, pero no elimina) | Cero | Bajo |
| Velocidad de desarrollo | Mas lenta (codigo publico = mas cuidado) | Rapida | Rapida |
| Monetizacion | Mas dificil (self-hosting gratis) | Clara | Clara |
| Mantenimiento | Alto (PRs externos, issues) | Bajo | Bajo |

**Razon principal**: Dub.co ya es el "open-source URL shortener". Competir en el mismo posicionamiento es perder. MUGA se diferencia por la extension, el pricing, y la UX: no por ser open source.

**Lo que SI publicamos open source**:
- La extension de navegador (ya es MIT en GitHub)
- Documentacion de la API
- SDKs de cliente (TypeScript, Python)

**Lo que mantenemos cerrado**:
- Worker de redireccion
- Dashboard y backend
- Analytics engine

---

# FASE 4: PLAN DE DESARROLLO CON AGENTES DE IA

---

## Sprint 0: Infraestructura base (Semana 1)

### Objetivo del sprint
Monorepo configurado, Worker de redireccion desplegado en mug.ag, lookup en KV funcional. Un link hardcoded en KV redirige correctamente.

### Criterio de exito
`curl -I https://mug.ag/test` devuelve HTTP 301 con `Location: https://muga.link`

### Tareas

#### Tarea 0.1: Configurar monorepo con Turborepo

**Criterio de done:** `pnpm install` y `pnpm build` funcionan sin errores en la raiz del monorepo. La estructura de carpetas coincide con el arbol definido en la arquitectura.
**Dependencias:** Ninguna
**Prompt para el agente:**
---
Crea un monorepo TypeScript con Turborepo y pnpm workspaces en el directorio `/home/yocreoquesi/projects/muga-saas/`. La estructura debe ser:

```
muga-saas/
├── apps/
│   ├── web/          (Next.js 15 app con App Router + Tailwind CSS v4)
│   ├── worker/       (Cloudflare Worker con wrangler)
│   └── extension/    (directorio vacio por ahora, se copiara del proyecto existente)
├── packages/
│   ├── db/           (package TypeScript vacio, exporta types)
│   ├── ui/           (componentes React compartidos, Tailwind)
│   └── config/       (ESLint flat config + tsconfig base compartidos)
├── turbo.json
├── package.json
├── pnpm-workspace.yaml
└── .gitignore
```

Requisitos:
1. Usa pnpm como package manager (pnpm-workspace.yaml)
2. turbo.json debe definir pipelines para: build, dev, lint, test
3. apps/web: `npx create-next-app@latest` con App Router, TypeScript, Tailwind, ESLint, src/ directory
4. apps/worker: `npm create cloudflare@latest` con template "Hello World" TypeScript Worker
5. packages/ui: Configura con React + Tailwind, exporta un componente Button basico
6. packages/config: ESLint flat config compartido + tsconfig base que extienden todos los packages
7. packages/db: Package TypeScript vacio que exporta un type `Link` basico
8. Verifica que `pnpm install` y `pnpm build` funcionan sin errores
9. Inicializa git repo con un commit inicial
10. No instales nada que no sea estrictamente necesario

NO uses create-turbo. Configura cada pieza manualmente para control total.
---

#### Tarea 0.2: Configurar Cloudflare Workers + KV

**Criterio de done:** Worker desplegado en Cloudflare con binding a KV namespace. `wrangler dev` funcional en local.
**Dependencias:** Tarea 0.1
**Prompt para el agente:**
---
En el directorio `apps/worker/` del monorepo muga-saas, configura el Cloudflare Worker para actuar como motor de redireccion de URLs.

1. Edita `wrangler.toml`:
   - name = "muga-redirect"
   - Crea KV namespace binding llamado "LINKS" (usa `wrangler kv namespace create LINKS`)
   - Crea tambien el namespace de preview: `wrangler kv namespace create LINKS --preview`
   - Configura Analytics Engine binding llamado "ANALYTICS" (dataset = "clicks")
   - Configura route: mug.ag/*

2. Implementa `src/index.ts`:
   - Handler que extrae el slug de la URL path
   - Busca el slug en KV: `env.LINKS.get(slug)`
   - Si encuentra: devuelve Response redirect 301 a la URL destino
   - Si no encuentra: devuelve 404 con pagina HTML minima "Link not found"
   - Implementa ctx.waitUntil() para logging asincrono (por ahora solo console.log del click)

3. Inserta un link de prueba en KV:
   `wrangler kv key put --binding LINKS "test" "https://muga.link"`

4. Verifica con `wrangler dev` que localhost/test redirige a muga.link

No despliegues a produccion todavia. Solo verifica que funciona en local.
---

#### Tarea 0.3: Configurar Supabase con schema inicial

**Criterio de done:** Proyecto Supabase creado, schema SQL ejecutado, tablas visibles en dashboard de Supabase.
**Dependencias:** Tarea 0.1
**Prompt para el agente:**
---
Configura la base de datos Supabase para el proyecto MUGA.

1. En `packages/db/schema.sql`, escribe el schema SQL completo que te proporciono (esta en el documento de arquitectura). Incluye todas las tablas: users, workspaces, workspace_members, domains, links, tags, link_tags, pixels, link_pixels, ctas, qr_codes, api_keys, campaigns, campaign_links, click_stats_daily.

2. Crea un archivo `packages/db/migrations/001_initial.sql` con el mismo contenido.

3. Configura Supabase CLI:
   - `npx supabase init` en packages/db/
   - `npx supabase link --project-ref <PROJECT_REF>` (el usuario proporcionara el project ref)
   - `npx supabase db push` para aplicar el schema

4. Genera los tipos TypeScript:
   - `npx supabase gen types typescript --linked > packages/db/types.ts`

5. En `packages/db/index.ts`, exporta los tipos generados y un helper para crear el cliente Supabase:
   ```typescript
   import { createClient } from '@supabase/supabase-js'
   import type { Database } from './types'

   export const createSupabaseClient = (url: string, key: string) =>
     createClient<Database>(url, key)

   export type { Database }
   ```

6. Anade @supabase/supabase-js como dependencia del package.

NOTA: El usuario debe tener un proyecto Supabase creado previamente. Si no existe, indique que debe crearlo en supabase.com y proporcionar SUPABASE_URL y SUPABASE_ANON_KEY.
---

#### Tarea 0.4: Conectar dominio mug.ag a Cloudflare

**Criterio de done:** mug.ag resuelve a Cloudflare, SSL activo, Worker responde en mug.ag/test.
**Dependencias:** Tarea 0.2
**Prompt para el agente:**
---
Conecta el dominio mug.ag a Cloudflare Workers para que sirva como dominio principal de links cortos de MUGA.

1. Verifica que mug.ag esta en la cuenta de Cloudflare:
   `wrangler whoami`

2. En `apps/worker/wrangler.toml`, configura la route:
   ```toml
   routes = [
     { pattern = "mug.ag/*", zone_name = "mug.ag" }
   ]
   ```

3. Despliega el Worker a produccion:
   `cd apps/worker && wrangler deploy`

4. En el dashboard de Cloudflare (o via API), asegurate de que:
   - SSL mode es "Full (strict)"
   - Always Use HTTPS esta activado
   - HTTP/2 y HTTP/3 estan activados

5. Inserta el link de prueba en el KV de produccion:
   `wrangler kv key put --binding LINKS "test" "https://muga.link" --env production`

6. Verifica: `curl -I https://mug.ag/test` debe devolver 301 con Location: https://muga.link

NOTA: Si mug.ag no esta en Cloudflare, el usuario debe transferir los nameservers primero. Proporciona las instrucciones para hacerlo en el registrar del dominio.
---

#### Tarea 0.5: Verificar redireccion end-to-end

**Criterio de done:** mug.ag/test redirige a muga.link con HTTP 301, tiempo de respuesta <50ms.
**Dependencias:** Tarea 0.4
**Prompt para el agente:**
---
Verifica que la infraestructura de redireccion de MUGA funciona correctamente end-to-end.

1. Desde la terminal, ejecuta:
   ```bash
   curl -sI -w "\ntime_namelookup: %{time_namelookup}\ntime_connect: %{time_connect}\ntime_starttransfer: %{time_starttransfer}\ntime_total: %{time_total}\n" "https://mug.ag/test"
   ```

   Verifica que:
   - HTTP status es 301
   - Header Location es https://muga.link
   - time_starttransfer es <100ms

2. Prueba con un slug que no existe:
   ```bash
   curl -s "https://mug.ag/noexiste"
   ```
   Debe devolver una pagina 404 con HTML basico.

3. Anade 3 links de prueba mas via KV:
   ```bash
   wrangler kv key put --binding LINKS "github" "https://github.com/yocreoquesi/muga"
   wrangler kv key put --binding LINKS "docs" "https://docs.muga.link"
   wrangler kv key put --binding LINKS "pricing" "https://muga.link/pricing"
   ```

4. Verifica que los 3 links redirigen correctamente.

5. Si todo funciona, el Sprint 0 esta completo. Documenta los tiempos de respuesta obtenidos.
---

---

## Sprint 1: MVP cobrable (Semanas 2-3)

### Objetivo del sprint
Dashboard funcional donde un usuario puede registrarse, crear links, ver clicks, y pagar por un plan Pro via Stripe. Deploy en produccion en muga.link.

### Criterio de exito
Un usuario puede: 1) Registrarse, 2) Crear un link corto, 3) El link redirige en mug.ag, 4) Ver clicks en el dashboard, 5) Pagar por el plan Pro via Stripe Checkout.

### Tareas

#### Tarea 1.1: Auth con Clerk

**Criterio de done:** Registro, login y logout funcionan en muga.link. El usuario aparece en la tabla `users` de Supabase tras registrarse.
**Dependencias:** Sprint 0
**Prompt para el agente:**
---
Implementa autenticacion con Clerk en la app Next.js (`apps/web/`).

1. Instala Clerk: `pnpm add @clerk/nextjs` en apps/web

2. Configura Clerk:
   - Crea `apps/web/.env.local` con NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY y CLERK_SECRET_KEY (el usuario los proporcionara)
   - Configura `middleware.ts` para proteger rutas /dashboard/*
   - Rutas publicas: /, /pricing, /blog/*, /api/webhooks/*

3. Implementa las paginas de auth:
   - `app/(auth)/sign-in/[[...sign-in]]/page.tsx`: pagina de login
   - `app/(auth)/sign-up/[[...sign-up]]/page.tsx`: pagina de registro
   - Usa componentes de Clerk: <SignIn /> y <SignUp />

4. Configura webhook de Clerk para sincronizar usuarios con Supabase:
   - `app/api/webhooks/clerk/route.ts`
   - Al crear usuario: INSERT en tabla `users` con clerk_id, email, name
   - Al actualizar usuario: UPDATE
   - Al eliminar usuario: DELETE (cascade)
   - Verifica la firma del webhook con `svix`

5. Crea un layout para el dashboard con el UserButton de Clerk en el header.

6. Verifica que tras registrarse, el usuario aparece en Supabase.

IMPORTANTE: No hardcodees ninguna key. Todo via variables de entorno.
---

#### Tarea 1.2: Dashboard basico (crear y listar links)

**Criterio de done:** El usuario puede crear un link corto desde el dashboard, ver la lista de sus links, y copiar el link al clipboard.
**Dependencias:** Tarea 1.1
**Prompt para el agente:**
---
Implementa el dashboard basico de MUGA en `apps/web/app/(dashboard)/`.

1. **Layout del dashboard** (`layout.tsx`):
   - Sidebar con navegacion: Links, Analytics, Domains, Settings
   - Header con UserButton (Clerk) + workspace selector (placeholder)
   - Responsive: sidebar colapsable en mobile

2. **Pagina de Links** (`links/page.tsx`):
   - Boton "Create Link" que abre un modal
   - Modal con form: URL destino (required), slug personalizado (optional), titulo (optional)
   - Si no se proporciona slug, genera uno aleatorio de 6 caracteres (base62)
   - Al crear: POST a `/api/v1/links` que inserta en Supabase + escribe en Cloudflare KV
   - Lista de links del usuario con: short URL, destino (truncado), clicks, fecha, boton copiar
   - Paginacion (20 links por pagina)
   - Boton de copiar que copia `https://mug.ag/{slug}` al clipboard con feedback visual

3. **API route** (`api/v1/links/route.ts`):
   - POST: Crea link (valida URL, genera slug si no hay, inserta en Supabase, escribe en KV via Cloudflare API)
   - GET: Lista links del usuario autenticado (paginado, ordenado por fecha desc)
   - Autenticacion via Clerk `auth()`

4. **Cloudflare KV sync**:
   - Usa la API REST de Cloudflare para escribir en KV desde Next.js:
     `PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key}`
   - Configura CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID en .env.local

5. Usa Tailwind CSS para estilos. Diseno limpio, moderno, minimal. Inspirado en Dub.co pero con identidad propia.

Componentes UI necesarios: Button, Input, Modal, Card, Table, CopyButton, Badge
Puedes usar shadcn/ui como base si lo prefieres.
---

#### Tarea 1.3: Motor de redireccion con analytics asincrono

**Criterio de done:** Cada click a mug.ag/{slug} se registra en Cloudflare Analytics Engine. Un endpoint de API devuelve el conteo de clicks de un link.
**Dependencias:** Tarea 0.2
**Prompt para el agente:**
---
Actualiza el Worker de redireccion en `apps/worker/` para registrar clicks de forma asincrona.

1. **Actualiza `src/index.ts`**:
   - Tras buscar el slug en KV y obtener la URL destino, usa `ctx.waitUntil()` para logging asincrono
   - El redirect 301 se envia ANTES de que el logging complete

2. **Implementa `src/analytics.ts`**:
   - Funcion `logClick(env, request, linkData)` que escribe en Cloudflare Analytics Engine:
     ```typescript
     env.ANALYTICS.writeDataPoint({
       blobs: [
         linkId,                           // link UUID
         request.cf?.country || 'unknown', // country
         request.cf?.city || 'unknown',    // city
         parseDevice(userAgent),           // 'mobile', 'desktop', 'tablet'
         parseBrowser(userAgent),          // 'Chrome', 'Safari', etc.
         parseOS(userAgent),              // 'iOS', 'Windows', etc.
         request.headers.get('referer') || 'direct'
       ],
       indexes: [linkId]
     })
     ```
   - Implementa parseDevice(), parseBrowser(), parseOS() como parsers simples del User-Agent (no necesitas libreria, regex basico basta)

3. **Actualiza el formato de KV**:
   - En vez de guardar solo la URL en KV, guarda JSON:
     ```json
     {"url": "https://destino.com", "id": "uuid-del-link"}
     ```
   - Actualiza el handler para parsear JSON

4. **Actualiza `wrangler.toml`**:
   - Verifica que el binding de Analytics Engine esta configurado:
     ```toml
     [[analytics_engine_datasets]]
     binding = "ANALYTICS"
     dataset = "clicks"
     ```

5. **Despliega y verifica**:
   - `wrangler deploy`
   - Haz un click de prueba
   - Verifica en el dashboard de Cloudflare > Analytics Engine que el evento se registro

6. **Incremento de clicks**:
   - Despues del logging, tambien llama a la API de Supabase para incrementar `links.clicks += 1`
   - Usa una funcion RPC de Supabase o un simple UPDATE
   - Este incremento tambien va dentro de ctx.waitUntil(): no bloquea el redirect
---

#### Tarea 1.4: Integracion Stripe (plan Pro)

**Criterio de done:** El usuario puede hacer click en "Upgrade to Pro", ser redirigido a Stripe Checkout, pagar, y ver su plan actualizado a Pro en el dashboard.
**Dependencias:** Tarea 1.1
**Prompt para el agente:**
---
Implementa la integracion de pagos con Stripe en MUGA para el plan Pro ($9/mes).

1. **Configura Stripe**:
   - Instala: `pnpm add stripe @stripe/stripe-js` en apps/web
   - Crea un producto "MUGA Pro" en Stripe dashboard con precio $9/mes recurring
   - Configura .env.local: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_PRO_PRICE_ID, STRIPE_WEBHOOK_SECRET

2. **Checkout endpoint** (`api/stripe/checkout/route.ts`):
   - POST: Crea una Stripe Checkout Session
   - mode: 'subscription'
   - line_items: [{ price: STRIPE_PRO_PRICE_ID, quantity: 1 }]
   - success_url: `${origin}/dashboard?upgraded=true`
   - cancel_url: `${origin}/pricing`
   - customer_email: email del usuario Clerk
   - metadata: { userId: clerk_user_id }
   - Si el usuario ya tiene stripe_customer_id, usalo

3. **Webhook endpoint** (`api/webhooks/stripe/route.ts`):
   - Verifica la firma con stripe.webhooks.constructEvent()
   - `checkout.session.completed`: Actualiza usuario en Supabase: plan='pro', stripe_customer_id, stripe_subscription_id, stripe_subscription_status='active', links_limit=1000
   - `customer.subscription.updated`: Sincroniza status
   - `customer.subscription.deleted`: Downgrade a free: plan='free', links_limit=100
   - `invoice.payment_failed`: Marca status como 'past_due'

4. **Customer Portal** (`api/stripe/portal/route.ts`):
   - POST: Crea Stripe Customer Portal session para que el usuario gestione su suscripcion
   - return_url: `${origin}/dashboard/settings`

5. **Pagina de pricing** (`app/(marketing)/pricing/page.tsx`):
   - Muestra planes Free, Pro ($9/mes), Agency ($29/mes, coming soon)
   - Boton "Get Started Free" → /sign-up
   - Boton "Upgrade to Pro" → llama a /api/stripe/checkout
   - Feature comparison table

6. **Settings page** (`app/(dashboard)/settings/page.tsx`):
   - Muestra plan actual del usuario
   - Si free: boton "Upgrade to Pro"
   - Si pro: boton "Manage Subscription" → Stripe Customer Portal

7. **Plan enforcement**:
   - En el API de crear links, verifica links_created_this_month < links_limit
   - Si excede: devuelve 403 con mensaje de upgrade

NO uses Stripe Billing (evitar 0.7% surcharge). Usa Checkout Sessions + webhooks manuales.
---

#### Tarea 1.5: Landing page minima

**Criterio de done:** muga.link muestra una landing page con hero, features, pricing, y CTA de registro. Responsive y rapida.
**Dependencias:** Tarea 1.1
**Prompt para el agente:**
---
Crea una landing page minima pero efectiva para muga.link en `apps/web/app/(marketing)/page.tsx`.

La landing es el primer contacto con el usuario. Debe comunicar el valor en 5 segundos.

1. **Hero section**:
   - Headline: "Fair to every click"
   - Subheadline: "The fastest URL shortener with enterprise features at indie prices. Free forever."
   - CTA principal: "Start Shortening: Free" (→ /sign-up)
   - CTA secundario: "See Pricing" (→ /pricing)
   - Visual: Un input field decorativo que muestra la transformacion de una URL larga a mug.ag/clean

2. **Social proof** (placeholder por ahora):
   - "Trusted by X users" (actualizaremos el numero)
   - Logos placeholder de "Featured on" (Product Hunt, HN)

3. **Features grid** (3 columnas, iconos):
   - "Lightning Fast": Redirects in <20ms worldwide via Cloudflare edge
   - "Free Analytics": Geo, device, referrer analytics included in every plan
   - "Custom Domains": Use your own domain, free SSL included
   - "QR Codes": Dynamic QR codes, no watermarks, ever
   - "Browser Extension": Shorten any URL with one click from your browser
   - "Retargeting Pixels": Meta, Google, LinkedIn pixels on your links

4. **Comparison section**:
   - Tabla simple: MUGA vs Bitly vs T.LY vs Dub.co
   - Columnas: Free links, Analytics, Custom domains, Price
   - MUGA resaltado como mejor opcion

5. **Pricing section** (reusar componente de /pricing):
   - Free, Pro ($9/mo), Agency ($29/mo)

6. **Footer**:
   - Links: Privacy, Terms, Blog, API Docs, GitHub (extension)
   - "Made with obstinacy. No VC funding. No bullshit."

Disenado con Tailwind CSS. Dark mode por defecto (o toggle). Rapido. Sin imagenes pesadas, sin JS innecesario.
---

#### Tarea 1.6: Deploy en produccion

**Criterio de done:** muga.link sirve la web app, mug.ag sirve redirects, todo funcional en produccion.
**Dependencias:** Tareas 1.1-1.5
**Prompt para el agente:**
---
Despliega MUGA en produccion.

1. **Dashboard (apps/web) en Cloudflare Pages**:
   - Crea un proyecto en Cloudflare Pages: `muga-web`
   - Build command: `cd apps/web && pnpm build`
   - Output directory: `apps/web/.next`
   - O bien usa `@cloudflare/next-on-pages` para deploy en Pages
   - Configura custom domain: muga.link
   - Configura variables de entorno de produccion:
     - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
     - CLERK_SECRET_KEY
     - NEXT_PUBLIC_SUPABASE_URL
     - SUPABASE_SERVICE_ROLE_KEY
     - STRIPE_SECRET_KEY
     - STRIPE_PUBLISHABLE_KEY
     - STRIPE_PRO_PRICE_ID
     - STRIPE_WEBHOOK_SECRET
     - CLOUDFLARE_API_TOKEN
     - CLOUDFLARE_ACCOUNT_ID
     - CLOUDFLARE_KV_NAMESPACE_ID

2. **Worker (apps/worker) en Cloudflare Workers**:
   - Ya desplegado en Sprint 0
   - Verifica que sigue funcionando correctamente
   - Actualiza si hay cambios del Sprint 1

3. **Supabase**:
   - Verifica que el schema esta aplicado en produccion
   - Configura RLS policies
   - Anota las URLs y keys de produccion

4. **DNS**:
   - muga.link → Cloudflare Pages
   - mug.ag → Cloudflare Workers
   - api.muga.link → CNAME a Pages (las API routes de Next.js sirven la API)

5. **Verificacion end-to-end**:
   - Registrate como nuevo usuario en muga.link
   - Crea un link corto
   - Verifica que mug.ag/{slug} redirige
   - Verifica que el click aparece en el dashboard
   - Haz upgrade a Pro via Stripe (usa Stripe test mode)
   - Verifica que el plan se actualiza

6. **CI/CD** (GitHub Actions):
   - `.github/workflows/deploy-web.yml`: Deploy a Pages on push to main
   - `.github/workflows/deploy-worker.yml`: Deploy Worker on push to main (changes in apps/worker/)
---

---

## Sprint 2: Features competitivos (Semanas 4-6)

### Objetivo del sprint
Analytics graficos en el dashboard, custom domains funcionales, QR codes, API publica con keys, extension integrada con cuenta del usuario.

### Criterio de exito
1) Analytics con graficos de clicks, mapa de paises, top referrers. 2) Un custom domain del usuario sirve redirects. 3) Cada link tiene un QR code descargable. 4) La API funciona con API keys. 5) La extension de MUGA puede shortear URLs usando la cuenta del usuario.

### Tareas

#### Tarea 2.1: Analytics de clicks (dashboard)
**Criterio de done:** Pagina /dashboard/analytics muestra graficos de clicks (timeseries), breakdown por pais (tabla + mapa), dispositivos (pie chart), y top referrers.
**Dependencias:** Sprint 1
**Prompt para el agente:**
---
Implementa la pagina de analytics en el dashboard de MUGA en `apps/web/app/(dashboard)/analytics/`.

1. **Cron Worker para agregar datos** (`apps/worker/src/cron.ts`):
   - Triggered cada 6 horas via Cloudflare Cron Triggers
   - Query Cloudflare Analytics Engine via SQL API:
     ```sql
     SELECT blob1 as link_id, blob2 as country, blob3 as city,
            blob4 as device, blob5 as browser, blob6 as os, blob7 as referrer,
            count() as clicks
     FROM clicks
     WHERE timestamp > now() - 6h
     GROUP BY ALL
     ```
   - Agrega resultados en la tabla `click_stats_daily` de Supabase
   - Usa upsert para no duplicar datos

2. **API endpoints de analytics** (`api/v1/links/[id]/stats/`):
   - `GET /stats`: resumen: total clicks, unique visitors (ultimos 7/30/90 dias)
   - `GET /stats/timeseries?period=7d|30d|90d`: clicks por dia
   - `GET /stats/countries`: clicks por pais
   - `GET /stats/cities`: clicks por ciudad (Pro+)
   - `GET /stats/devices`: clicks por device type
   - `GET /stats/browsers`: clicks por browser
   - `GET /stats/referrers`: clicks por referrer
   - Todos consultan la tabla click_stats_daily

3. **Pagina de analytics** (`analytics/page.tsx`):
   - Selector de periodo: Last 7 days, 30 days, 90 days
   - Grafico de lineas: clicks over time (usa recharts o chart.js)
   - Tabla de paises con banderas + barras de porcentaje
   - Pie chart de dispositivos (mobile/desktop/tablet)
   - Lista de top 10 referrers con clicks
   - Loading states y empty states

4. **Link detail analytics** (`links/[id]/page.tsx`):
   - Al hacer click en un link de la lista, mostrar sus analytics individuales
   - Mismos graficos pero para un solo link

Usa una libreria de graficos ligera: recharts (React-native) o chart.js con react-chartjs-2.
---

#### Tarea 2.2: Custom domains
**Criterio de done:** Un usuario puede anadir su propio dominio en el dashboard, configurar DNS CNAME, y el Worker sirve redirects en ese dominio.
**Dependencias:** Sprint 1
**Prompt para el agente:**
---
Implementa soporte de custom domains para MUGA.

1. **Dashboard UI** (`app/(dashboard)/domains/page.tsx`):
   - Lista de dominios del workspace
   - Boton "Add Domain" → modal con input para el dominio
   - Instrucciones de configuracion DNS: "Add a CNAME record pointing to `cname.mug.ag`"
   - Status: pending verification / verified / SSL active
   - Boton "Verify" que comprueba DNS

2. **API endpoint** (`api/v1/domains/route.ts`):
   - POST: Inserta dominio en Supabase, genera verification_token
   - GET: Lista dominios del workspace
   - POST /:id/verify:
     a. Verifica que el CNAME apunta a cname.mug.ag (DNS lookup)
     b. Marca como verified
     c. Registra el dominio como custom hostname en Cloudflare via API:
        `POST /zones/{zone_id}/custom_hostnames`
        con ssl: {method: "txt", type: "dv"}

3. **Worker update** (`apps/worker/src/index.ts`):
   - El Worker ya escucha en mug.ag/*
   - Para custom domains, Cloudflare Custom Hostnames rutea automaticamente al mismo Worker
   - Actualiza la KV key format para incluir el domain: `{domain}:{slug}` → URL
   - Fallback: si no encuentra `{custom_domain}:{slug}`, busca `mug.ag:{slug}`

4. **KV sync update**:
   - Cuando se crea un link con custom domain, escribe en KV con key `{domain}:{slug}`
   - Actualiza la API de crear links para soportar el campo `domain`

5. **Plan enforcement**:
   - Free: 1 custom domain
   - Pro: 3 custom domains
   - Agency: 10 custom domains
   - Verificar limite al crear dominio

Cloudflare Custom Hostnames docs: https://developers.cloudflare.com/ssl/ssl-for-saas/
---

#### Tarea 2.3: QR codes dinamicos
**Criterio de done:** Cada link tiene un boton para generar/descargar un QR code en SVG y PNG. Sin marca de agua. Personalizacion basica de colores.
**Dependencias:** Sprint 1
**Prompt para el agente:**
---
Implementa generacion de QR codes para links de MUGA.

1. Instala dependencia: `pnpm add qrcode` (libreria JS para generar QR en SVG/PNG)

2. **API endpoint** (`api/v1/links/[id]/qr/route.ts`):
   - GET: Genera QR code para el link
   - Query params: format (svg|png), size (128-1024, default 256), fg_color (#000000), bg_color (#ffffff)
   - Genera el QR con la URL corta del link (e.g., https://mug.ag/abc123)
   - Devuelve la imagen directamente con Content-Type apropiado
   - Cache la respuesta con Cache-Control: public, max-age=86400

3. **Dashboard integration**:
   - En la lista de links, boton de QR code que abre un modal
   - El modal muestra preview del QR code
   - Opciones: cambiar colores (fg/bg), tamano
   - Botones de descarga: SVG, PNG
   - Boton "Copy QR URL" para embeber en emails/webs

4. **QR code en tabla de link detail**:
   - Cuando el usuario ve el detalle de un link, mostrar el QR prominentemente

5. Sin marca de agua en ningun plan. Este es un diferenciador vs Bitly.
---

#### Tarea 2.4: API publica con API keys
**Criterio de done:** Un usuario puede crear API keys en el dashboard. La API acepta autenticacion via Bearer token. La documentacion basica esta disponible.
**Dependencias:** Sprint 1
**Prompt para el agente:**
---
Implementa API keys y autenticacion por API key para la API publica de MUGA.

1. **Generacion de API keys** (`app/(dashboard)/settings/api/page.tsx`):
   - UI para crear, listar y revocar API keys
   - Al crear: genera un key random (muga_sk_xxx...), muestra una sola vez
   - Guarda el hash SHA-256 en la tabla api_keys, guarda solo el prefijo para display
   - Lista de keys con: nombre, prefijo (muga_sk_xxxx...), fecha creacion, ultimo uso
   - Boton para revocar (delete)

2. **Middleware de auth API** (`lib/api-auth.ts`):
   - Funcion que extrae el Bearer token del header Authorization
   - Busca el hash del token en la tabla api_keys
   - Si valido: devuelve el usuario y workspace asociados
   - Si invalido: devuelve 401
   - Actualiza last_used_at

3. **Rate limiting**:
   - Free: 100 req/dia
   - Pro: 1,000 req/dia
   - Agency: 10,000 req/dia
   - Implementa con un counter en Supabase (simple) o KV del Worker
   - Devuelve headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset

4. **Actualizar todos los endpoints existentes**:
   - Los endpoints /api/v1/* deben aceptar AMBOS metodos de auth:
     a. Cookie/session de Clerk (para el dashboard)
     b. Bearer token API key (para clientes externos)

5. **Documentacion basica** (`app/(marketing)/docs/page.tsx`):
   - Pagina simple con la lista de endpoints
   - Ejemplo de autenticacion
   - Ejemplo de crear un link via curl
   - Ejemplo de obtener stats via curl
---

#### Tarea 2.5: Extension de navegador integrada con cuenta MUGA
**Criterio de done:** La extension MUGA existente puede: 1) Conectar con una cuenta MUGA via OAuth/API key, 2) Shortear la URL actual via la API, 3) Mostrar el link corto en el popup.
**Dependencias:** Sprint 1, Tarea 2.4
**Prompt para el agente:**
---
Integra la extension de navegador MUGA existente (en `/home/yocreoquesi/projects/muga/`) con el backend SaaS de MUGA.

La extension ya existe y limpia URLs de tracking params. Ahora anadimos la funcionalidad de shortening conectada al backend.

1. **Copia la extension** al monorepo:
   - Copia el contenido de `/home/yocreoquesi/projects/muga/src/` a `apps/extension/src/`
   - Mantiene toda la funcionalidad existente de limpieza de URLs

2. **Anade autenticacion al popup** (`popup/popup.js` o nuevo archivo):
   - Seccion "Connect MUGA Account" en el popup
   - Metodo de auth: API key (el usuario la copia del dashboard)
   - Input field para pegar la API key
   - Guardar en chrome.storage.sync
   - Status: "Connected as email@..." o "Not connected"

3. **Funcionalidad de shortening** (nuevo boton en popup):
   - Boton "Shorten This URL" prominente en el popup
   - Al hacer click:
     a. Toma la URL de la pestana actual
     b. Limpia la URL (quita tracking params: funcionalidad existente)
     c. Llama a POST /api/v1/links con la URL limpia
     d. Muestra el link corto (mug.ag/xxx) con boton de copiar
   - Si no esta conectado a una cuenta: usa un endpoint publico con rate limiting (5/dia)

4. **Contexto menu** (right-click):
   - "Shorten with MUGA" en el menu contextual de links
   - Shortea el link clickeado y copia al clipboard

5. **Badge**:
   - Muestra un badge en el icono de la extension con el numero de params eliminados en la pagina actual
   - Si se acaba de shortear un link, muestra un check verde temporalmente

No rompas ninguna funcionalidad existente de la extension. Los tests existentes deben seguir pasando.
---

---

## Sprint 3: Diferenciacion (Semanas 7-10)

### Objetivo del sprint
Implementar los features que distinguen a MUGA de la competencia: retargeting pixels, smart links con geo/device redirect, workspaces multi-usuario (Agency), y CTA overlays basicos.

### Criterio de exito
1) Un link con pixel de Meta dispara el pixel al hacer click. 2) Un smart link redirige a URLs distintas segun pais. 3) El plan Agency permite crear workspaces separados con miembros. 4) Un link con CTA muestra un banner overlay en la pagina destino.

### Tareas

#### Tarea 3.1: Retargeting pixels en links
**Criterio de done:** El usuario puede crear un pixel (Meta, Google), asociarlo a un link, y al hacer click el pixel se dispara antes del redirect.
**Dependencias:** Sprint 2
**Prompt para el agente:**
---
Implementa retargeting pixels en los links de MUGA.

1. **Dashboard: Gestion de pixels** (`app/(dashboard)/pixels/page.tsx`):
   - CRUD de pixels: nombre, tipo (Meta/Google/LinkedIn/TikTok/Custom), pixel ID
   - Al crear un link, selector multi-select para asociar pixels

2. **Worker: Pixel firing** (`apps/worker/src/pixel.ts`):
   - Cuando un link tiene pixels asociados, el Worker NO hace redirect 301 directo
   - En su lugar, sirve una pagina HTML minima (~1KB) que:
     a. Carga los scripts de los pixels seleccionados
     b. Dispara el evento PageView/ViewContent
     c. Despues de un timeout de 150ms, hace redirect via JavaScript:
        `setTimeout(() => window.location.replace(destinationUrl), 150)`
   - Template HTML minimo con solo los scripts necesarios
   - Meta pixel: fbq('track', 'PageView')
   - Google tag: gtag('event', 'page_view')

3. **KV format update**:
   - Actualiza el JSON en KV para incluir pixel info:
     ```json
     {"url": "https://...", "id": "uuid", "pixels": [{"type": "meta", "id": "123456"}]}
     ```

4. **Plan enforcement**:
   - Free: 1 pixel
   - Pro: ilimitados
   - Agency: ilimitados

La pagina HTML intermedia debe ser extremadamente ligera. No uses frameworks. HTML puro + scripts inline de los vendors de pixels.
---

#### Tarea 3.2: Smart links (geo/device redirect)
**Criterio de done:** Un link puede configurarse para redirigir a URLs distintas segun pais o dispositivo del visitante.
**Dependencias:** Sprint 2
**Prompt para el agente:**
---
Implementa smart links con geo-redirect y device-redirect en MUGA.

1. **Dashboard: Configuracion de smart link** (en el modal de crear/editar link):
   - Tab "Smart Targeting" con dos secciones:
     a. Geo targeting: Tabla de reglas (pais → URL destino). Dropdown de paises + input URL.
     b. Device targeting: iOS → URL, Android → URL, Desktop → URL (default)
   - Guardado en los campos `geo_targets` y `device_targets` (JSONB) de la tabla links

2. **Worker: Smart redirect logic** (`apps/worker/src/geo.ts`):
   - Tras obtener el link data del KV, check:
     a. Si `geo_targets` tiene entry para request.cf.country → usa esa URL
     b. Si `device_targets` tiene entry para el device type (parsea UA) → usa esa URL
     c. Fallback: URL por defecto del link
   - Prioridad: geo > device > default

3. **KV format update**:
   - Incluir geo_targets y device_targets en el JSON del KV:
     ```json
     {
       "url": "https://default.com",
       "id": "uuid",
       "geo": {"US": "https://us.com", "DE": "https://de.com"},
       "device": {"ios": "https://apps.apple.com/...", "android": "https://play.google.com/..."}
     }
     ```

4. **Cloudflare proporciona geo data gratis** en request.cf:
   - request.cf.country (ISO code)
   - request.cf.city
   - request.cf.continent
   - No necesitamos servicio de geoIP externo

5. **Plan enforcement**:
   - Free: no smart links
   - Pro+: smart links incluidos
---

#### Tarea 3.3: Workspaces multi-usuario (plan Agency)
**Criterio de done:** Un usuario Agency puede crear workspaces, invitar miembros por email, y cada workspace tiene sus propios links, dominios, y pixels.
**Dependencias:** Sprint 2
**Prompt para el agente:**
---
Implementa el sistema de workspaces multi-usuario para el plan Agency de MUGA.

1. **Workspace selector** (en el header del dashboard):
   - Dropdown que muestra todos los workspaces del usuario
   - Al cambiar workspace, toda la data del dashboard cambia (links, domains, pixels, analytics)
   - Workspace por defecto: "Personal" (creado automaticamente al registrarse)

2. **Pagina de workspace settings** (`app/(dashboard)/settings/workspace/page.tsx`):
   - Nombre y slug del workspace
   - Lista de miembros con roles (owner, admin, member)
   - Invitar miembro por email
   - Cambiar rol de miembro
   - Eliminar miembro

3. **Invitacion flow**:
   - POST /api/v1/workspaces/:id/invite con email
   - Envia email via Resend con link de invitacion
   - El invitado hace click → se registra (si no tiene cuenta) → se une al workspace
   - Implementa un token de invitacion en Supabase con expiry de 7 dias

4. **Data scoping**:
   - TODAS las queries del dashboard filtran por workspace_id
   - RLS de Supabase asegura que un usuario solo ve data de workspaces a los que pertenece
   - Los links, domains, pixels, tags, campaigns pertenecen a un workspace, no a un usuario

5. **Plan enforcement**:
   - Free: 1 workspace (personal), 1 usuario
   - Pro: 1 workspace, 1 usuario
   - Agency: 10 workspaces, 10 usuarios
---

#### Tarea 3.4: CTA overlays basicos
**Criterio de done:** Un link puede tener un CTA overlay que muestra un banner con texto y boton sobre la pagina destino.
**Dependencias:** Sprint 2
**Prompt para el agente:**
---
Implementa CTA overlays basicos para links de MUGA (plan Agency).

1. **Dashboard: Gestion de CTAs** (`app/(dashboard)/ctas/page.tsx`):
   - CRUD de CTAs
   - Editor con preview:
     - Tipo: banner (bottom) o button (corner)
     - Headline text
     - Body text
     - CTA button text + URL
     - Colores: bg, text, button

2. **Asociar CTA a link**:
   - En el editor de link, selector de CTA
   - Un link puede tener max 1 CTA

3. **Worker: CTA rendering** (`apps/worker/src/cta.ts`):
   - Cuando un link tiene CTA, el Worker NO redirige
   - Sirve un iframe wrapper:
     ```html
     <html>
       <body style="margin:0">
         <iframe src="DESTINATION_URL" style="width:100%;height:100%;border:none"></iframe>
         <div id="muga-cta" style="position:fixed;bottom:0;...">
           <!-- CTA banner HTML -->
         </div>
       </body>
     </html>
     ```
   - Alternativa si iframe falla (X-Frame-Options): redirect normal con cookie, luego inject via content script

4. **KV format**:
   - Incluir cta config en el JSON:
     ```json
     {"url":"...","id":"...","cta":{"type":"banner","headline":"...","body":"...","btn_text":"...","btn_url":"...","colors":{...}}}
     ```

5. **Plan enforcement**:
   - Solo Agency+ puede usar CTA overlays
   - Sniply cobra $9/mes por esto. MUGA lo incluye en Agency ($29/mes) junto con todo lo demas
---

---

## Sprint 4: Traccion y SEO (Semanas 11-16)

### Objetivo del sprint
SEO tecnico implementado, landing pages de comparativa publicadas, blog con primeros articulos, extension publicada en Chrome Web Store y Firefox, email onboarding automatizado.

### Criterio de exito
1) muga.link tiene sitemap, schema markup, meta tags optimizados. 2) Existen paginas /vs/bitly, /vs/tly, etc. 3) Blog con 5 articulos publicados. 4) Extension publicada en Chrome Web Store. 5) Nuevos usuarios reciben 3 emails de onboarding.

### Tareas

#### Tarea 4.1: SEO tecnico
**Criterio de done:** sitemap.xml, robots.txt, schema markup JSON-LD, Open Graph tags, y canonical URLs configurados correctamente.
**Dependencias:** Sprint 1
**Prompt para el agente:**
---
Implementa SEO tecnico completo para muga.link.

1. `app/sitemap.ts`: genera sitemap dinamico con todas las paginas publicas + blog posts
2. `app/robots.ts`: permite indexacion de paginas publicas, bloquea /dashboard/*
3. Metadata global en `app/layout.tsx` con Open Graph, Twitter cards
4. Schema markup JSON-LD en la homepage (SoftwareApplication) y pricing (Product)
5. Canonical URLs en todas las paginas
6. `<link rel="alternate" hreflang>` para futuro i18n
7. Verifica con Google Search Console (el usuario registrara el sitio)
---

#### Tarea 4.2: Landing pages de comparativa
**Criterio de done:** Paginas /vs/bitly, /vs/tly, /vs/rebrandly, /vs/short-io, /vs/dub publicadas con comparaciones detalladas.
**Dependencias:** Sprint 1, Fase 1 (datos de competidores)
**Prompt para el agente:**
---
Crea 5 landing pages de comparativa en `apps/web/app/(marketing)/vs/`:

1. `/vs/bitly`: "MUGA vs Bitly: Why Pay 20x More?"
2. `/vs/tly`: "MUGA vs T.LY: The Next-Gen URL Shortener"
3. `/vs/rebrandly`: "MUGA vs Rebrandly: Simpler Pricing, More Features"
4. `/vs/short-io`: "MUGA vs Short.io: Enterprise Features at Indie Prices"
5. `/vs/dub`: "MUGA vs Dub.co: Browser-Native Link Shortening"

Cada pagina debe tener:
- H1 optimizado para SEO con la keyword "[competitor] alternative"
- Tabla comparativa lado a lado (features, pricing, limits)
- 3-5 secciones detallando donde MUGA gana
- CTA: "Switch to MUGA: Free"
- Schema markup (ComparisonTable)
- Meta description optimizada para CTR

Usa datos reales de precios y features de la Fase 1 de inteligencia competitiva.
SEO target keywords: "bitly alternative", "free url shortener", "tly alternative", etc.
---

#### Tarea 4.3: Blog con primeros 5 articulos
**Criterio de done:** Blog en /blog con 5 articulos SEO publicados, cada uno >1,500 palabras.
**Dependencias:** Sprint 1
**Prompt para el agente:**
---
Implementa el blog de MUGA y crea los primeros 5 articulos SEO.

1. **Blog engine**: usa MDX con Next.js:
   - Archivos .mdx en `apps/web/content/blog/`
   - Pagina de listado en `/blog`
   - Pagina de post individual en `/blog/[slug]`
   - Metadata: title, description, date, author, tags, image

2. **5 articulos a crear**:
   a. "Best URL Shorteners in 2026: Complete Comparison" (target: "best url shortener")
   b. "How to Shorten URLs with Your Own Custom Domain" (target: "custom domain url shortener")
   c. "URL Shortener with Analytics: Track Every Click for Free" (target: "url shortener with analytics")
   d. "Free Bitly Alternative: Why Marketers Are Switching" (target: "bitly alternative free")
   e. "How to Add Retargeting Pixels to Any Link" (target: "retargeting pixel link")

3. Cada articulo:
   - >1,500 palabras
   - H2/H3 structure optimizada
   - Internal links a /pricing, /vs/*, otros posts
   - Schema markup (Article)
   - OG image (genera placeholder)
---

#### Tarea 4.4: Publicar extension en Chrome Web Store y Firefox
**Criterio de done:** Extension disponible para descarga en Chrome Web Store y Firefox Add-ons.
**Dependencias:** Tarea 2.5
**Prompt para el agente:**
---
Prepara y publica la extension MUGA en las tiendas de navegadores.

1. **Chrome Web Store**:
   - Build: `npm run build:chrome` (genera zip)
   - Store listing:
     - Nombre: "MUGA: Fair to Every Click"
     - Descripcion corta (132 chars): "Clean tracking from URLs and shorten them in one click. Free analytics, QR codes, custom domains."
     - Descripcion larga: Features completas, privacy policy, como funciona
     - Capturas de pantalla: Al menos 3 (1280x800) mostrando popup, URL limpia, shortening
     - Icono: 128x128
     - Categoria: Productivity
     - Privacy practices: solo URLs procesadas localmente, shortening requiere cuenta
   - Privacy policy URL: https://yocreoquesi.github.io/muga/
   - Sube y envia a revision

2. **Firefox Add-ons**:
   - Build: `npm run build:firefox` (genera zip)
   - Misma informacion de listing adaptada
   - Sube y envia a revision

3. **Assets necesarios**:
   - Promo tile: 440x280
   - Screenshots: al menos 3
   - Video demo corto (opcional pero recomendado)

NOTA: El usuario debe tener cuenta de developer en Chrome Web Store ($5 one-time). Si no la tiene, proporciona instrucciones.
---

#### Tarea 4.5: Email onboarding automatizado
**Criterio de done:** Nuevos usuarios reciben 3 emails automaticos: bienvenida (dia 0), primer link (dia 1), upgrade (dia 3).
**Dependencias:** Sprint 1
**Prompt para el agente:**
---
Implementa email onboarding automatizado con Resend para MUGA.

1. **Configura Resend**:
   - Instala: `pnpm add resend` en apps/web
   - Configura RESEND_API_KEY en .env
   - Configura dominio de envio: noreply@muga.link (requiere DNS records)

2. **Email templates** (React Email o HTML):
   - Email 1: "Welcome to MUGA" (dia 0):
     - Saludo personalizado
     - 3 quick actions: Create your first link, Install the extension, Explore analytics
   - Email 2: "Your first short link" (dia 1):
     - Si no ha creado ningun link: tutorial paso a paso
     - Si ya creo: felicitacion + tip sobre custom domains
   - Email 3: "Unlock Pro features" (dia 3):
     - Highlights de Pro: analytics ilimitados, retargeting, smart links
     - CTA: Upgrade to Pro (link a /pricing)
     - Social proof: "Join X users who upgraded"

3. **Scheduling**:
   - Opcion A (recomendada): Usa Resend Audiences + Broadcasts
   - Opcion B: Cron job que query Supabase por usuarios creados hace 1/3 dias y envia
   - Implementa la opcion mas simple que funcione

4. **Trigger**: Al crear usuario (webhook de Clerk), envia email 1 inmediatamente y programa los siguientes.

5. **Unsubscribe**: Incluye link de unsubscribe en todos los emails (CAN-SPAM compliance).
---

---

# FASE 5: ESTRATEGIA DE LANZAMIENTO Y CAPTACION

---

## Plan de Lanzamiento MUGA

### Cronograma de lanzamiento

```
Semana  1-2:  Sprint 0+1 (MVP funcional)
Semana  3-4:  Beta privada (20-50 usuarios invitados)
Semana  5-6:  Sprint 2 (features competitivos)
Semana  7:    Extension publicada en Chrome Web Store
Semana  8:    Soft launch: Reddit, Indie Hackers, HN
Semana  9-10: Sprint 3 (diferenciacion)
Semana  11:   Product Hunt launch
Semana  12-16: Sprint 4 (SEO, contenido, traccion)
```

### Canales priorizados (ordenados por ROI esperado)

| # | Canal | Esfuerzo | Potencial | Primeras acciones |
|---|-------|----------|-----------|-------------------|
| 1 | **Chrome Web Store** | Bajo | Alto | Publicar extension. T.LY demostro 350K usuarios organicos via CWS search. La extension de limpieza de URLs es el hook: el shortening es el upsell. |
| 2 | **SEO / Blog** | Medio | Alto (long-term) | 5 articulos iniciales + 5 paginas de comparativa. Target keywords: "bitly alternative", "free url shortener", "url shortener with analytics". |
| 3 | **Product Hunt** | Medio | Alto (burst) | Lanzar en semana 11. Preparar assets, construir base de upvoters. Target: Top 5 del dia. |
| 4 | **Reddit** | Bajo | Medio | Posts genuinos en r/SaaS, r/entrepreneur, r/webdev, r/marketing. Compartir historia de "built with AI agents". |
| 5 | **Indie Hackers** | Bajo | Medio | Building in public: posts semanales sobre revenue, usuarios, decisiones tecnicas. |
| 6 | **Hacker News** | Bajo | Alto (burst) | "Show HN: MUGA: URL shortener with enterprise features at indie prices". Timing critico: lanzar entre semana, manana US. |
| 7 | **X/Twitter** | Bajo | Medio | Build in public thread. Daily updates sobre desarrollo con AI agents. |
| 8 | **Comunidades hispanas** | Bajo | Bajo-Medio | Forobeta, Publisuites community, grupos de marketing digital en Telegram/Discord ES. |

### Como crecieron los competidores

**T.LY**:
- Canal principal: Chrome Web Store organic search
- Timing: Capitalizo el cierre de Google URL Shortener (2019)
- Growth hack: Extension con minimos permisos cuando las alternativas pedian "access all sites"
- Revenue: $15K MRR con ~600 clientes pagos
- Leccion: La extension ES el canal de adquisicion

**Dub.co**:
- Canal principal: GitHub (20K+ stars) + Product Hunt + Hacker News
- Posicionamiento: "Open-source Bitly alternative"
- Funding: $2M de OSS Capital + angel investors
- Leccion: Open source + developer community = traccion tecnica

**Short.io**:
- Canal principal: SEO + free plan generoso (1,000 links)
- Posicionamiento: "Best free URL shortener for businesses"
- Leccion: Un free plan generoso genera boca a boca

### Plan de contenido SEO: Top 20 keywords

| # | Keyword | Vol. est. | Dificultad | Tipo | Titulo |
|---|---------|-----------|------------|------|--------|
| 1 | bitly alternative | 2,400/mo | Media | Comparativa | "Best Bitly Alternatives in 2026 (Free & Paid)" |
| 2 | free url shortener | 12,000/mo | Alta | Pilar | "Best Free URL Shorteners: No Signup Required" |
| 3 | url shortener with analytics | 1,600/mo | Media | Feature | "URL Shortener with Analytics: Track Every Click Free" |
| 4 | custom domain url shortener | 1,200/mo | Media | Tutorial | "How to Shorten URLs with Your Own Custom Domain" |
| 5 | bitly alternative free | 800/mo | Baja | Comparativa | "Free Bitly Alternative: Why Marketers Are Switching" |
| 6 | url shortener extension | 900/mo | Baja | Feature | "Best URL Shortener Browser Extensions in 2026" |
| 7 | link shortener for instagram | 1,000/mo | Media | Tutorial | "How to Create Short Links for Instagram Bio" |
| 8 | qr code link shortener | 700/mo | Baja | Feature | "Generate QR Codes from Short URLs: Free" |
| 9 | retargeting pixel link | 500/mo | Baja | Tutorial | "How to Add Retargeting Pixels to Any Link" |
| 10 | tly alternative | 300/mo | Baja | Comparativa | "T.LY vs MUGA: Which URL Shortener Is Better?" |
| 11 | url shortener api | 800/mo | Media | Technical | "Best URL Shortener APIs for Developers" |
| 12 | branded short links | 600/mo | Media | Feature | "How to Create Branded Short Links for Free" |
| 13 | rebrandly alternative | 400/mo | Baja | Comparativa | "Rebrandly Alternative: Better Pricing, Same Features" |
| 14 | short.io alternative | 200/mo | Baja | Comparativa | "Short.io vs MUGA: Feature Comparison" |
| 15 | url shortener for marketing | 500/mo | Media | Use case | "Best URL Shortener for Digital Marketing Teams" |
| 16 | link management tool | 400/mo | Media | Pilar | "Link Management Platforms Compared (2026)" |
| 17 | geo redirect link | 300/mo | Baja | Technical | "How to Redirect Users by Country with Smart Links" |
| 18 | shorten amazon links | 1,500/mo | Baja | Tutorial | "How to Shorten Amazon Links (Clean & Trackable)" |
| 19 | url shortener without ads | 600/mo | Baja | Feature | "URL Shorteners Without Ads: Top Picks" |
| 20 | dub.co alternative | 200/mo | Baja | Comparativa | "Dub.co vs MUGA: Open Source vs Browser-Native" |

### Plan de Product Hunt

**Preparacion (semanas 8-10)**:
- Crear cuenta de Product Hunt si no existe
- Construir "upcoming page" 2 semanas antes del launch
- Invitar a 50-100 personas a seguir la upcoming page
- Preparar assets:
  - Tagline: "Enterprise link features at indie prices. Browser-native."
  - Descripcion: 280 chars max, enfocada en el diferenciador
  - Logo: HD
  - Gallery: 5 screenshots (extension, dashboard, analytics, pricing comparison, QR codes)
  - Video demo: 1 minuto, sin narration, solo screen recording con musica
  - Maker comment: historia personal, built with AI, why now

**Ejecucion (semana 11)**:
- Dia: Martes o miercoles
- Hora: 12:01 AM Pacific Time
- Launch deal: "Pro plan free for 6 months for first 100 Product Hunt users"
- Responder a TODOS los comments en las primeras 8 horas
- Cross-post en X, LinkedIn, Reddit, Indie Hackers
- Target: Top 5 del dia

### Roadmap de primeros 100 clientes

| Periodo | Canal | Accion | Objetivo |
|---------|-------|--------|----------|
| Semana 1-2 | Beta | Invitar 20-50 usuarios (amigos, IH community) | 5 pagos |
| Semana 3-4 | Reddit + IH | Posts en r/SaaS, r/entrepreneur, IH milestones | 50 registros, 5 pagos |
| Semana 5-6 | Chrome Web Store | Extension publicada, SEO de CWS | 500 installs, 3 pagos |
| Semana 7-8 | Product Hunt | Launch day + follow-up | 2,000 registros, 30 pagos |
| Mes 3 | SEO | Blog posts empiezan a rankear, comparativas | 1,000 registros/mes, 20 pagos |
| Mes 4 | Organic | Word of mouth + extension installs | 100+ clientes pago total |

### Mensajes clave por audiencia

**Para marketers:**
> "Stop paying Bitly $300/month for analytics. MUGA gives you geo targeting, retargeting pixels, and QR codes: starting free."

**Para developers:**
> "The fastest URL shortener API. <20ms redirects on Cloudflare edge. Free tier with 100 links/month and 100 API calls/day."

**Para agencias:**
> "One dashboard for all your clients. 10 workspaces, 10 custom domains, unlimited retargeting: $29/month. Not $300."

**Para afiliados:**
> "Short links that track everything. Know exactly which platform, country, and device drives your clicks. Free to start."

---

# FASE 6: MODELO FINANCIERO

---

## Supuestos base

| Supuesto | Valor | Justificacion |
|----------|-------|---------------|
| Free-to-paid conversion | 3.5% (base) | Benchmark SaaS: 2-5%. MUGA tiene extension como hook, similar a T.LY |
| Monthly churn | 5% (base) | Benchmark SaaS early-stage: 3-8%. Links son sticky (no quieres perder links activos) |
| Plan distribution | 70% Pro / 25% Agency / 5% Enterprise | La mayoria son indie makers, agencies son el sweet spot |
| ARPU Pro | $9/mes | Precio fijo |
| ARPU Agency | $29/mes | Precio fijo |
| ARPU Enterprise | $99/mes (avg) | Custom pricing, estimamos media |
| ARPU blended | $15.50/mes | (0.70*9 + 0.25*29 + 0.05*99) = 6.30+7.25+4.95 |
| Coste infra base | $25/mes | CF Workers ($5) + Supabase Free + Clerk Free + Plausible ($9) + dominio ($2) |
| Coste infra per 1K users | $5/mes adicional | Escala con volumen |
| Stripe fee | 2.9% + $0.30 | Standard Stripe pricing |
| Extension installs/mes | +500 (conservador), +2,000 (base), +5,000 (optimista) | Basado en T.LY que llego a 350K en ~2.5 anos |
| Sign-up from extension | 15% de installs | Estimacion: no todos conectan cuenta |
| Sign-up from web | 200/mes (base) | SEO + PH + reddit + organic |

## Proyeccion mensual: Escenario BASE (24 meses)

| Mes | Installs ext. | Registros nuevos | Nuevos pagos | Churn | Clientes pago total | MRR | Costes | Beneficio |
|-----|--------------|-----------------|-------------|-------|-------------------|-----|--------|-----------|
| 1 | 500 | 125 | 4 | 0 | 4 | $62 | $25 | $37 |
| 2 | 800 | 220 | 8 | 0 | 12 | $186 | $25 | $161 |
| 3 | 2,000 | 500 | 18 | 1 | 29 | $450 | $30 | $420 |
| 4 | 2,500 | 575 | 20 | 1 | 48 | $744 | $30 | $714 |
| 5 | 3,000 | 650 | 23 | 2 | 69 | $1,070 | $35 | $1,035 |
| 6 | 3,500 | 725 | 25 | 3 | 91 | $1,411 | $40 | $1,371 |
| 7 | 4,000 | 800 | 28 | 5 | 114 | $1,767 | $45 | $1,722 |
| 8 | 4,500 | 875 | 31 | 6 | 139 | $2,155 | $50 | $2,105 |
| 9 | 5,000 | 950 | 33 | 7 | 165 | $2,558 | $55 | $2,503 |
| 10 | 5,500 | 1,025 | 36 | 8 | 193 | $2,992 | $60 | $2,932 |
| 11 | 6,000 | 1,100 | 39 | 10 | 222 | $3,441 | $70 | $3,371 |
| 12 | 6,500 | 1,175 | 41 | 11 | 252 | $3,906 | $75 | $3,831 |
| **ARR Mes 12** | | | | | **252** | **$46,872** | | |
| 13 | 7,000 | 1,250 | 44 | 13 | 283 | $4,387 | $80 | $4,307 |
| 14 | 7,500 | 1,325 | 46 | 14 | 315 | $4,883 | $85 | $4,798 |
| 15 | 8,000 | 1,400 | 49 | 16 | 348 | $5,394 | $95 | $5,299 |
| 16 | 8,500 | 1,475 | 52 | 17 | 383 | $5,937 | $100 | $5,837 |
| 17 | 9,000 | 1,550 | 54 | 19 | 418 | $6,479 | $110 | $6,369 |
| 18 | 9,500 | 1,625 | 57 | 21 | 454 | $7,037 | $120 | $6,917 |
| 19 | 10,000 | 1,700 | 60 | 23 | 491 | $7,611 | $130 | $7,481 |
| 20 | 10,500 | 1,775 | 62 | 25 | 528 | $8,184 | $140 | $8,044 |
| 21 | 11,000 | 1,850 | 65 | 26 | 567 | $8,789 | $150 | $8,639 |
| 22 | 11,500 | 1,925 | 67 | 28 | 606 | $9,393 | $160 | $9,233 |
| 23 | 12,000 | 2,000 | 70 | 30 | 646 | $10,013 | $170 | $9,843 |
| 24 | 12,500 | 2,075 | 73 | 32 | 687 | $10,649 | $180 | $10,469 |
| **ARR Mes 24** | | | | | **687** | **$127,788** | | |

*Nota: MRR = clientes_pago * ARPU_blended ($15.50). Churn = 5% de clientes al inicio del mes. Stripe fees no deducidas explicitamente (~3% del MRR).*

## Comparativa de escenarios (mes 12 y mes 24)

| Metrica | Conservador | Base | Optimista |
|---------|-------------|------|-----------|
| **Mes 12** | | | |
| Extension installs totales | 18,000 | 48,000 | 120,000 |
| Usuarios registrados | 4,200 | 9,000 | 24,000 |
| Clientes de pago | 84 | 252 | 720 |
| MRR | $1,302 | $3,906 | $11,160 |
| ARR | $15,624 | $46,872 | $133,920 |
| Costes/mes | $45 | $75 | $150 |
| Beneficio/mes | $1,257 | $3,831 | $11,010 |
| **Mes 24** | | | |
| Extension installs totales | 60,000 | 168,000 | 480,000 |
| Usuarios registrados | 14,000 | 30,000 | 96,000 |
| Clientes de pago | 230 | 687 | 2,400 |
| MRR | $3,565 | $10,649 | $37,200 |
| ARR | $42,780 | $127,788 | $446,400 |
| Costes/mes | $80 | $180 | $500 |
| Beneficio/mes | $3,485 | $10,469 | $36,700 |

## Punto de rentabilidad

| Escenario | Mes de rentabilidad | MRR en ese mes |
|-----------|--------------------|-|
| **Conservador** | Mes 1 | $62 (costes minimos, rentable desde el dia 1) |
| **Base** | Mes 1 | $62 |
| **Optimista** | Mes 1 | $62 |

**Nota**: Con costes de infra de solo $25/mes, MUGA es rentable desde el primer cliente de pago. El "verdadero" punto de rentabilidad (cubrir tiempo del fundador) depende del salario objetivo:
- $2,000/mes neto → **Mes 8** (base), Mes 13 (conservador), Mes 5 (optimista)
- $5,000/mes neto → **Mes 15** (base), Mes 22 (conservador), Mes 9 (optimista)

## Hitos financieros y plan de reinversion

| Hito | Mes (base) | Accion |
|------|-----------|--------|
| **$500 MRR** | Mes 4 | Invertir en Plausible Cloud ($9/mes). Comprar template premium para landing pages ($79 one-time). |
| **$2,000 MRR** | Mes 8 | Contratar virtual assistant para soporte ($500/mes). Invertir en herramientas SEO (Ahrefs lite $99/mes). |
| **$5,000 MRR** | Mes 15 | El fundador puede dedicarse full-time. Invertir en paid acquisition: Google Ads ($500/mes), sponsor newsletters ($200/mes). Upgrade Supabase a Pro ($25/mes). |
| **$15,000 MRR** | Mes 24+ | Contratar primer developer part-time ($3,000/mes). Invertir en enterprise features (SSO, SLA). Explorar mercados internacionales (i18n). |

---

# SINTESIS EJECUTIVA

---

## MUGA: Fair to Every Click

### Posicionamiento
**"Enterprise link features, indie pricing, browser-native."**

### Los 3 gaps de mercado mas importantes
1. **Precio desproporcionado**: Bitly cobra $199/mes por analytics que se pueden servir a $9/mes. MUGA incluye geo/device analytics en el plan gratuito.
2. **Sin extension nativa**: Ningun competidor nacio como extension-first. T.LY tiene extension pero es un add-on. MUGA combina limpieza de URLs (uso diario) + shortening (conversion).
3. **Retargeting detras de paywalls**: Los pixels de retargeting estan gate-kept en todos los competidores. MUGA los incluye desde el plan gratuito (1 pixel).

### Stack tecnico definitivo
- **Redirects**: Cloudflare Workers + KV (<20ms global)
- **Database**: Supabase PostgreSQL
- **Frontend**: Next.js 15 + Tailwind CSS en Cloudflare Pages
- **Auth**: Clerk | **Pagos**: Stripe Checkout | **Email**: Resend
- **Analytics de clicks**: Cloudflare Analytics Engine (async, zero-latency impact)
- **Coste base**: $25/mes

### Plan de sprints
- **Sprint 0** (Semana 1): Monorepo + Worker + KV + dominio mug.ag funcional
- **Sprint 1** (Semanas 2-3): Auth + Dashboard + Links + Stripe + Landing → MVP cobrable
- **Sprint 2** (Semanas 4-6): Analytics graficos + Custom domains + QR codes + API + Extension integrada
- **Sprint 3** (Semanas 7-10): Retargeting pixels + Smart links + Workspaces + CTA overlays
- **Sprint 4** (Semanas 11-16): SEO + Comparativas + Blog + Extension publicada + Email onboarding

### Los 5 pasos concretos a ejecutar esta semana
1. **Crear proyecto Supabase** y configurar schema inicial
2. **Configurar monorepo** con Turborepo (Tarea 0.1)
3. **Desplegar Worker basico** en Cloudflare con KV (Tarea 0.2)
4. **Conectar mug.ag** a Cloudflare Workers (Tarea 0.4)
5. **Verificar redirect** mug.ag/test → muga.link funcional (Tarea 0.5)

### MRR objetivo a 12 meses (escenario base)
**$3,906 MRR ($46,872 ARR) con 252 clientes de pago**

Benchmark: T.LY alcanzo $15K MRR en ~3 anos. MUGA apunta a $4K MRR en 1 ano con la ventaja de una extension ya desarrollada y un mercado mas maduro.

---

*Documento generado el 2026-03-23 para el proyecto MUGA: Fair to Every Click*
*Dominio links: mug.ag | Plataforma: muga.link | Dominios cortos: out.pw, tap.pw, jab.pw*
