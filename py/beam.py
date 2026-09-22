"""Glue between the web page and mento: JSON in, JSON out.

Runs inside Pyodide in the browser, but has no Pyodide-specific code, so it can
be exercised from a normal interpreter too::

    python -c "import beam, json; print(beam.run(json.dumps(beam.EXAMPLE)))"
"""

from __future__ import annotations

import contextlib
import io
import json
import math
import warnings
from typing import Any

import common
import mento
from mento import (
    Concrete_ACI_318_19,
    Concrete_CIRSOC_201_25,
    Concrete_EN_1992_2004,
    Forces,
    MPa,
    Node,
    RectangularBeam,
    SteelBar,
    cm,
    kN,
    kNm,
    mm,
)
from mento.rebar import Rebar

CONCRETES = {
    "ACI 318-19": Concrete_ACI_318_19,
    "CIRSOC 201-25": Concrete_CIRSOC_201_25,
    "EN 1992-2004": Concrete_EN_1992_2004,
}

# The worked example every visitor opens: it must pass with every DCR between 0.7 and 0.9, and
# the home's hero shows its result (py/test_site.py checks that the two agree).
EXAMPLE: dict[str, Any] = {
    "code": "CIRSOC 201-25",
    "lang": "es",
    "mode": "design",
    "label": "V-101",
    "fc": 25,
    "fy": 420,
    "width": 20,
    "height": 60,
    "cover": 25,
    "forces": [
        {"label": "1.4D", "M_y": 55, "V_z": 80, "N_x": 0},
        {"label": "1.2D+1.6L", "M_y": 90, "V_z": 120, "N_x": 0},
        {"label": "0.9D+1.0E", "M_y": -45, "V_z": 95, "N_x": 30},
    ],
}


