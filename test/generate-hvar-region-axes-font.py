"""Build a synthetic variable TrueType test font whose HVAR region list has more axes than its fvar table.

Axis: wght 100..400..900, no avar, no gvar. Glyphs: .notdef and A (U+0041), a triangle with an advance width of 500.
The VariationRegionList of the HVAR item variation store has two axes, wght and wdth (an axis the fvar table has not),
and three regions: wght max, wdth max and their corner. The item of A (no advance width map: the item of its glyph
index) has the deltas 100, 40 and 20. Like HarfBuzz (VarRegionList::evaluate), the wdth axis past the axes of fvar is
read at the coordinate 0, so that only the region wght max varies A:
hb-shape --no-glyph-names --variations=wght=900 <font> -u 0041 [1=0+600]
hb-shape --no-glyph-names --variations=wght=650 <font> -u 0041 [1=0+550]
hb-shape --no-glyph-names --variations=wght=400 <font> -u 0041 [1=0+500]

usage: generate-hvar-region-axes-font.py <output.ttf>
"""
import argparse

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables.DefaultTable import DefaultTable
from fontTools.ttLib.tables import otTables
from fontTools.varLib import builder as variation_builder

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test HVAR Region Axes"

GLYPH_ORDER = [".notdef", "A"]

ADVANCE_WIDTH = 500

REGION_AXIS_TAGS = ["wght", "wdth"]

REGIONS = [
    {"wght": (0, 1, 1)},
    {"wdth": (0, 1, 1)},
    {"wght": (0, 1, 1), "wdth": (0, 1, 1)},
]

# the deltas of the items of the HVAR variation store, one per glyph index
HVAR_ITEMS = [[0, 0, 0], [100, 40, 20]]


def draw_triangle():
    pen = TTGlyphPen(None)
    pen.moveTo((0, 0))
    pen.lineTo((250, 700))
    pen.lineTo((500, 0))
    pen.closePath()
    return pen.glyph()


def build_hvar():
    regions = variation_builder.buildVarRegionList(REGIONS, REGION_AXIS_TAGS)
    variation_data = variation_builder.buildVarData(list(range(len(REGIONS))), HVAR_ITEMS, optimize=False)
    hvar = otTables.HVAR()
    hvar.Version = 0x00010000
    hvar.VarStore = variation_builder.buildVarStore(regions, [variation_data])
    hvar.AdvWidthMap = None
    hvar.LsbMap = None
    hvar.RsbMap = None
    return hvar


def compile_hvar(builder):
    """The HVAR table as raw bytes: fontTools writes the RegionAxisCount of the region list from the fvar axes, so the
    table is compiled with an fvar table of the two region axes, which build_font then replaces."""
    builder.setupFvar(axes=[("wght", 100, 400, 900, "Weight"), ("wdth", 50, 100, 200, "Width")], instances=[])
    hvar = newTable("HVAR")
    hvar.table = build_hvar()
    raw_hvar = DefaultTable("HVAR")
    raw_hvar.data = hvar.compile(builder.font)
    return raw_hvar


def build_font(output_path):
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(GLYPH_ORDER)
    builder.setupCharacterMap({0x0041: "A"})
    builder.setupGlyf({glyph_name: draw_triangle() for glyph_name in GLYPH_ORDER})
    builder.setupHorizontalMetrics({glyph_name: (ADVANCE_WIDTH, 0) for glyph_name in GLYPH_ORDER})
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
    builder.font["HVAR"] = compile_hvar(builder)
    builder.setupFvar(axes=[("wght", 100, 400, 900, "Weight")], instances=[])
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path):
    font = TTFont(output_path)
    assert not any(tag in font for tag in ("avar", "gvar")), "no avar nor gvar"
    assert [axis.axisTag for axis in font["fvar"].axes] == ["wght"]
    assert font["HVAR"].table.VarStore.VarRegionList.RegionAxisCount == len(REGION_AXIS_TAGS)
    print(f"{output_path}: fvar of 1 axis, HVAR region list of {len(REGION_AXIS_TAGS)} axes, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a variable TrueType test font whose HVAR region list has more axes than fvar.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
