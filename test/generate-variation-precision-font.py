"""Build a synthetic variable TrueType test font for the precision of the gvar variations.

Axes: wght 100..400..900 and wdth 50..100..100 (its default is its maximum). No avar and no
HVAR: the advance widths vary through the gvar phantom points only. Glyphs:

- NULL (U+0000, a name other than .null) and space (U+0020): no outline; the space has one
  tuple at wght max, all points (its 4 phantom points), that moves its right phantom point by 100.
- H (U+0048), a square of 4 points: two tuples with the same point numbers, point 0 and the
  right phantom point (4 + 1), become the shared points of the glyph, the third tuple has all
  the points (private point numbers with a count of 0):
      wght max (0, 1, 1)                   point 0 x +1 (the contour moves with it, IUP), right phantom +40
      wdth min (-1, -1, 0)                 point 0 x +1, right phantom -20
      wght max and wdth min (the corner)   right phantom +10, point 2 y +3, all points
  At wght 650, wdth 75 the normalized location is (0.5, -0.5) and the scalars 0.5, 0.5 and 0.25:
  the x of the contour is 100 + 0.5 + 0.5 = 101 when the deltas are rounded once, 102 when they
  are rounded after each tuple; the advance width is 600 + 20 - 10 + 2.5 = 612.5, 613.
- period (U+002E), a square of 4 points, no variation. GSUB FeatureVariations: rvrn substitutes
  it with space from the normalized wght 8203/16384 up, the F2Dot14 of wght 650.32 in the OpenType
  16.16 normalization (fontTools varLib.instancer.normalize gives 8202/16384 there).
- Hdot (U+1E22), a composite of H and of period (offset 250, 800): one tuple at wght max, all
  points (2 components and 4 phantom points), that moves the period by (0, 100), the left
  phantom point by 20 and the right phantom point by 60.
- A (U+0041) and V (U+0056), triangles of 3 points, no variation, after Hdot. GPOS kern with
  variable values (GDEF item variation store, one region at wght max): A V 0 at wght 400 and -85
  at wght 900, V A 100 and 15. At wght 650 the scalar is 0.5 and the deltas exactly -42.5: the
  kerning is -42 and 57.5, 58, like HarfBuzz.

usage: generate-variation-precision-font.py <output.ttf>
"""
import argparse

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.varLib.featureVars import addFeatureVariations

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Variation Precision"

WEIGHT_MAX = {"wght": (0, 1, 1)}
WIDTH_MIN = {"wdth": (-1, -1, 0)}
CORNER = {"wght": (0, 1, 1), "wdth": (-1, -1, 0)}

# glyph name, codepoint, advance width, contours (lists of points)
SIMPLE_GLYPHS = [
    (".notdef", None, 500, [[(100, 0), (100, 700), (400, 700), (400, 0)]]),
    ("NULL", 0x0000, 0, []),
    ("space", 0x0020, 250, []),
    ("H", 0x0048, 600, [[(100, 0), (100, 700), (500, 700), (500, 0)]]),
    ("period", 0x002E, 250, [[(75, 0), (75, 100), (175, 100), (175, 0)]]),
]

COMPOSITE_NAME = "Hdot"
COMPOSITE_CODEPOINT = 0x1E22
COMPOSITE_COMPONENTS = [("H", (0, 0)), ("period", (250, 800))]

# after the composite glyph, so that the indexes of the glyphs above do not change
KERNING_GLYPHS = [
    ("A", 0x0041, 600, [[(20, 0), (300, 700), (580, 0)]]),
    ("V", 0x0056, 600, [[(20, 700), (580, 700), (300, 0)]]),
]

# feaLib variable scalars, in user coordinates
KERNING_FEATURES = """
feature kern {
    pos A V (wght=400:0 wght=900:-85);
    pos V A (wght=400:100 wght=900:15);
} kern;
"""

# deltas: one (x, y) or None per point, then the 4 phantom points (left, right, top, bottom)
VARIATIONS = {
    "space": [
        TupleVariation(WEIGHT_MAX, [(0, 0), (100, 0), (0, 0), (0, 0)]),
    ],
    "H": [
        TupleVariation(WEIGHT_MAX, [(1, 0), None, None, None, None, (40, 0), None, None]),
        TupleVariation(WIDTH_MIN, [(1, 0), None, None, None, None, (-20, 0), None, None]),
        TupleVariation(CORNER, [(0, 0), (0, 0), (0, 3), (0, 0), (0, 0), (10, 0), (0, 0), (0, 0)]),
    ],
    COMPOSITE_NAME: [
        TupleVariation(WEIGHT_MAX, [(0, 0), (0, 100), (20, 0), (60, 0), (0, 0), (0, 0)]),
    ],
}

