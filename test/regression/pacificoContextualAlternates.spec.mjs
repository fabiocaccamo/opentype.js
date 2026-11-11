/**
 * Regression tests of the upstream issues #372 ("nn n": turning the ligatures on or off has
 * no effect) and #253 (uppercase letters too close to the next letter, "Hello"), on Pacifico.
 *
 * Fixture: Pacifico-Regular-calt-kern-subset.ttf (Pacifico 3.001, 46 glyphs, GSUB, GPOS and
 * GDEF, no kern table). How it was built: test/fonts/regression/README.md.
 *
 * #372: the final forms are not ligatures and do not come from the fina feature (HarfBuzz does
 * not apply it to latin text), they come from calt. GSUB lookup 10 is a chaining context
 * substitution (type 6 format 3): its first subtable is an "ignore" rule, a letter followed by
 * a letter with no lookup record, its second subtable calls the single substitution to the
 * .fina glyph. Lookup 11 (type 6 format 3) runs after it and has the rules with a lookahead:
 * a letter before a punctuation glyph, b or o before s or s.fina. fina is lookup 9, the single
 * substitution that lookup 10 calls. liga is lookup 13 (type 4), dlig is lookup 17 (type 4, the
 * same f_f, fi and fl), ccmp is lookups 2 and 3 (type 6 format 3), ss01 is lookup 15 (type 1),
 * locl is a single substitution of the language systems of latn only (AZE, CRT, KAZ, TAT, TRK).
 * Upstream master (5d65b6d) has no stringToGlyphClusters, so the tests as written cannot run
 * there. Its forEachGlyph gives these texts no final form and no ligature ("nn n" is the
 * glyphs 15, 15, 1, 15, "off" is 16, 10, 10) and throws on a text where a rule of ccmp matches:
 * an i before a combining mark, a mark after an uppercase letter or after another mark
 * ("Substitution type 11 is not supported in chaining substitution").
 *
 * #253: GPOS pair adjustment (type 2). The kern feature has 2 lookups, both with lookupFlag 8
 * (ignoreMarks): lookup 0 has one subtable of format 2 covering comma and parenleft, lookup 1
 * has subtables of format 1, 2, 2, 2, 2. The scripts of GPOS (DFLT, latn) have only the default
 * language system. The forEachGlyph of upstream master kerns these pairs too (the H of "Hello"
 * is 1003 wide there): the kerning tests are guards and known failures, not regression tests
 * of a fix.
 *
 * Glyph ids: 1 space, 2 H, 3 P, 4 H.ss01, 6 a, 8 c, 9 e, 10 f, 11 i, 13 i.loclTRK, 14 l, 15 n,
 * 16 o, 17 s, 18 a.fina, 19 b.fina, 21 e.fina, 22 i.fina, 23 dotlessi.fina, 26 n.fina,
 * 27 o.fina, 28 s.fina, 31 l.ss01, 33 f_f, 34 fi, 35 fl, 40 comma, 41 parenleft, 42 parenright,
 * 44 acutecomb, 45 acutecomb.case.
 *
 * The reference values are the output of hb-shape (HarfBuzz 11.3.2) run in test/fonts/regression/,
 * printed as glyph id = cluster + x advance. A mark also has its @x,y offset, the mark feature
 * of GPOS, which is not asserted. The clusters are those of --cluster-level=1: a mark keeps a
 * cluster of its own, like in stringToGlyphClusters. The ends are not printed: the end of a
 * cluster is the start of the next one. Every command names its language (--language=en, tr for
 * Turkish): without it hb-shape takes the language of the locale of the machine, and with a
 * Turkic locale the locl of the font changes texts with an i ("fi", "Pacifico").
 */

import assert from 'assert';
import { loadFont, shapeText, assertShape, itFailsUntilFixed } from './helpers.mjs';

const fixture = 'Pacifico-Regular-calt-kern-subset.ttf';

