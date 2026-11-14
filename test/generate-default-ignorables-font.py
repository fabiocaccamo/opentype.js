"""Build a synthetic TrueType test font for the default ignorables and the variation selectors of HarfBuzz.

HarfBuzz skips the default ignorables (e.g. U+00AD SOFT HYPHEN, U+034F COMBINING GRAPHEME JOINER, U+200C ZERO WIDTH
NON-JOINER, U+200D ZERO WIDTH JOINER, the variation selectors) when its lookups match glyphs (matcher_t of
hb-ot-layout-gsubgpos.hh), hides them after GPOS with the glyph of U+0020 SPACE and an advance of 0, or removes them
without that glyph (hb_ot_hide_default_ignorables), and maps a character and a variation selector to the glyph of
their variation sequence of the cmap format 14 before GSUB (handle_variation_selector_cluster).

Glyphs: space (250), a, b, f, i, x, uni00AD (the soft hyphen, 300), uni200D (the zero width joiner, 100), acutecomb
(a GDEF mark), alef, dal and beh (U+0627, U+062F and U+0628), and the glyphs without a code point f_i, a_zwj_b,
dal_alef, a_b, beh_beh (GDEF ligatures), x.alt, a.alt, a.fvs and zwj.visible, then madda (U+0653, a GDEF mark). No
glyph for U+034F, U+061C, U+180B, U+200C, U+0622 (which the normalization decomposes into alef and madda) nor the
variation selectors.

cmap format 14: b U+FE00 is a default variation sequence (the glyph of b), a U+FE01 maps to a.alt, a U+180B to a.fvs
(HarfBuzz leaves the Mongolian free variation selectors to the GSUB of the font, it never reads this record).

GSUB, of the scripts DFLT, latn and arab:
- liga: sub f i by f_i; a ligature across the default ignorables that its input skips;
  sub a uni200D b by a_zwj_b; a ligature with the zero width joiner as a component, like the emoji sequences;
  sub dal alef by dal_alef; an Arabic ligature, which a zero width joiner keeps from forming;
- calt: sub x' b by x.alt; a lookahead across the default ignorables that the context skips;
- ss01: sub uni200D by zwj.visible; a substituted zero width joiner, no more a default ignorable;
- ss02: sub a' lookup ALT_A lookup LIGA_ALT_A_B; (ALT_A: sub a by a.alt; LIGA_ALT_A_B: sub a.alt b by a_b;) a
  ligature of a nested lookup across the default ignorables, after a substitution of the same rule;
- ss03: sub a' lookup ALT_A lookup LIGA_ALT_A_B uni200D' lookup ZWJ_VISIBLE b'; (ZWJ_VISIBLE: sub uni200D by
  zwj.visible;) with the lookup record of the zero width joiner first in the rule: a nested ligature after a record
  that substituted the default ignorable between its components, no more one;
- medi: sub beh beh by beh_beh; a ligature of an Arabic form feature, which a zero width joiner keeps from forming in
  the Arabic shaper (e.g. between the two medial behs of beh beh U+200D beh beh).
GPOS:
- kern: pos a b -50; a pair across the default ignorables;
- mark: pos base a <anchor 250 500> mark @TOP (acutecomb <anchor 0 500>); a mark attached across the default
  ignorables but the zero width joiner.

usage: generate-default-ignorables-font.py <output.ttf>
"""
import argparse

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Default Ignorables"

UNITS_PER_EM = 1000

# glyph name, codepoint, advance width, contours (lists of points)
GLYPHS = [
    (".notdef", None, 500, [[(100, 0), (100, 700), (400, 700), (400, 0)]]),
    ("space", 0x0020, 250, []),
    ("a", 0x0061, 500, [[(50, 0), (50, 500), (450, 500), (450, 0)]]),
    ("b", 0x0062, 500, [[(50, 0), (50, 700), (450, 700), (450, 0)]]),
    ("f", 0x0066, 300, [[(50, 0), (50, 700), (250, 700), (250, 0)]]),
    ("i", 0x0069, 250, [[(75, 0), (75, 500), (175, 500), (175, 0)]]),
    ("x", 0x0078, 500, [[(50, 0), (250, 500), (450, 0)]]),
    ("uni00AD", 0x00AD, 300, [[(50, 250), (50, 300), (250, 300), (250, 250)]]),
    ("uni200D", 0x200D, 100, [[(25, 600), (25, 700), (75, 700), (75, 600)]]),
    ("acutecomb", 0x0301, 0, [[(-150, 550), (-50, 700), (0, 700), (-100, 550)]]),
    ("alef", 0x0627, 300, [[(100, 0), (100, 700), (200, 700), (200, 0)]]),
    ("dal", 0x062F, 400, [[(50, 0), (50, 100), (350, 100), (350, 0)]]),
    ("f_i", None, 550, [[(50, 0), (50, 700), (500, 700), (500, 0)]]),
    ("a_zwj_b", None, 900, [[(50, 0), (50, 700), (850, 700), (850, 0)]]),
    ("dal_alef", None, 650, [[(50, 0), (50, 700), (600, 700), (600, 0)]]),
    ("x.alt", None, 450, [[(50, 500), (250, 0), (450, 500)]]),
    ("a.alt", None, 520, [[(50, 0), (260, 500), (470, 0)]]),
    ("a.fvs", None, 510, [[(50, 500), (255, 0), (460, 500)]]),
    ("zwj.visible", None, 200, [[(50, 600), (50, 700), (150, 700), (150, 600)]]),
    ("a_b", None, 800, [[(50, 0), (50, 500), (750, 500), (750, 0)]]),
    ("beh", 0x0628, 350, [[(50, 0), (50, 100), (300, 100), (300, 0)]]),
    ("beh_beh", None, 600, [[(50, 0), (50, 100), (550, 100), (550, 0)]]),
    ("madda", 0x0653, 0, [[(-150, 600), (-150, 650), (-50, 650), (-50, 600)]]),
]

