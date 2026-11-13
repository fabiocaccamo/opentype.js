"""Build a synthetic variable TrueType test font for the GPOS single adjustments (lookup type 1) of Font.shape.

Axis: wght 100..100..900 (the default is the minimum), a gvar table without glyph variations: only the GPOS values
vary, through the item variation store of GDEF. Glyphs of 500 units but space (250), A, H, O and V (600), acutecomb
and gravecomb (0, GDEF marks, acutecomb in the mark attachment class 1 and gravecomb in the mark filtering set 0).
Language systems DFLT, latn and hebr, with the same features.

GPOS lookups, in the order of the lookup list:
- 0 SINGLE_ALL_FIELDS (case): pos H <10 20 -30 40>; the four fields of a value record (format 1), the y advance for
  vertical text only;
- 1 SINGLE_VALUE_RECORDS (cpsp): pos A <5 0 10 0>; pos B <-10 0 20 0>; pos C <15 0 30 0>; pos H <-20 0 15 0>; one value
  record by glyph (format 2), then a second subtable pos C <0 0 99 0>; that the first one hides;
- 2 SINGLE_IGNORE_MARKS (palt, IgnoreMarks): pos [a acutecomb] <-20 0 -50 0>; the acute is covered but ignored;
- 3 SINGLE_VARIABLE (halt): pos O and pos o with variable values (VariationIndex devices) in every field (a format 1
  subtable each);
- 4 SINGLE_VERTICAL (vpal): pos V <0 50 0 -100>; a y placement and a y advance;
- 5 SINGLE_EXTENSION (kern, extension lookup): pos b <0 0 -15 0>;
- 6 SINGLE_FIRST_SUBTABLE (kern): pos c <0 0 -10 0>; then a second subtable pos [c d] <0 0 -40 0>;: the first subtable
  that covers a glyph applies;
- 7 SINGLE_RIGHT_TO_LEFT (kern): pos alef <10 0 -20 0>; pos bet <-5 0 30 0>; one value record by Hebrew letter (format
  2), for a right-to-left run;
- 8 SINGLE_VARIABLE_VALUE_RECORDS (lfbd): pos A and pos B with variable values (VariationIndex devices) in the x
  placement and the x advance, one value record by glyph (format 2, merged from the format 1 subtables of feaLib);
- 9 SINGLE_MARK_FILTERING_SET (ss01, UseMarkFilteringSet [gravecomb]): pos [acutecomb gravecomb] <0 10 0 0>; the acute
  is covered but ignored;
- 10 SINGLE_MARK_ATTACHMENT_TYPE (ss01, MarkAttachmentType [acutecomb]): pos [acutecomb gravecomb] <0 20 0 0>; the
  grave is covered but ignored.

usage: generate-single-adjustment-font.py <output.ttf>
"""
import argparse

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.otlLib.builder import buildSinglePosSubtable, buildValue
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Single Adjustment"

# glyph name, codepoint, advance width, contours (lists of points)
GLYPHS = [
    (".notdef", None, 500, [[(100, 0), (100, 700), (400, 700), (400, 0)]]),
    ("space", 0x0020, 250, []),
    ("A", 0x0041, 600, [[(20, 0), (300, 700), (580, 0)]]),
    ("B", 0x0042, 500, [[(50, 0), (50, 700), (450, 700), (450, 0)]]),
    ("C", 0x0043, 500, [[(50, 0), (50, 700), (450, 700), (450, 600), (150, 600), (150, 100), (450, 100), (450, 0)]]),
    ("H", 0x0048, 600, [[(50, 0), (50, 700), (150, 700), (150, 400), (450, 400), (450, 700), (550, 700), (550, 0)]]),
    ("O", 0x004F, 600, [[(50, 0), (50, 700), (550, 700), (550, 0)]]),
    ("V", 0x0056, 600, [[(20, 700), (580, 700), (300, 0)]]),
    ("a", 0x0061, 500, [[(50, 0), (50, 500), (450, 500), (450, 0)]]),
    ("b", 0x0062, 500, [[(50, 0), (50, 700), (450, 700), (450, 0)]]),
    ("c", 0x0063, 500, [[(50, 0), (50, 500), (450, 500), (450, 400), (150, 400), (150, 100), (450, 100), (450, 0)]]),
    ("d", 0x0064, 500, [[(50, 0), (50, 500), (350, 500), (350, 700), (450, 700), (450, 0)]]),
    ("o", 0x006F, 500, [[(50, 0), (50, 500), (450, 500), (450, 0)]]),
    ("acutecomb", 0x0301, 0, [[(-150, 550), (-100, 700), (-50, 700), (-100, 550)]]),
    ("alef", 0x05D0, 500, [[(50, 0), (450, 700), (450, 600), (150, 0)]]),
    ("bet", 0x05D1, 500, [[(50, 0), (50, 100), (350, 100), (350, 600), (50, 600), (50, 700), (450, 700), (450, 0)]]),
    ("gravecomb", 0x0300, 0, [[(-150, 700), (-100, 700), (-50, 550), (-100, 550)]]),
]

