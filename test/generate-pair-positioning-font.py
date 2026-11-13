"""Build a synthetic variable TrueType test font for the GPOS pair adjustments and the GPOS features of Font.shape.

Axis: wght 100..100..900 (the default is the minimum), a gvar table without glyph variations: only the GPOS values
vary, through the item variation store of GDEF, and the dist feature, through the FeatureVariations of GPOS. Glyphs of
500 units but space (250), A and V (600), alef (300), reh (400), acutecomb (0, a GDEF mark).
Language systems DFLT, latn, latn ROM and arab, all with the same features but locl, in latn ROM only.

GPOS lookups, in the order of the lookup list:
- 0 PAIR_ALL_FIELDS (kern): pos A <10 20 -30 40> V <-5 15 -25 35>; the four fields of both value records (format 1);
- 1 PAIR_SECOND_GLYPH (kern): pos a <0 0 -50 0> b <0 0 -20 0>; pos b c -30; pos c d -40; two format 1 subtables (feaLib
  splits them by value formats: b c and c d, then a b with a second value format): after a b HarfBuzz goes on after
  its second glyph, so in a b c d the b c pair is skipped and c d applies;
- 2 CLASS_PAIRS (kern, IgnoreMarks): pos [T] <0 0 -40 0> [o d] <15 -10 0 0>; class pairs (format 2), across marks;
- 3 VARIABLE_PAIR (kern): pos T a with variable values (VariationIndex devices) in every field of both records;
- 4 EXTENSION_PAIR (kern, extension lookup): pos o <5 0 -15 0> c <0 0 -5 0>;
- 5 ARABIC_PAIR (kern): pos reh <-100 0 -100 0> alef <0 30 -60 0>; in the order of the text, reh then alef;
- 6 MARK_TO_BASE (mark): pos base [a o] <anchor 250 500> mark @TOP_MARKS; a mark-to-base lookup (type 4);
- 7 DIST_PAIR (dist and kern): pos d a -70; listed by two features, applied once;
- 8 SS01_PAIR (ss01): pos d o -80; a feature that is off by default;
- 9 RVRN_PAIR (rvrn), 10 CALT_PAIR (calt), 11 LIGA_PAIR (liga), 12 LOCL_PAIR (locl, latn ROM): pos e f -50, pos f g
  -100, pos g h -70, pos h e -40; pairs of features that HarfBuzz enables by default for GSUB, which it looks up in
  GPOS too;
- 13 INIT_PAIR (init): pos beh beh -100; a pair of an Arabic form, which HarfBuzz applies at the glyphs of the form
  only (the second glyph of a pair included);
- 14 MSET_PAIR (mset): pos beh alef -30; pos a c -30; mset is a default GSUB feature of the Arabic shaper of HarfBuzz
  only, which it looks up in GPOS too: the Arabic pair applies by default, the Latin one does not;
- 15 ABVM_PAIR (abvm), 16 BLWM_PAIR (blwm): pos b a -60, pos c a -90; default GPOS features of every script;
- 17 DIST_HEAVY_PAIR: pos V A -200; in the dist feature from wght 600 to 900 only: there the FeatureVariations of GPOS
  replace the dist feature with one of DIST_PAIR and DIST_HEAVY_PAIR (feaLib adds the lookups of a variation block to
  the ones of the feature).

usage: generate-pair-positioning-font.py <output.ttf>
"""
import argparse

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Pair Positioning"

