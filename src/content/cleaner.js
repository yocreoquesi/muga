/**
 * MUGA — Content Script
 * Se inyecta en todas las páginas. Intercepta la navegación antes de que
 * ocurra e intercambia mensajes con el service worker para limpiar la URL.
 *
 * Nota: los imports no funcionan en content scripts de MV3.
 * La lógica de limpieza se pasa como mensaje al service worker.
 */

(function () {
  "use strict";

  // Evitar doble ejecución en iframes
  if (window.self !== window.top) return;
  if (window.__mugaActive) return;
  window.__mugaActive = true;

  /**
   * Intercepta clicks en enlaces antes de la navegación.
   * El service worker hace el procesamiento y responde con la URL limpia.
   */
  document.addEventListener("click", async (e) => {
    const anchor = e.target.closest("a[href]");
    if (!anchor) return;

    const href = anchor.href;
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) return;

    // Solo URLs http/https
    let url;
    try {
      url = new URL(href);
    } catch {
      return;
    }
    if (!["http:", "https:"].includes(url.protocol)) return;

    // Si no tiene query string, no hay nada que limpiar
    if (!url.search) return;

    // Respetar Ctrl/Cmd/Shift+click y target="_blank" (abrir en nueva pestaña/ventana)
    const opensNewTab = e.ctrlKey || e.metaKey || e.shiftKey ||
      (anchor.target && anchor.target !== "_self" && anchor.target !== "_top" && anchor.target !== "_parent");

    e.preventDefault();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "PROCESS_URL",
        url: href,
      });

      if (!response || !response.cleanUrl) {
        navigate(href, opensNewTab);
        return;
      }

      const { cleanUrl, action, detectedAffiliate } = response;

      if (action === "detected_foreign" && detectedAffiliate) {
        // Mostrar notificación no intrusiva al usuario
        showAffiliateNotice(detectedAffiliate, href, cleanUrl, (choice) => {
          if (choice === "original") navigate(href, opensNewTab);
          else if (choice === "clean") navigate(cleanUrl, opensNewTab);
          else if (choice === "ours" && response.withOurAffiliate) {
            navigate(response.withOurAffiliate, opensNewTab);
          }
        });
      } else {
        navigate(cleanUrl, opensNewTab);
      }
    } catch {
      navigate(href, opensNewTab);
    }
  }, true);

  /**
   * Navega a la URL indicada, preservando el comportamiento de nueva pestaña.
   */
  function navigate(url, newTab) {
    if (newTab) {
      window.open(url, "_blank");
    } else {
      window.location.href = url;
    }
  }

  /**
   * Muestra un toast no intrusivo cuando se detecta un afiliado ajeno.
   * Se autodestruye en 5 segundos si el usuario no interactúa.
   */
  function showAffiliateNotice(affiliate, originalUrl, cleanUrl, callback) {
    // Eliminar toast previo si existe
    document.getElementById("muga-notice")?.remove();

    const notice = document.createElement("div");
    notice.id = "muga-notice";
    notice.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #1a1a1a;
      color: #f0f0f0;
      border-radius: 10px;
      padding: 12px 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      line-height: 1.5;
      max-width: 300px;
      z-index: 2147483647;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      border: 0.5px solid rgba(255,255,255,0.1);
    `;

    const domain = new URL(originalUrl).hostname.replace("www.", "");

    notice.innerHTML = `
      <div style="font-weight:500;margin-bottom:6px;font-size:12px;color:#aaa">
        MUGA detectó un referido
      </div>
      <div style="margin-bottom:10px;font-size:12px;color:#ddd">
        ${domain} lleva el tag <code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px">${affiliate.param}=${affiliate.value}</code>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button data-choice="original" style="flex:1;padding:5px 8px;border-radius:6px;border:0.5px solid rgba(255,255,255,0.2);background:transparent;color:#f0f0f0;font-size:11px;cursor:pointer">Mantener</button>
        <button data-choice="clean" style="flex:1;padding:5px 8px;border-radius:6px;border:0.5px solid rgba(255,255,255,0.2);background:transparent;color:#f0f0f0;font-size:11px;cursor:pointer">Quitar</button>
      </div>
      <div style="margin-top:6px;font-size:10px;color:#666;text-align:right;cursor:pointer" id="muga-dismiss">Descartar</div>
    `;

    document.body.appendChild(notice);

    // Autodestrucción tras 5 segundos → navega con URL original
    const timer = setTimeout(() => {
      notice.remove();
      callback("original");
    }, 5000);

    notice.querySelectorAll("button[data-choice]").forEach(btn => {
      btn.addEventListener("click", () => {
        clearTimeout(timer);
        notice.remove();
        callback(btn.dataset.choice);
      });
    });

    document.getElementById("muga-dismiss")?.addEventListener("click", () => {
      clearTimeout(timer);
      notice.remove();
      callback("original");
    });
  }
})();
