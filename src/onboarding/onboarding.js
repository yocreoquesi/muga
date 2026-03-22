/**
 * MUGA — Onboarding page
 *
 * Two checkboxes:
 *   - ToS acceptance (mandatory — button stays disabled until checked)
 *   - Affiliate opt-in (optional — activates injectOwnAffiliate if checked)
 *
 * On "Get started": saves consent metadata + prefs, then closes the tab.
 *
 * i18n: inline dictionary (same approach as content/cleaner.js).
 * Cannot import from lib/i18n.js because this script runs as a classic script.
 */

const CONSENT_VERSION = "1.0";

// ---------------------------------------------------------------------------
// i18n — Onboarding strings (EN / ES)
// ---------------------------------------------------------------------------
const OB_STRINGS = {
  ob_page_title:            { en: "Welcome to MUGA",                                                         es: "Bienvenido a MUGA" },
  ob_tagline:               { en: "Make URLs Great Again.",                                                   es: "Haz que las URLs vuelvan a ser geniales." },
  ob_tagline_sub:           { en: "Here's exactly what this extension does — and what it never will.",        es: "Esto es exactamente lo que hace esta extensión — y lo que nunca hará." },
  ob_tagline_local:         { en: "Everything runs locally in your browser. No data is sent to any server.",  es: "Todo se ejecuta en tu navegador. No se envía ningún dato a ningún servidor." },

  ob_step1_title:           { en: "Always on — no configuration needed",                                      es: "Siempre activo — sin configuración" },
  ob_feat1_title:           { en: "Strips 130+ tracking parameters automatically",                            es: "Elimina más de 130 parámetros de rastreo automáticamente" },
  ob_feat1_desc:            { en: "UTMs, fbclid, gclid, msclkid, mc_cid, si (YouTube), eBay tracking tags, and more — removed before the page loads.", es: "UTMs, fbclid, gclid, msclkid, mc_cid, si (YouTube), tags de rastreo de eBay y más — eliminados antes de que cargue la página." },
  ob_feat2_title:           { en: "Redirects Google AMP pages to the real article",                            es: "Redirige páginas AMP de Google al artículo real" },
  ob_feat2_desc:            { en: "AMP URLs are silently redirected to the canonical article so you always land on the actual site.", es: "Las URLs AMP se redirigen silenciosamente al artículo original para que siempre llegues al sitio real." },
  ob_feat3_title:           { en: "Blocks <a ping> tracking beacons",                                         es: "Bloquea balizas de rastreo <a ping>" },
  ob_feat3_desc:            { en: "Prevents the hidden ping requests advertisers use to log every link you click.", es: "Impide las peticiones ocultas que los anunciantes usan para registrar cada enlace que pulsas." },
  ob_feat4_title:           { en: "Unwraps redirect-wrapper URLs",                                            es: "Desenvuelve URLs con redireccionadores" },
  ob_feat4_desc:            { en: "Extracts the real destination from tracking wrappers so you go straight to the target page.", es: "Extrae el destino real de los redireccionadores para que vayas directamente a la página de destino." },
  ob_feat5_title:           { en: "Right-click → Copy clean link",                                            es: "Clic derecho → Copiar enlace limpio" },
  ob_feat5_desc:            { en: "Copies the cleaned URL to your clipboard without navigating anywhere.",     es: "Copia la URL limpia al portapapeles sin navegar a ningún sitio." },

  ob_step2_title:           { en: "How MUGA stays free — your choice",                                        es: "Cómo MUGA se mantiene gratis — tú decides" },
  ob_affiliate_desc:        { en: 'When you visit a supported store (Amazon, Booking.com, AliExpress\u2026) and the link has <strong>no affiliate tag at all</strong>, MUGA can silently add ours. <strong>The price you pay is always identical</strong> \u2014 affiliate tags don\u2019t affect what you pay, they tell the store who referred you. We earn a small commission.<br><br>This is how we keep MUGA free and actively maintained.', es: 'Cuando visitas una tienda compatible (Amazon, Booking.com, AliExpress\u2026) y el enlace <strong>no tiene ningún tag de afiliado</strong>, MUGA puede añadir el nuestro silenciosamente. <strong>El precio que pagas es siempre el mismo</strong> \u2014 los tags de afiliado no afectan lo que pagas, solo indican a la tienda quién te refirió. Nosotros ganamos una pequeña comisión.<br><br>Así es como mantenemos MUGA gratis y en desarrollo activo.' },
  ob_disclaimer:            { en: '<strong>What MUGA never does:</strong> replace or overwrite a tag that is already in a link. If a creator\u2019s or another affiliate\u2019s tag is there, MUGA leaves it alone. This is the exact opposite of what <a href="https://en.wikipedia.org/wiki/Honey_(browser_extension)" target="_blank">Honey did</a>. MUGA only acts on links that have <em>no tag at all</em>. The source code is public \u2014 you can verify this yourself.', es: '<strong>Lo que MUGA nunca hace:</strong> reemplazar o sobreescribir un tag que ya existe en un enlace. Si el tag de un creador u otro afiliado ya está ahí, MUGA lo deja intacto. Esto es exactamente lo opuesto a lo que <a href="https://en.wikipedia.org/wiki/Honey_(browser_extension)" target="_blank">hizo Honey</a>. MUGA solo actúa en enlaces que <em>no tienen ningún tag</em>. El código fuente es público \u2014 puedes comprobarlo tú mismo.' },
  ob_affiliate_check_label: { en: "Yes, support MUGA for free — allow our affiliate tag on links that have none", es: "Sí, apoya a MUGA gratis — permitir nuestro tag de afiliado en enlaces sin ninguno" },
  ob_affiliate_check_hint:  { en: "You always pay the same price. You can disable this in Settings at any time.", es: "Siempre pagas el mismo precio. Puedes desactivarlo en Ajustes en cualquier momento." },

  ob_tos_label:             { en: 'I have read and accept the <a href="../privacy/tos.html" target="_blank">Terms of use</a> and <a href="../privacy/privacy.html" target="_blank">Privacy policy</a><small style="display:block;color:var(--text2);margin-top:3px">Required to continue</small>', es: 'He leído y acepto los <a href="../privacy/tos.html" target="_blank">Términos de uso</a> y la <a href="../privacy/privacy.html" target="_blank">Política de privacidad</a><small style="display:block;color:var(--text2);margin-top:3px">Obligatorio para continuar</small>' },

  ob_cta_btn:               { en: "Get started →",                                                            es: "Empezar →" },
  ob_cta_note:              { en: "You can change all of this later in Settings at any time.",                 es: "Puedes cambiar todo esto más tarde en Ajustes en cualquier momento." },
};

