/**
 * MUGA — the onboarding CTA does not claim to switch MUGA on (#1406).
 *
 * MUGA cleans URLs from the moment it is installed (ob_tos_note says so,
 * and onboarding.js calls the button a "close this notice" action). A CTA
 * reading "Activate MUGA", followed by "MUGA is now active", told users the
 * opposite: that nothing was protected until they clicked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, "../../src/onboarding/onboarding.html"), "utf8");

const RETIRED = {
  ob_cta_btn: ["Activate MUGA", "Activar MUGA", "Ativar MUGA", "MUGA aktivieren", "Activer MUGA", "Attiva MUGA", "MUGAを有効にする"],
  ob_success_msg: [
    "MUGA is now active. You can close this tab.",
    "MUGA ya está activo. Puedes cerrar esta pestaña.",
    "O MUGA já está ativo. Você pode fechar esta aba.",
    "MUGA ist jetzt aktiv. Du kannst diesen Tab schließen.",
    "MUGA est maintenant actif. Vous pouvez fermer cet onglet.",
    "MUGA è ora attivo. Puoi chiudere questa scheda.",
    "MUGAが有効になりました。このタブを閉じることができます。",
  ],
};

for (const { code } of SUPPORTED_LANGS) {
  test(`${code}: the CTA and success message do not imply the click activated MUGA`, () => {
    for (const [key, old] of Object.entries(RETIRED)) {
      const value = TRANSLATIONS[key][code];
      assert.ok(value && !old.includes(value), `${key}.${code} still says: ${value}`);
    }
  });
}

test("en: the success message says MUGA is cleaning, and the HTML fallback matches the new CTA", () => {
  assert.match(TRANSLATIONS.ob_success_msg.en, /cleaning/i);
  assert.ok(html.includes(`data-i18n="ob_cta_btn">${TRANSLATIONS.ob_cta_btn.en}</button>`));
});
