"""Build a synthetic variable TrueType test font whose cvar tuples vary all the cvt values.

Axis: wght 100..400..900, no avar. Glyphs: .notdef and H (U+0048), a square of 4 points. The cvt table has 4 values,
100 200 300 400, and the cvar table two tuples with a delta for every cvt value, which fontTools writes without point
numbers of their own (the packed point count 0, all the points):
- tuple 0, at wght max: 10 20 30 40;
- tuple 1, at wght min: -4 -8 -12 -16.

fontTools varLib.instancer.instantiateVariableFont(font, {"wght": 650})["cvt "] is 105 210 315 420,
and at {"wght": 250} 98 196 294 392 (checked by verify_font).

usage: generate-cvar-all-points-font.py <output.ttf>
"""
import argparse
import array

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.varLib import instancer

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test CVAR All Points"

CONTOUR = [(100, 0), (100, 700), (500, 700), (500, 0)]

CVT_VALUES = [100, 200, 300, 400]

CVT_VARIATIONS = [
    TupleVariation({"wght": (0, 1, 1)}, [10, 20, 30, 40]),
    TupleVariation({"wght": (-1, -1, 0)}, [-4, -8, -12, -16]),
]

# the cvt values of the instances of fontTools varLib.instancer
INSTANCE_CVT_VALUES = {650: [105, 210, 315, 420], 250: [98, 196, 294, 392]}


def draw_glyph(contour):
    pen = TTGlyphPen(None)
    pen.moveTo(contour[0])
    for point in contour[1:]:
        pen.lineTo(point)
    pen.closePath()
    return pen.glyph()


def build_font(output_path):
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder([".notdef", "H"])
    builder.setupCharacterMap({0x0048: "H"})
    builder.setupGlyf({".notdef": draw_glyph(CONTOUR), "H": draw_glyph(CONTOUR)})
    builder.setupHorizontalMetrics({".notdef": (600, 100), "H": (600, 100)})
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
    builder.setupGvar({".notdef": [], "H": []})
    builder.font["cvt "] = newTable("cvt ")
    builder.font["cvt "].values = array.array("h", CVT_VALUES)
    builder.font["cvar"] = newTable("cvar")
    builder.font["cvar"].version = 0x00010000
    builder.font["cvar"].variations = CVT_VARIATIONS
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path):
    font = TTFont(output_path)
    assert "avar" not in font
    assert [variation.coordinates for variation in font["cvar"].variations] == [variation.coordinates for variation in CVT_VARIATIONS]
    for weight, expected_values in INSTANCE_CVT_VALUES.items():
        instance = instancer.instantiateVariableFont(TTFont(output_path), {"wght": weight})
        assert list(instance["cvt "].values) == expected_values, (weight, list(instance["cvt "].values))
    print(f"{output_path}: wght, cvar with 2 all-points tuples over {len(CVT_VALUES)} cvt values, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a variable TrueType test font whose cvar tuples vary all the cvt values.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
