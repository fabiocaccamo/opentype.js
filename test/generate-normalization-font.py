"""Build a synthetic TrueType test font for the Unicode normalization of HarfBuzz (_hb_ot_shape_normalize), which
decomposes the characters the font has not into the characters it has, puts the marks in the order of the modified
combining classes of HarfBuzz and composes a base and a mark into the precomposed character the font has.

Glyphs: A, U, a, e, u and the precomposed Aring (U+00C5), Udieresis (U+00DC), agrave (U+00E0), eacute (U+00E9),
adotbelow (U+1EA1) and edotbelow (U+1EB9), but not Agrave (U+00C0), aacute (U+00E1), udieresis (U+00FC) and the
letters with two marks; the combining marks gravecomb, acutecomb, macroncomb, dieresiscomb and dotbelowcomb (U+0300,
U+0301, U+0304, U+0308, U+0323); the Hebrew bet, patah and dagesh (U+05D1, U+05B7, U+05BC); the Arabic alef, alef with
hamza above, beh, fatha, kasra, shadda and hamza above (U+0627, U+0623, U+0628, U+064E, U+0650, U+0651, U+0654).
After them, for the shapers of HarfBuzz: the Arabic alef with madda above and maddah above (U+0622, U+0653); the
Bengali ka, dda, ya, nukta, the vowel signs aa, e and o, rra and yya (U+0995, U+09A1, U+09AF, U+09BC, U+09BE, U+09C7,
U+09CB, U+09DC, U+09DF); the Khmer ka and the vowel signs oe and e (U+1780, U+17BE, U+17C1); the Balinese akara, akara
tedung, tedung, ra repa and ra repa tedung (U+1B05, U+1B06, U+1B35, U+1B3A, U+1B3B); the Hangul choseong kiyeok,
jungseong a, jongseong kiyeok and nieun and the syllables ga and gag (U+1100, U+1161, U+11A8, U+11AB, U+AC00, U+AC01),
not the syllable gan (U+AC04); the Hebrew qamats, shin dot, shin and shin with shin dot (U+05B8, U+05C1, U+05E9,
U+FB2A); the Tibetan ka and the vowel signs aa, i and u (U+0F40, U+0F71, U+0F72, U+0F74), not U+0F73; the Myanmar u,
uu and the vowel sign ii (U+1025, U+1026, U+102E); the Devanagari ka, nukta, qa, na, nnna and the vowel sign e (U+0915,
U+093C, U+0958, U+0928, U+0929, U+0947).
The advances tell the glyphs apart, the marks (the nonspacing ones) have none.

GSUB: ccmp: sub agrave by a gravecomb; the precomposed agrave split again into a base and a mark. nukt: a consonant and
a nukta into their nukta form (ka and nukta into qa, na and nukta into nnna, the Bengali ya and nukta into yya), which
the Indic shaper of HarfBuzz enables. Its scripts are DFLT, latn, and bng2, bali, mym2 and dev2, which give the
Bengali, Balinese, Myanmar and Devanagari runs the Indic, USE, Myanmar and Indic shapers of HarfBuzz
(hb_ot_shaper_categorize); the other runs take the default shaper, or the shaper of their script.
GDEF: the glyph classes of the bases and of the marks.

usage: generate-normalization-font.py <output.ttf>
"""
import argparse

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test Normalization"

UNITS_PER_EM = 1000

BASE_CONTOUR = [(50, 0), (50, 700), (250, 700), (250, 0)]
MARK_CONTOUR = [(-200, 750), (-200, 850), (-100, 850), (-100, 750)]

# glyph name, codepoint, advance width (the marks have no advance)
GLYPHS = [
    (".notdef", None, 600),
    ("space", 0x0020, 250),
    ("A", 0x0041, 610),
    ("U", 0x0055, 620),
    ("a", 0x0061, 500),
    ("e", 0x0065, 510),
    ("u", 0x0075, 520),
    ("Aring", 0x00C5, 611),
    ("Udieresis", 0x00DC, 621),
    ("agrave", 0x00E0, 501),
    ("eacute", 0x00E9, 511),
    ("adotbelow", 0x1EA1, 502),
    ("edotbelow", 0x1EB9, 512),
    ("gravecomb", 0x0300, 0),
    ("acutecomb", 0x0301, 0),
    ("macroncomb", 0x0304, 0),
    ("dieresiscomb", 0x0308, 0),
    ("dotbelowcomb", 0x0323, 0),
    ("patah", 0x05B7, 0),
    ("dagesh", 0x05BC, 0),
    ("bet", 0x05D1, 550),
    ("alefHamzaabove", 0x0623, 300),
    ("alef", 0x0627, 280),
    ("beh", 0x0628, 560),
    ("fatha", 0x064E, 0),
    ("kasra", 0x0650, 0),
    ("shadda", 0x0651, 0),
    ("hamzaabove", 0x0654, 0),
    ("alefMadda", 0x0622, 290),
    ("maddah", 0x0653, 0),
    ("kaBengali", 0x0995, 701),
    ("ddaBengali", 0x09A1, 702),
    ("yaBengali", 0x09AF, 703),
    ("nuktaBengali", 0x09BC, 0),
    ("aaVowelSignBengali", 0x09BE, 704),
    ("eVowelSignBengali", 0x09C7, 705),
    ("oVowelSignBengali", 0x09CB, 706),
    ("rraBengali", 0x09DC, 707),
    ("yyaBengali", 0x09DF, 708),
    ("kaKhmer", 0x1780, 711),
    ("oeVowelSignKhmer", 0x17BE, 712),
    ("eVowelSignKhmer", 0x17C1, 713),
    ("akaraBalinese", 0x1B05, 721),
    ("akaraTedungBalinese", 0x1B06, 722),
    ("tedungBalinese", 0x1B35, 723),
    ("raRepaBalinese", 0x1B3A, 0),
    ("raRepaTedungBalinese", 0x1B3B, 724),
    ("kiyeokChoseong", 0x1100, 731),
    ("aJungseong", 0x1161, 732),
    ("kiyeokJongseong", 0x11A8, 733),
    ("nieunJongseong", 0x11AB, 734),
    ("ga", 0xAC00, 735),
    ("gag", 0xAC01, 736),
    ("qamats", 0x05B8, 0),
    ("shindot", 0x05C1, 0),
    ("shin", 0x05E9, 741),
    ("shinShindot", 0xFB2A, 742),
    ("kaTibetan", 0x0F40, 751),
    ("aaVowelSignTibetan", 0x0F71, 0),
    ("iVowelSignTibetan", 0x0F72, 0),
    ("uVowelSignTibetan", 0x0F74, 0),
    ("uMyanmar", 0x1025, 761),
    ("uuMyanmar", 0x1026, 762),
    ("iiVowelSignMyanmar", 0x102E, 0),
    ("kaDevanagari", 0x0915, 771),
    ("nuktaDevanagari", 0x093C, 0),
    ("qaDevanagari", 0x0958, 772),
    ("naDevanagari", 0x0928, 773),
    ("nnnaDevanagari", 0x0929, 774),
    ("eVowelSignDevanagari", 0x0947, 0),
]

