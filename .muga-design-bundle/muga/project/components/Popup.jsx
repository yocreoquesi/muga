// Popup — ~380px wide browser-extension popup.
// States: clean (with items), empty (nothing to clean), disabled (domain off).

const POPUP_W = 380;

const POPUP_SCENARIOS = {
  clean: {
    site: "amazon.es",
    favicon: "A",
    cleaned: 7,
    origin: "https://www.amazon.es",
    path: "/dp/B08N5WRWNW",
    kept: [],
    stripped: [
      { key: "utm_source", value: "google", category: "utm" },
      { key: "utm_medium", value: "cpc", category: "utm" },
      { key: "gclid", value: "EAIaIQ...", category: "click" },
      { key: "linkCode", value: "ll1", category: "affil" },
      { key: "pd_rd_r", value: "xyz", category: "ecom" },
      { key: "pf_rd_p", value: "def", category: "ecom" },
      { key: "ref_", value: "nav", category: "ecom" },
    ].map(p => ({ ...p, stripped: true })),
    affiliate: { added: true, tag: "muga-21" },
  },
  empty: {
    site: "wikipedia.org",
    favicon: "W",
    cleaned: 0,
    origin: "https://en.wikipedia.org",
    path: "/wiki/Browser_extension",
    kept: [],
    stripped: [],
    affiliate: null,
  },
  disabled: {
    site: "mybank.example",
    favicon: "B",
    cleaned: 0,
    origin: "https://mybank.example",
    path: "/login",
    kept: [],
    stripped: [],
    affiliate: null,
    domainDisabled: true,
  },
};

const Popup = ({ scenario = "clean" }) => {
  const data = POPUP_SCENARIOS[scenario];
  const [copied, setCopied] = React.useState(false);
  const [domainOn, setDomainOn] = React.useState(!data.domainDisabled);
  const [affilOn, setAffilOn] = React.useState(true);
  const [expandedDetails, setExpandedDetails] = React.useState(false);

  React.useEffect(() => { setDomainOn(!data.domainDisabled); }, [scenario]);

  const doCopy = () => { setCopied(true); setTimeout(() => setCopied(false), 1400); };

  const afterUrl = `${data.origin}${data.path}${data.kept.length ? "?" + data.kept.map(p => `${p.key}=${p.value}`).join("&") : ""}`;

  // Group stripped by category for summary
  const grouped = {};
  data.stripped.forEach(p => { grouped[p.category] = (grouped[p.category] || 0) + 1; });

  return (
    <div className="popup" role="dialog" aria-label="MUGA popup">
      {/* HEADER */}
      <header className="popup__header">
        <div className="popup__brand">
          <div className="popup__logo" aria-hidden="true">
            <BrandMark height={16} />
          </div>
          <span className="popup__wordmark">MUGA</span>
        </div>
        <div className="popup__header-actions">
          <button className="btn btn--ghost btn--icon" aria-label="Settings"
                  title="Open settings">
            <Icon name="settings" size={16} />
          </button>
        </div>
      </header>

      {/* SITE BAR */}
      <div className="popup__site">
        <div className="popup__favicon" aria-hidden="true">{data.favicon}</div>
        <div className="popup__site-meta">
          <div className="popup__site-host">{data.site}</div>
          <div className="popup__site-state">
            {data.domainDisabled ? "MUGA is off on this site" :
             data.cleaned > 0 ? `${data.cleaned} bit${data.cleaned === 1 ? "" : "s"} of noise removed` :
             "This link is already clean"}
          </div>
        </div>
        <label className="toggle" title={domainOn ? "MUGA is on for this site" : "MUGA is off for this site"}>
          <input type="checkbox" checked={domainOn} onChange={e => setDomainOn(e.target.checked)}
                 aria-label={`MUGA ${domainOn ? "enabled" : "disabled"} on ${data.site}`} />
          <span className="toggle__track" /><span className="toggle__thumb" />
        </label>
      </div>

      {/* BODY — three mutually-exclusive states */}
      {!domainOn ? (
        <DisabledState site={data.site} />
      ) : data.cleaned === 0 ? (
        <EmptyState site={data.site} />
      ) : (
        <CleanState data={data} grouped={grouped} expanded={expandedDetails}
                    setExpanded={setExpandedDetails} affilOn={affilOn} setAffilOn={setAffilOn} />
      )}

      {/* FOOTER */}
      <footer className="popup__footer">
        {domainOn && data.cleaned > 0 ? (
          <>
            <button className={`btn btn--primary btn--block`} onClick={doCopy}>
              <Icon name={copied ? "check" : "copy"} size={14} />
              {copied ? "Copied" : "Copy clean link"}
            </button>
            <button className="btn btn--ghost btn--icon" aria-label="Share options" title="More">
              <Icon name="link" size={14} />
            </button>
          </>
        ) : (
          <>
            <div className="popup__shortcut">
              <Icon name="copy" size={13} />
              <span>Copy current URL</span>
              <span className="kbd">⌥⇧C</span>
            </div>
          </>
        )}
      </footer>
    </div>
  );
};

