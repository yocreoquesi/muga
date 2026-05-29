// Onboarding — 4 steps, shown on install. The affiliate step must be impossible to misread.

const ONBOARDING_STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "how", label: "How it works" },
  { id: "affiliates", label: "Affiliates" },
  { id: "ready", label: "Ready" },
];

const Onboarding = ({ initialStep = 0 }) => {
  const [step, setStep] = React.useState(initialStep);
  const [affilChoice, setAffilChoice] = React.useState(null); // 'on' | 'off'

  const next = () => setStep(Math.min(step + 1, ONBOARDING_STEPS.length - 1));
  const prev = () => setStep(Math.max(step - 1, 0));

  return (
    <div className="onb">
      <header className="onb__top">
        <div className="onb__brand">
          <BrandMark height={20} />
          <span>MUGA</span>
        </div>
        <button className="btn btn--ghost btn--sm">Skip for now</button>
      </header>

      <div className="onb__progress" role="progressbar"
           aria-valuemin="1" aria-valuemax={ONBOARDING_STEPS.length} aria-valuenow={step + 1}>
        {ONBOARDING_STEPS.map((s, i) => (
          <div key={s.id}
               className={`onb__dot ${i === step ? "is-active" : ""} ${i < step ? "is-done" : ""}`}>
            <span className="onb__dot-label">{s.label}</span>
          </div>
        ))}
      </div>

      <main className="onb__main">
        {step === 0 && <WelcomeStep />}
        {step === 1 && <HowStep />}
        {step === 2 && <AffiliatesStep value={affilChoice} onChoose={setAffilChoice} />}
        {step === 3 && <ReadyStep affil={affilChoice} />}
      </main>

      <footer className="onb__footer">
        <button className="btn btn--ghost" onClick={prev} disabled={step === 0}>
          Back
        </button>
        <div className="onb__footer-meta">{step + 1} of {ONBOARDING_STEPS.length}</div>
        {step < ONBOARDING_STEPS.length - 1 ? (
          <button className="btn btn--primary"
                  onClick={next}
                  disabled={step === 2 && affilChoice === null}>
            Continue <Icon name="arrowRight" size={13} />
          </button>
        ) : (
          <button className="btn btn--accent">
            Done — pin MUGA to the toolbar
          </button>
        )}
      </footer>
    </div>
  );
};

const WelcomeStep = () => (
  <div className="onb-step">
    <div className="onb-step__glyph" aria-hidden="true">
      <BrandMark height={64} />
    </div>
    <h1 className="onb-step__title">The web, with the noise turned down.</h1>
    <p className="onb-step__lede">
      Links arrive cluttered — UTMs, click IDs, redirect wrappers, AMP detours. Friction
      between you and the page you actually wanted. MUGA quietly removes it so browsing
      feels like it used to: shorter URLs, fewer hops, less residue.
    </p>
    <ul className="onb-step__bullets">
      <li><Icon name="check" size={14} /> 459+ noise patterns removed before the page loads</li>
      <li><Icon name="check" size={14} /> Works on every site, in the background</li>
      <li><Icon name="check" size={14} /> Fair to creators · nice to you · honest about both</li>
      <li><Icon name="check" size={14} /> Open source · runs entirely on your device</li>
    </ul>
  </div>
);

const HowStep = () => (
  <div className="onb-step">
    <div className="onb-step__kicker">How it works</div>
    <h1 className="onb-step__title">One link, before and after.</h1>

    <div className="onb-demo">
      <div className="onb-demo__label">A YouTube review → Amazon</div>
      <div className="onb-demo__url onb-demo__url--before">
        <span className="u-origin">https://www.amazon.es</span>
        <span className="u-path">/dp/B08N5WRWNW</span>
        <span className="u-qmark">?</span>
        <span className="u-param u-param--strip">utm_source=youtube</span>
        <span className="u-amp">&</span>
        <span className="u-param u-param--strip">gclid=EAIaIQ…</span>
        <span className="u-amp">&</span>
        <span className="u-param u-param--strip">pd_rd_r=xyz</span>
        <span className="u-amp">&</span>
        <span className="u-param u-param--strip">ref_=nav</span>
      </div>
      <div className="onb-demo__arrow" aria-hidden="true"><Icon name="arrowDown" size={14}/></div>
      <div className="onb-demo__url onb-demo__url--after">
        <span className="u-origin">https://www.amazon.es</span>
        <span className="u-path">/dp/B08N5WRWNW</span>
        <span className="onb-demo__badge"><Icon name="check" size={11}/> clean</span>
      </div>
    </div>

    <div className="onb-step__secondary">
      Three places MUGA does its quiet work: the address bar (typed or pasted), any link
      you click on any page, and the right-click menu (<span className="kbd">Copy clean link</span>).
      Press <span className="kbd">⌥⇧C</span> to copy the cleaned URL of the current tab.
    </div>
  </div>
);

