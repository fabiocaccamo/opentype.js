"""Build a synthetic TrueType test font for the GPOS contextual positionings (lookup types 7 and 8) of Font.shape.

Glyphs of 500 units but space (250), A, T and V (600), acutecomb and gravecomb (0, GDEF marks) and f_i (a GDEF
ligature of f and i, 600, with an anchor by component). Language systems DFLT, latn and hebr, with the same features.
GSUB liga (IgnoreMarks): sub f i by f_i.

GPOS lookups, in the order of the lookup list, the nested ones (the lookups of no feature) before the contextual
lookups that use them:
- 0 TIGHTEN: pos [A T V a b c d e o x alef bet] <0 0 -40 0>;
- 1 WIDEN: pos [A T V a b c d e o x] <10 0 25 0>;
- 2 SHIFT_UP: pos [A T V a b c d e o x] <0 30 0 0>;
- 3 PAIR_IGNORE_MARKS (IgnoreMarks): pos T o -60; pos A V -80;
- 4 KERN_PAIRS: pos T o -70;
- 5 MARK_TO_BASE: pos base [a e o] <anchor 250 520> mark @TOP_MARKS;
- 6 MARK_TO_LIGATURE: pos ligature f_i <anchor 150 750> ligComponent <anchor 450 750> mark @TOP_MARKS;
- 7 PLUS_ONE: pos d <0 0 1 0>;
- 8 INNER_CONTEXT: pos c' lookup TIGHTEN e; (type 8 format 1), the nested contextual lookup of OUTER_CONTEXT;
then the contextual lookups of the features:
- 9 CONTEXT_GLYPHS (ss01): pos a' lookup TIGHTEN b' lookup WIDEN; pos a' lookup SHIFT_UP c'; pos a' lookup WIDEN b' c';
  glyph rules (type 7 format 1), the first rule that matches wins;
- 10 CONTEXT_CLASSES (ss02): pos [a b]' lookup TIGHTEN [c d]'; pos [c d]' [a b]' lookup SHIFT_UP;
  pos [e o]' lookup WIDEN [e o]' lookup WIDEN; class rules (type 7 format 2, merged from the format 3 subtables that
  feaLib builds, smaller);
- 11 CONTEXT_COVERAGES (ss03): pos [A T]' lookup WIDEN [V o]' lookup TIGHTEN; a coverage rule (type 7 format 3);
- 12 CHAIN_GLYPHS (ss04): pos T a' lookup TIGHTEN b' x; pos a' lookup SHIFT_UP x; glyph rules (type 8 format 1);
- 13 CHAIN_CLASSES (ss05): pos [T V] [a o]' lookup TIGHTEN [b d]; pos [a o]' lookup SHIFT_UP [c e]; class rules (type 8
  format 2, merged like CONTEXT_CLASSES);
- 14 CHAIN_COVERAGES (ss06): pos [A T] [a o]' lookup WIDEN [b c]' [e x]; a coverage rule (type 8 format 3);
- 15 CONTEXT_IGNORE_MARKS (ss07, IgnoreMarks): pos T o' lookup TIGHTEN x; matched across the marks;
- 16 CONTEXT_WITH_MARKS (ss08): pos T o' lookup TIGHTEN x; the same rule, not matched across the marks;
- 17 NESTED_PAIR (ss09): pos T' lookup PAIR_IGNORE_MARKS; pos A' lookup PAIR_IGNORE_MARKS; a nested pair adjustment at
  the only input glyph, with the next glyph its own lookupFlag does not skip, past the input and across the marks;
- 18 OUTER_CONTEXT (ss10): pos b c' lookup INNER_CONTEXT; a nested contextual lookup;
- 19 SELF_RECURSIVE (ss11): pos d' lookup PLUS_ONE; then a second lookup record of the rule, at the same glyph, to
  SELF_RECURSIVE itself (added after feaLib): the recursion stops at the nesting limit of HarfBuzz;
- 20 CONTEXT_MARKS (ss12): pos e acutecomb' lookup MARK_TO_BASE; pos f_i acutecomb' lookup MARK_TO_LIGATURE;
  pos acutecomb acutecomb' lookup MARK_TO_LIGATURE; nested mark attachments, the second acute of f acute i acute on
  the second component of the ligature;
- 21 CHAIN_HEBREW (ss13): pos alef bet' lookup TIGHTEN; a backtrack in the order of the text of a right-to-left run;
- 22 CONTEXTUAL_KERN (kern): ignore pos T' o' x; pos T' lookup KERN_PAIRS o; a contextual kerning with an exception (a
  rule without lookup records that matches first);
- 23 SHIFT_MARK_IGNORE_MARKS (IgnoreMarks): pos acutecomb <0 40 0 0>; a nested lookup that ignores the glyph it
  applies at;
- 24 CONTEXT_IGNORED_GLYPH (ss14): pos a acutecomb' lookup SHIFT_MARK_IGNORE_MARKS; applied at the acute all the same;
- 25 SELF_RECURSIVE_TWICE (ss15): pos d' lookup PLUS_ONE; then two more lookup records of the rule, at the same glyph,
  to SELF_RECURSIVE_TWICE itself (added after feaLib): the recursion stops at the operation budget of HarfBuzz (max_ops);
- 26 PAIR_SECOND_SUBTABLE: pos T o -10; subtable; pos [T V] [o a] -40; a glyph pair subtable then a class pair one;
- 27 NESTED_PAIR_SUBTABLES (ss16): pos [T V]' lookup PAIR_SECOND_SUBTABLE [o a]; the first subtable of the nested lookup
  that applies;
- 28 CONTEXT_EXCEPTION_SUBTABLES (ss17): ignore pos [T V]' [o a]' x; pos [T V]' lookup KERN_PAIRS [o a]; class rules,
  one format 3 subtable by rule: the exception in the first subtable stops the second one;
- 29 TYPE7_IGNORE_MARKS (ss18, IgnoreMarks): pos [T V]' lookup TIGHTEN [o a]'; a type 7 input across the marks;
- 30 CONTEXT_MARK_FILTERING_SET (ss19, UseMarkFilteringSet [gravecomb]) and 31 CONTEXT_MARK_ATTACHMENT_TYPE (ss20,
  MarkAttachmentType [gravecomb]): pos T o' lookup TIGHTEN x; matched across the acute, not across the grave;
- 32 MARK_TO_MARK: pos mark acutecomb <anchor -100 700> mark @GRAVE_MARKS;
- 33 CONTEXT_MARK_TO_MARK (cv01): pos acutecomb gravecomb' lookup MARK_TO_MARK; a nested mark-to-mark attachment;
- 34 CURSIVE: pos cursive x <anchor 50 0> <anchor 450 100>; 35 CURSIVE_RIGHT_TO_LEFT: the same with RightToLeft;
- 36 CONTEXT_CURSIVE (cv02) and 37 CONTEXT_CURSIVE_RIGHT_TO_LEFT (cv03): pos x x' lookup CURSIVE (or
  CURSIVE_RIGHT_TO_LEFT); nested cursive attachments, with the RightToLeft flag of the nested lookup;
- 38 PAIR_BOTH_GLYPHS: pos T <0 0 -20 0> o <0 0 -10 0>; a pair with a second value record;
- 39 NESTED_PAIR_SECOND_GLYPH (cv04): pos T' lookup PAIR_BOTH_GLYPHS; pos o' lookup TIGHTEN; the lookup goes on after
  the input of the rule, at the second glyph of the nested pair;
- 40 MARK_ADVANCE: pos acutecomb <0 0 10 0>;
- 41 CONTEXT_MARK_ADVANCE (cv05): pos a acutecomb' lookup MARK_ADVANCE; an advance given to a mark, which the shaper
  sets to 0;
- 42 MARK_TO_BASE_IGNORE_MARKS (IgnoreMarks) and 43 MARK_TO_LIGATURE_ATTACHMENT_TYPE (MarkAttachmentType [gravecomb]):
  MARK_TO_BASE and MARK_TO_LIGATURE with a lookupFlag that ignores the acute;
- 44 CONTEXT_FLAGGED_MARKS (cv06): pos e acutecomb' lookup MARK_TO_BASE_IGNORE_MARKS; pos f_i acutecomb' lookup
  MARK_TO_LIGATURE_ATTACHMENT_TYPE; nested mark attachments at a mark that their lookupFlag ignores.

usage: generate-contextual-positioning-font.py <output.ttf>
"""
import argparse
from types import SimpleNamespace

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.otlLib.builder import ChainContextPosBuilder, ChainContextualRule, ChainContextualRuleset
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Contextual Positioning"