// Keys whose values contain safe HTML (<strong>, <a>, <br>, <em>, <small>).
const OB_HTML_KEYS = new Set([
  "ob_affiliate_desc", "ob_disclaimer", "ob_tos_label",
]);

/**
 * Detects the user's preferred language (storage override → browser default).
 * Returns "es" or "en".
 */
function detectLang(callback) {
  const browserLang = (navigator.language || "en").startsWith("es") ? "es" : "en";
  try {
    chrome.storage.sync.get({ language: null }, (r) => {
      callback(r.language ?? browserLang);
    });
  } catch (_) {
    // chrome.storage may not be available in testing environments
    callback(browserLang);
  }
}

/**
 * Applies onboarding translations to all [data-i18n] and [data-i18n-html]
 * elements, plus updates <html lang> and <title>.
 */
function applyOnboardingI18n(lang) {
  // Update <html lang="">
  document.documentElement.lang = lang;

  // [data-i18n] → textContent
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const entry = OB_STRINGS[key];
    if (!entry) return;
    const value = entry[lang] ?? entry["en"] ?? key;
    if (el.tagName === "TITLE") {
      document.title = value;
    } else {
      el.textContent = value;
    }
  });

  // [data-i18n-html] → innerHTML (only for known safe keys)
  document.querySelectorAll("[data-i18n-html]").forEach(el => {
    const key = el.getAttribute("data-i18n-html");
    const entry = OB_STRINGS[key];
    if (!entry) return;
    const value = entry[lang] ?? entry["en"] ?? key;
    if (OB_HTML_KEYS.has(key)) {
      el.innerHTML = value;
    } else {
      el.textContent = value;
    }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const tosCheck       = document.getElementById("tos-check");
  const affiliateCheck = document.getElementById("affiliate-check");
  const startBtn       = document.getElementById("start-btn");

  // Apply translations as soon as the language is resolved
  detectLang(applyOnboardingI18n);

  function updateButton() {
    startBtn.disabled = !tosCheck.checked;
  }

  tosCheck.addEventListener("change", updateButton);

  startBtn.addEventListener("click", async () => {
    if (!tosCheck.checked) return;

    await chrome.storage.sync.set({
      onboardingDone:        true,
      consentVersion:        CONSENT_VERSION,
      consentDate:           Date.now(),
      injectOwnAffiliate:    affiliateCheck.checked,
      notifyForeignAffiliate: false,
    });

    window.close();
  });
});