const AffiliatesStep = ({ value, onChoose }) => (
  <div className="onb-step">
    <div className="onb-step__kicker">Fair to everyone</div>
    <h1 className="onb-step__title">How MUGA keeps the lights on.</h1>
    <p className="onb-step__lede">
      MUGA is free because of a small, boring arrangement with 20 supported stores. When you
      click an <em>untagged</em> link to one of them, we add a referral tag. The store pays us
      a small commission. You pay the same price. No tracking, no profile-building — just the
      standard merchant attribution that's been around since the late nineties.
    </p>

    <div className="onb-rules">
      <div className="onb-rule">
        <Icon name="check" size={14} />
        <div>
          <strong>Same price for you, always.</strong>
          <p>The commission is between the store and us. It never shows up on your bill.</p>
        </div>
      </div>
      <div className="onb-rule">
        <Icon name="check" size={14} />
        <div>
          <strong>Creators come first.</strong>
          <p>If a YouTuber, reviewer or friend already tagged a link, we leave it alone. Their attribution stays. Replacing tags requires a separate, explicit opt-in.</p>
        </div>
      </div>
      <div className="onb-rule">
        <Icon name="check" size={14} />
        <div>
          <strong>Off in two clicks.</strong>
          <p>Settings → Affiliates → toggle off. Globally, or per domain.</p>
        </div>
      </div>
      <div className="onb-rule">
        <Icon name="check" size={14} />
        <div>
          <strong>You can read the code.</strong>
          <p>Full source on GitHub. The tag we inject is in <code>src/lib/affiliates.js</code>.</p>
        </div>
      </div>
    </div>

    <fieldset className="onb-choice">
      <legend className="onb-choice__legend">Your choice — you can change it anytime.</legend>
      <label className={`onb-choice__opt ${value === "on" ? "is-selected" : ""}`}>
        <input type="radio" name="affil" checked={value === "on"} onChange={() => onChoose("on")} />
        <div className="onb-choice__copy">
          <div className="onb-choice__title">Sure, keep MUGA going.</div>
          <div className="onb-choice__desc">Adds our tag only to untagged links on supported stores. Existing creator tags are never touched.</div>
        </div>
        <span className="badge badge--accent">Recommended</span>
      </label>
      <label className={`onb-choice__opt ${value === "off" ? "is-selected" : ""}`}>
        <input type="radio" name="affil" checked={value === "off"} onChange={() => onChoose("off")} />
        <div className="onb-choice__copy">
          <div className="onb-choice__title">Just the denoise, thanks.</div>
          <div className="onb-choice__desc">MUGA only cleans links. Never adds anything. Support us via <a href="#">Ko-fi</a> if you'd like.</div>
        </div>
      </label>
    </fieldset>
  </div>
);

const ReadyStep = ({ affil }) => (
  <div className="onb-step">
    <div className="onb-step__glyph onb-step__glyph--ok" aria-hidden="true">
      <Icon name="check" size={36} />
    </div>
    <h1 className="onb-step__title">You're set. The noise is off.</h1>
    <p className="onb-step__lede">
      MUGA is now denoising every link you touch.
      {affil === "on" && " Referral tag: on (only for untagged links on supported stores)."}
      {affil === "off" && " Referral tag: off."}
    </p>
    <div className="onb-ready-grid">
      <div className="onb-ready-card">
        <Icon name="sparkle" size={16} />
        <div className="onb-ready-card__title">Pin the icon</div>
        <div className="onb-ready-card__desc">Puzzle piece → pin MUGA. The count on the icon shows what's been cleaned on this tab.</div>
      </div>
      <div className="onb-ready-card">
        <Icon name="copy" size={16} />
        <div className="onb-ready-card__title">Try the shortcut</div>
        <div className="onb-ready-card__desc"><span className="kbd">⌥⇧C</span> copies the cleaned URL of the current tab.</div>
      </div>
      <div className="onb-ready-card">
        <Icon name="settings" size={16} />
        <div className="onb-ready-card__title">Tune it later</div>
        <div className="onb-ready-card__desc">Right-click the icon → <em>Settings</em>. Every toggle is explained in plain English.</div>
      </div>
    </div>
  </div>
);

// --- Toast ------------------------------------------------------------------

const Toast = ({ visible = true, onDismiss }) => {
  if (!visible) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <div className="toast__icon" aria-hidden="true">
        <Icon name="tag" size={14} />
      </div>
      <div className="toast__body">
        <div className="toast__title">Creator tag detected</div>
        <div className="toast__desc">
          <strong>creator-21</strong> on amazon.es · kept as-is
        </div>
      </div>
      <div className="toast__actions">
        <button className="btn btn--ghost btn--sm">Details</button>
        <button className="btn btn--ghost btn--icon btn--sm" onClick={onDismiss} aria-label="Dismiss">
          <Icon name="x" size={12} />
        </button>
      </div>
    </div>
  );
};

window.Onboarding = Onboarding;
window.Toast = Toast;