# glyph name, codepoint, advance width, contours (lists of points)
GLYPHS = [
    (".notdef", None, 500, [[(100, 0), (100, 700), (400, 700), (400, 0)]]),
    ("space", 0x0020, 250, []),
    ("A", 0x0041, 600, [[(20, 0), (300, 700), (580, 0)]]),
    ("T", 0x0054, 600, [[(250, 0), (250, 600), (20, 600), (20, 700), (580, 700), (580, 600), (350, 600), (350, 0)]]),
    ("V", 0x0056, 600, [[(20, 700), (580, 700), (300, 0)]]),
    ("a", 0x0061, 500, [[(50, 0), (50, 500), (450, 500), (450, 0)]]),
    ("b", 0x0062, 500, [[(50, 0), (50, 700), (450, 700), (450, 0)]]),
    ("c", 0x0063, 500, [[(50, 0), (50, 500), (450, 500), (450, 400), (150, 400), (150, 100), (450, 100), (450, 0)]]),
    ("d", 0x0064, 500, [[(50, 0), (50, 500), (350, 500), (350, 700), (450, 700), (450, 0)]]),
    ("e", 0x0065, 500, [[(50, 0), (50, 500), (450, 500), (450, 300), (150, 300), (150, 100), (450, 100), (450, 0)]]),
    ("f", 0x0066, 500, [[(150, 0), (150, 700), (450, 700), (450, 600), (250, 600), (250, 0)]]),
    ("i", 0x0069, 500, [[(200, 0), (200, 500), (300, 500), (300, 0)]]),
    ("o", 0x006F, 500, [[(50, 0), (50, 500), (450, 500), (450, 0)]]),
    ("x", 0x0078, 500, [[(50, 0), (250, 250), (50, 500), (450, 500), (250, 250), (450, 0)]]),
    ("acutecomb", 0x0301, 0, [[(-150, 550), (-100, 700), (-50, 700), (-100, 550)]]),
    ("alef", 0x05D0, 500, [[(50, 0), (450, 700), (450, 600), (150, 0)]]),
    ("bet", 0x05D1, 500, [[(50, 0), (50, 100), (350, 100), (350, 600), (50, 600), (50, 700), (450, 700), (450, 0)]]),
    ("f_i", None, 600, [[(100, 0), (100, 700), (400, 700), (400, 600), (200, 600), (200, 0)],
                        [(450, 0), (450, 500), (550, 500), (550, 0)]]),
    ("gravecomb", 0x0300, 0, [[(-150, 700), (-100, 700), (-50, 550), (-100, 550)]]),
]

