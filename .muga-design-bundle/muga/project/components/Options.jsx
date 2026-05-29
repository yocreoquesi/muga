// Options — full settings page.
// Sections: General, Affiliates, Domains, Custom params, Advanced, Import/Export, About.

const OPTIONS_SECTIONS = [
  { id: "general", label: "General", icon: "settings" },
  { id: "affiliates", label: "Affiliates", icon: "tag" },
  { id: "domains", label: "Domains", icon: "globe" },
  { id: "params", label: "Custom parameters", icon: "filter" },
  { id: "advanced", label: "Advanced", icon: "code" },
  { id: "io", label: "Import / Export", icon: "download" },
  { id: "about", label: "About", icon: "info" },
];

const OptionsPage = () => {
  const [active, setActive] = React.useState("general");
  const [language, setLanguage] = React.useState("en");
  const [showDiffModal, setShowDiffModal] = React.useState(false);

  return (
    <div className="opt">
      <header className="opt__top">
        <div className="opt__brand">
          <div className="opt__logo"><BrandMark height={20} /></div>
          <span className="opt__wordmark">MUGA</span>
          <span className="badge">v1.3.0</span>
        </div>
        <div className="opt__top-actions">
          <select className="select select--sm" value={language}
                  onChange={e => setLanguage(e.target.value)}
                  aria-label="Interface language">
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="pt">Português</option>
            <option value="de">Deutsch</option>
          </select>
          <button className="btn btn--ghost btn--sm">
            <Icon name="globe" size={13} /> View source
          </button>
        </div>
      </header>

      <div className="opt__layout">
        <nav className="opt__nav" aria-label="Settings sections">
          {OPTIONS_SECTIONS.map(s => (
            <button key={s.id}
                    className={`opt__navitem ${active === s.id ? "is-active" : ""}`}
                    onClick={() => setActive(s.id)}
                    aria-current={active === s.id ? "page" : undefined}>
              <Icon name={s.icon} size={14} />
              <span>{s.label}</span>
            </button>
          ))}
          <hr className="hline" style={{margin: "12px 8px"}} />
          <button className="opt__navitem opt__navitem--muted"
                  onClick={() => setShowDiffModal(true)}>
            <Icon name="download" size={14} />
            <span>Import settings</span>
          </button>
        </nav>

        <main className="opt__main">
          {active === "general" && <GeneralPane />}
          {active === "affiliates" && <AffiliatesPane />}
          {active === "domains" && <DomainsPane />}
          {active === "params" && <ParamsPane />}
          {active === "advanced" && <AdvancedPane />}
          {active === "io" && <IoPane onImport={() => setShowDiffModal(true)} />}
          {active === "about" && <AboutPane />}
        </main>
      </div>

      {showDiffModal && <ImportDiffModal onClose={() => setShowDiffModal(false)} />}
    </div>
  );
};

// --- Panes -------------------------------------------------------------------

const PaneHeader = ({ title, desc, aside }) => (
  <header className="pane__header">
    <div>
      <h1 className="pane__title">{title}</h1>
      {desc && <p className="pane__desc">{desc}</p>}
    </div>
    {aside}
  </header>
);

