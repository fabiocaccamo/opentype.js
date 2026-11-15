"""Build a synthetic TrueType test font with a GSUB and a GPOS extension lookup of two subtables each.

Glyphs: .notdef, a, b, c and d (U+0061 to U+0064), the same triangle, with the advance widths 500, 600, 700, 800 and
900. The lookups, built by feaLib with useExtension:
- GSUB lookup 0 EXTENSION_SINGLE (liga, type 7): sub a by c in its subtable 0, sub b by d in its subtable 1;
- GPOS lookup 0 EXTENSION_PAIR (kern, type 9): pos c d -100 in its subtable 0 (format 1), pos [d] [c] -200 in its
  subtable 1 (format 2, feaLib puts the glyph pairs of a lookup in one subtable);
- GPOS lookup 1 SINGLE_A (kern, type 1): pos a 50.

The tests patch the extension subtables of these lookups (see test/applySubstitution.spec.mjs and
test/position.spec.mjs).

hb-shape --no-glyph-names --cluster-level=1 <font> -u 0061,0062 [3=0+700|4=1+900]
hb-shape --no-glyph-names --cluster-level=1 <font> -u 0064,0063 [4=0+700|3=1+800]

usage: generate-extension-lookups-font.py <output.ttf>
"""
import argparse

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Extension Lookups"

GLYPH_ORDER = [".notdef", "a", "b", "c", "d"]

FEATURES = """
lookup EXTENSION_SINGLE useExtension {
    sub a by c;
    subtable;
    sub b by d;
} EXTENSION_SINGLE;

lookup EXTENSION_PAIR useExtension {
    pos c d -100;
    subtable;
    pos [d] [c] -200;
} EXTENSION_PAIR;

lookup SINGLE_A {
    pos a 50;
} SINGLE_A;

feature liga {
    lookup EXTENSION_SINGLE;
} liga;

feature kern {
    lookup EXTENSION_PAIR;
    lookup SINGLE_A;
} kern;
"""


def draw_triangle():
    pen = TTGlyphPen(None)
    pen.moveTo((0, 0))
    pen.lineTo((0, 500))
    pen.lineTo((400, 500))
    pen.closePath()
    return pen.glyph()


def build_font(output_path):
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(GLYPH_ORDER)
    builder.setupCharacterMap({0x0061: "a", 0x0062: "b", 0x0063: "c", 0x0064: "d"})
    builder.setupGlyf({glyph_name: draw_triangle() for glyph_name in GLYPH_ORDER})
    builder.setupHorizontalMetrics({glyph_name: (500 + 100 * index, 0) for index, glyph_name in enumerate(GLYPH_ORDER)})
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
    addOpenTypeFeaturesFromString(builder.font, FEATURES)
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path):
    font = TTFont(output_path)
    for tag, extension_lookup_type in (("GSUB", 1), ("GPOS", 2)):
        lookup = font[tag].table.LookupList.Lookup[0]
        assert lookup.LookupType == (7 if tag == "GSUB" else 9), tag
        assert [subtable.ExtensionLookupType for subtable in lookup.SubTable] == [extension_lookup_type] * 2, tag
    print(f"{output_path}: a GSUB and a GPOS extension lookup of two subtables, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a TrueType test font with GSUB and GPOS extension lookups of two subtables.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