FEATURES = """
languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem hebr dflt;

table GDEF {
    GlyphClassDef [A T V a b c d e f i o x alef bet], [f_i], [acutecomb gravecomb], ;
} GDEF;

feature liga {
    lookupflag IgnoreMarks;
    sub f i by f_i;
} liga;

@ADJUSTED = [A T V a b c d e o x];

lookup TIGHTEN {
    pos [@ADJUSTED alef bet] <0 0 -40 0>;
} TIGHTEN;

lookup WIDEN {
    pos @ADJUSTED <10 0 25 0>;
} WIDEN;

lookup SHIFT_UP {
    pos @ADJUSTED <0 30 0 0>;
} SHIFT_UP;

lookup PAIR_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    pos T o -60;
    pos A V -80;
} PAIR_IGNORE_MARKS;

lookup KERN_PAIRS {
    pos T o -70;
} KERN_PAIRS;

markClass acutecomb <anchor -100 500> @TOP_MARKS;

lookup MARK_TO_BASE {
    pos base [a e o] <anchor 250 520> mark @TOP_MARKS;
} MARK_TO_BASE;

lookup MARK_TO_LIGATURE {
    pos ligature f_i <anchor 150 750> mark @TOP_MARKS ligComponent <anchor 450 750> mark @TOP_MARKS;
} MARK_TO_LIGATURE;

lookup PLUS_ONE {
    pos d <0 0 1 0>;
} PLUS_ONE;

lookup INNER_CONTEXT {
    pos c' lookup TIGHTEN e;
} INNER_CONTEXT;

lookup CONTEXT_GLYPHS {
    pos a' lookup TIGHTEN b' lookup WIDEN;
    pos a' lookup SHIFT_UP c';
    pos a' lookup WIDEN b' c';
} CONTEXT_GLYPHS;

lookup CONTEXT_CLASSES {
    pos [a b]' lookup TIGHTEN [c d]';
    pos [c d]' [a b]' lookup SHIFT_UP;
    pos [e o]' lookup WIDEN [e o]' lookup WIDEN;
} CONTEXT_CLASSES;

lookup CONTEXT_COVERAGES {
    pos [A T]' lookup WIDEN [V o]' lookup TIGHTEN;
} CONTEXT_COVERAGES;

lookup CHAIN_GLYPHS {
    pos T a' lookup TIGHTEN b' x;
    pos a' lookup SHIFT_UP x;
} CHAIN_GLYPHS;

lookup CHAIN_CLASSES {
    pos [T V] [a o]' lookup TIGHTEN [b d];
    pos [a o]' lookup SHIFT_UP [c e];
} CHAIN_CLASSES;

lookup CHAIN_COVERAGES {
    pos [A T] [a o]' lookup WIDEN [b c]' [e x];
} CHAIN_COVERAGES;

lookup CONTEXT_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    pos T o' lookup TIGHTEN x;
} CONTEXT_IGNORE_MARKS;

lookup CONTEXT_WITH_MARKS {
    pos T o' lookup TIGHTEN x;
} CONTEXT_WITH_MARKS;

lookup NESTED_PAIR {
    pos T' lookup PAIR_IGNORE_MARKS;
    pos A' lookup PAIR_IGNORE_MARKS;
} NESTED_PAIR;

lookup OUTER_CONTEXT {
    pos b c' lookup INNER_CONTEXT;
} OUTER_CONTEXT;

lookup SELF_RECURSIVE {
    pos d' lookup PLUS_ONE;
} SELF_RECURSIVE;

lookup CONTEXT_MARKS {
    pos e acutecomb' lookup MARK_TO_BASE;
    pos f_i acutecomb' lookup MARK_TO_LIGATURE;
    pos acutecomb acutecomb' lookup MARK_TO_LIGATURE;
} CONTEXT_MARKS;

lookup CHAIN_HEBREW {
    pos alef bet' lookup TIGHTEN;
} CHAIN_HEBREW;

lookup CONTEXTUAL_KERN {
    ignore pos T' o' x;
    pos T' lookup KERN_PAIRS o;
} CONTEXTUAL_KERN;

feature ss01 {
    lookup CONTEXT_GLYPHS;
} ss01;

feature ss02 {
    lookup CONTEXT_CLASSES;
} ss02;

feature ss03 {
    lookup CONTEXT_COVERAGES;
} ss03;

feature ss04 {
    lookup CHAIN_GLYPHS;
} ss04;

feature ss05 {
    lookup CHAIN_CLASSES;
} ss05;

feature ss06 {
    lookup CHAIN_COVERAGES;
} ss06;

feature ss07 {
    lookup CONTEXT_IGNORE_MARKS;
} ss07;

feature ss08 {
    lookup CONTEXT_WITH_MARKS;
} ss08;

feature ss09 {
    lookup NESTED_PAIR;
} ss09;

feature ss10 {
    lookup OUTER_CONTEXT;
} ss10;

feature ss11 {
    lookup SELF_RECURSIVE;
} ss11;

feature ss12 {
    lookup CONTEXT_MARKS;
} ss12;

feature ss13 {
    lookup CHAIN_HEBREW;
} ss13;

feature kern {
    lookup CONTEXTUAL_KERN;
} kern;

lookup SHIFT_MARK_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    pos acutecomb <0 40 0 0>;
} SHIFT_MARK_IGNORE_MARKS;

lookup CONTEXT_IGNORED_GLYPH {
    pos a acutecomb' lookup SHIFT_MARK_IGNORE_MARKS;
} CONTEXT_IGNORED_GLYPH;

feature ss14 {
    lookup CONTEXT_IGNORED_GLYPH;
} ss14;

lookup SELF_RECURSIVE_TWICE {
    pos d' lookup PLUS_ONE;
} SELF_RECURSIVE_TWICE;

lookup PAIR_SECOND_SUBTABLE {
    pos T o -10;
    subtable;
    pos [T V] [o a] -40;
} PAIR_SECOND_SUBTABLE;

lookup NESTED_PAIR_SUBTABLES {
    pos [T V]' lookup PAIR_SECOND_SUBTABLE [o a];
} NESTED_PAIR_SUBTABLES;

lookup CONTEXT_EXCEPTION_SUBTABLES {
    ignore pos [T V]' [o a]' x;
    pos [T V]' lookup KERN_PAIRS [o a];
} CONTEXT_EXCEPTION_SUBTABLES;

lookup TYPE7_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    pos [T V]' lookup TIGHTEN [o a]';
} TYPE7_IGNORE_MARKS;

@GRAVE = [gravecomb];

lookup CONTEXT_MARK_FILTERING_SET {
    lookupflag UseMarkFilteringSet @GRAVE;
    pos T o' lookup TIGHTEN x;
} CONTEXT_MARK_FILTERING_SET;

lookup CONTEXT_MARK_ATTACHMENT_TYPE {
    lookupflag MarkAttachmentType @GRAVE;
    pos T o' lookup TIGHTEN x;
} CONTEXT_MARK_ATTACHMENT_TYPE;

markClass gravecomb <anchor -100 500> @GRAVE_MARKS;

lookup MARK_TO_MARK {
    pos mark acutecomb <anchor -100 700> mark @GRAVE_MARKS;
} MARK_TO_MARK;

lookup CONTEXT_MARK_TO_MARK {
    pos acutecomb gravecomb' lookup MARK_TO_MARK;
} CONTEXT_MARK_TO_MARK;

lookup CURSIVE {
    pos cursive x <anchor 50 0> <anchor 450 100>;
} CURSIVE;

lookup CURSIVE_RIGHT_TO_LEFT {
    lookupflag RightToLeft;
    pos cursive x <anchor 50 0> <anchor 450 100>;
} CURSIVE_RIGHT_TO_LEFT;

lookup CONTEXT_CURSIVE {
    pos x x' lookup CURSIVE;
} CONTEXT_CURSIVE;

lookup CONTEXT_CURSIVE_RIGHT_TO_LEFT {
    pos x x' lookup CURSIVE_RIGHT_TO_LEFT;
} CONTEXT_CURSIVE_RIGHT_TO_LEFT;

lookup PAIR_BOTH_GLYPHS {
    pos T <0 0 -20 0> o <0 0 -10 0>;
} PAIR_BOTH_GLYPHS;

lookup NESTED_PAIR_SECOND_GLYPH {
    pos T' lookup PAIR_BOTH_GLYPHS;
    pos o' lookup TIGHTEN;
} NESTED_PAIR_SECOND_GLYPH;

lookup MARK_ADVANCE {
    pos acutecomb <0 0 10 0>;
} MARK_ADVANCE;

lookup CONTEXT_MARK_ADVANCE {
    pos a acutecomb' lookup MARK_ADVANCE;
} CONTEXT_MARK_ADVANCE;

lookup MARK_TO_BASE_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    pos base [a e o] <anchor 250 520> mark @TOP_MARKS;
} MARK_TO_BASE_IGNORE_MARKS;

lookup MARK_TO_LIGATURE_ATTACHMENT_TYPE {
    lookupflag MarkAttachmentType @GRAVE;
    pos ligature f_i <anchor 150 750> mark @TOP_MARKS ligComponent <anchor 450 750> mark @TOP_MARKS;
} MARK_TO_LIGATURE_ATTACHMENT_TYPE;

lookup CONTEXT_FLAGGED_MARKS {
    pos e acutecomb' lookup MARK_TO_BASE_IGNORE_MARKS;
    pos f_i acutecomb' lookup MARK_TO_LIGATURE_ATTACHMENT_TYPE;
} CONTEXT_FLAGGED_MARKS;

feature ss15 {
    lookup SELF_RECURSIVE_TWICE;
} ss15;

feature ss16 {
    lookup NESTED_PAIR_SUBTABLES;
} ss16;

feature ss17 {
    lookup CONTEXT_EXCEPTION_SUBTABLES;
} ss17;

feature ss18 {
    lookup TYPE7_IGNORE_MARKS;
} ss18;

feature ss19 {
    lookup CONTEXT_MARK_FILTERING_SET;
} ss19;

feature ss20 {
    lookup CONTEXT_MARK_ATTACHMENT_TYPE;
} ss20;

feature cv01 {
    lookup CONTEXT_MARK_TO_MARK;
} cv01;

feature cv02 {
    lookup CONTEXT_CURSIVE;
} cv02;

feature cv03 {
    lookup CONTEXT_CURSIVE_RIGHT_TO_LEFT;
} cv03;

feature cv04 {
    lookup NESTED_PAIR_SECOND_GLYPH;
} cv04;

feature cv05 {
    lookup CONTEXT_MARK_ADVANCE;
} cv05;

feature cv06 {
    lookup CONTEXT_FLAGGED_MARKS;
} cv06;
"""

