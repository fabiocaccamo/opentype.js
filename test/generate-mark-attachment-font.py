"""Build a synthetic variable TrueType test font for the GPOS mark and cursive attachments (lookup types 3 to 6) of
Font.shape.

Axis: wght 100..100..900 (the default is the minimum), a gvar table without glyph variations: only the anchors of b
and of the entry of y in CURSIVE_VARIABLE vary, through the item variation store of GDEF. Glyphs of 500 units but space
(250), f (300), i (250), the ligatures f_i (550) and a_f_i (1000, GDEF ligatures), the marks acutecomb, gravecomb and
fatha (0) and dotbelowcomb (100, a mark with an advance), and the Cyrillic ocyr (U+043E) last. Language systems DFLT,
latn and arab, with the same features.

GSUB lookups:
- LIGA_F_I (liga, IgnoreMarks): sub f i i by f_i; sub f i by f_i;
- LIGA_A_F_I (ss12, IgnoreMarks): sub a f_i by a_f_i;, a ligature whose last component is a ligature;
- MULTIPLE_Z (ss10): sub z by a x;
- CONTEXTUAL_LIGA_F_I (ss11, IgnoreMarks): sub f' lookup LIGA_F_I i';
- MULTIPLE_Z_MARKS (ss20): sub z by dotbelowcomb acutecomb;, before LIGA_F_I_A, which skips its marks;
- LIGA_F_I_A (ss16, IgnoreMarks): sub f_i a by a_f_i;, a ligature whose first component is a ligature;
- LIGA_MARKS (ss17): sub dotbelowcomb gravecomb by acutecomb;, a ligature of marks;

GPOS lookups, in the order of the lookup list (mark classes @TOP: acutecomb and gravecomb at 0 500, @BOTTOM:
dotbelowcomb at 50 -50, @ARABIC_TOP: fatha at 0 450):
- 0 MARK_TO_BASE (mark): a 250 520 for @TOP and 250 -20 for @BOTTOM, b with variable anchors (260 700 at wght 100, 300
  760 at wght 900) for @TOP only, i with a contour point (format 2, 125 600 contourpoint 2) for @TOP, beh 260 480 for
  @ARABIC_TOP, ocyr 250 -20 for @BOTTOM (the dot below of a Cyrillic base, whose Script_Extensions lack Cyrl);
- 1 MARK_TO_LIGATURE (mark): f_i 150 700 for @TOP and 150 -20 for @BOTTOM on its first component, 420 700 for @TOP on its
  second one; a_f_i 250 700, 600 700 and 850 700 for @TOP on its three components;
- 2 MARK_TO_MARK (mkmk): acutecomb 0 750 for @TOP;
- 3 MARK_TO_MARK_FILTERED (ss02, UseMarkFilteringSet [acutecomb]): acutecomb 0 750 for @TOP;
- 4 MARK_TO_BASE_IGNORE_LIGATURES (ss04, IgnoreLigatures): a 250 900 for @TOP;
- 5 CURSIVE_REVERSED (ss03, RightToLeft): x exit 450 100, y entry 30 50 and exit 470 -60, z entry 20 40;
- 6 CURSIVE_LEFT_TO_RIGHT (curs): x exit 450 100, y entry 30 0 and exit 470 -60, z entry 20 40 (an anchor of format 3
  with Device tables, for the hinting only);
- 7 SINGLE_BEH (ss09): pos beh <15 0 0 0>;
- 8 CURSIVE_RIGHT_TO_LEFT (curs, RightToLeft and IgnoreMarks): beh entry 480 30 and exit 20 0;
- 9 KERN_A_B (kern, IgnoreMarks): pos a b -50;
- 10 SINGLE_DOTBELOW (ss01): pos dotbelowcomb <0 0 40 0>;
- 11 CURSIVE_X_Y (ss05): x exit 450 100, y entry 30 30;
- 12 MARK_TO_MARK_IGNORE_BASES (ss06, IgnoreBaseGlyphs): acutecomb 0 750 for @TOP;
- 13 CURSIVE_VARIABLE (ss07): x exit 450 100, y entry with variable coordinates (30 0 at wght 100, 90 -80 at wght 900);
- 14 MARK_TO_MARK_ATTACHMENT_TYPE (ss08, MarkAttachmentType [acutecomb]): acutecomb 0 750 for @TOP;
- 15 MARK_TO_BASE_ATTACHMENT_TYPE (ss13, MarkAttachmentType [acutecomb]): a 250 900 for @TOP;
- 16 MARK_TO_BASE_FILTERED (ss14, UseMarkFilteringSet [acutecomb]): a 250 900 for @TOP;
- 17 MARK_TO_LIGATURE_ATTACHMENT_TYPE (ss15, MarkAttachmentType [acutecomb]): f_i 150 900 and 420 900 for @TOP;
- 18 MARK_TO_MARK_IGNORE_LIGATURES (ss18, IgnoreLigatures): acutecomb 0 750 for @TOP;
- 19 MARK_TO_MARK_BASE_GLYPH (ss19): a 250 900 for @TOP, a mark2 glyph that GDEF classes as a base glyph;

usage: generate-mark-attachment-font.py <output.ttf>
"""
import argparse

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Mark Attachment"

