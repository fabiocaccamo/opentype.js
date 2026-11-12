"""Build the reference fonts of the lookupFlag unit tests, whose glyphs and GDEF table are the ones of
test/lookup-flags-font.mjs: the hb-shape outputs the tests quote come from these fonts.

LookupFlags.ttf has the GSUB lookups of the tests, each one in the feature that hb-shape enables to run it,
and their kern feature. The tests build the same lookups as synthetic tables, in the feature the fork
applies them with (e.g. calt for the latin features, rlig for the arabic required ligatures):

    hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+ss01 LookupFlags.ttf -u 0061,0301,0062

LookupFlags.ttf is also in test/fonts, for the end-to-end tests of test/font.spec.mjs, which check that the
synthetic tables of test/lookup-flags-font.mjs keep the glyphs and the GDEF table of the font.

The variants of LookupFlags.ttf:
- LookupFlagsKernTable.ttf: without the GPOS table, with a kern table (format 0) of the pairs a acute -15
  and a b -60;
- LookupFlagsNoGDEF.ttf: without the GDEF table;
- LookupFlagsExtension.ttf: the lookups LOOKAHEAD_IGNORE_MARKS (ss03) and KERN_IGNORE_MARKS (kern) in
  extension lookups (useExtension);
- LookupFlagsEmptyContextInput.ttf: the ContextSubst format 3 of ss01 (INPUT_IGNORE_MARKS) with a
  GlyphCount of 0;
- LookupFlagsEmptyChainInput.ttf: the ChainContextSubst format 3 of ss02 (BACKTRACK_IGNORE_MARKS) with an
  InputGlyphCount of 0;
- LookupFlagsCcmpLigature.ttf: the lookups of rlig (RLIG_IGNORE_MARKS, RLIG_AFTER_LIGATURE_IGNORE_MARKS) in ccmp, after
  MULTIPLE_DAL, and no rlig feature;
- LookupFlagsCcmpBeforeRlig.ttf: the ligature of two marks LIGATURE_FATHAS (sub fatha fatha by fatha;) in ccmp, after
  MULTIPLE_DAL, before the IgnoreMarks ligature of rlig (RLIG_IGNORE_MARKS);
- LookupFlagsOneComponentLigature.ttf: the ligature of ss10 with the component a only (a CompCount of 1), by a.alt;
- LookupFlagsBlocklistedGDEF.ttf: the GDEF table of LookupFlags.ttf, the lookups ss01 (lookupflag IgnoreLigatures;
  sub a b by a_b;), ss02 (lookupflag IgnoreLigatures; sub ff by a_b_c;) and kern (pos a b -50;), with the GDEF, GSUB
  and GPOS tables padded to the lengths of a font of the blocklist of HarfBuzz, as TestGDEF-Blocklisted.ttf of
  test/generate-gdef-blocklist-fonts.py: HarfBuzz ignores its GDEF table.

The bases and the ligatures are 500 units wide, the marks 0.

usage: generate-lookup-flags-font.py <output directory>
"""
import argparse
import importlib.util
import os
import sys

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import newTable
from fontTools.ttLib.tables._k_e_r_n import KernTable_format_0

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Lookup Flags"

# glyph name, codepoint, advance width, in the glyph order of test/lookup-flags-font.mjs
GLYPHS = [
    (".notdef", None, 500),
    ("a", 0x61, 500),
    ("b", 0x62, 500),
    ("c", 0x63, 500),
    ("ff", 0xFB00, 500),
    ("acute", 0x301, 0),
    ("dotbelow", 0x323, 0),
    ("a.alt", None, 500),
    ("b.alt", None, 500),
    ("a_b", None, 500),
    ("a_b_c", None, 500),
    ("acute.alt", None, 0),
    ("alef", 0x627, 500),
    ("reh", 0x631, 500),
    ("fatha", 0x64E, 0),
    ("dal", 0x62F, 500),
    ("waw", 0x648, 500),
    ("dal.alt", None, 500),
    ("lam", 0x644, 500),
    ("lam_alef", None, 500),
    ("reh.alt", None, 500),
    ("A", 0x41, 500),
    ("V", 0x56, 500),
    ("Agrave", 0xC0, 500),
    ("gravecomb", 0x300, 0),
]

