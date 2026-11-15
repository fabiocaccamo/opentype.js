"""Build the test fonts of malformed GDEF, GPOS and GSUB tables, patched copies of five test fonts.

Each font is the font of test/fonts it is named after, with a few 16-bit fields of its GDEF, GPOS or GSUB table changed:
the other tables and the rest of the layout tables are left byte for byte, so the lookups that are not patched keep
the positions their generator documents. The lookups are the ones of the lookup list of the source font; fontTools
shares the subtables with the same bytes, so a patched subtable can be the one of several lookups.

TestMarkAttachment-Malformed.ttf (from TestMarkAttachment.ttf, see generate-mark-attachment-font.py):
- GPOS: the posFormat set to 2 in the mark-to-base subtable of the lookups 4, 15 and 16 (ss04, ss13, ss14), which is
  also the mark-to-mark subtable of the lookup 19 (ss19); in the mark-to-mark subtable of the lookups 2, 3, 12, 14 and
  18 (mkmk, ss02, ss06, ss08, ss18); in the mark-to-ligature subtable of the lookup 17 (ss15); in the cursive subtable
  of the lookup 11 (ss05);
- GPOS lookup 0 MARK_TO_BASE (mark): the format of the anchor of i for @TOP (format 2, a contour point) set to 4;
- GPOS lookup 6 CURSIVE_LEFT_TO_RIGHT (curs): the XDevice offset of the entry anchor of z (format 3) set to 0xFFF0,
  past the end of the table;
- GPOS lookup 7 SINGLE_BEH (ss09): its lookupType set to 10, a lookup type GPOS has not;
- GSUB lookup 1 LIGA_A_F_I (ss12): the format of the coverage table of its ligature subtable set to 3 (like the fonts
  of Tabler Icons, opentype.js issue 617);
- GSUB lookup 6 LIGA_MARKS (ss17): the substFormat of its ligature subtable set to 2.

TestMarkAttachment-NullOffsets.ttf (from TestMarkAttachment.ttf), offsets set to 0:
- GPOS: the MarkArray offset of the mark-to-base subtable of the lookups 4, 15, 16 and 19 (ss04, ss13, ss14, ss19), the
  BaseArray offset of the lookup 0 MARK_TO_BASE (mark), the LigatureArray offset of the lookup 1 MARK_TO_LIGATURE
  (mark), the MarkArray offset of the lookup 17 MARK_TO_LIGATURE_ATTACHMENT_TYPE (ss15), the Mark2Array offset of the
  mark-to-mark subtable of the lookups 2, 3, 12, 14 and 18 (mkmk, ss02, ss06, ss08, ss18), the offset of the subtable
  of the lookup 5 CURSIVE_REVERSED (ss03) in the lookup;
- GSUB lookup 5 LIGA_F_I_A (ss16): the coverage offset of its ligature subtable;
- GSUB lookup 6 LIGA_MARKS (ss17): the LigatureSet offset of dotbelowcomb in its ligature subtable;
- GSUB lookup 2 MULTIPLE_Z (ss10): the Sequence offset of z in its multiple substitution subtable;
- GSUB lookup 0 LIGA_F_I (liga): the offset of the first Ligature (f i i) of the LigatureSet of f.

TestMarkAttachment-MalformedOffsets.ttf (from TestMarkAttachment.ttf), offsets inside a subtable set to 0xFFF0, past
the end of the table:
- GPOS lookup 0 MARK_TO_BASE (mark): the offset of the anchor of a for @TOP;
- GPOS lookup 1 MARK_TO_LIGATURE (mark): the MarkArray offset.

TestMarkAttachment-MalformedGDEF.ttf (from TestMarkAttachment.ttf):
- GDEF: the AttachList and LigCaretList offsets (NULL) set to 0xFFF0, past the end of the table, and the format of the
  coverage of the mark glyph set 0 ([acutecomb], the set of MARK_TO_MARK_FILTERED and MARK_TO_BASE_FILTERED) set to 3.

TestAlternateSubstitution-Malformed.ttf (from TestAlternateSubstitution.ttf, see
generate-alternate-substitution-font.py):
- GSUB lookup 3 (salt): its lookupType set to 9, a lookup type GSUB has not;
- GSUB lookup 4 C_ALTERNATES (cv01, an extension lookup): the extensionLookupType of its extension subtable set to 9;
- GSUB lookup 5 (cv02): the substFormat of the first of its two subtables set to 2;
- GSUB lookup 17 (ss03 and ss04): the AlternateSet offset of n;
- GSUB lookup 8 (ss02, type 6 format 3): its inputGlyphCount set to 0, so that its lookahead count is read from its
  first input coverage offset;
- GSUB lookup 24 (fina, type 5 format 3): its glyphCount set to 0.

TestMarkAttachment-Malformed.woff2 is TestMarkAttachment-Malformed.ttf compressed by fontTools (with the brotli module),
which keeps the bytes of its layout tables.

TestContextualPositioning-Malformed.ttf (from TestContextualPositioning.ttf, see
generate-contextual-positioning-font.py):
- GPOS: the coverage offset set to 0 in the lookups 9 CONTEXT_GLYPHS (ss01, type 7 format 1), 10 CONTEXT_CLASSES
  (ss02, type 7 format 2), 12 CHAIN_GLYPHS (ss04, type 8 format 1) and 13 CHAIN_CLASSES (ss05, type 8 format 2);
- GPOS lookup 11 CONTEXT_COVERAGES (ss03, type 7 format 3): its glyphCount set to 0;
- GPOS lookup 14 CHAIN_COVERAGES (ss06, type 8 format 3): its inputGlyphCount set to 0, so that its lookahead count is
  read from its first input coverage offset;
- GPOS lookup 29 TYPE7_IGNORE_MARKS (ss18, type 7 format 3): its format set to 4;
- GPOS: the format set to 4 in the type 8 format 1 subtable of the lookups 15, 16, 30 and 31 (ss07, ss08, ss19, ss20);
- GPOS lookup 20 CONTEXT_MARKS (ss12, type 8 format 1): the offset of the second rule (f_i acutecomb') of the rule set
  of acutecomb set to 0.

TestPairPositioning-Malformed.ttf (from TestPairPositioning.ttf, see generate-pair-positioning-font.py):
- GPOS lookup 3 VARIABLE_PAIR (kern): the XAdvDevice offset of the first value record of T a set to 0xFFF0, past the
  end of the table.

TestPairPositioning-MalformedOffsets.ttf (from TestPairPositioning.ttf):
- GPOS lookup 1 PAIR_SECOND_GLYPH (kern): the offset of the PairSet of b (b c) in its first subtable (b c and c d) set
  to 0xFFF0, past the end of the table.

TestSingleAdjustment-Malformed.ttf (from TestSingleAdjustment.ttf, see generate-single-adjustment-font.py):
- GPOS lookup 3 SINGLE_VARIABLE (halt): the XAdvDevice offset of the value record of O set to 0xFFF0, past the end of
  the table.

HarfBuzz 11.3.2 skips a subtable of an unknown format and the subtables of a lookup of an unknown type, reads a NULL
offset as an empty table (a mark without mark record has the class 0 and the anchor 0 0, a NULL Sequence deletes its
glyph), an anchor of an unknown format as the anchor 0 0, an anchor with a Device table past the end of the table as a
NULL anchor, a Device table of a value record past the end of the table as a NULL Device offset, a part of GDEF past the
end of the table as a NULL offset and a coverage of an unknown format as an empty coverage; it reads any other offset
inside a subtable whose table fails to sanitize (e.g. past the end of the table) as a NULL offset too, and keeps the
rest of the subtable (TestMarkAttachment-MalformedOffsets.ttf, TestPairPositioning-MalformedOffsets.ttf), where
opentype.js skips the whole subtable; a NULL Ligature offset is a ligature that matches nothing, a NULL rule offset a
rule of no glyph, which matches the glyph and applies no lookup; with the commands
hb-shape --no-glyph-names --cluster-level=1 <font> -u <code points> [--features=<features>] [--variations=<variation>]:

    TestMarkAttachment-Malformed.ttf
    -u 0061,0301 --features=ss13,-mark                  [2=0+500|10=1+0] (the same with ss04)
    -u 0066,0069,0301 --features=ss15,-mark             [9=0+550|10=2+0]
    -u 0061,0301,0301                                   [2=0+500|10=1@-250,20+0|10=2@-250,20+0]
    -u 0061,0301,0301 --features=ss02,-mkmk             [2=0+500|10=1@-250,20+0|10=2@-250,20+0]
    -u 0078,0079 --features=ss05,-curs                  [6=0+500|7=1+500]
    -u 0069,0301                                        [5=0+250|10=1@-250,-500+0]
    -u 0079,007A                                        [7=0+500|8=1+500]
    -u 0061,0066,0069 --features=ss12                   [2=0+500|9=1+550]
    -u 0061,0323,0300 --features=ss17,-mark,-mkmk       [2=0+500|12=1+0|11=2+0]
    -u 0628,064E --features=ss09                        [14=1@260,30+0|13=0+500]
    TestMarkAttachment-NullOffsets.ttf
    -u 0061,0301 --features=ss13,-mark                  [2=0+500|10=1@-250,900+0]
    -u 0066,0069,0301 --features=ss15,-mark             [9=0+550|10=2@-130,900+0]
    -u 0061,0301                                        [2=0+500|10=1+0]
    -u 0066,0069,0301                                   [9=0+550|10=2+0]
    -u 0061,0301,0301                                   [2=0+500|10=1+0|10=2+0]
    -u 0078,0079 --features=ss03,-curs                  [6=0+500|7=1+500]
    -u 0066,0069,0061 --features=ss16                   [9=0+550|2=2+500]
    -u 0061,0323,0300 --features=ss17,-mark,-mkmk       [2=0+500|12=1+0|11=2+0]
    -u 0061,007A --features=ss10                        [2=0+500]
    -u 0066,0069                                        [9=0+550]
    -u 0066,0069,0069                                   [9=0+550|5=2+250]
    TestMarkAttachment-MalformedOffsets.ttf
    -u 0061,0301                                        [2=0+500|10=1+0]
    -u 0062,0301                                        [3=0+500|10=1@-240,200+0]
    -u 0061,0323                                        [2=0+500|12=1@-300,30+0]
    -u 0066,0069,0301                                   [9=0+550|10=2@-130,700+0]
    TestMarkAttachment-MalformedGDEF.ttf
    -u 0061,0301 --features=ss14,-mark                  [2=0+500|10=1+0]
    -u 0061,0301,0301 --features=ss02,-mkmk             [2=0+500|10=1@-250,20+0|10=2@-250,20+0]
    -u 0061,0323,0301                                   [2=0+500|12=1@-300,30+0|10=2@-250,20+0]
    TestAlternateSubstitution-Malformed.ttf
    -u 0062 --features=salt                             [6=0+500]
    -u 0063 --features=cv01                             [9=0+500]
    -u 0062 --features=cv02=2                           [8=0+500]
    -u 006E --features=ss03                             [56=0+500]
    -u 0061 --features=aalt                             [3=0+500]
    -u 0066,0067 --features=ss02                        [20=0+500|23=1+500]
    -u 0644,0635,0635,0637 --features=fina              [75=3+500|73=2+500|73=1+500|65=0+500]
    TestContextualPositioning-Malformed.ttf
    -u 0061,0062 --features=ss01                        [5=0+500|6=1+500]
    -u 0061,0063 --features=ss02                        [5=0+500|7=1+500]
    -u 0041,0056 --features=ss03                        [2=0+600|4=1+600]
    -u 0054,0061,0062,0078 --features=ss04              [3=0+600|5=1+500|6=2+500|13=3+500]
    -u 0054,0061,0062 --features=ss05                   [3=0+600|5=1+500|6=2+500]
    -u 0041,0061,0062,0078 --features=ss06              [2=0+600|5=1+500|6=2+500|13=3+500]
    -u 0054,006F,0078 --features=ss07                   [3=0+600|12=1+500|13=2+500]
    -u 0054,0301,006F --features=ss18                   [3=0+600|14=1+0|12=2+500]
    -u 0065,0301 --features=ss12                        [9=0+500|14=1@-150,20+0]
    -u 0066,0069,0301 --features=ss12                   [17=0+600|14=2+0]
    TestPairPositioning-Malformed.ttf
    -u 0054,0061 --variations=wght=900                  [3=0@30,40+480|5=1@-10,20+488]
    TestPairPositioning-MalformedOffsets.ttf
    -u 0062,0063                                        [6=0+500|7=1+500]
    -u 0063,0064                                        [7=0+460|8=1+500]
    TestSingleAdjustment-Malformed.ttf
    -u 004F --features=halt --variations=wght=900       [6=0@30,40+580]

usage: generate-malformed-layout-fonts.py <test fonts directory>
"""
import argparse
import os
import struct

