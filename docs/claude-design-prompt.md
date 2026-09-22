You are acting as a senior product designer specialized in professional tools — engineering software, technical instruments, computational notebooks, developer tools. You are exploring how an online structural engineering calculator should look AND work, and then turning the chosen concept into a design system.

This is a **concept exploration first, design system second**. A first version of the site exists; I am deliberately not showing it to you, because I don't want it used as the starting premise. Do not assume the obvious "form on the left, results on the right" layout. If one of your directions ends up there, it must be only one of them, and it has to earn its place against the others.

What is locked: the product, the audience, the data going in and out, a few UX outcomes, and the technical limits. What is open: everything about how the screen is structured, how the user interacts with it, and how it looks.

---

## PRODUCT

**mento** is an open-source Python package for reinforced concrete design (ACI 318-19, CIRSOC 201-25, EN 1992). **mento web** runs that same package in the visitor's browser (Python compiled to WebAssembly): no backend, no login, nothing typed leaves the device.

Audience: practicing structural engineers and engineering students, mainly in Latin America (Argentina, Uruguay, Paraguay), plus English speakers. Today they solve this with Excel sheets, hand calcs, or Python notebooks. Some will open it on a phone on site or in a meeting; others on a desktop next to their structural model.

What the site is for: (a) a genuinely useful free tool, (b) the front door to the Python package — every result can be reproduced with a few lines of Python, and the site shows them, (c) quiet credibility for the author, a structural engineer who builds tooling. It is NOT a SaaS: nothing to sell, no signup, no pricing, no funnel.

Today there is one calculator (rectangular RC beam, flexure + shear). More will follow (other members and checks). Whatever concept wins has to extend to N calculators, some with twice the inputs.

## THE JOB THE USER IS DOING

An engineer has a beam: a concrete section, materials, a design code, and a handful of factored load combinations (moment + shear each). They want one of two things:

- **Design:** "tell me what reinforcement to put in" — the tool picks top bars, bottom bars and stirrups.
- **Check:** "I already have this reinforcement, does it work?" — they enter their bars and get pass/fail.

In both cases the questions in their head, in order, are: *Does it pass? By how much? What governs? What exactly do I draw? Can I put this in my calc report? Can I trust how it was computed?*

They then typically iterate: change the height, try another concrete, add a combination, and watch what happens. **That what-if loop is the heart of the product** — design for it, not for a one-shot form submission.

## DATA INVENTORY (what exists — NOT a layout, NOT an order)

**Inputs**
- Design code: one of ACI 318-19 · CIRSOC 201-25 · EN 1992
- Materials: *f*c = 25 MPa · *f*y = 420 MPa
- Section: *b* = 20 cm · *h* = 60 cm · cover *c*c = 25 mm
- Load combinations (1 to ~10 rows, user adds/removes): label, *M* (kNm, sign matters: positive = tension at the bottom), *V* (kN). Example: `1.4D` 60 / 80 · `1.2D+1.6L` 100 / 120
- Mode: design (tool chooses the rebar) or check (user enters it)
- In check mode: bottom bars `n Ø d + n Ø d`, top bars `n Ø d + n Ø d`, stirrups `n legs Ø d every s cm`

**Outputs**
- Overall verdict: passes / does not pass, and the governing utilization (e.g. 87 %, or 124 % when failing)
- Reinforcement: top `2Ø10` · bottom `2Ø16 + 1Ø12` · stirrups `1eØ6/18 cm`
- A to-scale cross-section drawing (SVG) with bars and stirrup
- Per-check utilization: bottom flexure 87 % (ØMn = 115 kNm ≥ Mu = 100 kNm), top flexure, shear 71 % (ØVn = 169 kN ≥ Vu = 120 kN)
- Per-combination detail tables (wide, ~10 numeric columns each, for flexure and for shear)
- Full step-by-step calculation text
- The equivalent Python snippet (≈15 lines), copyable
- Actions: download calc report (Word), copy shareable link (full state lives in the URL)

**Around it**
- Brand: logo + "mento" wordmark, link to Docs, ES/EN language switch
- Professional-responsibility disclaimer, version, MIT license, GitHub, feedback link
- A home page listing the calculators (today: 1 live + a few "coming soon")