# the language systems, the glyph classes and the GDEF table of every font
GDEF_FEATURES = """
languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem arab dflt;

@ACUTES = [acute acute.alt];
@DOTS = [dotbelow];

table GDEF {
    GlyphClassDef [a b c a.alt b.alt alef reh dal waw dal.alt lam reh.alt A V Agrave], [ff a_b a_b_c lam_alef], [acute dotbelow acute.alt fatha gravecomb], ;
} GDEF;
"""

FEATURES = GDEF_FEATURES + """
lookup SUB_A {
    sub a by a.alt;
} SUB_A;

lookup SUB_B {
    sub b by b.alt;
} SUB_B;

lookup INPUT_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub a' b' lookup SUB_B;
} INPUT_IGNORE_MARKS;

lookup BACKTRACK_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub a b' by b.alt;
} BACKTRACK_IGNORE_MARKS;

lookup LOOKAHEAD_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub a' b by a.alt;
} LOOKAHEAD_IGNORE_MARKS;

lookup LIGATURE_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub a b c by a_b_c;
    sub a b by a_b;
} LIGATURE_IGNORE_MARKS;

lookup LOOKAHEAD_IGNORE_BASE_GLYPHS {
    lookupflag IgnoreBaseGlyphs;
    sub acute' dotbelow by acute.alt;
} LOOKAHEAD_IGNORE_BASE_GLYPHS;

lookup SINGLE_IGNORE_BASE_GLYPHS {
    lookupflag IgnoreBaseGlyphs;
    sub a by a.alt;
} SINGLE_IGNORE_BASE_GLYPHS;

lookup LOOKAHEAD_IGNORE_LIGATURES {
    lookupflag IgnoreLigatures;
    sub a' b by a.alt;
} LOOKAHEAD_IGNORE_LIGATURES;

lookup LOOKAHEAD_MARK_ATTACHMENT_TYPE {
    lookupflag MarkAttachmentType @ACUTES;
    sub a' b by a.alt;
} LOOKAHEAD_MARK_ATTACHMENT_TYPE;

lookup LOOKAHEAD_MARK_ATTACHMENT_TYPE_DOTS {
    lookupflag MarkAttachmentType @DOTS;
    sub b' a by b.alt;
} LOOKAHEAD_MARK_ATTACHMENT_TYPE_DOTS;

lookup LOOKAHEAD_MARK_FILTERING_SET {
    lookupflag UseMarkFilteringSet @DOTS;
    sub a' b by a.alt;
} LOOKAHEAD_MARK_FILTERING_SET;

lookup LIGATURE_NO_FLAG {
    sub a b by a_b;
} LIGATURE_NO_FLAG;

lookup LOOKAHEAD_SET_AND_ATTACHMENT_TYPE {
    lookupflag MarkAttachmentType @ACUTES UseMarkFilteringSet @DOTS;
    sub a' b by a.alt;
} LOOKAHEAD_SET_AND_ATTACHMENT_TYPE;

lookup INPUT_LOOKAHEAD_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub a' lookup SUB_A b' c;
} INPUT_LOOKAHEAD_IGNORE_MARKS;

lookup BACKTRACK_INPUT_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub c a' b' lookup SUB_B;
} BACKTRACK_INPUT_IGNORE_MARKS;

lookup MULTIPLE_C {
    sub c by a acute;
} MULTIPLE_C;

lookup LOOKAHEAD_MULTIPLE_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub b' a by b.alt;
} LOOKAHEAD_MULTIPLE_IGNORE_MARKS;

lookup THIRD_INPUT_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub a' b' a' lookup SUB_A;
} THIRD_INPUT_IGNORE_MARKS;

lookup OVERLAPPING_INPUT {
    sub a' lookup SUB_A a';
} OVERLAPPING_INPUT;

lookup LIGATURE_MARK_ATTACHMENT_TYPE {
    lookupflag MarkAttachmentType @ACUTES;
    sub a b by a_b;
} LIGATURE_MARK_ATTACHMENT_TYPE;

lookup LIGATURE_IGNORE_LIGATURES {
    lookupflag IgnoreLigatures;
    sub a b by a_b;
} LIGATURE_IGNORE_LIGATURES;

lookup MULTIPLE_DAL {
    sub dal by dal.alt fatha;
} MULTIPLE_DAL;

lookup RLIG_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub lam alef by lam_alef;
} RLIG_IGNORE_MARKS;

feature ss01 { lookup INPUT_IGNORE_MARKS; } ss01;
feature ss02 { lookup BACKTRACK_IGNORE_MARKS; } ss02;
feature ss03 { lookup LOOKAHEAD_IGNORE_MARKS; } ss03;
feature ss04 { lookup LIGATURE_IGNORE_MARKS; } ss04;
feature ss05 { lookup LOOKAHEAD_IGNORE_BASE_GLYPHS; } ss05;
feature ss06 { lookup SINGLE_IGNORE_BASE_GLYPHS; } ss06;
feature ss07 { lookup LOOKAHEAD_IGNORE_LIGATURES; } ss07;
feature ss08 { lookup LOOKAHEAD_MARK_ATTACHMENT_TYPE; lookup LOOKAHEAD_MARK_ATTACHMENT_TYPE_DOTS; } ss08;
feature ss09 { lookup LOOKAHEAD_MARK_FILTERING_SET; } ss09;
feature ss10 { lookup LIGATURE_NO_FLAG; } ss10;
feature ss11 { lookup LOOKAHEAD_SET_AND_ATTACHMENT_TYPE; } ss11;
feature ss12 { lookup INPUT_LOOKAHEAD_IGNORE_MARKS; } ss12;
feature ss13 { lookup BACKTRACK_INPUT_IGNORE_MARKS; } ss13;
feature ss14 { lookup MULTIPLE_C; lookup LOOKAHEAD_MULTIPLE_IGNORE_MARKS; } ss14;
feature ss15 { lookup THIRD_INPUT_IGNORE_MARKS; } ss15;
feature ss16 { lookup OVERLAPPING_INPUT; } ss16;
feature ss17 { lookup LIGATURE_MARK_ATTACHMENT_TYPE; } ss17;
feature ss18 { lookup LIGATURE_IGNORE_LIGATURES; } ss18;
feature ccmp { lookup MULTIPLE_DAL; } ccmp;

# the lookups below come after MULTIPLE_C and RLIG_IGNORE_MARKS in the lookup list, the order HarfBuzz applies them in
lookup SINGLE_AT_MULTIPLE_IGNORE_BASE_GLYPHS {
    lookupflag IgnoreBaseGlyphs;
    sub a' lookup SUB_A;
} SINGLE_AT_MULTIPLE_IGNORE_BASE_GLYPHS;

lookup SINGLE_AT_MULTIPLE_NO_FLAG {
    sub a' lookup SUB_A;
} SINGLE_AT_MULTIPLE_NO_FLAG;

lookup INPUT_AT_MULTIPLE_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub a' b' lookup SUB_B;
} INPUT_AT_MULTIPLE_IGNORE_MARKS;

lookup RLIG_AFTER_LIGATURE_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub lam_alef reh' by reh.alt;
} RLIG_AFTER_LIGATURE_IGNORE_MARKS;

lookup LIGATURE_AT_MULTIPLE_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub a b by a_b;
} LIGATURE_AT_MULTIPLE_IGNORE_MARKS;

feature ss19 { lookup MULTIPLE_C; lookup SINGLE_AT_MULTIPLE_IGNORE_BASE_GLYPHS; } ss19;
feature ss20 { lookup MULTIPLE_C; lookup SINGLE_AT_MULTIPLE_NO_FLAG; } ss20;
feature ss21 { lookup MULTIPLE_C; lookup INPUT_AT_MULTIPLE_IGNORE_MARKS; } ss21;
feature ss22 { lookup MULTIPLE_C; lookup LIGATURE_AT_MULTIPLE_IGNORE_MARKS; } ss22;
feature rlig { lookup RLIG_IGNORE_MARKS; lookup RLIG_AFTER_LIGATURE_IGNORE_MARKS; } rlig;

lookup KERN_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    pos a b -50;
    pos a acute -40;
    pos acute b -30;
    pos b reh -60;
    pos reh b -70;
    pos reh alef <-100 0 -100 0>;
    pos dal.alt waw <-40 0 -40 0>;
    pos waw dal.alt <-30 0 -30 0>;
    pos a_b c -25;
} KERN_IGNORE_MARKS;

lookup KERN_NO_FLAG {
    pos a acute -20;
} KERN_NO_FLAG;

# the pair of the bases A V, not of the precomposed Agrave V
lookup KERN_BASES_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    pos A V -100;
} KERN_BASES_IGNORE_MARKS;

feature kern { lookup KERN_IGNORE_MARKS; lookup KERN_NO_FLAG; lookup KERN_BASES_IGNORE_MARKS; } kern;
"""