from fontTools.ttLib import woff2

# the offset of the lookup list offset in a GPOS or GSUB header
LOOKUP_LIST_OFFSET_FIELD = 8
# the fields of a lookup table before its subtable offsets: lookupType, lookupFlag, subTableCount
LOOKUP_HEADER_SIZE = 6
# the fields of the mark attachment subtables (types 4, 5 and 6), after their posFormat
MARK_ATTACHMENT_MARK_ARRAY_FIELD = 8
MARK_ATTACHMENT_SECOND_ARRAY_FIELD = 10
COVERAGE_FIELD = 2
# the first Sequence, AlternateSet or LigatureSet offset of a multiple, alternate or ligature substitution subtable
FIRST_SET_FIELD = 6
# the first Ligature offset of a LigatureSet, and the first rule offset of a rule set, after their count
FIRST_SET_ITEM_FIELD = 2
# the first PairSet offset of a pair adjustment subtable of format 1: posFormat, coverage, valueFormat1, valueFormat2,
# pairSetCount, pairSetOffsets
FIRST_PAIR_SET_FIELD = 10
# the extensionLookupType of an extension subtable, after its format
EXTENSION_LOOKUP_TYPE_FIELD = 2
# the fields of a GDEF header of version 1.2 or 1.3: version, GlyphClassDef, AttachList, LigCaretList,
# MarkAttachClassDef and MarkGlyphSetsDef offsets
GDEF_ATTACH_LIST_FIELD = 6
GDEF_LIG_CARET_LIST_FIELD = 8
GDEF_MARK_GLYPH_SETS_FIELD = 12
# a 16-bit offset past the end of the GPOS tables of the source fonts, which are shorter than 0xFFF0 bytes
OFFSET_PAST_TABLE_END = 0xFFF0