CONTEXT_CLASSES_LOOKUP_INDEX = 10
CHAIN_CLASSES_LOOKUP_INDEX = 13
SELF_RECURSIVE_LOOKUP_INDEX = 19
SELF_RECURSIVE_TWICE_LOOKUP_INDEX = 25


def draw_glyph(contours):
    pen = TTGlyphPen(None)
    for contour in contours:
        pen.moveTo(contour[0])
        for point in contour[1:]:
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def get_rule_lookup_records(subtable):
    """The lookup records of the only rule of a contextual positioning subtable (type 7, format 1 or 3)."""
    if subtable.Format == 1:
        return subtable.PosRuleSet[0].PosRule[0].PosLookupRecord
    return subtable.PosLookupRecord


def add_self_recursive_lookup_records(font, lookup_index, record_count):
    """Add to the rule of a contextual lookup lookup records at its glyph, to the lookup itself, which feaLib cannot
    build (a lookup is referenced after its definition)."""
    subtable = font["GPOS"].table.LookupList.Lookup[lookup_index].SubTable[0]
    lookup_records = get_rule_lookup_records(subtable)
    for _ in range(record_count):
        lookup_record = otTables.PosLookupRecord()
        lookup_record.SequenceIndex = 0
        lookup_record.LookupListIndex = lookup_index
        lookup_records.append(lookup_record)
    if subtable.Format == 1:
        subtable.PosRuleSet[0].PosRule[0].PosCount = len(lookup_records)
    else:
        subtable.PosCount = len(lookup_records)


