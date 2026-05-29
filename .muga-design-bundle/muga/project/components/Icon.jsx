// Icon set — hand-drawn line icons, stroke-based, 16x16 canvas.
// Kept minimal: only what MUGA's surfaces actually use.

const Icon = ({ name, size = 16, className = "" }) => {
  const paths = {
    check: <polyline points="3.5,8.5 6.5,11.5 12.5,5" />,
    x: <g><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></g>,
    copy: <g><rect x="5" y="5" width="8" height="9" rx="1.5" /><path d="M3 11 V4 a1 1 0 0 1 1-1 h7" /></g>,
    link: <g><path d="M9.5 6.5 a2.5 2.5 0 0 1 3.5 0 l0 0 a2.5 2.5 0 0 1 0 3.5 l-2 2" /><path d="M6.5 9.5 a2.5 2.5 0 0 0 -3.5 0 l0 0 a2.5 2.5 0 0 0 0 3.5 l0 0 a2.5 2.5 0 0 0 3.5 0 l2-2" /><line x1="6.5" y1="9.5" x2="9.5" y2="6.5"/></g>,
    shield: <path d="M8 1.5 L2 3.5 V8 c0 3 2.5 5.5 6 6.5 c3.5-1 6-3.5 6-6.5 V3.5 Z" />,
    shieldCheck: <g><path d="M8 1.5 L2 3.5 V8 c0 3 2.5 5.5 6 6.5 c3.5-1 6-3.5 6-6.5 V3.5 Z" /><polyline points="5,8 7,10 11,6" /></g>,
    eye: <g><path d="M1.5 8 s2.5-4.5 6.5-4.5 S14.5 8 14.5 8 s-2.5 4.5-6.5 4.5 S1.5 8 1.5 8 Z" /><circle cx="8" cy="8" r="2" /></g>,
    eyeOff: <g><path d="M3 3 l10 10" /><path d="M2 8 s2.5-4.5 6.5-4.5 c1 0 2 .3 2.8.7" /><path d="M14 8 s-2.5 4.5-6.5 4.5 c-1 0-2-.3-2.8-.7" /></g>,
    filter: <path d="M2.5 3.5 h11 l-4 5 v4 l-3 1.5 v-5.5 Z" />,
    chevRight: <polyline points="6,3.5 10.5,8 6,12.5" />,
    chevDown: <polyline points="3.5,6 8,10.5 12.5,6" />,
    chevUp: <polyline points="3.5,10 8,5.5 12.5,10" />,
    arrowRight: <g><line x1="2.5" y1="8" x2="13" y2="8" /><polyline points="9,4 13,8 9,12" /></g>,
    arrowDown: <g><line x1="8" y1="2.5" x2="8" y2="13" /><polyline points="4,9 8,13 12,9" /></g>,
    plus: <g><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></g>,
    minus: <line x1="3" y1="8" x2="13" y2="8" />,
    trash: <g><polyline points="2.5,4 13.5,4" /><path d="M4 4 v9 a1 1 0 0 0 1 1 h6 a1 1 0 0 0 1-1 V4" /><path d="M6 4 V2.5 a1 1 0 0 1 1-1 h2 a1 1 0 0 1 1 1 V4" /></g>,
    edit: <g><path d="M11 2.5 l2.5 2.5 L6 12.5 l-3 .5 l.5-3 Z" /></g>,
    search: <g><circle cx="7" cy="7" r="4.5" /><line x1="10.5" y1="10.5" x2="13.5" y2="13.5" /></g>,
    settings: <g><circle cx="8" cy="8" r="2" /><path d="M8 1.5 v2 M8 12.5 v2 M1.5 8 h2 M12.5 8 h2 M3.5 3.5 l1.5 1.5 M11 11 l1.5 1.5 M3.5 12.5 l1.5-1.5 M11 5 l1.5-1.5" /></g>,
    globe: <g><circle cx="8" cy="8" r="6.5" /><path d="M1.5 8 h13 M8 1.5 c2 2 3 4.5 3 6.5 s-1 4.5-3 6.5 M8 1.5 c-2 2-3 4.5-3 6.5 s1 4.5 3 6.5" /></g>,
    info: <g><circle cx="8" cy="8" r="6.5" /><line x1="8" y1="7" x2="8" y2="11.5" /><circle cx="8" cy="4.5" r="0.5" fill="currentColor" stroke="none" /></g>,
    alert: <g><path d="M8 1.5 L14.5 13.5 H1.5 Z" /><line x1="8" y1="6" x2="8" y2="9.5" /><circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" /></g>,
    tag: <g><path d="M8.5 1.5 H13.5 V6.5 L7 13 a1.4 1.4 0 0 1-2 0 L2 10 a1.4 1.4 0 0 1 0-2 Z" /><circle cx="10.5" cy="4.5" r="0.8" fill="currentColor" stroke="none" /></g>,
    store: <g><path d="M2.5 6 H13.5 V13.5 H2.5 Z" /><path d="M2.5 6 L3.5 2.5 H12.5 L13.5 6" /><line x1="2.5" y1="6" x2="13.5" y2="6" /></g>,
    cart: <g><polyline points="1.5,2.5 3,2.5 4.5,10 12,10 13.5,4.5 4,4.5" /><circle cx="5.5" cy="12.5" r="1" /><circle cx="11" cy="12.5" r="1" /></g>,
    video: <g><rect x="1.5" y="3.5" width="9" height="9" rx="1" /><polygon points="10.5,6 14.5,4 14.5,12 10.5,10" /></g>,
    social: <g><circle cx="4" cy="4" r="1.5" /><circle cx="12" cy="4" r="1.5" /><circle cx="8" cy="12" r="1.5" /><line x1="5.2" y1="5.2" x2="6.8" y2="10.8" /><line x1="10.8" y1="5.2" x2="9.2" y2="10.8" /></g>,
    mail: <g><rect x="1.5" y="3.5" width="13" height="9" rx="1" /><polyline points="1.5,4.5 8,9 14.5,4.5" /></g>,
    code: <g><polyline points="5,4.5 1.5,8 5,11.5" /><polyline points="11,4.5 14.5,8 11,11.5" /><line x1="9" y1="3" x2="7" y2="13" /></g>,
    download: <g><polyline points="4,8 8,12 12,8" /><line x1="8" y1="2" x2="8" y2="12" /><line x1="2.5" y1="14" x2="13.5" y2="14" /></g>,
    upload: <g><polyline points="4,6 8,2 12,6" /><line x1="8" y1="2" x2="8" y2="12" /><line x1="2.5" y1="14" x2="13.5" y2="14" /></g>,
    sun: <g><circle cx="8" cy="8" r="3" /><path d="M8 1.5 v1.5 M8 13 v1.5 M1.5 8 h1.5 M13 8 h1.5 M3.5 3.5 l1 1 M11.5 11.5 l1 1 M3.5 12.5 l1-1 M11.5 4.5 l1-1" /></g>,
    moon: <path d="M13.5 10 a5.5 5.5 0 0 1-7.5-7.5 a6 6 0 1 0 7.5 7.5 Z" />,
    // MUGA brand mark — purple M-arrow at 16x16 (legacy fallback for the Icon system).
    // For brand use, prefer <BrandMark height={N} /> below — it uses the proper 104x68 viewBox.
    moth: <g strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 1.8 13 C 1.8 1.8, 7.2 1.8, 8 11" />
      <path d="M 9.4 5 L 11 11.6 L 12.8 11.6" />
      <path d="M 12.2 9.5 L 14.8 11.6 L 12.2 13.7 Z" fill="currentColor" strokeWidth="0.5" />
    </g>,
    muga: <g strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 1.8 13 C 1.8 1.8, 7.2 1.8, 8 11" />
      <path d="M 9.4 5 L 11 11.6 L 12.8 11.6" />
      <path d="M 12.2 9.5 L 14.8 11.6 L 12.2 13.7 Z" fill="currentColor" strokeWidth="0.5" />
    </g>,
    clean: <g><path d="M3 13.5 L3 9 L8 4 L11.5 7.5 L6.5 12.5 Z" /><line x1="8" y1="4" x2="11" y2="1" /><line x1="11.5" y1="7.5" x2="14.5" y2="4.5" /></g>,
    sparkle: <g><path d="M8 2 l1.2 3.8 L13 7 l-3.8 1.2 L8 12 l-1.2-3.8 L3 7 l3.8-1.2 Z" /></g>,
    slash: <line x1="3" y1="13" x2="13" y2="3" />,
  };

  return (
    <svg viewBox="0 0 16 16" width={size} height={size}
         className={`icon ${className}`}
         fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
};

// Brand mark — wider aspect ratio (≈13:8.5) so the M-arrow reads correctly at any size.
// Use this instead of <Icon name="moth"> wherever the logo appears as a brand element.
const BrandMark = ({ height = 24, className = "", title }) => {
  const w = Math.round(height * (104 / 68));
  return (
    <svg viewBox="0 0 104 68"
         width={w} height={height}
         className={`brand-mark ${className}`}
         fill="none"
         role={title ? "img" : "presentation"}
         aria-label={title || undefined}
         aria-hidden={title ? undefined : true}
         focusable="false">
      {/* M body + horizontal shaft */}
      <path
        d="M 12 56 C 12 8, 46 8, 52 46 L 62 22 L 72 50 L 84 50"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none" />
      {/* Filled triangle arrow head */}
      <path
        d="M 80 37 L 98 50 L 80 63 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round" />
    </svg>
  );
};

window.Icon = Icon;
window.BrandMark = BrandMark;
