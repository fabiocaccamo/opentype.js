"""Build a synthetic TrueType test font whose GSUB features have alternate substitutions (lookup type 3).

The language systems: DFLT, latn, arab and hebr, each one with every feature. Each glyph is 500 units wide.

GSUB (lookup indexes in the order of the lookup list):
- ccmp: sub beh by beh.ccmp; sub seen by seen.ccmp;, lookup 0, before the lookups of the direction features and of
  rand in the lookup list: the Arabic shaper of HarfBuzz applies the direction features and rand in a stage before
  the one of ccmp, so beh becomes beh.rtla and seen a random alternate of rand in an Arabic text and the ccmp of beh
  and of seen no longer matches; the default shaper applies them together, in lookup list order, so beh becomes
  beh.ccmp and seen becomes seen.ccmp in a text shaped as Latin;
- aalt (built by feaLib): sub g by g.alt; (a single substitution, lookup type 1) and sub a from [a.alt1 a.alt2
  a.alt3]; (lookup type 3): any value of aalt applies the single substitution, its value is the index of the
  alternate of a (1 for the first one), an index past the 3 alternates leaves a unchanged;
- salt: sub b from [b.alt1 b.alt2];
- cv01: sub c from [c.alt1 c.alt2 c.alt3];, in an extension lookup (lookup type 7);
- cv02: one lookup with two subtables (the second one added after feaLib, which allows one AlternateSet per glyph
  and lookup): sub b from [b.alt1];, then sub b from [b.alt1 b.alt2];: like HarfBuzz, the value 2 of cv02 chooses no
  alternate in the first subtable, which leaves b to the second one;
- rand: sub d from [d.alt1 d.alt2 d.alt3]; sub e from [e.alt1 e.alt2]; sub seen from [seen.rand1 seen.rand2
  seen.rand3];, in one lookup: HarfBuzz enables rand by default with its maximum value, which takes a random
  alternate of d, e or seen from the random state of the buffer;
- ss02: sub f' lookup F_ALTERNATES g;, a chained contextual rule whose nested lookup is the alternate substitution
  sub f from [f.alt1 f.alt2];, at the alternate of the value of ss02;
- ltra: sub h by h.ltra; sub beh by beh.ltra; sub hebbet by hebbet.ltra; sub one by one.ltra;, ltrm: sub i by
  i.ltrm;, then rtla: sub h by h.rtla; sub beh by beh.rtla; sub hebbet by hebbet.rtla; sub one by one.rtla;, rtlm:
  sub alef by alef.rtlm;: HarfBuzz enables ltra and ltrm in the runs of a left-to-right script (h becomes h.ltra),
  rtla and rtlm in the runs of a right-to-left script, Arabic or Hebrew (beh becomes beh.rtla, before the ltra lookup
  that covers it; hebbet becomes hebbet.rtla; a digit in such a run becomes one.rtla);
- fina: sub teh from [teh.fina1 teh.fina2 teh.fina3];: HarfBuzz adds the mask of the form (the value 1) to the value
  of fina at a final teh, so fina=2 gives teh.fina3 there, and teh.fina2 at the other teh (the features of the user
  of HarfBuzz apply at every glyph);
- rand, a second lookup: sub k' lookup K_ALTERNATES l;, and calt: sub k' lookup K_ALTERNATES m;, whose nested lookup
  is the alternate substitution sub k from [k.alt1 k.alt2 k.alt3];: a random alternate of k before l (the value 255
  of rand), its first alternate before m (the value 1 of calt);
- ss03 and ss04: the same lookup, sub n from [n.alt1 n.alt2 n.alt3];;
- rtlm, a second lookup, after the lookups of the other features above: sub jeem from [jeem.rtlm1 jeem.rtlm2
  jeem.rtlm3];: HarfBuzz adds the mask of rtlm (the value 1) to the value of rtlm at the glyphs it does not mirror in
  a run of a right-to-left script, so rtlm=2 gives jeem.rtlm3 in an Arabic text, jeem.rtlm2 in a text shaped as Latin;
- fina, a second lookup: sub lam' theh' lookup THEH_ALTERNATES; sub theh' space' lam' lookup LAM_ALTERNATES;,
  contextual rules (lookup type 5) whose nested lookups are the alternate substitutions sub theh from [theh.alt1
  theh.alt2 theh.alt3]; and sub lam from [lam.alt1 lam.alt2 lam.alt3];: HarfBuzz takes the alternate of the value of
  fina at the glyph a nested lookup applies at, so fina=2 gives theh.alt3 at a final theh after an initial lam (the
  rule starts at the lam, where fina is 2), and lam.alt2 at an isolated lam after a final theh and a space;
- fina, a third lookup, the last one of the lookup list: sub sad' lookup SAD_LIGATURE sad' tah' lookup TAH_ALTERNATES;,
  a contextual rule (lookup type 5) whose nested lookups are the ligature substitution sub sad sad by sad_sad; and the
  alternate substitution sub tah from [tah.alt1 tah.alt2 tah.alt3];, the second one at the sequence index 1 (set after
  feaLib, which gives the index 2 of the tah in the rule), the index of the tah in the input sequence the ligature
  leaves: HarfBuzz takes the alternate of the value of fina at the glyph the tah comes from, so fina=2 gives tah.alt3
  at a final tah after an initial and a medial sad, not the alternate of the value 2 of the medial sad the ligature
  deletes.

GPOS: ltra: pos [one one.ltra one.rtla hebbet hebbet.ltra hebbet.rtla] <0 0 100 0>;, rtla: the same glyphs <0 0 -100
0>;: the direction features of GPOS, the same ones as in GSUB.

usage: generate-alternate-substitution-font.py <output.ttf>
"""
import argparse

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test GSUB Alternate Substitution"