def get_uint16(data, offset):
    return struct.unpack_from(">H", data, offset)[0]


def set_uint16(data, offset, value, expected_value=None):
    if expected_value is not None:
        assert get_uint16(data, offset) == expected_value, (offset, get_uint16(data, offset), expected_value)
    struct.pack_into(">H", data, offset, value)


def get_table_range(data, tag):
    table_count = get_uint16(data, 4)
    for i in range(table_count):
        record = 12 + 16 * i
        if data[record:record + 4] == tag.encode("ascii"):
            offset, length = struct.unpack_from(">II", data, record + 8)
            return offset, length
    raise ValueError(f"no {tag} table")


class LayoutTable:
    """The lookups of a GPOS or GSUB table of a font file, by their absolute offsets in the file."""

    def __init__(self, data, tag):
        self.data = data
        self.offset, self.length = get_table_range(data, tag)
        self.lookup_list = self.offset + get_uint16(data, self.offset + LOOKUP_LIST_OFFSET_FIELD)

    def get_lookup(self, lookup_index):
        return self.lookup_list + get_uint16(self.data, self.lookup_list + 2 + 2 * lookup_index)

    def get_lookup_type(self, lookup_index):
        return get_uint16(self.data, self.get_lookup(lookup_index))

    def get_subtable_offset_field(self, lookup_index, subtable_index):
        return self.get_lookup(lookup_index) + LOOKUP_HEADER_SIZE + 2 * subtable_index

    def get_subtable(self, lookup_index, subtable_index=0):
        lookup = self.get_lookup(lookup_index)
        return lookup + get_uint16(self.data, self.get_subtable_offset_field(lookup_index, subtable_index))

    def get_subtable_field_table(self, lookup_index, field):
        subtable = self.get_subtable(lookup_index)
        return subtable + get_uint16(self.data, subtable + field)

    def check_past_table_end(self, start, offset):
        assert start + offset > self.offset + self.length, (start, offset)