# the lookups of LookupFlagsBlocklistedGDEF.ttf, whose GSUB table fits in the length of the blocklist
BLOCKLISTED_GDEF_FEATURES = GDEF_FEATURES + """
lookup LIGATURE_IGNORE_LIGATURES {
    lookupflag IgnoreLigatures;
    sub a b by a_b;
} LIGATURE_IGNORE_LIGATURES;

lookup SINGLE_IGNORE_LIGATURES {
    lookupflag IgnoreLigatures;
    sub ff by a_b_c;
} SINGLE_IGNORE_LIGATURES;

feature ss01 { lookup LIGATURE_IGNORE_LIGATURES; } ss01;
feature ss02 { lookup SINGLE_IGNORE_LIGATURES; } ss02;
feature kern { pos a b -50; } kern;
"""

# the pairs of the kern table of LookupFlagsKernTable.ttf
KERN_TABLE_PAIRS = {("a", "acute"): -15, ("a", "b"): -60}

# the lookups of LookupFlagsExtension.ttf in extension lookups
EXTENSION_LOOKUP_NAMES = ["LOOKAHEAD_IGNORE_MARKS", "KERN_IGNORE_MARKS"]


def draw_rectangle():
    pen = TTGlyphPen(None)
    pen.moveTo((100, 0))
    pen.lineTo((100, 500))
    pen.lineTo((400, 500))
    pen.lineTo((400, 0))
    pen.closePath()
    return pen.glyph()