# the region of the rvrn substitution, in normalized coordinates (F2Dot14)
PERIOD_SUBSTITUTION_MIN_WEIGHT = 8203 / 16384
CONDITIONAL_SUBSTITUTIONS = [([{"wght": (PERIOD_SUBSTITUTION_MIN_WEIGHT, 1)}], {"period": "space"})]


def draw_glyph(contours):
    pen = TTGlyphPen(None)
    for contour in contours:
        pen.moveTo(contour[0])
        for point in contour[1:]:
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def draw_composite(components, glyphs):
    pen = TTGlyphPen(glyphs)
    for glyph_name, offset in components:
        pen.addComponent(glyph_name, (1, 0, 0, 1, offset[0], offset[1]))
    return pen.glyph()


def build_font(output_path):
    glyph_order = (
        [glyph_name for glyph_name, _, _, _ in SIMPLE_GLYPHS]
        + [COMPOSITE_NAME]
        + [glyph_name for glyph_name, _, _, _ in KERNING_GLYPHS]
    )
    character_map = {codepoint: glyph_name for glyph_name, codepoint, _, _ in SIMPLE_GLYPHS + KERNING_GLYPHS if codepoint is not None}
    character_map[COMPOSITE_CODEPOINT] = COMPOSITE_NAME
    glyphs = {glyph_name: draw_glyph(contours) for glyph_name, _, _, contours in SIMPLE_GLYPHS + KERNING_GLYPHS}
    glyphs[COMPOSITE_NAME] = draw_composite(COMPOSITE_COMPONENTS, glyphs)
    postscript_name = FAMILY_NAME.replace(" ", "") + "-Regular"
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(character_map)
    builder.setupGlyf(glyphs)
    glyph_table = builder.font["glyf"]
    advance_widths = {glyph_name: advance for glyph_name, _, advance, _ in SIMPLE_GLYPHS + KERNING_GLYPHS}
    advance_widths[COMPOSITE_NAME] = advance_widths["H"]
    builder.setupHorizontalMetrics(
        {glyph_name: (advance_widths[glyph_name], getattr(glyph_table[glyph_name], "xMin", 0)) for glyph_name in glyph_order}
    )
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable(
        {
            "copyright": "Generated with fontTools FontBuilder for the opentype.js test suite. Public domain (CC0 1.0 Universal).",
            "familyName": FAMILY_NAME,
            "styleName": "Regular",
            "fullName": f"{FAMILY_NAME} Regular",
            "psName": postscript_name,
            "licenseDescription": "Public domain (CC0 1.0 Universal)",
            "licenseInfoURL": "https://creativecommons.org/publicdomain/zero/1.0/",
        }
    )
    # fsType 0: installable embedding, as the CC0 license allows
    builder.setupOS2(fsType=0, sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    # post format 2, so that the glyph of U+0000 keeps its name NULL
    builder.setupPost(keepGlyphNames=True)
    builder.setupFvar(
        axes=[("wght", 100, 400, 900, "Weight"), ("wdth", 50, 100, 100, "Width")],
        instances=[],
    )
    builder.setupGvar(VARIATIONS)
    addFeatureVariations(builder.font, CONDITIONAL_SUBSTITUTIONS)
    addOpenTypeFeaturesFromString(builder.font, KERNING_FEATURES, tables=["GPOS", "GDEF"])
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path):
    font = TTFont(output_path)
    assert "HVAR" not in font and "avar" not in font
    assert font.getBestCmap()[0] == "NULL"
    assert font["glyf"][COMPOSITE_NAME].isComposite()
    used_points = [variation.getUsedPoints() for variation in font["gvar"].variations["H"]]
    # an empty set is all the points: fontTools shares the point set of the first two tuples
    assert used_points == [frozenset({0, 5}), frozenset({0, 5}), frozenset()], used_points
    condition = font["GSUB"].table.FeatureVariations.FeatureVariationRecord[0].ConditionSet.ConditionTable[0]
    assert condition.FilterRangeMinValue == PERIOD_SUBSTITUTION_MIN_WEIGHT, condition.FilterRangeMinValue
    assert font["GDEF"].table.VarStore.VarData[0].Item == [[-85]], font["GDEF"].table.VarStore.VarData[0].Item
    print(f"{output_path}: wght and wdth, no avar and no HVAR, {len(font.getGlyphOrder())} glyphs, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a variable TrueType test font for the precision of the gvar variations.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
