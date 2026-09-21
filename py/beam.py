"""Glue between the web page and mento: JSON in, JSON out.

Runs inside Pyodide in the browser, but has no Pyodide-specific code, so it can
be exercised from a normal interpreter too::

    python -c "import beam, json; print(beam.run(json.dumps(beam.EXAMPLE)))"
"""

from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import tempfile
from typing import Any, Dict, List, Optional

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

import mento  # noqa: E402
from mento import (  # noqa: E402
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

CONCRETES = {
    "ACI 318-19": Concrete_ACI_318_19,
    "CIRSOC 201-25": Concrete_CIRSOC_201_25,
    "EN 1992-2004": Concrete_EN_1992_2004,
}

EXAMPLE: Dict[str, Any] = {
    "code": "ACI 318-19",
    "lang": "en",
    "mode": "design",
    "label": "V101",
    "fc": 25,
    "fy": 420,
    "width": 20,
    "height": 60,
    "cover": 25,
    "forces": [
        {"label": "1.4D", "M_y": 60, "V_z": 80, "N_x": 0},
        {"label": "1.2D+1.6L", "M_y": 100, "V_z": 120, "N_x": 0},
    ],
}


class InputError(ValueError):
    """A problem with what the user typed, reported back by field name."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


def _number(data: Dict[str, Any], key: str, *, positive: bool = True) -> float:
    try:
        value = float(data.get(key))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise InputError(key, "missing") from None
    if value != value or (positive and value <= 0):
        raise InputError(key, "positive")
    return value


def _quantity(value: Any, unit: str, precision: int = 2) -> Optional[str]:
    if value is None:
        return None
    return f"{value.to(unit):.{precision}f~P}"


def _covers(provided: Any, required: Any) -> bool:
    """Whether the steel placed reaches the steel required (which already includes the minimum)."""
    if required is None:
        return True
    return bool(provided.to(required.units).magnitude >= required.magnitude * 0.999)


def _build_beam(data: Dict[str, Any]) -> RectangularBeam:
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


def _build_forces(data: Dict[str, Any]) -> List[Forces]:
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


def _apply_rebar(beam: RectangularBeam, rebar: Dict[str, Any]) -> None:
    def face(values: Dict[str, Any]) -> Dict[str, Any]:
        n1, n2 = int(values.get("n1") or 0), int(values.get("n2") or 0)
        d1, d2 = float(values.get("d1") or 0), float(values.get("d2") or 0)
        return {"n1": n1, "d_b1": d1 * mm if n1 else None, "n2": n2, "d_b2": d2 * mm if n2 else None}

    bottom = face(rebar.get("bot") or {})
    if not bottom["n1"]:
        raise InputError("rebar", "bottom")
    beam.set_longitudinal_rebar_bot(**bottom)
    top = face(rebar.get("top") or {})
    if top["n1"]:
        beam.set_longitudinal_rebar_top(**top)
    stirrups = rebar.get("stirrups") or {}
    n = int(stirrups.get("n") or 0)
    if n:
        beam.set_transverse_rebar(
            n_stirrups=n, d_b=float(stirrups.get("d") or 0) * mm, s_l=float(stirrups.get("s") or 0) * cm
        )


def _section_svg(beam: RectangularBeam) -> str:
    fig = beam.plot()
    buffer = io.StringIO()
    fig.savefig(buffer, format="svg", bbox_inches="tight", transparent=True)
    plt.close(fig)
    svg = buffer.getvalue()
    return svg[svg.index("<svg") :]


def _table(frame: Any) -> str:
    return str(frame.to_html(index=False, border=0, na_rep="–", float_format=lambda x: f"{x:.2f}"))


def _detailed_text(node: Node) -> str:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        node.flexure_results_detailed()
        node.shear_results_detailed()
    return out.getvalue()


def _bars(layers: Any) -> str:
    """``3Ø16 + 2Ø12``: bars of one diameter are counted together, the way they are ordered on site."""
    counts: Dict[float, int] = {}
    for layer in layers:
        diameter = float(layer.d_b.to("mm").magnitude)
        counts[diameter] = counts.get(diameter, 0) + layer.n
    return " + ".join(f"{n}Ø{diameter:g}" for diameter, n in counts.items())


def _face(face: Any) -> Dict[str, Any]:
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


def _solve(data: Dict[str, Any]) -> Dict[str, Any]:
    lang = data.get("lang", "en")
    mento.set_language(lang if lang in mento.available_languages() else "en")

    beam = _build_beam(data)
    node = Node(section=beam, forces=_build_forces(data))
    if data.get("mode") == "check":
        _apply_rebar(beam, data.get("rebar") or {})
        node.check()
    else:
        node.design()

    flexure_table = node.check_flexure()
    shear_table = node.check_shear()
    flexure = beam.flexure_design
    shear = beam.shear_design
    reinforcement = beam.reinforcement

    return {
        "ok": True,
        "version": mento.__version__,
        "code": data["code"],
        "flexure": {"bottom": _face(flexure.bottom), "top": _face(flexure.top)},
        "shear": {
            "stirrups": str(reinforcement.transverse).replace(" mm/", "/") if shear.n_stirrups else "",
            "A_v": _quantity(shear.A_v, "cm**2/m"),
            "A_v_req": _quantity(getattr(shear, "A_v_req", None), "cm**2/m"),
            "V_capacity": _quantity(getattr(shear, "V_capacity", None), "kN", 1),
            "DCR": round(float(shear.DCR), 3),
            "enough": _covers(shear.A_v, getattr(shear, "A_v_req", None)),
        },
        "tables": {"flexure": _table(flexure_table), "shear": _table(shear_table)},
        "svg": _section_svg(beam),
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
    """Build the Word reports and return them as ``[{"name", "base64"}]``."""
    data = json.loads(payload)
    lang = data.get("lang", "en")
    mento.set_language(lang if lang in mento.available_languages() else "en")
    beam = _build_beam(data)
    node = Node(section=beam, forces=_build_forces(data))
    if data.get("mode") == "check":
        _apply_rebar(beam, data.get("rebar") or {})
        node.check()
    else:
        node.design()

    previous = os.getcwd()
    files = []
    with tempfile.TemporaryDirectory() as folder:
        os.chdir(folder)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                node.flexure_results_detailed_doc()
                node.shear_results_detailed_doc()
            for name in sorted(os.listdir(folder)):
                with open(os.path.join(folder, name), "rb") as handle:
                    files.append({"name": name, "base64": base64.b64encode(handle.read()).decode("ascii")})
        finally:
            os.chdir(previous)
    return json.dumps(files)