// --- Sub-states --------------------------------------------------------------

const CleanState = ({ data, grouped, expanded, setExpanded, affilOn, setAffilOn }) => {
  return (
    <div className="popup__body">
      {/* Summary chips — glance comprehension in <2s */}
      <div className="popup__summary" role="list" aria-label="What was removed">
        {Object.entries(grouped).map(([cat, n]) => {
          const meta = CATEGORIES[cat] || CATEGORIES.other;
          return (
            <span key={cat} className={`cat-chip cat-chip--${meta.tone}`} role="listitem">
              <Icon name={meta.icon} size={12} />
              <span className="cat-chip__label">{meta.label}</span>
              <span className="cat-chip__count">{n}</span>
            </span>
          );
        })}
      </div>

      {/* Diff — compact by default, expand for full */}
      <div className="popup__diff">
        <div className="popup__diff-label">
          <span>Before</span>
          <button className="popup__expand" onClick={() => setExpanded(!expanded)}
                  aria-expanded={expanded}>
            {expanded ? "Hide full URL" : "Show full URL"}
            <Icon name={expanded ? "chevUp" : "chevDown"} size={12} />
          </button>
        </div>
        <div className={`popup__url popup__url--before ${expanded ? "is-expanded" : ""}`}>
          <span className="u-origin">{data.origin}</span>
          <span className="u-path">{data.path}</span>
          <span className="u-qmark">?</span>
          {data.stripped.map((p, i) => (
            <React.Fragment key={i}>
              <span className="u-param u-param--strip">
                <span className="u-key">{p.key}</span>=<span className="u-val">{p.value}</span>
              </span>
              {i < data.stripped.length - 1 && <span className="u-amp">&</span>}
            </React.Fragment>
          ))}
        </div>
        <div className="popup__diff-label" style={{marginTop: "10px"}}>
          <span>After</span>
          <span className="popup__cleaned-ok">
            <Icon name="check" size={12} /> clean
          </span>
        </div>
        <div className="popup__url popup__url--after">
          <span className="u-origin">{data.origin}</span>
          <span className="u-path">{data.path}</span>
        </div>
      </div>

      {/* Affiliate disclosure row — transparent, not apologetic */}
      {data.affiliate && (
        <div className="popup__affil">
          <div className="popup__affil-main">
            <Icon name="info" size={13} />
            <div>
              <div className="popup__affil-title">
                Referral tag added
                <code className="popup__affil-tag">tag=muga-21</code>
              </div>
              <div className="popup__affil-desc">
                No creator was already tagged. Same price for you — supports MUGA.
                {" "}<button className="linkish">Why?</button>
              </div>
            </div>
          </div>
          <label className="toggle toggle--sm" title="Affiliate injection on this domain">
            <input type="checkbox" checked={affilOn} onChange={e => setAffilOn(e.target.checked)}
                   aria-label="Toggle affiliate injection on this domain" />
            <span className="toggle__track" /><span className="toggle__thumb" />
          </label>
        </div>
      )}
    </div>
  );
};

const EmptyState = ({ site }) => (
  <div className="popup__body popup__empty">
    <div className="popup__empty-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.25">
        <circle cx="24" cy="24" r="18" />
        <path d="M15 24 L22 31 L34 17" />
      </svg>
    </div>
    <div className="popup__empty-title">No noise here.</div>
    <div className="popup__empty-desc">
      The URL on <strong>{site}</strong> is already clean.
      MUGA is watching — if anything noisy shows up, it'll quietly handle it.
    </div>
  </div>
);

const DisabledState = ({ site }) => (
  <div className="popup__body popup__empty popup__empty--disabled">
    <div className="popup__empty-mark popup__empty-mark--muted" aria-hidden="true">
      <Icon name="eyeOff" size={28} />
    </div>
    <div className="popup__empty-title">MUGA is off on this site</div>
    <div className="popup__empty-desc">
      URLs on <strong>{site}</strong> pass through untouched.
      Flip the switch above whenever you want the noise turned back down.
    </div>
  </div>
);

window.Popup = Popup;
window.POPUP_SCENARIOS = POPUP_SCENARIOS;