def build_font(features=FEATURES):
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder([glyph_name for glyph_name, _, _ in GLYPHS])
    builder.setupCharacterMap({codepoint: glyph_name for glyph_name, codepoint, _ in GLYPHS if codepoint is not None})
    builder.setupGlyf({glyph_name: draw_rectangle() for glyph_name, _, _ in GLYPHS})
    builder.setupHorizontalMetrics({glyph_name: (advance, 100) for glyph_name, _, advance in GLYPHS})
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
    builder.addOpenTypeFeatures(features)
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    return builder.font


def replace_gpos_with_kern_table(font):
    del font["GPOS"]
    kern_subtable = KernTable_format_0()
    kern_subtable.version = 0
    kern_subtable.coverage = 1
    kern_subtable.format = 0
    kern_subtable.kernTable = dict(KERN_TABLE_PAIRS)
    kern_table = newTable("kern")
    kern_table.version = 0
    kern_table.kernTables = [kern_subtable]
    font["kern"] = kern_table


def get_extension_features():
    features = FEATURES
    for lookup_name in EXTENSION_LOOKUP_NAMES:
        features = features.replace(f"lookup {lookup_name} {{", f"lookup {lookup_name} useExtension {{")
    return features


def get_feature_subtable(font, feature_tag):
    gsub = font["GSUB"].table
    record = next(record for record in gsub.FeatureList.FeatureRecord if record.FeatureTag == feature_tag)
    lookup = gsub.LookupList.Lookup[record.Feature.LookupListIndex[0]]
    return lookup.LookupType, lookup.SubTable[0]


def empty_context_input(font):
    lookup_type, subtable = get_feature_subtable(font, "ss01")
    assert lookup_type == 5 and subtable.Format == 3
    subtable.Coverage = []
    subtable.GlyphCount = 0