class InputError(ValueError):
    """A problem with what the user typed, reported back by field name."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


def _number(data: dict[str, Any], key: str, *, positive: bool = True) -> float:
    try:
        value = float(data.get(key))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise InputError(key, "missing") from None
    if math.isnan(value) or (positive and value <= 0):
        raise InputError(key, "positive")
    return value


def _quantity(value: Any, unit: str, precision: int = 2) -> str | None:
    if value is None:
        return None
    return f"{value.to(unit):.{precision}f~P}"


def _covers(provided: Any, required: Any) -> bool:
    """Whether the steel placed reaches the steel required (which already includes the minimum)."""
    if required is None:
        return True
    return bool(provided.to(required.units).magnitude >= required.magnitude * 0.999)


def _build_beam(data: dict[str, Any]) -> RectangularBeam:
    code = data.get("code")
    if code not in CONCRETES:
        raise InputError("code", "unknown")
    f_c = _number(data, "fc")
    f_y = _number(data, "fy")
    concrete = CONCRETES[code](name=f"f'c {f_c:g}", f_c=f_c * MPa)
    steel = SteelBar(name=f"fy {f_y:g}", f_y=f_y * MPa)
    return RectangularBeam(
        label=str(data.get("label") or "B1"),
        concrete=concrete,
        steel_bar=steel,
        width=_number(data, "width") * cm,
        height=_number(data, "height") * cm,
        c_c=_number(data, "cover") * mm,
    )


def _build_forces(data: dict[str, Any]) -> list[Forces]:
    forces = []
    for i, row in enumerate(data.get("forces") or []):
        m_y = float(row.get("M_y") or 0)
        v_z = float(row.get("V_z") or 0)
        n_x = float(row.get("N_x") or 0)
        if m_y == 0 and v_z == 0 and n_x == 0:
            continue
        label = str(row.get("label") or f"C{i + 1}")
        forces.append(Forces(label=label, M_y=m_y * kNm, V_z=v_z * kN, N_x=n_x * kN))
    if not forces:
        raise InputError("forces", "empty")
    return forces


def _rows(layers: Any, room: float, gap: float) -> list[list[Any]]:
    """Split the bar groups of one face into rows, nearest the face first.

    mento lists up to four groups, corner and inner bars of the first row and then of the
    second, but leaves out the empty ones. So whether the second group shares the first row
    is decided by whether it fits between the stirrup legs.
    """
    groups = list(layers)
    if len(groups) == 4:
        return [groups[:2], groups[2:]]
    if len(groups) < 2:
        return [groups]
    first = groups[:2]
    bars = sum(group.n for group in first)
    diameters = [float(group.d_b.to("cm").magnitude) for group in first]
    needed = sum(group.n * d for group, d in zip(first, diameters)) + (bars - 1) * max(gap, *diameters)
    if needed <= room + 1e-6:
        return [first, groups[2:]] if len(groups) > 2 else [first]
    return [groups[:1], groups[1:]]


def _section(beam: RectangularBeam) -> dict[str, Any]:
    """Section geometry in cm, origin at the bottom left corner, for the page to draw."""
    width = float(beam.width.to("cm").magnitude)
    height = float(beam.height.to("cm").magnitude)
    cover = float(beam.c_c.to("cm").magnitude)
    transverse = beam.reinforcement.transverse
    stirrup = float(transverse.d_b.to("cm").magnitude) if transverse.n_stirrups else 0.0
    edge = cover + stirrup
    gap = float(beam.settings.clear_spacing.to("cm").magnitude)
    row_gap = float(beam.settings.layers_spacing.to("cm").magnitude)
    bend = 0.43 * stirrup

    bars: list[dict[str, float]] = []

    def place(layers: Any, bottom: bool) -> None:
        offset = edge
        for row in _rows(layers, width - 2 * edge, gap):
            if not row:
                continue
            tallest = max(float(group.d_b.to("cm").magnitude) for group in row)
            for position, group in enumerate(row):
                d = float(group.d_b.to("cm").magnitude)
                y = offset + d / 2 if bottom else height - offset - d / 2
                span = width - 2 * edge - d
                for i in range(group.n):
                    nudge_x = nudge_y = 0.0
                    if position == 0:  # corner bars, spread from leg to leg
                        x = width / 2 if group.n == 1 else edge + d / 2 + i * span / (group.n - 1)
                        if group.n > 1 and i in (0, group.n - 1):  # sit in the stirrup bend, as beam.plot() does
                            nudge_x = bend if i == 0 else -bend
                            nudge_y = bend if bottom else -bend
                    else:  # inner bars, evenly between the corners
                        x = edge + d / 2 + (i + 1) * span / (group.n + 1)
                    bars.append({"x": round(x + nudge_x, 3), "y": round(y + nudge_y, 3), "d": round(d, 3)})
            offset += tallest + row_gap

    place(beam.reinforcement.bottom.layers, bottom=True)
    place(beam.reinforcement.top.layers, bottom=False)
    return {
        "width": width,
        "height": height,
        "cover": cover,
        "stirrups": {"n": int(transverse.n_stirrups or 0), "d": stirrup},
        "bars": bars,
    }


def _cell(value: Any) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "–"
    if isinstance(value, bool):
        return "✓" if value else "✕"
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def _table(frame: Any) -> dict[str, Any]:
    """mento's DataFrame as it prints it: same columns, same order, its units row in the header."""
    columns = [str(name) for name in frame.columns]
    rows = [[_cell(value) for value in row] for row in frame.itertuples(index=False)]
    # mento puts the units in the first row, under an empty label
    units = rows.pop(0) if rows and not rows[0][0].strip() else [""] * len(columns)
    return {
        "columns": columns,
        "units": units,
        "rows": rows,
        "dcr": columns.index("DCR") if "DCR" in columns else None,
    }


def _detailed_text(node: Node) -> str:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        node.flexure_results_detailed()
        node.shear_results_detailed()
    return out.getvalue()


def _bars(layers: Any) -> str:
    """``3Ø16 + 2Ø12``: bars of one diameter are counted together, the way they are ordered on site."""
    counts: dict[float, int] = {}
    for layer in layers:
        diameter = float(layer.d_b.to("mm").magnitude)
        counts[diameter] = counts.get(diameter, 0) + layer.n
    return " + ".join(f"{n}Ø{diameter:g}" for diameter, n in counts.items())


def _face(face: Any) -> dict[str, Any]:
    return {
        "bars": _bars(face.layers),
        "A_s": _quantity(face.A_s, "cm**2"),
        "A_s_req": _quantity(face.A_s_req, "cm**2"),
        "A_s_min": _quantity(face.A_s_min, "cm**2"),
        "A_s_max": _quantity(face.A_s_max, "cm**2"),
        "M_capacity": _quantity(face.M_capacity, "kN*m", 1),
        "DCR": round(float(face.DCR), 3),
        "enough": _covers(face.A_s, face.A_s_req),
    }