# glyph name, codepoint, advance width, contours (lists of points)
GLYPHS = [
    (".notdef", None, 500, [[(100, 0), (100, 700), (400, 700), (400, 0)]]),
    ("space", 0x0020, 250, []),
    ("a", 0x0061, 500, [[(50, 0), (50, 500), (450, 500), (450, 0)]]),
    ("b", 0x0062, 500, [[(50, 0), (50, 700), (450, 700), (450, 0)]]),
    ("f", 0x0066, 300, [[(50, 0), (50, 700), (250, 700), (250, 600), (150, 600), (150, 0)]]),
    ("i", 0x0069, 250, [[(75, 0), (75, 500), (175, 500), (175, 0)]]),
    ("x", 0x0078, 500, [[(50, 0), (450, 500), (450, 400), (150, 0)]]),
    ("y", 0x0079, 500, [[(50, 500), (450, 0), (450, 100), (150, 500)]]),
    ("z", 0x007A, 500, [[(50, 0), (50, 500), (450, 500), (450, 400), (150, 0)]]),
    ("f_i", None, 550, [[(50, 0), (50, 700), (500, 700), (500, 0)]]),
    ("acutecomb", 0x0301, 0, [[(-150, 550), (-100, 700), (-50, 700), (-100, 550)]]),
    ("gravecomb", 0x0300, 0, [[(-150, 700), (-100, 700), (-50, 550), (-100, 550)]]),
    ("dotbelowcomb", 0x0323, 100, [[(25, -150), (25, -100), (75, -100), (75, -150)]]),
    ("beh", 0x0628, 500, [[(20, 0), (20, 100), (480, 100), (480, 0)]]),
    ("fatha", 0x064E, 0, [[(-150, 550), (-50, 600), (-50, 570), (-150, 520)]]),
    ("a_f_i", None, 1000, [[(50, 0), (50, 700), (950, 700), (950, 0)]]),
    ("ocyr", 0x043E, 500, [[(50, 0), (50, 500), (450, 500), (450, 0)]]),
]

