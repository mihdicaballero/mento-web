"""Glue between the one-way slab page and mento: JSON in, JSON out.

A strip of the width the user defines, reinforced with a diameter at a spacing on each face::

    python -c "import slab, json; print(slab.run(json.dumps(slab.EXAMPLE)))"
"""

from __future__ import annotations

import json
import math
import warnings
from typing import Any

import common
import mento
from mento import Node, OneWaySlab, cm, mm

# The worked example every visitor opens: a 20 cm slab spanning about 5 m, with a support moment.
EXAMPLE: dict[str, Any] = {
    "code": "CIRSOC 201-25",
    "lang": "es",
    "mode": "design",
    "label": "L-101",
    "fc": 25,
    "fy": 420,
    "width": 100,
    "height": 20,
    "cover": 20,
    "forces": [
        {"label": "1.2D+1.6L", "M_y": 32, "V_z": 38, "N_x": 0},
        {"label": "1.2D+1.6L (apoyo)", "M_y": -22, "V_z": 45, "N_x": 0},
    ],
}
GROUPS = ("bot", "top")


def _build(data: dict[str, Any]) -> OneWaySlab:
    concrete, steel = common.materials(data)
    return OneWaySlab(
        label=common.label_of(data, "L1"),
        concrete=concrete,
        steel_bar=steel,
        width=common.number(data, "width") * cm,
        height=common.number(data, "height") * cm,
        c_c=common.number(data, "cover") * mm,
    )


def _layer_layout(layers: Any) -> dict[str, Any]:
    """A slab face is one diameter at one spacing, which is how it is drawn and ordered."""
    for layer in layers:
        if layer.n and layer.s is not None:
            return {
                "d": round(float(layer.d_b.to("mm").magnitude), 3),
                "s": round(float(layer.s.to("cm").magnitude), 3),
            }
    return {}


def _rebar_layouts(rebar: dict[str, Any]) -> dict[str, Any]:
    """What the user typed in check mode, in the same shape."""
    layouts = {}
    for group in GROUPS:
        values = rebar.get(group) or {}
        diameter, spacing = float(values.get("d") or 0), float(values.get("s") or 0)
        layouts[group] = {"d": diameter, "s": spacing} if diameter and spacing else {}
    if not layouts["bot"]:
        raise common.InputError("rebar", "bottom")
    return layouts


def _apply(slab: OneWaySlab, layouts: dict[str, Any]) -> None:
    bottom, top = layouts.get("bot") or {}, layouts.get("top") or {}
    if bottom:
        slab.set_slab_longitudinal_rebar_bot(d_b1=bottom["d"] * mm, s_b1=bottom["s"] * cm)
    if top:
        slab.set_slab_longitudinal_rebar_top(d_b1=top["d"] * mm, s_b1=top["s"] * cm)


def _checked(data: dict[str, Any], forces: list[Any], layouts: dict[str, Any]) -> tuple[OneWaySlab, Node]:
    """A fresh strip with that mesh in it, checked. Fresh because designing or checking leaves
    state behind on the section."""
    slab = _build(data)
    node = Node(section=slab, forces=forces)
    _apply(slab, layouts)
    node.check()
    return slab, node


def _face(slab: OneWaySlab, group: str) -> Any:
    return slab.flexure_design.bottom if group == "bot" else slab.flexure_design.top


def _options(data: dict[str, Any], slab: OneWaySlab, layouts: dict[str, Any], limit: int = 3) -> dict[str, Any]:
    # The spacing limit of a slab: three times its thickness, and never more than 40 cm.
    max_spacing = min(3 * common.number(data, "height"), 40.0)
    options: dict[str, Any] = {}
    for group in GROUPS:
        face = _face(slab, group)
        required = float(face.A_s_req.to("cm**2").magnitude) if face.A_s_req is not None else 0.0
        strip = common.number(data, "width")
        candidates = common.spacing_options(required / strip * 100, layouts[group], limit, max_spacing)
        options[group] = [
            {
                "bars": common.mesh_bars(layout),
                "area": common.mesh_area(layout),
                "signature": common.signature(layout),
                "layout": layout,
            }
            for layout in candidates
            if layout
        ]
    return options


def _ledger(slab: OneWaySlab, forces: list[Any], code: str) -> list[dict[str, Any]]:
    """Bottom flexure, top flexure and shear: the three resistances mento reports with a DCR."""
    symbols = common.CAPACITY.get(code, common.DEFAULT_CAPACITY)
    demands = {force.label: force for force in forces}
    rows = []
    for key, name in (("flexure_bottom", "bottom"), ("flexure_top", "top")):
        governing = max(slab.flexure_check_results(forces), key=lambda check, name=name: getattr(check, name).DCR)
        check = getattr(governing, name)
        moment = float(demands[governing.label].M_y.to("kN*m").magnitude)
        loaded = moment > 0 if name == "bottom" else moment < 0
        rows.append(
            {
                "key": key,
                "dcr": round(float(check.DCR), 3) if loaded else None,
                "symbol": symbols["M"],
                "demand_symbol": "Mu",
                "capacity": common.magnitude(check.M_capacity, "kN*m"),
                "demand": round(abs(moment), 1) if loaded else None,
                "unit": "kNm",
                "combo": governing.label if loaded else None,
            }
        )
    shear = max(slab.shear_check_results(forces), key=lambda check: check.DCR)
    rows.append(
        {
            "key": "shear",
            "dcr": round(float(shear.DCR), 3),
            "symbol": symbols["V"],
            "demand_symbol": "Vu",
            "capacity": common.magnitude(shear.V_capacity, "kN"),
            "demand": round(abs(float(demands[shear.label].V_z.to("kN").magnitude)), 1),
            "unit": "kN",
            "combo": shear.label,
        }
    )
    return rows


