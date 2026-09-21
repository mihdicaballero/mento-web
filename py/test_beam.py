"""The glue is plain Python, so it is tested without a browser."""

import base64
import io
import json

import docx
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
    assert "svg" not in result  # the page draws the section itself; matplotlib is never loaded there


def test_section_places_every_bar_inside_the_stirrup():
    rebar = {
        "bot": {"n1": 2, "d1": 16, "n2": 1, "d2": 12},
        "top": {"n1": 2, "d1": 10},
        "stirrups": {"n": 1, "d": 8, "s": 15},
    }
    section = solve(mode="check", rebar=rebar)["section"]
    assert section["stirrups"] == {"n": 1, "d": 0.8}
    assert sorted(bar["d"] for bar in section["bars"]) == [1.0, 1.0, 1.2, 1.6, 1.6]
    edge = section["cover"] + section["stirrups"]["d"]
    for bar in section["bars"]:
        assert edge <= bar["x"] - bar["d"] / 2 and bar["x"] + bar["d"] / 2 <= section["width"] - edge + 1e-9
        assert edge <= bar["y"] - bar["d"] / 2 and bar["y"] + bar["d"] / 2 <= section["height"] - edge + 1e-9
    bottom = [bar for bar in section["bars"] if bar["y"] < section["height"] / 2]
    assert [bar["x"] for bar in sorted(bottom, key=lambda bar: bar["x"])][1] == section["width"] / 2


def test_section_moves_bars_that_do_not_fit_to_a_second_row():
    result = solve(width=12, height=30, forces=[{"label": "U", "M_y": 40, "V_z": 50}])
    assert result["ok"], result
    bottom = [bar for bar in result["section"]["bars"] if bar["y"] < result["section"]["height"] / 2]
    assert len({bar["y"] for bar in bottom}) == 2, result["flexure"]["bottom"]["bars"]


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


def test_report_is_one_word_file_with_flexure_and_shear():
    (file,) = json.loads(beam.report(json.dumps({**beam.EXAMPLE, "label": "V1/2"})))
    assert file["name"] == "V1_2 - ACI 318-19.docx"
    document = docx.Document(io.BytesIO(base64.b64decode(file["base64"])))
    text = " ".join(paragraph.text.lower() for paragraph in document.paragraphs)
    assert "flexur" in text and "shear" in text
    assert len(document.tables) >= 8