FEATURES = """
languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem arab dflt;

table GDEF {
    GlyphClassDef [a b f i x y z beh ocyr], [f_i a_f_i], [acutecomb gravecomb dotbelowcomb fatha], ;
} GDEF;

lookup LIGA_F_I {
    lookupflag IgnoreMarks;
    sub f i i by f_i;
    sub f i by f_i;
} LIGA_F_I;

lookup LIGA_A_F_I {
    lookupflag IgnoreMarks;
    sub a f_i by a_f_i;
} LIGA_A_F_I;

lookup MULTIPLE_Z {
    sub z by a x;
} MULTIPLE_Z;

lookup CONTEXTUAL_LIGA_F_I {
    lookupflag IgnoreMarks;
    sub f' lookup LIGA_F_I i';
} CONTEXTUAL_LIGA_F_I;

feature liga {
    lookup LIGA_F_I;
} liga;

feature ss10 {
    lookup MULTIPLE_Z;
} ss10;

feature ss11 {
    lookup CONTEXTUAL_LIGA_F_I;
} ss11;

feature ss12 {
    lookup LIGA_A_F_I;
} ss12;

lookup MULTIPLE_Z_MARKS {
    sub z by dotbelowcomb acutecomb;
} MULTIPLE_Z_MARKS;

feature ss20 {
    lookup MULTIPLE_Z_MARKS;
} ss20;

lookup LIGA_F_I_A {
    lookupflag IgnoreMarks;
    sub f_i a by a_f_i;
} LIGA_F_I_A;

lookup LIGA_MARKS {
    sub dotbelowcomb gravecomb by acutecomb;
} LIGA_MARKS;

feature ss16 {
    lookup LIGA_F_I_A;
} ss16;

feature ss17 {
    lookup LIGA_MARKS;
} ss17;

markClass [acutecomb gravecomb] <anchor 0 500> @TOP;
markClass dotbelowcomb <anchor 50 -50> @BOTTOM;
markClass fatha <anchor 0 450> @ARABIC_TOP;

lookup MARK_TO_BASE {
    pos base a <anchor 250 520> mark @TOP <anchor 250 -20> mark @BOTTOM;
    pos base b <anchor (wght=100:260 wght=900:300) (wght=100:700 wght=900:760)> mark @TOP;
    pos base i <anchor 125 600 contourpoint 2> mark @TOP;
    pos base beh <anchor 260 480> mark @ARABIC_TOP;
    pos base ocyr <anchor 250 -20> mark @BOTTOM;
} MARK_TO_BASE;

lookup MARK_TO_LIGATURE {
    pos ligature f_i <anchor 150 700> mark @TOP <anchor 150 -20> mark @BOTTOM
        ligComponent <anchor 420 700> mark @TOP;
    pos ligature a_f_i <anchor 250 700> mark @TOP
        ligComponent <anchor 600 700> mark @TOP
        ligComponent <anchor 850 700> mark @TOP;
} MARK_TO_LIGATURE;

lookup MARK_TO_MARK {
    pos mark acutecomb <anchor 0 750> mark @TOP;
} MARK_TO_MARK;

lookup MARK_TO_MARK_FILTERED {
    lookupflag UseMarkFilteringSet [acutecomb];
    pos mark acutecomb <anchor 0 750> mark @TOP;
} MARK_TO_MARK_FILTERED;

lookup MARK_TO_BASE_IGNORE_LIGATURES {
    lookupflag IgnoreLigatures;
    pos base a <anchor 250 900> mark @TOP;
} MARK_TO_BASE_IGNORE_LIGATURES;

lookup CURSIVE_REVERSED {
    lookupflag RightToLeft;
    pos cursive x <anchor NULL> <anchor 450 100>;
    pos cursive y <anchor 30 50> <anchor 470 -60>;
    pos cursive z <anchor 20 40> <anchor NULL>;
} CURSIVE_REVERSED;

lookup CURSIVE_LEFT_TO_RIGHT {
    pos cursive x <anchor NULL> <anchor 450 100>;
    pos cursive y <anchor 30 0> <anchor 470 -60>;
    pos cursive z <anchor 20 40 <device 12 1> <device 12 -1>> <anchor NULL>;
} CURSIVE_LEFT_TO_RIGHT;

lookup SINGLE_BEH {
    pos beh <15 0 0 0>;
} SINGLE_BEH;

lookup CURSIVE_RIGHT_TO_LEFT {
    lookupflag RightToLeft IgnoreMarks;
    pos cursive beh <anchor 480 30> <anchor 20 0>;
} CURSIVE_RIGHT_TO_LEFT;

lookup KERN_A_B {
    lookupflag IgnoreMarks;
    pos a b -50;
} KERN_A_B;

lookup SINGLE_DOTBELOW {
    pos dotbelowcomb <0 0 40 0>;
} SINGLE_DOTBELOW;

lookup CURSIVE_X_Y {
    pos cursive x <anchor NULL> <anchor 450 100>;
    pos cursive y <anchor 30 30> <anchor NULL>;
} CURSIVE_X_Y;

lookup MARK_TO_MARK_IGNORE_BASES {
    lookupflag IgnoreBaseGlyphs;
    pos mark acutecomb <anchor 0 750> mark @TOP;
} MARK_TO_MARK_IGNORE_BASES;

lookup CURSIVE_VARIABLE {
    pos cursive x <anchor NULL> <anchor 450 100>;
    pos cursive y <anchor (wght=100:30 wght=900:90) (wght=100:0 wght=900:-80)> <anchor NULL>;
} CURSIVE_VARIABLE;

lookup MARK_TO_MARK_ATTACHMENT_TYPE {
    lookupflag MarkAttachmentType [acutecomb];
    pos mark acutecomb <anchor 0 750> mark @TOP;
} MARK_TO_MARK_ATTACHMENT_TYPE;

lookup MARK_TO_BASE_ATTACHMENT_TYPE {
    lookupflag MarkAttachmentType [acutecomb];
    pos base a <anchor 250 900> mark @TOP;
} MARK_TO_BASE_ATTACHMENT_TYPE;

lookup MARK_TO_BASE_FILTERED {
    lookupflag UseMarkFilteringSet [acutecomb];
    pos base a <anchor 250 900> mark @TOP;
} MARK_TO_BASE_FILTERED;

lookup MARK_TO_LIGATURE_ATTACHMENT_TYPE {
    lookupflag MarkAttachmentType [acutecomb];
    pos ligature f_i <anchor 150 900> mark @TOP
        ligComponent <anchor 420 900> mark @TOP;
} MARK_TO_LIGATURE_ATTACHMENT_TYPE;

lookup MARK_TO_MARK_IGNORE_LIGATURES {
    lookupflag IgnoreLigatures;
    pos mark acutecomb <anchor 0 750> mark @TOP;
} MARK_TO_MARK_IGNORE_LIGATURES;

lookup MARK_TO_MARK_BASE_GLYPH {
    pos mark a <anchor 250 900> mark @TOP;
} MARK_TO_MARK_BASE_GLYPH;

feature mark {
    lookup MARK_TO_BASE;
    lookup MARK_TO_LIGATURE;
} mark;

feature mkmk {
    lookup MARK_TO_MARK;
} mkmk;

feature ss02 {
    lookup MARK_TO_MARK_FILTERED;
} ss02;

feature ss04 {
    lookup MARK_TO_BASE_IGNORE_LIGATURES;
} ss04;

feature ss03 {
    lookup CURSIVE_REVERSED;
} ss03;

feature curs {
    lookup CURSIVE_LEFT_TO_RIGHT;
    lookup CURSIVE_RIGHT_TO_LEFT;
} curs;

feature kern {
    lookup KERN_A_B;
} kern;

feature ss01 {
    lookup SINGLE_DOTBELOW;
} ss01;

feature ss05 {
    lookup CURSIVE_X_Y;
} ss05;

feature ss06 {
    lookup MARK_TO_MARK_IGNORE_BASES;
} ss06;

feature ss07 {
    lookup CURSIVE_VARIABLE;
} ss07;

feature ss08 {
    lookup MARK_TO_MARK_ATTACHMENT_TYPE;
} ss08;

feature ss09 {
    lookup SINGLE_BEH;
} ss09;

feature ss13 {
    lookup MARK_TO_BASE_ATTACHMENT_TYPE;
} ss13;

feature ss14 {
    lookup MARK_TO_BASE_FILTERED;
} ss14;

feature ss15 {
    lookup MARK_TO_LIGATURE_ATTACHMENT_TYPE;
} ss15;

feature ss18 {
    lookup MARK_TO_MARK_IGNORE_LIGATURES;
} ss18;

feature ss19 {
    lookup MARK_TO_MARK_BASE_GLYPH;
} ss19;
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
    addOpenTypeFeaturesFromString(builder.font, FEATURES, tables=["GSUB", "GPOS", "GDEF"])
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path):
    font = TTFont(output_path)
    position_table = font["GPOS"].table
    lookups = position_table.LookupList.Lookup
    lookup_types = [lookup.LookupType for lookup in lookups]
    assert lookup_types == [4, 5, 6, 6, 4, 3, 3, 1, 3, 2, 1, 3, 6, 3, 6, 4, 4, 5, 6, 6], lookup_types
    lookup_flags = [lookup.LookupFlag for lookup in lookups]
    # UseMarkFilteringSet, IgnoreLigatures, RightToLeft, RightToLeft and IgnoreMarks, IgnoreMarks, IgnoreBaseGlyphs,
    # MarkAttachmentType 1 (acutecomb), UseMarkFilteringSet, MarkAttachmentType 1, IgnoreLigatures
    assert lookup_flags == [
        0, 0, 0, 0x0010, 0x0004, 0x0001, 0, 0, 0x0009, 0x0008, 0, 0, 0x0002, 0, 0x0100, 0x0100, 0x0010, 0x0100, 0x0004, 0
    ], lookup_flags
    # the mark2 glyph of MARK_TO_MARK_BASE_GLYPH, a base glyph of GDEF
    assert lookups[19].SubTable[0].Mark2Coverage.glyphs == ["a"], lookups[19].SubTable[0].Mark2Coverage.glyphs
    definitions = font["GDEF"].table
    assert definitions.MarkAttachClassDef.classDefs == {"acutecomb": 1}, definitions.MarkAttachClassDef.classDefs
    assert [mark_set.glyphs for mark_set in definitions.MarkGlyphSetsDef.Coverage] == [["acutecomb"]]
    base_anchors = lookups[0].SubTable[0].BaseArray.BaseRecord
    anchor_formats = [[anchor.Format if anchor else None for anchor in record.BaseAnchor] for record in base_anchors]
    # a, b, i, beh and ocyr in coverage order, the variable anchor of b of format 3, the contour point of i of format 2
    base_glyphs = lookups[0].SubTable[0].BaseCoverage.glyphs
    assert base_glyphs == ["a", "b", "i", "beh", "ocyr"], base_glyphs
    assert anchor_formats == [[1, 1, None], [3, None, None], [2, None, None], [None, None, 1], [None, 1, None]], anchor_formats
    assert base_anchors[1].BaseAnchor[0].XDeviceTable.DeltaFormat == 0x8000
    z_entry = lookups[6].SubTable[0].EntryExitRecord[2].EntryAnchor
    assert z_entry.Format == 3 and z_entry.XDeviceTable.DeltaFormat == 1, z_entry.Format
    ligature_attach = lookups[1].SubTable[0].LigatureArray.LigatureAttach
    # f_i and a_f_i in coverage order
    assert [len(attach.ComponentRecord) for attach in ligature_attach] == [2, 3], ligature_attach
    y_entry = lookups[13].SubTable[0].EntryExitRecord[1].EntryAnchor
    assert y_entry.Format == 3 and y_entry.XDeviceTable.DeltaFormat == 0x8000, y_entry.Format
    features = [(record.FeatureTag, record.Feature.LookupListIndex) for record in position_table.FeatureList.FeatureRecord]
    assert features == [
        ("curs", [6, 8]), ("kern", [9]), ("mark", [0, 1]), ("mkmk", [2]), ("ss01", [10]), ("ss02", [3]), ("ss03", [5]),
        ("ss04", [4]), ("ss05", [11]), ("ss06", [12]), ("ss07", [13]), ("ss08", [14]), ("ss09", [7]), ("ss13", [15]),
        ("ss14", [16]), ("ss15", [17]), ("ss18", [18]), ("ss19", [19])
    ], features
    substitution_table = font["GSUB"].table
    substitution_types = [lookup.LookupType for lookup in substitution_table.LookupList.Lookup]
    # LIGA_F_I, LIGA_A_F_I, MULTIPLE_Z, CONTEXTUAL_LIGA_F_I, MULTIPLE_Z_MARKS, LIGA_F_I_A, LIGA_MARKS
    assert substitution_types == [4, 4, 2, 5, 2, 4, 4], substitution_types
    substitution_features = [
        (record.FeatureTag, record.Feature.LookupListIndex) for record in substitution_table.FeatureList.FeatureRecord
    ]
    assert substitution_features == [
        ("liga", [0]), ("ss10", [2]), ("ss11", [3]), ("ss12", [1]), ("ss16", [5]), ("ss17", [6]), ("ss20", [4])
    ], substitution_features
    print(f"{output_path}: GPOS mark-to-base, mark-to-ligature, mark-to-mark and cursive attachments, anchors of formats "
          "1, 2 and 3 (VariationIndex and Device tables), lookup flags, GSUB ligatures and multiple substitution, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a variable TrueType test font for the GPOS mark and cursive attachments.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
