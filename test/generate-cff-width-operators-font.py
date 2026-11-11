"""Build a synthetic CFF (version 1) test font whose charstrings give their width on the stack
of operators and subroutines that the glyphs of generate-cff-width-fonts.py do not use.

The Private DICT has a nominalWidthX of 100 and a defaultWidthX of 450, and a local
subroutine; the font has a global subroutine. Its glyphs:

    .notdef  the width before rmoveto
    A        the width before hmoveto, the base glyph of Aacute
    acute    no width (defaultWidthX), the accent of Aacute
    Aacute   the width before the four arguments of a seac endchar (adx ady bchar achar)
    I        the width and the arguments of rmoveto pushed by the local subroutine
    H        the width and the argument of hmoveto pushed before a global subroutine that
             holds the hmoveto operator
    O        no width (defaultWidthX), a hintmask with implicit vstems (one stem, a mask of
             one byte) is the first stack-clearing operator
    E        no width (defaultWidthX), hmoveto is the first stack-clearing operator
    T        no width (defaultWidthX), vmoveto is the first stack-clearing operator

The hmtx advance of each glyph is the width of its charstring.

usage: generate-cff-width-operators-font.py <output.otf>
"""
import argparse

from fontTools.cffLib import SubrsIndex
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.psCharStrings import T2CharString
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.basePen import NullPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

NOMINAL_WIDTH_X = 100
DEFAULT_WIDTH_X = 450

# a subroutine index of the charstring of a font with fewer than 1240 subroutines is biased by -107
SUBROUTINE_BIAS = 107

LOCAL_SUBROUTINES = [
    [300 - NOMINAL_WIDTH_X, 110, 0, "return"],
]

GLOBAL_SUBROUTINES = [
    ["hmoveto", "return"],
]

# glyph name, codepoint, advance, charstring program
GLYPHS = [
    (
        ".notdef",
        None,
        500,
        [500 - NOMINAL_WIDTH_X, 100, 0, "rmoveto", 300, 0, "rlineto", 0, 700, "rlineto", -300, 0, "rlineto", "endchar"],
    ),
    ("A", 0x41, 600, [600 - NOMINAL_WIDTH_X, 40, "hmoveto", 260, 700, "rlineto", 260, -700, "rlineto", "endchar"]),
    ("acute", 0xB4, DEFAULT_WIDTH_X, [150, 750, "rmoveto", 100, 150, "rlineto", -60, 0, "rlineto", "endchar"]),
    # 65 and 194: the codes of A and acute in the Standard Encoding
    ("Aacute", 0xC1, 600, [600 - NOMINAL_WIDTH_X, 50, 120, 65, 194, "endchar"]),
    (
        "I",
        0x49,
        300,
        [-SUBROUTINE_BIAS, "callsubr", "rmoveto", 80, 0, "rlineto", 0, 700, "rlineto", -80, 0, "rlineto", "endchar"],
    ),
    (
        "H",
        0x48,
        813,
        [
            813 - NOMINAL_WIDTH_X, 90, -SUBROUTINE_BIAS, "callgsubr",
            633, 0, "rlineto", 0, 700, "rlineto", -633, 0, "rlineto", "endchar",
        ],
    ),
    (
        "O",
        0x4F,
        DEFAULT_WIDTH_X,
        [
            90, 80, "hintmask", b"\x80",
            90, 0, "rmoveto", 80, 0, "rlineto", 0, 700, "rlineto", -80, 0, "rlineto", "endchar",
        ],
    ),
    ("E", 0x45, DEFAULT_WIDTH_X, [110, "hmoveto", 80, 0, "rlineto", 0, 700, "rlineto", -80, 0, "rlineto", "endchar"]),
    ("T", 0x54, DEFAULT_WIDTH_X, [120, "vmoveto", 100, 0, "rlineto", 0, 580, "rlineto", -100, 0, "rlineto", "endchar"]),
]


def build_font(output_path):
    glyph_order = [glyph_name for glyph_name, _, _, _ in GLYPHS]
    character_map = {codepoint: glyph_name for glyph_name, codepoint, _, _ in GLYPHS if codepoint is not None}
    charstrings = {glyph_name: T2CharString(program=list(program)) for glyph_name, _, _, program in GLYPHS}

    family_name = "Test CFF Width Operators"
    postscript_name = family_name.replace(" ", "") + "-Regular"
    builder = FontBuilder(unitsPerEm=1000, isTTF=False)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(character_map)
    builder.setupCFF(
        postscript_name,
        {"FullName": family_name},
        charstrings,
        {"nominalWidthX": NOMINAL_WIDTH_X, "defaultWidthX": DEFAULT_WIDTH_X},
    )
    cff = builder.font["CFF "].cff
    private = cff.topDictIndex[0].Private
    private.Subrs = SubrsIndex()
    for program in LOCAL_SUBROUTINES:
        private.Subrs.append(T2CharString(program=list(program), private=private, globalSubrs=cff.GlobalSubrs))
    for program in GLOBAL_SUBROUTINES:
        cff.GlobalSubrs.append(T2CharString(program=list(program), private=private, globalSubrs=cff.GlobalSubrs))

    metrics = {}
    for glyph_name, _, advance, _ in GLYPHS:
        pen = BoundsPen(charstrings)
        charstrings[glyph_name].draw(pen)
        metrics[glyph_name] = (advance, pen.bounds[0] if pen.bounds else 0)
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


def verify_font(output_path):
    font = TTFont(output_path)
    top_dict = font["CFF "].cff.topDictIndex[0]
    assert top_dict.Private.nominalWidthX == NOMINAL_WIDTH_X, top_dict.Private.nominalWidthX
    assert top_dict.Private.defaultWidthX == DEFAULT_WIDTH_X, top_dict.Private.defaultWidthX
    for glyph_name in font.getGlyphOrder():
        charstring = top_dict.CharStrings[glyph_name]
        charstring.draw(NullPen())
        advance = font["hmtx"][glyph_name][0]
        assert charstring.width == advance, (glyph_name, charstring.width, advance)
    print(f"{output_path}: {len(font.getGlyphOrder())} glyphs, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a CFF test font whose charstrings give their width on the stack of various operators.")
    parser.add_argument("output_path", metavar="output.otf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