def set_subtable_format(layout_table, lookup_index, lookup_type, expected_format, value):
    assert layout_table.get_lookup_type(lookup_index) == lookup_type, lookup_index
    set_uint16(layout_table.data, layout_table.get_subtable(lookup_index), value, expected_format)


def set_subtable_field(layout_table, lookup_index, lookup_type, field, value):
    assert layout_table.get_lookup_type(lookup_index) == lookup_type, lookup_index
    subtable = layout_table.get_subtable(lookup_index)
    assert get_uint16(layout_table.data, subtable + field) != 0, (lookup_index, field)
    set_uint16(layout_table.data, subtable + field, value)


def get_base_anchor_field(layout_table, lookup_index, base_index, mark_class):
    """The field of the anchor offset of a base glyph for a mark class in the BaseArray of a mark-to-base subtable, and
    the BaseArray, which the offset is relative to"""
    data = layout_table.data
    base_array = layout_table.get_subtable_field_table(lookup_index, MARK_ATTACHMENT_SECOND_ARRAY_FIELD)
    class_count = get_uint16(data, layout_table.get_subtable(lookup_index) + 6)
    return base_array + 2 + 2 * (base_index * class_count + mark_class), base_array


def get_base_anchor(layout_table, lookup_index, base_index, mark_class):
    """The offset of the anchor of a base glyph for a mark class in the BaseArray of a mark-to-base subtable"""
    anchor_field, base_array = get_base_anchor_field(layout_table, lookup_index, base_index, mark_class)
    return base_array + get_uint16(layout_table.data, anchor_field)


