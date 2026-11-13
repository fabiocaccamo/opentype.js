"""Build the reference fonts of the lookupFlag unit tests, whose glyphs and GDEF table are the ones of
test/lookup-flags-font.mjs: the hb-shape outputs the tests quote come from these fonts.

LookupFlags.ttf has the GSUB lookups of the tests, each one in the feature that hb-shape enables to run it,
and their kern feature. The tests build the same lookups as synthetic tables, in the feature the fork
applies them with (e.g. calt for the latin features, rlig for the arabic required ligatures):

    hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+ss01 LookupFlags.ttf -u 0061,0301,0062

LookupFlags.ttf is also in test/fonts, for the end-to-end tests of test/font.spec.mjs, which check that the
synthetic tables of test/lookup-flags-font.mjs keep the glyphs and the GDEF table of the font.

The variants of LookupFlags.ttf:
- LookupFlagsKernTable.ttf: without the GPOS table, with a kern table (format 0) of the pairs a acute -15,
  a b -60, acute b -40 and A V -100;
- LookupFlagsKernTableNoGDEF.ttf: LookupFlagsKernTable.ttf without the GDEF table;
- LookupFlagsNoGDEF.ttf: without the GDEF table;
- LookupFlagsExtension.ttf: the lookups LOOKAHEAD_IGNORE_MARKS (ss03), KERN_IGNORE_MARKS (kern), and
  NESTED_LIGATURE_SKIPPED_MARK (ss37) with its nested ligature LIGATURE_AT_MULTIPLE_IGNORE_MARKS in extension
  lookups (useExtension);
- LookupFlagsEmptyContextInput.ttf: the ContextSubst format 3 of ss01 (INPUT_IGNORE_MARKS) with a
  GlyphCount of 0;
- LookupFlagsEmptyChainInput.ttf: the ChainContextSubst format 3 of ss02 (BACKTRACK_IGNORE_MARKS) with an
  InputGlyphCount of 0;
- LookupFlagsCcmpLigature.ttf: the lookups of rlig (RLIG_IGNORE_MARKS, RLIG_AFTER_LIGATURE_IGNORE_MARKS) in ccmp, after
  MULTIPLE_DAL, and no rlig feature;
- LookupFlagsCcmpBeforeRlig.ttf: the ligature of two marks LIGATURE_FATHAS (sub fatha fatha by fatha;) in ccmp, after
  MULTIPLE_DAL, before the IgnoreMarks ligature of rlig (RLIG_IGNORE_MARKS);
- LookupFlagsOneComponentLigature.ttf: the ligature of ss10 with the component a only (a CompCount of 1), by a.alt;
- LookupFlagsNestedSequenceIndex.ttf: the second lookup record of ss23 (NESTED_MULTIPLE_THEN_SINGLE) at the sequence index 2;
- LookupFlagsNestedSequenceIndexPastEnd.ttf: the second lookup record of ss23 at the sequence index 3, past the end of the
  input after the nested multiple substitution;
- LookupFlagsNestedSequenceIndexPastEndThenValid.ttf: LookupFlagsNestedSequenceIndexPastEnd.ttf with a third lookup record of
  ss23, SUB_ACUTE_B at the sequence index 2;
- LookupFlagsNestedLigatureSequenceIndex.ttf: the second lookup record of ss45
  (NESTED_LIGATURE_THREE_COMPONENTS_THEN_SINGLE) at the sequence index 1, the acute after the ligature;
- LookupFlagsNestedLigatureRecordOrder.ttf: the lookup records of ss46 (NESTED_SINGLE_THEN_LIGATURE) in the reverse order,
  the ligature at the sequence index 1 first;
- LookupFlagsNestedMultipleThreeSequenceIndex.ttf: the second lookup record of ss54 (NESTED_MULTIPLE_THREE_GLYPHS_THEN_SINGLE)
  at the sequence index 2, the third glyph of the nested multiple substitution;
- LookupFlagsNestedDeletion.ttf: MULTIPLE_C into no glyph (sub c by NULL;), the second lookup record of ss23 at the sequence
  index 0;
- LookupFlagsNestedDeletionSkippedMark.ttf: MULTIPLE_C into no glyph (sub c by NULL;), the second lookup record of ss24
  (CHAINING_NESTED_MULTIPLE_THEN_SINGLE_IGNORE_MARKS) at the sequence index 0;
- LookupFlagsNestedDeletionLastInput.ttf: the GDEF table of LookupFlags.ttf, in calt sub a' c' lookup DELETE_C lookup
  SUB_ACUTE_B; (sub c by NULL;), the second lookup record at the sequence index of the deleted last input glyph;
- LookupFlagsNestedDeletionNextRecord.ttf: the GDEF table of LookupFlags.ttf, in calt lookupflag IgnoreMarks; sub c' lookup
  DELETE_C b' lookup SUB_ACUTE_B b'; (sub c by NULL;), the second lookup record at the sequence index after the one of the
  deleted glyph;
- LookupFlagsNestedTwoSubtables.ttf: the GDEF table of LookupFlags.ttf, in calt sub c' lookup C_THEN_A b; whose nested lookup
  has the subtables sub c by a; and sub a by a.alt;
- LookupFlagsNotdefBacktrack.ttf: the GDEF table of LookupFlags.ttf, in calt sub .notdef a' by a.alt;, whose backtrack is the
  glyph of a character the font has not;
- LookupFlagsDeletionThenLigature.ttf: the GDEF table of LookupFlags.ttf, in calt sub c by NULL; then lookupflag IgnoreMarks;
  sub a b by a_b;
- LookupFlagsRligAfterMultiple.ttf: the GDEF table of LookupFlags.ttf, and in rlig MULTIPLE_DAL (sub dal by dal.alt fatha;)
  then SUB_FATHA (sub fatha by acute.alt;);
- LookupFlagsArabicForms.ttf: the GDEF table of LookupFlags.ttf, in ccmp the ligature sub lam alef by lam_alef; then the
  multiple substitutions sub lam by lam fatha; sub dal by dal fatha;, in fina sub dal by dal.alt; sub reh by reh.alt;
- LookupFlagsArabicFormsChaining.ttf: the GDEF table of LookupFlags.ttf, in fina the multiple substitutions
  sub reh by reh.alt fatha; sub dal by dal.alt; (a lookup of type 2, the sequence of dal of one glyph), in init
  lookupflag IgnoreMarks; sub [dal.alt reh.alt] lam' by lam.init;
- LookupFlagsArabicFormsNested.ttf: the GDEF table of LookupFlags.ttf, in ccmp sub dal' lookup MULTIPLE_DAL_FATHA; (sub dal by
  dal fatha;), in fina sub dal by dal.alt; sub fatha by acute.alt;
- LookupFlagsCcmpDuplicate.ttf: LookupFlagsArabicForms.ttf with ccmp listing its multiple substitutions (sub lam by lam fatha;
  sub dal by dal fatha;) twice;
- LookupFlagsArabicFormsMultiple.ttf: the GDEF table of LookupFlags.ttf, in fina the lookup of type 2 sub reh by reh.alt fatha;
  sub fatha by acute.alt;, which covers a glyph of its own multiple substitution;
- LookupFlagsArabicJoining.ttf: the GDEF table of LookupFlags.ttf, in init sub lam by lam.init;, in fina sub dal by
  dal.alt;, for the joining of a letter next to a character of no glyph in the font (U+0621, U+0629);
- LookupFlagsMediContext.ttf: the GDEF table of LookupFlags.ttf, in medi sub lam' lookup SUB_LAM lam'; (sub lam by lam.init;);
- LookupFlagsFinaThenMedi.ttf: the GDEF table of LookupFlags.ttf, in medi sub lam' dal.alt by lam.init;, whose lookahead is
  the final form, first in the lookup list, in fina sub dal by dal.alt;
- LookupFlagsMediThenInit.ttf: the GDEF table of LookupFlags.ttf, in init sub lam' reh.alt by lam.init;, whose lookahead is
  the medial form, first in the lookup list, in medi sub lam by reh.alt;
- LookupFlagsIsolThenFina.ttf: the GDEF table of LookupFlags.ttf, in fina sub dal' reh.alt by dal.alt;, whose lookahead is
  the isolated form, first in the lookup list, in isol sub dal by reh.alt;
- LookupFlagsInitLigature.ttf: the GDEF table of LookupFlags.ttf, in init sub lam alef by lam_alef;
- LookupFlagsFinaAcrossSpace.ttf: the GDEF table of LookupFlags.ttf, in fina sub dal' lookup DAL_ALT .notdef lam; (sub dal
  by dal.alt;), whose lookahead is a space (no glyph in the font) and the arabic letter after it;
- LookupFlagsRligChain.ttf: the GDEF table of LookupFlags.ttf, in rlig sub dal by dal.alt; then sub dal.alt by reh.alt;
- LookupFlagsRligUnsorted.ttf: the lookups of LookupFlagsRligChain.ttf with sub dal.alt by reh.alt; first in the lookup list,
  rlig listing the lookup indexes 1 and 0 in this order;
- LookupFlagsRligIndexPastList.ttf: LookupFlagsRligChain.ttf with rlig listing the lookup indexes 0 and 7, past the end of
  the lookup list of two lookups;
- LookupFlagsFeatureIndexPastList.ttf: LookupFlagsRligChain.ttf with the feature index 7 after the ones of each language
  system, past the end of the feature list of one feature;
- LookupFlagsDuplicateFeatureTag.ttf: the GDEF table of LookupFlags.ttf, in rlig sub dal by dal.alt;, in a second feature
  tagged rlig (built as ss01, then renamed) sub dal by reh.alt;, both features in each language system;
- LookupFlagsFinaChain.ttf: the GDEF table of LookupFlags.ttf, in fina sub dal by dal.alt; then sub dal.alt by reh.alt;
- LookupFlagsRequiredFina.ttf: the GDEF table of LookupFlags.ttf, in fina sub lam by dal.alt;, and the required feature
  (ReqFeatureIndex) of each language system tagged fina (built as ss01, then renamed) sub lam by lam.init;, whose lookup
  is first in the lookup list;
- LookupFlagsRequiredFinaShared.ttf: the GDEF table of LookupFlags.ttf, in fina and in the required feature of each
  language system tagged fina (built as ss01, then renamed) the same lookup sub lam by lam.init; sub lam.init by dal.alt;
- LookupFlagsRligContextThenLigature.ttf: the GDEF table of LookupFlags.ttf, in rlig sub dal' lookup DAL_ALT lam'; (sub dal
  by dal.alt;) then sub lam alef by lam_alef;
- LookupFlagsExceptionRules.ttf: the GDEF table of LookupFlags.ttf, in calt ignore sub a' b'; sub b' lookup SUB_B; and in
  rlig ignore sub reh' dal; subtable; sub reh' lookup SUB_REH; (sub reh by reh.alt;)
- LookupFlagsDeletionThenMultiple.ttf: the GDEF table of LookupFlags.ttf, in calt the lookup of type 2 sub c by NULL;
  sub b by a b;, which covers the glyph after the one it deletes;
- LookupFlagsArabicFormsDeletion.ttf: the GDEF table of LookupFlags.ttf, in ccmp sub dal by dal fatha;, in fina the lookup
  of type 2 sub dal by NULL; sub fatha by acute.alt;
- LookupFlagsThaiCcmp.ttf: the GDEF table of LookupFlags.ttf and the language system thai, in ccmp sub kokai by kokai maiek;
- LookupFlagsThaiCcmpChain.ttf: the GDEF table of LookupFlags.ttf and the language system thai, in ccmp sub kokai by kokai
  maiek; then sub maiek by maiek.alt;
- LookupFlagsThaiFeatures.ttf: the GDEF table of LookupFlags.ttf and the language system thai, the lookups sub kokai by
  kokai maiek; (ccmp), sub maiek by maiek.alt; (rlig) and sub kokai maiek.alt by kokai_maiek; (liga), in this order in
  the lookup list
- LookupFlagsBlocklistedGDEF.ttf: the GDEF table of LookupFlags.ttf, the lookups ss01 (lookupflag IgnoreLigatures;
  sub a b by a_b;), ss02 (lookupflag IgnoreLigatures; sub ff by a_b_c;) and kern (pos a b -50;), with the GDEF, GSUB
  and GPOS tables padded to the lengths of a font of the blocklist of HarfBuzz, as TestGDEF-Blocklisted.ttf of
  test/generate-gdef-blocklist-fonts.py: HarfBuzz ignores its GDEF table.

The bases and the ligatures are 500 units wide, the marks 0.

usage: generate-lookup-flags-font.py <output directory>
"""
import argparse
import copy
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
    ("lam.init", None, 500),
    ("kokai", 0xE01, 500),
    ("khokhai", 0xE02, 500),
    ("maiek", 0xE48, 0),
    ("maiek.alt", None, 0),
    ("kokai_maiek", None, 500),
]

