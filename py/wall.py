"""Glue between the shear wall page and mento: JSON in, JSON out.

In-plane shear only, which is what mento checks today: a horizontal mesh that carries the shear
and a vertical mesh that covers the minimum::

    python -c "import wall, json; print(wall.run(json.dumps(wall.EXAMPLE)))"
"""

from __future__ import annotations

import json
import math
import warnings
from typing import Any

import common
import mento
from mento import Forces, ShearWall, cm, mm

# The worked example every visitor opens: a 20 cm wall, 3 m long, one storey high.
EXAMPLE: dict[str, Any] = {
    "code": "CIRSOC 201-25",
    "lang": "es",
    "mode": "design",
    "label": "T-101",
    "fc": 25,
    "fy": 420,
    "thickness": 20,
    "length": 300,
    "wall_height": 300,
    "cover": 25,
    "forces": [
        {"label": "1.2D+1.0E", "M_y": 0, "V_z": 700, "N_x": 400},
        {"label": "0.9D+1.0E", "M_y": 0, "V_z": 620, "N_x": 0},
    ],
}
GROUPS = ("horizontal", "vertical")
# ACI 318-19 §11.7.2.1 and §11.7.3.1, and EN 1992-1-1 §9.6: the mesh never wider than 45 cm.
MAX_SPACING = 45.0


def _build(data: dict[str, Any]) -> ShearWall:
    concrete, steel = common.materials(data)
    return ShearWall(
        label=common.label_of(data, "W1"),
        concrete=concrete,
        steel_bar=steel,
        c_c=common.number(data, "cover") * mm,
        thickness=common.number(data, "thickness") * cm,
        length=common.number(data, "length") * cm,
        height=common.number(data, "wall_height") * cm,
    )


def _mesh(wall: ShearWall, group: str) -> dict[str, Any]:
    """The mesh mento designed, read off the wall.

    ShearWall keeps its meshes in ``_d_b_h``/``_s_h`` and ``_d_b_v``/``_s_v`` and exposes no
    reading of them: ``reinforcement`` and ``shear_design`` still answer as the beam it inherits
    from, so they describe bars this wall does not have. Until mento exposes the mesh, this is
    the one place that reaches for it.
    """
    diameter = getattr(wall, "_d_b_h" if group == "horizontal" else "_d_b_v", None)
    spacing = getattr(wall, "_s_h" if group == "horizontal" else "_s_v", None)
    if diameter is None or spacing is None or spacing.magnitude == 0:
        return {}
    return {
        "d": round(float(diameter.to("mm").magnitude), 3),
        "s": round(float(spacing.to("cm").magnitude), 3),
    }


def _rebar_layouts(rebar: dict[str, Any]) -> dict[str, Any]:
    layouts = {}
    for group in GROUPS:
        values = rebar.get(group) or {}
        diameter, spacing = float(values.get("d") or 0), float(values.get("s") or 0)
        layouts[group] = {"d": diameter, "s": spacing} if diameter and spacing else {}
    if not layouts["horizontal"]:
        raise common.InputError("rebar", "horizontal")
    return layouts


def _apply(wall: ShearWall, layouts: dict[str, Any]) -> None:
    horizontal, vertical = layouts.get("horizontal") or {}, layouts.get("vertical") or {}
    if horizontal:
        wall.set_horizontal_rebar(d_b=horizontal["d"] * mm, s=horizontal["s"] * cm)
    if vertical:
        wall.set_vertical_rebar(d_b=vertical["d"] * mm, s=vertical["s"] * cm)


def _checked(data: dict[str, Any], forces: list[Forces], layouts: dict[str, Any]) -> tuple[ShearWall, Any]:
    """A fresh wall with those meshes in it, checked; the check table is the result."""
    wall = _build(data)
    _apply(wall, layouts)
    return wall, wall.check_shear(forces)


def _governing(frame: Any) -> int:
    """The row of the check table with the highest DCR, skipping mento's units row."""
    rows = frame.iloc[1:]
    return int(rows["DCR"].astype(float).idxmax()) - 1


def _dcr(frame: Any) -> float:
    return round(float(frame.iloc[1:]["DCR"].astype(float).max()), 3)


def _options(wall: ShearWall, frame: Any, layouts: dict[str, Any], limit: int = 3) -> dict[str, Any]:
    """Alternative meshes: the same steel ratio with another bar diameter.

    mento designs one mesh per direction and keeps no ranked list, so the alternatives are built
    from the ratio its own design had to reach — ρt,req for the horizontal mesh, ρl,min for the
    vertical one — and every one of them is then checked by mento.
    """
    index = _governing(frame)
    required = {
        "horizontal": max(
            float(common.row_value(frame, index, "ρt,req")), float(common.row_value(frame, index, "ρt,min"))
        ),
        "vertical": float(common.row_value(frame, index, "ρl,min")),
    }
    thickness = float(wall.thickness.to("cm").magnitude)
    options: dict[str, Any] = {}
    for group in GROUPS:
        # ρ = (two curtains × A_b) / (t × s), so the steel the ratio asks for is ρ·t·100 cm²/m
        # over both curtains, and half of that is what one curtain of the mesh has to provide.
        per_curtain = required[group] * thickness * 100 / 2
        candidates = common.spacing_options(per_curtain, layouts[group], limit, MAX_SPACING)
        options[group] = [
            {
                "bars": common.mesh_bars(layout),
                "area": common.mesh_area(layout, curtains=2),
                "signature": common.signature(layout),
                "layout": layout,
            }
            for layout in candidates
            if layout
        ]
    return options