# glyph name, codepoint
GLYPHS = [
    (".notdef", None),
    ("space", 0x20),
    ("a", 0x61),
    ("a.alt1", None),
    ("a.alt2", None),
    ("a.alt3", None),
    ("b", 0x62),
    ("b.alt1", None),
    ("b.alt2", None),
    ("c", 0x63),
    ("c.alt1", None),
    ("c.alt2", None),
    ("c.alt3", None),
    ("d", 0x64),
    ("d.alt1", None),
    ("d.alt2", None),
    ("d.alt3", None),
    ("e", 0x65),
    ("e.alt1", None),
    ("e.alt2", None),
    ("f", 0x66),
    ("f.alt1", None),
    ("f.alt2", None),
    ("g", 0x67),
    ("g.alt", None),
    ("h", 0x68),
    ("h.ltra", None),
    ("h.rtla", None),
    ("i", 0x69),
    ("i.ltrm", None),
    ("alef", 0x0627),
    ("alef.rtlm", None),
    ("beh", 0x0628),
    ("beh.ccmp", None),
    ("beh.ltra", None),
    ("beh.rtla", None),
    ("hebbet", 0x05D1),
    ("hebbet.ltra", None),
    ("hebbet.rtla", None),
    ("one", 0x31),
    ("one.ltra", None),
    ("one.rtla", None),
    ("seen", 0x0633),
    ("seen.rand1", None),
    ("seen.rand2", None),
    ("seen.rand3", None),
    ("teh", 0x062A),
    ("teh.fina1", None),
    ("teh.fina2", None),
    ("teh.fina3", None),
    ("k", 0x6B),
    ("k.alt1", None),
    ("k.alt2", None),
    ("k.alt3", None),
    ("l", 0x6C),
    ("m", 0x6D),
    ("n", 0x6E),
    ("n.alt1", None),
    ("n.alt2", None),
    ("n.alt3", None),
    ("seen.ccmp", None),
    ("jeem", 0x062C),
    ("jeem.rtlm1", None),
    ("jeem.rtlm2", None),
    ("jeem.rtlm3", None),
    ("lam", 0x0644),
    ("lam.alt1", None),
    ("lam.alt2", None),
    ("lam.alt3", None),
    ("theh", 0x062B),
    ("theh.alt1", None),
    ("theh.alt2", None),
    ("theh.alt3", None),
    ("sad", 0x0635),
    ("sad_sad", None),
    ("tah", 0x0637),
    ("tah.alt1", None),
    ("tah.alt2", None),
    ("tah.alt3", None),
]

ADVANCE_WIDTH = 500