# glyph name, codepoint, advance width, contours (lists of points)
GLYPHS = [
    (".notdef", None, 500, [[(100, 0), (100, 700), (400, 700), (400, 0)]]),
    ("space", 0x0020, 250, []),
    ("A", 0x0041, 600, [[(20, 0), (300, 700), (580, 0)]]),
    ("T", 0x0054, 500, [[(200, 0), (200, 600), (20, 600), (20, 700), (480, 700), (480, 600), (300, 600), (300, 0)]]),
    ("V", 0x0056, 600, [[(20, 700), (580, 700), (300, 0)]]),
    ("a", 0x0061, 500, [[(50, 0), (50, 500), (450, 500), (450, 0)]]),
    ("b", 0x0062, 500, [[(50, 0), (50, 700), (450, 700), (450, 0)]]),
    ("c", 0x0063, 500, [[(50, 0), (50, 500), (450, 500), (450, 400), (150, 400), (150, 100), (450, 100), (450, 0)]]),
    ("d", 0x0064, 500, [[(50, 0), (50, 500), (350, 500), (350, 700), (450, 700), (450, 0)]]),
    ("o", 0x006F, 500, [[(50, 0), (50, 500), (450, 500), (450, 0)]]),
    ("acutecomb", 0x0301, 0, [[(-150, 550), (-100, 700), (-50, 700), (-100, 550)]]),
    ("alef", 0x0627, 300, [[(100, 0), (100, 700), (200, 700), (200, 0)]]),
    ("dal", 0x062F, 500, [[(50, 0), (50, 100), (350, 100), (350, 400), (450, 400), (450, 0)]]),
    ("reh", 0x0631, 400, [[(50, -200), (50, -100), (250, -100), (250, 300), (350, 300), (350, -200)]]),
    ("e", 0x0065, 500, [[(50, 0), (50, 500), (450, 500), (450, 300), (150, 300), (150, 100), (450, 100), (450, 0)]]),
    ("f", 0x0066, 500, [[(150, 0), (150, 700), (450, 700), (450, 600), (250, 600), (250, 0)]]),
    ("g", 0x0067, 500, [[(50, -200), (50, 500), (450, 500), (450, -200)]]),
    ("h", 0x0068, 500, [[(50, 0), (50, 700), (150, 700), (150, 500), (450, 500), (450, 0)]]),
    ("beh", 0x0628, 500, [[(50, 0), (50, 200), (450, 200), (450, 0)]]),
]