MARKS = [glyph_name for glyph_name, codepoint, advance in GLYPHS if codepoint is not None and advance == 0]
BASES = [glyph_name for glyph_name, codepoint, advance in GLYPHS if codepoint is not None and advance > 0]

FEATURES = f"""
languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem bng2 dflt;
languagesystem bali dflt;
languagesystem mym2 dflt;
languagesystem dev2 dflt;

table GDEF {{
    GlyphClassDef [{" ".join(BASES)}], , [{" ".join(MARKS)}], ;
}} GDEF;

feature ccmp {{
    sub agrave by a gravecomb;
}} ccmp;

feature nukt {{
    sub kaDevanagari nuktaDevanagari by qaDevanagari;
    sub naDevanagari nuktaDevanagari by nnnaDevanagari;
    sub yaBengali nuktaBengali by yyaBengali;
}} nukt;
"""


def draw_glyph(advance):
    pen = TTGlyphPen(None)
    if advance > 0 and advance != 250:
        contour = BASE_CONTOUR
    elif advance == 0:
        contour = MARK_CONTOUR
    else:
        return pen.glyph()
    pen.moveTo(contour[0])
    for point in contour[1:]:
        pen.lineTo(point)
    pen.closePath()
    return pen.glyph()


def build_font(output_path):
    glyph_order = [glyph_name for glyph_name, _, _ in GLYPHS]
    character_map = {codepoint: glyph_name for glyph_name, codepoint, _ in GLYPHS if codepoint is not None}
    glyphs = {glyph_name: draw_glyph(advance) for glyph_name, _, advance in GLYPHS}
    postscript_name = FAMILY_NAME.replace(" ", "") + "-Regular"
    builder = FontBuilder(unitsPerEm=UNITS_PER_EM, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(character_map)
    builder.setupGlyf(glyphs)
    glyph_table = builder.font["glyf"]
    builder.setupHorizontalMetrics(
        {glyph_name: (advance, getattr(glyph_table[glyph_name], "xMin", 0)) for glyph_name, _, advance in GLYPHS}
    )
    builder.setupHorizontalHeader(ascent=900, descent=-200)
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
    builder.setupOS2(fsType=0, sTypoAscender=900, sTypoDescender=-200, usWinAscent=900, usWinDescent=200)
    builder.setupPost()
    builder.addOpenTypeFeatures(FEATURES)
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(output_path)


def verify_font(output_path):
    font = TTFont(output_path)
    character_map = font.getBestCmap()
    # the precomposed characters the font has not
    assert not any(
        codepoint in character_map for codepoint in [0x00C0, 0x00E1, 0x00FC, 0x01D5, 0x01D6, 0x212B, 0x0F73, 0xAC04]
    )
    assert character_map[0x00E0] == "agrave" and character_map[0x1EA1] == "adotbelow"
    advances = {glyph_name: font["hmtx"][glyph_name][0] for glyph_name, _, _ in GLYPHS}
    assert all(advances[glyph_name] == 0 for glyph_name in MARKS), MARKS
    assert len(set(advances[glyph_name] for glyph_name in BASES)) == len(BASES), "the bases have distinct advances"
    substitution_table = font["GSUB"].table
    features = [feature.FeatureTag for feature in substitution_table.FeatureList.FeatureRecord]
    assert features == ["ccmp", "nukt"], features
    lookup_types = [lookup.LookupType for lookup in substitution_table.LookupList.Lookup]
    assert lookup_types == [2, 4], lookup_types
    scripts = [script.ScriptTag for script in substitution_table.ScriptList.ScriptRecord]
    assert scripts == ["DFLT", "bali", "bng2", "dev2", "latn", "mym2"], scripts
    glyph_classes = font["GDEF"].table.GlyphClassDef.classDefs
    assert all(glyph_classes[glyph_name] == 3 for glyph_name in MARKS)
    print(f"{output_path}: {len(GLYPHS)} glyphs, GSUB {features}, ok")


def main():
    parser = argparse.ArgumentParser(description="Build a TrueType test font for the Unicode normalization.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
