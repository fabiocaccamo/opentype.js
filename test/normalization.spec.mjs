import assert from 'assert';
import { readFileSync } from 'fs';
import { parse } from '../src/opentype.mjs';
import { normalizeCharacters } from '../src/normalization.mjs';
import { getTextCharacters } from '../src/tokenizer.mjs';
import { SPACE_TYPES } from '../src/char.mjs';
import { HarfBuzzShaper } from '../src/layout.mjs';
import { itFailsUntilFixed } from './regression/helpers.mjs';

// TestNormalization.ttf, built by test/generate-normalization-font.py: glyphs 2 A, 3 U, 4 a, 5 e, 6 u, 7 Aring (U+00C5),
// 8 Udieresis (U+00DC), 9 agrave (U+00E0), 10 eacute (U+00E9), 11 adotbelow (U+1EA1), 12 edotbelow (U+1EB9), 13 to 17 the
// combining grave, acute, macron, dieresis and dot below, 18 patah, 19 dagesh, 20 bet, 21 alefHamzaabove (U+0623), 22
// alef, 23 beh, 24 fatha, 25 kasra, 26 shadda, 27 hamzaabove, 28 alefMadda (U+0622), 29 maddah; the Bengali 30 ka, 31
// dda, 32 ya, 33 nukta, 34 aa, 35 e and 36 o vowel signs, 37 rra (U+09DC), 38 yya (U+09DF); the Khmer 39 ka, 40 oe and
// 41 e vowel signs; the Balinese 42 akara, 43 akara tedung (U+1B06), 44 tedung, 45 ra repa, 46 ra repa tedung (U+1B3B);
// the Hangul 47 choseong kiyeok, 48 jungseong a, 49 jongseong kiyeok, 50 jongseong nieun, 51 ga (U+AC00), 52 gag
// (U+AC01); the Hebrew 53 qamats, 54 shin dot, 55 shin, 56 shin with shin dot (U+FB2A); the Tibetan 57 ka, 58 aa, 59 i
// and 60 u vowel signs; the Myanmar 61 u, 62 uu (U+1026), 63 vowel sign ii; the Devanagari 64 ka, 65 nukta, 66 qa
// (U+0958), 67 na, 68 nnna (U+0929), 69 vowel sign e; not U+00C0, U+00E1, U+00FC, the letters with two marks, U+0F73 nor
// U+AC04. Its GSUB has the scripts bng2, bali, mym2 and dev2: hb-shape shapes the Bengali, Balinese, Myanmar and
// Devanagari text with the Indic, USE, Myanmar and Indic shapers of HarfBuzz, the Arabic, Hebrew, Hangul and Khmer text
// with their shapers, the other text with the default shaper; its nukt (ka and nukta into qa, na and nukta into nnna,
// ya and nukta into yya) applies after the normalization.
// The references are the glyphs and the clusters of hb-shape, in the order of the text (hb-shape prints the glyphs of a
// right-to-left text in reverse order), run in test/fonts:
// hb-shape --shapers=ot --no-glyph-names --cluster-level=1 --no-positions TestNormalization.ttf -u <code points>
// with --features=-ccmp where the ccmp of the font (sub agrave by a gravecomb) would change the glyphs, --script=Latn for
// the default shaper, and --trace (the buffer of 'start table GSUB') for the Indic and Khmer shapers, which reorder the
// glyphs after the normalization
describe('normalization.mjs', function() {
    let font;

    before(function() {
        font = parse(readFileSync('./test/fonts/TestNormalization.ttf'));
    });

    function normalize(text, shaper = HarfBuzzShaper.DEFAULT, hasMarkFeature = false, normalizedFont = font) {
        return normalizeCharacters(normalizedFont, getTextCharacters(text), shaper, hasMarkFeature)
            .map(character => [character.glyphIndex, character.cluster]);
    }

    describe('normalizeCharacters', function() {
        it('maps the characters the font has to the glyphs of the cmap', function() {
            // -u 0061,0020,0065: [4=0|1=1|5=2]
            assert.deepStrictEqual(normalize('a e'), [[4, 0], [1, 1], [5, 2]]);
        });

        it('composes a base and a mark into the precomposed character the font has, in one cluster', function() {
            // -u 0065,0301: [10=0]; --features=-ccmp -u 0061,0300: [9=0]
            assert.deepStrictEqual(normalize('e\u{301}'), [[10, 0]]);
            assert.deepStrictEqual(normalize('a\u{300}'), [[9, 0]]);
            // U+00C5 of A and U+030A, a mark the font has not: -u 0041,030A: [7=0]
            assert.deepStrictEqual(normalize('A\u{30A}'), [[7, 0]]);
        });

        it('keeps a base and a mark whose precomposed character the font has not', function() {
            // no U+00E1: -u 0062,0301: [0=0|14=1], and no b either; a mark before its base: -u 0301,0065: [14=0|5=1]
            assert.deepStrictEqual(normalize('b\u{301}'), [[0, 0], [14, 1]]);
            assert.deepStrictEqual(normalize('\u{301}e'), [[14, 0], [5, 1]]);
        });

        it('decomposes a character the font has not into the characters it has, in its cluster', function() {
            // -u 00C0: [2=0|13=0]
            assert.deepStrictEqual(normalize('\u{C0}'), [[2, 0], [13, 0]]);
            // the shortest decomposition, U+00DC U+0304: -u 01D5: [8=0|15=0]
            assert.deepStrictEqual(normalize('\u{1D5}'), [[8, 0], [15, 0]]);
            // decomposed again, U+00FC to u U+0308: -u 01D6: [6=0|16=0|15=0]
            assert.deepStrictEqual(normalize('\u{1D6}'), [[6, 0], [16, 0], [15, 0]]);
            // the singleton U+212B ANGSTROM SIGN to U+00C5: -u 212B: [7=0]
            assert.deepStrictEqual(normalize('\u{212B}'), [[7, 0]]);
        });

        it('decomposes a precomposed character the font has before a mark, then composes it again', function() {
            // U+00E9 U+0323: e, the dot below, then the acute, e and the dot below composed into U+1EB9: -u 00E9,0323:
            // [12=0|14=0]
            assert.deepStrictEqual(normalize('\u{E9}\u{323}'), [[12, 0], [14, 0]]);
            // U+00C0 the font has not before an acute: -u 00C0,0301: [2=0|13=0|14=1]
            assert.deepStrictEqual(normalize('\u{C0}\u{301}'), [[2, 0], [13, 0], [14, 1]]);
        });

        it('puts the marks in canonical order before composing, merging the clusters of the marks it moves', function() {
            // the dot below (220) before the acute (230), a and the dot below composed into U+1EA1: -u 0061,0301,0323:
            // [11=0|14=0]; in canonical order already: -u 0061,0323,0301: [11=0|14=2]
            assert.deepStrictEqual(normalize('a\u{301}\u{323}'), [[11, 0], [14, 0]]);
            assert.deepStrictEqual(normalize('a\u{323}\u{301}'), [[11, 0], [14, 2]]);
        });

        it('does not compose a mark blocked by a mark of the same class before it', function() {
            // no U+00E1, so the grave after the acute is blocked: -u 0061,0301,0300: [4=0|14=1|13=2]
            assert.deepStrictEqual(normalize('a\u{301}\u{300}'), [[4, 0], [14, 1], [13, 2]]);
            // the grave composed, then the acute with U+00E0, which has no composite: --features=-ccmp -u 0061,0300,0301:
            // [9=0|14=2]; and a second acute after U+00E9: -u 0065,0301,0301: [10=0|14=2]
            assert.deepStrictEqual(normalize('a\u{300}\u{301}'), [[9, 0], [14, 2]]);
            assert.deepStrictEqual(normalize('e\u{301}\u{301}'), [[10, 0], [14, 2]]);
        });

        it('normalizes each cluster of a text on its own', function() {
            // --features=-ccmp -u 0065,0301,0020,0061,0300: [10=0|1=2|9=3]
            assert.deepStrictEqual(normalize('e\u{301} a\u{300}'), [[10, 0], [1, 2], [9, 3]]);
            // the marks after a starter that follows other marks put in order too: -u 0065,0301,0061,0301,0323:
            // [10=0|11=2|14=2]; -u 0301,0061,0301,0323: [14=0|11=1|14=1]
            assert.deepStrictEqual(normalize('e\u{301}a\u{301}\u{323}'), [[10, 0], [11, 2], [14, 2]]);
            assert.deepStrictEqual(normalize('\u{301}a\u{301}\u{323}'), [[14, 0], [11, 1], [14, 1]]);
        });

        it('does not put in order a sequence of more than 32 marks', function() {
            // HB_OT_SHAPE_MAX_COMBINING_MARKS: a, 32 acutes then a dot below: [4=0|14=1|14=2|...|14=32|17=33]; a, 31
            // acutes then a dot below, put in order and composed with a: [11=0|14=0|...|14=0], 32 glyphs
            const acutes = count => '\u{301}'.repeat(count);
            assert.deepStrictEqual(normalize(`a${acutes(32)}\u{323}`),
                [[4, 0]].concat(Array.from({ length: 32 }, (value, index) => [14, index + 1]), [[17, 33]]));
            assert.deepStrictEqual(normalize(`a${acutes(31)}\u{323}`), [[11, 0]].concat(Array.from({ length: 31 }, () => [14, 0])));
        });

        it('puts the Arabic marks in the order of the modified combining classes of HarfBuzz, the shadda first', function() {
            // beh, fatha (30, 31 for HarfBuzz), shadda (33, 27 for HarfBuzz): -u 0628,064E,0651: [24=1|26=1|23=0]; beh,
            // kasra (32, 33), shadda: -u 0628,0650,0651: [25=1|26=1|23=0]
            assert.deepStrictEqual(normalize('\u{628}\u{64E}\u{651}', HarfBuzzShaper.ARABIC), [[23, 0], [26, 1], [24, 1]]);
            assert.deepStrictEqual(normalize('\u{628}\u{650}\u{651}', HarfBuzzShaper.ARABIC), [[23, 0], [26, 1], [25, 1]]);
        });

        it('moves the Arabic modifier combining marks before the other marks with the Arabic shaper only, like HarfBuzz', function() {
            // beh, fatha, hamza above (230): -u 0628,064E,0654: [24=1|27=1|23=0]; with the default shaper of HarfBuzz,
            // --script=Latn -u 0628,064E,0654: [23=0|24=1|27=2]
            assert.deepStrictEqual(normalize('\u{628}\u{64E}\u{654}', HarfBuzzShaper.ARABIC), [[23, 0], [27, 1], [24, 1]]);
            assert.deepStrictEqual(normalize('\u{628}\u{64E}\u{654}', HarfBuzzShaper.DEFAULT), [[23, 0], [24, 1], [27, 2]]);
            // the hamza below (220, not in the font), then the hamza above: -u 0628,0654,064E,0655: [24=1|27=1|0=1|23=0]
            assert.deepStrictEqual(normalize('\u{628}\u{654}\u{64E}\u{655}', HarfBuzzShaper.ARABIC), [[23, 0], [0, 1], [27, 1], [24, 1]]);
            // the mark noon ghunna (230, not in the font) moved before the fatha: -u 0628,064E,0658: [24=1|0=1|23=0]
            assert.deepStrictEqual(normalize('\u{628}\u{64E}\u{658}', HarfBuzzShaper.ARABIC), [[23, 0], [0, 1], [24, 1]]);
            // two hamza above moved together before the fatha: -u 0628,064E,0654,0654: [24=1|27=1|27=1|23=0]; and after a
            // shadda: -u 0628,0651,064E,0654,0654: [24=1|26=1|27=1|27=1|23=0]
            assert.deepStrictEqual(normalize('\u{628}\u{64E}\u{654}\u{654}', HarfBuzzShaper.ARABIC), [[23, 0], [27, 1], [27, 1], [24, 1]]);
            assert.deepStrictEqual(normalize('\u{628}\u{651}\u{64E}\u{654}\u{654}', HarfBuzzShaper.ARABIC),
                [[23, 0], [27, 1], [27, 1], [26, 1], [24, 1]]);
            // a mark of class 220 that is not a modifier combining mark (the subscript alef, not in the font), then the hamza
            // above moved before it: -u 0628,0656,0654: [0=1|27=1|23=0]; -u 0628,064E,0656,0654: [0=1|24=1|27=1|23=0]
            assert.deepStrictEqual(normalize('\u{628}\u{656}\u{654}', HarfBuzzShaper.ARABIC), [[23, 0], [27, 1], [0, 1]]);
            assert.deepStrictEqual(normalize('\u{628}\u{64E}\u{656}\u{654}', HarfBuzzShaper.ARABIC), [[23, 0], [27, 1], [24, 1], [0, 1]]);
        });

        it('moves each Arabic modifier combining mark before the vowel marks: Scheherazade, like HarfBuzz', function() {
            // beh, fatha or kasra, then the modifier combining mark: hb-shape --shapers=ot --no-glyph-names --cluster-level=1
            // --script=Arab --trace Scheherazade-Bold.ttf, the buffer of 'start table GSUB': -u 0628,064E,06DC:
            // [373=0|1132=1|1075=1]; -u 0628,0650,06E3: [373=0|1137=1|1079=1]; -u 0628,064E,06E7: [373=0|1139=1|1075=1];
            // -u 0628,064E,06E8: [373=0|1140=1|1075=1]; -u 0628,064E,08F3: [373=0|1325=1|1075=1]; -u 0628,064E,08CA:
            // [373=0|0=1|1075=1]; -u 0628,0650,08CB: [373=0|0=1|1079=1]; -u 0628,064E,08CD: [373=0|0=1|1075=1];
            // -u 0628,064E,08CE: [373=0|0=1|1075=1]; -u 0628,0650,08CF: [373=0|0=1|1079=1]; -u 0628,0650,08D3:
            // [373=0|0=1|1079=1]
            const arabicFont = parse(readFileSync('./test/fonts/Scheherazade-Bold.ttf'));
            const fatha = 1075;
            const kasra = 1079;
            const markGlyphs = [
                ['\u{64E}\u{6DC}', 1132, fatha], ['\u{650}\u{6E3}', 1137, kasra], ['\u{64E}\u{6E7}', 1139, fatha],
                ['\u{64E}\u{6E8}', 1140, fatha], ['\u{64E}\u{8F3}', 1325, fatha], ['\u{64E}\u{8CA}', 0, fatha],
                ['\u{650}\u{8CB}', 0, kasra], ['\u{64E}\u{8CD}', 0, fatha], ['\u{64E}\u{8CE}', 0, fatha],
                ['\u{650}\u{8CF}', 0, kasra], ['\u{650}\u{8D3}', 0, kasra]
            ];
            for (const [marks, modifierGlyph, vowelGlyph] of markGlyphs) {
                assert.deepStrictEqual(normalize('\u{628}' + marks, HarfBuzzShaper.ARABIC, false, arabicFont),
                    [[373, 0], [modifierGlyph, 1], [vowelGlyph, 1]], marks.codePointAt(1).toString(16));
            }
        });

        it('moves only the Arabic modifier combining marks, not the other marks of their class', function() {
            // beh, fatha, maddah above (230, not a modifier combining mark): -u 0628,064E,0653: [29=2|24=1|23=0]
            assert.deepStrictEqual(normalize('\u{628}\u{64E}\u{653}', HarfBuzzShaper.ARABIC), [[23, 0], [24, 1], [29, 2]]);
        });

        it('gives a moved Arabic modifier combining mark the class 26, so that it does not block a mark of class 230', function() {
            // alef, hamza above, maddah above in a copy of the font without U+0623: the hamza (26) moved before the maddah
            // (230), alef and the maddah composed into U+0622 across the hamza, like HarfBuzz on a copy without U+0623
            // (fontTools): -u 0627,0654,0653: [27=0|28=0]
            const fontWithoutAlefHamza = parse(readFileSync('./test/fonts/TestNormalization.ttf'));
            delete fontWithoutAlefHamza.tables.cmap.glyphIndexMap[0x0623];
            assert.deepStrictEqual(normalize('\u{627}\u{654}\u{653}', HarfBuzzShaper.ARABIC, false, fontWithoutAlefHamza), [[28, 0], [27, 0]]);
        });

        it('gives a moved Arabic modifier combining mark of class 220 the class 25, so that it blocks no mark of class 220 nor 26', function() {
            // a, hamza below (220, not in the font), dot below (220): the hamza (25) moved before the dot below, a and the
            // dot below composed into U+1EA1 across it: --script=Arab -u 0061,0655,0323: [0=0|11=0]; with the default
            // shaper, the hamza blocks the dot below: --script=Latn -u 0061,0655,0323: [4=0|0=1|17=2]
            assert.deepStrictEqual(normalize('a\u{655}\u{323}', HarfBuzzShaper.ARABIC), [[11, 0], [0, 0]]);
            assert.deepStrictEqual(normalize('a\u{655}\u{323}', HarfBuzzShaper.DEFAULT), [[4, 0], [0, 1], [17, 2]]);
            // alef, hamza below (25), hamza above (26): alef and the hamza above composed into U+0623 across the hamza
            // below: --script=Arab -u 0627,0655,0654: [0=0|21=0]
            assert.deepStrictEqual(normalize('\u{627}\u{655}\u{654}', HarfBuzzShaper.ARABIC), [[21, 0], [0, 0]]);
        });

        it('composes an Arabic letter and the modifier combining mark moved before the vowel mark', function() {
            // alef, hamza above, fatha: alef with hamza above: -u 0627,0654,064E: [24=0|21=0]; and the hamza after the
            // fatha: -u 0627,064E,0654: [24=0|21=0]
            assert.deepStrictEqual(normalize('\u{627}\u{654}\u{64E}', HarfBuzzShaper.ARABIC), [[21, 0], [24, 0]]);
            assert.deepStrictEqual(normalize('\u{627}\u{64E}\u{654}', HarfBuzzShaper.ARABIC), [[21, 0], [24, 0]]);
        });

        it('puts the Hebrew points in the order of the modified combining classes of HarfBuzz, the dagesh first', function() {
            // bet, patah (17, 20 for HarfBuzz), dagesh (21, 12 for HarfBuzz): -u 05D1,05B7,05BC: [18=1|19=1|20=0]
            assert.deepStrictEqual(normalize('\u{5D1}\u{5B7}\u{5BC}', HarfBuzzShaper.HEBREW), [[20, 0], [19, 1], [18, 1]]);
        });

        it('composes the Hebrew presentation forms with the Hebrew shaper in a font without a mark feature', function() {
            // shin with shin dot, qamats: decomposed, the shin dot (10 for HarfBuzz) before the qamats (21), shin and shin
            // dot composed again into U+FB2A: -u FB2A,05B8: [53=1|56=0]; and the same from shin: -u 05E9,05C1,05B8:
            // [53=2|56=0]
            assert.deepStrictEqual(normalize('\u{FB2A}\u{5B8}', HarfBuzzShaper.HEBREW), [[56, 0], [53, 1]]);
            assert.deepStrictEqual(normalize('\u{5E9}\u{5C1}\u{5B8}', HarfBuzzShaper.HEBREW), [[56, 0], [53, 2]]);
            // the presentation forms are excluded from the Unicode compositions of the other shapers: --script=Latn
            // -u FB2A,05B8: [55=0|54=0|53=1]
            assert.deepStrictEqual(normalize('\u{FB2A}\u{5B8}', HarfBuzzShaper.DEFAULT), [[55, 0], [54, 0], [53, 1]]);
        });

        it('composes the yod yod patah, alef qamats, sin dot and rafe presentation forms with the Hebrew shaper: FDArrayTest257', function() {
            // hb-shape --shapers=ot --no-glyph-names --cluster-level=1 --no-positions FDArrayTest257.otf -u 05F2,05B7:
            // [32=0]; -u 05D0,05B8: [48=0]; -u 05E9,05C2: [44=0]; -u 05DB,05BF: [78=0]; -u 05E4,05BF: [79=0]
            const fdArrayFont = parse(readFileSync('./test/fonts/FDArrayTest257.otf'));
            assert.deepStrictEqual(normalize('\u{5F2}\u{5B7}', HarfBuzzShaper.HEBREW, false, fdArrayFont), [[32, 0]]);
            assert.deepStrictEqual(normalize('\u{5D0}\u{5B8}', HarfBuzzShaper.HEBREW, false, fdArrayFont), [[48, 0]]);
            assert.deepStrictEqual(normalize('\u{5E9}\u{5C2}', HarfBuzzShaper.HEBREW, false, fdArrayFont), [[44, 0]]);
            assert.deepStrictEqual(normalize('\u{5DB}\u{5BF}', HarfBuzzShaper.HEBREW, false, fdArrayFont), [[78, 0]]);
            assert.deepStrictEqual(normalize('\u{5E4}\u{5BF}', HarfBuzzShaper.HEBREW, false, fdArrayFont), [[79, 0]]);
        });

        it('keeps the canonical compositions with the Hebrew shaper', function() {
            // e and acute composed into U+00E9: --script=Hebr -u 0065,0301: [10=0]
            assert.deepStrictEqual(normalize('e\u{301}', HarfBuzzShaper.HEBREW), [[10, 0]]);
        });

        it('does not compose the Hebrew presentation forms in a font with a mark feature', function() {
            // a copy of the font with an empty GPOS mark feature (fontTools): -u FB2A,05B8: [53=1|54=0|55=0], and with
            // --features=-mark: [53=1|56=0]
            assert.deepStrictEqual(normalize('\u{FB2A}\u{5B8}', HarfBuzzShaper.HEBREW, true), [[55, 0], [54, 0], [53, 1]]);
        });

        itFailsUntilFixed('moves a meteg after a patah and a hiriq before the hiriq with the Hebrew shaper: FDArrayTest257',
            'getShaperNormalization (src/normalization.mjs): no reorder_marks_hebrew, the meteg stays after the hiriq',
            function() {
                // bet, patah, hiriq, meteg: hb-shape --shapers=ot --no-glyph-names --cluster-level=1 --no-positions
                // FDArrayTest257.otf -u 05D1,05B7,05B4,05BD: [181=2|190=2|184=1|210=0]
                const fdArrayFont = parse(readFileSync('./test/fonts/FDArrayTest257.otf'));
                assert.deepStrictEqual(normalize('\u{5D1}\u{5B7}\u{5B4}\u{5BD}', HarfBuzzShaper.HEBREW, false, fdArrayFont),
                    [[210, 0], [184, 1], [190, 2], [181, 2]]);
            });

        it('maps a space the font has not to the glyph of U+0020, with its space type', function() {
            // -u 00A0,0301: [1=0|14=1]
            const [space, acute] = normalizeCharacters(font, getTextCharacters('\u{A0}\u{301}'), HarfBuzzShaper.DEFAULT, false);
            assert.deepStrictEqual([space.glyphIndex, space.spaceFallbackType, acute.glyphIndex], [1, SPACE_TYPES.SPACE, 14]);
        });

        it('maps a space the font has not to .notdef in a font without U+0020', function() {
            // hb-shape --shapers=ot --no-glyph-names --cluster-level=1 --no-positions LookupFlags.ttf -u 00A0: [0=0]
            const lookupFlagsFont = parse(readFileSync('./test/fonts/LookupFlags.ttf'));
            const [space] = normalizeCharacters(lookupFlagsFont, getTextCharacters('\u{A0}'), HarfBuzzShaper.DEFAULT, false);
            assert.deepStrictEqual([space.glyphIndex, space.spaceFallbackType], [0, SPACE_TYPES.NOT_SPACE]);
        });

        it('maps a space the font has not to the glyphs of its decomposition before the glyph of U+0020', function() {
            // U+2001 EM QUAD into U+2003 EM SPACE, which TestSpaceFallback.ttf has (glyph 8): hb-shape --shapers=ot
            // --no-glyph-names --cluster-level=1 --no-positions TestSpaceFallback.ttf -u 2001: [8=0]
            const spaceFont = parse(readFileSync('./test/fonts/TestSpaceFallback.ttf'));
            const [space] = normalizeCharacters(spaceFont, getTextCharacters('\u{2001}'), HarfBuzzShaper.DEFAULT, false);
            assert.deepStrictEqual([space.char, space.glyphIndex, space.spaceFallbackType], ['\u{2003}', 8, SPACE_TYPES.NOT_SPACE]);
        });

        it('maps U+2011 NON-BREAKING HYPHEN the font has not to the glyph of U+2010 HYPHEN, .notdef without it', function() {
            // TestSpaceFallback.ttf has U+2010 (glyph 9), LookupFlags.ttf has not: hb-shape --shapers=ot --no-glyph-names
            // --cluster-level=1 --no-positions TestSpaceFallback.ttf -u 2011: [9=0]; LookupFlags.ttf -u 2011: [0=0]
            const spaceFont = parse(readFileSync('./test/fonts/TestSpaceFallback.ttf'));
            const lookupFlagsFont = parse(readFileSync('./test/fonts/LookupFlags.ttf'));
            assert.deepStrictEqual(normalize('\u{2011}', HarfBuzzShaper.DEFAULT, false, spaceFont), [[9, 0]]);
            assert.deepStrictEqual(normalize('\u{2011}', HarfBuzzShaper.DEFAULT, false, lookupFlagsFont), [[0, 0]]);
        });

        it('keeps a space or U+2011 the font has before a mark or in an Indic run, without the fallbacks: FDArrayTest257', function() {
            // hb-shape --shapers=ot --no-glyph-names --cluster-level=1 FDArrayTest257.otf -u 0915,00A0:
            // [22=0+1000|161=1+1000]; -u 2002,0301: [3=0+1000|2=1@-1003,790+0]; -u 2011,0301: [18=0+1000|2=1@-1003,778+0]
            const fdArrayFont = parse(readFileSync('./test/fonts/FDArrayTest257.otf'));
            assert.deepStrictEqual(normalize('\u{915}\u{A0}', HarfBuzzShaper.INDIC, false, fdArrayFont), [[22, 0], [161, 1]]);
            assert.deepStrictEqual(normalize('\u{2011}\u{301}', HarfBuzzShaper.DEFAULT, false, fdArrayFont), [[18, 0], [2, 1]]);
            const [space, acute] = normalizeCharacters(fdArrayFont, getTextCharacters('\u{2002}\u{301}'), HarfBuzzShaper.DEFAULT, false);
            assert.deepStrictEqual([space.glyphIndex, space.spaceFallbackType, acute.glyphIndex], [3, SPACE_TYPES.NOT_SPACE, 2]);
        });

        it('does not decompose a character whose first character the font has not', function() {
            // U+00F2 into o, which the font has not, and the grave, which it has: -u 00F2: [0=0]
            assert.deepStrictEqual(normalize('\u{F2}'), [[0, 0]]);
        });

        it('composes a base and a mark in a font parsed with lowMemory', function() {
            // -u 0065,0301: [10=0]
            const lowMemoryFont = parse(readFileSync('./test/fonts/TestNormalization.ttf'), { lowMemory: true });
            assert.deepStrictEqual(normalize('e\u{301}', HarfBuzzShaper.DEFAULT, false, lowMemoryFont), [[10, 0]]);
        });

        it('maps the characters of a cluster with a variation selector to the glyphs of the cmap, without the fallbacks', function() {
            // U+00A0, the acute and U+FE00 VARIATION SELECTOR-1: .notdef for U+00A0, -u 00A0,0301,FE00: [0=0|14=1|1=2]
            // (HarfBuzz hides the selector with the glyph of the space later, see hb_ot_hide_default_ignorables)
            const [space, acute] = normalizeCharacters(font, getTextCharacters('\u{A0}\u{301}\u{FE00}'), HarfBuzzShaper.DEFAULT, false);
            assert.deepStrictEqual([space.glyphIndex, space.spaceFallbackType, acute.glyphIndex], [0, SPACE_TYPES.NOT_SPACE, 14]);
            // the selector before the acute: -u 00A0,FE00,0301: [0=0|1=1|14=2]
            const [spaceBeforeSelector, , acuteAfterSelector] = normalizeCharacters(font, getTextCharacters('\u{A0}\u{FE00}\u{301}'), HarfBuzzShaper.DEFAULT, false);
            assert.deepStrictEqual(
                [spaceBeforeSelector.glyphIndex, spaceBeforeSelector.spaceFallbackType, acuteAfterSelector.glyphIndex],
                [0, SPACE_TYPES.NOT_SPACE, 14]
            );
            // the selector first, then U+0340, which the font has not: not decomposed into the grave, -u FE00,0340: [1=0|0=1]
            // (without the selector, -u 0340: [13=0])
            assert.deepStrictEqual(normalize('\u{FE00}\u{340}'), [[0, 0], [0, 1]]);
        });

        it('composes the marks of a cluster with a variation selector', function() {
            // e, the acute and U+FE00: e and the acute composed into U+00E9 after handle_variation_selector_cluster,
            // -u 0065,0301,FE00 --trace, start table GSUB: [10=0|0=2] (HarfBuzz hides the selector later)
            assert.deepStrictEqual(normalize('e\u{301}\u{FE00}'), [[10, 0], [0, 2]]);
        });

        it('gives the characters after the normalization, with their modified combining classes', function() {
            // U+00C0 decomposed, the shadda (27 for HarfBuzz) moved before its grave (230): -u 00C0,0651: [2=0|26=0|13=0]
            assert.deepStrictEqual(normalizeCharacters(font, getTextCharacters('\u{C0}\u{651}'), HarfBuzzShaper.DEFAULT, false), [
                { char: 'A', cluster: 0, glyphIndex: 2, spaceFallbackType: SPACE_TYPES.NOT_SPACE, combiningClass: 0 },
                { char: '\u{651}', cluster: 0, glyphIndex: 26, spaceFallbackType: SPACE_TYPES.NOT_SPACE, combiningClass: 27 },
                { char: '\u{300}', cluster: 0, glyphIndex: 13, spaceFallbackType: SPACE_TYPES.NOT_SPACE, combiningClass: 230 }
            ]);
        });

        it('gives nothing for no characters', function() {
            assert.deepStrictEqual(normalizeCharacters(font, [], HarfBuzzShaper.DEFAULT, false), []);
        });

        it('throws on an unknown shaper', function() {
            assert.throws(() => normalizeCharacters(font, getTextCharacters('a'), 'deva', false), /Unknown shaper deva/);
        });

        it('normalizes like the default shaper with the Thai shaper', function() {
            // --script=Thai -u 0065,0301: [10=0]; --script=Thai -u 00C0: [2=0|13=0]; a precomposed character the font
            // has, kept the shortest way: --script=Thai -u 00E9: [10=0]
            assert.deepStrictEqual(normalize('e\u{301}', HarfBuzzShaper.THAI), [[10, 0]]);
            assert.deepStrictEqual(normalize('\u{C0}', HarfBuzzShaper.THAI), [[2, 0], [13, 0]]);
            assert.deepStrictEqual(normalize('\u{E9}', HarfBuzzShaper.THAI), [[10, 0]]);
        });
    });

    describe('normalizeCharacters, the default shaper', function() {
        it('composes a mark with the base across a mark that does not compose with it', function() {
            // U, the dot below (220, no U+1EE4) then the dieresis (230), composed into U+00DC: -u 0055,0323,0308: [8=0|17=0]
            assert.deepStrictEqual(normalize('U\u{323}\u{308}'), [[8, 0], [17, 0]]);
        });

        it('does not decompose a character into a mark the font has not', function() {
            // U+00C3 into A and U+0303, which the font has not: -u 00C3: [0=0]
            assert.deepStrictEqual(normalize('\u{C3}'), [[0, 0]]);
        });

        it('decomposes a precomposed character of a cluster of marks all the way down: Source Sans', function() {
            // U+01D5 and U+0323 into U, the dot below (composed into U+1EE4), the dieresis and the macron, though the font
            // has U+00DC: hb-shape --features=-ccmp --no-glyph-names --cluster-level=1 --no-positions
            // SourceSansPro-Regular.otf -u 01D5,0323: [200=0|770=0|764=0]
            const sourceSansFont = parse(readFileSync('./test/fonts/SourceSansPro-Regular.otf'));
            assert.deepStrictEqual(normalize('\u{1D5}\u{323}', HarfBuzzShaper.DEFAULT, false, sourceSansFont), [[200, 0], [770, 0], [764, 0]]);
        });

        it('merges the cluster of a mark moved before a mark of a decomposed character', function() {
            // U+00C0 into A and the grave, the dot below of the next cluster moved before the grave: -u 00C0,0323:
            // [2=0|17=0|13=0]
            assert.deepStrictEqual(normalize('\u{C0}\u{323}'), [[2, 0], [17, 0], [13, 0]]);
        });

        it('merges the clusters up to the end of the cluster of the last mark it moves before', function() {
            // ka, the vowel sign u (132, 131 for HarfBuzz), U+0F73 decomposed into the vowel signs aa (129) and i (130, 132
            // for HarfBuzz): aa moved before u, the i after it keeps their merged cluster: -u 0F40,0F74,0F73:
            // [57=0|58=1|60=1|59=1]
            assert.deepStrictEqual(normalize('\u{F40}\u{F74}\u{F73}'), [[57, 0], [58, 1], [60, 1], [59, 1]]);
        });

        it('composes a mark with its base after a sequence of marks longer than the arguments of a function call', function() {
            // a, 200000 U+0316 (220, not in the font) then the grave, composed with a into U+00E0 in one cluster:
            // --features=-ccmp --text-file=<the text>: [9=0|0=0|...|0=0]
            const markCount = 200000;
            const normalizedCharacters = normalize(`a${'\u{316}'.repeat(markCount)}\u{300}`);
            // compared without a deepStrictEqual of the whole list, whose diff would be too long
            assert.deepStrictEqual(normalizedCharacters[0], [9, 0]);
            assert.strictEqual(normalizedCharacters.length, markCount + 1);
            assert.ok(normalizedCharacters.slice(1).every(([glyphIndex, cluster]) => glyphIndex === 0 && cluster === 0));
        });

        it('composes the split vowel signs of the Indic scripts', function() {
            // --script=Latn -u 0995,09C7,09BE: [30=0|36=1]; and a nukta into a character excluded from composition,
            // --script=Latn -u 09AF,09BC: [32=0|33=1]
            assert.deepStrictEqual(normalize('\u{995}\u{9C7}\u{9BE}'), [[30, 0], [36, 1]]);
            assert.deepStrictEqual(normalize('\u{9AF}\u{9BC}'), [[32, 0], [33, 1]]);
        });

        it('keeps the characters the font has the shortest way', function() {
            // --script=Latn -u 09DF: [38=0]; --script=Latn -u 1026: [62=0]
            assert.deepStrictEqual(normalize('\u{9DF}'), [[38, 0]]);
            assert.deepStrictEqual(normalize('\u{1026}'), [[62, 0]]);
        });

        it('decomposes a Hangul syllable before a mark, and never composes the jamo', function() {
            // --script=Latn -u AC01,0301: [47=0|48=0|49=0|14=1]; --script=Latn -u 1100,1161,0301: [47=0|48=1|14=2]
            assert.deepStrictEqual(normalize('\u{AC01}\u{301}'), [[47, 0], [48, 0], [49, 0], [14, 1]]);
            assert.deepStrictEqual(normalize('\u{1100}\u{1161}\u{301}'), [[47, 0], [48, 1], [14, 2]]);
        });
    });

    describe('normalizeCharacters, the Indic shaper', function() {
        it('does not compose the split vowel signs', function() {
            // ka, the vowel signs e and aa: --trace -u 0995,09C7,09BE: [30=0|35=1|34=2] (then [35=0|30=0|34=2])
            assert.deepStrictEqual(normalize('\u{995}\u{9C7}\u{9BE}', HarfBuzzShaper.INDIC), [[30, 0], [35, 1], [34, 2]]);
        });

        it('decomposes the characters the font has, the split vowel signs too', function() {
            // ka, the vowel sign o into e and aa: --trace -u 0995,09CB: [30=0|35=1|34=1]; yya into ya and nukta, not
            // composed again in a text without marks: --trace -u 09DF: [32=0|33=0]
            assert.deepStrictEqual(normalize('\u{995}\u{9CB}', HarfBuzzShaper.INDIC), [[30, 0], [35, 1], [34, 1]]);
            assert.deepStrictEqual(normalize('\u{9DF}', HarfBuzzShaper.INDIC), [[32, 0], [33, 0]]);
        });

        it('does not decompose the characters of decompose_indic', function() {
            // rra (U+09DC, dda and nukta): --trace -u 09DC: [37=0]; ka, rra, nukta: --trace -u 0995,09DC,09BC:
            // [30=0|37=1|33=2]
            assert.deepStrictEqual(normalize('\u{9DC}', HarfBuzzShaper.INDIC), [[37, 0]]);
            assert.deepStrictEqual(normalize('\u{995}\u{9DC}\u{9BC}', HarfBuzzShaper.INDIC), [[30, 0], [37, 1], [33, 2]]);
            // the others, in FDArrayTest257.otf, which has their glyphs and the ones of their decompositions, and no GSUB:
            // hb-shape --shapers=ot --no-glyph-names --cluster-level=1 --no-positions FDArrayTest257.otf -u 0931: [50=0];
            // -u 09DD: [222=0]; -u 0B94: [149=0]
            const fdArrayFont = parse(readFileSync('./test/fonts/FDArrayTest257.otf'));
            assert.deepStrictEqual(normalize('\u{931}', HarfBuzzShaper.INDIC, false, fdArrayFont), [[50, 0]]);
            assert.deepStrictEqual(normalize('\u{9DD}', HarfBuzzShaper.INDIC, false, fdArrayFont), [[222, 0]]);
            assert.deepStrictEqual(normalize('\u{B94}', HarfBuzzShaper.INDIC, false, fdArrayFont), [[149, 0]]);
        });

        it('composes ya and nukta into yya', function() {
            // --trace -u 09AF,09BC: [38=0]
            assert.deepStrictEqual(normalize('\u{9AF}\u{9BC}', HarfBuzzShaper.INDIC), [[38, 0]]);
        });

        it('decomposes the nukta letters the font has, composing again only a canonical composite before a mark', function() {
            // qa, excluded from composition (nukt composes it again in GSUB): --trace -u 0958: [64=0|65=0]; -u 0958,0947:
            // [64=0|65=0|69=1]; nnna, a canonical composite: --trace -u 0929: [67=0|65=0]; -u 0928,093C,0947: [68=0|69=2]
            assert.deepStrictEqual(normalize('\u{958}', HarfBuzzShaper.INDIC), [[64, 0], [65, 0]]);
            assert.deepStrictEqual(normalize('\u{958}\u{947}', HarfBuzzShaper.INDIC), [[64, 0], [65, 0], [69, 1]]);
            assert.deepStrictEqual(normalize('\u{929}', HarfBuzzShaper.INDIC), [[67, 0], [65, 0]]);
            assert.deepStrictEqual(normalize('\u{928}\u{93C}\u{947}', HarfBuzzShaper.INDIC), [[68, 0], [69, 2]]);
        });
    });

    describe('normalizeCharacters, the Khmer, Myanmar and USE shapers', function() {
        it('keeps the split vowel signs with the Khmer shaper, without its decompose_khmer', function() {
            // the fork has not the reordering and the features of the Khmer shaper that merge U+17C1 and the split vowel
            // sign again; ka, the vowel sign oe: --script=Latn -u 1780,17BE: [39=0|40=1]; ka, the vowel signs e and oe:
            // --script=Latn -u 1780,17C1,17BE: [39=0|41=1|40=2]
            assert.deepStrictEqual(normalize('\u{1780}\u{17BE}', HarfBuzzShaper.KHMER), [[39, 0], [40, 1]]);
            assert.deepStrictEqual(normalize('\u{1780}\u{17C1}\u{17BE}', HarfBuzzShaper.KHMER), [[39, 0], [41, 1], [40, 2]]);
        });

        it('decomposes the characters the font has with the Khmer shaper, and composes a mark with a base only', function() {
            // ka, U+00E9 into e and the acute, not composed again in a text without marks: --script=Khmr --trace
            // -u 1780,00E9, start table GSUB: [39=0|5=1|14=1]; akara, ra repa, tedung: --script=Khmr -u 1B05,1B3A,1B35:
            // [42=0|45=1|44=2]
            assert.deepStrictEqual(normalize('\u{1780}\u{E9}', HarfBuzzShaper.KHMER), [[39, 0], [5, 1], [14, 1]]);
            assert.deepStrictEqual(normalize('\u{1B05}\u{1B3A}\u{1B35}', HarfBuzzShaper.KHMER), [[42, 0], [45, 1], [44, 2]]);
            // the singleton U+2001 EM QUAD into U+2003 EM SPACE, though the font has both: hb-shape --shapers=ot
            // --no-glyph-names --cluster-level=1 --no-positions --script=Khmr FDArrayTest257.otf -u 1780,2001:
            // [129=0|4=1]
            const fdArrayFont = parse(readFileSync('./test/fonts/FDArrayTest257.otf'));
            assert.deepStrictEqual(normalize('\u{1780}\u{2001}', HarfBuzzShaper.KHMER, false, fdArrayFont), [[129, 0], [4, 1]]);
        });

        itFailsUntilFixed('decomposes the split vowel signs of Khmer into U+17C1 and themselves',
            'getShaperNormalization (src/normalization.mjs): no decompose_khmer until the fork has the reordering and the pref, abvf and pstf of the Khmer shaper',
            function() {
                // ka, the vowel sign oe: --trace -u 1780,17BE, start table GSUB: [39=0|41=1|40=1]
                assert.deepStrictEqual(normalize('\u{1780}\u{17BE}', HarfBuzzShaper.KHMER), [[39, 0], [41, 1], [40, 1]]);
            });

        it('decomposes the characters the font has with the Myanmar shaper, then composes them before a mark', function() {
            // uu into u and the vowel sign ii: -u 1026: [61=0|63=0]; u and ii: -u 1025,102E: [62=0]
            assert.deepStrictEqual(normalize('\u{1026}', HarfBuzzShaper.MYANMAR), [[61, 0], [63, 0]]);
            assert.deepStrictEqual(normalize('\u{1025}\u{102E}', HarfBuzzShaper.MYANMAR), [[62, 0]]);
        });

        it('decomposes the characters the font has with the USE, and composes a mark with a base only', function() {
            // akara tedung into akara and tedung: -u 1B06: [42=0|44=0]; akara, ra repa, tedung: -u 1B05,1B3A,1B35:
            // [42=0|45=1|44=2]; akara, ra repa tedung: -u 1B05,1B3B: [42=0|45=1|44=1]; akara tedung, ra repa, decomposed
            // and composed again: -u 1B06,1B3A: [43=0|45=1]
            assert.deepStrictEqual(normalize('\u{1B06}', HarfBuzzShaper.USE), [[42, 0], [44, 0]]);
            assert.deepStrictEqual(normalize('\u{1B05}\u{1B3A}\u{1B35}', HarfBuzzShaper.USE), [[42, 0], [45, 1], [44, 2]]);
            assert.deepStrictEqual(normalize('\u{1B05}\u{1B3B}', HarfBuzzShaper.USE), [[42, 0], [45, 1], [44, 1]]);
            assert.deepStrictEqual(normalize('\u{1B06}\u{1B3A}', HarfBuzzShaper.USE), [[43, 0], [45, 1]]);
        });
    });

    describe('normalizeCharacters, the Hangul shaper', function() {
        it('keeps a syllable the font has before a mark, and composes nothing', function() {
            // -u AC01,0301: [52=0|14=1]
            assert.deepStrictEqual(normalize('\u{AC01}\u{301}', HarfBuzzShaper.HANGUL), [[52, 0], [14, 1]]);
            // e and the acute: --script=Hang -u 0065,0301: [5=0|14=1]; U+00E9 and the dot below, U+00E9 kept:
            // --script=Hang -u 00E9,0323: [10=0|17=1]
            assert.deepStrictEqual(normalize('e\u{301}', HarfBuzzShaper.HANGUL), [[5, 0], [14, 1]]);
            assert.deepStrictEqual(normalize('\u{E9}\u{323}', HarfBuzzShaper.HANGUL), [[10, 0], [17, 1]]);
        });

        it('puts the marks in canonical order without composing them', function() {
            // --script=Hang -u 0065,0301,0323: [5=0|17=1|14=1]; --script=Hang -u AC00,0301,0323: [51=0|17=1|14=1]
            assert.deepStrictEqual(normalize('e\u{301}\u{323}', HarfBuzzShaper.HANGUL), [[5, 0], [17, 1], [14, 1]]);
            assert.deepStrictEqual(normalize('\u{AC00}\u{301}\u{323}', HarfBuzzShaper.HANGUL), [[51, 0], [17, 1], [14, 1]]);
        });

        itFailsUntilFixed('decomposes a syllable LVT the font has not into its jamo L, V and T',
            'normalizeCharacters (src/normalization.mjs): no preprocess_text_hangul, U+AC04 decomposed the shortest way into U+AC00 and U+11AB',
            function() {
                // -u AC04: [47=0|48=0|50=0]
                assert.deepStrictEqual(normalize('\u{AC04}', HarfBuzzShaper.HANGUL), [[47, 0], [48, 0], [50, 0]]);
            });

        itFailsUntilFixed('composes the jamo L and V into the syllable the font has',
            'normalizeCharacters (src/normalization.mjs): no preprocess_text_hangul, U+1100 U+1161 kept as they are',
            function() {
                // -u 1100,1161: [51=0]
                assert.deepStrictEqual(normalize('\u{1100}\u{1161}', HarfBuzzShaper.HANGUL), [[51, 0]]);
            });
    });
});