## LOCKED OUTCOMES (the *what*; the *how* is yours)

- **Zero friction.** The page opens on a worked example already solved. No signup, no wizard gate, no "Calculate" button — results update live as values change.
- **The verdict is never far away.** Whatever the user is editing, on any screen size, they can see whether it still passes. How you achieve this on a 375 px phone is one of the main design problems; solve it, don't inherit a solution.
- **Trust through transparency.** Detail tables, step-by-step, and the Python equivalent are reachable without cluttering the first read.
- **Mobile is first-class** (375 px), and so is desktop (≥ 1280 px). They may be genuinely different layouts, not one squeezed into the other.
- **Bilingual ES / EN.** Spanish is rioplatense ("Cargá", "Descargá") and runs 20–30 % longer than English.
- **First load takes ~20 s** (the Python runtime downloads once, then is cached). The interface must be visible and explorable during that time; the wait should feel like an instrument warming up, not a broken page. Returning visits are near-instant.
- States that must exist: first load, recalculating (previous result still visible but clearly not current), invalid input, failing verdict (obvious, not alarmist), "link copied" confirmation.

## LOCKED TECHNICAL LIMITS

- Static site, **vanilla HTML + CSS + JS. No framework, no build step, no Tailwind, no component library.** One shared stylesheet driven by CSS custom properties. Anything you propose must be buildable this way — direct manipulation of an SVG, inline-editable values, sliders, drag handles are all fine; a canvas-heavy app or a 3D scene is not.
- The performance budget is spent on the Python runtime. The shell must paint instantly: at most 2 font families / 4 font files, or a system stack — your call, defend it.
- No raster images besides the logo; graphics are inline SVG.
- Motion: short functional transitions only (≤ 200 ms). No parallax, no page transitions, no decorative animation. Respect `prefers-reduced-motion`.
- WCAG AA contrast, visible focus, touch targets ≥ 44 px on mobile, pass/fail never conveyed by color alone.

## BRAND (LOCKED)

Logo attached. Primary color **#4890d2**. Everything else — neutrals, semantic colors, typography, shape language, light/dark — is open.

## TASTE (FROM FOUNDER)