FEATURES = """
languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem arab dflt;
languagesystem hebr dflt;

lookup BEH_SEEN_CCMP {
    sub beh by beh.ccmp;
    sub seen by seen.ccmp;
} BEH_SEEN_CCMP;

feature ccmp {
    lookup BEH_SEEN_CCMP;
} ccmp;

feature aalt {
    sub g by g.alt;
    sub a from [a.alt1 a.alt2 a.alt3];
} aalt;

feature salt {
    sub b from [b.alt1 b.alt2];
} salt;

lookup C_ALTERNATES useExtension {
    sub c from [c.alt1 c.alt2 c.alt3];
} C_ALTERNATES;

feature cv01 {
    lookup C_ALTERNATES;
} cv01;

feature cv02 {
    sub b from [b.alt1];
} cv02;

feature rand {
    sub d from [d.alt1 d.alt2 d.alt3];
    sub e from [e.alt1 e.alt2];
    sub seen from [seen.rand1 seen.rand2 seen.rand3];
} rand;

lookup F_ALTERNATES {
    sub f from [f.alt1 f.alt2];
} F_ALTERNATES;

feature ss02 {
    sub f' lookup F_ALTERNATES g;
} ss02;

feature ltra {
    sub h by h.ltra;
    sub beh by beh.ltra;
    sub hebbet by hebbet.ltra;
    sub one by one.ltra;
} ltra;

feature ltrm {
    sub i by i.ltrm;
} ltrm;

feature rtla {
    sub h by h.rtla;
    sub beh by beh.rtla;
    sub hebbet by hebbet.rtla;
    sub one by one.rtla;
} rtla;

feature rtlm {
    sub alef by alef.rtlm;
} rtlm;

feature fina {
    sub teh from [teh.fina1 teh.fina2 teh.fina3];
} fina;

lookup K_ALTERNATES {
    sub k from [k.alt1 k.alt2 k.alt3];
} K_ALTERNATES;

feature rand {
    sub k' lookup K_ALTERNATES l;
} rand;

feature calt {
    sub k' lookup K_ALTERNATES m;
} calt;

lookup N_ALTERNATES {
    sub n from [n.alt1 n.alt2 n.alt3];
} N_ALTERNATES;

feature ss03 {
    lookup N_ALTERNATES;
} ss03;

feature ss04 {
    lookup N_ALTERNATES;
} ss04;

lookup JEEM_RTLM {
    sub jeem from [jeem.rtlm1 jeem.rtlm2 jeem.rtlm3];
} JEEM_RTLM;

feature rtlm {
    lookup JEEM_RTLM;
} rtlm;

lookup THEH_ALTERNATES {
    sub theh from [theh.alt1 theh.alt2 theh.alt3];
} THEH_ALTERNATES;

lookup LAM_ALTERNATES {
    sub lam from [lam.alt1 lam.alt2 lam.alt3];
} LAM_ALTERNATES;

feature fina {
    sub lam' theh' lookup THEH_ALTERNATES;
    sub theh' space' lam' lookup LAM_ALTERNATES;
} fina;

lookup SAD_LIGATURE {
    sub sad sad by sad_sad;
} SAD_LIGATURE;

lookup TAH_ALTERNATES {
    sub tah from [tah.alt1 tah.alt2 tah.alt3];
} TAH_ALTERNATES;

feature fina {
    sub sad' lookup SAD_LIGATURE sad' tah' lookup TAH_ALTERNATES;
} fina;

@DIRECTION_POSITIONED = [one one.ltra one.rtla hebbet hebbet.ltra hebbet.rtla];

feature ltra {
    pos @DIRECTION_POSITIONED <0 0 100 0>;
} ltra;

feature rtla {
    pos @DIRECTION_POSITIONED <0 0 -100 0>;
} rtla;
"""

# feature tag: the lookup types of its lookups, in lookup list order
EXPECTED_FEATURE_LOOKUP_TYPES = {
    "aalt": [1, 3],
    "calt": [6],
    "ccmp": [1],
    "cv01": [7],
    "cv02": [3],
    "fina": [3, 5, 5],
    "ltra": [1],
    "ltrm": [1],
    "rand": [3, 6],
    "rtla": [1],
    "rtlm": [1, 3],
    "salt": [3],
    "ss02": [6],
    "ss03": [3],
    "ss04": [3],
}
# GPOS feature tag: the lookup types of its lookups
EXPECTED_POSITIONING_FEATURE_LOOKUP_TYPES = {
    "ltra": [1],
    "rtla": [1],
}


def draw_glyph():
    pen = TTGlyphPen(None)
    pen.moveTo((100, 0))
    pen.lineTo((100, 700))
    pen.lineTo((400, 700))
    pen.lineTo((400, 0))
    pen.closePath()
    return pen.glyph()


def get_feature_lookup(substitution_table, feature_tag, lookup_position=0):
    """The lookup of a feature at a position in its lookups, the first one by default."""
    feature_record = next(
        record for record in substitution_table.FeatureList.FeatureRecord if record.FeatureTag == feature_tag
    )
    return substitution_table.LookupList.Lookup[feature_record.Feature.LookupListIndex[lookup_position]]


def get_lookup_records(lookup):
    """The (sequence index, lookup index) of the lookup records of the subtable of a contextual lookup."""
    return [(record.SequenceIndex, record.LookupListIndex) for record in lookup.SubTable[0].SubstLookupRecord]


def set_lookup_record_sequence_index(lookup, record_index, sequence_index):
    """Set the sequence index of a lookup record of the subtable of a contextual lookup."""
    lookup.SubTable[0].SubstLookupRecord[record_index].SequenceIndex = sequence_index


