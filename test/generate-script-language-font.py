"""Build a synthetic TrueType test font whose GSUB and GPOS features differ by script and by language system.

The language systems: DFLT, arab (and KUR, SND, URD), cham, cyrl (and SRB), deva, dev2, grek, latn (and TRK), thai (and THA).
Each glyph is 500 units wide, the marks maihanakat, dotabove and dotlessheadofkhah 0.

GSUB (lookup indexes in the order of the feature file):
- liga, every language system: X_LIGA (sub x by x.liga;), lookup 0;
- rvrn, every language system: X_RVRN (sub x by x.rvrn;), lookup 1, after X_LIGA in the lookup list: HarfBuzz
  applies rvrn in a stage of its own before the other features, so x becomes x.rvrn and X_LIGA no longer matches;
- liga of latn: sub a b by a_b; sub a alpha by a_alpha; sub becyr by becyr.latn; (lookups that a Cyrillic or a
  Greek text shaped with latn would take);
- liga of cyrl: sub becyr vecyr by becyr_vecyr;
- liga of grek: sub alpha by alpha.grek;
- ccmp of arab: sub beh by beh.ccmp; sub teh by teh.ccmp;
- locl of latn TRK: sub i by i.TRK;, of cyrl SRB: sub becyr by becyr.SRB;, of arab URD: sub fourarabic by
  fourarabic.urdu;.
Then, after these lookups in the lookup list:
- rvrn of arab: sub teh by teh.rvrn;, after the ccmp of teh: the Arabic shaper of HarfBuzz applies rvrn in a stage
  of its own before ccmp, so teh becomes teh.rvrn and the ccmp of teh no longer matches;
- init of arab: sub seen by seen.init;, fina of arab: sub dal by dal.fina; sub seen by seen.fina;, of arab URD (without
  the ones of arab): sub dal by dal.fina.urdu;, rlig of arab: sub reh by reh.rlig;, of arab URD (without the one of
  arab): sub reh by reh.rlig.urdu;, ss01 of arab: sub dal by dal.ss01;;
- the features of the characters of no script, every language system: liga sub three four by three_four; sub hyphen
  greater by arrow;, then calt sub three' four by three.calt; sub five' six by five.calt; (after the liga lookup: the
  Arabic shaper of HarfBuzz applies calt in a stage of its own before liga when the language system has no rclt, like
  arab URD), clig sub seven eight by seven_eight;, and in DFLT, arab and thai only, rclt sub nine by nine.rclt;;
- liga of thai THA (without the ones of thai): sub kokai by kokai.tha;;
- calt of dev2: sub ka by ka.dev2;, of deva: sub ka by ka.deva; (in calt: the Indic shaper of HarfBuzz turns liga off);
- liga of latn TRK: sub o by o.liga;, then the required feature (ReqFeatureIndex) of latn TRK, ss05: sub o by o.req;
  (HarfBuzz applies a required feature whose tag is not enabled in the first stage, with rvrn, so o becomes o.req and
  the liga of o no longer matches), and the required feature of the DefaultLangSys of cyrl, ss06: sub gecyr by
  gecyr.req;;
- locl of arab: sub lam by lam.locl;, then init of arab: sub lam by lam.init; (the Arabic shaper of HarfBuzz applies
  locl before the forms);
- ccmp of arab: sub noon by noon.dotless dotabove; (a letter and its mark, laid out in reverse order);
- liga of arab and arab URD: sub waw.rlig by waw.liga;, calt of arab and arab URD: sub heh.rlig by heh.calt;, then rlig
  of arab and arab URD: sub waw by waw.rlig; sub heh by heh.rlig; (the Arabic shaper of HarfBuzz applies rlig in a
  stage of its own before calt and liga);
- isol of arab: sub hamza by hamza.isol; sub tehmarbuta by tehmarbuta.isol; (the hamza is non-joining: the Arabic
  shaper of HarfBuzz gives it no form), fina of arab: sub tehmarbuta.isol by tehmarbuta.isol.fina; (HarfBuzz applies
  isol in a stage of its own before fina), init of arab: sub tatweel by tatweel.init; (HarfBuzz joins the tatweel as
  a dual-joining letter);
- the named lookups SEEN_INIT (sub seen by seen.init;), DAL_SEEN_FINA (sub dal by dal.fina; sub seen by seen.fina;)
  and SEEN_REQ (sub seen by seen.req;): arab SND has init SEEN_INIT, fina DAL_SEEN_FINA and the required feature
  ss07 SEEN_REQ (HarfBuzz applies it in the first stage, before init, unless ss07 is enabled), arab KUR has init
  SEEN_INIT, the required feature fina DAL_SEEN_FINA (HarfBuzz applies it at every glyph in the stage of fina, after
  ccmp and before init, or in the first stage when fina is off) and ccmp sub seen.fina by seen.fina.ccmp; (which
  matches the output of the required feature in the first stage only);
- locl of arab: sub jeem.ccmp by jeem.locl;, then ccmp of arab: sub jeem by jeem.ccmp; (the Arabic shaper of HarfBuzz
  applies ccmp and locl in one stage, so the locl lookup, before the ccmp one in the lookup list, does not match);
- fina of arab: sub ae by ae.fina; (U+06D5, a right-joining letter outside the ranges of isArabicChar).
The mark dotlessheadofkhah (U+06E1, transparent) has no lookup.
Like feaLib, the language systems TRK, SRB, URD and THA have the lookups of a feature before its script statements
only (X_LIGA in liga, the features of the characters of no script but rclt): not the a_b and becyr_vecyr ligatures,
nor the ccmp of arab, nor rclt.

GPOS kern: one two -10 in DFLT, -30 in latn, -20 in thai; chama chami -50 in cham only; two A -40 in thai only;
A alpha -40 in latn only; a chama -10 in latn, -50 in cham; kha kha -10 in DFLT, -50 in dev2. The GPOS table has
the scripts DFLT, cham, dev2, latn and thai only.

usage: generate-script-language-font.py <output.ttf>
"""
import argparse

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Script Language"