# the language systems, the glyph classes and the GDEF table of every font
GDEF_FEATURES = """
languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem arab dflt;

@ACUTES = [acute acute.alt];
@DOTS = [dotbelow];

table GDEF {
    GlyphClassDef [a b c a.alt b.alt alef reh dal waw dal.alt lam reh.alt A V Agrave lam.init kokai khokhai], [ff a_b a_b_c lam_alef kokai_maiek], [acute dotbelow acute.alt fatha gravecomb maiek maiek.alt], ;
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

# the glyphs of a multiple substitution are glyphs of their own for the following lookups and lookup records
lookup SUB_ACUTE_B {
    sub acute by acute.alt;
    sub b by b.alt;
} SUB_ACUTE_B;

lookup NESTED_MULTIPLE_THEN_SINGLE {
    sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B;
} NESTED_MULTIPLE_THEN_SINGLE;

lookup CHAINING_NESTED_MULTIPLE_THEN_SINGLE_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B c;
} CHAINING_NESTED_MULTIPLE_THEN_SINGLE_IGNORE_MARKS;

lookup MULTIPLE_C_A_B {
    sub c by a b;
} MULTIPLE_C_A_B;

lookup MULTIPLE_C_B_A {
    sub c by b a;
} MULTIPLE_C_B_A;

lookup MULTIPLE_C_A_C {
    sub c by a c;
} MULTIPLE_C_A_C;

lookup NESTED_MULTIPLE_C_A_C {
    sub c' lookup MULTIPLE_C_A_C;
} NESTED_MULTIPLE_C_A_C;

lookup LIGATURE_AFTER_MULTIPLE {
    sub a b by a_b;
} LIGATURE_AFTER_MULTIPLE;

lookup MULTIPLE_LIGATURE {
    sub a_b by a.alt b.alt;
} MULTIPLE_LIGATURE;

feature ss23 { lookup NESTED_MULTIPLE_THEN_SINGLE; } ss23;
feature ss24 { lookup CHAINING_NESTED_MULTIPLE_THEN_SINGLE_IGNORE_MARKS; } ss24;
feature ss25 { lookup MULTIPLE_C_A_B; lookup LIGATURE_AFTER_MULTIPLE; } ss25;
feature ss26 { lookup MULTIPLE_C_B_A; lookup LIGATURE_AFTER_MULTIPLE; } ss26;
feature ss27 { lookup LIGATURE_AFTER_MULTIPLE; lookup MULTIPLE_LIGATURE; } ss27;
feature ss28 { lookup MULTIPLE_C_A_C; } ss28;
feature ss29 { lookup NESTED_MULTIPLE_C_A_C; } ss29;
feature ss30 { lookup MULTIPLE_C; lookup SUB_ACUTE_B; } ss30;

# a ligature merges the whole clusters of its components: the acute that the first ligature skipped is in the cluster of the second one
lookup LIGATURE_C_A_B {
    sub c a_b by a_b_c;
} LIGATURE_C_A_B;

# the multiple substitution of c, then the one of one glyph of acute (a lookup of type 2), which the lookup does not apply to
# the glyphs it substituted
lookup MULTIPLE_C_THEN_ACUTE {
    sub c by a acute;
    sub acute by acute.alt;
} MULTIPLE_C_THEN_ACUTE;

lookup NESTED_MULTIPLE_C_THEN_ACUTE {
    sub [c acute]' lookup MULTIPLE_C_THEN_ACUTE;
} NESTED_MULTIPLE_C_THEN_ACUTE;

feature ss31 { lookup LIGATURE_AT_MULTIPLE_IGNORE_MARKS; lookup LIGATURE_C_A_B; } ss31;
feature ss32 { lookup MULTIPLE_C_THEN_ACUTE; } ss32;
feature ss33 { lookup NESTED_MULTIPLE_C_THEN_ACUTE; } ss33;

# after a contextual rule the lookup goes on after its input, the glyphs of a nested multiple substitution included: the
# glyphs of b match the rule of ss34 again, the a of the glyphs of c the second rule of ss35
lookup MULTIPLE_B_A_B {
    sub b by a b;
} MULTIPLE_B_A_B;

lookup NESTED_MULTIPLE_B_A_B {
    sub a' b' lookup MULTIPLE_B_A_B;
} NESTED_MULTIPLE_B_A_B;

lookup NESTED_MULTIPLE_C_B_A_THEN_SUB_A {
    sub a' c' lookup MULTIPLE_C_B_A;
    sub a' lookup SUB_A;
} NESTED_MULTIPLE_C_B_A_THEN_SUB_A;

feature ss34 { lookup NESTED_MULTIPLE_B_A_B; } ss34;
feature ss35 { lookup NESTED_MULTIPLE_C_B_A_THEN_SUB_A; } ss35;

# a ligature nested in a contextual rule matches its components from the glyph of its lookup record with its own lookupFlag,
# past the input of the rule too, and the later lookup records point into an input that lost as many input glyphs after
# the ligature glyph as the components it removed, whichever glyphs these components were
lookup LIGATURE_A_ACUTE {
    sub a acute by a.alt;
} LIGATURE_A_ACUTE;

lookup NESTED_LIGATURE_INPUT {
    sub a' lookup LIGATURE_NO_FLAG b' c;
} NESTED_LIGATURE_INPUT;

lookup NESTED_LIGATURE_SKIPPED_MARK {
    sub a' lookup LIGATURE_AT_MULTIPLE_IGNORE_MARKS acute' b';
} NESTED_LIGATURE_SKIPPED_MARK;

lookup NESTED_LIGATURE_PAST_INPUT {
    sub a' lookup LIGATURE_NO_FLAG b;
} NESTED_LIGATURE_PAST_INPUT;

lookup NESTED_LIGATURE_THEN_SINGLE {
    sub a' lookup LIGATURE_NO_FLAG b' lookup SUB_ACUTE_B acute';
} NESTED_LIGATURE_THEN_SINGLE;

lookup NESTED_LIGATURE_THEN_PAST_END {
    sub a' lookup LIGATURE_NO_FLAG b' acute' lookup SUB_ACUTE_B;
} NESTED_LIGATURE_THEN_PAST_END;

lookup NESTED_LIGATURE_RULE_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub a' lookup LIGATURE_NO_FLAG b';
} NESTED_LIGATURE_RULE_IGNORE_MARKS;

lookup NESTED_LIGATURE_SKIPPED_BY_RULE {
    lookupflag IgnoreMarks;
    sub a' lookup LIGATURE_A_ACUTE b' lookup SUB_ACUTE_B;
} NESTED_LIGATURE_SKIPPED_BY_RULE;

feature ss36 { lookup NESTED_LIGATURE_INPUT; } ss36;
feature ss37 { lookup NESTED_LIGATURE_SKIPPED_MARK; } ss37;
feature ss38 { lookup NESTED_LIGATURE_PAST_INPUT; } ss38;
feature ss39 { lookup NESTED_LIGATURE_THEN_SINGLE; } ss39;
feature ss40 { lookup NESTED_LIGATURE_THEN_PAST_END; } ss40;
feature ss41 { lookup NESTED_LIGATURE_RULE_IGNORE_MARKS; } ss41;
feature ss42 { lookup NESTED_LIGATURE_SKIPPED_BY_RULE; } ss42;

# like HarfBuzz, the input of a rule never ends before the glyph a nested lookup applied at: after a nested ligature that
# takes glyphs past the input the lookup goes on at the ligature glyph, which the rule of ss43 matches again, and the
# second rule of ss44 does not go back to the b before it
lookup LIGATURE_A_B_TO_A {
    sub a b by a;
} LIGATURE_A_B_TO_A;

lookup LIGATURE_A_B_C {
    sub a b c by a_b_c;
} LIGATURE_A_B_C;

lookup NESTED_LIGATURE_REMATCH {
    sub a' lookup LIGATURE_A_B_TO_A b;
} NESTED_LIGATURE_REMATCH;

lookup NESTED_LIGATURE_PAST_INPUT_STEP_BACK {
    sub b' lookup SUB_B a_b_c;
    sub a' lookup LIGATURE_A_B_C b c;
} NESTED_LIGATURE_PAST_INPUT_STEP_BACK;

# a nested ligature of three components removes the two input glyphs after it (the second lookup record at the sequence
# index 1 in LookupFlagsNestedLigatureSequenceIndex.ttf), and a ligature at the sequence index 1 keeps the input glyph
# before it (the lookup records in the reverse order in LookupFlagsNestedLigatureRecordOrder.ttf)
lookup NESTED_LIGATURE_THREE_COMPONENTS_THEN_SINGLE {
    sub a' lookup LIGATURE_A_B_C b' c' acute' lookup SUB_ACUTE_B;
} NESTED_LIGATURE_THREE_COMPONENTS_THEN_SINGLE;

lookup NESTED_SINGLE_THEN_LIGATURE {
    sub b' lookup SUB_ACUTE_B a' lookup LIGATURE_NO_FLAG b';
} NESTED_SINGLE_THEN_LIGATURE;

# a nested ligature of the glyphs of two tokens, the a of the glyphs of c and the b after it (ss47), of the glyphs of a
# nested multiple substitution (ss48), and at a glyph its lookupFlag ignores (ss49)
lookup NESTED_MULTIPLE_THEN_LIGATURE {
    sub c' lookup MULTIPLE_C_A_B lookup LIGATURE_NO_FLAG;
} NESTED_MULTIPLE_THEN_LIGATURE;

lookup LIGATURE_ACUTE_B_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub acute b by acute.alt;
} LIGATURE_ACUTE_B_IGNORE_MARKS;

lookup NESTED_LIGATURE_AT_IGNORED_GLYPH {
    sub acute' lookup LIGATURE_ACUTE_B_IGNORE_MARKS b;
} NESTED_LIGATURE_AT_IGNORED_GLYPH;

# nested lookups the fork does not apply yet: an alternate substitution (ss50) and a contextual lookup (ss51)
lookup ALTERNATE_A {
    sub a from [a.alt];
} ALTERNATE_A;

lookup NESTED_ALTERNATE {
    sub a' lookup ALTERNATE_A b' lookup SUB_ACUTE_B;
} NESTED_ALTERNATE;

lookup NESTED_CONTEXTUAL {
    sub a' lookup NESTED_LIGATURE_PAST_INPUT b;
} NESTED_CONTEXTUAL;

feature ss43 { lookup NESTED_LIGATURE_REMATCH; } ss43;
feature ss44 { lookup NESTED_LIGATURE_PAST_INPUT_STEP_BACK; } ss44;
feature ss45 { lookup NESTED_LIGATURE_THREE_COMPONENTS_THEN_SINGLE; } ss45;
feature ss46 { lookup NESTED_SINGLE_THEN_LIGATURE; } ss46;
feature ss47 { lookup MULTIPLE_C_B_A; lookup NESTED_LIGATURE_PAST_INPUT; } ss47;
feature ss48 { lookup NESTED_MULTIPLE_THEN_LIGATURE; } ss48;
feature ss49 { lookup NESTED_LIGATURE_AT_IGNORED_GLYPH; } ss49;
feature ss50 { lookup NESTED_ALTERNATE; } ss50;
feature ss51 { lookup NESTED_CONTEXTUAL; } ss51;

# a nested ligature at the sequence index 1 that takes glyphs past the input: the input ends at the ligature glyph, not at
# the current glyph, so the first rule of ss52 does not go back to the b before a_b_c; a later lookup record at the mark
# that a nested ligature skips (ss53); a nested multiple substitution into three glyphs, the second lookup record at the
# sequence index 2 in LookupFlagsNestedMultipleThreeSequenceIndex.ttf (ss54)
lookup NESTED_LIGATURE_PAST_INPUT_AT_LATER_RECORD {
    sub b' lookup SUB_B a_b_c;
    sub b' a' lookup LIGATURE_A_B_C b c;
} NESTED_LIGATURE_PAST_INPUT_AT_LATER_RECORD;

lookup NESTED_LIGATURE_SKIPPED_MARK_THEN_SINGLE {
    sub a' lookup LIGATURE_AT_MULTIPLE_IGNORE_MARKS acute' lookup SUB_ACUTE_B b';
} NESTED_LIGATURE_SKIPPED_MARK_THEN_SINGLE;

lookup MULTIPLE_C_A_ACUTE_B {
    sub c by a acute b;
} MULTIPLE_C_A_ACUTE_B;

lookup NESTED_MULTIPLE_THREE_GLYPHS_THEN_SINGLE {
    sub c' lookup MULTIPLE_C_A_ACUTE_B lookup SUB_ACUTE_B;
} NESTED_MULTIPLE_THREE_GLYPHS_THEN_SINGLE;

feature ss52 { lookup NESTED_LIGATURE_PAST_INPUT_AT_LATER_RECORD; } ss52;
feature ss53 { lookup NESTED_LIGATURE_SKIPPED_MARK_THEN_SINGLE; } ss53;
feature ss54 { lookup NESTED_MULTIPLE_THREE_GLYPHS_THEN_SINGLE; } ss54;

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
    pos lam_alef fatha <-40 0 -40 0>;
    pos lam_alef waw <-100 0 -100 0>;
    pos waw lam_alef <-50 0 -50 0>;
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

# the lookups of LookupFlagsRligAfterMultiple.ttf
RLIG_AFTER_MULTIPLE_FEATURES = GDEF_FEATURES + """
lookup MULTIPLE_DAL {
    sub dal by dal.alt fatha;
} MULTIPLE_DAL;

