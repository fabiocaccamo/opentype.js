import assert from 'assert';
import { getCharKerningScript } from '../src/char.mjs';

// the Script property of the characters, from fontTools: python -c "from fontTools import unicodedata;
// print(unicodedata.script('҅'))" gives Zinh (Inherited), ';' Zyyy (Common), 'Ϣ' Copt (Coptic)
describe('char.mjs', function() {
    describe('getCharKerningScript', function() {
        function assertKerningScript(chars, script) {
            for (const char of chars) {
                const codePoint = 'U+' + char.codePointAt(0).toString(16).toUpperCase();
                assert.equal(getCharKerningScript(char), script, codePoint);
            }
        }

        it('gives thai for the Thai script', function() {
            // Thai
            assertKerningScript(['ก', 'เ', '๛'], 'thai');
        });

        it('gives arab for the Arabic script, also outside the ranges of isArabicChar', function() {
            // Arab: alef, the Arabic-Indic digits, the full stop, ae, dal with inverted v, the Extended Arabic-Indic
            // digits, the Arabic Supplement, Extended-A and the presentation forms
            assertKerningScript([
                'ا', '٠', '١', '۔', 'ە', 'ۮ', '۰', '۱',
                'ݐ', 'ݗ', 'ࢠ', 'ﭐ', 'ﹰ', 'ﺏ'
            ], 'arab');
        });

        it('gives hebr for the Hebrew script', function() {
            // Hebr
            assertKerningScript(['א', 'ת', 'ִ', 'שׁ'], 'hebr');
        });

        it('gives cyrl for the Cyrillic script', function() {
            // Cyrl
            assertKerningScript(['А', 'я', 'Ԁ', 'Ꙁ', '\u{1E030}'], 'cyrl');
        });

        it('gives grek for the Greek script', function() {
            // Grek
            assertKerningScript(['Α', 'ω', 'μ', 'ἀ', 'Ͽ'], 'grek');
        });

        it('gives no script for the Common, Inherited and Unknown scripts', function() {
            // Zyyy, also the Arabic comma, question mark and tatweel and the Thai baht
            assertKerningScript(['1', '!', ' ', '.', ';', 'µ', '،', '؟', 'ـ', '฿'], undefined);
            // Zinh
            assertKerningScript(['́', '҅'], undefined);
            // Zzzz: private use, unassigned (also in the Thai block), surrogate
            assertKerningScript(['', '͸', '฀', '\uD800'], undefined);
        });

        it('gives latn for the other scripts', function() {
            // Latn, Latn, Copt, Armn, Cham, Hani
            assertKerningScript(['A', 'ə', 'Ϣ', 'Ա', 'ꨀ', '一'], 'latn');
        });
    });
});