def empty_chain_input(font):
    lookup_type, subtable = get_feature_subtable(font, "ss02")
    assert lookup_type == 6 and subtable.Format == 3
    subtable.InputCoverage = []
    subtable.InputGlyphCount = 0


def get_ccmp_ligature_features():
    rlig_feature = "feature rlig { lookup RLIG_IGNORE_MARKS; lookup RLIG_AFTER_LIGATURE_IGNORE_MARKS; } rlig;"
    ccmp_feature = "feature ccmp { lookup RLIG_IGNORE_MARKS; lookup RLIG_AFTER_LIGATURE_IGNORE_MARKS; } ccmp;"
    assert rlig_feature in FEATURES
    return FEATURES.replace(rlig_feature, ccmp_feature)


def get_ccmp_before_rlig_features():
    ccmp_feature = "feature ccmp { lookup MULTIPLE_DAL; } ccmp;"
    fatha_ligature_lookup = "lookup LIGATURE_FATHAS {\n    sub fatha fatha by fatha;\n} LIGATURE_FATHAS;\n\n"
    ccmp_before_rlig_feature = "feature ccmp { lookup MULTIPLE_DAL; lookup LIGATURE_FATHAS; } ccmp;"
    assert ccmp_feature in FEATURES
    return FEATURES.replace(ccmp_feature, fatha_ligature_lookup + ccmp_before_rlig_feature)


def one_component_ligature(font):
    lookup_type, subtable = get_feature_subtable(font, "ss10")
    assert lookup_type == 4
    ligature = subtable.ligatures["a"][0]
    ligature.LigGlyph = "a.alt"
    ligature.Component = []


def load_gdef_blocklist_generator():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "generate-gdef-blocklist-fonts.py")
    specification = importlib.util.spec_from_file_location("generate_gdef_blocklist_fonts", path)
    module = importlib.util.module_from_spec(specification)
    # no __pycache__ folder in test/
    sys.dont_write_bytecode = True
    specification.loader.exec_module(module)
    return module


def build_blocklisted_gdef_font():
    gdef_blocklist_generator = load_gdef_blocklist_generator()
    font = build_font(BLOCKLISTED_GDEF_FEATURES)
    for tag, length in gdef_blocklist_generator.TABLE_LENGTHS["TestGDEF-Blocklisted.ttf"].items():
        gdef_blocklist_generator.pad_table(font, tag, length)
    return font


def main():
    parser = argparse.ArgumentParser(description="Build the reference fonts of the lookupFlag unit tests.")
    parser.add_argument("output_directory", help="directory of the fonts")
    arguments = parser.parse_args()
    fonts = {"LookupFlags.ttf": build_font(), "LookupFlagsExtension.ttf": build_font(get_extension_features())}
    fonts["LookupFlagsKernTable.ttf"] = build_font()
    replace_gpos_with_kern_table(fonts["LookupFlagsKernTable.ttf"])
    fonts["LookupFlagsNoGDEF.ttf"] = build_font()
    del fonts["LookupFlagsNoGDEF.ttf"]["GDEF"]
    fonts["LookupFlagsEmptyContextInput.ttf"] = build_font()
    empty_context_input(fonts["LookupFlagsEmptyContextInput.ttf"])
    fonts["LookupFlagsEmptyChainInput.ttf"] = build_font()
    empty_chain_input(fonts["LookupFlagsEmptyChainInput.ttf"])
    fonts["LookupFlagsOneComponentLigature.ttf"] = build_font()
    one_component_ligature(fonts["LookupFlagsOneComponentLigature.ttf"])
    fonts["LookupFlagsBlocklistedGDEF.ttf"] = build_blocklisted_gdef_font()
    fonts["LookupFlagsCcmpLigature.ttf"] = build_font(get_ccmp_ligature_features())
    fonts["LookupFlagsCcmpBeforeRlig.ttf"] = build_font(get_ccmp_before_rlig_features())
    for file_name, font in fonts.items():
        font.save(os.path.join(arguments.output_directory, file_name))


if __name__ == "__main__":
    main()