def _section(slab: OneWaySlab, layouts: dict[str, Any]) -> dict[str, Any]:
    """The strip in cm, with the bars of each face placed along it, for the page to draw."""
    width = float(slab.width.to("cm").magnitude)
    height = float(slab.height.to("cm").magnitude)
    cover = float(slab.c_c.to("cm").magnitude)
    bars: list[dict[str, float]] = []
    for group, bottom in (("bot", True), ("top", False)):
        layout = layouts.get(group) or {}
        if not layout:
            continue
        diameter = layout["d"] / 10
        spacing = layout["s"]
        count = max(1, math.ceil(width / spacing))
        start = (width - (count - 1) * spacing) / 2
        y = cover + diameter / 2 if bottom else height - cover - diameter / 2
        for index in range(count):
            x = start + index * spacing
            if -1e-6 <= x <= width + 1e-6:
                bars.append({"x": round(x, 3), "y": round(y, 3), "d": round(diameter, 3)})
    return {"width": width, "height": height, "cover": cover, "bars": bars}


def _solve(data: dict[str, Any]) -> dict[str, Any]:
    lang = data.get("lang", "en")
    mento.set_language(lang if lang in mento.available_languages() else "en")
    forces = common.build_forces(data)
    check_mode = data.get("mode") == "check"
    options: dict[str, Any] = {}
    selected: dict[str, int] = {}
    changed: list[str] = []

    if check_mode:
        layouts = _rebar_layouts(data.get("rebar") or {})
    else:
        designed = _build(data)
        Node(section=designed, forces=forces).design()
        proposal = {
            group: _layer_layout(getattr(designed.reinforcement, "bottom" if group == "bot" else "top").layers)
            for group in GROUPS
        }
        options = _options(data, designed, proposal)
        selected, changed = common.select(options, data.get("choice") or {})
        layouts = {group: common.selected_layout(options, group, selected) for group in options}

    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        slab, node = _checked(data, forces, layouts)
        flexure_table = node.check_flexure()
        shear_table = node.check_shear()

    if not check_mode:

        def evaluate(candidate: dict[str, Any], group: str) -> float:
            other, _ = _checked(data, forces, candidate)
            return round(float(_face(other, group).DCR), 3)

        current = {group: round(float(_face(slab, group).DCR), 3) for group in options}
        common.fill_option_dcrs(options, selected, current, evaluate)

    detailed = common.detailed(node.flexure_results_detailed, node.shear_results_detailed)
    return {
        "ok": True,
        "version": mento.__version__,
        "code": data["code"],
        "rebar": {group: common.mesh_bars(layout) for group, layout in layouts.items()},
        "layouts": layouts,
        "options": options,
        "selected": selected,
        "changed": changed,
        "ledger": _ledger(slab, forces, data["code"]),
        "notices": common.flexure_notices(slab, forces, detailed["reports"], list(captured)),
        "tables": {"flexure": common.table(flexure_table), "shear": common.table(shear_table)},
        "section": _section(slab, layouts),
        **detailed,
    }


def run(payload: str) -> str:
    """Design or check a slab strip. Never raises: errors come back as ``{"ok": false}``."""
    try:
        result = _solve(json.loads(payload))
    except common.InputError as error:
        result = {"ok": False, "kind": "input", "field": error.field, "message": str(error)}
    except Exception as error:  # noqa: BLE001 - everything must reach the page as JSON
        result = {"ok": False, "kind": "mento", "message": f"{type(error).__name__}: {error}"}
    return json.dumps(result)


def report(payload: str) -> str:
    """Build the Word report, flexure then shear in one file, as ``[{"name", "base64"}]``."""
    data = json.loads(payload)
    lang = data.get("lang", "en")
    mento.set_language(lang if lang in mento.available_languages() else "en")
    data["label"] = common.safe_label(common.label_of(data, "L1"))
    forces = common.build_forces(data)
    if data.get("mode") == "check":
        layouts = _rebar_layouts(data.get("rebar") or {})
    else:
        designed = _build(data)
        Node(section=designed, forces=forces).design()
        proposal = {
            group: _layer_layout(getattr(designed.reinforcement, "bottom" if group == "bot" else "top").layers)
            for group in GROUPS
        }
        options = _options(data, designed, proposal)
        selected, _ = common.select(options, data.get("choice") or {})
        layouts = {group: common.selected_layout(options, group, selected) for group in options}
    slab, node = _checked(data, forces, layouts)
    content = common.write_report([node.flexure_results_detailed_doc, node.shear_results_detailed_doc], slab.label)
    return json.dumps([{"name": f"{slab.label} - {data['code']}.docx", "base64": content}])
