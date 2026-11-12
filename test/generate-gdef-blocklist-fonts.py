"""Build the test fonts of the GDEF tables that HarfBuzz ignores (OT::GDEF::is_blocklisted in hb-ot-layout.cc).

HarfBuzz ignores the GDEF table of a few fonts with wrong glyph classes, which it recognizes by the lengths of
their GDEF, GSUB and GPOS tables: in some versions of Times New Roman Italic, the ASCII double quotation mark
is a mark (class 3), so a kern lookup with IgnoreMarks would kern the glyphs around it.

All the fonts have the glyphs A, V (bases) and quotedbl (a mark, the wrong class of these fonts), 500 units wide,
the kern lookup and the calt lookup

    lookupflag IgnoreMarks; pos A V -100;
    lookupflag IgnoreMarks; sub V' A by A;

Their GDEF, GSUB and GPOS tables are padded with zeros to the lengths:
- TestGDEF-Blocklisted.ttf: 188, 248 and 3852, the lengths of Cantarell-Regular.otf 0.0.21 in the blocklist;
- TestGDEF-NotBlocklisted.ttf: 190, 248 and 3852, which no font of the blocklist has;
- TestGDEF-NotBlocklistedGsubLength.ttf: 188, 250 and 3852, the lengths of the blocklist but the GSUB one;
- TestGDEF-NotBlocklistedGposLength.ttf: 188, 248 and 3854, the lengths of the blocklist but the GPOS one.

TestGDEF-Blocklisted.woff and TestGDEF-Blocklisted.woff2 are TestGDEF-Blocklisted.ttf compressed by fontTools: their
table directories record the lengths of the decompressed tables, the lengths HarfBuzz compares.

    hb-shape --no-glyph-names --cluster-level=1 TestGDEF-Blocklisted.ttf -u 0041,0022,0056
    [1=0+500|3=1+500|2=2+500]
    hb-shape --no-glyph-names --cluster-level=1 TestGDEF-NotBlocklisted.ttf -u 0041,0022,0056
    [1=0+400|3=1+0|2=2+500]
    hb-shape --no-glyph-names --cluster-level=1 TestGDEF-Blocklisted.ttf -u 0056,0022,0041
    [2=0+500|3=1+500|1=2+500]
    hb-shape --no-glyph-names --cluster-level=1 TestGDEF-NotBlocklisted.ttf -u 0056,0022,0041
    [1=0+500|3=1+0|1=2+500]

TestGDEF-NotBlocklistedGsubLength.ttf and TestGDEF-NotBlocklistedGposLength.ttf give the outputs of
TestGDEF-NotBlocklisted.ttf.

usage: generate-gdef-blocklist-fonts.py <output directory> (requires brotli for the WOFF2 font)
"""
import argparse
import os

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.DefaultTable import DefaultTable

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test GDEF Blocklist"

# glyph name, codepoint
GLYPHS = [(".notdef", None), ("A", 0x41), ("V", 0x56), ("quotedbl", 0x22)]

FEATURES = """
languagesystem DFLT dflt;
languagesystem latn dflt;

table GDEF {
    GlyphClassDef [A V], , [quotedbl], ;
} GDEF;

lookup KERN_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    pos A V -100;
} KERN_IGNORE_MARKS;

feature kern { lookup KERN_IGNORE_MARKS; } kern;

lookup CALT_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub V' A by A;
} CALT_IGNORE_MARKS;

feature calt { lookup CALT_IGNORE_MARKS; } calt;
"""

# the GDEF, GSUB and GPOS table lengths of each font
TABLE_LENGTHS = {
    "TestGDEF-Blocklisted.ttf": {"GDEF": 188, "GSUB": 248, "GPOS": 3852},
    "TestGDEF-NotBlocklisted.ttf": {"GDEF": 190, "GSUB": 248, "GPOS": 3852},
    "TestGDEF-NotBlocklistedGsubLength.ttf": {"GDEF": 188, "GSUB": 250, "GPOS": 3852},
    "TestGDEF-NotBlocklistedGposLength.ttf": {"GDEF": 188, "GSUB": 248, "GPOS": 3854},
}

# the compressed fonts of TestGDEF-Blocklisted.ttf
COMPRESSED_FLAVORS = ["woff", "woff2"]


def draw_rectangle():
    pen = TTGlyphPen(None)
    pen.moveTo((100, 0))
    pen.lineTo((100, 500))
    pen.lineTo((400, 500))
    pen.lineTo((400, 0))
    pen.closePath()
    return pen.glyph()


def build_font():
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder([glyph_name for glyph_name, _ in GLYPHS])
    builder.setupCharacterMap({codepoint: glyph_name for glyph_name, codepoint in GLYPHS if codepoint is not None})
    builder.setupGlyf({glyph_name: draw_rectangle() for glyph_name, _ in GLYPHS})
    builder.setupHorizontalMetrics({glyph_name: (500, 100) for glyph_name, _ in GLYPHS})
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
    builder.addOpenTypeFeatures(FEATURES)
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    return builder.font


def pad_table(font, tag, length):
    data = font[tag].compile(font)
    assert len(data) <= length, f"{tag} is {len(data)} bytes long, more than {length}"
    padded_table = DefaultTable(tag)
    padded_table.data = data + b"\0" * (length - len(data))
    font[tag] = padded_table


def main():
    parser = argparse.ArgumentParser(description="Build the test fonts of the GDEF tables that HarfBuzz ignores.")
    parser.add_argument("output_directory", help="directory of the fonts")
    arguments = parser.parse_args()
    for file_name, table_lengths in TABLE_LENGTHS.items():
        font = build_font()
        for tag, length in table_lengths.items():
            pad_table(font, tag, length)
        font.save(os.path.join(arguments.output_directory, file_name))
    for flavor in COMPRESSED_FLAVORS:
        font = TTFont(os.path.join(arguments.output_directory, "TestGDEF-Blocklisted.ttf"), recalcTimestamp=False)
        font.flavor = flavor
        font.save(os.path.join(arguments.output_directory, f"TestGDEF-Blocklisted.{flavor}"))


if __name__ == "__main__":
    main()
