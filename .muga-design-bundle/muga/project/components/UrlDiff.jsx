// BeforeAfterDiff — the core truth-telling component.
// Shows original URL with strikethrough on removed params, colored by category.
// Expects url parsed into: { origin, path, kept: [{key,value}], stripped: [{key,value,category}] }

const CATEGORIES = {
  utm:      { label: "Marketing residue", icon: "tag",    tone: "warning" },
  social:   { label: "Social tags",       icon: "social", tone: "info" },
  click:    { label: "Click IDs",         icon: "link",   tone: "warning" },
  ecom:     { label: "Store noise",       icon: "cart",   tone: "info" },
  share:    { label: "Share tokens",      icon: "video",  tone: "info" },
  email:    { label: "Email beacons",     icon: "mail",   tone: "warning" },
  affil:    { label: "Affiliate",         tone: "accent", icon: "tag" },
  other:    { label: "Other noise",       icon: "slash",  tone: "default" },
};

// Renders a URL with removed segments struck-through and colored
const UrlDiff = ({ origin, path, kept, stripped, mode = "strike" }) => {
  // Build a visible representation of the "before" URL
  return (
    <div className="url-diff">
      <div className="url-diff__lane url-diff__lane--before">
        <div className="url-diff__label">Before</div>
        <div className="url-diff__value" role="textbox" aria-readonly="true">
          <span className="u-origin">{origin}</span>
          <span className="u-path">{path}</span>
          <span className="u-qmark">?</span>
          {[...kept, ...stripped].map((p, i, arr) => (
            <React.Fragment key={i}>
              <span className={p.stripped ? `u-param u-param--strip` : `u-param u-param--keep`}>
                <span className="u-key">{p.key}</span>
                <span className="u-eq">=</span>
                <span className="u-val">{p.value}</span>
              </span>
              {i < arr.length - 1 && <span className="u-amp">&</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="url-diff__divider" aria-hidden="true">
        <Icon name="arrowDown" size={14} />
      </div>
      <div className="url-diff__lane url-diff__lane--after">
        <div className="url-diff__label">After</div>
        <div className="url-diff__value">
          <span className="u-origin">{origin}</span>
          <span className="u-path">{path}</span>
          {kept.length > 0 && (
            <>
              <span className="u-qmark">?</span>
              {kept.map((p, i) => (
                <React.Fragment key={i}>
                  <span className="u-param u-param--keep">
                    <span className="u-key">{p.key}</span>
                    <span className="u-eq">=</span>
                    <span className="u-val">{p.value}</span>
                  </span>
                  {i < kept.length - 1 && <span className="u-amp">&</span>}
                </React.Fragment>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

window.UrlDiff = UrlDiff;
window.CATEGORIES = CATEGORIES;
