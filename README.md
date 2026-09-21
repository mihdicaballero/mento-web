# mento-web

Free reinforced concrete calculators that run [mento](https://github.com/mihdicaballero/mento)
**in the visitor's browser**, for engineers who would rather not open a notebook.

There is no backend. Python runs client-side through [Pyodide](https://pyodide.org)
(WebAssembly), so hosting is a static folder, the cost does not grow with traffic, and nothing
the user types leaves their device.

## Layout

```
index.html          Landing: one card per calculator
beam/               One folder = one URL = one calculator (index.html + app.js)
shared/             worker.js (Pyodide + mento), style.css, logo
py/                 One glue module per calculator (JSON in, JSON out) and its tests
```

No build step, no framework, no `node_modules`.

## Run locally

```bash
python -m http.server 8765
```

Open <http://localhost:8765>. It must be served over HTTP; `file://` cannot start the worker.

## Test

The glue in `py/` is plain Python with no Pyodide-specific code:

```bash
pip install -r requirements-dev.txt
pytest
```

## Adding a calculator

1. `py/<name>.py` exposing `run(json) -> json`, `report(json) -> json` and an `EXAMPLE` dict
   (the worker runs it once at boot to warm up). Add `py/test_<name>.py`.
2. `<name>/index.html` + `app.js`, starting the worker as `../shared/worker.js?module=<name>`.
3. A card in `index.html`.

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
