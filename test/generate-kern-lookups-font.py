"""Build a synthetic TrueType test font whose kern feature has two lookups that adjust the same pairs.

HarfBuzz applies every lookup of a feature, one after the other: a pair that two kern lookups
adjust is moved by the sum of their values. Inside a lookup the first subtable that has the
pair is the only one applied.

The kern feature lists two lookups:
- lookup 0, a Pair Adjustment lookup (type 2): a PairPos format 1 subtable (glyph pairs) and a
  PairPos format 2 subtable (class pairs);
- lookup 1, an Extension lookup (type 9, feaLib 'useExtension') that wraps the same two kinds
  of Pair Adjustment subtable.

Kerning of each pair in (lookup 0, lookup 1), with the format of the subtable that has it:

    A V        (-50 format 1, -20 format 2)       both lookups, sum -70
    T o        (-40 format 2, +15 format 1)       both lookups, sum -25: the format 2 subtable of
                                                  lookup 1 has -35 for the pair too, after the
                                                  format 1 subtable that is the one applied
    T period   (0 format 2 class record, -25 format 1)
    L o        (0 format 2 class record, -35 format 2)
    A T        (-30 format 1, 0 format 2 class record)
    V o        (-40 format 2, V is not covered)   first lookup only
    L period   (-10 format 2, 0 format 2 class record with the class 0 of period)
    o T        (o is not covered, -45 format 2)   second lookup only

"The sum of the lookups" differs on A V and on T o from "the first lookup wins", from "the first
lookup with a value other than 0 wins" and from "the last lookup wins"; these three differ from
each other on T period, L o and A T.

usage: generate-kern-lookups-font.py <output.ttf>
"""
import argparse

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test GPOS Kern Two Lookups"

# glyph name, codepoint, advance width, contours (lists of points)
GLYPHS = [
    (".notdef", None, 500, [[(100, 0), (100, 700), (400, 700), (400, 0)]]),
    ("space", 0x20, 250, []),
    ("A", 0x41, 600, [[(20, 0), (300, 700), (580, 0)]]),
    ("L", 0x4C, 500, [[(80, 0), (80, 700), (180, 700), (180, 100), (460, 100), (460, 0)]]),
    ("T", 0x54, 500, [[(200, 0), (200, 600), (20, 600), (20, 700), (480, 700), (480, 600), (300, 600), (300, 0)]]),
    ("V", 0x56, 600, [[(20, 700), (580, 700), (300, 0)]]),
    ("o", 0x6F, 500, [[(50, 0), (50, 500), (450, 500), (450, 0)]]),
    ("period", 0x2E, 250, [[(75, 0), (75, 100), (175, 100), (175, 0)]]),
]

# in each lookup the glyph pairs make a PairPos format 1 subtable, the class pairs a PairPos format 2 subtable
# that comes after it: T o of kernSecond is an exception (+15) to the class pair [L T] [o] (-35)
FEATURES = """
lookup kernFirst {
    pos A V -50;
    pos A T -30;
    pos [T V] [o] -40;
    pos [L] [period] -10;
} kernFirst;

lookup kernSecond useExtension {
    pos T o 15;
    pos T period -25;
    pos [A] [V] -20;
    pos [L T] [o] -35;
    pos [o] [T] -45;
} kernSecond;

feature kern {
    lookup kernFirst;
    lookup kernSecond;
} kern;
"""

# glyph pair: (value in lookup 0, value in lookup 1), None when no subtable of the lookup has the pair
EXPECTED_KERNING = {
    ("A", "V"): (-50, -20),
    ("T", "o"): (-40, 15),
    ("T", "period"): (0, -25),
    ("L", "o"): (0, -35),
    ("A", "T"): (-30, 0),
    ("V", "o"): (-40, None),
    ("L", "period"): (-10, 0),
    ("o", "T"): (None, -45),
}


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
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def get_pair_adjustment_subtables(lookup):
    """The Pair Adjustment subtables of a lookup of type 2, or of type 9 wrapping the type 2."""
    if lookup.LookupType == 9:
        assert all(subtable.ExtensionLookupType == 2 for subtable in lookup.SubTable)
        return [subtable.ExtSubTable for subtable in lookup.SubTable]
    assert lookup.LookupType == 2, lookup.LookupType
    return lookup.SubTable


def get_subtable_kerning(subtable, left_glyph_name, right_glyph_name):
    """The x advance adjustment of the pair in a Pair Adjustment subtable, None when it has not the pair."""
    if left_glyph_name not in subtable.Coverage.glyphs:
        return None
    if subtable.Format == 1:
        pair_set = subtable.PairSet[subtable.Coverage.glyphs.index(left_glyph_name)]
        for pair_value_record in pair_set.PairValueRecord:
            if pair_value_record.SecondGlyph == right_glyph_name:
                return pair_value_record.Value1.XAdvance
        return None
    left_class = subtable.ClassDef1.classDefs.get(left_glyph_name, 0)
    right_class = subtable.ClassDef2.classDefs.get(right_glyph_name, 0)
    return subtable.Class1Record[left_class].Class2Record[right_class].Value1.XAdvance


def get_lookup_kerning(lookup, left_glyph_name, right_glyph_name):
    """The x advance adjustment of the first subtable that has the pair, None when none has it."""
    for subtable in get_pair_adjustment_subtables(lookup):
        kerning = get_subtable_kerning(subtable, left_glyph_name, right_glyph_name)
        if kerning is not None:
            return kerning
    return None


def verify_font(output_path):
    font = TTFont(output_path)
    position_table = font["GPOS"].table
    features = position_table.FeatureList.FeatureRecord
    assert [(feature.FeatureTag, feature.Feature.LookupListIndex) for feature in features] == [("kern", [0, 1])]
    lookups = position_table.LookupList.Lookup
    assert [lookup.LookupType for lookup in lookups] == [2, 9], [lookup.LookupType for lookup in lookups]
    for lookup in lookups:
        formats = [subtable.Format for subtable in get_pair_adjustment_subtables(lookup)]
        assert formats == [1, 2], formats
    for (left_glyph_name, right_glyph_name), expected_values in EXPECTED_KERNING.items():
        values = tuple(get_lookup_kerning(lookup, left_glyph_name, right_glyph_name) for lookup in lookups)
        assert values == expected_values, (left_glyph_name, right_glyph_name, values)
    # the class pair that the glyph pair T o of lookup 1 is an exception to
    class_pairs_subtable = get_pair_adjustment_subtables(lookups[1])[1]
    assert get_subtable_kerning(class_pairs_subtable, "T", "o") == -35
    print(f"{output_path}: kern lookups of types [2, 9], PairPos formats [1, 2] in each, {len(EXPECTED_KERNING)} pairs, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a TrueType test font whose kern feature has two lookups.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