FEATURES = """
languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem hebr dflt;

table GDEF {
    GlyphClassDef [A B C H O V a b c d o alef bet], , [acutecomb gravecomb], ;
} GDEF;

lookup SINGLE_ALL_FIELDS {
    pos H <10 20 -30 40>;
} SINGLE_ALL_FIELDS;

lookup SINGLE_VALUE_RECORDS {
    pos A <5 0 10 0>;
    pos B <-10 0 20 0>;
    pos C <15 0 30 0>;
    pos H <-20 0 15 0>;
} SINGLE_VALUE_RECORDS;

lookup SINGLE_IGNORE_MARKS {
    lookupflag IgnoreMarks;
    pos [a acutecomb] <-20 0 -50 0>;
} SINGLE_IGNORE_MARKS;

lookup SINGLE_VARIABLE {
    pos O <(wght=100:10 wght=900:30) (wght=100:0 wght=900:40) (wght=100:-20 wght=900:-60) (wght=100:5 wght=900:45)>;
    pos o <(wght=100:-10 wght=900:-30) (wght=100:5 wght=900:-15) (wght=100:-10 wght=900:-50) (wght=100:0 wght=900:20)>;
} SINGLE_VARIABLE;

lookup SINGLE_VERTICAL {
    pos V <0 50 0 -100>;
} SINGLE_VERTICAL;

lookup SINGLE_EXTENSION useExtension {
    pos b <0 0 -15 0>;
} SINGLE_EXTENSION;

lookup SINGLE_FIRST_SUBTABLE {
    pos c <0 0 -10 0>;
} SINGLE_FIRST_SUBTABLE;

lookup SINGLE_RIGHT_TO_LEFT {
    pos alef <10 0 -20 0>;
    pos bet <-5 0 30 0>;
} SINGLE_RIGHT_TO_LEFT;

lookup SINGLE_VARIABLE_VALUE_RECORDS {
    pos A <(wght=100:10 wght=900:30) 0 (wght=100:-20 wght=900:-60) 0>;
    pos B <(wght=100:-5 wght=900:-25) 0 (wght=100:10 wght=900:50) 0>;
} SINGLE_VARIABLE_VALUE_RECORDS;

lookup SINGLE_MARK_FILTERING_SET {
    lookupflag UseMarkFilteringSet [gravecomb];
    pos [acutecomb gravecomb] <0 10 0 0>;
} SINGLE_MARK_FILTERING_SET;

lookup SINGLE_MARK_ATTACHMENT_TYPE {
    lookupflag MarkAttachmentType [acutecomb];
    pos [acutecomb gravecomb] <0 20 0 0>;
} SINGLE_MARK_ATTACHMENT_TYPE;

feature case {
    lookup SINGLE_ALL_FIELDS;
} case;

feature cpsp {
    lookup SINGLE_VALUE_RECORDS;
} cpsp;

feature palt {
    lookup SINGLE_IGNORE_MARKS;
} palt;

feature halt {
    lookup SINGLE_VARIABLE;
} halt;

feature vpal {
    lookup SINGLE_VERTICAL;
} vpal;

feature kern {
    lookup SINGLE_EXTENSION;
    lookup SINGLE_FIRST_SUBTABLE;
    lookup SINGLE_RIGHT_TO_LEFT;
} kern;

feature lfbd {
    lookup SINGLE_VARIABLE_VALUE_RECORDS;
} lfbd;

feature ss01 {
    lookup SINGLE_MARK_FILTERING_SET;
    lookup SINGLE_MARK_ATTACHMENT_TYPE;
} ss01;
"""


