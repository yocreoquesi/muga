// App — the shell that binds everything: theme toggle, nav, audit doc, mockups canvas.

const SECTIONS = [
  { id: "audit", label: "Audit" },
  { id: "critique", label: "Critique" },
  { id: "brand", label: "Brand" },
  { id: "system", label: "System" },
  { id: "mockups", label: "Mockups" },
  { id: "decisions", label: "Decisions" },
  { id: "equivalence", label: "Equivalence" },
];

const App = () => {
  // Theme: follow system by default, persist override
  const [theme, setTheme] = React.useState(() => {
    const saved = localStorage.getItem("muga-theme");
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("muga-theme", theme);
  }, [theme]);

  // Persist scroll section
  const [activeSection, setActiveSection] = React.useState(() =>
    localStorage.getItem("muga-section") || "audit");

  const goTo = (id) => {
    setActiveSection(id);
    localStorage.setItem("muga-section", id);
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.offsetTop - 80, behavior: "smooth" });
  };

  // Popup scenario
  const [popupScenario, setPopupScenario] = React.useState("clean");
  const [onboardingStep, setOnboardingStep] = React.useState(0);
  const [toastVisible, setToastVisible] = React.useState(true);

  return (
    <div className="shell">
      {/* ---------- TOP ---------- */}
      <header className="shell__top">
        <div className="shell__brand">
          <div className="shell__brand-mark"><BrandMark height={28} /></div>
          <div>
            <div className="shell__brand-title">MUGA · Redesign</div>
            <div className="shell__brand-sub">Audit & proposal — April 2026</div>
          </div>
        </div>
        <div className="shell__top-controls">
          <button className="btn btn--sm"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            <Icon name={theme === "dark" ? "sun" : "moon"} size={13} />
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      {/* ---------- HERO ---------- */}
      <div className="shell__hero">
        <div className="shell__kicker">Deliverable · Denoise positioning</div>
        <h1 className="shell__title">
          The web, with the noise turned down.
        </h1>
        <p className="shell__lede">
          Links arrive cluttered. UTMs, click IDs, affiliate stamps, redirect wrappers, AMP
          detours — friction between you and the page you actually wanted. MUGA quietly removes
          it. Cleaner addresses, fewer hops, less residue. The internet feels like it used to.
          Privacy ends up better as a side effect; the headline is the experience.
        </p>
        <div className="shell__meta">
          <span><b>Brand:</b> M-arrow monoline · <code>#6A2BCF</code></span>
          <span><b>Position:</b> denoise — fair to creators, nice to users</span>
          <span><b>Stack:</b> vanilla HTML/CSS/JS · MV3</span>
          <span><b>Themes:</b> follows <code>prefers-color-scheme</code></span>
        </div>
      </div>

      {/* ---------- NAV ---------- */}
      <nav className="shell__nav" aria-label="Sections">
        {SECTIONS.map(s => (
          <button key={s.id}
                  className={activeSection === s.id ? "is-active" : ""}
                  onClick={() => goTo(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>

      {/* ---------- AUDIT + CRITIQUE ---------- */}
      <AuditDoc />

      {/* ---------- BRAND ---------- */}
      <section id="brand" className="section">
        <header className="section__head">
          <div className="section__eyebrow">Phase 3 · Identity</div>
          <h2 className="section__title">La marca</h2>
          <p className="section__desc">
            El M-flecha sustituye a la polilla. Un trazo monolineal que dibuja una "M" y continúa
            hacia la derecha terminando en flecha — la metáfora literal del producto:
            tu enlace, limpiado, apuntando al destino.
          </p>
        </header>

        <div className="brand-grid">
          <div className="brand-feature">
            <div className="brand-feature__stage">
              <BrandMark height={140} title="MUGA" />
            </div>
            <div className="brand-feature__caption">
              <div className="brand-feature__label">Primary mark</div>
              <div className="brand-feature__meta">
                <code>--accent-mark</code> · ratio ≈12:8 · stroke 10/104 (≈9.6%)
              </div>
            </div>
          </div>

          <div className="brand-sizes">
            <div className="brand-size">
              <div className="brand-size__stage" style={{height: 96}}>
                <BrandMark height={56} />
              </div>
              <div className="brand-size__label">56px <span>· Hero / about</span></div>
            </div>
            <div className="brand-size">
              <div className="brand-size__stage" style={{height: 72}}>
                <BrandMark height={32} />
              </div>
              <div className="brand-size__label">32px <span>· Page header</span></div>
            </div>
            <div className="brand-size">
              <div className="brand-size__stage" style={{height: 56}}>
                <BrandMark height={20} />
              </div>
              <div className="brand-size__label">20px <span>· Inline brand</span></div>
            </div>
            <div className="brand-size">
              <div className="brand-size__stage" style={{height: 48}}>
                <BrandMark height={14} />
              </div>
              <div className="brand-size__label">14px <span>· Smallest legible</span></div>
            </div>
          </div>
        </div>

        <div className="brand-canvas">
          <div className="brand-canvas__row">
            <div className="brand-tile brand-tile--light">
              <BrandMark height={96} />
              <div className="brand-tile__label">On surface-1</div>
            </div>
            <div className="brand-tile brand-tile--inset">
              <BrandMark height={96} />
              <div className="brand-tile__label">On surface-2</div>
            </div>
            <div className="brand-tile brand-tile--soft">
              <BrandMark height={96} />
              <div className="brand-tile__label">On accent-soft</div>
            </div>
            <div className="brand-tile brand-tile--inverse">
              <BrandMark height={96} />
              <div className="brand-tile__label">On surface-inverse</div>
            </div>
          </div>
        </div>

        <div className="brand-rules">
          <div className="brand-rule">
            <div className="brand-rule__title">Color</div>
            <div className="brand-rule__body">
              The mark always renders in <code>--accent-mark</code>: <code>#6A2BCF</code> light,
              <code>#9F7AE8</code> dark. Never recolor it semantically (no green for "ok",
              no red for "error") — it's a brand element, not a status icon.
            </div>
          </div>
          <div className="brand-rule">
            <div className="brand-rule__title">Clearspace</div>
            <div className="brand-rule__body">
              Minimum padding around the mark equals the height of the arrow head (≈ 24% of the
              mark's total height). Built into the SVG viewBox so it's automatic when sized via
              <code>height</code>.
            </div>
          </div>
          <div className="brand-rule">
            <div className="brand-rule__title">Background</div>
            <div className="brand-rule__body">
              Safe on any neutral surface in the system, plus accent-soft. <strong>Don't</strong>
              place the mark directly on the brand violet — contrast collapses. Use the soft tint or
              an inverse surface instead.
            </div>
          </div>
          <div className="brand-rule">
            <div className="brand-rule__title">Wordmark</div>
            <div className="brand-rule__body">
              Pair with "MUGA" set in system sans, weight 600, tracking <code>0.08em</code>,
              uppercase. The mark sits left, with a gap equal to the cap-height of the wordmark.
            </div>
          </div>
        </div>

        <div className="brand-dont">
          <div className="brand-dont__title">Don't</div>
          <div className="brand-dont__grid">
            <div className="brand-dont__cell">
              <div className="brand-dont__stage" style={{background: "var(--accent)"}}>
                <BrandMark height={48} />
              </div>
              <div className="brand-dont__caption">Mark on brand violet</div>
            </div>
            <div className="brand-dont__cell">
              <div className="brand-dont__stage">
                <BrandMark height={48} className="brand-dont--stretched" />
              </div>
              <div className="brand-dont__caption">Stretch or skew</div>
            </div>
            <div className="brand-dont__cell">
              <div className="brand-dont__stage">
                <div style={{color: "var(--success)"}}><BrandMark height={48} /></div>
              </div>
              <div className="brand-dont__caption">Re-color semantically</div>
            </div>
            <div className="brand-dont__cell">
              <div className="brand-dont__stage">
                <div style={{transform: "rotate(-12deg)"}}><BrandMark height={48} /></div>
              </div>
              <div className="brand-dont__caption">Rotate</div>
            </div>
          </div>
        </div>

        {/* ---------- VOICE ---------- */}
        <div className="voice">
          <div className="voice__head">
            <div className="voice__eyebrow">Voice & message</div>
            <h3 className="voice__title">The denoise extension for the web.</h3>
            <p className="voice__lede">
              MUGA isn't anti-tracker, anti-affiliate or anti-anything. It's pro-clean — a
              quiet utility that returns links to what they used to be when the web felt
              lighter. Privacy ends up a little better as a side effect. The headline is the
              browsing experience.
            </p>
          </div>

          <div className="voice__grid">
            <div className="voice__card voice__card--no">
              <div className="voice__card-label">Not this</div>
              <ul className="voice__list">
                <li>"Stop the trackers."</li>
                <li>"Take back your privacy."</li>
                <li>"Block creepy surveillance."</li>
                <li>"We strip 459 things they don't want you to know about."</li>
                <li>Apologetic about the affiliate model.</li>
                <li>"Honey got sued for this."</li>
              </ul>
            </div>
            <div className="voice__card voice__card--yes">
              <div className="voice__card-label">This</div>
              <ul className="voice__list">
                <li>"The web, with the noise turned down."</li>
                <li>"Cleaner addresses. Fewer hops. Less residue."</li>
                <li>"Fair to creators. Nice to you."</li>
                <li>"459 patterns of noise, quietly removed."</li>
                <li>Matter-of-fact about how MUGA stays free.</li>
                <li>"Creator tags come first. Always."</li>
              </ul>
            </div>
          </div>

          <div className="voice__principles">
            <div className="voice__principle">
              <div className="voice__principle-num">01</div>
              <div className="voice__principle-body">
                <strong>Calm, not paranoid.</strong>
                MUGA isn't fighting an enemy. It's tidying up. The tone is the gardener,
                not the bodyguard.
              </div>
            </div>
            <div className="voice__principle">
              <div className="voice__principle-num">02</div>
              <div className="voice__principle-body">
                <strong>Specific, not vague.</strong>
                "Noise" is the umbrella; underneath it sit specific names — UTMs, click IDs,
                AMP detours, redirect wrappers. Always be willing to point at exactly what
                was removed.
              </div>
            </div>
            <div className="voice__principle">
              <div className="voice__principle-num">03</div>
              <div className="voice__principle-body">
                <strong>Fair to creators, not just users.</strong>
                Existing creator tags are sacred. MUGA's tag only fills in when nobody
                claimed the credit. Talk about it that way.
              </div>
            </div>
            <div className="voice__principle">
              <div className="voice__principle-num">04</div>
              <div className="voice__principle-body">
                <strong>Nostalgic, not regressive.</strong>
                The reference point is when the web felt lighter — but MUGA is a modern
                utility, not a "Web 1.0 revival." No retro flourishes, no chrome.
              </div>
            </div>
            <div className="voice__principle">
              <div className="voice__principle-num">05</div>
              <div className="voice__principle-body">
                <strong>Privacy is a side effect.</strong>
                It's a real benefit and worth mentioning — never the headline. The headline
                is the experience: cleaner addresses, fewer hops, less friction.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- SYSTEM ---------- */}
      <section id="system" className="section">
        <header className="section__head">
          <div className="section__eyebrow">Phase 3 · Foundations</div>
          <h2 className="section__title">Sistema de diseño</h2>
          <p className="section__desc">
            Tokens semánticos para claro y oscuro. Todos expresados como CSS custom properties
            en <code>tokens.css</code>. Contraste AA verificado en cada par text/surface.
          </p>
        </header>

        <div className="prose" style={{marginBottom: 24}}>
          <h3>Colors</h3>
        </div>
        <SwatchRow />

        <div className="prose" style={{marginTop: 40, marginBottom: 12}}>
          <h3>Type scale</h3>
          <p>Single family — system-ui variable. Six sizes cover every surface. Mono reserved for URLs and code.</p>
        </div>
        <TypeSpec />

        <div className="prose" style={{marginTop: 40, marginBottom: 12}}>
          <h3>Components</h3>
          <p>Primitives identified and specified. Every state: default / hover / focus / disabled / error where applicable.</p>
        </div>
        <ComponentPreviews />
      </section>

      {/* ---------- MOCKUPS ---------- */}
      <section id="mockups" className="section">
        <header className="section__head">
          <div className="section__eyebrow">Phase 3 · Surfaces</div>
          <h2 className="section__title">Mockups</h2>
          <p className="section__desc">
            Interactive — use the controls below each specimen. Toggle the top-right theme to see
            the dark palette. All four surfaces below are the same React components that the
            reference HTML/CSS under <code>styles/</code> would render.
          </p>
        </header>

        {/* Popup */}
        <div className="specimen">
          <div className="specimen__label">
            Popup <em>· 380px · {popupScenario} state</em>
          </div>
          <div className="scenario-picker">
            {["clean","empty","disabled"].map(s => (
              <button key={s}
                      className={popupScenario === s ? "is-active" : ""}
                      onClick={() => setPopupScenario(s)}>
                {s === "clean" ? "With cleanings" : s === "empty" ? "Nothing to clean" : "Domain disabled"}
              </button>
            ))}
          </div>
          <div className="specimen__stage" style={{alignItems: "flex-start"}}>
            <Popup scenario={popupScenario} />
          </div>
        </div>

        {/* Toast */}
        <div className="specimen" style={{marginTop: 48}}>
          <div className="specimen__label">
            Toast <em>· non-intrusive affiliate-detected notification (opt-in)</em>
          </div>
          <div className="specimen__stage">
            <Toast visible={toastVisible} onDismiss={() => {
              setToastVisible(false);
              setTimeout(() => setToastVisible(true), 800);
            }} />
          </div>
        </div>

        {/* Onboarding */}
        <div className="specimen" style={{marginTop: 48}}>
          <div className="specimen__label">
            Onboarding <em>· step {onboardingStep + 1} of 4</em>
          </div>
          <div className="scenario-picker">
            {["Welcome","How","Affiliates","Ready"].map((lbl, i) => (
              <button key={i}
                      className={onboardingStep === i ? "is-active" : ""}
                      onClick={() => setOnboardingStep(i)}>
                {lbl}
              </button>
            ))}
          </div>
          <div className="specimen__stage" style={{display: "block", padding: 0}}>
            <Onboarding key={onboardingStep} initialStep={onboardingStep} />
          </div>
        </div>

        {/* Options */}
        <div className="specimen" style={{marginTop: 48}}>
          <div className="specimen__label">
            Options <em>· full settings page · click the sidebar to explore each section</em>
          </div>
          <div className="specimen__stage" style={{display: "block", padding: 0, position: "relative"}}>
            <OptionsPage />
          </div>
        </div>
      </section>

      {/* ---------- DECISIONS + CHECKLIST + EQUIVALENCE ---------- */}
      <DecisionsDoc />

      <footer style={{marginTop: 96, padding: "40px 0 0", borderTop: "1px solid var(--border-1)",
                      color: "var(--text-3)", fontSize: 13, display: "flex", gap: 24, flexWrap: "wrap"}}>
        <span>Entregado como documento único. Tokens en <code>styles/tokens.css</code>.
              Surface CSS en <code>styles/popup.css</code>, <code>options.css</code>, <code>onboarding.css</code>.</span>
      </footer>
    </div>
  );
};

// --- Swatches ---------------------------------------------------------------
const SwatchRow = () => {
  const groups = [
    { title: "Surfaces", items: [
      { name: "Page",      token: "--surface-0" },
      { name: "Card",      token: "--surface-1" },
      { name: "Inset",     token: "--surface-2" },
      { name: "Hover",     token: "--surface-3" },
    ]},
    { title: "Text", items: [
      { name: "Primary",   token: "--text-1" },
      { name: "Secondary", token: "--text-2" },
      { name: "Tertiary",  token: "--text-3" },
      { name: "Link",      token: "--text-link" },
    ]},
    { title: "Accent & semantic", items: [
      { name: "Brand mark",  token: "--accent-mark" },
      { name: "Accent",      token: "--accent" },
      { name: "Accent strong", token: "--accent-strong" },
      { name: "Accent soft", token: "--accent-soft" },
      { name: "Success",     token: "--success" },
      { name: "Warning",     token: "--warning" },
      { name: "Danger",      token: "--danger" },
      { name: "Info",        token: "--info" },
    ]},
    { title: "Diff", items: [
      { name: "Strip",     token: "--diff-strip" },
      { name: "Keep",      token: "--diff-keep" },
    ]},
  ];
  return (
    <div style={{display: "grid", gap: 24}}>
      {groups.map(g => (
        <div key={g.title}>
          <div className="specimen__label" style={{marginBottom: 8}}>{g.title}</div>
          <div className="tokens-grid">
            {g.items.map(it => (
              <div className="swatch" key={it.token}>
                <div className="swatch__chip" style={{background: `var(${it.token})`}} />
                <div className="swatch__name">{it.name}</div>
                <div className="swatch__token">{it.token}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// --- Type spec --------------------------------------------------------------
const TypeSpec = () => (
  <div className="type-spec">
    {[
      ["36px", "Display — hero titles", 36, 500, "--fs-36"],
      ["28px", "Pane titles, onboarding", 28, 500, "--fs-28"],
      ["22px", "About & section headers", 22, 500, "--fs-22"],
      ["18px", "Large body, lede", 18, 400, "--fs-18"],
      ["16px", "Body", 16, 400, "--fs-16"],
      ["14px", "UI default, form labels", 14, 400, "--fs-14"],
      ["13px", "Secondary, descriptions", 13, 400, "--fs-13"],
      ["12px", "Meta, captions", 12, 400, "--fs-12"],
      ["11px", "Eyebrows, tabular", 11, 500, "--fs-11"],
    ].map(([size, use, px, weight, token]) => (
      <div className="type-spec__row" key={token}>
        <div className="type-spec__size">{token}</div>
        <div className="type-spec__example"
             style={{fontSize: px, fontWeight: weight, lineHeight: 1.2}}>
          Every link, cleaned.
        </div>
        <div className="type-spec__use">{use}</div>
      </div>
    ))}
  </div>
);

// --- Component previews -----------------------------------------------------
const ComponentPreviews = () => (
  <div className="preview-grid">
    <div className="preview">
      <div className="preview__label">Buttons</div>
      <button className="btn btn--primary">Copy clean link</button>
      <button className="btn">Cancel</button>
      <button className="btn btn--accent">Done</button>
      <button className="btn btn--ghost">Ghost</button>
      <button className="btn btn--danger">Remove</button>
    </div>
    <div className="preview">
      <div className="preview__label">Toggle</div>
      <ToggleSpec />
    </div>
    <div className="preview">
      <div className="preview__label">Badges</div>
      <span className="badge">Default</span>
      <span className="badge badge--accent">on by default</span>
      <span className="badge badge--success">Always on</span>
      <span className="badge badge--warning">Strip-all</span>
      <span className="badge badge--danger">Disabled</span>
      <span className="badge badge--info">Whitelist</span>
    </div>
    <div className="preview">
      <div className="preview__label">Category chips (popup)</div>
      <span className="cat-chip cat-chip--warning">
        <Icon name="tag" size={12} /><span>Marketing (UTM)</span>
        <span className="cat-chip__count">4</span>
      </span>
      <span className="cat-chip cat-chip--info">
        <Icon name="cart" size={12} /><span>E-commerce</span>
        <span className="cat-chip__count">2</span>
      </span>
      <span className="cat-chip cat-chip--accent">
        <Icon name="tag" size={12} /><span>Affiliate</span>
        <span className="cat-chip__count">1</span>
      </span>
    </div>
    <div className="preview">
      <div className="preview__label">Input & kbd</div>
      <input className="input" placeholder="Search domains" style={{width: "100%"}} />
      <input className="input input--mono" defaultValue="mc_*" style={{width: "100%"}} />
      <div><span className="kbd">⌥⇧C</span> <span className="kbd">Tab</span> <span className="kbd">Enter</span></div>
    </div>
    <div className="preview">
      <div className="preview__label">Notices</div>
      <div className="notice"><Icon name="info" size={14} /><span>Neutral callout copy.</span></div>
      <div className="notice notice--info"><Icon name="info" size={14} /><span>Informational tone.</span></div>
      <div className="notice notice--warn"><Icon name="alert" size={14} /><span>Reset is irreversible.</span></div>
    </div>
  </div>
);

const ToggleSpec = () => {
  const [a, setA] = React.useState(true);
  const [b, setB] = React.useState(false);
  return (
    <div style={{display: "flex", gap: 16, alignItems: "center"}}>
      <label className="toggle">
        <input type="checkbox" checked={a} onChange={e => setA(e.target.checked)} />
        <span className="toggle__track" /><span className="toggle__thumb" />
      </label>
      <label className="toggle">
        <input type="checkbox" checked={b} onChange={e => setB(e.target.checked)} />
        <span className="toggle__track" /><span className="toggle__thumb" />
      </label>
      <label className="toggle">
        <input type="checkbox" disabled />
        <span className="toggle__track" /><span className="toggle__thumb" />
      </label>
    </div>
  );
};

window.App = App;