# glyph name, codepoint, advance width
GLYPHS = [
    (".notdef", None, 500),
    ("space", 0x20, 500),
    ("one", 0x31, 500),
    ("two", 0x32, 500),
    ("A", 0x41, 500),
    ("V", 0x56, 500),
    ("a", 0x61, 500),
    ("b", 0x62, 500),
    ("i", 0x69, 500),
    ("x", 0x78, 500),
    ("alpha", 0x3B1, 500),
    ("becyr", 0x431, 500),
    ("vecyr", 0x432, 500),
    ("beh", 0x628, 500),
    ("fourarabic", 0x6F4, 500),
    ("kokai", 0xE01, 500),
    ("maihanakat", 0xE31, 0),
    ("chama", 0xAA00, 500),
    ("chami", 0xAA01, 500),
    ("a_b", None, 500),
    ("i.TRK", None, 500),
    ("x.liga", None, 500),
    ("x.rvrn", None, 500),
    ("alpha.grek", None, 500),
    ("becyr.SRB", None, 500),
    ("becyr.latn", None, 500),
    ("becyr_vecyr", None, 500),
    ("beh.ccmp", None, 500),
    ("fourarabic.urdu", None, 500),
    ("hyphen", 0x2D, 500),
    ("three", 0x33, 500),
    ("four", 0x34, 500),
    ("five", 0x35, 500),
    ("six", 0x36, 500),
    ("seven", 0x37, 500),
    ("eight", 0x38, 500),
    ("nine", 0x39, 500),
    ("greater", 0x3E, 500),
    ("teh", 0x62A, 500),
    ("dal", 0x62F, 500),
    ("reh", 0x631, 500),
    ("seen", 0x633, 500),
    ("tatweel", 0x640, 500),
    ("ka", 0x915, 500),
    ("kha", 0x916, 500),
    ("a_alpha", None, 500),
    ("arrow", None, 500),
    ("three_four", None, 500),
    ("three.calt", None, 500),
    ("five.calt", None, 500),
    ("seven_eight", None, 500),
    ("nine.rclt", None, 500),
    ("teh.ccmp", None, 500),
    ("teh.rvrn", None, 500),
    ("seen.init", None, 500),
    ("seen.fina", None, 500),
    ("dal.fina", None, 500),
    ("dal.fina.urdu", None, 500),
    ("dal.ss01", None, 500),
    ("reh.rlig", None, 500),
    ("reh.rlig.urdu", None, 500),
    ("kokai.tha", None, 500),
    ("ka.dev2", None, 500),
    ("ka.deva", None, 500),
    ("gecyr", 0x433, 500),
    ("o", 0x6F, 500),
    ("lam", 0x644, 500),
    ("noon", 0x646, 500),
    ("heh", 0x647, 500),
    ("waw", 0x648, 500),
    ("o.liga", None, 500),
    ("o.req", None, 500),
    ("gecyr.req", None, 500),
    ("lam.locl", None, 500),
    ("lam.init", None, 500),
    ("noon.dotless", None, 500),
    ("dotabove", None, 0),
    ("waw.rlig", None, 500),
    ("waw.liga", None, 500),
    ("heh.rlig", None, 500),
    ("heh.calt", None, 500),
    ("hamza", 0x621, 500),
    ("tehmarbuta", 0x629, 500),
    ("hamza.isol", None, 500),
    ("tehmarbuta.isol", None, 500),
    ("tehmarbuta.isol.fina", None, 500),
    ("tatweel.init", None, 500),
    ("seen.req", None, 500),
    ("jeem", 0x62C, 500),
    ("jeem.ccmp", None, 500),
    ("jeem.locl", None, 500),
    ("ae", 0x6D5, 500),
    ("ae.fina", None, 500),
    ("dotlessheadofkhah", 0x6E1, 0),
    ("seen.fina.ccmp", None, 500),
]