def draw_glyph(contours):
    pen = TTGlyphPen(None)
    for contour in contours:
        pen.moveTo(contour[0])
        for point in contour[1:]:
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def add_second_subtables(font):
    """Append the second subtables of SINGLE_VALUE_RECORDS and SINGLE_FIRST_SUBTABLE, which feaLib cannot build (no
    subtable break and one position per glyph in a single adjustment lookup)."""
    lookups = font["GPOS"].table.LookupList.Lookup
    glyph_map = font.getReverseGlyphMap()
    second_subtables = {
        1: {"C": buildValue({"XAdvance": 99})},
        6: {"c": buildValue({"XAdvance": -40}), "d": buildValue({"XAdvance": -40})},
    }
    for lookup_index, values in second_subtables.items():
        lookups[lookup_index].SubTable.append(buildSinglePosSubtable(values, glyph_map))
        lookups[lookup_index].SubTableCount = len(lookups[lookup_index].SubTable)


def merge_variable_value_records(font):
    """Merge the format 1 subtables of SINGLE_VARIABLE_VALUE_RECORDS, one by glyph as feaLib builds variable values,
    into one format 2 subtable, its value records keeping their VariationIndex devices."""
    lookup = font["GPOS"].table.LookupList.Lookup[8]
    values = {subtable.Coverage.glyphs[0]: subtable.Value for subtable in lookup.SubTable}
    lookup.SubTable = [buildSinglePosSubtable(values, font.getReverseGlyphMap())]
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
    builder.setupFvar(axes=[("wght", 100, 100, 900, "Weight")], instances=[])
    # a gvar table without variations, the table of the outlines of a variable TrueType font
    builder.setupGvar({})
    addOpenTypeFeaturesFromString(builder.font, FEATURES, tables=["GPOS", "GDEF"])
    add_second_subtables(builder.font)
    merge_variable_value_records(builder.font)
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
    assert lookup_types == [1, 1, 1, 1, 1, 9, 1, 1, 1, 1, 1], lookup_types
    lookup_flags = [lookup.LookupFlag for lookup in lookups]
    # IgnoreMarks, UseMarkFilteringSet, the mark attachment class 1
    assert lookup_flags == [0, 0, 0x0008, 0, 0, 0, 0, 0, 0, 0x0010, 0x0100], lookup_flags
    assert lookups[9].MarkFilteringSet == 0, lookups[9].MarkFilteringSet
    definitions = font["GDEF"].table
    assert definitions.MarkGlyphSetsDef.Coverage[0].glyphs == ["gravecomb"], definitions.MarkGlyphSetsDef.Coverage[0].glyphs
    assert definitions.MarkAttachClassDef.classDefs == {"acutecomb": 1}, definitions.MarkAttachClassDef.classDefs
    formats = [[subtable.Format for subtable in get_subtables(lookup)] for lookup in lookups]
    assert formats == [[1], [2, 1], [1], [1, 1], [1], [1], [1, 1], [2], [2], [1], [1]], formats
    value_formats = [[subtable.ValueFormat for subtable in get_subtables(lookup)] for lookup in lookups]
    assert value_formats == [
        [0x0F], [0x05, 0x04], [0x05], [0xFF, 0xFF], [0x0A], [0x04], [0x04, 0x04], [0x05], [0x55], [0x02], [0x02]
    ], value_formats
    # A B C H, one value record each, in coverage order
    value_records_subtable = get_subtables(lookups[1])[0]
    assert value_records_subtable.Coverage.glyphs == ["A", "B", "C", "H"], value_records_subtable.Coverage.glyphs
    features = [(record.FeatureTag, record.Feature.LookupListIndex) for record in position_table.FeatureList.FeatureRecord]
    assert features == [
        ("case", [0]), ("cpsp", [1]), ("halt", [3]), ("kern", [5, 6, 7]), ("lfbd", [8]), ("palt", [2]), ("ss01", [9, 10]),
        ("vpal", [4])
    ], features
    print(f"{output_path}: GPOS single adjustments of formats 1 and 2, an extension lookup, VariationIndex devices "
          "in every field of O and o and in the value records of A and B, mark filtering set and attachment type, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a variable TrueType test font for the GPOS single adjustments.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
