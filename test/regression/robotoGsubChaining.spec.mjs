/**
 * Regression: GSUB chaining context lookups (type 6) of two real variable fonts.
 *
 * Upstream: PR #816 and PR #861 (chaining context format 2 of the variable Roboto, and the "ffi"
 * of "affinity" badly spaced when wdth is narrowed), issue #874 (font.toArrayBuffer() throws
 * "lookup type 6 format 2 is not yet supported"), issue #860 and PR #870 (a chaining context
 * format 3 with a nested Single substitution format 1 threw "Substitution type 11 is not
 * supported in chaining substitution").
 *
 * Fixtures (how they were built: test/fonts/regression/README.md). The two lists below name the
 * lookups and the glyphs the tests reach, not the whole fonts.
 *
 * Roboto-VF-gsub-chaining-subset.ttf (Roboto 3.015, wght 100..900, wdth 75..100, gvar, HVAR):
 *   ccmp: lookup 0 = type 6 format 2 (input classes: i, iogonek, j, each one before acutecomb; a
 *   fourth class, the ligature of i and dotbelowcomb of lookup 2, cannot be reached: lookup 0 runs
 *   first), nested lookup 1 = Single format 2 (the dotless glyphs); lookup 2 = Ligature (8
 *   ligatures, the tests use a + acutecomb)
 *   liga: lookup 3 (f f i, f i), dlig: lookup 4 (f f, a composite of two f)
 *   frac: lookup 5 = Single format 1 (slash to fraction), lookup 6 = type 6 format 3 with a
 *   backtrack (the fraction or a denominator), nested lookup 7 = Single format 2 (denominators),
 *   lookup 8 = Single format 2 (numerators)
 *   latn has the language systems AZE, CRT and TRK, with ccmp, dlig and frac but without liga
 *   glyphs: 1 slash, 2 one, 3 two, 4 a, 5 f, 6 i, 7 j, 8 n, 9 t, 10 y, 11 and 13 numerators of two
 *   and one, 17 acutecomb, 18 dotbelowcomb, 19 fraction, 20 f_f, 21 fi, 22 ffi, 23 and 24
 *   denominators of two and one, 25 dotless j, 26 dotless i, 27 dotless iogonek, 28 aacute, 29 iacute
 *
 * NotoSansThaiLooped-VF-gsub-chaining-subset.ttf (2.000, wght 100..900, wdth 62.5..100, an avar
 * that bends wdth), ccmp = lookups 5, 6 and 9:
 *   lookup 5 = type 5 format 1, never matches here (its second input, glyph 4, has no code point)
 *   lookup 6 = type 6 format 3 with a backtrack, 4 subtables (the tests reach the first one,
 *   after mai tho or sara i, and the third one, after glyph 6), nested lookup 7 = Single format 1
 *   lookup 9 = type 6 format 3, lookupFlag 16 with the mark filtering set 0 (the above marks), two
 *   subtables (lookahead: an above mark, or a below vowel and an above mark), nested lookup 10 =
 *   Single format 1, with the same flag and set
 *   glyphs: 1 ko kai, 2 lo chula, 3 lo chula with a short tail, 5 mai tho, 6 mai tho after a mark
 *   above, 8 sara i, 10 sara u
 *
 * Roboto has no type 6 format 1 and no type 5 format 2 lookup, the other formats of PR #816: type 6
 * format 1 is only covered by the synthetic font of test/latinFeatures.spec.mjs, type 5 format 2 by
 * the synthetic fonts of test/contextualNestedLookups.spec.mjs.
 *
 * On upstream master (5d65b6d, 2026-05-19) stringToGlyphs() throws on every Roboto text of this
 * file but the slash alone, even where no contextual lookup matches ("substitutionType : 62
 * lookupType: 6 - substFormat: 2 is not yet supported", ccmp is a default feature). On the Thai
 * font it throws where the first subtable of lookup 9 or a subtable of lookup 6 matches
 * ("Substitution type 11 is not supported in chaining substitution") and keeps the long tail of
 * lo chula before sara u and mai tho. The fork skips a subtable it does not support with a warning
 * (getLookupMethod in src/features/featureQuery.mjs): there, losing the format 2 fails only the
 * ccmp tests of Roboto (j and iogonek keep their dot), not the tests of "affinity" and of frac.
 *
 * References: see helpers.mjs. The hb-shape commands of Roboto have --language=en, the result of
 * the texts with a ligature depends on the language (of the locale, by default). The @x,y that
 * hb-shape prints for a mark is its GPOS offset: only the known failure of GPOS mark compares it.
 * A known failure compares only the value its bug changes (the glyphs, an advance, the origins,
 * a field of the written table).
 */

import assert from 'assert';
import { parse } from '../../src/opentype.mjs';
import { loadFont, getGlyphOrigins, shapeText, assertShape, getOutline, assertOutlineClose, itFailsUntilFixed } from './helpers.mjs';

const robotoFixture = 'Roboto-VF-gsub-chaining-subset.ttf';
const thaiFixture = 'NotoSansThaiLooped-VF-gsub-chaining-subset.ttf';

// assertShape of a text, with the text and the location of the font in the message of a failure
// (a font written by toArrayBuffer() has no gvar, so no font.variation)
function assertShapedLike(font, text, expected, options) {
    const location = font.variation ? JSON.stringify(font.variation.get()) : 'the only location of the font';
    assertShape(shapeText(font, text, options), expected, `${JSON.stringify(text)} at ${location}`);
}

function getMiddlePoint(pointA, pointB) {
    return [(pointA[0] + pointB[0]) / 2, (pointA[1] + pointB[1]) / 2];
}

