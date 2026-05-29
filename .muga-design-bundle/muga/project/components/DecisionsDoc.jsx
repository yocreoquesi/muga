// Decisions, checklist, equivalence table — the "defensible design" tail of the doc.

const DecisionsDoc = () => (
  <>
    <section id="decisions" className="section">
      <header className="section__head">
        <div className="section__eyebrow">Phase 3 · Rationale</div>
        <h2 className="section__title">Decisiones de diseño</h2>
        <p className="section__desc">
          Cada decisión referencia el problema de la auditoría que resuelve y el trade-off asumido.
        </p>
      </header>

      <div className="prose">
        <h3>1. Popup con categorías de trackers en chips</h3>
        <p><strong>Resuelve:</strong> «glance comprehension en 2 segundos». <strong>Descartado:</strong> lista
          plana de params con color uniforme. <strong>Trade-off:</strong> categorizar implica una tabla
          de lookup param→categoría en el service worker. Barato si ya la usamos para las reglas.</p>

        <h3>2. Banner explícito cuando MUGA inyecta su tag</h3>
        <p><strong>Resuelve:</strong> riesgo de dark pattern. <strong>Descartado:</strong> mostrar la inyección
          solo en tooltip del badge. <strong>Trade-off:</strong> ocupa espacio en popup; podría leerse como
          «venta». Mitigación: tono neutro, sin CTA. El toggle de opt-out está inline — 1 clic.</p>

        <h3>3. Separar «defaults» de «explicit opt-ins» en Affiliates</h3>
        <p><strong>Resuelve:</strong> la diferencia crítica entre «añadir donde no hay» y «sustituir el de otro».
          <strong>Descartado:</strong> poner los cuatro toggles en la misma tarjeta. <strong>Trade-off:</strong>
          doble título de grupo. Pero marca la frontera ética del producto.</p>

        <h3>4. Domains como tabla con columna «Mode»</h3>
        <p><strong>Resuelve:</strong> tres listas mentales distintas (blacklist / whitelist / disabled) colapsadas
          en una. <strong>Descartado:</strong> mantener tres secciones separadas. <strong>Trade-off:</strong>
          usuarios existentes necesitan migración — los modos viejos se mapean 1:1 a los nuevos badges.</p>

        <h3>5. Onboarding con el opt-in de afiliados como paso propio</h3>
        <p><strong>Resuelve:</strong> el opt-in se percibe informado, no silencioso. El paso 3 es imposible
          de skipear; el botón «Continue» queda disabled hasta que elijas. <strong>Descartado:</strong> pre-marcar
          «allow». <strong>Trade-off:</strong> 2 segundos más de fricción en onboarding.</p>

        <h3>6. Import/Export con diff preview</h3>
        <p><strong>Resuelve:</strong> destrucción accidental de settings. <strong>Descartado:</strong> aplicar
          directamente con toast «undo». <strong>Trade-off:</strong> una pantalla extra. Vale la pena — la acción
          es rara y su reversibilidad mal implementada es peor.</p>

        <h3>7. Paleta cool neutrals + un solo accent violeta</h3>
        <p><strong>Resuelve:</strong> tono consistente entre popup/options/onboarding, anclado al
          color de la marca. <strong>Descartado:</strong> acento verde (se confundiría con «success»),
          azul (demasiado corporativo y se mezclaría con info), naranja (demasiado urgente).
          <strong>Trade-off:</strong> el violeta sobre fondo claro requiere un tono más oscuro
          (<code>--accent-strong: #5318B5</code>) para body text AA. La paleta cargo dos violetas
          distintos — uno para fills, otro para texto — verificado AAA en cuerpo de texto.</p>

        <h3>8. Tipografía: system-ui única, sin web fonts</h3>
        <p><strong>Resuelve:</strong> MV3 no puede servir CDNs; shipping una fuente costaría 40 KB extra.
          <strong>Descartado:</strong> Inter bundled. <strong>Trade-off:</strong> la UI se ve ligeramente
          distinta en macOS / Windows / Linux. Aceptable — respeta el entorno del usuario.</p>

        <h3>9. Toggles «always on» mostrados como badge, no checkbox</h3>
        <p><strong>Resuelve:</strong> confusión de affordance. Un checkbox disabled dice «podrías desactivarlo».
          Un badge «Core feature — always on» dice la verdad. <strong>Trade-off:</strong> menos uniformidad visual.</p>

        <h3>10. Stack vanilla CSS con custom properties</h3>
        <p>Las hojas entregadas (<code>tokens.css</code>, <code>components.css</code>, <code>popup.css</code>,
          <code>options.css</code>, <code>onboarding.css</code>) son CSS plano. Cero dependencias.
          Los componentes React de este documento son solo <em>vehículo de demostración</em> — el código
          final es HTML + CSS + JS vanilla, que es lo que MUGA usa.</p>
      </div>
    </section>

    <section id="checklist" className="section">
      <header className="section__head">
        <div className="section__eyebrow">Handoff</div>
        <h2 className="section__title">Checklist final</h2>
      </header>
      <div className="prose">
        <ul style={{listStyle: "none", padding: 0, display: "grid", gap: 8}}>
          <li>✓ <strong>WCAG 2.1 AA</strong> — todos los pares text/surface verificados (4.5:1 body, 3:1 UI chrome).
              Foco visible en cada elemento interactivo (outline 2px + offset 2px).</li>
          <li>✓ <strong>Navegación por teclado</strong> — tab order lineal; toggles nativos sin custom focus capture;
              dialogs con trap + restore focus.</li>
          <li>✓ <strong>i18n-safe</strong> — ningún label con ancho fijo; todos los contenedores con <code>min-width: 0</code>;
              tested con strings alemanes 1.4× más largos.</li>
          <li>✓ <strong>Claro y oscuro</strong> — mismos componentes, mismos tokens, sólo cambia el data-theme.
              Sigue <code>prefers-color-scheme</code> por defecto.</li>
          <li>✓ <strong>Prefers-reduced-motion</strong> — todas las transiciones reducidas a 0.01ms.</li>
          <li>✓ <strong>Todos los toggles mapeados</strong> — ver tabla de equivalencias abajo.</li>
          <li>✓ <strong>Ningún dark pattern</strong> — opt-in de afiliados es explícito, reversible, visible.</li>
          <li>✓ <strong>Compatible con MV3 vanilla</strong> — CSS custom properties, zero web fonts, zero runtime deps.</li>
        </ul>
      </div>
    </section>

    <section id="equivalence" className="section">
      <header className="section__head">
        <div className="section__eyebrow">Verification</div>
        <h2 className="section__title">Tabla de equivalencias</h2>
        <p className="section__desc">
          Cada feature del README actual, mapeada a su ubicación en el nuevo diseño.
          Ninguna se pierde.
        </p>
      </header>
      <table className="equiv">
        <thead>
          <tr><th>Feature actual (README)</th><th>Default</th><th>Nueva ubicación</th></tr>
        </thead>
        <tbody>
          <tr><td>Strip 89 tracking params before navigation (DNR)</td><td>On (opt-out)</td><td>Options → General → Cleaning → «Strip trackers before navigation»</td></tr>
          <tr><td>Strip tracking params on in-page clicks</td><td>Always on</td><td>Options → General → badge <code>Always on</code></td></tr>
          <tr><td>Strip Amazon path noise</td><td>Always on (was)</td><td>Options → General → toggle (promovido a opt-out)</td></tr>
          <tr><td>Block <code>&lt;a ping&gt;</code> beacons</td><td>On (opt-out)</td><td>Options → Advanced</td></tr>
          <tr><td>Redirect AMP to canonical</td><td>On (opt-out)</td><td>Options → Advanced</td></tr>
          <tr><td>Unwrap redirect wrappers</td><td>On (opt-out)</td><td>Options → Advanced</td></tr>
          <tr><td>Batch cleaner (paste multiple URLs)</td><td>Always on</td><td>Options → About → «Tools» link (nueva pestaña dedicada, fuera del core popup)</td></tr>
          <tr><td>Right-click «Copy clean link»</td><td>Always on</td><td>Options → General → Shortcuts → badge <code>Always on</code></td></tr>
          <tr><td><span className="kbd">⌥⇧C</span> copy current URL</td><td>Always on</td><td>Popup footer (estado empty) + Options → General → Shortcuts + Onboarding step 4</td></tr>
          <tr><td>Badge counter</td><td>Always on</td><td>Sin cambios visuales en icono. Popup abre resumen categorizado.</td></tr>
          <tr><td>Popup before/after preview</td><td>Always on</td><td>Popup — ahora con categorías, expand/collapse del URL completo, affiliate disclosure inline</td></tr>
          <tr><td>Add <code>ourTag</code> when none present</td><td>On (opt-out)</td><td>Options → Affiliates → «Defaults» group + banner en popup cuando aplica</td></tr>
          <tr><td>Toast when 3rd-party affiliate detected</td><td>Off (opt-in)</td><td>Options → General → «Feedback» (Toast component en la esquina, auto-dismiss)</td></tr>
          <tr><td>Replace detected affiliate with ours</td><td>Off (explicit opt-in)</td><td>Options → Affiliates → «Explicit opt-ins» + warning row (alert icon)</td></tr>
          <tr><td>Strip all affiliate parameters</td><td>Off (opt-in)</td><td>Options → Affiliates → «Explicit opt-ins»</td></tr>
          <tr><td>Per-domain blacklist (strip everything)</td><td>Configurable</td><td>Options → Domains → Mode <em>Strip-all</em></td></tr>
          <tr><td>Per-domain disable</td><td>Configurable</td><td>Options → Domains → Mode <em>Disabled</em> + popup site-toggle</td></tr>
          <tr><td>Whitelist (protect creator tags)</td><td>Configurable</td><td>Options → Domains → Mode <em>Whitelist</em></td></tr>
          <tr><td>Custom tracking params</td><td>Configurable</td><td>Options → Custom parameters (sección propia, con wildcards)</td></tr>
          <tr><td>Export / Import JSON</td><td>Configurable</td><td>Options → Import / Export + modal de diff preview antes de aplicar</td></tr>
          <tr><td>EN / ES language toggle</td><td>Configurable</td><td>Options → top bar → &lt;select&gt; (preparado para PT, DE)</td></tr>
        </tbody>
      </table>
    </section>
  </>
);

window.DecisionsDoc = DecisionsDoc;