lookup SUB_FATHA {
    sub fatha by acute.alt;
} SUB_FATHA;

feature rlig { lookup MULTIPLE_DAL; lookup SUB_FATHA; } rlig;
"""

# the lookups of LookupFlagsArabicForms.ttf
ARABIC_FORMS_FEATURES = GDEF_FEATURES + """
lookup CCMP_LIGATURE_LAM_ALEF {
    sub lam alef by lam_alef;
} CCMP_LIGATURE_LAM_ALEF;

lookup CCMP_MULTIPLE_LAM_DAL {
    sub lam by lam fatha;
    sub dal by dal fatha;
} CCMP_MULTIPLE_LAM_DAL;

lookup FINA_DAL_REH {
    sub dal by dal.alt;
    sub reh by reh.alt;
} FINA_DAL_REH;

feature ccmp { lookup CCMP_LIGATURE_LAM_ALEF; lookup CCMP_MULTIPLE_LAM_DAL; } ccmp;
feature fina { lookup FINA_DAL_REH; } fina;
"""

# the lookups of LookupFlagsArabicFormsChaining.ttf, fina before init like the arabic shaper of HarfBuzz
ARABIC_FORMS_CHAINING_FEATURES = GDEF_FEATURES + """
lookup FINA_MULTIPLE {
    sub reh by reh.alt fatha;
    sub dal by dal.alt;
} FINA_MULTIPLE;

