"""Build a synthetic TrueType test font without the Unicode spaces but U+0020 SPACE and U+2003 EM SPACE, for the
fallback of the spaces and of U+2011 NON-BREAKING HYPHEN of HarfBuzz.

HarfBuzz draws a space of the Zs general category that the font has not (U+00A0, U+2000 to U+200A, U+202F, U+205F,
U+3000) with the glyph of U+0020 and sets its advance before GPOS (_hb_ot_shape_fallback_spaces): 1/n em, 4/18 em,
the advance of the first digit the font has, of the period or else of the comma, half the advance of its glyph; and
draws a missing U+2011 with the glyph of U+2010 HYPHEN.

The units per em are 2048, so that the advances of 1/n em are rounded: (2048 + n / 2) / n. Glyphs: space (501, odd,
so that half of it is truncated), uni2003 (1900, the EM SPACE the font has), one and two (no zero: the advance of a
FIGURE SPACE is the one of one), comma (no period: the advance of a PUNCTUATION SPACE is the one of comma), A and V,
uni2010 (the HYPHEN of U+2011), acutecomb (a GDEF mark), and the glyphs without a code point acute, space_V (a GDEF
ligature), space.alt (800) and thinvs (300).

cmap format 14: the variation sequence U+2009 U+FE00 maps to thinvs (nonDefaultUVS), a glyph of a space the font has
not, with its own advance.

GSUB, default features of HarfBuzz:
- ccmp: sub space acutecomb by acute; a ligature of a base and a mark (no ligature for the ligature properties of
  GDEF, a ligated glyph for HarfBuzz);
- liga: sub space V by space_V;
- calt: sub two space' by space.alt; sub one space' by space space; a single and a multiple substitution of the space.
ss01, not a default feature: sub space_V by space V; a multiple substitution after liga, which splits the ligature
into glyphs that stay ligated.
GPOS: kern: pos space A -60; an x advance adjustment of the space, after the advance of the fallback.

usage: generate-space-fallback-font.py <output.ttf>
"""
import argparse

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Space Fallback"

UNITS_PER_EM = 2048

# glyph name, codepoint, advance width, contours (lists of points)
GLYPHS = [
    (".notdef", None, 1000, [[(200, 0), (200, 1400), (800, 1400), (800, 0)]]),
    ("space", 0x0020, 501, []),
    ("comma", 0x002C, 520, [[(150, -200), (150, 200), (350, 200), (350, -200)]]),
    ("one", 0x0031, 1100, [[(450, 0), (450, 1400), (650, 1400), (650, 0)]]),
    ("two", 0x0032, 1150, [[(100, 0), (100, 1400), (1050, 1400), (1050, 0)]]),
    ("A", 0x0041, 1300, [[(40, 0), (650, 1400), (1260, 0)]]),
    ("V", 0x0056, 1300, [[(40, 1400), (1260, 1400), (650, 0)]]),
    ("acutecomb", 0x0301, 0, [[(-500, 1500), (-300, 1800), (-200, 1800), (-400, 1500)]]),
    ("uni2003", 0x2003, 1900, []),
    ("uni2010", 0x2010, 640, [[(100, 500), (100, 700), (540, 700), (540, 500)]]),
    ("acute", None, 700, [[(150, 1500), (350, 1800), (450, 1800), (250, 1500)]]),
    ("space_V", None, 1500, [[(240, 1400), (1460, 1400), (850, 0)]]),
    ("space.alt", None, 800, []),
    ("thinvs", None, 300, []),
]

# unicode value, variation selector, glyph name
VARIATION_SEQUENCES = [(0x2009, 0xFE00, "thinvs")]

FEATURES = """
languagesystem DFLT dflt;
languagesystem latn dflt;

table GDEF {
    GlyphClassDef [space comma one two A V uni2003 uni2010 acute space.alt thinvs], [space_V], [acutecomb], ;
} GDEF;

feature ccmp {
    sub space acutecomb by acute;
} ccmp;

feature liga {
    sub space V by space_V;
} liga;

feature ss01 {
    sub space_V by space V;
} ss01;

feature calt {
    sub two space' by space.alt;
    sub one space' by space space;
} calt;

feature kern {
    pos space A -60;
} kern;
"""


def draw_glyph(contours):
    pen = TTGlyphPen(None)
    for contour in contours:
        pen.moveTo(contour[0])
        for point in contour[1:]:
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def build_font(output_path):
    glyph_order = [glyph_name for glyph_name, _, _, _ in GLYPHS]
    character_map = {codepoint: glyph_name for glyph_name, codepoint, _, _ in GLYPHS if codepoint is not None}
    glyphs = {glyph_name: draw_glyph(contours) for glyph_name, _, _, contours in GLYPHS}
    postscript_name = FAMILY_NAME.replace(" ", "") + "-Regular"
    builder = FontBuilder(unitsPerEm=UNITS_PER_EM, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(character_map, uvs=VARIATION_SEQUENCES)
    builder.setupGlyf(glyphs)
    glyph_table = builder.font["glyf"]
    builder.setupHorizontalMetrics(
        {glyph_name: (advance, glyph_table[glyph_name].xMin) for glyph_name, _, advance, _ in GLYPHS}
    )
    builder.setupHorizontalHeader(ascent=1600, descent=-450)
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
    builder.setupOS2(fsType=0, sTypoAscender=1600, sTypoDescender=-450, usWinAscent=1600, usWinDescent=450)
    builder.setupPost()
    builder.addOpenTypeFeatures(FEATURES)
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path):
    font = TTFont(output_path)
    assert font["head"].unitsPerEm == UNITS_PER_EM
    character_map = font.getBestCmap()
    fallback_characters = [0x00A0, *range(0x2000, 0x2003), *range(0x2004, 0x200B), 0x202F, 0x205F, 0x3000, 0x2011]
    assert not any(codepoint in character_map for codepoint in fallback_characters)
    assert not any(codepoint in character_map for codepoint in [0x0030, 0x002E, 0x1680])
    assert character_map[0x2003] == "uni2003" and character_map[0x2010] == "uni2010"
    variation_sequences = font["cmap"].getcmap(0, 5).uvsDict
    assert variation_sequences == {0xFE00: [(0x2009, "thinvs")]}, variation_sequences
    advances = {glyph_name: font["hmtx"][glyph_name][0] for glyph_name, _, _, _ in GLYPHS}
    assert advances["space"] == 501 and advances["one"] == 1100 and advances["comma"] == 520
    assert advances["thinvs"] == 300
    substitution_table = font["GSUB"].table
    features = [feature.FeatureTag for feature in substitution_table.FeatureList.FeatureRecord]
    assert features == ["calt", "ccmp", "liga", "ss01"], features
    lookup_types = [lookup.LookupType for lookup in substitution_table.LookupList.Lookup]
    # calt: a chaining contextual lookup and its nested single and multiple substitutions; ss01 after liga
    assert sorted(lookup_types) == [1, 2, 2, 4, 4, 6], lookup_types
    lookup_indexes = {
        record.FeatureTag: record.Feature.LookupListIndex for record in substitution_table.FeatureList.FeatureRecord
    }
    assert max(lookup_indexes["liga"]) < min(lookup_indexes["ss01"]), lookup_indexes
    position_features = [feature.FeatureTag for feature in font["GPOS"].table.FeatureList.FeatureRecord]
    assert position_features == ["kern"], position_features
    print(f"{output_path}: {len(GLYPHS)} glyphs, GSUB {features}, GPOS {position_features}, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a TrueType test font without the Unicode spaces.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