FEATURES = """
languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem latn ROM;
languagesystem arab dflt;

table GDEF {
    GlyphClassDef [A T V a b c d o alef dal reh e f g h beh], , [acutecomb], ;
} GDEF;

lookup PAIR_ALL_FIELDS {
    pos A <10 20 -30 40> V <-5 15 -25 35>;
} PAIR_ALL_FIELDS;

lookup PAIR_SECOND_GLYPH {
    pos a <0 0 -50 0> b <0 0 -20 0>;
    pos b c -30;
    pos c d -40;
} PAIR_SECOND_GLYPH;

lookup CLASS_PAIRS {
    lookupflag IgnoreMarks;
    pos [T] <0 0 -40 0> [o d] <15 -10 0 0>;
} CLASS_PAIRS;

lookup VARIABLE_PAIR {
    pos T <(wght=100:10 wght=900:30) (wght=100:0 wght=900:40) (wght=100:-20 wght=900:-60) (wght=100:5 wght=900:45)>
        a <(wght=100:0 wght=900:-10) (wght=100:0 wght=900:20) (wght=100:0 wght=900:-12) (wght=100:0 wght=900:8)>;
} VARIABLE_PAIR;

lookup EXTENSION_PAIR useExtension {
    pos o <5 0 -15 0> c <0 0 -5 0>;
} EXTENSION_PAIR;

lookup ARABIC_PAIR {
    pos reh <-100 0 -100 0> alef <0 30 -60 0>;
} ARABIC_PAIR;

markClass acutecomb <anchor -100 500> @TOP_MARKS;

lookup MARK_TO_BASE {
    pos base [a o] <anchor 250 500> mark @TOP_MARKS;
} MARK_TO_BASE;

lookup DIST_PAIR {
    pos d a -70;
} DIST_PAIR;

lookup SS01_PAIR {
    pos d o -80;
} SS01_PAIR;

lookup RVRN_PAIR {
    pos e f -50;
} RVRN_PAIR;

lookup CALT_PAIR {
    pos f g -100;
} CALT_PAIR;

lookup LIGA_PAIR {
    pos g h -70;
} LIGA_PAIR;

lookup LOCL_PAIR {
    pos h e -40;
} LOCL_PAIR;

lookup INIT_PAIR {
    pos beh beh -100;
} INIT_PAIR;

feature kern {
    lookup PAIR_ALL_FIELDS;
    lookup PAIR_SECOND_GLYPH;
    lookup CLASS_PAIRS;
    lookup VARIABLE_PAIR;
    lookup EXTENSION_PAIR;
    lookup ARABIC_PAIR;
    lookup DIST_PAIR;
} kern;

feature mark {
    lookup MARK_TO_BASE;
} mark;

feature dist {
    lookup DIST_PAIR;
} dist;

feature ss01 {
    lookup SS01_PAIR;
} ss01;

feature rvrn {
    lookup RVRN_PAIR;
} rvrn;

feature calt {
    lookup CALT_PAIR;
} calt;

feature liga {
    lookup LIGA_PAIR;
} liga;

feature locl {
    script latn;
    language ROM exclude_dflt;
    lookup LOCL_PAIR;
} locl;

feature init {
    lookup INIT_PAIR;
} init;

lookup MSET_PAIR {
    pos beh alef -30;
    pos a c -30;
} MSET_PAIR;

lookup ABVM_PAIR {
    pos b a -60;
} ABVM_PAIR;

lookup BLWM_PAIR {
    pos c a -90;
} BLWM_PAIR;

lookup DIST_HEAVY_PAIR {
    pos V A -200;
} DIST_HEAVY_PAIR;

feature mset {
    lookup MSET_PAIR;
} mset;

feature abvm {
    lookup ABVM_PAIR;
} abvm;

feature blwm {
    lookup BLWM_PAIR;
} blwm;

conditionset heavy {
    wght 600 900;
} heavy;

variation dist heavy {
    lookup DIST_HEAVY_PAIR;
} dist;
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
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(character_map)
    builder.setupGlyf(glyphs)
    glyph_table = builder.font["glyf"]
    builder.setupHorizontalMetrics(
        {glyph_name: (advance, getattr(glyph_table[glyph_name], "xMin", 0)) for glyph_name, _, advance, _ in GLYPHS}
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
    builder.setupFvar(axes=[("wght", 100, 100, 900, "Weight")], instances=[])
    # a gvar table without variations, the table of the outlines of a variable TrueType font
    builder.setupGvar({})
    addOpenTypeFeaturesFromString(builder.font, FEATURES, tables=["GPOS", "GDEF"])
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def get_subtables(lookup):
    """The subtables of a lookup, the ones of an extension lookup unwrapped."""
    if lookup.LookupType == 9:
        return [subtable.ExtSubTable for subtable in lookup.SubTable]
    return lookup.SubTable


def verify_font(output_path):
    font = TTFont(output_path)
    position_table = font["GPOS"].table
    lookups = position_table.LookupList.Lookup
    lookup_types = [lookup.LookupType for lookup in lookups]
    assert lookup_types == [2, 2, 2, 2, 9, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], lookup_types
    assert lookups[2].LookupFlag == 8, lookups[2].LookupFlag
    formats = [[subtable.Format for subtable in get_subtables(lookup)] for lookup in lookups]
    assert formats == [[1], [1, 1], [2], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1]], formats
    value_formats = [(subtable.ValueFormat1, subtable.ValueFormat2) for subtable in get_subtables(lookups[1])]
    assert value_formats == [(4, 0), (4, 4)], value_formats
    # every field of both records of T a has a VariationIndex device
    variable_subtable = get_subtables(lookups[3])[0]
    assert (variable_subtable.ValueFormat1, variable_subtable.ValueFormat2) == (0xFF, 0xFF)
    features = [(record.FeatureTag, record.Feature.LookupListIndex) for record in position_table.FeatureList.FeatureRecord]
    assert features == [
        ("abvm", [15]), ("blwm", [16]), ("calt", [10]), ("dist", [7]), ("init", [13]), ("kern", [0, 1, 2, 3, 4, 5, 7]),
        ("liga", [11]), ("locl", [12]), ("mark", [6]), ("mset", [14]), ("rvrn", [9]), ("ss01", [8])
    ], features
    # locl (feature index 7) in the latn ROM language system only
    latin_script = next(record.Script for record in position_table.ScriptList.ScriptRecord if record.ScriptTag == "latn")
    assert 7 not in latin_script.DefaultLangSys.FeatureIndex, latin_script.DefaultLangSys.FeatureIndex
    assert [(record.LangSysTag, 7 in record.LangSys.FeatureIndex) for record in latin_script.LangSysRecord] == [("ROM ", True)]
    # dist (feature index 3) with DIST_HEAVY_PAIR from wght 600 (normalized 0.625) to 900
    variation_records = position_table.FeatureVariations.FeatureVariationRecord
    conditions = [
        [(condition.AxisIndex, condition.FilterRangeMinValue, condition.FilterRangeMaxValue)
         for condition in record.ConditionSet.ConditionTable]
        for record in variation_records
    ]
    assert conditions == [[(0, 0.625, 1.0)]], conditions
    substitutions = [
        [(substitution.FeatureIndex, substitution.Feature.LookupListIndex)
         for substitution in record.FeatureTableSubstitution.SubstitutionRecord]
        for record in variation_records
    ]
    assert substitutions == [[(3, [7, 17])]], substitutions
    print(f"{output_path}: GPOS lookups of types 2, 4 and 9, a VariationIndex device in each field of T a, "
          "a feature variation of dist, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a variable TrueType test font for the GPOS pair adjustments.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
