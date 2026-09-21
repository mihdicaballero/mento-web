"""The glue is plain Python, so it is tested without a browser."""

import json

import pytest

import beam

CODES = ["ACI 318-19", "CIRSOC 201-25", "EN 1992-2004"]


def solve(**changes):
    return json.loads(beam.run(json.dumps({**beam.EXAMPLE, **changes})))


@pytest.mark.parametrize("code", CODES)
def test_design_passes_for_every_code(code):
    result = solve(code=code)
    assert result["ok"], result
    assert result["flexure"]["bottom"]["bars"]
    assert result["flexure"]["bottom"]["DCR"] <= 1
    assert result["shear"]["DCR"] <= 1
    assert result["svg"].startswith("<svg")


def test_check_mode_reports_insufficient_rebar():
    rebar = {"bot": {"n1": 2, "d1": 10}, "top": {}, "stirrups": {"n": 1, "d": 6, "s": 20}}
    result = solve(mode="check", rebar=rebar)
    assert result["ok"], result
    assert result["flexure"]["bottom"]["bars"] == "2Ø10"
    assert result["flexure"]["bottom"]["DCR"] > 1


def test_same_diameter_bars_are_counted_together():
    rebar = {"bot": {"n1": 2, "d1": 16, "n2": 1, "d2": 16}, "top": {}, "stirrups": {}}
    assert solve(mode="check", rebar=rebar)["flexure"]["bottom"]["bars"] == "3Ø16"


@pytest.mark.parametrize("field", ["fc", "fy", "width", "height", "cover"])
def test_bad_number_names_the_field(field):
    result = solve(**{field: ""})
    assert result == {"ok": False, "kind": "input", "field": field, "message": "missing"}


def test_no_forces_is_an_input_error():
    assert solve(forces=[{"M_y": 0, "V_z": 0}])["field"] == "forces"


def test_report_returns_two_word_files():
    files = json.loads(beam.report(json.dumps(beam.EXAMPLE)))
    assert len(files) == 2
    assert all(f["name"].endswith(".docx") and f["base64"] for f in files)