def get_coverage_rule(subtable, chaining):
    """The rule of a contextual positioning subtable of format 3, as the rules of otlLib: its backtrack in the order of
    the text, and the lookups of each input glyph (None for none)."""
    if chaining:
        prefix = [coverage.glyphs for coverage in reversed(subtable.BacktrackCoverage)]
        glyphs = [coverage.glyphs for coverage in subtable.InputCoverage]
        suffix = [coverage.glyphs for coverage in subtable.LookAheadCoverage]
    else:
        prefix, glyphs, suffix = [], [coverage.glyphs for coverage in subtable.Coverage], []
    lookups = [[] for _ in glyphs]
    for lookup_record in subtable.PosLookupRecord:
        lookups[lookup_record.SequenceIndex].append(SimpleNamespace(lookup_index=lookup_record.LookupListIndex))
    return ChainContextualRule(prefix, glyphs, suffix, [lookup_list or None for lookup_list in lookups])


def merge_into_class_subtable(font, lookup_index):
    """Merge the format 3 subtables of a contextual positioning lookup, one by rule as feaLib builds them when they are
    smaller, into one format 2 subtable of the same rules, built by otlLib."""
    lookup = font["GPOS"].table.LookupList.Lookup[lookup_index]
    chaining = lookup.LookupType == 8
    ruleset = ChainContextualRuleset()
    for subtable in lookup.SubTable:
        ruleset.addRule(get_coverage_rule(subtable, chaining))
    position_builder = ChainContextPosBuilder(font, None)
    lookup.SubTable = [position_builder.buildFormat2Subtable(ruleset, ruleset.format2ClassDefs(), chaining)]
    lookup.SubTableCount = 1


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
    # the contextual lookups without backtrack and lookahead as lookup type 7, which feaLib writes as type 8 by default
    builder.font.cfg["fontTools.otlLib.builder:WRITE_GPOS7"] = True
    addOpenTypeFeaturesFromString(builder.font, FEATURES, tables=["GSUB", "GPOS", "GDEF"])
    merge_into_class_subtable(builder.font, CONTEXT_CLASSES_LOOKUP_INDEX)
    merge_into_class_subtable(builder.font, CHAIN_CLASSES_LOOKUP_INDEX)
    add_self_recursive_lookup_records(builder.font, SELF_RECURSIVE_LOOKUP_INDEX, 1)
    add_self_recursive_lookup_records(builder.font, SELF_RECURSIVE_TWICE_LOOKUP_INDEX, 2)
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
    assert lookup_types == [
        1, 1, 1, 2, 2, 4, 5, 1, 8, 7, 7, 7, 8, 8, 8, 8, 8, 7, 8, 7, 8, 8, 8, 1, 8,
        7, 2, 8, 8, 7, 8, 8, 6, 8, 3, 3, 8, 8, 2, 7, 1, 8, 4, 5, 8
    ], lookup_types
    lookup_flags = [lookup.LookupFlag for lookup in lookups]
    # IgnoreMarks 0x0008, UseMarkFilteringSet 0x0010, MarkAttachmentType 1 0x0100, RightToLeft 0x0001
    assert lookup_flags == [
        0, 0, 0, 0x0008, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x0008, 0, 0, 0, 0, 0, 0, 0, 0x0008, 0,
        0, 0, 0, 0, 0x0008, 0x0010, 0x0100, 0, 0, 0, 0x0001, 0, 0, 0, 0, 0, 0, 0x0008, 0x0100, 0
    ], lookup_flags
    formats = [[subtable.Format for subtable in lookup.SubTable] for lookup in lookups]
    # the formats of the contextual lookups of ss01 to ss06: 1, 2 and 3 of each type
    assert formats[9:15] == [[1], [2], [3], [1], [2], [3]], formats[9:15]
    # PAIR_SECOND_SUBTABLE: a glyph pair subtable then a class pair subtable; CONTEXT_EXCEPTION_SUBTABLES: one subtable
    # by rule, the exception first; TYPE7_IGNORE_MARKS: type 7, format 3
    assert formats[26:30] == [[1, 2], [3], [3, 3], [3]], formats[26:30]
    for lookup_index, recursive_lookups in [
        (SELF_RECURSIVE_LOOKUP_INDEX, [7, SELF_RECURSIVE_LOOKUP_INDEX]),
        (SELF_RECURSIVE_TWICE_LOOKUP_INDEX, [7, SELF_RECURSIVE_TWICE_LOOKUP_INDEX, SELF_RECURSIVE_TWICE_LOOKUP_INDEX]),
    ]:
        lookup_records = get_rule_lookup_records(lookups[lookup_index].SubTable[0])
        record_lookups = [record.LookupListIndex for record in lookup_records]
        assert record_lookups == recursive_lookups, record_lookups
    feature_records = position_table.FeatureList.FeatureRecord
    features = [(record.FeatureTag, record.Feature.LookupListIndex) for record in feature_records]
    assert features == [
        ("cv01", [33]), ("cv02", [36]), ("cv03", [37]), ("cv04", [39]), ("cv05", [41]), ("cv06", [44]),
        ("kern", [22]), ("ss01", [9]), ("ss02", [10]), ("ss03", [11]), ("ss04", [12]), ("ss05", [13]), ("ss06", [14]),
        ("ss07", [15]), ("ss08", [16]), ("ss09", [17]), ("ss10", [18]), ("ss11", [19]), ("ss12", [20]), ("ss13", [21]),
        ("ss14", [24]), ("ss15", [25]), ("ss16", [27]), ("ss17", [28]), ("ss18", [29]), ("ss19", [30]), ("ss20", [31])
    ], features
    print(f"{output_path}: GPOS contextual positionings of types 7 and 8 in formats 1, 2 and 3, nested lookups of the "
          "types 1 to 8, self recursive lookups, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a TrueType test font for the GPOS contextual positionings.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
