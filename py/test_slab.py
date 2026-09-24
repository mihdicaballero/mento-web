"""The one-way slab glue, exercised without a browser."""

import base64
import io
import itertools
import json

import docx
import pytest

import slab

CODES = ["ACI 318-19", "CIRSOC 201-25", "EN 1992-2004"]


def solve(**changes):
    return json.loads(slab.run(json.dumps({**slab.EXAMPLE, **changes})))


@pytest.mark.parametrize("code", CODES)
def test_design_passes_for_every_code(code):
    result = solve(code=code)
    assert result["ok"], result
    assert result["rebar"]["bot"].startswith("Ø")
    assert max(row["dcr"] or 0 for row in result["ledger"]) <= 1


def test_the_worked_example_is_used_between_07_and_09():
    """The first impression: a slab that passes, with room to spare but not too much (6)."""
    governing = max(row["dcr"] or 0 for row in solve()["ledger"])
    assert 0.7 <= governing <= 0.9, governing


def test_a_face_is_one_diameter_at_one_spacing():
    result = solve()
    assert result["layouts"]["bot"].keys() == {"d", "s"}
    assert result["rebar"]["bot"] == f"Ø{result['layouts']['bot']['d']:g} c/{result['layouts']['bot']['s']:g} cm"


def test_alternatives_are_other_diameters_of_the_same_steel():
    options = solve()["options"]["bot"]
    assert len(options) > 1
    assert len({option["layout"]["d"] for option in options}) == len(options)
    for option in options:
        assert 10 <= option["layout"]["s"] <= 40  # never tighter than 10 cm, never wider than 3h
        assert option["dcr"] <= 1.02
    areas = [float(option["area"].split()[0]) for option in options]
    assert max(areas) - min(areas) < max(areas) * 0.25  # the same steel, laid out differently


def test_a_chosen_option_survives_a_recalculation():
    first = solve()
    wanted = first["options"]["bot"][1]
    again = solve(choice={"bot": wanted["signature"]})
    assert again["selected"]["bot"] == 1
    assert again["rebar"]["bot"] == wanted["bars"] and again["changed"] == []


def test_ledger_is_bottom_flexure_top_flexure_and_shear():
    ledger = solve()["ledger"]
    assert [row["key"] for row in ledger] == ["flexure_bottom", "flexure_top", "shear"]
    assert ledger[1]["combo"] == "1.2D+1.6L (apoyo)"  # the only combination with a negative moment
    assert ledger[2]["unit"] == "kN" and ledger[0]["unit"] == "kNm"


def test_check_mode_takes_the_mesh_the_user_typed():
    result = solve(mode="check", rebar={"bot": {"d": 12, "s": 15}, "top": {"d": 10, "s": 20}})
    assert result["ok"], result
    assert result["rebar"] == {"bot": "Ø12 c/15 cm", "top": "Ø10 c/20 cm"}
    assert result["options"] == {}


def test_a_strip_without_bottom_reinforcement_is_an_input_error():
    result = solve(mode="check", rebar={"bot": {}, "top": {"d": 10, "s": 20}})
    assert result == {"ok": False, "kind": "input", "field": "rebar", "message": "bottom"}


def test_the_drawing_places_a_bar_every_spacing():
    section = solve()["section"]
    bottom = sorted(bar["x"] for bar in section["bars"] if bar["y"] < section["height"] / 2)
    spacing = solve()["layouts"]["bot"]["s"]
    assert len(bottom) >= 2
    assert all(abs(second - first - spacing) < 1e-6 for first, second in itertools.pairwise(bottom))
    assert 0 <= bottom[0] and bottom[-1] <= section["width"]


def test_tables_are_mentos_own():
    tables = solve()["tables"]
    assert tables["flexure"]["columns"][:3] == ["Label", "Comb.", "Position"]
    assert tables["shear"]["columns"][-1] == "DCR"


def test_report_is_one_word_file_with_flexure_and_shear():
    (file,) = json.loads(slab.report(json.dumps({**slab.EXAMPLE, "lang": "en", "label": "L1/2"})))
    assert file["name"] == "L1_2 - CIRSOC 201-25.docx"
    document = docx.Document(io.BytesIO(base64.b64decode(file["base64"])))
    text = " ".join(paragraph.text.lower() for paragraph in document.paragraphs)
    assert "flexur" in text and "shear" in text


def test_the_worked_example_has_no_errors():
    # its top steel is under the 4/3 of the calculated steel that waives the minimum: a warning,
    # as mento's table of checks says, not a strength shortfall
    notices = solve()["notices"]
    assert not [notice for notice in notices if notice["severity"] == "bad"], notices
    assert any(notice["code"] == "as_below_min" for notice in notices)


def test_bars_closer_than_the_minimum_clear_spacing_fail():
    result = solve(mode="check", rebar={"bot": {"d": 16, "s": 3}, "top": {"d": 12, "s": 25}})
    spacing = [notice for notice in result["notices"] if notice["code"] == "spacing"]
    assert spacing and spacing[0]["severity"] == "bad" and spacing[0]["values"]["face"] == "bottom"