def get_set_item_field(layout_table, set_offset, item_index, item_count):
    """The field of the offset of an item of a LigatureSet or of a rule set (a Ligature or a rule)"""
    assert get_uint16(layout_table.data, set_offset) == item_count, set_offset
    return set_offset + FIRST_SET_ITEM_FIELD + 2 * item_index


def get_entry_anchor(layout_table, lookup_index, record_index):
    """The offset of the entry anchor of an EntryExitRecord of a cursive subtable"""
    cursive = layout_table.get_subtable(lookup_index)
    return cursive + get_uint16(layout_table.data, cursive + 6 + 4 * record_index)


def patch_mark_attachment(data):
    gpos = LayoutTable(data, "GPOS")
    # the mark-to-base subtable of the lookups 4, 15, 16 and 19, and the mark-to-mark subtable of the lookups 2, 3, 12,
    # 14 and 18, which fontTools shares
    assert gpos.get_subtable(15) == gpos.get_subtable(4) == gpos.get_subtable(16) == gpos.get_subtable(19)
    set_subtable_format(gpos, 15, 4, 1, 2)
    assert gpos.get_subtable(3) == gpos.get_subtable(2) == gpos.get_subtable(12) == gpos.get_subtable(14)
    set_subtable_format(gpos, 3, 6, 1, 2)
    set_subtable_format(gpos, 17, 5, 1, 2)
    set_subtable_format(gpos, 11, 3, 1, 2)
    # the anchor of i for @TOP: base records of a, b, i, beh and ocyr, mark classes @TOP, @BOTTOM and @ARABIC_TOP
    assert gpos.get_lookup_type(0) == 4
    set_uint16(data, get_base_anchor(gpos, 0, 2, 0), 4, 2)
    # the entry anchor of z, the third EntryExitRecord (x, y, z) of CURSIVE_LEFT_TO_RIGHT
    assert gpos.get_lookup_type(6) == 3
    z_entry_anchor = get_entry_anchor(gpos, 6, 2)
    assert get_uint16(data, z_entry_anchor) == 3
    gpos.check_past_table_end(z_entry_anchor, OFFSET_PAST_TABLE_END)
    set_uint16(data, z_entry_anchor + 6, OFFSET_PAST_TABLE_END)
    # SINGLE_BEH (ss09): a lookup type GPOS has not
    set_lookup_type(gpos, 7, 1, 10)
    gsub = LayoutTable(data, "GSUB")
    assert gsub.get_lookup_type(1) == 4
    set_uint16(data, gsub.get_subtable_field_table(1, COVERAGE_FIELD), 3, 1)
    set_subtable_format(gsub, 6, 4, 1, 2)