const GeneralPane = () => {
  const [stripDnr, setStripDnr] = React.useState(true);
  const [stripClicks, setStripClicks] = React.useState(true);
  const [amazonClean, setAmazonClean] = React.useState(true);
  const [badge, setBadge] = React.useState(true);
  const [toast, setToast] = React.useState(false);

  return (
    <section className="pane">
      <PaneHeader title="General"
                  desc="How MUGA denoises links and what it shows you." />

      <div className="pane__group">
        <div className="pane__group-title">Cleaning</div>
        <ToggleRow
          title="Denoise links before navigation"
          desc="Catches URLs the moment they're typed, pasted, bookmarked or opened from another app. 89 patterns covered."
          value={stripDnr} onChange={setStripDnr} />
        <ToggleRow
          title="Denoise links you click"
          desc="Removes UTMs, fbclid, gclid, YouTube si, Pinterest, Snapchat, Reddit and similar residue the instant you click — before the request goes out."
          value={stripClicks} onChange={setStripClicks}
          locked lockedNote="Core feature — always on" />
        <ToggleRow
          title="Tidy Amazon paths"
          desc={<>Removes <code className="inline-code">/ref=nav_logo</code>, session IDs after the ASIN, and product slugs. Cosmetic only — never affects search or add-to-cart.</>}
          value={amazonClean} onChange={setAmazonClean} />
      </div>

      <div className="pane__group">
        <div className="pane__group-title">Feedback</div>
        <ToggleRow
          title="Badge counter on toolbar icon"
          desc="Shows how many bits of noise were removed on the current tab."
          value={badge} onChange={setBadge} />
        <ToggleRow
          title="Toast when a creator tag is detected"
          desc="A small notification in the corner when an existing creator/affiliate tag is found and preserved. Auto-dismisses."
          value={toast} onChange={setToast} />
      </div>

      <div className="pane__group">
        <div className="pane__group-title">Shortcuts</div>
        <div className="row">
          <div className="row__body">
            <div className="row__title">Copy clean URL of current tab</div>
            <div className="row__desc">Copies to clipboard without opening the popup.</div>
          </div>
          <div className="row__control">
            <span className="kbd">⌥⇧C</span>
          </div>
        </div>
        <div className="row">
          <div className="row__body">
            <div className="row__title">Right-click menu: "Copy clean link"</div>
            <div className="row__desc">Cleans any link without navigating.</div>
          </div>
          <div className="row__control"><span className="badge badge--success">On</span></div>
        </div>
      </div>
    </section>
  );
};

const AffiliatesPane = () => {
  const [ourTag, setOurTag] = React.useState(true);
  const [replaceOthers, setReplaceOthers] = React.useState(false);
  const [stripAll, setStripAll] = React.useState(false);

  return (
    <section className="pane">
      <PaneHeader title="Affiliates"
                  desc="Fair to the creators who recommend things. Fair to you. Explained in full before any toggle changes anything." />

      <div className="pane__explainer">
        <div className="pane__explainer-title">
          <Icon name="info" size={14} />
          How MUGA's affiliate model works
        </div>
        <ul className="pane__explainer-list">
          <li><strong>Creators come first.</strong> If a YouTuber, reviewer or friend has already tagged a link, their attribution is left untouched.</li>
          <li><strong>We only step in when no one else has.</strong> On supported stores, untagged links get MUGA's tag added.</li>
          <li><strong>Same price for you.</strong> The commission is between the store and us. Never appears on your bill.</li>
          <li><strong>Off in two clicks</strong> — globally, or per domain. Same source of truth as the cleaning toggles.</li>
        </ul>
      </div>

      <div className="pane__group">
        <div className="pane__group-title">Defaults</div>
        <ToggleRow
          title="Add MUGA's referral tag to untagged store links"
          desc="Only on the 20 supported stores. Does nothing if any affiliate parameter is already present."
          value={ourTag} onChange={setOurTag}
          trailing={<span className="badge badge--accent">on by default</span>} />
      </div>

      <div className="pane__group">
        <div className="pane__group-title">Explicit opt-ins</div>
        <ToggleRow
          title="Replace creator tags with MUGA's"
          desc="Swap an existing creator's tag for ours. Off by default — we don't take credit from people who earned it."
          value={replaceOthers} onChange={setReplaceOthers}
          warning={replaceOthers} />
        <ToggleRow
          title="Strip all affiliate tags, including ours"
          desc="Removes every referral parameter. Nobody — us or creators — gets attribution for your clicks."
          value={stripAll} onChange={setStripAll} />
      </div>

      <div className="pane__group">
        <div className="pane__group-title">Supported stores (20)</div>
        <div className="store-grid">
          {["Amazon ES","Amazon DE","Amazon FR","Amazon IT","Amazon UK","Amazon US","Booking","AliExpress","PcComponentes","El Corte Inglés","eBay","Temu","Zalando ES","Zalando DE","SHEIN","Fnac ES","Fnac FR","MediaMarkt ES","MediaMarkt DE","Carrefour"].map(s => (
            <div className="store-chip" key={s}><Icon name="store" size={12} /><span>{s}</span></div>
          ))}
        </div>
      </div>
    </section>
  );
};