describe('regression: calt final forms and GPOS class kerning of Pacifico (#372, #253)', function() {
    let font;

    beforeEach(function() {
        font = loadFont(fixture);
    });

    describe('#372: final forms of a chaining context lookup with an ignore rule, features on and off', function() {
        it('gives "nn n" the final form of n at the end of each word, with liga on or off', function() {
            const expected = {
                glyphs: [15, 26, 1, 26],
                clusters: [0, 1, 2, 3],
                ends: [1, 2, 3, 4],
                advances: [496, 484, 265, 484]
            };
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 006E,006E,0020,006E
            // [15=0+496|26=1+484|1=2+265|26=3+484]
            assertShape(shapeText(font, 'nn n'), expected, 'liga on');
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-liga Pacifico-Regular-calt-kern-subset.ttf -u 006E,006E,0020,006E
            // [15=0+496|26=1+484|1=2+265|26=3+484]
            assertShape(shapeText(font, 'nn n', { features: { liga: false } }), expected, 'liga off');
        });

        it('keeps the plain n of "nn n" with calt turned off', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-calt Pacifico-Regular-calt-kern-subset.ttf -u 006E,006E,0020,006E
            // [15=0+496|15=1+496|1=2+265|15=3+496]
            assertShape(shapeText(font, 'nn n', { features: { calt: false } }), {
                glyphs: [15, 15, 1, 15],
                clusters: [0, 1, 2, 3],
                ends: [1, 2, 3, 4],
                advances: [496, 496, 265, 496]
            });
        });

        it('gives every n of "nn n" its final form with fina turned on', function() {
            // fina calls lookup 9 on every glyph it covers, not only at the end of a word.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=fina Pacifico-Regular-calt-kern-subset.ttf -u 006E,006E,0020,006E
            // [26=0+484|26=1+484|1=2+265|26=3+484]
            assertShape(shapeText(font, 'nn n', { features: { fina: true } }), {
                glyphs: [26, 26, 1, 26],
                clusters: [0, 1, 2, 3],
                ends: [1, 2, 3, 4],
                advances: [484, 484, 265, 484]
            });
        });

        it('gives the o of "os" and the b of "bs" the final form of the rule with a lookahead, and kerns the substituted glyphs', function() {
            // Lookup 10 ignores the o (a letter follows) and gives the s at the end its final form,
            // then lookup 11 subtable 1 (b or o before s or s.fina) gives the o its final form.
            // Kerning of GPOS lookup 1 subtable 4: o.fina + s.fina -5, o + s +70.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 006F,0073
            // [27=0+448|28=1+394]
            assertShape(shapeText(font, 'os'), {
                glyphs: [27, 28],
                clusters: [0, 1],
                ends: [1, 2],
                advances: [448, 394]
            }, 'os');
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-calt Pacifico-Regular-calt-kern-subset.ttf -u 006F,0073
            // [16=0+521|17=1+427]
            assertShape(shapeText(font, 'os', { features: { calt: false } }), {
                glyphs: [16, 17],
                clusters: [0, 1],
                ends: [1, 2],
                advances: [521, 427]
            }, 'os, calt off');
            // The b of the same rule, b.fina + s.fina is -5 too.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0062,0073
            // [19=0+470|28=1+394]
            assertShape(shapeText(font, 'bs'), {
                glyphs: [19, 28],
                clusters: [0, 1],
                ends: [1, 2],
                advances: [470, 394]
            }, 'bs');
        });

        it('keeps the o of "off" plain before the ff ligature', function() {
            // The ignore rule of lookup 10 matches the o (a letter follows), f_f has no final form.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 006F,0066,0066
            // [16=0+451|33=1+684]
            assertShape(shapeText(font, 'off'), {
                glyphs: [16, 33],
                clusters: [0, 1],
                ends: [1, 3],
                advances: [451, 684]
            }, 'liga on');
            // f + f is -20 in GPOS lookup 1 subtable 4.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-liga Pacifico-Regular-calt-kern-subset.ttf -u 006F,0066,0066
            // [16=0+451|10=1+351|10=2+371]
            assertShape(shapeText(font, 'off', { features: { liga: false } }), {
                glyphs: [16, 10, 10],
                clusters: [0, 1, 2],
                ends: [1, 2, 3],
                advances: [451, 351, 371]
            }, 'liga off');
        });

        it('makes the ff ligature of "off" with dlig turned on and liga turned off', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-liga,dlig Pacifico-Regular-calt-kern-subset.ttf -u 006F,0066,0066
            // [16=0+451|33=1+684]
            assertShape(shapeText(font, 'off', { features: { liga: false, dlig: true } }), {
                glyphs: [16, 33],
                clusters: [0, 1],
                ends: [1, 3],
                advances: [451, 684]
            });
        });

        it('applies calt before liga, in lookup order: the final i of "fi" and "ffi" makes no fi ligature', function() {
            // Lookup 10 (calt) gives the i at the end its final form before lookup 13 (liga)
            // looks for f + i. f + i.fina and f_f + i.fina are -20 in GPOS lookup 1 subtable 4.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0066,0069
            // [10=0+351|22=1+222]
            assertShape(shapeText(font, 'fi'), {
                glyphs: [10, 22],
                clusters: [0, 1],
                ends: [1, 2],
                advances: [351, 222]
            }, 'fi');
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0066,0066,0069
            // [33=0+664|22=2+222]
            assertShape(shapeText(font, 'ffi'), {
                glyphs: [33, 22],
                clusters: [0, 2],
                ends: [2, 3],
                advances: [664, 222]
            }, 'ffi');
            // The i before a letter stays plain (ignore rule) and makes the ligature.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0066,0069,006E
            // [34=0+633|26=2+484]
            assertShape(shapeText(font, 'fin'), {
                glyphs: [34, 26],
                clusters: [0, 2],
                ends: [2, 3],
                advances: [633, 484]
            }, 'fin');
        });

        it('applies ss01 turned on together with calt and kern ("Hello")', function() {
            // Lookup 15 gives H.ss01 and l.ss01, the o keeps its final form of calt, and
            // H.ss01 + e is 0 in GPOS lookup 1 subtable 1 (H + e is +130).
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=ss01 Pacifico-Regular-calt-kern-subset.ttf -u 0048,0065,006C,006C,006F
            // [4=0+846|9=1+393|31=2+237|31=3+237|27=4+453]
            assertShape(shapeText(font, 'Hello', { features: { ss01: true } }), {
                glyphs: [4, 9, 31, 31, 27],
                clusters: [0, 1, 2, 3, 4],
                ends: [1, 2, 3, 4, 5],
                advances: [846, 393, 237, 237, 453]
            });
        });

        describe('ccmp before a combining mark', function() {
            // i, U+0301 COMBINING ACUTE ACCENT, n
            const dotlessText = 'i\u{301}n';

            it('gives the dotless i of ccmp its final form before a combining mark', function() {
                // ccmp lookup 2 subtable 0 turns the i before the mark into dotlessi, and the
                // ignore rule of calt does not match it (the next glyph is the mark, not a
                // letter: the lookupFlag of lookup 10 is 0).
                // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0069,0301,006E
                // [23=0+222|44=1@250,0+0|26=2+484]
                assertShape(shapeText(font, dotlessText), {
                    glyphs: [23, 44, 26],
                    clusters: [0, 1, 2],
                    ends: [1, 2, 3],
                    advances: [222, 0, 484]
                });
            });

            it('gives two marks their uppercase form with the two lookups of ccmp', function() {
                // i, U+0301 COMBINING ACUTE ACCENT, U+0301 COMBINING ACUTE ACCENT: lookup 2
                // subtable 1 (acutecomb after acutecomb) gives the second mark its uppercase
                // form, then lookup 3 subtable 0 (acutecomb before acutecomb.case) the first one.
                // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0069,0301,0301
                // [23=0+222|45=1@250,0+0|45=2@288,308+0]
                assertShape(shapeText(font, 'i\u{301}\u{301}'), {
                    glyphs: [23, 45, 45],
                    clusters: [0, 1, 2],
                    ends: [1, 2, 3],
                    advances: [222, 0, 0]
                }, 'after an i');
                // H, U+0301 COMBINING ACUTE ACCENT, U+0301 COMBINING ACUTE ACCENT, e: lookup 2
                // subtable 2 (acutecomb after an uppercase letter) gives the first mark its
                // uppercase form, then lookup 3 subtable 1 (acutecomb after acutecomb.case) the
                // second one. Without kerning: the kerning across a mark is a known failure below.
                // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-kern Pacifico-Regular-calt-kern-subset.ttf -u 0048,0301,0301,0065
                // [2=0+873|45=1@-38,380+0|45=2@0,688+0|21=3+411]
                assertShape(shapeText(font, 'H\u{301}\u{301}e', { kerning: false }), {
                    glyphs: [2, 45, 45, 21],
                    clusters: [0, 1, 2, 3],
                    ends: [1, 2, 3, 4],
                    advances: [873, 0, 0, 411]
                }, 'after an uppercase letter');
            });

            itFailsUntilFixed(
                'keeps the dotted i, in its final form, before the mark with ccmp turned off',
                'applyFeaturesToContexts (src/bidi.mjs): applies ccmp to every text (applyCcmpReplacement), ' +
                'also when the ccmp feature is turned off',
                function() {
                    const shaped = shapeText(font, dotlessText, { features: { ccmp: false } });
                    // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-ccmp Pacifico-Regular-calt-kern-subset.ttf -u 0069,0301,006E
                    // [22=0+222|44=1+0|26=2+484]
                    assert.deepStrictEqual(shaped.glyphs, [22, 44, 26]);
                }
            );
        });
    });

    describe('#253: GPOS pair kerning after an uppercase letter', function() {
        it('kerns the H and the e of "Hello" (class kerning, PairPos format 2)', function() {
            // H + e is +130 in lookup 1 subtable 1, the o takes its final form through calt.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0048,0065,006C,006C,006F
            // [2=0+1003|9=1+393|14=2+326|14=3+326|27=4+453]
            assertShape(shapeText(font, 'Hello'), {
                glyphs: [2, 9, 14, 14, 27],
                clusters: [0, 1, 2, 3, 4],
                ends: [1, 2, 3, 4, 5],
                advances: [1003, 393, 326, 326, 453]
            }, 'kerning on');
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-kern Pacifico-Regular-calt-kern-subset.ttf -u 0048,0065,006C,006C,006F
            // [2=0+873|9=1+393|14=2+326|14=3+326|27=4+453]
            assertShape(shapeText(font, 'Hello', { kerning: false }), {
                glyphs: [2, 9, 14, 14, 27],
                clusters: [0, 1, 2, 3, 4],
                ends: [1, 2, 3, 4, 5],
                advances: [873, 393, 326, 326, 453]
            }, 'kerning off');
        });

        it('kerns the P and the a of "Pacifico", with the fi ligature and the final o', function() {
            // P + a is -85 in lookup 1 subtable 1.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0050,0061,0063,0069,0066,0069,0063,006F
            // [3=0+720|6=1+470|8=2+368|11=3+246|34=4+633|8=6+368|27=7+453]
            assertShape(shapeText(font, 'Pacifico'), {
                glyphs: [3, 6, 8, 11, 34, 8, 27],
                clusters: [0, 1, 2, 3, 4, 6, 7],
                ends: [1, 2, 3, 4, 6, 7, 8],
                advances: [720, 470, 368, 246, 633, 368, 453]
            }, 'liga on');
            // i + f is -10 and f + i is -20 in lookup 1 subtable 4.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-liga Pacifico-Regular-calt-kern-subset.ttf -u 0050,0061,0063,0069,0066,0069,0063,006F
            // [3=0+720|6=1+470|8=2+368|11=3+236|10=4+351|11=5+246|8=6+368|27=7+453]
            assertShape(shapeText(font, 'Pacifico', { features: { liga: false } }), {
                glyphs: [3, 6, 8, 11, 10, 11, 8, 27],
                clusters: [0, 1, 2, 3, 4, 5, 6, 7],
                ends: [1, 2, 3, 4, 5, 6, 7, 8],
                advances: [720, 470, 368, 236, 351, 246, 368, 453]
            }, 'liga off');
        });

        it('kerns "la" and "flan" with a class pair, after the format 1 subtable that covers the l and the fl without the pair', function() {
            // Lookup 1 subtable 0 (format 1) covers l and fl, with i.loclTRK as only second glyph:
            // the pair is looked up in the next subtables. l + a.fina and fl + a are -10 in subtable 4.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 006C,0061
            // [14=0+316|18=1+458]
            assertShape(shapeText(font, 'la'), {
                glyphs: [14, 18],
                clusters: [0, 1],
                ends: [1, 2],
                advances: [316, 458]
            }, 'la');
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-kern Pacifico-Regular-calt-kern-subset.ttf -u 006C,0061
            // [14=0+326|18=1+458]
            assertShape(shapeText(font, 'la', { kerning: false }), {
                glyphs: [14, 18],
                clusters: [0, 1],
                ends: [1, 2],
                advances: [326, 458]
            }, 'la, kerning off');
            // The fl ligature is 688 wide (see "flin" in the Turkish tests).
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0066,006C,0061,006E
            // [35=0+678|6=2+470|26=3+484]
            assertShape(shapeText(font, 'flan'), {
                glyphs: [35, 6, 26],
                clusters: [0, 2, 3],
                ends: [2, 3, 4],
                advances: [678, 470, 484]
            }, 'flan');
        });

        describe('left glyph covered by the two lookups of the kern feature', function() {
            // comma + b.fina: lookup 0 subtable 0 (class 0, class 0) = 0, lookup 1 subtable 3 = -50.
            // parenleft + H: lookup 0 subtable 0 (class 1, class 0) = 0, lookup 1 subtable 3 = +50.
            // comma + parenright: lookup 0 subtable 0 (class 0, class 1) = +50, lookup 1 subtable 3 = 0.
            // HarfBuzz applies each lookup of the feature and adds the values.
            const twoLookupsReason = 'getKerningValue (src/position.mjs): returns the value of the first kern lookup ' +
                'that covers the left glyph, 0 here, the values of the next lookups are not added';

            it('gives "a,b" and "(H" the glyphs and the advances without kerning', function() {
                // Lookup 10 gives the a its final form before the comma (not a letter) and the b at the end.
                // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-kern Pacifico-Regular-calt-kern-subset.ttf -u 0061,002C,0062
                // [18=0+458|40=1+257|19=2+475]
                assertShape(shapeText(font, 'a,b', { kerning: false }), {
                    glyphs: [18, 40, 19],
                    clusters: [0, 1, 2],
                    ends: [1, 2, 3],
                    advances: [458, 257, 475]
                }, 'a,b');
                // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-kern Pacifico-Regular-calt-kern-subset.ttf -u 0028,0048
                // [41=0+613|2=1+873]
                assertShape(shapeText(font, '(H', { kerning: false }), {
                    glyphs: [41, 2],
                    clusters: [0, 1],
                    ends: [1, 2],
                    advances: [613, 873]
                }, '(H');
            });

            it('kerns the comma and the parenthesis of ",)" with the first lookup (+50)', function() {
                // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 002C,0029
                // [40=0+307|42=1+613]
                assertShape(shapeText(font, ',)'), {
                    glyphs: [40, 42],
                    clusters: [0, 1],
                    ends: [1, 2],
                    advances: [307, 613]
                }, 'kerning on');
                // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-kern Pacifico-Regular-calt-kern-subset.ttf -u 002C,0029
                // [40=0+257|42=1+613]
                assertShape(shapeText(font, ',)', { kerning: false }), {
                    glyphs: [40, 42],
                    clusters: [0, 1],
                    ends: [1, 2],
                    advances: [257, 613]
                }, 'kerning off');
            });

            for (const reference of [
                // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0061,002C,0062
                // [18=0+458|40=1+207|19=2+475]
                { name: 'the comma and the b of "a,b" with the second lookup (-50)', text: 'a,b', advances: [458, 207, 475] },
                // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0028,0048
                // [41=0+663|2=1+873]
                { name: 'the parenthesis and the H of "(H" with the second lookup (+50)', text: '(H', advances: [663, 873] }
            ]) {
                itFailsUntilFixed(`kerns ${reference.name}`, twoLookupsReason, function() {
                    const shaped = shapeText(font, reference.text);
                    assert.deepStrictEqual(shaped.advances, reference.advances);
                });
            }
        });
    });

    describe('combining mark between two kerned glyphs', function() {
        // H, U+0301 COMBINING ACUTE ACCENT, e
        const text = 'H\u{301}e';

        it('gives the mark its uppercase form and a cluster of its own, and the e its final form', function() {
            // ccmp lookup 2 subtable 2: acutecomb after an uppercase letter is acutecomb.case.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-kern Pacifico-Regular-calt-kern-subset.ttf -u 0048,0301,0065
            // [2=0+873|45=1@-38,380+0|21=2+411]
            assertShape(shapeText(font, text, { kerning: false }), {
                glyphs: [2, 45, 21],
                clusters: [0, 1, 2],
                ends: [1, 2, 3],
                advances: [873, 0, 411]
            }, 'kerning off');
            // The sum of these advances: 873 + 0 + 411.
            assert.strictEqual(font.getAdvanceWidth(text, font.unitsPerEm, { kerning: false }), 1284);
            // The glyphs and the clusters with kerning, its advances are the known failure below.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0048,0301,0065
            // [2=0+1003|45=1@-168,380+0|21=2+411]
            const shaped = shapeText(font, text);
            assert.deepStrictEqual(shaped.glyphs, [2, 45, 21]);
            assert.deepStrictEqual(shaped.clusters, [0, 1, 2]);
            assert.deepStrictEqual(shaped.ends, [1, 2, 3]);
        });

        itFailsUntilFixed(
            'kerns the H and the e across the mark (+130, lookupFlag ignoreMarks)',
            'forEachGlyph (src/font.mjs): kerns each glyph with the next one, here the H with the mark, ' +
            'without reading the lookupFlag of the kern lookups',
            function() {
                const shaped = shapeText(font, text);
                // hb-shape --no-glyph-names --cluster-level=1 --language=en Pacifico-Regular-calt-kern-subset.ttf -u 0048,0301,0065
                // [2=0+1003|45=1@-168,380+0|21=2+411]
                assert.deepStrictEqual(shaped.advances, [1003, 0, 411]);
            }
        );
    });

    describe('language system TRK of latn (locl in GSUB, no language system in GPOS)', function() {
        // The script and language options of GlyphRenderOptions, the language as the tag of the
        // font with its trailing space (the form getLangSysTable compares with the tags of the font).
        const turkishOptions = { script: 'latn', language: 'TRK ' };

        it('reads the two pairs of PairPos format 1: the l and the fl before the localized i', function() {
            // l + i.loclTRK and fl + i.loclTRK are +20 in lookup 1 subtable 0, the only subtable
            // of format 1 of the fixture: the difference between the advances with and without kern.
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr Pacifico-Regular-calt-kern-subset.ttf -u 006C,0069,006E
            // [14=0+346|13=1+246|26=2+484]
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr --features=-kern Pacifico-Regular-calt-kern-subset.ttf -u 006C,0069,006E
            // [14=0+326|13=1+246|26=2+484]
            assert.strictEqual(font.getKerningValue(14, 13), 20);
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr Pacifico-Regular-calt-kern-subset.ttf -u 0066,006C,0069,006E
            // [35=0+708|13=2+246|26=3+484]
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr --features=-kern Pacifico-Regular-calt-kern-subset.ttf -u 0066,006C,0069,006E
            // [35=0+688|13=2+246|26=3+484]
            assert.strictEqual(font.getKerningValue(35, 13), 20);
        });

        for (const reference of [
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr Pacifico-Regular-calt-kern-subset.ttf -u 006C,0069,006E
            // [14=0+346|13=1+246|26=2+484]
            { name: '"lin" the localized i', text: 'lin', glyphs: [14, 13, 26] },
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr Pacifico-Regular-calt-kern-subset.ttf -u 0066,0069,006E
            // [10=0+351|13=1+246|26=2+484]
            { name: '"fin" the localized i, which makes no fi ligature', text: 'fin', glyphs: [10, 13, 26] }
        ]) {
            itFailsUntilFixed(
                `gives ${reference.name}, with the language TRK`,
                '_createBidi (src/font.mjs): gives the Bidi the features only, not the script and language options, and ' +
                'getScriptFeaturesIndexes (src/features/featureQuery.mjs) reads the default language system of a script: ' +
                'the locl of a language system is never applied',
                function() {
                    const shaped = shapeText(font, reference.text, turkishOptions);
                    assert.deepStrictEqual(shaped.glyphs, reference.glyphs);
                }
            );
        }

        itFailsUntilFixed(
            'keeps the kerning of "Hello" with the language TRK, which GPOS does not have',
            'getLangSysTable (src/layout.mjs): returns no table for a language system the script does not have, ' +
            'instead of its default language system, so getKerningTables (src/position.mjs) finds no kern lookup',
            function() {
                const shaped = shapeText(font, 'Hello', turkishOptions);
                // hb-shape --no-glyph-names --cluster-level=1 --language=tr Pacifico-Regular-calt-kern-subset.ttf -u 0048,0065,006C,006C,006F
                // [2=0+1003|9=1+393|14=2+326|14=3+326|27=4+453]
                assert.deepStrictEqual(shaped.advances, [1003, 393, 326, 326, 453]);
            }
        );
    });
});