# unicode value, variation selector, glyph name (None for a default variation sequence)
VARIATION_SEQUENCES = [(0x0062, 0xFE00, None), (0x0061, 0xFE01, "a.alt"), (0x0061, 0x180B, "a.fvs")]

FEATURES = """
languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem arab dflt;

table GDEF {
    GlyphClassDef [space a b f i x uni00AD uni200D alef dal beh x.alt a.alt a.fvs zwj.visible], [f_i a_zwj_b dal_alef a_b beh_beh], [acutecomb madda], ;
} GDEF;

feature liga {
    sub f i by f_i;
    sub a uni200D b by a_zwj_b;
    sub dal alef by dal_alef;
} liga;

feature calt {
    sub x' b by x.alt;
} calt;

feature ss01 {
    sub uni200D by zwj.visible;
} ss01;

lookup ALT_A {
    sub a by a.alt;
} ALT_A;

lookup LIGA_ALT_A_B {
    sub a.alt b by a_b;
} LIGA_ALT_A_B;

feature ss02 {
    sub a' lookup ALT_A lookup LIGA_ALT_A_B;
} ss02;

lookup ZWJ_VISIBLE {
    sub uni200D by zwj.visible;
} ZWJ_VISIBLE;

feature ss03 {
    sub a' lookup ALT_A lookup LIGA_ALT_A_B uni200D' lookup ZWJ_VISIBLE b';
} ss03;

feature medi {
    sub beh beh by beh_beh;
} medi;

feature kern {
    pos a b -50;
} kern;

markClass acutecomb <anchor 0 500> @TOP;

feature mark {
    pos base a <anchor 250 500> mark @TOP;
} mark;
"""


def draw_glyph(contours):
    pen = TTGlyphPen(None)
    for contour in contours:
        pen.moveTo(contour[0])
        for point in contour[1:]:
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def get_feature_lookups(font, table_tag, feature_tag):
    table = font[table_tag].table
    lookup_indexes = {
        lookup_index
        for record in table.FeatureList.FeatureRecord
        if record.FeatureTag == feature_tag
        for lookup_index in record.Feature.LookupListIndex
    }
    return [table.LookupList.Lookup[lookup_index] for lookup_index in sorted(lookup_indexes)]


def get_joiner_rules(font):
    """The rules of ss03, in the ContextSubst subtables of format 1 that feaLib writes for it."""
    rules = []
    for lookup in get_feature_lookups(font, "GSUB", "ss03"):
        for subtable in lookup.SubTable:
            assert subtable.Format == 1, subtable.Format
            rules.extend(rule for rule_set in subtable.SubRuleSet if rule_set for rule in rule_set.SubRule)
    return rules


def put_joiner_record_first(font):
    """Apply the lookup record of the zero width joiner of the rule of ss03 (its sequence index 1) first: feaLib writes
    the lookup records in the order of the input glyphs."""
    for rule in get_joiner_rules(font):
        rule.SubstLookupRecord = sorted(rule.SubstLookupRecord, key=lambda record: record.SequenceIndex != 1)


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
    builder.setupPost()
    builder.addOpenTypeFeatures(FEATURES)
    put_joiner_record_first(builder.font)
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path):
    font = TTFont(output_path)
    character_map = font.getBestCmap()
    assert character_map[0x0020] == "space" and character_map[0x200D] == "uni200D", character_map
    assert not any(codepoint in character_map for codepoint in [0x034F, 0x061C, 0x180B, 0x200C, 0x0622, 0xFE00, 0xFE01])
    assert character_map[0x0653] == "madda" and font["GDEF"].table.GlyphClassDef.classDefs["madda"] == 3, character_map
    variation_sequences = font["cmap"].getcmap(0, 5).uvsDict
    assert variation_sequences == {0xFE00: [(0x0062, None)], 0xFE01: [(0x0061, "a.alt")], 0x180B: [(0x0061, "a.fvs")]}, variation_sequences
    substitution_features = [record.FeatureTag for record in font["GSUB"].table.FeatureList.FeatureRecord]
    position_features = [record.FeatureTag for record in font["GPOS"].table.FeatureList.FeatureRecord]
    assert sorted(set(substitution_features)) == ["calt", "liga", "medi", "ss01", "ss02", "ss03"], substitution_features
    joiner_records = [[record.SequenceIndex for record in rule.SubstLookupRecord] for rule in get_joiner_rules(font)]
    assert joiner_records == [[1, 0, 0]], joiner_records
    assert sorted(set(position_features)) == ["kern", "mark"], position_features
    print(f"{output_path}: {len(GLYPHS)} glyphs, GSUB {substitution_features}, GPOS {position_features}, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a TrueType test font for the default ignorables.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
