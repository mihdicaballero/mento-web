"""The static pages against the dictionaries, the pinned mento and the worked example."""

import json
import re
from html.parser import HTMLParser
from pathlib import Path

import pytest

import beam

ROOT = Path(__file__).resolve().parent.parent
PAGES = {
    "home": ROOT / "index.html",
    "beam": ROOT / "beam" / "index.html",
    "slab": ROOT / "slab" / "index.html",
    "wall": ROOT / "wall" / "index.html",
}
LANGS = ("es", "en")
# Engineering notation, the same in every language: numbers and areas, bar layouts such as
# "2Ø16 + 1Ø12", the symbols the design system uses as field labels (M, V, c/, eØ) and units.
NOTATION = re.compile(r"[\d.]+( cm²)?|\d+Ø\d+( \+ \d+Ø\d+)*|[A-Za-zØ+×·/−]{1,3}|cm|mm|MPa|kN|kNm|cm²|· mento")


class _Strings(HTMLParser):
    """Collects every i18n key of a page, and the Spanish text of the plain ``data-i18n`` elements."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.keys: set[str] = set()
        self.texts: dict[str, set[str]] = {}
        self.loose: set[str] = set()  # text outside any i18n element, svg, script or style
        self._open: list[tuple[str, str | None, list[str]]] = []
        self._covered: list[bool] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        for name in ("data-i18n", "data-i18n-html", "data-i18n-aria", "data-i18n-content"):
            if values.get(name):
                self.keys.add(values[name])  # type: ignore[arg-type]
        if values.get("data-i18n-aria"):
            self.texts.setdefault(values["data-i18n-aria"], set()).add(values.get("aria-label") or "")  # type: ignore[index]
        if values.get("data-i18n-content"):
            self.texts.setdefault(values["data-i18n-content"], set()).add(values.get("content") or "")  # type: ignore[index]
        self._open.append((tag, values.get("data-i18n"), []))
        inherited = bool(self._covered and self._covered[-1])
        covered = tag in ("svg", "script", "style", "title") or "data-i18n" in values or "data-i18n-html" in values
        self._covered.append(inherited or covered)

    def handle_data(self, data: str) -> None:
        if data.strip() and not (self._covered and self._covered[-1]):
            self.loose.add(data.strip())
        for _, _, chunks in self._open:
            chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        while self._open:
            open_tag, key, chunks = self._open.pop()
            self._covered.pop()
            if key:
                self.texts.setdefault(key, set()).add("".join(chunks))
            if open_tag == tag:
                break


def _strings(page: str) -> dict[str, dict[str, str]]:
    return json.loads((ROOT / "shared" / "i18n" / f"{page}.json").read_text(encoding="utf-8"))


def _parse(page: str) -> _Strings:
    parser = _Strings()
    parser.feed(PAGES[page].read_text(encoding="utf-8"))
    return parser


@pytest.mark.parametrize("page", PAGES)
def test_every_key_is_translated(page):
    strings, parsed = _strings(page), _parse(page)
    for lang in LANGS:
        assert parsed.keys <= set(strings[lang]), f"{lang} lacks {sorted(parsed.keys - set(strings[lang]))}"
    assert set(strings["es"]) == set(strings["en"])


@pytest.mark.parametrize("page", PAGES)
def test_first_paint_is_the_spanish_of_the_dictionary(page):
    es, parsed = _strings(page)["es"], _parse(page)
    for key, texts in parsed.texts.items():
        assert texts == {es[key]}, key


@pytest.mark.parametrize("page", PAGES)
def test_no_ui_text_outside_the_dictionary(page):
    """What is not translated must be a name, a number or a symbol, never copy."""
    names = {"mento", "/", "ES", "EN", "GitHub", "LinkedIn", "Me lo dijo un ingeniero", "RAMÉ Ingeniería", "·"}
    names |= {
        "1",
        "2",
        "3",
        "4",
        "ACI 318-19 · CIRSOC 201-25 · EN 1992",
    }
    # API names (node.check_flexure(), pip install mento) are code, not copy: the design system
    # puts them in the disclosure headers exactly as mento spells them.
    api = re.compile(r"(node|beam|slab|wall)(_1)?\.\w+(\(\))?|pip install mento")
    loose = {
        text
        for text in _parse(page).loose
        if text not in names and not NOTATION.fullmatch(text) and not api.fullmatch(text)
    }
    assert loose == set()


def test_home_names_the_mento_that_runs():
    worker = (ROOT / "shared" / "worker.js").read_text(encoding="utf-8")
    pinned = re.search(r'MENTO_VERSION = "([^"]+)"', worker).group(1)  # type: ignore[union-attr]
    assert f"mento=={pinned}" in (ROOT / "requirements-dev.txt").read_text(encoding="utf-8")
    assert f'<span id="version">{pinned}</span>' in PAGES["home"].read_text(encoding="utf-8")


def test_hero_shows_the_worked_example():
    """The hero is built from real components: when mento or the example changes, so must it."""
    result = json.loads(beam.run(json.dumps(beam.EXAMPLE)))
    assert result["ok"], result
    source = PAGES["home"].read_text(encoding="utf-8")
    hero = dict(re.findall(r'data-hero="([a-z0-9_]+)">([^<]*)<', source))
    bottom, top, shear = result["flexure"]["bottom"], result["flexure"]["top"], result["shear"]
    assert hero["bottom"] == hero["opt1"] == bottom["bars"]
    assert hero["top"] == top["bars"]
    assert hero["stirrups"] == shear["stirrups"].replace(" cm", "").replace("/", " c/")
    assert hero["section"] == f"{beam.EXAMPLE['width']} × {beam.EXAMPLE['height']}"
    assert hero["bottom_dcr"] == hero["opt1_dcr"] == f"{bottom['DCR']:.2f}"
    assert hero["top_dcr"] == f"{top['DCR']:.2f}"
    assert hero["shear_dcr"] == f"{shear['DCR']:.2f}"
    governing = max(bottom["DCR"], top["DCR"], shear["DCR"])
    assert hero["dcr"] == f"{governing:.2f}"
    assert 0.7 <= min(bottom["DCR"], top["DCR"], shear["DCR"]) and governing <= 0.9
    es = _strings("home")["es"]
    assert es["sumline"] == f"flexión {max(bottom['DCR'], top['DCR']):.2f} · corte {shear['DCR']:.2f}"


@pytest.mark.parametrize("page", ["slab", "wall"])
def test_every_calculator_has_the_beams_forces_block(page):
    """One forces editor, the same everywhere: only the hint under it may say what applies."""

    def station_2(name: str) -> str:
        source = PAGES[name].read_text(encoding="utf-8")
        block = re.search(r'<section class="station station-2">.*?</section>', source, re.S).group(0)  # type: ignore[union-attr]
        return re.sub(r'(data-i18n-html="hint2">).*?(</p>)', r"\1\2", block, flags=re.S)

    assert station_2(page) == station_2("beam")
    app = (ROOT / page / "app.js").read_text(encoding="utf-8")
    assert 'forces: ["M_y", "V_z", "N_x"],' in app
