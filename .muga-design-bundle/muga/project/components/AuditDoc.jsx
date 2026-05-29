// Audit doc content — Phase 1, Phase 2, decisions, checklist.
// Rendered as long-form HTML sections inside the shell.

const AuditDoc = () => (
  <>
    {/* PHASE 1 */}
    <section id="audit" className="section">
      <header className="section__head">
        <div className="section__eyebrow">Phase 1</div>
        <h2 className="section__title">Auditoría</h2>
        <p className="section__desc">
          Basado en el README oficial, capturas en <code>docs/assets/</code>, la privacy page pública
          y el comportamiento descrito de la extensión. Las inspecciones directas al markup de
          <code>src/popup/</code>, <code>src/options/</code> y <code>src/onboarding/</code> están
          marcadas como supuestos en la Fase 2 cuando no pude verificarlas.
        </p>
      </header>

      <div className="prose">
        <h3>Inventario de superficies</h3>
        <p>Seis superficies identificadas a partir del README y las capturas públicas:</p>
        <ul>
          <li><strong>Popup</strong> (~360–420&nbsp;px) — resumen before/after de la pestaña activa.</li>
          <li><strong>Options</strong> — página completa con todos los toggles, dominios, parámetros custom, import/export, idioma.</li>
          <li><strong>Onboarding</strong> — pantallas post-instalación que introducen el modelo de afiliados.</li>
          <li><strong>Badge counter</strong> — contador numérico en el icono de la toolbar.</li>
          <li><strong>Menú contextual</strong> — «Copy clean link» + shortcut <span className="kbd">⌥⇧C</span>.</li>
          <li><strong>Toast de afiliado detectado</strong> — opt-in, off por defecto (según el README).</li>
        </ul>

        <h3>Qué funciona y hay que preservar</h3>
        <ul>
          <li><strong>Zero-config por defecto.</strong> La propuesta de valor es «zero clicks, zero configuration» — eso debe
              seguir siendo cierto después del rediseño. El popup puede enriquecerse pero nunca exigir interacción.</li>
          <li><strong>Estructura del README («What it does»).</strong> La tabla de features con «On / Always on / Off»
              es ya una forma honesta de comunicar el modelo. Recuperamos esa jerarquía en Affiliates.</li>
          <li><strong>El shortcut <span className="kbd">⌥⇧C</span>.</strong> Los power users lo adoptarán;
              hay que hacerlo más descubrible, no esconderlo.</li>
          <li><strong>Separar «always on» de «configurable».</strong> Es una buena política — el core del producto
              (cleaning) no admite sabotaje accidental. Mantenemos esa distinción con badge explícito.</li>
          <li><strong>Privacy-first tone.</strong> «Zero telemetry, zero analytics» es un mensaje honesto y escaso
              en el mercado. No lo diluimos con tracking interno del propio rediseño.</li>
        </ul>

        <h3>Problemas encontrados</h3>
        <p>Tabla priorizada. Severidades: <span className="sev-crit">crítico</span>{" "}
          <span className="sev-high">alto</span> <span className="sev-med">medio</span> <span className="sev-low">bajo</span>.</p>
      </div>

      <table className="findings" style={{marginTop: 20}}>
        <thead>
          <tr>
            <th>Problema</th>
            <th className="sev">Severidad</th>
            <th className="cat">Categoría</th>
            <th className="area">Superficie</th>
            <th>Recomendación</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>«ourTag» se describe como «invisible, not shown as URL noise».</strong> El popup actual no muestra cuándo MUGA añade su propio tag, incluso con el tag ya en la URL. Falta disclosure en tiempo real.</td>
            <td className="sev"><span className="sev-crit">Crítico</span></td>
            <td className="cat">Dark pattern risk</td>
            <td className="area">Popup</td>
            <td>Mostrar banner explícito en popup cuando se ha inyectado <code>ourTag</code>, con toggle de opt-out inline.</td>
          </tr>
          <tr>
            <td><strong>La diferencia entre «añadir nuestro tag» y «sustituir el de otro» es semántica y crítica</strong> — pero los toggles se presentan al mismo nivel en «What it does».</td>
            <td className="sev"><span className="sev-crit">Crítico</span></td>
            <td className="cat">Jerarquía</td>
            <td className="area">Options · Onboarding</td>
            <td>Separar visualmente: «Defaults» (opt-out) vs «Explicit opt-ins» (requieren aceptación consciente). Onboarding hace el opt-in explícito, no silencioso.</td>
          </tr>
          <tr>
            <td><strong>Los «105 unit tests» del README no hablan del usuario.</strong> La comunicación es de ingeniero-a-ingeniero, alienante para un usuario que instala desde una store.</td>
            <td className="sev"><span className="sev-high">Alto</span></td>
            <td className="cat">Copy / tono</td>
            <td className="area">README · About</td>
            <td>Mover badges técnicos a una sección «For developers». Primera pantalla: qué es, qué hace, qué no toca.</td>
          </tr>
          <tr>
            <td><strong>El popup actual es «before/after preview»</strong> (según README). No está claro si los parámetros eliminados están categorizados o todos en bloque.</td>
            <td className="sev"><span className="sev-high">Alto</span></td>
            <td className="cat">Glance comprehension</td>
            <td className="area">Popup</td>
            <td>Categorías como chips en la parte superior — UTMs / click IDs / affiliate / ecom. 2 segundos para entender qué se limpió.</td>
          </tr>
          <tr>
            <td><strong>«EN / ES language toggle»</strong> — solo dos idiomas, pero el brief menciona PT y DE. Hay disparidad entre el README y la ambición multilingüe.</td>
            <td className="sev"><span className="sev-high">Alto</span></td>
            <td className="cat">i18n</td>
            <td className="area">Global</td>
            <td>Layouts con <code>min-width: 0</code> en labels, truncado con tooltip; testear strings en alemán antes de liberar.</td>
          </tr>
          <tr>
            <td><strong>Los blacklist / whitelist / «domain::disabled» son tres conceptos distintos que probablemente se gestionan en una sola lista plana</strong> en el Options actual.</td>
            <td className="sev"><span className="sev-high">Alto</span></td>
            <td className="cat">Modelos mentales</td>
            <td className="area">Options → Domains</td>
            <td>Una tabla con columna «Mode»: Default / Disabled / Whitelist / Strip-all / No affiliate. Filtros por modo. Badge colorido.</td>
          </tr>
          <tr>
            <td><strong>Import/Export JSON se describe como acción directa.</strong> Sin preview, un JSON corrupto puede dejar al usuario sin saber qué cambió.</td>
            <td className="sev"><span className="sev-high">Alto</span></td>
            <td className="cat">Estados ausentes</td>
            <td className="area">Options → IO</td>
            <td>Modal con diff (add / remove / change / unchanged) antes de aplicar. Acción reversible con snapshot automático.</td>
          </tr>
          <tr>
            <td><strong>El toast de afiliado detectado es opt-in off-by-default.</strong> Buena decisión por defecto — pero significa que el usuario típico nunca sabrá cuándo un link ya tenía un tag.</td>
            <td className="sev"><span className="sev-med">Medio</span></td>
            <td className="cat">Transparencia</td>
            <td className="area">Popup · Toast</td>
            <td>Popup muestra badge discreto «3rd-party tag kept» cuando aplica. Toast sigue opt-in — pero el popup siempre dice la verdad.</td>
          </tr>
          <tr>
            <td><strong>«Alt+Shift+C» no es descubrible</strong> — solo aparece mencionado en el README, no en la UI.</td>
            <td className="sev"><span className="sev-med">Medio</span></td>
            <td className="cat">Descubribilidad</td>
            <td className="area">Popup · Onboarding</td>
            <td>Footer del popup muestra <span className="kbd">⌥⇧C</span> cuando no hay nada que mostrar; onboarding lo presenta en step 4.</td>
          </tr>
          <tr>
            <td><strong>Custom parameters sin validación de wildcards</strong> — el usuario puede añadir <code>mc_*</code> sin que la UI confirme que el wildcard está soportado.</td>
            <td className="sev"><span className="sev-med">Medio</span></td>
            <td className="cat">Estados ausentes</td>
            <td className="area">Options → Params</td>
            <td>Input con hint <em>«Use * as wildcard (e.g. mc_*)»</em>. Validación en blur: muestra ejemplo de URL que matchea/no matchea.</td>
          </tr>
          <tr>
            <td><strong>Badge counter en la toolbar</strong> — número aislado, sin contexto. Un «7» no tiene significado para un usuario que abre el navegador y no recuerda qué página tiene abierta.</td>
            <td className="sev"><span className="sev-med">Medio</span></td>
            <td className="cat">Affordance</td>
            <td className="area">Badge</td>
            <td>Mantener el número, pero el popup debe abrir inmediatamente el resumen categorizado — no más «qué querrá decir ese 7».</td>
          </tr>
          <tr>
            <td><strong>Readme y privacy page tienen tonos divergentes</strong> («Mercilessly Undoing Garbage Attachments» vs «Fair to every click»).</td>
            <td className="sev"><span className="sev-low">Bajo</span></td>
            <td className="cat">Consistencia</td>
            <td className="area">Brand</td>
            <td>Elegir un tono — sugiero el de la privacy page («Fair to every click»). Dejar los acrónimos como easter egg en el About.</td>
          </tr>
          <tr>
            <td><strong>La license badge dice MIT, pero el brief afirma GPL v3.</strong></td>
            <td className="sev"><span className="sev-low">Bajo</span></td>
            <td className="cat">Consistencia</td>
            <td className="area">README · About</td>
            <td>Aclarar con el mantenedor cuál es la correcta. Reflejar una sola versión en About.</td>
          </tr>
        </tbody>
      </table>

      <div className="prose" style={{marginTop: 28}}>
        <h3>Comparativa con referentes</h3>
        <p>
          <strong>uBlock Origin</strong> expone un popup denso con métricas, listas de reglas y modo avanzado.
          Funciona porque su audiencia es técnica. MUGA no debería heredar esa densidad: su audiencia se parece
          más a la de <strong>Privacy Badger</strong>, que apuesta por explicar cada decisión con lenguaje humano.
        </p>
        <p>
          <strong>ClearURLs</strong> es el benchmark funcional directo — mismos problemas (UTMs, tokens, redirects).
          Su popup es fundamentalmente un contador de limpieza y un on/off. MUGA se diferencia porque
          <em>añade algo</em> (afiliado). Esa diferencia obliga a una UI más transparente, no más oculta.
        </p>
        <p>
          <strong>LibRedirect</strong> muestra bien cómo presentar «per-domain overrides» con badges de estado
          legibles. Lo tomamos prestado en la pantalla Domains.
        </p>

        <h3>Riesgos de rediseño</h3>
        <ul>
          <li><strong>Romper el hábito del contador-en-toolbar</strong> si cambiamos cómo se renderiza el badge. No se toca.</li>
          <li><strong>Sobre-comunicar el afiliado</strong> hasta el punto de generar fatiga. Mitigación: el banner del popup
              solo aparece cuando la inyección <em>ha ocurrido</em>, no cuando <em>podría</em>.</li>
          <li><strong>Usuarios que ya configuraron blacklist/whitelist</strong> encontrarán la tabla unificada confusa
              al principio. Mitigación: migración silenciosa, un pase de onboarding para usuarios existentes en 1.3.1.</li>
        </ul>
      </div>
    </section>

    {/* PHASE 2 */}
    <section id="critique" className="section">
      <header className="section__head">
        <div className="section__eyebrow">Phase 2</div>
        <h2 className="section__title">Revisión de la auditoría (autocrítica)</h2>
        <p className="section__desc">
          Antes de diseñar, filtrar ruido. Lo que sobrevive a esta sección es lo que pasa a Fase 3.
        </p>
      </header>

      <div className="prose">
        <h4>Suposiciones sin evidencia directa</h4>
        <ul>
          <li><strong>No tengo acceso al markup real de <code>src/popup/</code>.</strong> Mis afirmaciones sobre densidad,
              orden de elementos y estados ausentes se basan en las capturas y descripciones del README. Asumí que el popup
              no categoriza los parámetros eliminados — podría estar equivocado. <em>Pregunta abierta.</em></li>
          <li>«Import/Export no tiene preview» — inferido del README, no confirmado en código.</li>
          <li>«Custom params sin validación de wildcards» — inferido. El código puede ya validar; la UI podría
              no estar reflejándolo.</li>
          <li>La tabla de «EN/ES» del README podría estar desactualizada. v1.3.x puede ya incluir PT/DE sin que el README
              lo diga.</li>
        </ul>

        <h4>Cosas que clasifiqué como críticas que quizá son preferencia personal</h4>
        <ul>
          <li>«Mostrar banner cuando <code>ourTag</code> se inyecta» — honestamente transparente, pero
              hay un argumento razonable para mantenerlo silencioso siempre que esté documentado. No es
              ilegal ni dark pattern <em>per se</em>; lo que lo convertiría en dark pattern es esconderlo en settings.
              Reclasifico a <strong>alto</strong>, no crítico. Sigo recomendando mostrarlo por defecto.</li>
          <li>La jerarquía visual entre «defaults» y «opt-ins explícitos» en Options: sigue siendo crítico — ese
              toggle de «replace others’ tags» sí debe tener fricción.</li>
        </ul>

        <h4>Lo que probablemente me estoy perdiendo</h4>
        <ul>
          <li><strong>Sin analytics, no sé qué toggles usa la gente.</strong> Mi instinto es que custom params lo usan
              {"<"}5% pero podría estar fuera. Mitigación: el diseño no penaliza a ese 5% — siguen teniendo una UI
              clara, solo que detrás de una entrada de nav menos prominente.</li>
          <li><strong>No sé si hay usuarios con 50+ dominios configurados.</strong> Asumí que &lt;10 es lo común. Si
              la tabla necesita virtualización, la solución actual (simple table) no escala.</li>
        </ul>

        <h4>Preguntas abiertas para el mantenedor</h4>
        <ul>
          <li>¿Qué fracción de instalaciones acepta el afiliado en onboarding? ¿Justifica la sostenibilidad del proyecto?</li>
          <li>¿Hay razones técnicas para no mostrar la categoría de cada parámetro eliminado?
              (Lookup table costosa en service worker? Sería refactor, no diseño.)</li>
          <li>¿El badge counter incluye también los parámetros afiliados sustituidos? ¿Lo debería incluir?</li>
          <li>¿Existe ya un sistema de «snapshots» para import/export? Si no, ¿se considera alcance de este rediseño?</li>
          <li>¿Por qué «EN/ES» en el README si el brief pide EN/ES/PT/DE? ¿Son idiomas planeados o ya implementados?</li>
          <li>¿El campo de custom params ya valida sintaxis? ¿Soporta wildcards o fue una suposición?</li>
        </ul>

        <h4>Tres argumentos para defender el diseño actual</h4>
        <ol>
          <li><strong>Simplicidad radical.</strong> Un popup denso con categorización añade peso cognitivo; la versión actual,
              según las capturas, prioriza «before/after» que es lo único que importa. Más información puede ser menos trust.</li>
          <li><strong>No hay dark patterns documentados.</strong> El modelo de afiliados está disclosed en README,
              privacy page y onboarding. «Invisible en la URL» es distinto a «oculto al usuario».</li>
          <li><strong>Stack vanilla sin dependencias.</strong> MV3 penaliza cualquier capa de framework. El markup actual
              probablemente es directo, auditable y rápido — cualquier rediseño debe respetar eso.</li>
        </ol>
      </div>
    </section>
  </>
);

window.AuditDoc = AuditDoc;