FEATURES = """
languagesystem DFLT dflt;
languagesystem arab dflt;
languagesystem arab URD;
languagesystem cham dflt;
languagesystem cyrl dflt;
languagesystem cyrl SRB;
languagesystem dev2 dflt;
languagesystem deva dflt;
languagesystem grek dflt;
languagesystem latn dflt;
languagesystem latn TRK;
languagesystem thai dflt;
languagesystem thai THA;

table GDEF {
    GlyphClassDef [one two A V a b i x alpha becyr vecyr beh fourarabic kokai chama chami i.TRK x.liga x.rvrn
        alpha.grek becyr.SRB becyr.latn beh.ccmp fourarabic.urdu hyphen three four five six seven eight nine greater
        teh dal reh seen tatweel ka kha three.calt five.calt nine.rclt teh.ccmp teh.rvrn seen.init seen.fina dal.fina
        dal.fina.urdu dal.ss01 reh.rlig reh.rlig.urdu kokai.tha ka.dev2 ka.deva gecyr o lam noon heh waw o.liga o.req
        gecyr.req lam.locl lam.init noon.dotless waw.rlig waw.liga heh.rlig heh.calt hamza tehmarbuta hamza.isol
        tehmarbuta.isol tehmarbuta.isol.fina tatweel.init seen.req jeem jeem.ccmp jeem.locl ae ae.fina seen.fina.ccmp],
        [a_b becyr_vecyr a_alpha arrow three_four seven_eight], [maihanakat dotabove dotlessheadofkhah], ;
} GDEF;

lookup X_LIGA {
    sub x by x.liga;
} X_LIGA;

lookup X_RVRN {
    sub x by x.rvrn;
} X_RVRN;

feature liga {
    lookup X_LIGA;
    script latn;
    sub a b by a_b;
    sub a alpha by a_alpha;
    sub becyr by becyr.latn;
    script cyrl;
    sub becyr vecyr by becyr_vecyr;
    script grek;
    sub alpha by alpha.grek;
} liga;

feature rvrn {
    lookup X_RVRN;
} rvrn;

feature ccmp {
    script arab;
    sub beh by beh.ccmp;
    sub teh by teh.ccmp;
} ccmp;

feature locl {
    script latn;
    language TRK;
    sub i by i.TRK;
    script cyrl;
    language SRB;
    sub becyr by becyr.SRB;
    script arab;
    language URD;
    sub fourarabic by fourarabic.urdu;
} locl;

feature rvrn {
    script arab;
    sub teh by teh.rvrn;
} rvrn;

feature init {
    script arab;
    sub seen by seen.init;
} init;

feature fina {
    script arab;
    sub dal by dal.fina;
    sub seen by seen.fina;
    language URD exclude_dflt;
    sub dal by dal.fina.urdu;
} fina;

feature rlig {
    script arab;
    sub reh by reh.rlig;
    language URD exclude_dflt;
    sub reh by reh.rlig.urdu;
} rlig;

feature ss01 {
    script arab;
    sub dal by dal.ss01;
} ss01;

feature liga {
    sub three four by three_four;
    sub hyphen greater by arrow;
} liga;

feature calt {
    sub three' four by three.calt;
    sub five' six by five.calt;
} calt;

feature clig {
    sub seven eight by seven_eight;
} clig;

lookup NINE_RCLT {
    sub nine by nine.rclt;
} NINE_RCLT;

feature rclt {
    script DFLT;
    lookup NINE_RCLT;
    script arab;
    lookup NINE_RCLT;
    script thai;
    lookup NINE_RCLT;
} rclt;

feature liga {
    script thai;
    language THA exclude_dflt;
    sub kokai by kokai.tha;
} liga;

feature calt {
    script dev2;
    sub ka by ka.dev2;
    script deva;
    sub ka by ka.deva;
} calt;

feature kern {
    script DFLT;
    pos one two -10;
    pos kha kha -10;
    script latn;
    pos one two -30;
    pos A alpha -40;
    pos a chama -10;
    script thai;
    pos one two -20;
    pos two A -40;
    script cham;
    pos chama chami -50;
    pos a chama -50;
    script dev2;
    pos kha kha -50;
} kern;

feature liga {
    script latn;
    language TRK;
    sub o by o.liga;
} liga;

feature ss05 {
    script latn;
    language TRK required;
    sub o by o.req;
} ss05;

feature ss06 {
    script cyrl;
    language dflt required;
    sub gecyr by gecyr.req;
} ss06;

feature locl {
    script arab;
    sub lam by lam.locl;
} locl;

feature init {
    script arab;
    sub lam by lam.init;
} init;

feature ccmp {
    script arab;
    sub noon by noon.dotless dotabove;
} ccmp;

feature liga {
    script arab;
    sub waw.rlig by waw.liga;
    language URD;
} liga;

feature calt {
    script arab;
    sub heh.rlig by heh.calt;
    language URD;
} calt;

feature rlig {
    script arab;
    sub waw by waw.rlig;
    sub heh by heh.rlig;
    language URD;
} rlig;

feature isol {
    script arab;
    sub hamza by hamza.isol;
    sub tehmarbuta by tehmarbuta.isol;
} isol;

feature fina {
    script arab;
    sub tehmarbuta.isol by tehmarbuta.isol.fina;
} fina;

feature init {
    script arab;
    sub tatweel by tatweel.init;
} init;

lookup SEEN_INIT {
    sub seen by seen.init;
} SEEN_INIT;

lookup DAL_SEEN_FINA {
    sub dal by dal.fina;
    sub seen by seen.fina;
} DAL_SEEN_FINA;

lookup SEEN_REQ {
    sub seen by seen.req;
} SEEN_REQ;

feature init {
    script arab;
    language SND exclude_dflt;
    lookup SEEN_INIT;
    language KUR exclude_dflt;
    lookup SEEN_INIT;
} init;

feature fina {
    script arab;
    language SND exclude_dflt;
    lookup DAL_SEEN_FINA;
    language KUR exclude_dflt required;
    lookup DAL_SEEN_FINA;
} fina;

feature ss07 {
    script arab;
    language SND exclude_dflt required;
    lookup SEEN_REQ;
} ss07;

feature ccmp {
    script arab;
    language KUR exclude_dflt;
    sub seen.fina by seen.fina.ccmp;
} ccmp;

feature locl {
    script arab;
    sub jeem.ccmp by jeem.locl;
} locl;

feature ccmp {
    script arab;
    sub jeem by jeem.ccmp;
} ccmp;

feature fina {
    script arab;
    sub ae by ae.fina;
} fina;
"""

