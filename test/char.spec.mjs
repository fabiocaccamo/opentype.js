import assert from 'assert';
import {
    getArabicJoiningType,
    getCharScript,
    getCharScriptExtensions,
    getCharTextScript,
    getScriptRuns,
    getSpaceFallbackType,
    isArabicChar,
    isVariationSelector,
    isVariationSequenceSelector,
    SPACE_TYPES
} from '../src/char.mjs';
import { itFailsUntilFixed } from './regression/helpers.mjs';

// the Script property of the characters, from fontTools: python -c "from fontTools import unicodedata;
// print(unicodedata.script('҅'))" gives Zinh (Inherited), ';' Zyyy (Common), 'Ϣ' Copt (Coptic)
describe('char.mjs', function() {
    describe('getCharScript', function() {
        function assertScript(chars, script) {
            for (const char of chars) {
                const codePoint = 'U+' + char.codePointAt(0).toString(16).toUpperCase();
                assert.equal(getCharScript(char), script, codePoint);
            }
        }

        it('gives Thai for the Thai script', function() {
            assertScript(['ก', 'เ', '๛'], 'Thai');
        });

        it('gives Arab for the Arabic script, also outside the ranges of isArabicChar', function() {
            // alef, the Arabic-Indic digits, the full stop, ae, dal with inverted v, the Extended Arabic-Indic
            // digits, the Arabic Supplement, Extended-A and the presentation forms
            assertScript([
                'ا', '٠', '١', '۔', 'ە', 'ۮ', '۰', '۱',
                'ݐ', 'ݗ', 'ࢠ', 'ﭐ', 'ﹰ', 'ﺏ'
            ], 'Arab');
        });

        it('gives Hebr, Cyrl and Grek for the Hebrew, Cyrillic and Greek scripts', function() {
            assertScript(['א', 'ת', 'ִ', 'שׁ'], 'Hebr');
            assertScript(['А', 'я', 'Ԁ', 'Ꙁ', '\u{1E030}'], 'Cyrl');
            assertScript(['Α', 'ω', 'μ', 'ἀ', 'Ͽ'], 'Grek');
        });

        it('gives Zyyy, Zinh and Zzzz for the Common, Inherited and Unknown scripts', function() {
            // also the Arabic comma, question mark and tatweel and the Thai baht
            assertScript(['1', '!', ' ', '.', ';', 'µ', '،', '؟', 'ـ', '฿', '\u{0}'], 'Zyyy');
            assertScript(['́', '҅'], 'Zinh');
            // private use, unassigned (also in the Thai block, and the last code point), surrogate
            assertScript(['\u{E000}', '\u{378}', '\u{E00}', '\u{10FFFF}', '\uD800'], 'Zzzz');
        });

        it('gives the ISO 15924 code of the other scripts', function() {
            const scripts = [
                ['A', 'Latn'], ['ə', 'Latn'], ['Ϣ', 'Copt'], ['Ա', 'Armn'], ['ꨀ', 'Cham'], ['一', 'Hani'], ['ა', 'Geor'],
                ['あ', 'Hira'], ['ア', 'Kana'], ['ກ', 'Laoo'], ['ꀀ', 'Yiii'], ['ߊ', 'Nkoo'], ['ꔀ', 'Vaii'], ['क', 'Deva']
            ];
            for (const [char, script] of scripts) {
                assertScript([char], script);
            }
        });
    });

    // the Script_Extensions of ScriptExtensions.txt (Unicode 16.0.0): 0640 ; Adlm Arab Mand Mani Ougr Phlp Rohg Sogd Syrc,
    // 064B..0655 ; Arab Syrc, 060C ; Arab Gara Nkoo Rohg Syrc Thaa Yezi; the chars it does not list have their Script only
    describe('getCharScriptExtensions', function() {
        it('gives the Script_Extensions of the chars that ScriptExtensions.txt lists', function() {
            assert.deepStrictEqual(getCharScriptExtensions('\u{640}'), ['Adlm', 'Arab', 'Mand', 'Mani', 'Ougr', 'Phlp', 'Rohg', 'Sogd', 'Syrc']);
            // the first and the last char of the range of the harakat
            assert.deepStrictEqual(getCharScriptExtensions('\u{64B}'), ['Arab', 'Syrc']);
            assert.deepStrictEqual(getCharScriptExtensions('\u{655}'), ['Arab', 'Syrc']);
            assert.deepStrictEqual(getCharScriptExtensions('\u{60C}'), ['Arab', 'Gara', 'Nkoo', 'Rohg', 'Syrc', 'Thaa', 'Yezi']);
        });

        it('gives the Script of the other chars', function() {
            // the char after the range of the harakat (Arab), a Latin letter, a digit, the first and the last code point
            assert.deepStrictEqual(getCharScriptExtensions('\u{656}'), ['Arab']);
            assert.deepStrictEqual(getCharScriptExtensions('a'), ['Latn']);
            assert.deepStrictEqual(getCharScriptExtensions('1'), ['Zyyy']);
            assert.deepStrictEqual(getCharScriptExtensions('\u{0}'), ['Zyyy']);
            assert.deepStrictEqual(getCharScriptExtensions('\u{10FFFF}'), ['Zzzz']);
        });
    });

    // the blocks of Blocks.txt (Unicode 16.0.0): FB50..FDFF Arabic Presentation Forms-A, whose ornate parentheses U+FD3E
    // and U+FD3F are of the Common script (Scripts.txt), FE70..FEFF Arabic Presentation Forms-B, whose last char U+FEFF
    // ZERO WIDTH NO-BREAK SPACE is of the Common script
    describe('isArabicChar', function() {
        it('gives true for the chars of the Arabic script of the Arabic Presentation Forms-A and -B blocks, as HarfBuzz lays them out from right to left', function() {
            for (const char of ['\u{628}', '\u{FB50}', '\u{FB58}', '\u{FD3D}', '\u{FD40}', '\u{FDFF}', '\u{FE70}', '\u{FE92}', '\u{FEDB}', '\u{FEFC}']) {
                assert.equal(isArabicChar(char), true, char.codePointAt(0).toString(16));
            }
        });

        it('gives false for the chars around these blocks and for their chars of the Common script', function() {
            for (const char of ['a', '\u{FB4F}', '\u{FD3E}', '\u{FD3F}', '\u{FE00}', '\u{FE6F}', '\u{FEFF}', '\u{FF01}']) {
                assert.equal(isArabicChar(char), false, char.codePointAt(0).toString(16));
            }
        });
    });

    describe('isVariationSequenceSelector', function() {
        it('gives true for the Mongolian free variation selectors and the variation selectors', function() {
            for (const char of ['\u{180B}', '\u{180D}', '\u{FE00}', '\u{FE0F}', '\u{E0100}', '\u{E01EF}']) {
                assert.equal(isVariationSequenceSelector(char), true, char.codePointAt(0).toString(16));
            }
        });

        it('gives false for the other chars and for null', function() {
            for (const char of ['a', '\u{180A}', '\u{180E}', '\u{FDFF}', '\u{FE10}', '\u{E00FF}', '\u{E01F0}']) {
                assert.equal(isVariationSequenceSelector(char), false, char.codePointAt(0).toString(16));
            }
            assert.equal(isVariationSequenceSelector(null), false);
        });
    });

    describe('isVariationSelector', function() {
        // hb_unicode_funcs_t::is_variation_selector, hb-unicode.hh of HarfBuzz 11.3.2
        it('gives true for the variation selectors 1 to 16 and of the supplement', function() {
            for (const char of ['\u{FE00}', '\u{FE0F}', '\u{E0100}', '\u{E01EF}']) {
                assert.equal(isVariationSelector(char), true, char.codePointAt(0).toString(16));
            }
        });

        it('gives false for the Mongolian free variation selectors, the other chars and null', function() {
            for (const char of ['a', '\u{180B}', '\u{180C}', '\u{180D}', '\u{180F}', '\u{FDFF}', '\u{FE10}', '\u{E00FF}', '\u{E01F0}']) {
                assert.equal(isVariationSelector(char), false, char.codePointAt(0).toString(16));
            }
            assert.equal(isVariationSelector(null), false);
        });
    });

    describe('getSpaceFallbackType', function() {
        it('gives the space type of HarfBuzz to each space of the Zs general category but U+1680', function() {
            // the Zs chars of fontTools (Unicode 17.0.0): python -c "from fontTools import unicodedata; print([hex(c) for c
            // in range(0x110000) if unicodedata.category(chr(c)) == 'Zs'])"; their types are the ones of
            // hb_unicode_funcs_t::space_fallback_type (hb-unicode.hh of HarfBuzz 11.3.2)
            const expectedTypes = [
                [0x0020, SPACE_TYPES.SPACE], [0x00A0, SPACE_TYPES.SPACE], [0x1680, SPACE_TYPES.NOT_SPACE],
                [0x2000, SPACE_TYPES.EM_2], [0x2001, SPACE_TYPES.EM], [0x2002, SPACE_TYPES.EM_2], [0x2003, SPACE_TYPES.EM],
                [0x2004, SPACE_TYPES.EM_3], [0x2005, SPACE_TYPES.EM_4], [0x2006, SPACE_TYPES.EM_6],
                [0x2007, SPACE_TYPES.FIGURE], [0x2008, SPACE_TYPES.PUNCTUATION], [0x2009, SPACE_TYPES.EM_5],
                [0x200A, SPACE_TYPES.EM_16], [0x202F, SPACE_TYPES.NARROW], [0x205F, SPACE_TYPES.FOUR_EM_18],
                [0x3000, SPACE_TYPES.EM]
            ];
            for (const [codePoint, spaceType] of expectedTypes) {
                assert.strictEqual(getSpaceFallbackType(String.fromCodePoint(codePoint)), spaceType, codePoint.toString(16));
            }
        });

        it('gives NOT_SPACE to the other chars', function() {
            // U+200B ZERO WIDTH SPACE and U+FEFF ZERO WIDTH NO-BREAK SPACE (Cf), U+2011 NON-BREAKING HYPHEN, U+2028 LINE
            // SEPARATOR (Zl)
            for (const char of ['a', '\t', '\u{200B}', '\u{2011}', '\u{2028}', '\u{FEFF}', '\u{1F600}']) {
                assert.strictEqual(getSpaceFallbackType(char), SPACE_TYPES.NOT_SPACE, char.codePointAt(0).toString(16));
            }
        });

        it('gives the space types the values of HarfBuzz, an em divided by the value of EM_n', function() {
            // enum space_t of hb_unicode_funcs_t
            assert.deepStrictEqual(SPACE_TYPES, {
                NOT_SPACE: 0, EM: 1, EM_2: 2, EM_3: 3, EM_4: 4, EM_5: 5, EM_6: 6, EM_16: 16, FOUR_EM_18: 17, SPACE: 18,
                FIGURE: 19, PUNCTUATION: 20, NARROW: 21
            });
        });
    });

    describe('getCharTextScript', function() {
        it('gives the script of a char of a script, none for the Common, Inherited and Unknown scripts', function() {
            assert.equal(getCharTextScript('A'), 'Latn');
            assert.equal(getCharTextScript('ก'), 'Thai');
            for (const char of ['1', ' ', '\u{301}', '\u{64E}', '\u{E000}', '\u{378}']) {
                assert.equal(getCharTextScript(char), undefined, char.codePointAt(0).toString(16));
            }
        });

        it('gives no script for a variation selector, also a Mongolian free variation selector of the Mongolian script', function() {
            assert.equal(getCharScript('\u{180B}'), 'Mong');
            assert.equal(getCharTextScript('\u{180B}'), undefined);
            assert.equal(getCharTextScript('\u{FE0F}'), undefined);
        });
    });

    // the Joining_Type of ArabicShaping.txt (Unicode 16.0.0); the chars it does not list are T when their General_Category
    // is Mn, Me or Cf, otherwise U
    describe('getArabicJoiningType', function() {
        function assertJoiningType(chars, joiningType) {
            for (const char of chars) {
                const codePoint = 'U+' + char.codePointAt(0).toString(16).toUpperCase();
                assert.equal(getArabicJoiningType(char), joiningType, codePoint);
            }
        }

        it('gives D for the dual-joining letters and for the join causing tatweel and zero width joiner', function() {
            // kashmiri yeh, beh, seen, heh, yeh, dotless beh, heh goal with hamza above, farsi yeh, the last letters of the block
            assertJoiningType(['\u{620}', '\u{628}', '\u{633}', '\u{647}', '\u{64A}', '\u{66E}', '\u{6C2}', '\u{6CC}', '\u{6FA}', '\u{6FF}'], 'D');
            // Joining_Type C in ArabicShaping.txt, JOINING_TYPE_C = JOINING_TYPE_D in hb-ot-shaper-arabic.cc of HarfBuzz 11.3.2
            assertJoiningType(['\u{640}', '\u{200D}'], 'D');
        });

        it('gives R for the right-joining letters', function() {
            // alef with madda above, alef, teh marbuta, dal, reh, zain, waw, alef wasla, heh with yeh above, teh marbuta goal,
            // yeh barree, ae, dal and reh with inverted v
            assertJoiningType(['\u{622}', '\u{627}', '\u{629}', '\u{62F}', '\u{631}', '\u{632}', '\u{648}', '\u{671}', '\u{6C0}', '\u{6C3}', '\u{6D2}', '\u{6D5}', '\u{6EE}', '\u{6EF}'], 'R');
        });

        it('gives T for the transparent marks and U for the non-joining chars', function() {
            // the harakat, the superscript alef, the small high ligatures, the Arabic letter mark
            assertJoiningType(['\u{610}', '\u{61C}', '\u{64B}', '\u{650}', '\u{65F}', '\u{670}', '\u{6D6}', '\u{6ED}'], 'T');
            // the number sign, the comma, the hamza, the Arabic-Indic digits, the high hamza, the full stop, the end of ayah,
            // the small waw, the Extended Arabic-Indic digits, the sindhi ampersand, a Latin letter, the zero width non-joiner
            assertJoiningType(['\u{600}', '\u{60C}', '\u{621}', '\u{660}', '\u{674}', '\u{6D4}', '\u{6DD}', '\u{6E5}', '\u{6F0}', '\u{6FD}', 'a', '\u{200C}'], 'U');
        });

        it('gives T for the nonspacing marks, enclosing marks and format chars that ArabicShaping.txt does not list', function() {
            // the soft hyphen, the left-to-right and right-to-left marks, the word joiner, the combining grapheme joiner,
            // the combining grave, an enclosing circle, a musical combining mark outside the BMP (Mn)
            assertJoiningType(['\u{AD}', '\u{200E}', '\u{200F}', '\u{2060}', '\u{34F}', '\u{300}', '\u{20DD}', '\u{1D167}'], 'T');
        });

        it('gives U for the format chars that ArabicShaping.txt lists as non-joining', function() {
            // the Arabic number signs, the end of ayah, the pound mark above, the disputed end of ayah, the Mongolian vowel
            // separator, the zero width non-joiner, the bidi isolates, the Kaithi number signs; each one between two behs:
            // hb-shape --shapers=ot --no-positions Scheherazade-Bold.ttf -u 0628,<code point>,0628 gives isolated behs 373
            assertJoiningType([
                '\u{600}', '\u{601}', '\u{602}', '\u{603}', '\u{604}', '\u{605}', '\u{6DD}', '\u{890}', '\u{891}', '\u{8E2}',
                '\u{180E}', '\u{200C}', '\u{2066}', '\u{2067}', '\u{2068}', '\u{2069}', '\u{110BD}', '\u{110CD}'
            ], 'U');
        });
    });

    describe('getScriptRuns', function() {
        const runsOf = text => getScriptRuns(Array.from(text)).map(({ start, end, script }) => [start, end, script]);

        it('splits a text where the script changes', function() {
            assert.deepStrictEqual(runsOf('AБΩא'), [[0, 1, 'Latn'], [1, 2, 'Cyrl'], [2, 3, 'Grek'], [3, 4, 'Hebr']]);
        });

        it('puts the chars of no script in the run of the char before them', function() {
            // the digits after a Thai letter, the space and the acute after a Latin letter
            assert.deepStrictEqual(runsOf('ก12'), [[0, 3, 'Thai']]);
            assert.deepStrictEqual(runsOf('a\u{301} Б.'), [[0, 3, 'Latn'], [3, 5, 'Cyrl']]);
        });

        it('puts the chars of no script at the start of the text in the run of the first char of a script', function() {
            assert.deepStrictEqual(runsOf('12 ก'), [[0, 4, 'Thai']]);
            assert.deepStrictEqual(runsOf('\u{301}Aก'), [[0, 2, 'Latn'], [2, 3, 'Thai']]);
        });

        it('gives one run of no script to a text of chars of no script, none to an empty text', function() {
            assert.deepStrictEqual(runsOf('1 \u{64E}\u{651}'), [[0, 4, undefined]]);
            assert.deepStrictEqual(runsOf(''), []);
        });

        it('puts a char of the Common script in the run after it when its Script_Extensions have the script of that run and not the one before', function() {
            // a tatweel and an Arabic comma between a Latin word and an Arabic letter, like the ScriptRunIterator of Chromium
            assert.deepStrictEqual(runsOf('a \u{640}\u{647}'), [[0, 2, 'Latn'], [2, 4, 'Arab']]);
            assert.deepStrictEqual(runsOf('a\u{60C}\u{633}'), [[0, 1, 'Latn'], [1, 3, 'Arab']]);
            // the script of the next char of a script, not of a later one
            assert.deepStrictEqual(runsOf('a \u{640}\u{633} b'), [[0, 2, 'Latn'], [2, 5, 'Arab'], [5, 6, 'Latn']]);
            assert.deepStrictEqual(runsOf('a\u{60C}\u{633} b'), [[0, 1, 'Latn'], [1, 4, 'Arab'], [4, 5, 'Latn']]);
            // the script of the next char of a script after other chars of no script
            assert.deepStrictEqual(runsOf('a\u{640}\u{64E}\u{633}'), [[0, 1, 'Latn'], [1, 4, 'Arab']]);
            assert.deepStrictEqual(runsOf('a\u{640}\u{640}\u{633}'), [[0, 1, 'Latn'], [1, 4, 'Arab']]);
            // a tatweel after a Syriac letter, whose script its Script_Extensions have, stays in the Syriac run
            assert.deepStrictEqual(runsOf('\u{710}\u{640}\u{633}'), [[0, 2, 'Syrc'], [2, 3, 'Arab']]);
            // an Arabic comma between two Latin words, and after a Latin word at the end of the text
            assert.deepStrictEqual(runsOf('a\u{60C} b'), [[0, 4, 'Latn']]);
            assert.deepStrictEqual(runsOf('a\u{60C}'), [[0, 2, 'Latn']]);
            // a tatweel at the start of the text, in the run of the first char of a script
            assert.deepStrictEqual(runsOf('\u{640}\u{633}a'), [[0, 2, 'Arab'], [2, 3, 'Latn']]);
        });

        it('keeps a combining mark of the Inherited script in the run of its base, whatever its Script_Extensions, like the browsers', function() {
            // an Arabic haraka (Script_Extensions Arab Syrc) after a Latin letter, before an Arabic letter
            assert.deepStrictEqual(runsOf('a\u{64E}\u{633}'), [[0, 2, 'Latn'], [2, 3, 'Arab']]);
            assert.deepStrictEqual(runsOf('a\u{64E}\u{633} b'), [[0, 2, 'Latn'], [2, 4, 'Arab'], [4, 5, 'Latn']]);
            // a caron (Script_Extensions Cher Latn Tale) and a dot below (Cher Dupl Kana Latn Syrc) after a Greek and a Cyrillic
            // letter, before a Latin word
            assert.deepStrictEqual(runsOf('\u{3A0}\u{30C} W'), [[0, 3, 'Grek'], [3, 4, 'Latn']]);
            assert.deepStrictEqual(runsOf('\u{3A0}\u{30C}W'), [[0, 2, 'Grek'], [2, 3, 'Latn']]);
            assert.deepStrictEqual(runsOf('\u{43E}\u{323} a'), [[0, 3, 'Cyrl'], [3, 4, 'Latn']]);
        });

        it('splits a Latin pair around a Thai mark, which is of the Thai script', function() {
            assert.deepStrictEqual(runsOf('A\u{E31}V'), [[0, 1, 'Latn'], [1, 2, 'Thai'], [2, 3, 'Latn']]);
        });

        it('counts the chars of the text, a char outside of the BMP as one', function() {
            assert.deepStrictEqual(runsOf('\u{1E030}A'), [[0, 1, 'Cyrl'], [1, 2, 'Latn']]);
        });

        itFailsUntilFixed('puts a closing bracket in the run of its opening bracket, like the itemization of the browsers',
            'getScriptRuns (src/char.mjs): the paired brackets are not resolved (no Bidi_Paired_Bracket data), so the ' +
            'closing bracket after a Cyrillic word is in the Cyrillic run',
            function() {
                // Unicode Standard Annex #24, section 5.1, and the ScriptRunIterator of Chromium: the ) takes the script of the (
                assert.deepStrictEqual(runsOf('Hello (\u{41F}\u{440}\u{438}\u{432}\u{435}\u{442}) world'),
                    [[0, 7, 'Latn'], [7, 13, 'Cyrl'], [13, 20, 'Latn']]);
            });
    });
});
