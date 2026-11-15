"""Build two synthetic variable test fonts with an fvar table and no glyph variations (no gvar, CFF2 nor HVAR table).

Axis: wght 100..400..900, no avar. Glyphs: .notdef, A (U+0041), a triangle, and B, a wider triangle that no character
maps to, with an advance width of 500. The GSUB table has the feature variations of rvrn (fontTools
varLib.featureVars): A is substituted by B from the normalized wght 0.5 (650) to 1 (900).
- TestFvarOnly-CFF.otf: CFF outlines with fractional coordinates, A from 100.5 0 to 400.25 0 and 250.75 700.5, B from
  50.5 0 to 450.25 0 and 250.75 600.5 (T2CharStringPen without rounding);
- TestFvarOnly.ttf: TrueType outlines, the same triangles rounded to integers by the glyf table.

HarfBuzz 11.3.2 applies the feature variations at the coordinates of the fvar axes, and draws the CFF outlines with
their fractional coordinates:
hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900 <font> -u 0041 [2=0+500]
hb-shape --no-glyph-names --cluster-level=1 --variations=wght=400 <font> -u 0041 [1=0+500]
hb-view -O svg TestFvarOnly-CFF.otf A: M 100.5 0 L 400.25 0 L 250.75 -700.5 Z

usage: generate-fvar-only-fonts.py <output directory>
"""
import argparse
import os

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib.featureVars import addFeatureVariations

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Fvar Only"

ADVANCE_WIDTH = 500

CONTOURS = {
    ".notdef": [(0, 0), (500, 0), (500, 700)],
    "A": [(100.5, 0), (400.25, 0), (250.75, 700.5)],
    "B": [(50.5, 0), (450.25, 0), (250.75, 600.5)],
}

GLYPH_ORDER = [".notdef", "A", "B"]


def draw_contour(pen, contour):
    pen.moveTo(contour[0])
    for point in contour[1:]:
        pen.lineTo(point)
    pen.closePath()


def draw_charstring(contour):
    pen = T2CharStringPen(ADVANCE_WIDTH, None, roundTolerance=0)
    draw_contour(pen, contour)
    return pen.getCharString()


def round_contour(contour):
    return [(round(x), round(y)) for x, y in contour]


def draw_glyph(contour):
    pen = TTGlyphPen(None)
    draw_contour(pen, round_contour(contour))
    return pen.glyph()


def get_left_side_bearing(contour, is_truetype):
    """The xMin of the outline of a glyph, rounded down for the fractional CFF outlines."""
    return min(x for x, _ in (round_contour(contour) if is_truetype else contour)) // 1


def build_font(output_path, is_truetype):
    builder = FontBuilder(unitsPerEm=1000, isTTF=is_truetype)
    builder.setupGlyphOrder(GLYPH_ORDER)
    builder.setupCharacterMap({0x0041: "A"})
    ps_name = FAMILY_NAME.replace(" ", "") + "-Regular"
    if is_truetype:
        builder.setupGlyf({glyph_name: draw_glyph(CONTOURS[glyph_name]) for glyph_name in GLYPH_ORDER})
    else:
        charstrings = {glyph_name: draw_charstring(CONTOURS[glyph_name]) for glyph_name in GLYPH_ORDER}
        builder.setupCFF(ps_name, {"FullName": f"{FAMILY_NAME} Regular"}, charstrings, {})
    builder.setupHorizontalMetrics(
        {glyph_name: (ADVANCE_WIDTH, int(get_left_side_bearing(CONTOURS[glyph_name], is_truetype))) for glyph_name in GLYPH_ORDER}
    )
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable(
        {
            "copyright": "Generated with fontTools FontBuilder for the opentype.js test suite. Public domain (CC0 1.0 Universal).",
            "familyName": FAMILY_NAME,
            "styleName": "Regular",
            "fullName": f"{FAMILY_NAME} Regular",
            "psName": ps_name,
            "licenseDescription": "Public domain (CC0 1.0 Universal)",
            "licenseInfoURL": "https://creativecommons.org/publicdomain/zero/1.0/",
        }
    )
    # fsType 0: installable embedding, as the CC0 license allows
    builder.setupOS2(fsType=0, sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    builder.setupFvar(axes=[("wght", 100, 400, 900, "Weight")], instances=[])
    addFeatureVariations(builder.font, [([{"wght": (0.5, 1.0)}], {"A": "B"})], featureTag="rvrn")
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path, is_truetype):
    font = TTFont(output_path)
    assert "fvar" in font and "GSUB" in font
    assert not any(tag in font for tag in ("gvar", "CFF2", "HVAR")), "no glyph variations"
    assert ("glyf" in font) == is_truetype and ("CFF " in font) != is_truetype
    pen = RecordingPen()
    font.getGlyphSet()["A"].draw(pen)
    print(f"{output_path}: A {pen.value}, ok")


def main():
    parser = argparse.ArgumentParser(description="Build two variable test fonts with an fvar table and no glyph variations.")
    parser.add_argument("output_directory", help="directory of the fonts to write")
    arguments = parser.parse_args()
    for file_name, is_truetype in (("TestFvarOnly-CFF.otf", False), ("TestFvarOnly.ttf", True)):
        output_path = os.path.join(arguments.output_directory, file_name)
        build_font(output_path, is_truetype)
        verify_font(output_path, is_truetype)


if __name__ == "__main__":
    main()