def add_second_alternate_subtable(substitution_table, feature_tag, alternates):
    """Add an AlternateSubst subtable to the first lookup of a feature, after its subtable."""
    lookup = get_feature_lookup(substitution_table, feature_tag)
    subtable = otTables.AlternateSubst()
    subtable.Format = 1
    subtable.alternates = alternates
    lookup.SubTable.append(subtable)
    lookup.SubTableCount = len(lookup.SubTable)


def build_font(output_path):
    glyph_order = [glyph_name for glyph_name, _ in GLYPHS]
    character_map = {codepoint: glyph_name for glyph_name, codepoint in GLYPHS if codepoint is not None}
    glyphs = {glyph_name: draw_glyph() for glyph_name in glyph_order}
    postscript_name = FAMILY_NAME.replace(" ", "") + "-Regular"
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(character_map)
    builder.setupGlyf(glyphs)
    glyph_table = builder.font["glyf"]
    builder.setupHorizontalMetrics(
        {glyph_name: (ADVANCE_WIDTH, glyph_table[glyph_name].xMin) for glyph_name in glyph_order}
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
    add_second_alternate_subtable(builder.font["GSUB"].table, "cv02", {"b": ["b.alt1", "b.alt2"]})
    # the tah after the ligature of the two sads
    set_lookup_record_sequence_index(get_feature_lookup(builder.font["GSUB"].table, "fina", 2), 1, 1)
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path):
    font = TTFont(output_path)
    substitution_table = font["GSUB"].table
    lookups = substitution_table.LookupList.Lookup
    feature_lookup_types = {
        feature.FeatureTag: [lookups[index].LookupType for index in feature.Feature.LookupListIndex]
        for feature in substitution_table.FeatureList.FeatureRecord
    }
    assert feature_lookup_types == EXPECTED_FEATURE_LOOKUP_TYPES, feature_lookup_types
    script_tags = [record.ScriptTag for record in substitution_table.ScriptList.ScriptRecord]
    assert script_tags == ["DFLT", "arab", "hebr", "latn"], script_tags
    feature_tags = {feature.FeatureTag: index for index, feature in enumerate(substitution_table.FeatureList.FeatureRecord)}
    # the lookup of ccmp comes before the lookups of rand and of the direction features, the lookup of ltra before the
    # one of rtla
    assert feature_tags["ccmp"] < feature_tags["ltra"] < feature_tags["rtla"]
    ccmp_lookup = substitution_table.FeatureList.FeatureRecord[feature_tags["ccmp"]].Feature.LookupListIndex[0]
    rand_lookup = substitution_table.FeatureList.FeatureRecord[feature_tags["rand"]].Feature.LookupListIndex[0]
    ltra_lookup = substitution_table.FeatureList.FeatureRecord[feature_tags["ltra"]].Feature.LookupListIndex[0]
    rtla_lookup = substitution_table.FeatureList.FeatureRecord[feature_tags["rtla"]].Feature.LookupListIndex[0]
    assert ccmp_lookup < rand_lookup and ccmp_lookup < ltra_lookup < rtla_lookup, (ccmp_lookup, rand_lookup, ltra_lookup, rtla_lookup)
    cv02_alternates = [subtable.alternates for subtable in get_feature_lookup(substitution_table, "cv02").SubTable]
    assert cv02_alternates == [{"b": ["b.alt1"]}, {"b": ["b.alt1", "b.alt2"]}], cv02_alternates
    ligature_alternate_lookup = get_feature_lookup(substitution_table, "fina", 2)
    assert ligature_alternate_lookup is lookups[-1], "the ligature and alternate rule is not the last lookup"
    ligature_alternate_records = get_lookup_records(ligature_alternate_lookup)
    nested_lookup_types = [lookups[lookup_index].LookupType for _, lookup_index in ligature_alternate_records]
    assert [sequence_index for sequence_index, _ in ligature_alternate_records] == [0, 1], ligature_alternate_records
    assert nested_lookup_types == [4, 3], nested_lookup_types
    positioning_table = font["GPOS"].table
    positioning_lookups = positioning_table.LookupList.Lookup
    positioning_feature_lookup_types = {
        feature.FeatureTag: [positioning_lookups[index].LookupType for index in feature.Feature.LookupListIndex]
        for feature in positioning_table.FeatureList.FeatureRecord
    }
    assert positioning_feature_lookup_types == EXPECTED_POSITIONING_FEATURE_LOOKUP_TYPES, positioning_feature_lookup_types
    shared_lookups = [substitution_table.FeatureList.FeatureRecord[feature_tags[tag]].Feature.LookupListIndex for tag in ["ss03", "ss04"]]
    assert shared_lookups[0] == shared_lookups[1], shared_lookups
    print(f"{output_path}: {len(lookups)} GSUB lookups, features {sorted(feature_lookup_types)}, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a TrueType test font with GSUB alternate substitutions.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