def patch_mark_attachment_null_offsets(data):
    gpos = LayoutTable(data, "GPOS")
    set_subtable_field(gpos, 15, 4, MARK_ATTACHMENT_MARK_ARRAY_FIELD, 0)
    set_subtable_field(gpos, 0, 4, MARK_ATTACHMENT_SECOND_ARRAY_FIELD, 0)
    set_subtable_field(gpos, 1, 5, MARK_ATTACHMENT_SECOND_ARRAY_FIELD, 0)
    set_subtable_field(gpos, 17, 5, MARK_ATTACHMENT_MARK_ARRAY_FIELD, 0)
    set_subtable_field(gpos, 3, 6, MARK_ATTACHMENT_SECOND_ARRAY_FIELD, 0)
    assert gpos.get_lookup_type(5) == 3
    set_uint16(data, gpos.get_subtable_offset_field(5, 0), 0)
    gsub = LayoutTable(data, "GSUB")
    set_subtable_field(gsub, 5, 4, COVERAGE_FIELD, 0)
    # LigatureSubst format 1: substFormat, coverage, ligatureSetCount, ligatureSetOffsets
    assert get_uint16(data, gsub.get_subtable(6) + 4) == 1
    set_subtable_field(gsub, 6, 4, FIRST_SET_FIELD, 0)
    # MultipleSubst format 1: substFormat, coverage, sequenceCount, sequenceOffsets; z is the only glyph of MULTIPLE_Z
    assert get_uint16(data, gsub.get_subtable(2) + 4) == 1
    set_subtable_field(gsub, 2, 2, FIRST_SET_FIELD, 0)
    # LIGA_F_I: f is the only glyph of its coverage, its LigatureSet has the ligatures f i i and f i
    assert gsub.get_lookup_type(0) == 4 and get_uint16(data, gsub.get_subtable(0) + 4) == 1
    f_ligature_set = gsub.get_subtable_field_table(0, FIRST_SET_FIELD)
    first_ligature_field = get_set_item_field(gsub, f_ligature_set, 0, 2)
    # Ligature: ligatureGlyph, componentCount
    assert get_uint16(data, f_ligature_set + get_uint16(data, first_ligature_field) + 2) == 3
    set_uint16(data, first_ligature_field, 0)


def patch_mark_attachment_offsets(data):
    gpos = LayoutTable(data, "GPOS")
    # MARK_TO_BASE: base records of a, b, i, beh and ocyr, mark classes @TOP, @BOTTOM and @ARABIC_TOP
    assert gpos.get_lookup_type(0) == 4
    anchor_field, base_array = get_base_anchor_field(gpos, 0, 0, 0)
    gpos.check_past_table_end(base_array, OFFSET_PAST_TABLE_END)
    set_uint16(data, anchor_field, OFFSET_PAST_TABLE_END)
    # MARK_TO_LIGATURE, a subtable of no other lookup
    assert gpos.get_lookup_type(1) == 5
    assert gpos.get_subtable(1) not in [gpos.get_subtable(lookup_index) for lookup_index in range(2, 21)]
    gpos.check_past_table_end(gpos.get_subtable(1), OFFSET_PAST_TABLE_END)
    set_subtable_field(gpos, 1, 5, MARK_ATTACHMENT_MARK_ARRAY_FIELD, OFFSET_PAST_TABLE_END)


def set_lookup_type(layout_table, lookup_index, lookup_type, value):
    set_uint16(layout_table.data, layout_table.get_lookup(lookup_index), value, lookup_type)


def set_context_coverages_glyph_count_zero(layout_table, lookup_index, lookup_type, glyph_count):
    """Set the glyphCount of a sequence context subtable of format 3 (GSUB type 5, GPOS type 7) to 0"""
    # format, glyphCount
    set_subtable_format(layout_table, lookup_index, lookup_type, 3, 3)
    set_uint16(layout_table.data, layout_table.get_subtable(lookup_index) + 2, 0, glyph_count)


def set_chained_context_coverages_input_count_zero(layout_table, lookup_index, lookup_type, input_glyph_count):
    """Set the inputGlyphCount of a chained sequence context subtable of format 3 (GSUB type 6, GPOS type 8) to 0, so
    that its lookahead count is read from its first input coverage offset"""
    # format, backtrackGlyphCount, its coverage offsets, inputGlyphCount
    set_subtable_format(layout_table, lookup_index, lookup_type, 3, 3)
    chain_coverages = layout_table.get_subtable(lookup_index)
    backtrack_count = get_uint16(layout_table.data, chain_coverages + 2)
    set_uint16(layout_table.data, chain_coverages + 4 + 2 * backtrack_count, 0, input_glyph_count)