# ------------------------------------------------------------------ rebar layouts
# A layout is what the page, the URL and mento's setters all speak: {"n1": 2, "d1": 16, ...}
# for a face and {"n": 1, "d": 6, "s": 13} for the stirrups. Diameters in mm, spacing in cm.


def _layers_layout(layers: Any) -> dict[str, Any]:
    layout: dict[str, Any] = {}
    for index, layer in enumerate(layers, start=1):
        if index > 4 or not layer.n:
            break
        layout[f"n{index}"] = int(layer.n)
        layout[f"d{index}"] = round(float(layer.d_b.to("mm").magnitude), 3)
    return layout


def _row_layout(row: dict[str, Any]) -> dict[str, Any]:
    """The same, from one row of mento's rebar designer."""
    layout: dict[str, Any] = {}
    for index in range(1, 5):
        n = int(row.get(f"n_{index}") or 0)
        diameter = row.get(f"d_b{index}")
        if n and diameter is not None:
            layout[f"n{index}"] = n
            layout[f"d{index}"] = round(float(diameter.to("mm").magnitude), 3)
    return layout


def _stirrup_layout(transverse: Any) -> dict[str, Any]:
    if not transverse.n_stirrups:
        return {}
    return {
        "n": int(transverse.n_stirrups),
        "d": round(float(transverse.d_b.to("mm").magnitude), 3),
        "s": round(float(transverse.s_l.to("cm").magnitude), 3),
    }


def _rebar_layouts(rebar: dict[str, Any]) -> dict[str, Any]:
    """What the user typed in check mode, in the same shape."""

    def face(values: dict[str, Any]) -> dict[str, Any]:
        layout: dict[str, Any] = {}
        for index, (count, diameter) in enumerate([("n1", "d1"), ("n2", "d2")], start=1):
            n = int(values.get(count) or 0)
            if n:
                layout[f"n{index}"] = n
                layout[f"d{index}"] = float(values.get(diameter) or 0)
        return layout

    bottom = face(rebar.get("bot") or {})
    if not bottom:
        raise InputError("rebar", "bottom")
    stirrups = rebar.get("stirrups") or {}
    n = int(stirrups.get("n") or 0)
    return {
        "bot": bottom,
        "top": face(rebar.get("top") or {}),
        "st": {"n": n, "d": float(stirrups.get("d") or 0), "s": float(stirrups.get("s") or 0)} if n else {},
    }


def _signature(layout: dict[str, Any]) -> str:
    """Short, stable name of a layout: what the URL keeps and what re-picks it after a recalc."""
    if "n" in layout:
        return f"{layout['n']:g}x{layout['d']:g}@{layout['s']:g}"
    return "+".join(f"{layout[f'n{i}']:g}x{layout[f'd{i}']:g}" for i in range(1, 5) if layout.get(f"n{i}"))


def _layout_bars(layout: dict[str, Any]) -> str:
    if not layout:
        return ""
    if "n" in layout:
        return f"{layout['n']:g}eØ{layout['d']:g}/{layout['s']:g} cm"
    counts: dict[float, int] = {}
    for index in range(1, 5):
        n = int(layout.get(f"n{index}") or 0)
        if n:
            counts[layout[f"d{index}"]] = counts.get(layout[f"d{index}"], 0) + n
    return " + ".join(f"{n}Ø{diameter:g}" for diameter, n in counts.items())


def _layout_area(layout: dict[str, Any]) -> str:
    """The steel a layout puts in: cm² on a face, cm²/m of stirrups."""
    if not layout:
        return ""
    if "n" in layout:
        legs = 2 * layout["n"] * math.pi * layout["d"] ** 2 / 4  # mm² per stirrup line
        return f"{legs / 100 / (layout['s'] / 100):.2f} cm²/m"
    total = sum(int(layout.get(f"n{i}") or 0) * math.pi * float(layout.get(f"d{i}") or 0) ** 2 / 4 for i in range(1, 5))
    return f"{total / 100:.2f} cm²"