lookup INIT_AFTER_FINA {
    lookupflag IgnoreMarks;
    sub [dal.alt reh.alt] lam' by lam.init;
} INIT_AFTER_FINA;

feature fina { lookup FINA_MULTIPLE; } fina;
feature init { lookup INIT_AFTER_FINA; } init;
"""

# the lookups of LookupFlagsArabicFormsNested.ttf: the form of a letter applies to each glyph of its decomposition
ARABIC_FORMS_NESTED_FEATURES = GDEF_FEATURES + """
lookup MULTIPLE_DAL_FATHA {
    sub dal by dal fatha;
} MULTIPLE_DAL_FATHA;

lookup CCMP_NESTED_MULTIPLE_DAL {
    sub dal' lookup MULTIPLE_DAL_FATHA;
} CCMP_NESTED_MULTIPLE_DAL;

lookup FINA_DAL_FATHA {
    sub dal by dal.alt;
    sub fatha by acute.alt;
} FINA_DAL_FATHA;

feature ccmp { lookup CCMP_NESTED_MULTIPLE_DAL; } ccmp;
feature fina { lookup FINA_DAL_FATHA; } fina;
"""

# the lookups of LookupFlagsRligChain.ttf: the second lookup substitutes the substitute of the first one
RLIG_CHAIN_FEATURES = GDEF_FEATURES + """
lookup DAL_ALT {
    sub dal by dal.alt;
} DAL_ALT;