- Precise, calm, engineering-credible. It should feel made by an engineer with taste, for engineers.
- High information density done right: aligned numerals, quiet but ever-present units, properly typeset symbols (*f*'c, *b*, *h*, *M*u, Ø — italic variable, upright subscript).
- AVOID: SaaS tropes (gradient blobs, glassmorphism, hero illustrations, emoji, sparkles), big airy rounded cards, decorative icons, marketing copy, and equally the 2005 engineering-software look (gray tables, beveled forms) and Bootstrap-admin templates.
- Places worth looking at for ideas — for how they *work*, not to copy their skin: Desmos and GeoGebra (live manipulation), Observable and Jupyter (document-as-tool), Wolfram|Alpha (answer-first), Figma's properties panel and Linear (calm density), Bret Victor's explorable explanations (tangible numbers), a well-set structural calc sheet or drawing title block (engineering credibility), pro audio/instrument UIs (readouts).

---

## DELIVERABLES

### Phase A — Divergent concepts (this is where I want your creativity)

Propose **4 concepts** for the beam calculator. They must differ from each other in **at least two** of these axes — a reskin of the same layout does not count as a different concept:

1. **What is the hero of the screen?** (the drawing? the verdict? the document? the numbers? a chart?)
2. **How do values get edited?** (classic fields · values edited inline inside sentences or a calc sheet · dragging dimensions on the drawing · sliders/scrubbing numbers · a spreadsheet grid · something else)
3. **How are input and output related in space?** (side by side · interleaved · output-first with inputs tucked away · a single continuous document · layered/overlay)
4. **How does the what-if loop work?** (e.g. compare two variants, show how utilization moves as *h* changes, pin a previous result, undo history)
5. **How does it collapse to a phone?**

Seed ideas to push you away from the default — use, combine, or beat them:
- **Drawing-led:** the cross-section is the interface. Dimensions, cover and bars are edited on the drawing itself; forces and code sit around it; the verdict lives on the drawing.
- **Living calc sheet:** the page *is* the calculation report — typeset like a document, every input is an editable value inside it, results flow below each step. What you see is what you download.
- **Answer-first:** the screen is mostly verdict + reinforcement + utilization, large and glanceable; inputs are a compact strip or chips you tap to change. Optimized for phone and for the what-if loop.
- **Workbench / instrument:** dense properties-panel controls, readouts and gauges, maybe a small utilization-vs-height or M–V envelope chart; built for the engineer who iterates twenty times.
- **Notebook bridge:** looks like a friendly notebook where the Python snippet and the UI are two views of the same thing; strongest bridge to the package.

For each concept give me:
- a name and a one-sentence idea,
- a **desktop (1280 px) and a mobile (375 px) mockup** of the main screen in the passing state, with the real data above — enough fidelity to judge the concept, not pixel-perfect,
- a short walkthrough of the what-if loop ("user changes *h* from 60 to 50 → this happens"),
- honest trade-offs: who it lands best with (practicing engineer / student / Python user), what is worse about it, how it copes with a calculator with 2× the inputs, and how hard it is to build in vanilla JS + CSS (easy / moderate / hard, and why).

Let the visual language differ between concepts too (type, color use, shape), so I also see a range of looks — but concept comes first, skin second.

Then **stop and wait**. I will pick one, or ask you to cross two of them. Expect a second round where you refine the chosen concept before any design system work.

### Phase B — Recommendation

Tell me which you would build and why. Say what the others do better. Don't pretend it's objectively right, and don't pick the safest one by default.

### Phase C — Refine the chosen concept

For the locked concept, design all the screens and states: passing, failing, check mode with user-entered rebar, first load, recalculating, invalid input, the detail/transparency surfaces (tables, step-by-step, Python), the home page with calculator cards — at 375 px and 1280 px, in ES (show one screen in EN to prove the lengths work).

### Phase D — Design system HTML (final deliverable)

One self-contained **`design-system.html`** (inline `<style>`, no dependencies except the font `<link>` if any; minimal vanilla JS only to toggle theme / language / states for demonstration). It will be handed to a coding agent as the single source of truth to build the real site, so it must be literal and complete:

1. **Tokens** — all as CSS custom properties in one `:root` block (plus a dark block if you keep dark mode), shown as specimens: colors (neutrals, brand, semantic ok / warn / bad with soft variants), type scale in rem, font stacks, spacing, radii, borders, shadows, breakpoints, motion.
2. **Typography rules** — headings, body, labels, hints, numeric readouts (tabular figures), math symbols with units, code.
3. **Components** — every component the chosen concept needs, each with all its states (default / hover / focus-visible / active / disabled / invalid), with the exact HTML and class names shown next to each specimen. At minimum: header with language switch, the value-editing control(s) of the concept, code selector, load-combination editor, rebar entry, verdict, reinforcement readout, cross-section drawing styles (SVG stroke/fill for concrete, bars, stirrups, dimensions), utilization indicator (ok / warn / bad), buttons, disclosure, dense numeric table, code block with copy, notices, loading (first load / returning), stale-result treatment, toast, calculator card (live / coming soon), footer.
4. **Assembled layouts** — calculator page (pass, fail, first load) and home page, at 375 px and ≥ 1280 px, using the real data.
5. **Interaction notes** — for anything beyond plain fields (dragging, scrubbing, inline editing): pointer, touch AND keyboard behavior, so it can be built accessibly.
6. **Rules for calculator #2** — short, concrete do / don't: how to label a quantity, where icons are allowed, how many inputs fit per row on mobile, what goes behind a disclosure.

Decisions to make and defend inside the file, one short paragraph each: system fonts vs web fonts · dark mode yes or no (don't default to yes) · where the brand blue is used and where it must not compete with pass/fail colors · icon library or none.

---

## RULES OF ENGAGEMENT

- No padding, no preambles, no "great question."
- Be bold in Phase A. I would rather reject a concept for being too strange than receive four variations of a form.
- Give explicit trade-offs with every option.
- Challenge me when a preference of mine would hurt use on a phone or the legibility of numbers — with reasoning.
- Explain choices in terms of how an engineer reads and trusts a result, not design buzzwords. I'm a structural engineer with strong taste and limited design vocabulary.
- Always use the real data above; numbers plausible, units present.
- Respond in English. I may write in Spanish or English.

Attached: `logo.svg` only.

Begin with Phase A.