def patch_contextual_positioning(data):
    gpos = LayoutTable(data, "GPOS")
    for lookup_index, lookup_type in [(9, 7), (10, 7), (12, 8), (13, 8)]:
        set_subtable_field(gpos, lookup_index, lookup_type, COVERAGE_FIELD, 0)
    set_context_coverages_glyph_count_zero(gpos, 11, 7, 2)
    set_chained_context_coverages_input_count_zero(gpos, 14, 8, 2)
    set_subtable_format(gpos, 29, 7, 3, 4)
    set_subtable_format(gpos, 15, 8, 1, 4)
    # CONTEXT_MARKS: ChainedSequenceContext format 1 (format, coverage, chainedSeqRuleSetCount, chainedSeqRuleSetOffsets);
    # acutecomb is the only glyph of its coverage, its rule set has the rules e acutecomb', f_i acutecomb' and
    # acutecomb acutecomb'
    assert gpos.get_lookup_type(20) == 8 and get_uint16(data, gpos.get_subtable(20) + 4) == 1
    acute_rule_set = gpos.get_subtable_field_table(20, FIRST_SET_FIELD)
    set_uint16(data, get_set_item_field(gpos, acute_rule_set, 1, 3), 0)


def patch_value_record_device(layout_table, value_record_start, value_format, device_field_bit):
    """Set the offset of a device of a value record past the end of the table"""
    field_index = bin(value_format & (device_field_bit - 1)).count("1")
    device_field = value_record_start + 2 * field_index
    assert get_uint16(layout_table.data, device_field) != 0
    set_uint16(layout_table.data, device_field, OFFSET_PAST_TABLE_END)


# the XAdvDevice bit of a value format
X_ADVANCE_DEVICE = 0x0040


def patch_pair_positioning(data):
    gpos = LayoutTable(data, "GPOS")
    # PairPos format 1: posFormat, coverage, valueFormat1, valueFormat2, pairSetCount, pairSetOffsets
    set_subtable_format(gpos, 3, 2, 1, 1)
    pair_positioning = gpos.get_subtable(3)
    value_format = get_uint16(data, pair_positioning + 4)
    assert value_format & X_ADVANCE_DEVICE
    pair_set = pair_positioning + get_uint16(data, pair_positioning + 10)
    assert get_uint16(data, pair_set) == 1
    # the device offsets of a PairValueRecord are relative to its PairSet table
    gpos.check_past_table_end(pair_set, OFFSET_PAST_TABLE_END)
    # pairValueCount, then secondGlyph and the first value record
    patch_value_record_device(gpos, pair_set + 4, value_format, X_ADVANCE_DEVICE)


def patch_pair_positioning_offsets(data):
    gpos = LayoutTable(data, "GPOS")
    # the first subtable of PAIR_SECOND_GLYPH, of b c and c d
    assert gpos.get_lookup_type(1) == 2
    set_subtable_format(gpos, 1, 2, 1, 1)
    pair_positioning = gpos.get_subtable(1)
    assert get_uint16(data, pair_positioning + FIRST_PAIR_SET_FIELD - 2) == 2
    gpos.check_past_table_end(pair_positioning, OFFSET_PAST_TABLE_END)
    set_uint16(data, pair_positioning + FIRST_PAIR_SET_FIELD, OFFSET_PAST_TABLE_END)


def patch_single_adjustment(data):
    gpos = LayoutTable(data, "GPOS")
    # SinglePos format 1: posFormat, coverage, valueFormat, valueRecord; the first subtable is the one of O
    set_subtable_format(gpos, 3, 1, 1, 1)
    single_positioning = gpos.get_subtable(3)
    value_format = get_uint16(data, single_positioning + 4)
    assert value_format & X_ADVANCE_DEVICE
    gpos.check_past_table_end(single_positioning, OFFSET_PAST_TABLE_END)
    patch_value_record_device(gpos, single_positioning + 6, value_format, X_ADVANCE_DEVICE)