const DomainsPane = () => {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const domains = [
    { name: "mybank.example",    mode: "disabled", note: "MUGA off entirely" },
    { name: "amazon.es",         mode: "normal",   note: "All features active" },
    { name: "blog.creator.com",  mode: "whitelist", note: "Protect existing affiliate tags" },
    { name: "sketchy-promo.io",  mode: "blacklist", note: "Strip every query parameter" },
    { name: "news.example.com",  mode: "noaffil",  note: "Tracking cleaned — affiliate injection off" },
  ];
  const modeMeta = {
    normal:    { label: "Default", tone: "default" },
    disabled:  { label: "Disabled", tone: "danger" },
    whitelist: { label: "Whitelist", tone: "info" },
    blacklist: { label: "Strip-all", tone: "warning" },
    noaffil:   { label: "No affiliate", tone: "accent" },
  };
  const filtered = domains.filter(d =>
    (filter === "all" || d.mode === filter) &&
    (query === "" || d.name.includes(query))
  );
  return (
    <section className="pane">
      <PaneHeader title="Domains"
                  desc="Per-site overrides. Any domain not listed uses the defaults from General and Affiliates."
                  aside={<button className="btn btn--primary btn--sm"><Icon name="plus" size={13}/> Add domain</button>} />

      <div className="domain-toolbar">
        <div className="input-with-icon">
          <Icon name="search" size={13} />
          <input className="input" placeholder="Search domains"
                 value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="segment" role="tablist">
          {["all","disabled","whitelist","blacklist","noaffil"].map(f => (
            <button key={f} role="tab" aria-selected={filter === f}
                    className={`segment__btn ${filter === f ? "is-active" : ""}`}
                    onClick={() => setFilter(f)}>
              {f === "all" ? "All" : modeMeta[f].label}
            </button>
          ))}
        </div>
      </div>

      <div className="domain-list" role="table" aria-label="Domain overrides">
        <div className="domain-list__head" role="row">
          <div role="columnheader">Domain</div>
          <div role="columnheader">Mode</div>
          <div role="columnheader">Notes</div>
          <div role="columnheader" className="sr-only">Actions</div>
        </div>
        {filtered.map(d => {
          const m = modeMeta[d.mode];
          return (
            <div className="domain-row" key={d.name} role="row">
              <div className="domain-row__name" role="cell">
                <div className="domain-row__favicon" aria-hidden="true">{d.name[0].toUpperCase()}</div>
                <span>{d.name}</span>
              </div>
              <div role="cell">
                <span className={`badge badge--${m.tone}`}>{m.label}</span>
              </div>
              <div className="domain-row__note" role="cell">{d.note}</div>
              <div className="domain-row__actions" role="cell">
                <button className="btn btn--ghost btn--sm" aria-label={`Edit ${d.name}`}>
                  <Icon name="edit" size={12} />
                </button>
                <button className="btn btn--ghost btn--sm btn--danger" aria-label={`Remove ${d.name}`}>
                  <Icon name="trash" size={12} />
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="domain-list__empty">No domains match those filters.</div>
        )}
      </div>
    </section>
  );
};

const ParamsPane = () => {
  const [params, setParams] = React.useState([
    { key: "mc_cid",   note: "Mailchimp campaign", active: true },
    { key: "mc_eid",   note: "Mailchimp subscriber", active: true },
    { key: "ck_*",     note: "ConvertKit (wildcard)", active: true },
    { key: "hs_*",     note: "HubSpot (wildcard)", active: false },
  ]);
  const [draft, setDraft] = React.useState("");
  const add = () => {
    if (!draft.trim()) return;
    setParams([...params, { key: draft.trim(), note: "Custom", active: true }]);
    setDraft("");
  };
  return (
    <section className="pane">
      <PaneHeader title="Custom parameters"
                  desc="Add your own tracking parameters. Use * as a wildcard (e.g. mc_*)." />

      <div className="add-param">
        <input className="input input--mono" placeholder="e.g. mc_cid or hs_*"
               value={draft} onChange={e => setDraft(e.target.value)}
               onKeyDown={e => e.key === "Enter" && add()} />
        <button className="btn btn--primary" onClick={add}>
          <Icon name="plus" size={13} /> Add
        </button>
      </div>
      <div className="param-list">
        {params.map((p, i) => (
          <div className="param-row" key={i}>
            <label className="toggle toggle--sm">
              <input type="checkbox" checked={p.active}
                     onChange={e => {
                       const next = [...params];
                       next[i] = { ...p, active: e.target.checked };
                       setParams(next);
                     }}
                     aria-label={`Toggle ${p.key}`} />
              <span className="toggle__track" /><span className="toggle__thumb" />
            </label>
            <code className="param-row__key">{p.key}</code>
            <span className="param-row__note">{p.note}</span>
            <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Remove ${p.key}`}
                    onClick={() => setParams(params.filter((_, j) => j !== i))}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};

const AdvancedPane = () => {
  const [ping, setPing] = React.useState(true);
  const [amp, setAmp] = React.useState(true);
  const [unwrap, setUnwrap] = React.useState(true);
  const [debug, setDebug] = React.useState(false);

  return (
    <section className="pane">
      <PaneHeader title="Advanced"
                  desc="Edge cases and debugging. Most users never touch these." />

      <div className="pane__group">
        <ToggleRow
          title={<>Block <code className="inline-code">&lt;a ping&gt;</code> beacons</>}
          desc="Some sites (notably Google search results) fire a silent tracking request when you click a link. MUGA quietly drops them. Nothing changes visually."
          value={ping} onChange={setPing} />
        <ToggleRow
          title="Skip AMP detours"
          desc="When a link points to a Google-cached AMP page, MUGA follows it to the real site — fewer hops, faster page."
          value={amp} onChange={setAmp} />
        <ToggleRow
          title="Unwrap redirect wrappers"
          desc="Reddit's out.redd.it, Steam's linkfilter, generic ?url=… wrappers. Navigate straight to the destination."
          value={unwrap} onChange={setUnwrap} />
      </div>

      <div className="pane__group">
        <div className="pane__group-title">Diagnostics</div>
        <ToggleRow
          title="Log cleanings to the browser console"
          desc="For debugging weird edge cases. Disables itself after 24 hours."
          value={debug} onChange={setDebug} />
      </div>

      <div className="notice notice--warn">
        <Icon name="alert" size={14} />
        <div>
          <strong>Reset to defaults</strong> will discard custom params, per-domain rules and import history.
          <div style={{marginTop: 8}}>
            <button className="btn btn--danger btn--sm">Reset everything…</button>
          </div>
        </div>
      </div>
    </section>
  );
};

const IoPane = ({ onImport }) => (
  <section className="pane">
    <PaneHeader title="Import / Export" desc="Portable JSON — move your settings between browsers, or back them up." />

    <div className="io-grid">
      <div className="io-card">
        <div className="io-card__icon"><Icon name="download" size={18} /></div>
        <div className="io-card__title">Export current settings</div>
        <div className="io-card__desc">Downloads a JSON file containing all toggles, domains, custom parameters, and language.</div>
        <button className="btn btn--primary btn--block">
          <Icon name="download" size={13} /> Export muga-settings.json
        </button>
      </div>
      <div className="io-card">
        <div className="io-card__icon"><Icon name="upload" size={18} /></div>
        <div className="io-card__title">Import from file</div>
        <div className="io-card__desc">You’ll preview the diff before anything is applied.</div>
        <button className="btn btn--block" onClick={onImport}>
          <Icon name="upload" size={13} /> Choose file…
        </button>
      </div>
    </div>
  </section>
);

const AboutPane = () => (
  <section className="pane">
    <PaneHeader title="About MUGA" />
    <div className="about">
      <div className="about__logo"><BrandMark height={56} title="MUGA" /></div>
      <div className="about__copy">
        <div className="about__title">MUGA — The denoise extension for the web</div>
        <div className="about__version">Version 1.3.0 · Manifest V3 · MIT license</div>
        <p className="about__lead">
          459+ noise patterns removed before the page loads. Cleaner addresses, fewer redirects,
          less residue between you and the site. Everything runs on your device — nothing
          is ever sent to any server.
        </p>
        <div className="about__links">
          <a href="#">Privacy policy</a>
          <a href="#">Source code</a>
          <a href="#">Changelog</a>
          <a href="#">Report an issue</a>
        </div>
      </div>
    </div>
  </section>
);

// --- Toggle row used by panes -----------------------------------------------
const ToggleRow = ({ title, desc, value, onChange, locked, lockedNote, trailing, warning }) => (
  <div className={`row ${warning ? "row--warn" : ""}`}>
    <div className="row__body">
      <div className="row__title-line">
        <div className="row__title">{title}</div>
        {trailing}
      </div>
      <div className="row__desc">{desc}</div>
      {warning && (
        <div className="row__warn">
          <Icon name="alert" size={12} />
          Make sure you understand this before enabling. Creators lose attribution for your clicks.
        </div>
      )}
    </div>
    <div className="row__control">
      {locked ? (
        <span className="badge badge--success" title={lockedNote}>Always on</span>
      ) : (
        <label className="toggle">
          <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)}
                 aria-label={typeof title === "string" ? title : "Toggle"} />
          <span className="toggle__track" /><span className="toggle__thumb" />
        </label>
      )}
    </div>
  </div>
);

// --- Import diff modal ------------------------------------------------------
const ImportDiffModal = ({ onClose }) => {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Import preview">
      <div className="modal">
        <header className="modal__header">
          <div>
            <div className="modal__title">Preview import</div>
            <div className="modal__sub">muga-settings-2026-03.json · 18 changes</div>
          </div>
          <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="modal__body">
          <div className="diff-list">
            <div className="diff-row diff-row--add">
              <span className="diff-row__sign">+</span>
              <div>
                <div className="diff-row__key">Custom parameter <code>mc_cid</code></div>
                <div className="diff-row__desc">New — Mailchimp campaign ID</div>
              </div>
            </div>
            <div className="diff-row diff-row--change">
              <span className="diff-row__sign">~</span>
              <div>
                <div className="diff-row__key">Affiliate tag injection</div>
                <div className="diff-row__desc">
                  <span className="diff-from">off</span>
                  <Icon name="arrowRight" size={11} />
                  <span className="diff-to">on (default)</span>
                </div>
              </div>
            </div>
            <div className="diff-row diff-row--remove">
              <span className="diff-row__sign">−</span>
              <div>
                <div className="diff-row__key">Domain override <code>old-site.example</code></div>
                <div className="diff-row__desc">Will be removed</div>
              </div>
            </div>
            <div className="diff-row diff-row--add">
              <span className="diff-row__sign">+</span>
              <div>
                <div className="diff-row__key">Domain override <code>sketchy-promo.io</code></div>
                <div className="diff-row__desc">Strip-all mode</div>
              </div>
            </div>
            <div className="diff-row diff-row--same">
              <span className="diff-row__sign">=</span>
              <div>
                <div className="diff-row__key">14 other settings unchanged</div>
              </div>
            </div>
          </div>
        </div>
        <footer className="modal__footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary">Apply 18 changes</button>
        </footer>
      </div>
    </div>
  );
};

window.OptionsPage = OptionsPage;