lookup DAL_ALT_REH {
    sub dal.alt by reh.alt;
} DAL_ALT_REH;

feature rlig { lookup DAL_ALT; lookup DAL_ALT_REH; } rlig;
"""

# the lookups of LookupFlagsDuplicateFeatureTag.ttf: ss01 is renamed rlig, the second feature of the tag in each language system
DUPLICATE_FEATURE_TAG_FEATURES = GDEF_FEATURES + """
lookup DAL_ALT {
    sub dal by dal.alt;
} DAL_ALT;

lookup DAL_REH {
    sub dal by reh.alt;
} DAL_REH;

feature rlig { lookup DAL_ALT; } rlig;
feature ss01 { lookup DAL_REH; } ss01;
"""

# the lookups of LookupFlagsFinaChain.ttf: the second lookup of the final form substitutes the substitute of the first one
FINA_CHAIN_FEATURES = GDEF_FEATURES + """
lookup DAL_ALT {
    sub dal by dal.alt;
} DAL_ALT;

lookup DAL_ALT_REH {
    sub dal.alt by reh.alt;
} DAL_ALT_REH;

feature fina { lookup DAL_ALT; lookup DAL_ALT_REH; } fina;
"""

# the lookups of LookupFlagsRequiredFina.ttf: ss01 is renamed fina, the required feature of each language system, and
# its lookup is before the one of fina in the lookup list
REQUIRED_FINA_FEATURES = GDEF_FEATURES + """
lookup LAM_INIT {
    sub lam by lam.init;
} LAM_INIT;

lookup LAM_DAL_ALT {
    sub lam by dal.alt;
} LAM_DAL_ALT;

feature fina { lookup LAM_DAL_ALT; } fina;
feature ss01 { lookup LAM_INIT; } ss01;
"""

# the lookups of LookupFlagsRequiredFinaShared.ttf: ss01 is renamed fina, the required feature of each language system,
# with the lookup of fina, which substitutes its own substitute
REQUIRED_FINA_SHARED_FEATURES = GDEF_FEATURES + """
lookup LAM_INIT_DAL_ALT {
    sub lam by lam.init;
    sub lam.init by dal.alt;
} LAM_INIT_DAL_ALT;

feature fina { lookup LAM_INIT_DAL_ALT; } fina;
feature ss01 { lookup LAM_INIT_DAL_ALT; } ss01;
"""

# the lookups of LookupFlagsRligUnsorted.ttf: the lookups of LookupFlagsRligChain.ttf, the second one first in the lookup list,
# and rlig lists them in the order of LookupFlagsRligChain.ttf (feaLib keeps the order of the feature)
RLIG_UNSORTED_FEATURES = GDEF_FEATURES + """
lookup DAL_ALT_REH {
    sub dal.alt by reh.alt;
} DAL_ALT_REH;

lookup DAL_ALT {
    sub dal by dal.alt;
} DAL_ALT;

feature rlig { lookup DAL_ALT; lookup DAL_ALT_REH; } rlig;
"""

# the lookups of LookupFlagsArabicFormsMultiple.ttf: the fina lookup also covers a glyph of its own multiple substitution
ARABIC_FORMS_MULTIPLE_FEATURES = GDEF_FEATURES + """
lookup FINA_MULTIPLE_SAME {
    sub reh by reh.alt fatha;
    sub fatha by acute.alt;
} FINA_MULTIPLE_SAME;

feature fina { lookup FINA_MULTIPLE_SAME; } fina;
"""

# the lookups of LookupFlagsArabicJoining.ttf: the joining type of a character decides the form of the letter next to it
ARABIC_JOINING_FEATURES = GDEF_FEATURES + """
lookup INIT_LAM {
    sub lam by lam.init;
} INIT_LAM;

lookup FINA_DAL {
    sub dal by dal.alt;
} FINA_DAL;

feature init { lookup INIT_LAM; } init;
feature fina { lookup FINA_DAL; } fina;
"""

# the lookups of LookupFlagsMediContext.ttf: the input of the contextual rule is two letters of the medial form
MEDI_CONTEXT_FEATURES = GDEF_FEATURES + """
lookup SUB_LAM {
    sub lam by lam.init;
} SUB_LAM;

