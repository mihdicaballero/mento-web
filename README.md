# mento-web

Free reinforced concrete calculators that run [mento](https://github.com/mihdicaballero/mento)
**in the visitor's browser**, for engineers who would rather not open a notebook.

There is no backend. Python runs client-side through [Pyodide](https://pyodide.org)
(WebAssembly), so hosting is a static folder, the cost does not grow with traffic, and nothing
the user types leaves their device.

## Layout

```
index.html          Landing: one card per calculator, plus home.js
beam/ slab/ wall/   One folder = one URL = one calculator (index.html + app.js)
shared/             worker.js (Pyodide + mento), calculator.js, i18n.js, ui.js,
                    style.css, i18n/<page>.json, logo
py/                 common.py plus one glue module per calculator, and their tests
```

`shared/style.css` is the `<style id="site">` block of the design system, copied verbatim; the
only additions are at the end of the file, marked as such. Every UI string lives in
`shared/i18n/<page>.json` and reaches the markup through `data-i18n`; the Spanish in the HTML is
the first paint and `py/test_site.py` keeps it equal to the dictionary.

No build step, no framework, no `node_modules`.

## Run locally

```bash
python serve.py
```

Open <http://localhost:8765>. It must be served over HTTP; `file://` cannot start the worker.
`serve.py` is `python -m http.server` plus `Cache-Control: no-cache`: without it browsers cache
by heuristic and keep an old `worker.js` or glue module after it changes, which breaks the import.

## Test

The glue in `py/` is plain Python with no Pyodide-specific code:

```bash
pip install -r requirements-dev.txt
pytest
```

## Adding a calculator

1. `py/<name>.py` exposing `run(json) -> json`, `report(json) -> json` and an `EXAMPLE` dict
   (the worker runs it once at boot to warm up), built on `py/common.py`. Add `py/test_<name>.py`.
2. `<name>/index.html` with the four stations of the design system, and an `app.js` that calls
   `start(spec)` from `shared/calculator.js` with what is its own: fields, rebar groups, the
   drawing and the Python snippet.
3. `shared/i18n/<name>.json` with both languages, and a card in `index.html`.

## Which mento runs here

The one **published on PyPI**, pinned as `MENTO_VERSION` in `shared/worker.js` and mirrored in
`requirements-dev.txt` so CI tests the glue against the same version. A feature reaches this
site only after a mento release. `pint<0.26` is pinned because mento 1.2.0 predates pint 0.26;
drop it with the next bump.

mento imports `IPython` only to render Markdown in notebooks, so the worker registers a stub
instead of downloading it (~10 MB saved).

## Deploy

Any static host. On Vercel: import the repo, framework preset **Other**, no build command,
output directory `.`.

## Disclaimer

Provided without warranty. Results must be reviewed by a licensed professional, who remains
responsible for the design.

MIT licensed.
