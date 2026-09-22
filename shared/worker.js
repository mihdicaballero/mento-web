// Runs Python (Pyodide) and mento off the main thread, so the page never freezes.
// Each calculator starts it as `worker.js?module=<name>`, which loads `py/<name>.py`.
// A glue module exposes run(json) -> json, report(json) -> json and an EXAMPLE dict.
// With `&prefetch=1` (the home page) it only downloads everything into the browser cache and quits.
// Protocol: {id, type: "run" | "report", payload} -> {id, ok, result | error}
// plus unsolicited {type: "progress", step} and {type: "ready", version} on startup.

const PYODIDE_VERSION = "0.29.5";
const MENTO_VERSION = "1.2.0";
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const MODULE = new URL(self.location.href).searchParams.get("module");
if (!/^[a-z_]+$/.test(MODULE || "")) throw new Error(`Unknown calculator module: ${MODULE}`);
const PREFETCH = new URL(self.location.href).searchParams.has("prefetch");

importScripts(`${PYODIDE_URL}pyodide.js`);

const progress = (step) => self.postMessage({ type: "progress", step });

// mento imports IPython, matplotlib and seaborn at the top of its modules, but only uses them to
// render Markdown in notebooks and to plot. The page draws the section itself, so stubs stand in
// for all three: ~25 MB less to download and ~3 s less of Python imports on every visit.
const STUBS = `
import importlib.abc, importlib.machinery, sys, types

class _AnythingMeta(type):
    def __getattr__(cls, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return cls

class _Anything(metaclass=_AnythingMeta):
    """Accepts any call or attribute: sns.set_theme(...), plt.rcParams.update(...), class Foo(Figure)."""
    def __init__(self, *args, **kwargs): pass
    def __call__(self, *args, **kwargs): return self
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return self

class _StubModule(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return _Anything

class _StubFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in ("matplotlib", "seaborn"):
            return importlib.machinery.ModuleSpec(name, self, is_package=True)
    def create_module(self, spec): return _StubModule(spec.name)
    def exec_module(self, module): module.__version__ = "99"  # pandas checks it when it probes for matplotlib

sys.meta_path.insert(0, _StubFinder())

ipython = types.ModuleType("IPython")
display = types.ModuleType("IPython.display")
class Markdown(str):
    def __new__(cls, data=""):
        return super().__new__(cls, data)
display.Markdown = Markdown
display.display = lambda *args, **kwargs: None
ipython.display = display
ipython.get_ipython = lambda: None  # pandas asks whether it runs in a notebook
ipython.__version__ = "0"
sys.modules["IPython"] = ipython
sys.modules["IPython.display"] = display
`;

async function boot() {
  progress("python");
  const pyodide = await loadPyodide({ indexURL: PYODIDE_URL });

  progress("packages");
  await pyodide.loadPackage(["numpy", "pandas", "jinja2", "lxml", "micropip"]);

  progress("mento");
  const micropip = pyodide.pyimport("micropip");
  // mento 1.2.0 predates pint 0.26; the cap goes away with the next mento release.
  await micropip.install(["pint<0.26", "tabulate", "python-docx"]);
  await micropip.install.callKwargs([`mento==${MENTO_VERSION}`], { deps: false });

  if (PREFETCH) {
    await Promise.all(["common", MODULE].map((name) => fetch(new URL(`../py/${name}.py`, self.location.href))));
    return null;
  }

  progress("warmup");
  pyodide.runPython(STUBS);
  // py/common.py holds what the calculators share, so it travels with every one of them.
  for (const name of ["common", MODULE]) {
    // Revalidated every time: a glue module a release older than the page breaks the import.
    const response = await fetch(new URL(`../py/${name}.py`, self.location.href), { cache: "no-cache" });
    if (!response.ok) throw new Error(`py/${name}.py: HTTP ${response.status}`);
    pyodide.FS.writeFile(`/home/pyodide/${name}.py`, await response.text());
  }
  const api = pyodide.pyimport(MODULE);
  // First call pays for mento's lazy imports; do it before the user asks.
  api.run(JSON.stringify(api.EXAMPLE.toJs({ dict_converter: Object.fromEntries })));
  return api;
}

const apiPromise = boot().then(
  (api) => {
    if (PREFETCH) return self.close();
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