def _ledger(frame: Any, code: str) -> list[dict[str, Any]]:
    """One row: in-plane shear, which is the only resistance mento checks on a wall today."""
    symbols = common.CAPACITY.get(code, common.DEFAULT_CAPACITY)
    index = _governing(frame)
    return [
        {
            "key": "shear_in_plane",
            "dcr": round(float(common.row_value(frame, index, "DCR")), 3),
            "symbol": symbols["V"],
            "demand_symbol": "Vu",
            "capacity": round(float(common.row_value(frame, index, "ØVn")), 1),
            "demand": round(float(common.row_value(frame, index, "Vu")), 1),
            "unit": "kN",
            "combo": str(common.row_value(frame, index, "Comb.")),
        }
    ]


def _notices(frame: Any, captured: list[Any]) -> list[dict[str, Any]]:
    """The wall's own minimums: the check table reports the ratios it asks for and the ones placed."""
    notices = [{"code": "mento", "values": {"message": str(item.message)}} for item in captured]
    index = _governing(frame)
    for placed, minimum, direction in (("ρt", "ρt,min", "horizontal"), ("ρl", "ρl,min", "vertical")):
        value = float(common.row_value(frame, index, placed))
        limit = float(common.row_value(frame, index, minimum))
        if value < limit * 0.999:
            notices.append(
                {
                    "code": "rho_below_min",
                    "values": {"face": direction, "A_s": f"{value:.4f}", "limit": f"{limit:.4f}"},
                }
            )
    return notices


def _section(wall: ShearWall, layouts: dict[str, Any]) -> dict[str, Any]:
    """A horizontal cut of the wall in cm: thickness across, length along, one dot per bar."""
    thickness = float(wall.thickness.to("cm").magnitude)
    length = float(wall.length.to("cm").magnitude)
    cover = float(wall.c_c.to("cm").magnitude)
    bars: list[dict[str, float]] = []
    vertical = layouts.get("vertical") or {}
    if vertical:
        diameter = vertical["d"] / 10
        spacing = vertical["s"]
        count = max(2, math.ceil(length / spacing))
        start = (length - (count - 1) * spacing) / 2
        for index in range(count):
            x = start + index * spacing
            if -1e-6 <= x <= length + 1e-6:
                for y in (cover + diameter / 2, thickness - cover - diameter / 2):
                    bars.append({"x": round(x, 3), "y": round(y, 3), "d": round(diameter, 3)})
    return {"length": length, "thickness": thickness, "cover": cover, "bars": bars}


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
        frame = designed.design_shear(forces)
        proposal = {group: _mesh(designed, group) for group in GROUPS}
        options = _options(designed, frame, proposal)
        selected, changed = common.select(options, data.get("choice") or {})
        layouts = {group: common.selected_layout(options, group, selected) for group in options}

    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        wall, frame = _checked(data, forces, layouts)
        detailed = common.detailed(wall.shear_results_detailed)

    if not check_mode:

        def evaluate(candidate: dict[str, Any], _group: str) -> float:
            return _dcr(_checked(data, forces, candidate)[1])

        current = {group: _dcr(frame) for group in options}
        common.fill_option_dcrs(options, selected, current, evaluate)
        # The vertical mesh is minimum steel: it has no DCR of its own, so it shows "—" (6).
        for option in options["vertical"]:
            option["dcr"] = None

    return {
        "ok": True,
        "version": mento.__version__,
        "code": data["code"],
        "rebar": {group: common.mesh_bars(layout) for group, layout in layouts.items()},
        "layouts": layouts,
        "options": options,
        "selected": selected,
        "changed": changed,
        "ledger": _ledger(frame, data["code"]),
        "notices": _notices(frame, list(captured)),
        "tables": {"shear": common.table(frame)},
        "section": _section(wall, layouts),
        **detailed,
    }


def run(payload: str) -> str:
    """Design or check a wall. Never raises: errors come back as ``{"ok": false}``."""
    try:
        result = _solve(json.loads(payload))
    except common.InputError as error:
        result = {"ok": False, "kind": "input", "field": error.field, "message": str(error)}
    except Exception as error:  # noqa: BLE001 - everything must reach the page as JSON
        result = {"ok": False, "kind": "mento", "message": f"{type(error).__name__}: {error}"}
    return json.dumps(result)


def report(payload: str) -> str:
    """Build the Word report of the shear check as ``[{"name", "base64"}]``."""
    data = json.loads(payload)
    lang = data.get("lang", "en")
    mento.set_language(lang if lang in mento.available_languages() else "en")
    data["label"] = common.safe_label(common.label_of(data, "W1"))
    forces = common.build_forces(data)
    if data.get("mode") == "check":
        layouts = _rebar_layouts(data.get("rebar") or {})
    else:
        designed = _build(data)
        frame = designed.design_shear(forces)
        options = _options(designed, frame, {group: _mesh(designed, group) for group in GROUPS})
        selected, _ = common.select(options, data.get("choice") or {})
        layouts = {group: common.selected_layout(options, group, selected) for group in options}
    wall, _ = _checked(data, forces, layouts)
    content = common.write_report([wall.shear_results_detailed_doc], wall.label)
    return json.dumps([{"name": f"{wall.label} - {data['code']}.docx", "base64": content}])