# script tag, language tag: the features of the language system, in the order of the font
EXPECTED_LANGUAGE_SYSTEMS = {
    "GSUB": {
        ("DFLT", "dflt"): ["calt", "clig", "liga", "rclt", "rvrn"],
        ("arab", "dflt"): ["calt", "ccmp", "clig", "fina", "init", "isol", "liga", "locl", "rclt", "rlig", "rvrn", "ss01"],
        ("arab", "KUR "): ["ccmp", "init"],
        ("arab", "SND "): ["fina", "init"],
        ("arab", "URD "): ["calt", "clig", "fina", "liga", "locl", "rlig", "rvrn"],
        ("cham", "dflt"): ["calt", "clig", "liga", "rvrn"],
        ("cyrl", "dflt"): ["calt", "clig", "liga", "rvrn"],
        ("cyrl", "SRB "): ["calt", "clig", "liga", "locl", "rvrn"],
        ("dev2", "dflt"): ["calt", "clig", "liga", "rvrn"],
        ("deva", "dflt"): ["calt", "clig", "liga", "rvrn"],
        ("grek", "dflt"): ["calt", "clig", "liga", "rvrn"],
        ("latn", "dflt"): ["calt", "clig", "liga", "rvrn"],
        ("latn", "TRK "): ["calt", "clig", "liga", "locl", "rvrn"],
        ("thai", "dflt"): ["calt", "clig", "liga", "rclt", "rvrn"],
        ("thai", "THA "): ["calt", "clig", "liga", "rvrn"],
    },
}

