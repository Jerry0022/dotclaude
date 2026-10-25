# Concept templates, part 10 of 41: Template: design — fullscreen layout, overlay panel, feedback dock

## Layout — Fullscreen single-screen + Overlay Panel + Feedback Dock

```html
<!-- data-template mirrors the ACTIVE iteration; applyIterationTemplate()
     rewrites it on every tab switch. body overflow is set by that function,
     the inline style below is only the first-paint value. -->
<html data-template="design">
<body style="overflow: hidden">
  <div class="concept-layout design fullscreen">
    <div class="concept-content">
      <main>
        <!-- data-viewports / data-orientations declare the form factors this
             concept's app supports (§ Responsive device views). Omit both for
             a desktop-only concept: the toggle then never renders and the
             layout is byte-for-byte what it was before device views existed.
             A single design may override them; the iteration is the normal
             place to declare. -->
        <section data-iteration="1" data-iteration-template="design" data-active
                 data-viewports="desktop tablet phone"
                 data-orientations="portrait landscape">
          <!-- One or more designs. Exactly one <section data-design> carries
               data-design-active="true" (others get `hidden`). A single
               design still needs this wrapper for markup uniformity — it
               just degenerates to today's behaviour (see body[data-single-design]
               below). -->
          <!-- ≥2 designs: every design also carries the overview authoring
               attributes (§ Variant overview (≥2 designs)) — motto, exactly
               three traits, an icon, optionally a colour, an overlay
               anchor and tone; the iteration says data-design-set. -->
          <section data-design="dispatch" data-nav-label="Dispatch and Apparatus" data-design-active="true"
                   data-design-motto="Every unit at a glance."
                   data-design-traits="Map-first layout | Apparatus as cards | One-click dispatch"
                   data-design-icon="map" data-design-color="#e8622c">
            <!-- All pages of THIS design live here. Exactly one carries
                 data-screen-active="true" (others get `hidden`). Every screen
                 is position: absolute; inset: 0 so it fills the viewport. A
                 <div class="device-frame"> inside holds the actual mock content. -->
            <section id="d1-s1" data-screen data-nav-label="Welcome" data-screen-active="true">
              <div class="device-frame">…mock…</div>
            </section>
            <section id="d1-s2" data-screen data-nav-label="Credentials" hidden>
              <div class="device-frame">…mock…</div>
            </section>
            <section id="d1-s3" data-screen data-nav-label="Success" hidden>
              <div class="device-frame">…mock…</div>
            </section>
          </section>
          <section data-design="holotable" data-nav-label="Holotable" hidden
                   data-design-motto="The incident in 3D."
                   data-design-traits="Spatial incident model | Gesture control | No sidebars"
                   data-design-icon="cube" data-design-color="#8250df">
            <section id="d2-s1" data-screen data-nav-label="Welcome" data-screen-active="true">
              <div class="device-frame">…mock…</div>
            </section>
          </section>

          <!-- Views — OPTIONAL top-level siblings of section[data-design],
               never a replacement for the ≥1 design above. See § Views
               (optional) and § Screen-pattern markup → View sections for the
               full worked examples of both kinds. -->
          <section data-view="nav-model" data-view-kind="decision"
                    data-nav-label="Navigation model" hidden>…</section>
          <section data-view="card-density" data-view-kind="comparison"
                    data-nav-label="Card density A/B" hidden>…</section>
        </section>
      </main>
    </div>

    <!-- Minimal position indicator (top-left overlay) — NOT a header bar.
         Built entirely in JS from {{design.position_iteration}} and
         {{design.position_page}} (§ UI Locale) — the iteration segment only
         renders when the concept has >1 iteration, the design segment only
         when the iteration has >1 design. See buildDesignUI() below; the
         spans here are just the mount points it fills in. -->
    <div class="screen-indicator" id="screen-indicator">
      <!-- updateIndicator() (§ Layout JS) fills these mount points on every
           iteration/design/screen switch. Each optional segment carries its
           own trailing " · " INSIDE the span, so hiding the span removes the
           separator with it and never leaves a dangling one.
           Static values are the generation-time first-paint fallback
           (3-screen, single-iteration, single-design example) so the page
           never flashes empty before JS runs.
           EVERY id below is required — updateIndicator() null-guards each
           lookup, so a missing span does not throw; the segment simply never
           appears. That failure is silent, which is why the reference markup
           must carry all four. -->
      <span id="indicator-iteration" hidden>{{design.position_iteration}} <strong id="active-iteration-idx">1</strong> · </span>
      <span id="indicator-design" hidden><strong id="active-design-label">Dispatch</strong> · </span>
      <!-- Screen-counter segment — swaps out entirely (not just dimmed) for
           #indicator-view below while a view is active. Both are
           null-guarded by updateIndicator() (§ Layout JS), so a page that
           omits one of the two degrades silently rather than throwing. -->
      <span id="indicator-screen-info">
        {{design.position_page}} <strong id="active-screen-idx">1</strong> / <span id="total-screens">3</span>
        · <span id="active-screen-label">Welcome</span>
      </span>
      <!-- View-label segment — OPTIONAL, only ever shown while a
           section[data-view] is the active top-level item (§ Views
           (optional)). hidden by default so a page with no views never
           shows an empty strong tag. -->
      <span id="indicator-view" hidden><strong id="active-view-label">Navigation model</strong></span>
    </div>

    <!-- Annotation layer eye pill — OPTIONAL, only emitted when at least one
         screen carries [data-anno-layer]. Sits on the left edge directly
         BELOW #screen-indicator (never in the top-left corner itself, which
         the indicator owns) — see § Layout CSS for the exact offset and the
         updated top-edge partition comment. `hidden` by default; JS
         (updateAnnoUI(), § Layout JS) reveals it only when the ACTIVE screen
         has ≥1 annotation, and keeps the count live across screen/iteration
         switches. aria-pressed / aria-label reflect body.anno-hidden.
         Whenever the top-left eye slot (#design-header) is on screen the
         eye lives INSIDE it (.design-header-eye: placeEye() in
         wireDesignOverview, plus the adopt safety net in § Panel Chrome JS)
         — the floating spot below is only the fallback for rounds without
         that header. Keep id and class stable: both movers key on them. -->
    <button id="anno-toggle" class="anno-toggle-fab" type="button" hidden
            aria-pressed="true"
            aria-label="{{anno.toggle_hide}}"
            data-tip="{{anno.toggle_hide}}"
            data-label-show="{{anno.toggle_show}}"
            data-label-calm-hide="{{anno.toggle_calm_hide}}"
            data-label-calm-show="{{anno.toggle_calm_show}}"
            data-label-hide="{{anno.toggle_hide}}">
      <svg class="anno-eye-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
      <svg class="anno-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>
      <span class="anno-eye-count" id="anno-eye-count" hidden></span>
    </button>

    <!-- Design switcher (ghost bar, top centre) — one segment per
         <section data-design>, only rendered when the iteration has ≥2
         designs (hidden via body[data-single-design], see Layout CSS).
         Auto-populated by buildDesignUI(); resting state shows only the
         active label (CSS collapses the rest), hover/:focus-within expands
         to the full segmented control.
         When the iteration ALSO has ≥1 view (§ Views (optional)),
         buildDesignUI() appends a thin .switcher-divider then one
         .view-switch-item per view, in the SAME row — switching between a
         design and a question about it is one click from anywhere. -->
    <nav class="design-switcher" id="design-switcher" aria-label="{{design.switch_label}}">
      <!-- auto-populated: one <button class="design-switch-item"> per
           design, then (if any) a <span class="switcher-divider"> and one
           <button class="view-switch-item"> per view -->
    </nav>

    <!-- Variant overview chrome (§ Variant overview (≥2 designs)) — mount
         points only, filled by wireDesignOverview() (§ Variant overview JS).
         Rendered ONLY while the visible iteration has ≥2 designs
         (body[data-overview="true"]); in that mode they replace
         #screen-indicator (top left) and #design-switcher (top centre), and
         #anno-toggle moves into #design-header. Every design round gets
         them; the carousel itself needs ≥2 designs.
         #design-header — top left, the eye slot and nothing else: no
           breadcrumb, no back item, no title, no ★, no box. Back to the
           overview via the ☰ menu's "Übersicht" entry (or Esc).
         #design-quick — top-centre quick nav: one row — designs (the active
           one with its pages), then a `?` segment when the round has views.
         #upin-hint — bottom-centre hint while Ctrl is held (user pins).
         #design-keys — the `?` shortcut sheet. -->
    <div class="design-header" id="design-header" data-open="false"></div>
    <nav class="design-quick" id="design-quick" aria-label="{{design.switch_label}}"></nav>
    <div class="upin-hint" id="upin-hint" role="status" hidden></div>
    <div class="design-keys" id="design-keys" role="dialog" aria-modal="false"
         aria-label="{{design.keys_title}}" hidden></div>

    <!-- Two FABs — the only floating UI besides the screen itself.
         BOTH carry two labels: the toggle swaps `data-tip` AND `aria-label`
         together with `aria-expanded`, so pointer users get a hover tooltip
         and screen-reader users hear the correct NEXT action ("Open" vs
         "Minimize"). The labels are tooltip-only on purpose — an unlabelled
         emoji circle is undiscoverable, but a visible pill would break the
         shared 60px circle geometry the two FABs are pinned to (gate P13).
         Every label string comes from the locale table; never bake English
         (or "Feedback") in here.
         `data-untouched` on the 💬 FAB drives a one-shot attention pulse
         (§ Layout CSS) that the JS clears on the first dock open or the
         first keystroke inside the dock — a returning user is never nagged
         twice. -->
    <button id="panel-toggle" class="panel-fab"
            aria-label="{{panel.toggle_open}}"
            data-tip="{{panel.toggle_open}}"
            aria-expanded="false"
            data-label-open="{{panel.toggle_open}}"
            data-label-close="{{panel.toggle_close}}">☰</button>
    <button id="feedback-toggle" class="feedback-fab"
            aria-label="{{proto.feedback_toggle}}"
            data-tip="{{proto.feedback_toggle}}"
            aria-expanded="false"
            data-untouched="true"
            data-label-open="{{proto.feedback_toggle}}"
            data-label-close="{{panel.minimize}}">💬</button>

    <!-- Device-view toggle (bottom-left) — the fourth corner, and the
         quietest thing on the page. One button, one gesture: each click
         advances to the next DECLARED viewport and wraps around. It is
         deliberately NOT a 60px FAB — those two are one accent-coloured
         component for the page's two actions, this is a view control that
         must not compete with them. Hidden entirely when the iteration
         declares fewer than two viewports (body[data-single-viewport]).
         Every label is a data-attribute rather than baked text: the JS
         rewrites glyph + label + aria-label on each cycle, and the locale
         substitution has to happen once, here, at generation time. -->
    <button id="viewport-toggle" class="viewport-toggle" type="button" data-mode="desktop"
            data-label-prefix="{{design.viewport_switch}}"
            data-label-desktop="{{design.viewport_desktop}}"
            data-label-tablet="{{design.viewport_tablet}}"
            data-label-phone="{{design.viewport_phone}}"
            data-label-portrait="{{design.orientation_portrait}}"
            data-label-landscape="{{design.orientation_landscape}}"
            aria-label="{{design.viewport_switch}}">
      <!-- Inline SVG, not emoji: 🖥/📱 render as full-colour platform art
           that clashes with a dark chrome pill and differs per OS. All three
           share one 20×20 grid, stroke-only, currentColor — so they read as
           one set. The monitor keeps a stand because a bare rectangle is
           indistinguishable from a tablet in landscape; neither tablet nor
           phone gets a notch or home button, which would have to move
           between orientations and carries no information the label lacks. -->
      <svg data-glyph="desktop" viewBox="0 0 20 20" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="16" height="11" rx="1.5"/>
        <line x1="10" y1="14" x2="10" y2="17"/>
        <line x1="7" y1="17" x2="13" y2="17"/>
      </svg>
      <svg data-glyph="tablet" viewBox="0 0 20 20" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <rect x="4" y="2" width="12" height="16" rx="2"/>
      </svg>
      <svg data-glyph="phone" viewBox="0 0 20 20" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <rect x="6" y="1" width="8" height="18" rx="2.2"/>
        <line x1="8.5" y1="3.3" x2="11.5" y2="3.3"/>
      </svg>
      <span class="viewport-toggle-label">{{design.viewport_desktop}}</span>
    </button>

    <!-- Decision panel (☰) — contains: iteration-tabs, screen-nav, submit.
         No section-TOC here: the screen-nav replaces it for design. -->
    <aside class="concept-decision-panel" id="decision-panel">
      <!-- Same head row as § Common Structure: round label · back link ·
           🕘 rounds chip · theme toggle · ✕. This is the design round's ONLY
           theme control — the document header that used to carry one is
           hidden in design mode (§ Layout CSS). -->
      <div class="panel-head">
        <span class="panel-here-round" data-here-round></span>
        <!-- Same wrapper as § Common Structure — the group (not either
             child) carries margin-left: auto, so the chip stays right-aligned
             whether or not #panel-here-back is [hidden]. -->
        <span class="panel-here-right">
          <button type="button" id="panel-here-back" class="link-btn panel-here-back" hidden></button>
          <button type="button" id="panel-here-rounds" class="panel-here-rounds-btn" hidden
                  aria-haspopup="true" aria-expanded="false" aria-controls="panel-here-rounds-list"
                  data-tip="{{nav.rounds_chip}}" aria-label="{{nav.rounds_chip}}">
            <span aria-hidden="true">🕘</span> <span data-here-rounds-count></span>
          </button>
        </span>
        <button type="button" id="theme-toggle" class="theme-toggle-btn"
                data-label-light="{{theme.to_light}}"
                data-label-dark="{{theme.to_dark}}"
                data-tip="{{theme.to_light}}" aria-label="{{theme.to_light}}">
          <span class="theme-glyph" data-glyph="sun" aria-hidden="true">☀️</span>
          <span class="theme-glyph" data-glyph="moon" aria-hidden="true">🌙</span>
        </button>
        <button id="panel-close" class="panel-close-btn" aria-label="{{panel.close}}">✕</button>
      </div>
      <!-- Same four-part anatomy as § Common Structure (here / scroll box /
           status / foot) — only the containing aside differs. -->
      <div class="panel-here" id="panel-here">
        <span class="panel-here-section" data-here-section hidden></span>
        <div class="panel-here-rounds-list" id="panel-here-rounds-list" hidden role="list">
          <!-- auto-populated by buildRoundsChip() -->
        </div>
      </div>
      <div class="panel-nav-scroll">
      <nav class="iteration-tabs" role="tablist" aria-label="{{iteration.label}}"><!-- chips --></nav>
      <!-- #section-nav also lives on the design skeleton: a free/decision round
           on a design concept (the final report is always free) renders its TOC
           here; CSS hides it while a design round is active and #screen-nav
           otherwise (html[data-template] mirrors the active round). Without it
           the final report of every design concept had no TOC at all — and no
           ⚠ Danach-von-Hand entry. -->
      <nav class="section-nav" id="section-nav" aria-label="{{nav.sections}}"></nav>
      <nav class="screen-nav" id="screen-nav" aria-label="Screens">
        <!-- auto-populated, two levels: one .screen-nav-group per
             <section data-design>, a .screen-nav-design-heading button at
             the top of each group, then one .screen-nav-item per page
             nested beneath. Single-design pages skip the heading (CSS,
             body[data-single-design]) and render as today's flat list.
             The ● marker applies at both levels: a design heading shows it
             when ANY of its pages, or its own design-level comment field,
             carries unsubmitted text. Clicking either level switches and
             closes the panel.
             A SECOND .screen-nav-group renders below the designs group
             whenever the iteration has ≥1 view (§ Views (optional)): a
             plain, non-interactive .screen-nav-views-heading label, then
             one .screen-nav-view-item button per view. Own class family
             (screen-nav-view-*) so it can be styled independently of the
             design nav items it sits below. -->
      </nav>
      </div><!-- /.panel-nav-scroll -->
      <!-- Status line — same contract as § Common Structure: #connection-status
           keeps its [data-state] (connecting | connected | disconnected), the
           composed line + the six-state .panel-status[data-status] are
           rendered by renderPanelStatus(); no overlay, no acknowledge button;
           starts in "connecting" and never flashes "disconnected" before the
           first heartbeat response. The progress <ol> lives under the line. -->
      <div class="panel-status" id="panel-status" data-status="connecting">
        <div id="connection-status" class="status-line" data-state="connecting" role="status" aria-live="polite">
          <span class="status-glyph" aria-hidden="true">◐</span>
          <span class="conn-label">{{panel.status_connecting}}</span>
        </div>
        <details class="status-detail" id="status-detail" hidden>
          <summary class="status-detail-row">
            <span class="status-dots" id="status-dots" aria-hidden="true"></span>
            <span class="status-detail-label">{{panel.status_detail}}</span>
          </summary>
          <ol class="status-steps" id="status-steps" aria-live="polite">
            <li data-step="submitted" data-state="done">
              <span class="step-icon" aria-hidden="true">✓</span>
              <span class="step-label">{{panel.step_submitted}}</span>
            </li>
            <li data-step="received" data-state="active">
              <span class="step-icon" aria-hidden="true">⏳</span>
              <span class="step-label">{{panel.step_received}}</span>
            </li>
            <li data-step="reality-check" data-state="pending" hidden>
              <span class="step-icon" aria-hidden="true">○</span>
              <span class="step-label" data-state-label="pending">{{panel.step_reality_check}}</span>
              <span class="step-label" data-state-label="active">{{panel.step_reality_check_active}}</span>
              <span class="step-label" data-state-label="done">{{panel.step_reality_check}}</span>
            </li>
            <li data-step="implemented" data-state="pending" hidden>
              <span class="step-icon" aria-hidden="true">○</span>
              <span class="step-label" data-state-label="pending">{{panel.step_waiting}}</span>
              <span class="step-label" data-state-label="active">{{panel.step_implemented_active}}</span>
              <span class="step-label" data-state-label="done">{{panel.step_implemented}}</span>
            </li>
          </ol>
        </details>
      </div>
      <!-- CTA foot — pinned, ≤120px, no FAB gutter below it: the 💬 FAB
           hides while the panel is open (§ Panel Chrome CSS). -->
      <div class="panel-cta">
      <div id="panel-ready">
        <div class="submit-split">
          <button id="submit-iterate-btn" class="primary submit-btn" data-tip="{{panel.submit_iterate_hint}}">
            <span class="submit-label">{{panel.submit_iterate}}</span>
            <span class="hint-cache" data-cache-hint="iterate" hidden>
              <span aria-hidden="true">⚠</span> {{panel.btn_cache_hint}}
            </span>
          </button>
          <button type="button" id="submit-menu-btn" class="submit-menu-btn"
                  aria-haspopup="menu" aria-expanded="false" aria-controls="submit-menu"
                  aria-label="{{panel.submit_menu}}" data-tip="{{panel.submit_menu}}">
            <span aria-hidden="true">▾</span>
          </button>
        </div>
        <div id="submit-menu" class="submit-menu" role="menu" hidden>
          <button id="submit-implement-btn" class="implement-btn" role="menuitem" data-tip="{{panel.submit_implement_hint}}">
            <span class="warn-icon" aria-hidden="true">⚠</span>
            {{panel.submit_implement}}
          </button>
          <p class="hint hint-cache" data-cache-hint="implement" hidden>
            <span aria-hidden="true">⚠</span> {{panel.btn_cache_hint}}
          </p>
          <p class="hint submit-menu-hint">{{panel.submit_menu_hint}}</p>
        </div>
      </div>
      <div id="panel-submitted" style="display: none;">
        <div class="submitted-indicator">
          <span class="check-icon">✓</span>
          <strong>{{panel.submitted}}</strong>
        </div>
        <p class="submitted-hint">{{panel.submitted_hint}}</p>
      </div>
      <!-- The remaining two panel states — #panel-frozen and
           #panel-final-report — are IDENTICAL to § Common Structure and MUST
           be copied verbatim from there into this .panel-cta. showIteration()
           switches all four states regardless of template, so a design page
           that ships only the two above loses its close-out sheet the moment
           a final report is appended, and shows an empty panel on every past
           tab. The aside itself is identical everywhere (§ Panel Chrome (all
           templates)); only what surrounds it differs. -->
      </div><!-- /.panel-cta -->
    </aside>
    <div class="panel-backdrop" id="panel-backdrop"></div>

    <!-- Feedback dock (💬) — speech-bubble overlay, ordered specific → general,
         top to bottom: current screen → design (when ≥2 designs) → general;
         while a view is active, the view row takes the design+screen rows'
         place (§ Layout CSS view-mode swap) so the visible order becomes
         view → general. General sits LAST because it is the one field that
         never disappears or changes label as the user navigates — the user
         fills in the specific thing (what they're looking at) first and the
         catch-all note last, and general's fixed position at the bottom
         means it never jumps even though the rows above it swap content.
         Anchored to the 💬 FAB (bottom-right): the FAB stays visible and
         clickable, the dock floats above/around it like a chat bubble.
         Now that ☰ lives top-right (Wave 3), the dock no longer reserves
         space for it — see Layout CSS geometry comment.
         The close button minimises (does not destroy state) — user input
         is preserved on close, no value is lost.
         CLOSED by default (data-open="false"): at concept start the user
         wants to look at the mockup, not at three empty textareas covering
         it. data-size is written by applyDockSize() — § Panel Chrome JS.
         The dock is PAGE CHROME (§ Panel Chrome (all templates)): the
         header row and the general section below are the same markup every
         template carries; only the three row containers (#screen-textareas,
         #design-textareas, #view-textareas) are the design layout's
         addition, and they fold away by CSS while a document round of the
         same page is on screen. -->
    <aside class="feedback-dock" id="feedback-dock" data-open="false" data-size="compact" data-user-maximized="false">
      <div class="feedback-dock-header">
        <strong>{{proto.feedback_title}}</strong>
        <!-- Maximise (Work package B) is a distinct control from minimise:
             minimise CLOSES the dock (data-open toggle), maximise RESIZES it
             (data-size override) without touching data-open at all. The two
             must never be merged into one button. -->
        <button id="feedback-maximize" class="feedback-maximize-btn" aria-pressed="false"
                aria-label="{{panel.maximize}}" data-tip="{{panel.maximize}}">⤢</button>
        <button id="feedback-close" class="feedback-close-btn" aria-label="{{panel.minimize}}" data-tip="{{panel.minimize}}">−</button>
      </div>
      <div class="feedback-section">
        <!-- The scope suffix names the design this page belongs to, so the
             row says "this page of A · Briefing" — not just a page name that
             could belong to any design. Hidden on single-design rounds. -->
        <label class="dock-crumb"><span class="dock-crumb-lv">{{dock.crumb_concept}}</span><span class="dock-scope"><i>›</i><span class="dock-crumb-lv" id="dock-screen-design">Dispatch</span></span><i>›</i><strong class="dock-crumb-last"><span id="dock-screen-idx"></span> <span id="dock-screen-label">Welcome</span></strong><span class="dock-tag">{{proto.feedback_current}}</span></label>
        <!-- One hidden textarea per screen. Only the active one is shown.
             Each carries data-comment="{screen-id}" AND
             data-screen-comment="{screen-id}" — so saveState/restoreState
             treats it like any comment field. -->
        <div id="screen-textareas" data-placeholder="{{proto.feedback_placeholder}}"><!-- auto-populated --></div>
      </div>
      <div class="feedback-divider"></div>
      <!-- Design row — omitted for single-design iterations via
           body[data-single-design="true"] (Layout CSS), no JS branching.
           One hidden textarea per design; only the active one is shown,
           same swap mechanism as the per-screen row above. Each carries
           data-comment="design-{id}" AND data-design-comment="{id}". -->
      <div class="feedback-section">
        <label class="dock-crumb"><span class="dock-crumb-lv">{{dock.crumb_concept}}</span><i>›</i><strong id="dock-design-label">Dispatch</strong><span class="dock-tag">{{design.feedback_design}}</span></label>
        <div id="design-textareas" data-placeholder="{{design.feedback_design_placeholder}}"><!-- auto-populated --></div>
      </div>
      <div class="feedback-divider"></div>
      <!-- View row — OPTIONAL, only present when the iteration has ≥1
           section[data-view] (§ Views (optional)). Shown ONLY while a view
           is the active top-level item (body[data-view-active="true"],
           § Layout CSS); the design and per-screen rows above hide in that
           state and this one takes their place — never all three visible
           at once. One hidden textarea per view, built ONCE per iteration by
           buildViewTextareas(), same build-once-swap-hidden discipline as
           the design/screen rows. Each carries data-comment="view-{id}" AND
           data-view-comment="{id}". -->
      <div class="feedback-section">
        <label class="dock-crumb"><span class="dock-crumb-lv">{{dock.crumb_concept}}</span><i>›</i><strong id="dock-view-label">Navigation model</strong><span class="dock-tag">{{design.feedback_view}}</span></label>
        <div id="view-textareas" data-placeholder="{{design.feedback_view_placeholder}}"><!-- auto-populated --></div>
      </div>
      <div class="feedback-divider"></div>
      <div class="feedback-section">
        <label class="dock-crumb"><strong class="dock-crumb-last">{{dock.crumb_concept}}</strong><span class="dock-tag">{{dock.tag_general}}</span></label>
        <textarea id="design-general-feedback" data-comment="general" data-attachable
                  placeholder="{{proto.feedback_general}}"></textarea>
        <div class="attach-slot" data-attach-slot="general"></div>
      </div>
    </aside>
  </div>

  <!-- Shared content dimmer + frozen bar — see Common Structure for
       behavior + CSS. Both are page-level chrome and MUST be copied verbatim:
       showIteration() drives them regardless of template. -->
  <div class="content-dimmer" id="content-dimmer"
       role="button" tabindex="-1"
       aria-label="{{panel.dim_dismiss}}"
       data-tip="{{panel.dim_dismiss}}" hidden></div>
  <div class="frozen-bar" id="frozen-bar" role="status" hidden>
    <span class="frozen-bar-text">🕘 <strong data-frozen-bar-title>{{iteration.tab}} 1</strong> {{frozen.bar_hint}}</span>
    <button type="button" id="frozen-bar-back">{{frozen.bar_back}}</button>
  </div>
</body>
</html>
```

