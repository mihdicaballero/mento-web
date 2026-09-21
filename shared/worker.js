// Runs Python (Pyodide) and mento off the main thread, so the page never freezes.
// Each calculator starts it as `worker.js?module=<name>`, which loads `py/<name>.py`.
// A glue module exposes run(json) -> json, report(json) -> json and an EXAMPLE dict.
// Protocol: {id, type: "run" | "report", payload} -> {id, ok, result | error}
// plus unsolicited {type: "progress", step} and {type: "ready", version} on startup.

const PYODIDE_VERSION = "0.29.5";
const MENTO_VERSION = "1.2.0";
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const MODULE = new URL(self.location.href).searchParams.get("module");
if (!/^[a-z_]+$/.test(MODULE || "")) throw new Error(`Unknown calculator module: ${MODULE}`);

importScripts(`${PYODIDE_URL}pyodide.js`);

const progress = (step) => self.postMessage({ type: "progress", step });

// mento only uses IPython to render Markdown in notebooks. A stub saves ~10 MB of download.
const IPYTHON_STUB = `
import sys, types
ipython = types.ModuleType("IPython")
display = types.ModuleType("IPython.display")
class Markdown(str):
    def __new__(cls, data=""):
        return super().__new__(cls, data)
display.Markdown = Markdown
display.display = lambda *args, **kwargs: None
ipython.display = display
ipython.get_ipython = lambda: None  # pandas and matplotlib ask whether they run in a notebook
ipython.__version__ = "0"
sys.modules["IPython"] = ipython
sys.modules["IPython.display"] = display
`;

async function boot() {
  progress("python");
  const pyodide = await loadPyodide({ indexURL: PYODIDE_URL });

  progress("packages");
  await pyodide.loadPackage(["numpy", "pandas", "matplotlib", "jinja2", "lxml", "micropip"]);

  progress("mento");
  const micropip = pyodide.pyimport("micropip");
  // mento 1.2.0 predates pint 0.26; the cap goes away with the next mento release.
  await micropip.install(["pint<0.26", "seaborn", "tabulate", "python-docx", "openpyxl"]);
  await micropip.install.callKwargs([`mento==${MENTO_VERSION}`], { deps: false });

  progress("warmup");
  pyodide.runPython(IPYTHON_STUB);
  const response = await fetch(new URL(`../py/${MODULE}.py`, self.location.href));
  if (!response.ok) throw new Error(`py/${MODULE}.py: HTTP ${response.status}`);
  pyodide.FS.writeFile(`/home/pyodide/${MODULE}.py`, await response.text());
  const api = pyodide.pyimport(MODULE);
  // First call pays for matplotlib's font cache and mento's lazy imports; do it before the user asks.
  api.run(JSON.stringify(api.EXAMPLE.toJs({ dict_converter: Object.fromEntries })));
  return api;
}

const apiPromise = boot().then(
  (api) => {
    self.postMessage({ type: "ready", version: MENTO_VERSION });
    return api;
  },
  (error) => {
    self.postMessage({ type: "fatal", error: String(error) });
    throw error;
  },
);

self.onmessage = async ({ data }) => {
  const { id, type, payload } = data;
  try {
    const api = await apiPromise;
    const fn = type === "report" ? api.report : api.run;
    self.postMessage({ id, ok: true, result: JSON.parse(fn(JSON.stringify(payload))) });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error) });
  }
};