feature medi { sub lam' lookup SUB_LAM lam'; } medi;
"""

# the lookups of LookupFlagsFinaThenMedi.ttf: the rule of the medial form needs the final form after it; the rule first in
# the lookup list, so that only the order of the form stages applies the final form before it
FINA_THEN_MEDI_FEATURES = GDEF_FEATURES + """
feature medi { sub lam' dal.alt by lam.init; } medi;
feature fina { sub dal by dal.alt; } fina;
"""

# the lookups of LookupFlagsMediThenInit.ttf: the rule of the initial form needs the medial form after it, first in the
# lookup list
MEDI_THEN_INIT_FEATURES = GDEF_FEATURES + """
feature init { sub lam' reh.alt by lam.init; } init;
feature medi { sub lam by reh.alt; } medi;
"""

# the lookups of LookupFlagsIsolThenFina.ttf: the rule of the final form needs the isolated form after it, first in the
# lookup list
ISOL_THEN_FINA_FEATURES = GDEF_FEATURES + """
feature fina { sub dal' reh.alt by dal.alt; } fina;
feature isol { sub dal by reh.alt; } isol;
"""

# the lookups of LookupFlagsInitLigature.ttf: the ligature of the initial form ends at a letter of the final form
INIT_LIGATURE_FEATURES = GDEF_FEATURES + """
feature init { sub lam alef by lam_alef; } init;
"""

# the lookups of LookupFlagsFinaAcrossSpace.ttf: the lookahead of the final form crosses the space after the arabic word
FINA_ACROSS_SPACE_FEATURES = GDEF_FEATURES + """
lookup DAL_ALT {
    sub dal by dal.alt;
} DAL_ALT;

feature fina { sub dal' lookup DAL_ALT .notdef lam; } fina;
"""

# the lookups of LookupFlagsNotdefBacktrack.ttf: the backtrack of the rule is the glyph 0
NOTDEF_BACKTRACK_FEATURES = GDEF_FEATURES + """
feature calt { sub .notdef a' by a.alt; } calt;
"""

# the lookups of LookupFlagsNestedTwoSubtables.ttf: the second subtable of the nested lookup covers the substitute of the first one
NESTED_TWO_SUBTABLES_FEATURES = GDEF_FEATURES + """
lookup C_THEN_A {
    sub c by a;
    subtable;
    sub a by a.alt;
} C_THEN_A;

feature calt { sub c' lookup C_THEN_A b; } calt;
"""

# the lookups of LookupFlagsNestedDeletionLastInput.ttf: the second lookup record targets the index of the deleted last input glyph
NESTED_DELETION_LAST_INPUT_FEATURES = GDEF_FEATURES + """
lookup DELETE_C {
    sub c by NULL;
} DELETE_C;

lookup SUB_ACUTE_B {
    sub acute by acute.alt;
    sub b by b.alt;
} SUB_ACUTE_B;

feature calt { sub a' c' lookup DELETE_C lookup SUB_ACUTE_B; } calt;
"""

# the lookups of LookupFlagsNestedDeletionNextRecord.ttf: the second lookup record targets the index after the one of the
# deleted glyph, which a skipped mark follows
NESTED_DELETION_NEXT_RECORD_FEATURES = GDEF_FEATURES + """
lookup DELETE_C {
    sub c by NULL;
} DELETE_C;

lookup SUB_ACUTE_B {
    sub acute by acute.alt;
    sub b by b.alt;
} SUB_ACUTE_B;

feature calt {
    lookupflag IgnoreMarks;
    sub c' lookup DELETE_C b' lookup SUB_ACUTE_B b';
} calt;
"""

# the lookups of LookupFlagsDeletionThenLigature.ttf: the first glyph is deleted, then a ligature skips a mark
DELETION_THEN_LIGATURE_FEATURES = GDEF_FEATURES + """
lookup DELETE_C {
    sub c by NULL;
} DELETE_C;

lookup LIGATURE_A_B_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    sub a b by a_b;
} LIGATURE_A_B_IGNORE_MARKS;

feature calt { lookup DELETE_C; lookup LIGATURE_A_B_IGNORE_MARKS; } calt;
"""

# the lookups of LookupFlagsRligContextThenLigature.ttf: the second lookup starts at the second input glyph of the first one
RLIG_CONTEXT_THEN_LIGATURE_FEATURES = GDEF_FEATURES + """
lookup DAL_ALT {
    sub dal by dal.alt;
} DAL_ALT;

lookup CONTEXT_DAL_LAM {
    sub dal' lookup DAL_ALT lam';
} CONTEXT_DAL_LAM;

lookup LIGATURE_LAM_ALEF {
    sub lam alef by lam_alef;
} LIGATURE_LAM_ALEF;

feature rlig { lookup CONTEXT_DAL_LAM; lookup LIGATURE_LAM_ALEF; } rlig;
"""

# the lookups of LookupFlagsExceptionRules.ttf: contextual rules that match and substitute nothing, each one in the subtable
# before the one of the rule after it (feaLib: two ContextSubst format 3 in calt, two ChainContextSubst format 3 in rlig)
EXCEPTION_RULES_FEATURES = GDEF_FEATURES + """
lookup SUB_B {
    sub b by b.alt;
} SUB_B;

lookup SUB_REH {
    sub reh by reh.alt;
} SUB_REH;

lookup CALT_EXCEPTION_A_B {
    ignore sub a' b';
    sub b' lookup SUB_B;
} CALT_EXCEPTION_A_B;

lookup RLIG_EXCEPTION_REH_DAL {
    ignore sub reh' dal;
    subtable;
    sub reh' lookup SUB_REH;
} RLIG_EXCEPTION_REH_DAL;

feature calt { lookup CALT_EXCEPTION_A_B; } calt;
feature rlig { lookup RLIG_EXCEPTION_REH_DAL; } rlig;
"""

# the lookups of LookupFlagsDeletionThenMultiple.ttf: the lookup that deletes the first glyph covers the next one
DELETION_THEN_MULTIPLE_FEATURES = GDEF_FEATURES + """
lookup DELETE_THEN_MULTIPLE {
    sub c by NULL;
    sub b by a b;
} DELETE_THEN_MULTIPLE;

feature calt { lookup DELETE_THEN_MULTIPLE; } calt;
"""

# the lookups of LookupFlagsArabicFormsDeletion.ttf: the form lookup deletes the first glyph of a letter that ccmp decomposed
ARABIC_FORMS_DELETION_FEATURES = GDEF_FEATURES + """
lookup MULTIPLE_DAL_FATHA {
    sub dal by dal fatha;
} MULTIPLE_DAL_FATHA;

lookup FINA_DELETE {
    sub dal by NULL;
    sub fatha by acute.alt;
} FINA_DELETE;

feature ccmp { lookup MULTIPLE_DAL_FATHA; } ccmp;
feature fina { lookup FINA_DELETE; } fina;
"""

# the lookups of LookupFlagsThaiCcmp.ttf: a multiple substitution whose glyphs start with its input glyph
THAI_CCMP_LOOKUPS = """
lookup MULTIPLE_KOKAI {
    sub kokai by kokai maiek;
} MULTIPLE_KOKAI;

feature ccmp { lookup MULTIPLE_KOKAI; } ccmp;
"""

# the lookups of LookupFlagsThaiCcmpChain.ttf: the second lookup of ccmp substitutes a glyph of the multiple substitution of the first one
THAI_CCMP_CHAIN_LOOKUPS = """
lookup MULTIPLE_KOKAI {
    sub kokai by kokai maiek;
} MULTIPLE_KOKAI;

lookup SUB_MAIEK {
    sub maiek by maiek.alt;
} SUB_MAIEK;

feature ccmp { lookup MULTIPLE_KOKAI; lookup SUB_MAIEK; } ccmp;
"""

# the lookups of LookupFlagsThaiFeatures.ttf: a lookup of ccmp, then one of rlig, then one of liga, each one substituting
# the glyphs of the one before it
THAI_FEATURES_LOOKUPS = """
lookup MULTIPLE_KOKAI {
    sub kokai by kokai maiek;
} MULTIPLE_KOKAI;

lookup SUB_MAIEK {
    sub maiek by maiek.alt;
} SUB_MAIEK;

lookup LIGATURE_KOKAI_MAIEK {
    sub kokai maiek.alt by kokai_maiek;
} LIGATURE_KOKAI_MAIEK;

feature liga { lookup LIGATURE_KOKAI_MAIEK; } liga;
feature rlig { lookup SUB_MAIEK; } rlig;
feature ccmp { lookup MULTIPLE_KOKAI; } ccmp;
"""

# the pairs of the kern table of LookupFlagsKernTable.ttf
KERN_TABLE_PAIRS = {("a", "acute"): -15, ("a", "b"): -60, ("acute", "b"): -40, ("A", "V"): -100}

# the lookups of LookupFlagsExtension.ttf in extension lookups
EXTENSION_LOOKUP_NAMES = [
    "LOOKAHEAD_IGNORE_MARKS",
    "KERN_IGNORE_MARKS",
    "LIGATURE_AT_MULTIPLE_IGNORE_MARKS",
    "NESTED_LIGATURE_SKIPPED_MARK",
]


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


def get_rule_lookup_records(subtable):
    """The lookup records of the one rule of a contextual subtable of format 3, or of a context subtable of format 1."""
    if subtable.Format == 3:
        return subtable.SubstLookupRecord
    assert subtable.Format == 1 and len(subtable.SubRuleSet) == 1 and len(subtable.SubRuleSet[0].SubRule) == 1
    return subtable.SubRuleSet[0].SubRule[0].SubstLookupRecord


def set_nested_sequence_index(font, feature_tag, sequence_index):
    lookup_type, subtable = get_feature_subtable(font, feature_tag)
    assert lookup_type in (5, 6)
    get_rule_lookup_records(subtable)[1].SequenceIndex = sequence_index


def reverse_nested_lookup_records(font, feature_tag):
    lookup_type, subtable = get_feature_subtable(font, feature_tag)
    assert lookup_type in (5, 6)
    get_rule_lookup_records(subtable).reverse()


def append_nested_lookup_record(font, feature_tag, sequence_index):
    lookup_type, subtable = get_feature_subtable(font, feature_tag)
    assert lookup_type in (5, 6) and subtable.Format == 3
    lookup_record = copy.deepcopy(subtable.SubstLookupRecord[1])
    lookup_record.SequenceIndex = sequence_index
    subtable.SubstLookupRecord.append(lookup_record)
    subtable.SubstCount = len(subtable.SubstLookupRecord)


def nested_deletion(font, feature_tag):
    lookup_type, subtable = get_feature_subtable(font, "ss30")
    assert lookup_type == 2
    subtable.mapping["c"] = []
    set_nested_sequence_index(font, feature_tag, 0)


def set_feature_lookup_indexes(font, feature_tag, lookup_indexes):
    gsub = font["GSUB"].table
    record = next(record for record in gsub.FeatureList.FeatureRecord if record.FeatureTag == feature_tag)
    record.Feature.LookupListIndex = lookup_indexes
    record.Feature.LookupCount = len(lookup_indexes)


def append_feature_index(font, feature_index):
    for script_record in font["GSUB"].table.ScriptList.ScriptRecord:
        language_system = script_record.Script.DefaultLangSys
        language_system.FeatureIndex.append(feature_index)
        language_system.FeatureCount = len(language_system.FeatureIndex)


def rename_feature_tag(font, feature_tag, new_feature_tag):
    gsub = font["GSUB"].table
    record = next(record for record in gsub.FeatureList.FeatureRecord if record.FeatureTag == feature_tag)
    record.FeatureTag = new_feature_tag


def make_feature_required(font, feature_tag, new_feature_tag):
    """Rename a feature and make it the required feature (ReqFeatureIndex) of each language system, out of its features."""
    gsub = font["GSUB"].table
    feature_index = next(index for index, record in enumerate(gsub.FeatureList.FeatureRecord) if record.FeatureTag == feature_tag)
    rename_feature_tag(font, feature_tag, new_feature_tag)
    for script_record in gsub.ScriptList.ScriptRecord:
        language_system = script_record.Script.DefaultLangSys
        language_system.FeatureIndex = [index for index in language_system.FeatureIndex if index != feature_index]
        language_system.FeatureCount = len(language_system.FeatureIndex)
        language_system.ReqFeatureIndex = feature_index


def get_thai_features(lookups):
    arab_language_system = "languagesystem arab dflt;\n"
    assert arab_language_system in GDEF_FEATURES
    return GDEF_FEATURES.replace(arab_language_system, arab_language_system + "languagesystem thai dflt;\n") + lookups


def duplicate_last_feature_lookup(font, feature_tag):
    gsub = font["GSUB"].table
    record = next(record for record in gsub.FeatureList.FeatureRecord if record.FeatureTag == feature_tag)
    record.Feature.LookupListIndex.append(record.Feature.LookupListIndex[-1])
    record.Feature.LookupCount = len(record.Feature.LookupListIndex)


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
    fonts["LookupFlagsKernTableNoGDEF.ttf"] = build_font()
    replace_gpos_with_kern_table(fonts["LookupFlagsKernTableNoGDEF.ttf"])
    del fonts["LookupFlagsKernTableNoGDEF.ttf"]["GDEF"]
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
    fonts["LookupFlagsNestedSequenceIndex.ttf"] = build_font()
    set_nested_sequence_index(fonts["LookupFlagsNestedSequenceIndex.ttf"], "ss23", 2)
    fonts["LookupFlagsNestedSequenceIndexPastEnd.ttf"] = build_font()
    set_nested_sequence_index(fonts["LookupFlagsNestedSequenceIndexPastEnd.ttf"], "ss23", 3)
    fonts["LookupFlagsNestedSequenceIndexPastEndThenValid.ttf"] = build_font()
    set_nested_sequence_index(fonts["LookupFlagsNestedSequenceIndexPastEndThenValid.ttf"], "ss23", 3)
    append_nested_lookup_record(fonts["LookupFlagsNestedSequenceIndexPastEndThenValid.ttf"], "ss23", 2)
    fonts["LookupFlagsNestedLigatureSequenceIndex.ttf"] = build_font()
    set_nested_sequence_index(fonts["LookupFlagsNestedLigatureSequenceIndex.ttf"], "ss45", 1)
    fonts["LookupFlagsNestedLigatureRecordOrder.ttf"] = build_font()
    reverse_nested_lookup_records(fonts["LookupFlagsNestedLigatureRecordOrder.ttf"], "ss46")
    fonts["LookupFlagsNestedMultipleThreeSequenceIndex.ttf"] = build_font()
    set_nested_sequence_index(fonts["LookupFlagsNestedMultipleThreeSequenceIndex.ttf"], "ss54", 2)
    fonts["LookupFlagsNestedDeletion.ttf"] = build_font()
    nested_deletion(fonts["LookupFlagsNestedDeletion.ttf"], "ss23")
    fonts["LookupFlagsNestedDeletionSkippedMark.ttf"] = build_font()
    nested_deletion(fonts["LookupFlagsNestedDeletionSkippedMark.ttf"], "ss24")
    fonts["LookupFlagsNestedDeletionLastInput.ttf"] = build_font(NESTED_DELETION_LAST_INPUT_FEATURES)
    fonts["LookupFlagsNestedDeletionNextRecord.ttf"] = build_font(NESTED_DELETION_NEXT_RECORD_FEATURES)
    fonts["LookupFlagsNestedTwoSubtables.ttf"] = build_font(NESTED_TWO_SUBTABLES_FEATURES)
    fonts["LookupFlagsNotdefBacktrack.ttf"] = build_font(NOTDEF_BACKTRACK_FEATURES)
    fonts["LookupFlagsDeletionThenLigature.ttf"] = build_font(DELETION_THEN_LIGATURE_FEATURES)
    fonts["LookupFlagsRligAfterMultiple.ttf"] = build_font(RLIG_AFTER_MULTIPLE_FEATURES)
    fonts["LookupFlagsArabicForms.ttf"] = build_font(ARABIC_FORMS_FEATURES)
    fonts["LookupFlagsArabicFormsChaining.ttf"] = build_font(ARABIC_FORMS_CHAINING_FEATURES)
    fonts["LookupFlagsArabicFormsNested.ttf"] = build_font(ARABIC_FORMS_NESTED_FEATURES)
    fonts["LookupFlagsCcmpDuplicate.ttf"] = build_font(ARABIC_FORMS_FEATURES)
    duplicate_last_feature_lookup(fonts["LookupFlagsCcmpDuplicate.ttf"], "ccmp")
    fonts["LookupFlagsArabicFormsMultiple.ttf"] = build_font(ARABIC_FORMS_MULTIPLE_FEATURES)
    fonts["LookupFlagsArabicJoining.ttf"] = build_font(ARABIC_JOINING_FEATURES)
    fonts["LookupFlagsMediContext.ttf"] = build_font(MEDI_CONTEXT_FEATURES)
    fonts["LookupFlagsFinaThenMedi.ttf"] = build_font(FINA_THEN_MEDI_FEATURES)
    fonts["LookupFlagsMediThenInit.ttf"] = build_font(MEDI_THEN_INIT_FEATURES)
    fonts["LookupFlagsIsolThenFina.ttf"] = build_font(ISOL_THEN_FINA_FEATURES)
    fonts["LookupFlagsInitLigature.ttf"] = build_font(INIT_LIGATURE_FEATURES)
    fonts["LookupFlagsFinaAcrossSpace.ttf"] = build_font(FINA_ACROSS_SPACE_FEATURES)
    fonts["LookupFlagsRligChain.ttf"] = build_font(RLIG_CHAIN_FEATURES)
    fonts["LookupFlagsRligUnsorted.ttf"] = build_font(RLIG_UNSORTED_FEATURES)
    fonts["LookupFlagsRligContextThenLigature.ttf"] = build_font(RLIG_CONTEXT_THEN_LIGATURE_FEATURES)
    fonts["LookupFlagsExceptionRules.ttf"] = build_font(EXCEPTION_RULES_FEATURES)
    fonts["LookupFlagsRligIndexPastList.ttf"] = build_font(RLIG_CHAIN_FEATURES)
    set_feature_lookup_indexes(fonts["LookupFlagsRligIndexPastList.ttf"], "rlig", [0, 7])
    fonts["LookupFlagsFeatureIndexPastList.ttf"] = build_font(RLIG_CHAIN_FEATURES)
    append_feature_index(fonts["LookupFlagsFeatureIndexPastList.ttf"], 7)
    fonts["LookupFlagsDuplicateFeatureTag.ttf"] = build_font(DUPLICATE_FEATURE_TAG_FEATURES)
    rename_feature_tag(fonts["LookupFlagsDuplicateFeatureTag.ttf"], "ss01", "rlig")
    fonts["LookupFlagsFinaChain.ttf"] = build_font(FINA_CHAIN_FEATURES)
    fonts["LookupFlagsRequiredFina.ttf"] = build_font(REQUIRED_FINA_FEATURES)
    make_feature_required(fonts["LookupFlagsRequiredFina.ttf"], "ss01", "fina")
    fonts["LookupFlagsRequiredFinaShared.ttf"] = build_font(REQUIRED_FINA_SHARED_FEATURES)
    make_feature_required(fonts["LookupFlagsRequiredFinaShared.ttf"], "ss01", "fina")
    fonts["LookupFlagsDeletionThenMultiple.ttf"] = build_font(DELETION_THEN_MULTIPLE_FEATURES)
    fonts["LookupFlagsArabicFormsDeletion.ttf"] = build_font(ARABIC_FORMS_DELETION_FEATURES)
    fonts["LookupFlagsThaiCcmp.ttf"] = build_font(get_thai_features(THAI_CCMP_LOOKUPS))
    fonts["LookupFlagsThaiCcmpChain.ttf"] = build_font(get_thai_features(THAI_CCMP_CHAIN_LOOKUPS))
    fonts["LookupFlagsThaiFeatures.ttf"] = build_font(get_thai_features(THAI_FEATURES_LOOKUPS))
    for file_name, font in fonts.items():
        font.save(os.path.join(arguments.output_directory, file_name))


if __name__ == "__main__":
    main()