# script tag, language tag: the required feature (ReqFeatureIndex) of the language systems that have one
EXPECTED_REQUIRED_FEATURES = {
    ("arab", "KUR "): "fina",
    ("arab", "SND "): "ss07",
    ("cyrl", "dflt"): "ss06",
    ("latn", "TRK "): "ss05",
}


def draw_box(advance):
    pen = TTGlyphPen(None)
    if advance:
        pen.moveTo((50, 0))
        pen.lineTo((50, 700))
        pen.lineTo((advance - 50, 700))
        pen.lineTo((advance - 50, 0))
        pen.closePath()
    return pen.glyph()


def build_font(output_path):
    glyph_order = [glyph_name for glyph_name, _, _ in GLYPHS]
    character_map = {codepoint: glyph_name for glyph_name, codepoint, _ in GLYPHS if codepoint is not None}
    glyphs = {glyph_name: draw_box(advance) for glyph_name, _, advance in GLYPHS}
    postscript_name = FAMILY_NAME.replace(" ", "") + "-Regular"
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(character_map)
    builder.setupGlyf(glyphs)
    glyph_table = builder.font["glyf"]
    builder.setupHorizontalMetrics(
        {glyph_name: (advance, getattr(glyph_table[glyph_name], "xMin", 0)) for glyph_name, _, advance in GLYPHS}
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


def get_language_system_tables(table):
    """The language system tables of a GSUB or GPOS table, by script tag and language tag."""
    language_system_tables = {}
    for script_record in table.ScriptList.ScriptRecord:
        script = script_record.Script
        records = [("dflt", script.DefaultLangSys)] + [(record.LangSysTag, record.LangSys) for record in script.LangSysRecord]
        for language_tag, language_system in records:
            language_system_tables[(script_record.ScriptTag, language_tag)] = language_system
    return language_system_tables


def get_language_systems(table):
    """The feature tags of each language system of a GSUB or GPOS table, by script tag and language tag."""
    feature_records = table.FeatureList.FeatureRecord
    return {
        key: [feature_records[index].FeatureTag for index in language_system.FeatureIndex]
        for key, language_system in get_language_system_tables(table).items()
    }


def get_required_features(table):
    """The tag of the required feature of each language system of a GSUB or GPOS table that has one."""
    feature_records = table.FeatureList.FeatureRecord
    return {
        key: feature_records[language_system.ReqFeatureIndex].FeatureTag
        for key, language_system in get_language_system_tables(table).items()
        if language_system.ReqFeatureIndex != 0xFFFF
    }


def verify_font(output_path):
    font = TTFont(output_path)
    language_systems = get_language_systems(font["GSUB"].table)
    assert language_systems == EXPECTED_LANGUAGE_SYSTEMS["GSUB"], language_systems
    required_features = get_required_features(font["GSUB"].table)
    assert required_features == EXPECTED_REQUIRED_FEATURES, required_features
    lookups = font["GSUB"].table.LookupList.Lookup
    # X_LIGA then X_RVRN
    assert lookups[0].SubTable[0].mapping == {"x": "x.liga"}, lookups[0].SubTable[0].mapping
    assert lookups[1].SubTable[0].mapping == {"x": "x.rvrn"}, lookups[1].SubTable[0].mapping
    kern_scripts = sorted(script_tag for script_tag, _ in get_language_systems(font["GPOS"].table))
    assert kern_scripts == ["DFLT", "cham", "dev2", "latn", "thai"], kern_scripts
    print(f"{output_path}: {len(language_systems)} GSUB language systems, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a TrueType test font whose features differ by script and language.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
