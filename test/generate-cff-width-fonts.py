"""Build synthetic CFF (version 1) test fonts whose Private DICT is empty (size 0).

The structure is the one of the fonts of opentype.js issues #417 and #440 (Sugardrop.otf,
BellweatherSans-Regular.otf, fonts written by opentype.js itself): the Top DICT points to a
Private DICT of size 0, so defaultWidthX and nominalWidthX have their default value (0): a
charstring that gives its width gives an absolute value (nominalWidthX is 0), and one that
omits it has a width of 0 (defaultWidthX).

Each glyph takes its width with a different operator of the Type 2 charstring:
rmoveto, endchar, hmoveto, vmoveto, hstem, hstemhm + hintmask, and one glyph omits it.

usage: generate-cff-width-fonts.py [--hmtx-mismatch] <output.otf>

With --hmtx-mismatch the advance of the hmtx table differs from the width of the charstring
for the glyphs A and V (the hmtx table is the one text layout uses).
"""
import argparse

from fontTools.fontBuilder import FontBuilder
from fontTools.cffLib import PrivateDict
from fontTools.misc.psCharStrings import T2CharString
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.basePen import NullPen
from fontTools.ttLib import TTFont

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

# glyph name, codepoint, width in the charstring (None: omitted), charstring program after the width
GLYPHS = [
    (".notdef", None, 500, [100, 0, "rmoveto", 300, 0, "rlineto", 0, 700, "rlineto", -300, 0, "rlineto", "endchar"]),
    ("space", 0x20, 250, ["endchar"]),
    ("A", 0x41, 749, [40, "hmoveto", 300, 700, "rlineto", 300, -700, "rlineto", "endchar"]),
    ("V", 0x56, 680, [700, "vmoveto", 300, -700, "rlineto", 300, 700, "rlineto", "endchar"]),
    ("I", 0x49, 300, [0, 700, "hstem", 110, 0, "rmoveto", 80, 0, "rlineto", 0, 700, "rlineto", -80, 0, "rlineto", "endchar"]),
    (
        "H",
        0x48,
        813,
        [
            0, 700, "hstemhm", 90, 80, 473, 80, "hintmask", b"\xe0",
            90, 0, "rmoveto", 633, 0, "rlineto", 0, 700, "rlineto", -633, 0, "rlineto", "endchar",
        ],
    ),
    ("acutecomb", 0x301, None, [-200, 600, "rmoveto", 100, 150, "rlineto", -60, 0, "rlineto", "endchar"]),
]

# advances of the hmtx table that differ from the width of the charstring
HMTX_MISMATCH_ADVANCES = {"A": 600, "V": 720}


def build_font(output_path, hmtx_mismatch):
    glyph_order = [glyph_name for glyph_name, _, _, _ in GLYPHS]
    character_map = {codepoint: glyph_name for glyph_name, codepoint, _, _ in GLYPHS if codepoint is not None}
    charstrings = {}
    metrics = {}
    for glyph_name, _, width, program in GLYPHS:
        full_program = list(program) if width is None else [width, *program]
        charstrings[glyph_name] = T2CharString(program=full_program)
        advance = 0 if width is None else width
        if hmtx_mismatch:
            advance = HMTX_MISMATCH_ADVANCES.get(glyph_name, advance)
        # the bounds are measured on a copy: drawing a charstring sets its width
        glyph_bounds = T2CharString(program=full_program, private=PrivateDict()).calcBounds(None)
        metrics[glyph_name] = (advance, glyph_bounds[0] if glyph_bounds else 0)

    family_name = "Test CFF Width Mismatch" if hmtx_mismatch else "Test CFF Empty Private DICT"
    postscript_name = family_name.replace(" ", "") + "-Regular"
    builder = FontBuilder(unitsPerEm=1000, isTTF=False)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(character_map)
    builder.setupCFF(postscript_name, {"FullName": family_name}, charstrings, {})
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable(
        {
            "copyright": "Generated with fontTools FontBuilder for the opentype.js test suite. Public domain (CC0 1.0 Universal).",
            "familyName": family_name,
            "styleName": "Regular",
            "fullName": f"{family_name} Regular",
            "psName": postscript_name,
            "licenseDescription": "Public domain (CC0 1.0 Universal)",
            "licenseInfoURL": "https://creativecommons.org/publicdomain/zero/1.0/",
        }
    )
    # fsType 0: installable embedding, as the CC0 license allows
    builder.setupOS2(fsType=0, sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path, hmtx_mismatch):
    font = TTFont(output_path)
    top_dict = font["CFF "].cff.topDictIndex[0]
    private_size, private_offset = top_dict.rawDict["Private"]
    assert private_size == 0, f"the Private DICT is not empty: size {private_size}"
    assert top_dict.Private.rawDict == {}, top_dict.Private.rawDict
    for glyph_name in font.getGlyphOrder():
        charstring = top_dict.CharStrings[glyph_name]
        charstring.draw(NullPen())
        advance = font["hmtx"][glyph_name][0]
        if hmtx_mismatch and glyph_name in HMTX_MISMATCH_ADVANCES:
            assert charstring.width != advance, glyph_name
        else:
            assert charstring.width == advance, (glyph_name, charstring.width, advance)
    print(f"{output_path}: Private DICT (size, offset) = ({private_size}, {private_offset}), {len(font.getGlyphOrder())} glyphs, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a CFF test font whose Private DICT is empty.")
    parser.add_argument("output_path", metavar="output.otf", help="path of the font to write")
    parser.add_argument(
        "--hmtx-mismatch",
        action="store_true",
        help="give the glyphs A and V hmtx advances that differ from the widths of their charstrings",
    )
    arguments = parser.parse_args()
    build_font(arguments.output_path, arguments.hmtx_mismatch)
    verify_font(arguments.output_path, arguments.hmtx_mismatch)


if __name__ == "__main__":
    main()