// The outline (see getPathOutline of helpers.mjs) of TrueType contours of [x, y, onCurve] points,
// the output of glyf[name].getCoordinates(glyf) of fontTools: like the glyf paths of opentype.js,
// a contour starts at its last point (on the curve in the glyphs of this file) and has a line
// to each on-curve point, the last one included.
function getContoursOutline(contours) {
    const commands = [];
    for (const contour of contours) {
        const start = contour[contour.length - 1];
        assert.ok(start[2], 'the last point of the contour is on the curve');
        commands.push(['M', start[0], start[1]]);
        for (let i = 0; i < contour.length; i++) {
            const point = contour[i];
            const nextPoint = contour[(i + 1) % contour.length];
            if (point[2]) {
                commands.push(['L', point[0], point[1]]);
            } else {
                const end = nextPoint[2] ? nextPoint : getMiddlePoint(point, nextPoint);
                commands.push(['Q', point[0], point[1], end[0], end[1]]);
            }
        }
        commands.push(['Z']);
    }
    return commands;
}

describe('regression: GSUB chaining context lookups of Roboto and Noto Sans Thai Looped (#816, #861, #874, #860, #870)', function() {
    describe('Roboto: liga and dlig, the ffi ligature of "affinity" when the width is narrowed (#816)', function() {
        // "affinity" at the default location, at the corners and inside the design space: no
        // contextual lookup matches and no kerning pair applies in this text
        const affinityLocations = [
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 0061,0066,0066,0069,006E,0069,0074,0079
            // [4=0+1114|22=1+1748|8=4+1131|6=5+498|9=6+670|10=7+969]
            { variation: undefined, advances: [1114, 1748, 1131, 498, 670, 969] },
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75 Roboto-VF-gsub-chaining-subset.ttf -u 0061,0066,0066,0069,006E,0069,0074,0079
            // [4=0+981|22=1+1525|8=4+992|6=5+470|9=6+606|10=7+853]
            { variation: { wdth: 75 }, advances: [981, 1525, 992, 470, 606, 853] },
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=900 Roboto-VF-gsub-chaining-subset.ttf -u 0061,0066,0066,0069,006E,0069,0074,0079
            // [4=0+1088|22=1+1978|8=4+1156|6=5+563|9=6+704|10=7+1061]
            { variation: { wght: 900 }, advances: [1088, 1978, 1156, 563, 704, 1061] },
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75,wght=900 Roboto-VF-gsub-chaining-subset.ttf -u 0061,0066,0066,0069,006E,0069,0074,0079
            // [4=0+955|22=1+1755|8=4+1017|6=5+535|9=6+640|10=7+945]
            { variation: { wdth: 75, wght: 900 }, advances: [955, 1755, 1017, 535, 640, 945] },
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=87.5,wght=250 Roboto-VF-gsub-chaining-subset.ttf -u 0061,0066,0066,0069,006E,0069,0074,0079
            // [4=0+1027|22=1+1571|8=4+1056|6=5+435|9=6+624|10=7+917]
            { variation: { wdth: 87.5, wght: 250 }, advances: [1027, 1571, 1056, 435, 624, 917] },
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=80,wght=650 Roboto-VF-gsub-chaining-subset.ttf -u 0061,0066,0066,0069,006E,0069,0074,0079
            // [4=0+993|22=1+1706|8=4+1034|6=5+516|9=6+639|10=7+929]
            { variation: { wdth: 80, wght: 650 }, advances: [993, 1706, 1034, 516, 639, 929] }
        ];
        let font;
        let narrowFont;
        let halfNarrowFont;
        let narrowBlackFont;
        let affinityFonts;

        beforeEach(function() {
            font = loadFont(robotoFixture);
            narrowFont = loadFont(robotoFixture, { wdth: 75 });
            halfNarrowFont = loadFont(robotoFixture, { wdth: 87.5 });
            narrowBlackFont = loadFont(robotoFixture, { wdth: 75, wght: 900 });
            affinityFonts = affinityLocations.map(location => loadFont(robotoFixture, location.variation));
        });

        it('shapes "affinity" with the ffi ligature and the HVAR advances of each location, from the origin and on the baseline', function() {
            for (let i = 0; i < affinityLocations.length; i++) {
                assertShapedLike(affinityFonts[i], 'affinity', {
                    glyphs: [4, 22, 8, 6, 9, 10],
                    clusters: [0, 1, 4, 5, 6, 7],
                    advances: affinityLocations[i].advances
                });
            }
            // at wdth=75, the origin of each glyph: the sum of the advances before it, at y 0
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75 Roboto-VF-gsub-chaining-subset.ttf -u 0061,0066,0066,0069,006E,0069,0074,0079
            // [4=0+981|22=1+1525|8=4+992|6=5+470|9=6+606|10=7+853]
            assert.deepStrictEqual(getGlyphOrigins(narrowFont, 'affinity'), {
                origins: [[4, 0, 0], [22, 981, 0], [8, 2506, 0], [6, 3498, 0], [9, 3968, 0], [10, 4574, 0]],
                end: 5427
            });
        });

        it('applies liga before dlig, in the order of the lookups and not of the features, and each one alone', function() {
            // "affinity" without liga, at wdth=75
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75 --features=-liga Roboto-VF-gsub-chaining-subset.ttf -u 0061,0066,0066,0069,006E,0069,0074,0079
            // [4=0+981|5=1+648|5=2+648|6=3+470|8=4+992|6=5+470|9=6+606|10=7+853]
            assertShapedLike(
                narrowFont,
                'affinity',
                { glyphs: [4, 5, 5, 6, 8, 6, 9, 10], clusters: [0, 1, 2, 3, 4, 5, 6, 7], advances: [981, 648, 648, 470, 992, 470, 606, 853] },
                { features: { liga: false } }
            );
            // the same line, the origin of each glyph: the sum of the advances before it, at y 0
            assert.deepStrictEqual(getGlyphOrigins(narrowFont, 'affinity', { features: { liga: false } }), {
                origins: [[4, 0, 0], [5, 981, 0], [5, 1629, 0], [6, 2277, 0], [8, 2747, 0], [6, 3739, 0], [9, 4209, 0], [10, 4815, 0]],
                end: 5668
            });
            // "ffi" with dlig on: dlig comes before liga in the feature list, but lookup 3 (liga)
            // runs before lookup 4 (dlig) and takes the three letters
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=dlig Roboto-VF-gsub-chaining-subset.ttf -u 0066,0066,0069
            // [22=0+1748]
            assertShapedLike(font, 'ffi', { glyphs: [22], clusters: [0], advances: [1748] }, { features: { dlig: true } });
            // "fff" with dlig on: no ligature of liga, f_f and f
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=dlig Roboto-VF-gsub-chaining-subset.ttf -u 0066,0066,0066
            // [20=0+1267|5=2+712]
            assertShapedLike(font, 'fff', { glyphs: [20, 5], clusters: [0, 2], advances: [1267, 712] }, { features: { dlig: true } });
            // "ffi" and "affinity" with dlig on and liga off: f_f and i
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-liga,dlig Roboto-VF-gsub-chaining-subset.ttf -u 0066,0066,0069
            // [20=0+1267|6=2+498]
            assertShapedLike(font, 'ffi', { glyphs: [20, 6], clusters: [0, 2], advances: [1267, 498] }, { features: { liga: false, dlig: true } });
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-liga,dlig Roboto-VF-gsub-chaining-subset.ttf -u 0061,0066,0066,0069,006E,0069,0074,0079
            // [4=0+1114|20=1+1267|6=3+498|8=4+1131|6=5+498|9=6+670|10=7+969]
            assertShapedLike(
                font,
                'affinity',
                { glyphs: [4, 20, 6, 8, 6, 9, 10], clusters: [0, 1, 3, 4, 5, 6, 7], advances: [1114, 1267, 498, 1131, 498, 670, 969] },
                { features: { liga: false, dlig: true } }
            );
        });

        it('draws ffi and the composite ff (dlig) at wdth=75 with the outlines of the instance', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75 Roboto-VF-gsub-chaining-subset.ttf -u 0066,0066,0069
            // [22=0+1525]
            assertShapedLike(narrowFont, 'ffi', { glyphs: [22], clusters: [0], advances: [1525] });
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75 --features=dlig Roboto-VF-gsub-chaining-subset.ttf -u 0066,0066
            // [20=0+1120]
            assertShapedLike(narrowFont, 'ff', { glyphs: [20], clusters: [0], advances: [1120] }, { features: { dlig: true } });
            // fontTools: varLib.instancer.instantiateVariableFont(TTFont('Roboto-VF-gsub-chaining-subset.ttf'),
            // {'wght': 400, 'wdth': 75}), the instance saved and loaded again, then
            // instance['glyf']['glyph00022'].getCoordinates(instance['glyf']), as contours of [x, y, onCurve]
            const ffiContours = [
                [
                    [388, 0, 1], [211, 0, 1], [211, 1196, 1], [211, 1313, 0], [286, 1474, 0], [425, 1557, 0],
                    [521, 1557, 1], [548, 1557, 0], [603, 1549, 0], [628, 1541, 1], [620, 1390, 1], [604, 1395, 0],
                    [559, 1399, 0], [539, 1399, 1], [491, 1399, 0], [423, 1352, 0], [388, 1262, 0], [388, 1196, 1]
                ],
                [
                    [566, 1082, 1], [566, 940, 1], [70, 940, 1], [70, 1082, 1]
                ],
                [
                    [880, 0, 1], [704, 0, 1], [704, 1176, 1], [704, 1299, 0], [787, 1469, 0], [942, 1557, 0],
                    [1048, 1557, 1], [1110, 1557, 0], [1227, 1522, 0], [1288, 1496, 1], [1258, 1340, 1], [1223, 1358, 0],
                    [1119, 1391, 0], [1061, 1391, 1], [962, 1391, 0], [880, 1284, 0], [880, 1176, 1]
                ],
                [
                    [1056, 1082, 1], [1056, 940, 1], [563, 940, 1], [563, 1082, 1]
                ],
                [
                    [1373, 1082, 1], [1373, 0, 1], [1197, 0, 1], [1197, 1082, 1]
                ]
            ];
            // the same instance, instance['glyf']['glyph00020'].getCoordinates(instance['glyf']): a composite
            // of f at x 0 and of f at x 472 (556 at the default location, the offset of the second
            // component varies with the width)
            const ffContours = [
                [
                    [388, 0, 1], [211, 0, 1], [211, 1196, 1], [211, 1313, 0], [286, 1474, 0], [425, 1557, 0],
                    [521, 1557, 1], [548, 1557, 0], [603, 1549, 0], [628, 1541, 1], [620, 1390, 1], [604, 1395, 0],
                    [559, 1399, 0], [539, 1399, 1], [491, 1399, 0], [423, 1352, 0], [388, 1262, 0], [388, 1196, 1]
                ],
                [
                    [572, 1082, 1], [572, 940, 1], [70, 940, 1], [70, 1082, 1]
                ],
                [
                    [860, 0, 1], [683, 0, 1], [683, 1196, 1], [683, 1313, 0], [758, 1474, 0], [897, 1557, 0],
                    [993, 1557, 1], [1020, 1557, 0], [1075, 1549, 0], [1100, 1541, 1], [1092, 1390, 1], [1076, 1395, 0],
                    [1031, 1399, 0], [1011, 1399, 1], [963, 1399, 0], [895, 1352, 0], [860, 1262, 0], [860, 1196, 1]
                ],
                [
                    [1044, 1082, 1], [1044, 940, 1], [542, 940, 1], [542, 1082, 1]
                ]
            ];
            assertOutlineClose(getOutline(narrowFont, 22), getContoursOutline(ffiContours), 0, 'ffi');
            assertOutlineClose(getOutline(narrowFont, 20), getContoursOutline(ffContours), 0, 'ff');
        });

        it('draws ffi and the composite ff (dlig) at wdth=75,wght=900 with the outlines of the instance', function() {
            // At this corner the gvar deltas of two tuples add up, the region of the heaviest wght and
            // the region of the narrowest wdth, each one with a scalar of 1. The four other tuples of
            // each glyph have a scalar of 0 here: the lightest wght, and the three regions of wght
            // and wdth together, which peak at a normalized wght of -1, -0.5 and 0.694.
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75,wght=900 Roboto-VF-gsub-chaining-subset.ttf -u 0066,0066,0069
            // [22=0+1755]
            assertShapedLike(narrowBlackFont, 'ffi', { glyphs: [22], clusters: [0], advances: [1755] });
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75,wght=900 --features=dlig Roboto-VF-gsub-chaining-subset.ttf -u 0066,0066
            // [20=0+1223]
            assertShapedLike(narrowBlackFont, 'ff', { glyphs: [20], clusters: [0], advances: [1223] }, { features: { dlig: true } });
            // fontTools: varLib.instancer.instantiateVariableFont(TTFont('Roboto-VF-gsub-chaining-subset.ttf'),
            // {'wght': 900, 'wdth': 75}), the instance saved and loaded again, then
            // instance['glyf']['glyph00022'].getCoordinates(instance['glyf']), as contours of [x, y, onCurve]
            const ffiContours = [
                [
                    [479, 0, 1], [148, 0, 1], [148, 1170, 1], [148, 1296, 0], [240, 1468, 0], [405, 1557, 0],
                    [518, 1557, 1], [557, 1557, 0], [625, 1545, 0], [656, 1536, 1], [659, 1288, 1], [646, 1293, 0],
                    [616, 1297, 0], [594, 1297, 1], [556, 1297, 0], [505, 1268, 0], [479, 1211, 0], [479, 1170, 1]
                ],
                [
                    [627, 1082, 1], [627, 848, 1], [22, 848, 1], [22, 1082, 1]
                ],
                [
                    [1065, 0, 1], [736, 0, 1], [736, 1110, 1], [736, 1255, 0], [844, 1454, 0], [1050, 1557, 0],
                    [1196, 1557, 1], [1276, 1557, 0], [1425, 1525, 0], [1504, 1499, 1], [1460, 1233, 1], [1410, 1249, 0],
                    [1299, 1277, 0], [1215, 1277, 1], [1144, 1277, 0], [1065, 1191, 0], [1065, 1110, 1]
                ],
                [
                    [1232, 1082, 1], [1232, 848, 1], [609, 848, 1], [609, 1082, 1]
                ],
                [
                    [1653, 1082, 1], [1653, 0, 1], [1323, 0, 1], [1323, 1082, 1]
                ]
            ];
            // the same instance, instance['glyf']['glyph00020'].getCoordinates(instance['glyf']): a composite
            // of f at x 0 and of f at x 544
            const ffContours = [
                [
                    [479, 0, 1], [148, 0, 1], [148, 1170, 1], [148, 1296, 0], [240, 1468, 0], [405, 1557, 0],
                    [518, 1557, 1], [557, 1557, 0], [625, 1545, 0], [656, 1536, 1], [659, 1288, 1], [646, 1293, 0],
                    [616, 1297, 0], [594, 1297, 1], [556, 1297, 0], [505, 1268, 0], [479, 1211, 0], [479, 1170, 1]
                ],
                [
                    [643, 1082, 1], [643, 848, 1], [22, 848, 1], [22, 1082, 1]
                ],
                [
                    [1023, 0, 1], [692, 0, 1], [692, 1170, 1], [692, 1296, 0], [784, 1468, 0], [949, 1557, 0],
                    [1062, 1557, 1], [1101, 1557, 0], [1169, 1545, 0], [1200, 1536, 1], [1203, 1288, 1], [1190, 1293, 0],
                    [1160, 1297, 0], [1138, 1297, 1], [1100, 1297, 0], [1049, 1268, 0], [1023, 1211, 0], [1023, 1170, 1]
                ],
                [
                    [1187, 1082, 1], [1187, 848, 1], [566, 848, 1], [566, 1082, 1]
                ]
            ];
            assertOutlineClose(getOutline(narrowBlackFont, 22), getContoursOutline(ffiContours), 0, 'ffi');
            assertOutlineClose(getOutline(narrowBlackFont, 20), getContoursOutline(ffContours), 0, 'ff');
        });

        // The advance of the slash is 845 at the default location and its HVAR delta is exactly
        // -42.5 at wdth=87.5 (the region of the narrow width, -85, with a scalar of 0.5).
        // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=87.5 Roboto-VF-gsub-chaining-subset.ttf -u 002F
        // [1=0+803]
        // fontTools: varLib.instancer.instantiateVariableFont(TTFont('Roboto-VF-gsub-chaining-subset.ttf'),
        // {'wght': 400, 'wdth': 87.5})['hmtx']['slash'] is (803, 26)
        // With Number.EPSILON in the avar mapping the default wght is normalized to 1.1e-15 instead of
        // 0 and a region of wght gets a scalar: the HVAR delta is -42.50000000000016 and the advance 802.
        it('rounds the advance of the slash at wdth=87.5 (an HVAR delta of exactly -42.5) like HarfBuzz', function() {
            assert.deepStrictEqual(shapeText(halfNarrowFont, '/').advances, [803]);
        });

        // hb-shape --no-glyph-names --cluster-level=1 --language=tr Roboto-VF-gsub-chaining-subset.ttf -u 0061,0066,0066,0069,006E,0069,0074,0079
        // [4=0+1114|5=1+712|5=2+712|6=3+498|8=4+1131|6=5+498|9=6+670|10=7+969]
        itFailsUntilFixed(
            'keeps f, f and i apart in "affinity" with the language TRK of latn, which has no liga',
            '_createBidi (src/font.mjs): passes only the features option to the Bidi, the script and language options ' +
            'are ignored and the features are those of the default language system: liga still gives ffi, [4, 22, 8, 6, 9, 10]',
            function() {
                // the language as the tag of the font, with its trailing space
                const glyphs = shapeText(font, 'affinity', { script: 'latn', language: 'TRK ' }).glyphs;
                assert.deepStrictEqual(glyphs, [4, 5, 5, 6, 8, 6, 9, 10]);
            }
        );
    });

    describe('Roboto: ccmp, chaining context format 2 with a nested Single format 2 (#816, #861, #874)', function() {
        let font;
        let narrowFont;
        let narrowBlackFont;

        beforeEach(function() {
            font = loadFont(robotoFixture);
            narrowFont = loadFont(robotoFixture, { wdth: 75 });
            narrowBlackFont = loadFont(robotoFixture, { wdth: 75, wght: 900 });
        });

        it('removes the dot of j and of iogonek before a combining acute', function() {
            // j then the combining acute accent (U+0301)
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 006A,0301
            // [25=0+518|17=1@314,-41+0]
            assertShapedLike(font, 'j\u{301}', { glyphs: [25, 17], clusters: [0, 1], advances: [518, 0] });
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75 Roboto-VF-gsub-chaining-subset.ttf -u 006A,0301
            // [25=0+487|17=1@226,-41+0]
            assertShapedLike(narrowFont, 'j\u{301}', { glyphs: [25, 17], clusters: [0, 1], advances: [487, 0] });
            // i with ogonek (U+012F) then the combining acute accent (U+0301)
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 012F,0301
            // [27=0+507|17=1@311,-2+0]
            assertShapedLike(font, '\u{12F}\u{301}', { glyphs: [27, 17], clusters: [0, 1], advances: [507, 0] });
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75 Roboto-VF-gsub-chaining-subset.ttf -u 012F,0301
            // [27=0+482|17=1@218,-2+0]
            assertShapedLike(narrowFont, '\u{12F}\u{301}', { glyphs: [27, 17], clusters: [0, 1], advances: [482, 0] });
            // "finja" with the combining acute accent (U+0301) on the j: the fi ligature of lookup 3 too
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 0066,0069,006E,006A,0301,0061
            // [21=0+1135|8=2+1131|25=3+518|17=4@314,-41+0|4=5+1114]
            assertShapedLike(font, 'finj\u{301}a', { glyphs: [21, 8, 25, 17, 4], clusters: [0, 2, 3, 4, 5], advances: [1135, 1131, 518, 0, 1114] });
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75,wght=900 Roboto-VF-gsub-chaining-subset.ttf -u 0066,0069,006E,006A,0301,0061
            // [21=0+1172|8=2+1017|25=3+574|17=4@105,-21+0|4=5+955]
            assertShapedLike(narrowBlackFont, 'finj\u{301}a', { glyphs: [21, 8, 25, 17, 4], clusters: [0, 2, 3, 4, 5], advances: [1172, 1017, 574, 0, 955] });
        });

        it('keeps the dot of j when the next glyph is not the acute, removes it before two acutes', function() {
            // j then the combining dot below (U+0323), which is not in the lookahead class
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 006A,0323
            // [7=0+490|18=1@297,-459+0]
            assertShapedLike(font, 'j\u{323}', { glyphs: [7, 18], clusters: [0, 1], advances: [490, 0] });
            // the dot below (U+0323) between j and the acute (U+0301): with the lookupFlag 0 it is not skipped
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 006A,0323,0301
            // [7=0+490|18=1@297,-459+0|17=2@299,310+0]
            assertShapedLike(font, 'j\u{323}\u{301}', { glyphs: [7, 18, 17], clusters: [0, 1, 2], advances: [490, 0, 0] });
            // j before i
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 006A,0069
            // [7=0+490|6=1+498]
            assertShapedLike(font, 'ji', { glyphs: [7, 6], clusters: [0, 1], advances: [490, 498] });
            // j after the acute (U+0301)
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 0301,006A
            // [17=0+0|7=1+490]
            assertShapedLike(font, '\u{301}j', { glyphs: [17, 7], clusters: [0, 1], advances: [0, 490] });
            // two j then the acute (U+0301): only the j next to the acute loses its dot
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 006A,006A,0301
            // [7=0+490|25=1+518|17=2@314,-41+0]
            assertShapedLike(font, 'jj\u{301}', { glyphs: [7, 25, 17], clusters: [0, 1, 2], advances: [490, 518, 0] });
            // j then two acutes (U+0301)
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 006A,0301,0301
            // [25=0+518|17=1@314,-41+0|17=2@314,310+0]
            assertShapedLike(font, 'j\u{301}\u{301}', { glyphs: [25, 17, 17], clusters: [0, 1, 2], advances: [518, 0, 0] });
        });

        it('replaces a and a combining acute with the aacute ligature of ccmp (lookup 2, after the chaining lookup)', function() {
            // a then the combining acute accent (U+0301): the cmap has no U+00E1, HarfBuzz gets the
            // glyph from the lookup too
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 0061,0301
            // [28=0+1114]
            assertShapedLike(font, 'a\u{301}', { glyphs: [28], clusters: [0], advances: [1114] });
        });

        // i then the combining acute accent (U+0301): HarfBuzz composes them to the iacute of the
        // cmap (U+00ED) before GSUB; the test of PR #861 expects dotless i and acutecomb, the ccmp
        // lookup without the composition
        // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 0069,0301
        // [29=0+507]
        itFailsUntilFixed(
            'composes i and a combining acute to the iacute of the font',
            '_createBidi (src/font.mjs): maps each character to its glyph without Unicode normalization, i and the ' +
            'acute are not composed to the iacute of the cmap before GSUB: the ccmp lookup gives dotless i and acutecomb, [26, 17]',
            function() {
                assert.deepStrictEqual(shapeText(font, 'i\u{301}').glyphs, [29]);
            }
        );

        // j, the combining acute accent (U+0301), the combining dot below (U+0323): HarfBuzz puts the
        // marks in canonical order before GSUB (the dot below, class 220, then the acute, class
        // 230), so the acute does not follow j and j keeps its dot
        // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 006A,0301,0323
        // [7=0+490|18=1@297,-459+0|17=1@299,310+0]
        itFailsUntilFixed(
            'keeps the dot of j when the canonical order puts a dot below between j and the acute',
            '_createBidi (src/font.mjs): maps each character to its glyph without Unicode normalization, the marks ' +
            'are not put in canonical order before GSUB: lookup 0 finds the acute right after j and removes its dot, [25, 17, 18]',
            function() {
                assert.deepStrictEqual(shapeText(font, 'j\u{301}\u{323}').glyphs, [7, 18, 17]);
            }
        );

        // j then the combining acute accent (U+0301), ccmp off
        // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-ccmp Roboto-VF-gsub-chaining-subset.ttf -u 006A,0301
        // [7=0+490|17=1@299,310+0]
        itFailsUntilFixed(
            'keeps the dot of j before a combining acute when ccmp is turned off',
            'ccmpReplacementLigatures (src/features/ccmp/ccmpReplacementLigatures.mjs): applies the ccmp lookups ' +
            'whatever the features option, with ccmp: false it takes them over from the latin features: j still ' +
            'loses its dot, [25, 17]',
            function() {
                assert.deepStrictEqual(shapeText(font, 'j\u{301}', { features: { ccmp: false } }).glyphs, [7, 17]);
            }
        );

        // j, the combining acute accent (U+0301), a
        // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 006A,0301,0061
        // [25=0+518|17=1@314,-41+0|4=2+1114]
        // The acute is 314 units after the end of the dotless j (518 + 314 = 832) and 41 units
        // lower; the y of the text layout goes down, so 41.
        itFailsUntilFixed(
            'places the combining acute on the dotless j with the anchors of GPOS mark',
            'forEachGlyph (src/font.mjs): moves the pen by the advances and the kerning only, GPOS mark to base ' +
            '(lookup type 4) is not applied: the acute stays at the pen position, [17, 518, 0]',
            function() {
                assert.deepStrictEqual(getGlyphOrigins(font, 'j\u{301}a').origins, [[25, 0, 0], [17, 832, 41], [4, 518, 0]]);
            }
        );

        // issue #874: the font written by toArrayBuffer() has the lookup 0 of the fixture, and shapes
        // j and the combining acute accent (U+0301) like it
        // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 006A,0301
        // [25=0+518|17=1@314,-41+0]
        itFailsUntilFixed(
            'writes the chaining context format 2 lookup with toArrayBuffer()',
            'makeLookup6 (src/tables/gsub.mjs): throws "lookup type 6 format 2 is not yet supported."',
            function() {
                const writtenFont = parse(font.toArrayBuffer());
                assert.deepStrictEqual(shapeText(writtenFont, 'j\u{301}').glyphs, [25, 17]);
            },
            /lookup type 6 format 2 is not yet supported/
        );
    });

    describe('Roboto: frac, chaining context format 3 with a backtrack and a nested Single format 2 (#816)', function() {
        let font;
        let narrowFont;
        let narrowBlackFont;

        beforeEach(function() {
            font = loadFont(robotoFixture);
            narrowFont = loadFont(robotoFixture, { wdth: 75 });
            narrowBlackFont = loadFont(robotoFixture, { wdth: 75, wght: 900 });
        });

        it('turns "12/21" into numerators, fraction and denominators', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=frac Roboto-VF-gsub-chaining-subset.ttf -u 0031,0032,002F,0032,0031
            // [13=0+751|11=1+751|19=2+931|23=3+751|24=4+751]
            assertShapedLike(font, '12/21', { glyphs: [13, 11, 19, 23, 24], clusters: [0, 1, 2, 3, 4], advances: [751, 751, 931, 751, 751] }, { features: { frac: true } });
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75 --features=frac Roboto-VF-gsub-chaining-subset.ttf -u 0031,0032,002F,0032,0031
            // [13=0+675|11=1+675|19=2+826|23=3+675|24=4+675]
            assertShapedLike(narrowFont, '12/21', { glyphs: [13, 11, 19, 23, 24], clusters: [0, 1, 2, 3, 4], advances: [675, 675, 826, 675, 675] }, { features: { frac: true } });
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wdth=75,wght=900 --features=frac Roboto-VF-gsub-chaining-subset.ttf -u 0031,0032,002F,0032,0031
            // [13=0+692|11=1+692|19=2+798|23=3+692|24=4+692]
            assertShapedLike(narrowBlackFont, '12/21', { glyphs: [13, 11, 19, 23, 24], clusters: [0, 1, 2, 3, 4], advances: [692, 692, 798, 692, 692] }, { features: { frac: true } });
            // frac is off by default
            // hb-shape --no-glyph-names --cluster-level=1 --language=en Roboto-VF-gsub-chaining-subset.ttf -u 0031,0032,002F,0032,0031
            // [2=0+1151|3=1+1151|1=2+845|3=3+1151|2=4+1151]
            assertShapedLike(font, '12/21', { glyphs: [2, 3, 1, 3, 2], clusters: [0, 1, 2, 3, 4], advances: [1151, 1151, 845, 1151, 1151] });
        });

        it('chains the denominators only after a fraction or another denominator', function() {
            const options = { features: { frac: true } };
            // "1/221": each denominator is the backtrack of the next one
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=frac Roboto-VF-gsub-chaining-subset.ttf -u 0031,002F,0032,0032,0031
            // [13=0+751|19=1+931|23=2+751|23=3+751|24=4+751]
            assertShapedLike(font, '1/221', { glyphs: [13, 19, 23, 23, 24], clusters: [0, 1, 2, 3, 4], advances: [751, 931, 751, 751, 751] }, options);
            // "a1/2a2": the last digit follows a letter and is a numerator
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=frac Roboto-VF-gsub-chaining-subset.ttf -u 0061,0031,002F,0032,0061,0032
            // [4=0+1114|13=1+751|19=2+931|23=3+751|4=4+1114|11=5+751]
            assertShapedLike(font, 'a1/2a2', { glyphs: [4, 13, 19, 23, 4, 11], clusters: [0, 1, 2, 3, 4, 5], advances: [1114, 751, 931, 751, 1114, 751] }, options);
            // "1/a2": a letter right after the fraction breaks the chain
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=frac Roboto-VF-gsub-chaining-subset.ttf -u 0031,002F,0061,0032
            // [13=0+751|19=1+931|4=2+1114|11=3+751]
            assertShapedLike(font, '1/a2', { glyphs: [13, 19, 4, 11], clusters: [0, 1, 2, 3], advances: [751, 931, 1114, 751] }, options);
            // "1/2/1": each slash starts a chain
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=frac Roboto-VF-gsub-chaining-subset.ttf -u 0031,002F,0032,002F,0031
            // [13=0+751|19=1+931|23=2+751|19=3+931|24=4+751]
            assertShapedLike(font, '1/2/1', { glyphs: [13, 19, 23, 19, 24], clusters: [0, 1, 2, 3, 4], advances: [751, 931, 751, 931, 751] }, options);
            // "/1": the fraction at the start of the text
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=frac Roboto-VF-gsub-chaining-subset.ttf -u 002F,0031
            // [19=0+931|24=1+751]
            assertShapedLike(font, '/1', { glyphs: [19, 24], clusters: [0, 1], advances: [931, 751] }, options);
        });
    });

    describe('Noto Sans Thai Looped: ccmp, chaining context format 3 with a nested Single format 1 (#860, #870)', function() {
        let font;
        let narrowestFont;
        let narrowFont;
        let halfNarrowSemiBoldFont;

        beforeEach(function() {
            font = loadFont(thaiFixture);
            narrowestFont = loadFont(thaiFixture, { wdth: 62.5 });
            narrowFont = loadFont(thaiFixture, { wdth: 75 });
            halfNarrowSemiBoldFont = loadFont(thaiFixture, { wdth: 87.5, wght: 650 });
        });

        it('shortens the tail of lo chula before sara i, without throwing, at each location', function() {
            // lo chula (U+0E2C) then sara i (U+0E34), the text of the issue
            // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E2C,0E34
            // [3=0+703|8=1@-1,0+0]
            assertShapedLike(font, '\u{E2C}\u{E34}', { glyphs: [3, 8], clusters: [0, 1], advances: [703, 0] });
            // hb-shape --no-glyph-names --cluster-level=1 --variations=wdth=62.5 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E2C,0E34
            // [3=0+497|8=1@-6,0+0]
            assertShapedLike(narrowestFont, '\u{E2C}\u{E34}', { glyphs: [3, 8], clusters: [0, 1], advances: [497, 0] });
            // lo chula (U+0E2C) alone
            // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E2C
            // [2=0+703]
            assertShapedLike(font, '\u{E2C}', { glyphs: [2], clusters: [0], advances: [703] });
            // lo chula (U+0E2C) and sara i (U+0E34) between two ko kai (U+0E01)
            // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E01,0E2C,0E34,0E01
            // [1=0+616|3=1+703|8=2@-1,0+0|1=3+616]
            assertShapedLike(font, '\u{E01}\u{E2C}\u{E34}\u{E01}', { glyphs: [1, 3, 8, 1], clusters: [0, 1, 2, 3], advances: [616, 703, 0, 616] });
            // ko kai (U+0E01), lo chula (U+0E2C), sara i (U+0E34) where the avar of the font bends
            // wdth (-0.6667 to -0.7, -0.3333 to -0.3666)
            // hb-shape --no-glyph-names --cluster-level=1 --variations=wdth=75 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E01,0E2C,0E34
            // [1=0+485|3=1+559|8=2@-5,0+0]
            assertShapedLike(narrowFont, '\u{E01}\u{E2C}\u{E34}', { glyphs: [1, 3, 8], clusters: [0, 1, 2], advances: [485, 559, 0] });
            // hb-shape --no-glyph-names --cluster-level=1 --variations=wdth=87.5,wght=650 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E01,0E2C,0E34
            // [1=0+579|3=1+673|8=2@-7,0+0]
            assertShapedLike(halfNarrowSemiBoldFont, '\u{E01}\u{E2C}\u{E34}', { glyphs: [1, 3, 8], clusters: [0, 1, 2], advances: [579, 673, 0] });
        });

        it('shortens the tail of lo chula before a below vowel and an above mark', function() {
            // lo chula (U+0E2C), sara u (U+0E38), mai tho (U+0E49): HarfBuzz skips sara u (lookupFlag
            // 16, a mark outside of the mark filtering set) and matches the first subtable of lookup
            // 9, like opentype.js (the second subtable, which lists the below vowel, gives the same glyphs)
            // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E2C,0E38,0E49
            // [3=0+703|10=1@-1,0+0|5=2@-1,0+0]
            assertShapedLike(font, '\u{E2C}\u{E38}\u{E49}', { glyphs: [3, 10, 5], clusters: [0, 1, 2], advances: [703, 0, 0] });
            // lo chula (U+0E2C) then sara u (U+0E38) alone: the tail stays
            // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E2C,0E38
            // [2=0+703|10=1@-1,0+0]
            assertShapedLike(font, '\u{E2C}\u{E38}', { glyphs: [2, 10], clusters: [0, 1], advances: [703, 0] });
            // lo chula (U+0E2C) then mai tho (U+0E49) alone: the first subtable
            // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E2C,0E49
            // [3=0+703|5=1@-1,0+0]
            assertShapedLike(font, '\u{E2C}\u{E49}', { glyphs: [3, 5], clusters: [0, 1], advances: [703, 0] });
        });

        it('substitutes mai tho after an above mark (backtrack, nested Single format 1 of lookup 7)', function() {
            // mai tho (U+0E49) after ko kai (U+0E01) and sara i (U+0E34)
            // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E01,0E34,0E49
            // [1=0+616|8=1@-7,0+0|6=2@-6,-18+0]
            assertShapedLike(font, '\u{E01}\u{E34}\u{E49}', { glyphs: [1, 8, 6], clusters: [0, 1, 2], advances: [616, 0, 0] });
            // mai tho (U+0E49) after lo chula (U+0E2C) and sara i (U+0E34): lookups 6 and 9 in one text
            // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E2C,0E34,0E49
            // [3=0+703|8=1@-1,0+0|6=2@0,-18+0]
            assertShapedLike(font, '\u{E2C}\u{E34}\u{E49}', { glyphs: [3, 8, 6], clusters: [0, 1, 2], advances: [703, 0, 0] });
            // mai tho (U+0E49) after ko kai (U+0E01) and another mai tho
            // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E01,0E49,0E49
            // [1=0+616|5=1@-7,0+0|6=2@-7,63+0]
            assertShapedLike(font, '\u{E01}\u{E49}\u{E49}', { glyphs: [1, 5, 6], clusters: [0, 1, 2], advances: [616, 0, 0] });
            // ko kai (U+0E01) and three mai tho (U+0E49): the third one matches the third subtable,
            // its backtrack is glyph 6, the mai tho that the lookup has just substituted
            // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E01,0E49,0E49,0E49
            // [1=0+616|5=1@-7,0+0|6=2@-7,63+0|6=3@-7,339+0]
            assertShapedLike(font, '\u{E01}\u{E49}\u{E49}\u{E49}', { glyphs: [1, 5, 6, 6], clusters: [0, 1, 2, 3], advances: [616, 0, 0, 0] });
            // mai tho (U+0E49) right after ko kai (U+0E01) does not change
            // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E01,0E49
            // [1=0+616|5=1@-7,0+0]
            assertShapedLike(font, '\u{E01}\u{E49}', { glyphs: [1, 5], clusters: [0, 1], advances: [616, 0] });
        });

        // lo chula (U+0E2C), two sara u (U+0E38) and mai tho (U+0E49): with the mark filtering set of
        // lookup 9 the below vowels are skipped and the first subtable matches
        // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E2C,0E38,0E38,0E49
        // [3=0+703|10=1@-1,0+0|10=2@-1,-314+0|5=3@-1,0+0]
        it('skips the marks outside of the mark filtering set of the chaining lookup', function() {
            assert.deepStrictEqual(shapeText(font, '\u{E2C}\u{E38}\u{E38}\u{E49}').glyphs, [3, 10, 10, 5]);
        });

        // lo chula (U+0E2C) then sara i (U+0E34), ccmp off
        // hb-shape --no-glyph-names --cluster-level=1 --features=-ccmp NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E2C,0E34
        // [2=0+703|8=1@-71,135+0]
        itFailsUntilFixed(
            'keeps the tail of lo chula before sara i when ccmp is turned off',
            'updateFeatures (src/font.mjs): overrides only the features of latn, the ccmp of thai stays on ' +
            '(thaiGlyphComposition), and ccmpReplacementLigatures (src/features/ccmp/ccmpReplacementLigatures.mjs) ' +
            'applies the ccmp lookups whatever the features option: lo chula still loses its tail, [3, 8]',
            function() {
                assert.deepStrictEqual(shapeText(font, '\u{E2C}\u{E34}', { features: { ccmp: false } }).glyphs, [2, 8]);
            }
        );

        describe('written by toArrayBuffer() and parsed again (#874)', function() {
            let writtenFont;

            beforeEach(function() {
                writtenFont = parse(font.toArrayBuffer());
            });

            it('keeps the chaining context format 3 lookup 6 and its nested Single format 1', function() {
                // The written font has no gvar and no HVAR (not written), it is the default location.
                // HarfBuzz gives the same glyphs, clusters and advances with the fixture and with the
                // written font (the mark offsets differ: GPOS is not written).
                // ko kai (U+0E01), sara i (U+0E34), mai tho (U+0E49)
                // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E01,0E34,0E49
                // [1=0+616|8=1@-7,0+0|6=2@-6,-18+0]
                assertShapedLike(writtenFont, '\u{E01}\u{E34}\u{E49}', { glyphs: [1, 8, 6], clusters: [0, 1, 2], advances: [616, 0, 0] });
                // ko kai (U+0E01) and three mai tho (U+0E49)
                // hb-shape --no-glyph-names --cluster-level=1 NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E01,0E49,0E49,0E49
                // [1=0+616|5=1@-7,0+0|6=2@-7,63+0|6=3@-7,339+0]
                assertShapedLike(writtenFont, '\u{E01}\u{E49}\u{E49}\u{E49}', { glyphs: [1, 5, 6, 6], clusters: [0, 1, 2, 3], advances: [616, 0, 0, 0] });
            });

            // fontTools: TTFont('NotoSansThaiLooped-VF-gsub-chaining-subset.ttf')['GSUB'].table.LookupList.Lookup[9]
            // has LookupFlag 16 and MarkFilteringSet 0; in the file written by the fork it reads 3. Set 3
            // of the GDEF of the fixture has the same glyphs as set 0, so the wrong index does not
            // change the shaping of this font: HarfBuzz no longer shortens the tail of lo chula before
            // sara i in the written file only because GDEF is not written ([2=0+703|8=1+0] for
            // -u 0E2C,0E34, the same with the index patched to 0).
            itFailsUntilFixed(
                'keeps the mark filtering set of the chaining lookup 9',
                'LookupList (src/table.mjs): writes the lookupFlag with its useMarkFilteringSet bit but not the ' +
                'markFilteringSet field, the font parsed again reads the first value of the first subtable in its ' +
                'place, 3 (and fontToSfntTable in src/tables/sfnt.mjs does not write GDEF, where the sets are)',
                function() {
                    assert.strictEqual(writtenFont.tables.gsub.lookups[9].markFilteringSet, 0);
                }
            );
        });
    });
});