def patch_mark_attachment_gdef(data):
    gdef, gdef_length = get_table_range(data, "GDEF")
    assert get_uint16(data, gdef) == 1 and get_uint16(data, gdef + 2) == 3
    for field in [GDEF_ATTACH_LIST_FIELD, GDEF_LIG_CARET_LIST_FIELD]:
        assert gdef + OFFSET_PAST_TABLE_END > gdef + gdef_length
        set_uint16(data, gdef + field, OFFSET_PAST_TABLE_END, 0)
    # MarkGlyphSetsDef: format, markGlyphSetCount, 32-bit coverage offsets
    mark_glyph_sets = gdef + get_uint16(data, gdef + GDEF_MARK_GLYPH_SETS_FIELD)
    assert get_uint16(data, mark_glyph_sets + 2) == 1
    coverage = mark_glyph_sets + struct.unpack_from(">I", data, mark_glyph_sets + 4)[0]
    set_uint16(data, coverage, 3, 1)


def patch_alternate_substitution(data):
    gsub = LayoutTable(data, "GSUB")
    set_lookup_type(gsub, 3, 3, 9)
    # the extension subtable of C_ALTERNATES (cv01)
    assert gsub.get_lookup_type(4) == 7
    set_uint16(data, gsub.get_subtable(4) + EXTENSION_LOOKUP_TYPE_FIELD, 9, 3)
    # the first of the two subtables of the cv02 lookup, which no other lookup shares
    assert gsub.get_subtable(5, 0) not in [gsub.get_subtable(lookup_index) for lookup_index in range(25) if lookup_index != 5]
    set_subtable_format(gsub, 5, 3, 1, 2)
    # AlternateSubst format 1: substFormat, coverage, alternateSetCount, alternateSetOffsets; n is the only glyph of the
    # lookup of ss03 and ss04
    assert get_uint16(data, gsub.get_subtable(17) + 4) == 1
    set_subtable_field(gsub, 17, 3, FIRST_SET_FIELD, 0)
    set_chained_context_coverages_input_count_zero(gsub, 8, 6, 1)
    set_context_coverages_glyph_count_zero(gsub, 24, 5, 3)


# the fonts written that are compressed into a WOFF2 font too
WOFF2_FONTS = ["TestMarkAttachment-Malformed.ttf"]

# the source font, the font written and its patch
PATCHES = [
    ("TestMarkAttachment.ttf", "TestMarkAttachment-Malformed.ttf", patch_mark_attachment),
    ("TestMarkAttachment.ttf", "TestMarkAttachment-NullOffsets.ttf", patch_mark_attachment_null_offsets),
    ("TestMarkAttachment.ttf", "TestMarkAttachment-MalformedOffsets.ttf", patch_mark_attachment_offsets),
    ("TestMarkAttachment.ttf", "TestMarkAttachment-MalformedGDEF.ttf", patch_mark_attachment_gdef),
    ("TestAlternateSubstitution.ttf", "TestAlternateSubstitution-Malformed.ttf", patch_alternate_substitution),
    ("TestContextualPositioning.ttf", "TestContextualPositioning-Malformed.ttf", patch_contextual_positioning),
    ("TestPairPositioning.ttf", "TestPairPositioning-Malformed.ttf", patch_pair_positioning),
    ("TestPairPositioning.ttf", "TestPairPositioning-MalformedOffsets.ttf", patch_pair_positioning_offsets),
    ("TestSingleAdjustment.ttf", "TestSingleAdjustment-Malformed.ttf", patch_single_adjustment),
]


def main():
    parser = argparse.ArgumentParser(description="Build the test fonts of malformed GPOS and GSUB subtables.")
    parser.add_argument("fonts_directory", help="directory of the source fonts and of the fonts to write")
    arguments = parser.parse_args()
    for source_name, output_name, patch in PATCHES:
        with open(os.path.join(arguments.fonts_directory, source_name), "rb") as source_file:
            data = bytearray(source_file.read())
        patch(data)
        output_path = os.path.join(arguments.fonts_directory, output_name)
        with open(output_path, "wb") as output_file:
            output_file.write(data)
        print(f"{output_name}: written")
        if output_name in WOFF2_FONTS:
            woff2_path = os.path.splitext(output_path)[0] + ".woff2"
            woff2.compress(output_path, woff2_path)
            print(f"{os.path.basename(woff2_path)}: written")


if __name__ == "__main__":
    main()
