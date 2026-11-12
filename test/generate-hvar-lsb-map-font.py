"""Build a synthetic variable TrueType test font whose HVAR table has an LSB map.

Axis: wght 100..400..900, no avar. Glyphs: .notdef and H (U+0048), a square of 4 points with
an advance width of 600 and a left side bearing of 100. At wght max (the only region):
- gvar moves all the points of H by x +50 and its right phantom point by 100;
- HVAR varies the advance width of H by 100, like gvar, and its left side bearing by 20, unlike
  the outline (+50): the left side bearing of HVAR is 120 at wght 900, the one of the outline 150.

usage: generate-hvar-lsb-map-font.py <output.ttf>
"""
import argparse

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables import otTables
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.varLib import builder as variation_builder

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test HVAR Lsb Map"

WEIGHT_MAX = {"wght": (0, 1, 1)}

# glyph name, codepoint, advance width, contour
GLYPHS = [
    (".notdef", None, 500, [(100, 0), (100, 700), (400, 700), (400, 0)]),
    ("H", 0x0048, 600, [(100, 0), (100, 700), (500, 700), (500, 0)]),
]

# deltas: one (x, y) per point, then the 4 phantom points (left, right, top, bottom)
VARIATIONS = {
    "H": [
        TupleVariation(WEIGHT_MAX, [(50, 0), (50, 0), (50, 0), (50, 0), (0, 0), (100, 0), (0, 0), (0, 0)]),
    ],
}

# the deltas at wght max of the items of the HVAR variation store: none, the advance width
# of H, the left side bearing of H
HVAR_ITEMS = [[0], [100], [20]]
ADVANCE_WIDTH_ITEMS = {".notdef": 0, "H": 1}
LEFT_SIDE_BEARING_ITEMS = {".notdef": 0, "H": 2}


def draw_glyph(contour):
    pen = TTGlyphPen(None)
    pen.moveTo(contour[0])
    for point in contour[1:]:
        pen.lineTo(point)
    pen.closePath()
    return pen.glyph()


def build_hvar(glyph_order):
    regions = variation_builder.buildVarRegionList([WEIGHT_MAX], ["wght"])
    variation_data = variation_builder.buildVarData([0], HVAR_ITEMS, optimize=False)
    hvar = otTables.HVAR()
    hvar.Version = 0x00010000
    hvar.VarStore = variation_builder.buildVarStore(regions, [variation_data])
    hvar.AdvWidthMap = variation_builder.buildVarIdxMap([ADVANCE_WIDTH_ITEMS[name] for name in glyph_order], glyph_order)
    hvar.LsbMap = variation_builder.buildVarIdxMap([LEFT_SIDE_BEARING_ITEMS[name] for name in glyph_order], glyph_order)
    hvar.RsbMap = None
    return hvar


def build_font(output_path):
    glyph_order = [glyph_name for glyph_name, _, _, _ in GLYPHS]
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap({codepoint: glyph_name for glyph_name, codepoint, _, _ in GLYPHS if codepoint is not None})
    builder.setupGlyf({glyph_name: draw_glyph(contour) for glyph_name, _, _, contour in GLYPHS})
    builder.setupHorizontalMetrics({glyph_name: (advance, contour[0][0]) for glyph_name, _, advance, contour in GLYPHS})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable(
        {
            "copyright": "Generated with fontTools FontBuilder for the opentype.js test suite. Public domain (CC0 1.0 Universal).",
            "familyName": FAMILY_NAME,
            "styleName": "Regular",
            "fullName": f"{FAMILY_NAME} Regular",
            "psName": FAMILY_NAME.replace(" ", "") + "-Regular",
            "licenseDescription": "Public domain (CC0 1.0 Universal)",
            "licenseInfoURL": "https://creativecommons.org/publicdomain/zero/1.0/",
        }
    )
    # fsType 0: installable embedding, as the CC0 license allows
    builder.setupOS2(fsType=0, sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    builder.setupFvar(axes=[("wght", 100, 400, 900, "Weight")], instances=[])
    builder.setupGvar(VARIATIONS)
    builder.font["HVAR"] = newTable("HVAR")
    builder.font["HVAR"].table = build_hvar(glyph_order)
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path):
    font = TTFont(output_path)
    assert "avar" not in font
    hvar = font["HVAR"].table
    assert hvar.LsbMap.mapping == LEFT_SIDE_BEARING_ITEMS, hvar.LsbMap.mapping
    assert hvar.AdvWidthMap.mapping == ADVANCE_WIDTH_ITEMS, hvar.AdvWidthMap.mapping
    print(f"{output_path}: wght, HVAR with an advance width map and an LSB map, {len(font.getGlyphOrder())} glyphs, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a variable TrueType test font whose HVAR table has an LSB map.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