def _apply_layouts(beam: RectangularBeam, layouts: dict[str, Any]) -> None:
    def kwargs(layout: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for index in range(1, 5):
            n = int(layout.get(f"n{index}") or 0)
            out[f"n{index}"] = n
            out[f"d_b{index}"] = layout[f"d{index}"] * mm if n else None
        return out

    beam.set_longitudinal_rebar_bot(**kwargs(layouts.get("bot") or {}))
    if layouts.get("top"):
        beam.set_longitudinal_rebar_top(**kwargs(layouts["top"]))
    stirrups = layouts.get("st") or {}
    if stirrups.get("n"):
        beam.set_transverse_rebar(n_stirrups=int(stirrups["n"]), d_b=stirrups["d"] * mm, s_l=stirrups["s"] * cm)


def _current_layouts(beam: RectangularBeam) -> dict[str, Any]:
    reinforcement = beam.reinforcement
    return {
        "bot": _layers_layout(reinforcement.bottom.layers),
        "top": _layers_layout(reinforcement.top.layers),
        "st": _stirrup_layout(reinforcement.transverse),
    }


# ----------------------------------------------------------------- design options


def _checked(data: dict[str, Any], forces: list[Forces], layouts: dict[str, Any]) -> tuple[RectangularBeam, Node]:
    """A fresh beam with these bars in it, checked. Fresh because designing or checking leaves
    state behind: the same design run twice on one beam does not give the same stirrups."""
    beam = _build_beam(data)
    node = Node(section=beam, forces=forces)
    _apply_layouts(beam, layouts)
    node.check()
    return beam, node


def _group_dcr(beam: RectangularBeam, group: str) -> float:
    if group == "st":
        return round(float(beam.shear_design.DCR), 3)
    face = beam.flexure_design.bottom if group == "bot" else beam.flexure_design.top
    return round(float(face.DCR), 3)


def _selected_layout(options: dict[str, Any], group: str, selected: dict[str, int]) -> dict[str, Any]:
    group_options = options.get(group) or [{}]
    index = min(selected.get(group, 0), len(group_options) - 1)
    return group_options[index].get("layout", {})


def _long_options(beam: RectangularBeam, face: Any, chosen: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    """The layouts mento's designer ranked for this face, its own pick first.

    mento keeps only the winner: ``flexure_design_results_bot`` is a single row and the ``Rebar``
    that ranked the rest is a local of the design. So the ranking is rebuilt here with the same
    public search; until mento exposes it, this is the only way to offer a second option.
    """
    layouts = [chosen] if chosen else []
    if face.A_s_req is None:
        return layouts
    try:
        # The ACI selector by name, but it is the selector every code uses: EN 1992 delegates to
        # it (choosing bars is geometry, not code) and its wrapper returns nothing to read.
        frame = Rebar(beam).longitudinal_rebar_ACI_318_19(face.A_s_req, face.A_s_max, None)
    except Exception:  # noqa: BLE001 - having no alternative is not an error
        return layouts
    seen = {_signature(layout) for layout in layouts}
    for row in frame.to_dict("records"):
        layout = _row_layout(row)
        if not layout or _signature(layout) in seen:
            continue
        seen.add(_signature(layout))
        layouts.append(layout)
        if len(layouts) == limit:
            break
    return layouts


def _stirrup_options(beam: RectangularBeam, chosen: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    """``beam.shear_design_results`` is public, but it holds one row per diameter at the first
    spacing that works, so rows sharing a spacing differ only in bar size: more steel and no
    trade-off. Those are dropped, and what is left is a real choice."""
    layouts = [chosen] if chosen else []
    frame = getattr(beam, "shear_design_results", None)
    if frame is None or frame.empty:
        return layouts
    lightest: dict[tuple[int, float], dict[str, Any]] = {}
    for row in frame.to_dict("records"):
        layout = {
            "n": int(row["n_stir"]),
            "d": round(float(row["d_b"].to("mm").magnitude), 3),
            "s": round(float(row["s_l"].to("cm").magnitude), 3),
        }
        key = (layout["n"], layout["s"])
        if key not in lightest or layout["d"] < lightest[key]["d"]:
            lightest[key] = layout
    seen = {_signature(layout) for layout in layouts}
    for layout in sorted(lightest.values(), key=lambda item: (item["n"], item["d"] ** 2 / item["s"])):
        if _signature(layout) in seen:
            continue
        seen.add(_signature(layout))
        layouts.append(layout)
        if len(layouts) == limit:
            break
    return layouts


def _options(beam: RectangularBeam, layouts: dict[str, Any], limit: int = 3) -> dict[str, list[dict[str, Any]]]:
    candidates = {
        "bot": _long_options(beam, beam.flexure_design.bottom, layouts["bot"], limit),
        "top": _long_options(beam, beam.flexure_design.top, layouts["top"], limit),
        "st": _stirrup_options(beam, layouts["st"], limit),
    }
    return {
        group: [
            {
                "bars": _layout_bars(layout),
                "area": _layout_area(layout),
                "signature": _signature(layout),
                "layout": layout,
            }
            for layout in group_layouts
            if layout
        ]
        for group, group_layouts in candidates.items()
    }


def _fill_option_dcrs(
    data: dict[str, Any],
    forces: list[Forces],
    options: dict[str, Any],
    selected: dict[str, int],
    current: dict[str, float],
) -> None:
    """The DCR beside an option is that option's, with the rest of the section as it stands."""
    for group, group_options in options.items():
        for index, option in enumerate(group_options):
            if index == selected.get(group, 0):
                option["dcr"] = current.get(group)
                continue
            layouts = {name: _selected_layout(options, name, selected) for name in options}
            layouts[group] = option["layout"]
            beam, _ = _checked(data, forces, layouts)
            option["dcr"] = _group_dcr(beam, group)


def _select(options: dict[str, Any], choice: dict[str, Any]) -> tuple[dict[str, int], list[str]]:
    """Keep the option the user picked if the new proposal still has it; otherwise fall back to
    mento's own and say which groups changed, so the page can flag them (5.4)."""
    selected: dict[str, int] = {}
    changed: list[str] = []
    for group, group_options in options.items():
        signatures = [option["signature"] for option in group_options]
        wanted = choice.get(group)
        if wanted in signatures:
            selected[group] = signatures.index(wanted)
        else:
            selected[group] = 0
            if wanted:
                changed.append(group)
    return selected, changed


# ------------------------------------------------------------- verdict and notices

CAPACITY = {"EN 1992-2004": {"M": "MRd", "V": "VRd"}}
DEFAULT_CAPACITY = {"M": "ØMn", "V": "ØVn"}


def _ledger(beam: RectangularBeam, forces: list[Forces], code: str) -> list[dict[str, Any]]:
    """One row per resistance check mento reports with a DCR: bottom flexure, top flexure, shear.
    Minimums and spacing limits are notices, not rows."""
    symbols = CAPACITY.get(code, DEFAULT_CAPACITY)
    demands = {force.label: force for force in forces}
    rows: list[dict[str, Any]] = []

    for key, name in (("flexure_bottom", "bottom"), ("flexure_top", "top")):
        checks = beam.flexure_check_results(forces)
        governing = max(checks, key=lambda check, name=name: getattr(check, name).DCR)
        check = getattr(governing, name)
        moment = float(demands[governing.label].M_y.to("kN*m").magnitude)
        loaded = moment > 0 if name == "bottom" else moment < 0
        rows.append(
            {
                "key": key,
                "dcr": round(float(check.DCR), 3) if loaded else None,
                "symbol": symbols["M"],
                "demand_symbol": "Mu",
                "capacity": round(float(check.M_capacity.to("kN*m").magnitude), 1) if check.M_capacity else None,
                "demand": round(abs(moment), 1) if loaded else None,
                "unit": "kNm",
                "combo": governing.label if loaded else None,
            }
        )

    governing_shear = max(beam.shear_check_results(forces), key=lambda check: check.DCR)
    shear_demand = abs(float(demands[governing_shear.label].V_z.to("kN").magnitude))
    rows.append(
        {
            "key": "shear",
            "dcr": round(float(governing_shear.DCR), 3),
            "symbol": symbols["V"],
            "demand_symbol": "Vu",
            "capacity": round(float(governing_shear.V_capacity.to("kN").magnitude), 1)
            if governing_shear.V_capacity
            else None,
            "demand": round(shear_demand, 1),
            "unit": "kN",
            "combo": governing_shear.label,
        }
    )
    return rows


def _below(value: Any, limit: Any, slack: float) -> bool:
    if value is None or limit is None:
        return False
    return float(value.to(limit.units).magnitude) < float(limit.magnitude) * slack


def _notices(beam: RectangularBeam, captured: list[Any]) -> list[dict[str, Any]]:
    """What mento flags about detailing: everything it raises as a warning, plus the minimums and
    maximums its public results expose. mento has no structured warning list yet, so the codes are
    named here and the page writes the sentence."""
    notices = [{"code": "mento", "values": {"message": str(item.message)}} for item in captured]
    for face, name in ((beam.flexure_design.bottom, "bottom"), (beam.flexure_design.top, "top")):
        if _below(face.A_s, face.A_s_min, 0.999):
            values = {"face": name, "A_s": _quantity(face.A_s, "cm**2"), "limit": _quantity(face.A_s_min, "cm**2")}
            notices.append({"code": "as_below_min", "values": values})
        if face.A_s_max is not None and _below(face.A_s_max, face.A_s, 1.0):
            values = {"face": name, "A_s": _quantity(face.A_s, "cm**2"), "limit": _quantity(face.A_s_max, "cm**2")}
            notices.append({"code": "as_above_max", "values": values})
    return notices


def _solve(data: dict[str, Any]) -> dict[str, Any]:
    lang = data.get("lang", "en")
    mento.set_language(lang if lang in mento.available_languages() else "en")
    forces = _build_forces(data)
    check_mode = data.get("mode") == "check"
    options: dict[str, Any] = {}
    selected: dict[str, int] = {}
    changed: list[str] = []

    if check_mode:
        layouts = _rebar_layouts(data.get("rebar") or {})
    else:
        designed = _build_beam(data)
        Node(section=designed, forces=forces).design()
        options = _options(designed, _current_layouts(designed))
        selected, changed = _select(options, data.get("choice") or {})
        layouts = {group: _selected_layout(options, group, selected) for group in options}

    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        beam, node = _checked(data, forces, layouts)
        flexure_table = node.check_flexure()
        shear_table = node.check_shear()

    if not check_mode:
        current = {group: _group_dcr(beam, group) for group in options}
        _fill_option_dcrs(data, forces, options, selected, current)

    flexure = beam.flexure_design
    shear = beam.shear_design
    return {
        "ok": True,
        "version": mento.__version__,
        "code": data["code"],
        "rebar": {group: _layout_bars(layout) for group, layout in layouts.items()},
        "layouts": layouts,
        "options": options,
        "selected": selected,
        "changed": changed,
        "ledger": _ledger(beam, forces, data["code"]),
        "notices": _notices(beam, list(captured)),
        "flexure": {"bottom": _face(flexure.bottom), "top": _face(flexure.top)},
        "shear": {
            "stirrups": _layout_bars(layouts.get("st") or {}),
            "A_v": _quantity(shear.A_v, "cm**2/m"),
            "A_v_req": _quantity(getattr(shear, "A_v_req", None), "cm**2/m"),
            "V_capacity": _quantity(getattr(shear, "V_capacity", None), "kN", 1),
            "DCR": round(float(shear.DCR), 3),
            "enough": _covers(shear.A_v, getattr(shear, "A_v_req", None)),
        },
        "tables": {"flexure": _table(flexure_table), "shear": _table(shear_table)},
        "section": _section(beam),
        "detailed": _detailed_text(node),
    }


def run(payload: str) -> str:
    """Design or check a beam. Never raises: errors come back as ``{"ok": false}``."""
    try:
        result = _solve(json.loads(payload))
    except InputError as error:
        result = {"ok": False, "kind": "input", "field": error.field, "message": str(error)}
    except Exception as error:  # noqa: BLE001 - everything must reach the page as JSON
        result = {"ok": False, "kind": "mento", "message": f"{type(error).__name__}: {error}"}
    return json.dumps(result)


def report(payload: str) -> str:
    """Build the Word report, flexure then shear in one file, as ``[{"name", "base64"}]``."""
    data = json.loads(payload)
    lang = data.get("lang", "en")
    mento.set_language(lang if lang in mento.available_languages() else "en")
    data["label"] = common.safe_label(str(data.get("label") or "B1"))
    forces = _build_forces(data)
    if data.get("mode") == "check":
        layouts = _rebar_layouts(data.get("rebar") or {})
    else:
        designed = _build_beam(data)
        Node(section=designed, forces=forces).design()
        options = _options(designed, _current_layouts(designed))
        selected, _ = _select(options, data.get("choice") or {})
        layouts = {group: _selected_layout(options, group, selected) for group in options}
    beam, node = _checked(data, forces, layouts)
    content = common.write_report([node.flexure_results_detailed_doc, node.shear_results_detailed_doc], beam.label)
    return json.dumps([{"name": f"{beam.label} - {data['code']}.docx", "base64": content}])
