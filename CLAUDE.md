# MUGA — Claude Code Context

## Proyecto

Browser extension (Chrome + Firefox) que limpia URLs de tracking params, gestiona tags de afiliados y protege al usuario de sustitución silenciosa de afiliados (lo que hizo Honey).

- **Nombre:** MUGA — Make URLs Great Again
- **Repo:** https://github.com/yocreoquesi/muga (public, GPL v3)
- **Versión actual:** 1.4.0
- **Contexto completo (privado):** lee `Muga.md` — nunca lo comitees

---

## Stack

| Capa | Tecnología |
|---|---|
| Lenguaje | Vanilla JavaScript (ES2022) — sin frameworks |
| Extension | Manifest V3 (Chrome) + V2 (Firefox, generado en build) |
| Build | `web-ext` (Mozilla) |
| Storage | `chrome.storage.sync` |
| Tests | Node.js built-in test runner (`node --test tests/unit/*.mjs`) |
| Browser tests | `npm run test:serve` → Chrome en `http://localhost:5555` |
| Deploy | GitHub Actions → .zip → Chrome Web Store + Firefox AMO |

---

## Estado actual — v1.4.0

### Phase 1 ✅ — Feature-complete
- [x] Strip 65+ tracking params (Scenario A — siempre activo)
- [x] Affiliate injection cuando no hay tag (Scenario B)
- [x] Detección + toast de afiliado ajeno (Scenario C)
- [x] Blacklist/whitelist enforcement (Scenario D)
- [x] Onboarding + consentimiento afiliados
- [x] EN/ES language toggle
- [x] Right-click → Copy clean link
- [x] Alt+Shift+C keyboard shortcut
- [x] Badge counter por tab
- [x] Export/import settings JSON
- [x] GitHub Actions release workflow

### Pendiente (bloqueado por pasos manuales)
- [ ] ourTag rellenado en affiliates.js (requiere cuentas de afiliado registradas)
- [ ] Store assets (screenshots, tiles)
- [ ] Chrome Web Store listing publicado
- [ ] Firefox AMO listing publicado

### Phase 2 — URL shortener (no iniciado)
- [ ] Backend Vercel Edge + Supabase (`muga.link`)
- [ ] "Copy clean link" → genera `go.muga.link/abc123`

---

## REGLA CRÍTICA DE WORKFLOW

**NUNCA hacer commit directamente a `main`.** Siempre:

```
1. gh issue create --title "..." --label bug|enhancement
2. git checkout -b fix/nombre  o  feat/nombre
3. Implementar + tests
4. git add ... && git commit -m "tipo: descripción (#ISSUE)"
5. git push origin nombre-rama
6. gh pr create --fill
7. gh pr merge --squash
8. git checkout main && git pull
```

---

## Protocolo de input del usuario

**Todo input del usuario pasa siempre por Sofia Martinez (PM) primero.**

```
Tú (usuario)
    │
    ▼
Sofia Martinez (product_manager)   ← define spec, user stories, scope
    │
    ▼
Alex Rivera (tech_lead)            ← plan técnico + coordina equipo
    │
    ├── Priya (data_architect)      storage schema / affiliates.js structure
    ├── Miguel (devops)             build, CI/CD, store publishing
    ├── Omar (backend_lead)         arquitectura service worker + lib/
    ├── Riley (frontend_lead)       arquitectura popup + options
    ├── Zara (backend_dev)          implementa service-worker, lib/*.js
    ├── Sam (frontend_dev)          implementa popup, options, content script UI
    ├── Ana (qa_lead)               tests Node.js + browser tests
    ├── Sebastian (code_reviewer)   revisión final
    └── Fatima (tech_writer)        README, CHANGELOG, docs/
```

Si no sabes a qué agente dirigirte, activa `product_manager` — Sofia re-ruteará.

---

## Sistema de Agentes

Agentes definidos en `.claude/agents/`. Dos modos:

**Manual:** `"Actúa como [agente] y [tarea]"`
**Automático:** describe la tarea — Claude lanza subagentes en orden.

### Tabla de agentes

| Agente | Rol | Para qué |
|---|---|---|
| `product_manager` | Sofia Martinez | **Primer punto de contacto.** Features, scope, issues |
| `tech_lead` | Alex Rivera | Plan técnico, coordinación, branches/PRs |
| `data_architect` | Priya Sharma | chrome.storage schema, affiliates.js, Phase 2 Supabase |
| `backend_lead` | Omar Hassan | Arquitectura service worker + lib/ |
| `backend_dev` | Zara Johnson | service-worker.js, lib/cleaner.js, lib/affiliates.js |
| `frontend_lead` | Riley Chen | Arquitectura popup, options, content script |
| `frontend_dev` | Sam Park | popup.js/html/css, options.js/html, content/cleaner.js UI |
| `devops` | Miguel Santos | web-ext build, GitHub Actions, store publishing |
| `qa_lead` | Ana Popescu | tests/unit/*.mjs, browser tests, cobertura |
| `code_reviewer` | Sebastian Torres | CSP, MV3/V2 compat, permissions, security |
| `tech_writer` | Fatima Al-Rashid | README.md, CHANGELOG.md, docs/ |
| `growth_lead` | Isabela Rodrigues | Store listings, RRSS, ProductHunt, lanzamiento |

---

## Estructura del proyecto

```
muga/
├── CLAUDE.md                  ← estás aquí
├── Muga.md                    ← contexto privado (gitignored, NUNCA commitear)
├── src/
│   ├── manifest.json          ← Chrome MV3
│   ├── manifest.v2.json       ← Firefox MV2 (usado en build)
│   ├── background/
│   │   └── service-worker.js  ← procesa URLs, maneja mensajes
│   ├── content/
│   │   └── cleaner.js         ← content script, intercepta clics
│   ├── popup/
│   │   ├── popup.html/css/js
│   ├── options/
│   │   ├── options.html/js    ← página completa de preferencias
│   └── lib/
│       ├── cleaner.js         ← lógica core de limpieza de URLs
│       ├── affiliates.js      ← base de datos de afiliados + tracking params
│       └── storage.js         ← helpers chrome.storage.sync
├── tests/unit/*.mjs           ← Node.js test runner
├── tests/browser/             ← browser tests (npm run test:serve)
├── tools/                     ← screenshots, promo tiles
├── docs/                      ← GitHub Pages (privacy policy, assets)
└── dist/                      ← build output (gitignored)
```

---

## Los 4 escenarios core

| Escenario | Qué hace | Activación |
|---|---|---|
| A | Strip tracking params (utm_*, fbclid, gclid, etc.) | Siempre, automático |
| B | Inject ourTag cuando no hay afiliado | ON por defecto, opt-out |
| C | Toast cuando detecta afiliado ajeno | OFF por defecto, opt-in |
| D | Strip todo si el dominio está en blacklist | Configurable por dominio |

---

## Identidad Git

Todos los commits salen bajo la identidad real del repositorio (`yocreoquesi`). Los agentes son personas de IA — no usar `--author` ni emails ficticios. El sistema git configurado en el entorno es el correcto.

---

## Reglas del proyecto

- **Nunca** commit directo a `main` — siempre branch + PR
- **Nunca** commitear `Muga.md` ni `.env.local` — están en .gitignore
- **Nunca** eval(), inline scripts, o remote code — viola CSP
- **Nunca** enviar datos a servidores — todo procesamiento local (Phase 1)
- Minimal permissions en manifest — solo lo necesario
- Tests: `npm test` debe pasar antes de cualquier PR
- Versioning: bump en `package.json` + `manifest.json` + `manifest.v2.json` juntos
- CHANGELOG.md: actualizar en cada release
