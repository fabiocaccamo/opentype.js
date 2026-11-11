/**
 * Upstream issue #754 (open): in Readex Pro the lowercase 'l' keeps the same thickness at every
 * wght (and the 'i' of Mona Sans is distorted along slnt: the same mechanism, without a fixture
 * here). The same gvar mechanism on the fonts of the upstream PRs #856, #872 and #849 is in
 * gvarPrivatePoints.spec.mjs.
 *
 * Mechanism: gvar data of a glyph that has shared point numbers next to tuples flagged
 * "private point numbers" with a count of 0, which means all points. In the fixtures:
 * - l has the shared points [0, 5] (its HEXP tuple and its wght above 400 with HEXP tuple) and
 *   all points in its other tuples (wght below 400, wght above 400, wght below 400 with HEXP);
 * - H has shared points used through IUP and all points in its (wght below 400, HEXP) tuple;
 * - i.loclTRK, a composite of dotlessi and uni0307, has the shared points [1, 3] (its second
 *   component and its right phantom point) and all points in three of its tuples; dotlessi
 *   and uni0307 have shared points next to an all points tuple too.
 * Upstream master reads such a tuple with the count of the shared points and applies it to
 * them: there the stem of 'l' is 103 units wide at every weight (x 71 and 174 at wght 700,
 * x 88 and 191 at wght 160).
 *
 * Fixtures (Readex Pro 1.205, axes wght 160..400..700 with avar and HEXP 0..0..100, glyf, gvar,
 * MVAR, GSUB locl, GPOS kern as PairPos format 2 without variation; how they were built is in
 * test/fonts/regression/README.md):
 * - ReadexPro-VF-gvar-shared-points-subset.ttf: HVAR with an advance width map and no LSB map
 * - ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf: the same subset without HVAR, the
 *   advance widths vary through the gvar phantom points
 * Glyph ids: H 1, e 2, i 3, dotlessi 4, i.loclTRK 5, l 6, lacute 7, o 8, uni0660 10,
 * fraction 11, space 12, uni066A 13, uni0307 14, acutecomb.case 15.
 *
 * References: "instancer at <location>" is fontTools.varLib.instancer.instantiateVariableFont(
 * TTFont(fixture), location, optimize=False), saved and reloaded: glyf[name].getCoordinates(glyf)[0]
 * for the points, hmtx[name] for the advance width and the left side bearing. Both fixtures
 * give the same values, and the static instance of hb-subset --variations has the same points
 * and metrics for every value asserted here. The shaped text is hb-shape, the command is above
 * each expected value, with --language=en: the font has the language systems AZE, CRT, KAZ,
 * TAT and TRK, and with a Turkish locale hb-shape gives i.loclTRK for 'i'. The text layout of
 * the fork applies the default language system only, so i.loclTRK (hb-shape --language=tr) is
 * read here by its glyph index.
 *
 * On upstream master (5d65b6d):
 * - the tests of the points of l, lacute, H at wght 160 with HEXP 100 and i.loclTRK fail on
 *   their values, they are the regression tests of the fix (the test of the outline of l fails
 *   too, first on the contour that getPath does not close there; in the test of avar the points
 *   of l are wrong, those of i and H are right; the points of U+066A are wrong there too at
 *   wght 700 and at wght 160 with HEXP 100, not at wght 160, without the gvar data of #754:
 *   its tuples all use its shared point numbers, which are all points);
 * - the test of i and o at wght 700 passes, it is a guard;
 * - getTransform(glyph).advanceWidth gives the HVAR advances of "Hello ill" and the kerning has
 *   no variation, so that test is a guard too, but it does not run: every test that goes
 *   through shapeText (font.stringToGlyphClusters) or variation.getLeftSideBearing uses API
 *   that upstream master does not have;
 * - the advance widths without HVAR are the default ones at every location, the gvar phantom
 *   points are not read at all;
 * - of the known failures that read getTransform, uni0660 and fraction have the same wrong
 *   points as in the fork; i and uni066A are wrong in other points, and the advance widths of
 *   i.loclTRK and of the space without HVAR are the default ones, like the other advance widths.
 */

import assert from 'assert';
import { loadFont, shapeText, assertShape, getOutline, assertOutlineClose, itFailsUntilFixed } from './helpers.mjs';

const hvarFixture = 'ReadexPro-VF-gvar-shared-points-subset.ttf';
const noHvarFixture = 'ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf';

const glyphIndexes = { H: 1, i: 3, 'i.loclTRK': 5, l: 6, lacute: 7, o: 8, uni0660: 10, fraction: 11, space: 12, uni066A: 13 };

// The axis locations of the tests, by the name the tests give them. No variation is set on
// the font of 'default'. The named instances of the font are on the wght axis only: 200 is
// ExtraLight, 300 Light, 400 Regular and 700 Bold.
const locations = {
    'default': undefined,
    'wght 160': { wght: 160 },
    'wght 200': { wght: 200 },
    'wght 300': { wght: 300 },
    'wght 400': { wght: 400 },
    'wght 418': { wght: 418 },
    'wght 700': { wght: 700 },
    'wght 160, HEXP 100': { wght: 160, HEXP: 100 },
    'wght 400, HEXP 100': { wght: 400, HEXP: 100 },
    'wght 550, HEXP 50': { wght: 550, HEXP: 50 },
    'wght 700, HEXP 100': { wght: 700, HEXP: 100 }
};

// A new font at each location, to load before each test: a font keeps the glyphs it has
// parsed, and a test must not see the state that another test left.
function loadFonts(fileName) {
    const fonts = {};
    for (const [location, variation] of Object.entries(locations)) {
        fonts[location] = loadFont(fileName, variation);
    }
    return fonts;
}

// The glyf points of a glyph at the current variation of the font, as [x, y], like
// glyf[name].getCoordinates(glyf)[0] of the static instance (the path commands of getOutline
// start a contour at another point than the pens of fontTools and add the implied points).
function getPoints(font, glyphIndex) {
    return font.variation.getTransform(glyphIndex).points.map(point => [point.x, point.y]);
}

// The path of the one contour of 'l', a rectangle from the baseline to y 740: the pens of
// fontTools start it at the bottom left point, getPath starts it at its last point (bottom
// right) and draws the closing line.
function getStemOutline(left, right) {
    return [['M', right, 0], ['L', left, 0], ['L', left, 740], ['L', right, 740], ['L', right, 0], ['Z']];
}

// The left side bearings of l, H and lacute at the current variation of the font, to compare
// with the hmtx of the static instance.
function getLeftSideBearings(font) {
    return [glyphIndexes.l, glyphIndexes.H, glyphIndexes.lacute].map(glyphIndex => font.variation.getLeftSideBearing(glyphIndex));
}

// The left side bearings of l, H and lacute (U+013A, LATIN SMALL LETTER L WITH ACUTE): the hmtx
// of the instancer at wght=700 and at wght=160 (HEXP=0), which is the x bearing of the extents
// of hb-shape. The same values with both fixtures:
// hb-shape --no-glyph-names --cluster-level=1 --language=en --show-extents --variations=wght=700 ReadexPro-VF-gvar-shared-points-subset.ttf -u 006C,0048,013A
// [6=0+304<71,740,161,-740>|1=1+780<87,700,606,-700>|7=2+304<27,984,264,-984>]
// hb-shape --no-glyph-names --cluster-level=1 --language=en --show-extents --variations=wght=700 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 006C,0048,013A
// [6=0+304<71,740,161,-740>|1=1+780<87,700,606,-700>|7=2+304<27,984,264,-984>]
// hb-shape --no-glyph-names --cluster-level=1 --language=en --show-extents --variations=wght=160 ReadexPro-VF-gvar-shared-points-subset.ttf -u 006C,0048,013A
// [6=0+216<88,740,40,-740>|1=1+739<107,700,524,-700>|7=2+216<39,923,179,-923>]
// hb-shape --no-glyph-names --cluster-level=1 --language=en --show-extents --variations=wght=160 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 006C,0048,013A
// [6=0+216<88,740,40,-740>|1=1+739<107,700,524,-700>|7=2+216<39,923,179,-923>]
const leftSideBearingReferences = [
    { location: 'wght 700', leftSideBearings: [71, 87, 27] },
    { location: 'wght 160', leftSideBearings: [88, 107, 39] }
];

describe('regression: gvar tuples with all points next to shared point numbers (#754)', function() {

    describe(`${hvarFixture} (advance widths from HVAR)`, function() {
        let fonts;

        beforeEach(function() {
            fonts = loadFonts(hvarFixture);
        });

        it('draws the stem of l thicker and thinner along wght (#754)', function() {
            // instancer at wght=700, wght=160 and wght=400 (HEXP=0), glyph l, RecordingPen:
            // moveTo (71, 0), lineTo (71, 740), lineTo (232, 740), lineTo (232, 0), closePath at wght 700,
            // the same with x 88 and 128 at wght 160, with x 74 and 177 at wght 400.
            // The stem is 161, 40 and 103 units wide: #754 is a stem as wide as the default at every weight.
            assertOutlineClose(getOutline(fonts['wght 700'], glyphIndexes.l), getStemOutline(71, 232), 0, 'wght 700');
            assertOutlineClose(getOutline(fonts['wght 160'], glyphIndexes.l), getStemOutline(88, 128), 0, 'wght 160');
            assertOutlineClose(getOutline(fonts['wght 400'], glyphIndexes.l), getStemOutline(74, 177), 0, 'wght 400');
            assertOutlineClose(getOutline(fonts['default'], glyphIndexes.l), getStemOutline(74, 177), 0, 'default');
        });

        it('varies the components and their offsets in the composites lacute and U+066A', function() {
            // instancer at wght=700, at wght=160 (HEXP=0) and at wght=160, HEXP=100, glyphs lacute
            // (components l, with its all points tuples, and acutecomb.case) and uni066A (ARABIC
            // PERCENT SIGN: components fraction, uni0660 and uni0660 again, at another offset)
            const expectedPoints = {
                'wght 700': {
                    lacute: [
                        [71, 0], [71, 740], [232, 740], [232, 0],
                        [64, 788], [27, 868], [236, 984], [291, 866]
                    ],
                    uni066A: [
                        [26, 0], [493, 700], [640, 700], [172, 0],
                        [499, 205], [617, 87], [500, -30], [383, 87],
                        [180, 739], [298, 621], [181, 504], [64, 621]
                    ]
                },
                'wght 160': {
                    lacute: [
                        [88, 0], [88, 740], [128, 740], [128, 0],
                        [53, 802], [39, 827], [197, 923], [218, 886]
                    ],
                    uni066A: [
                        [85, 0], [553, 700], [597, 700], [129, 0],
                        [488, 131], [532, 87], [489, 44], [445, 87],
                        [169, 665], [213, 621], [170, 578], [126, 621]
                    ]
                },
                'wght 160, HEXP 100': {
                    lacute: [
                        [208, 0], [208, 740], [249, 740], [249, 0],
                        [155, 802], [141, 826], [299, 923], [320, 885]
                    ],
                    uni066A: [
                        [115, 0], [603, 700], [650, 700], [161, 0],
                        [553, 131], [597, 87], [554, 44], [510, 87],
                        [184, 665], [228, 621], [185, 578], [141, 621]
                    ]
                }
            };
            for (const [location, pointsOfGlyphs] of Object.entries(expectedPoints)) {
                for (const [glyphName, points] of Object.entries(pointsOfGlyphs)) {
                    assert.deepStrictEqual(getPoints(fonts[location], glyphIndexes[glyphName]), points, `${glyphName} at ${location}`);
                }
            }
            // instancer at wght=700, HEXP=0, glyphs uni0660 and fraction, the components of uni066A
            assert.deepStrictEqual(getPoints(fonts['wght 700'], glyphIndexes.uni0660), [[165, 356], [283, 238], [166, 121], [49, 238]]);
            assert.deepStrictEqual(getPoints(fonts['wght 700'], glyphIndexes.fraction), [[-4, 0], [463, 700], [610, 700], [142, 0]]);
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=700 ReadexPro-VF-gvar-shared-points-subset.ttf -u 013A
            // [7=0+304]
            assertShape(shapeText(fonts['wght 700'], '\u{13A}'), { glyphs: [7], clusters: [0], ends: [1], advances: [304] }, 'U+013A');
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=700 ReadexPro-VF-gvar-shared-points-subset.ttf -u 066A
            // [13=0+694]
            assertShape(shapeText(fonts['wght 700'], '\u{66A}'), { glyphs: [13], clusters: [0], ends: [1], advances: [694] }, 'U+066A');
        });

        it('adds the all points tuples of l (two locations) and of H (wght 160, HEXP 100) to their shared points tuples', function() {
            // instancer at wght=160, HEXP=100, glyphs l and H. Active tuples of l: wght (all points),
            // HEXP (shared points), wght with HEXP (all points); of H: wght (shared points) and HEXP
            // (private points), both with the other points through IUP, wght with HEXP (all points).
            // Shared points used through IUP next to an all points tuple: the shape of the gvar
            // data of the 'i' of Mona Sans in #754.
            const fontAtWeight160Expanded = fonts['wght 160, HEXP 100'];
            assert.deepStrictEqual(getPoints(fontAtWeight160Expanded, glyphIndexes.l), [[208, 0], [208, 740], [249, 740], [249, 0]]);
            assert.deepStrictEqual(getPoints(fontAtWeight160Expanded, glyphIndexes.H), [
                [813, 0], [813, 700], [855, 700], [855, 0],
                [191, 0], [191, 700], [233, 700], [233, 0],
                [211, 324], [212, 366], [832, 366], [832, 324]
            ]);
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=160,HEXP=100 ReadexPro-VF-gvar-shared-points-subset.ttf -u 0048,006C
            // [1=0+1047|6=1+458]
            assertShape(shapeText(fontAtWeight160Expanded, 'Hl'), { glyphs: [1, 6], clusters: [0, 1], advances: [1047, 458] });

            // instancer at wght=550, HEXP=50, glyphs l and H. Active tuples of l: wght (all points),
            // HEXP and wght with HEXP (shared points). Active tuples of H: wght (shared points) and
            // HEXP (private points), both through IUP; its all points tuple is not active here, so
            // H is a guard of the points next to it and not a test of #754. The fork is exact for
            // these two glyphs at this location, not for U+0660 and U+066A (see their known failures).
            const fontAtWeight550HalfExpanded = fonts['wght 550, HEXP 50'];
            assert.deepStrictEqual(getPoints(fontAtWeight550HalfExpanded, glyphIndexes.l), [[141, 0], [141, 740], [273, 740], [273, 0]]);
            assert.deepStrictEqual(getPoints(fontAtWeight550HalfExpanded, glyphIndexes.H), [
                [651, 0], [651, 700], [790, 700], [790, 0],
                [135, 0], [135, 700], [274, 700], [274, 0],
                [192, 283], [193, 412], [720, 412], [720, 283]
            ]);
        });

        it('adds the all points tuples of the composite i.loclTRK and of its components to their shared points tuples', function() {
            const glyphIndex = glyphIndexes['i.loclTRK'];
            // instancer at wght=160, HEXP=100, glyph i.loclTRK (components dotlessi and uni0307).
            // Active tuples of the composite: wght (all points), HEXP (shared points), wght with
            // HEXP (all points); the wght tuple of dotlessi and the wght with HEXP tuple of
            // uni0307 have all points next to the shared points of the HEXP tuple.
            const fontAtWeight160Expanded = fonts['wght 160, HEXP 100'];
            assert.deepStrictEqual(getPoints(fontAtWeight160Expanded, glyphIndex), [
                [198, 0], [198, 525], [239, 525], [239, 0],
                [219, 660], [200, 660], [181, 681], [181, 698], [181, 714], [200, 735],
                [219, 735], [236, 735], [257, 715], [257, 698], [257, 681], [238, 660]
            ]);
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr --variations=wght=160,HEXP=100 ReadexPro-VF-gvar-shared-points-subset.ttf -u 0069
            // [5=0+441]
            assert.strictEqual(fontAtWeight160Expanded.glyphs.get(glyphIndex).getAdvanceWidth(fontAtWeight160Expanded), 441);

            // instancer at wght=700, HEXP=100, glyph i.loclTRK. Active tuples of the composite:
            // wght and HEXP (shared points), wght with HEXP (all points).
            const fontAtWeight700Expanded = fonts['wght 700, HEXP 100'];
            assert.deepStrictEqual(getPoints(fontAtWeight700Expanded, glyphIndex), [
                [200, 0], [200, 531], [361, 531], [361, 0],
                [280, 641], [234, 641], [184, 684], [184, 724], [184, 761], [235, 807],
                [280, 807], [326, 807], [376, 764], [376, 724], [376, 687], [325, 641]
            ]);
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr --variations=wght=700,HEXP=100 ReadexPro-VF-gvar-shared-points-subset.ttf -u 0069
            // [5=0+561]
            assert.strictEqual(fontAtWeight700Expanded.glyphs.get(glyphIndex).getAdvanceWidth(fontAtWeight700Expanded), 561);
        });

        it('gives the points of the static instance to i and o at wght 700 (private points, the other points through IUP)', function() {
            // instancer at wght=700, HEXP=0, glyphs i and o: one tuple is active, with 8 of the
            // 20 points of i and 20 of the 36 points of o (phantom points included), on curve
            // and off curve; the other points are interpolated (IUP).
            assert.deepStrictEqual(getPoints(fonts['wght 700'], glyphIndexes.i), [
                [80, 0], [80, 531], [241, 531], [241, 0],
                [161, 636], [115, 636], [64, 679], [64, 719], [64, 756], [116, 802],
                [161, 802], [205, 802], [256, 759], [256, 719], [256, 682], [205, 636]
            ]);
            assert.deepStrictEqual(getPoints(fonts['wght 700'], glyphIndexes.o), [
                [320, -10], [238, -10], [108, 61], [34, 186], [34, 265], [34, 346], [108, 471], [238, 542],
                [320, 542], [403, 542], [532, 471], [606, 346], [606, 265], [606, 186], [532, 61], [403, -10],
                [320, 128], [356, 128], [411, 164], [443, 226], [442, 265], [443, 306], [411, 369], [356, 404],
                [320, 404], [285, 404], [229, 368], [197, 306], [197, 265], [197, 226], [229, 164], [285, 128]
            ]);
        });

        it('maps wght 300 and wght 200 through avar before the tuples of l, i and H', function() {
            // instancer at wght=300, HEXP=0, glyphs l, i and H. The avar segment map turns the
            // normalized -0.41669 into -0.4375: without the avar table the instancer gives x 157
            // instead of 156 for the two right points of l, so this is exact or it tests nothing.
            const fontAtWeight300 = fonts['wght 300'];
            assert.deepStrictEqual(getPoints(fontAtWeight300, glyphIndexes.l), [[80, 0], [80, 740], [156, 740], [156, 0]]);
            assert.deepStrictEqual(getPoints(fontAtWeight300, glyphIndexes.i), [
                [88, 0], [88, 525], [164, 525], [164, 0],
                [125, 648], [99, 648], [70, 677], [70, 701], [70, 725], [99, 754],
                [125, 754], [151, 754], [180, 726], [180, 701], [180, 678], [152, 648]
            ]);
            assert.deepStrictEqual(getPoints(fontAtWeight300, glyphIndexes.H), [
                [570, 0], [570, 700], [649, 700], [649, 0],
                [102, 0], [102, 700], [181, 700], [181, 0],
                [137, 311], [137, 387], [606, 387], [606, 311]
            ]);
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=300 ReadexPro-VF-gvar-shared-points-subset.ttf -u 006C,0069,0048
            // [6=0+236|3=1+250|1=2+751]
            assertShape(shapeText(fontAtWeight300, 'liH'), { glyphs: [6, 3, 1], clusters: [0, 1, 2], advances: [236, 250, 751] }, 'wght 300');

            // instancer at wght=200, HEXP=0 (the named instance ExtraLight), glyphs i and H: the
            // other segment of avar, -0.83331 into -0.84375. Without the avar table the instancer
            // gives x 139 instead of 138 for the two right points of the stem of i, x 583, 105 and
            // 159 instead of 584, 106 and 158 for H, and the advances 222, 226 and 743.
            const fontAtWeight200 = fonts['wght 200'];
            assert.deepStrictEqual(getPoints(fontAtWeight200, glyphIndexes.i), [
                [87, 0], [87, 525], [138, 525], [138, 0],
                [113, 655], [92, 655], [70, 678], [70, 697], [70, 716], [92, 738],
                [113, 738], [132, 738], [155, 716], [155, 697], [155, 679], [134, 655]
            ]);
            assert.deepStrictEqual(getPoints(fontAtWeight200, glyphIndexes.H), [
                [584, 0], [584, 700], [636, 700], [636, 0],
                [106, 0], [106, 700], [158, 700], [158, 0],
                [130, 323], [130, 375], [608, 375], [608, 323]
            ]);
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=200 ReadexPro-VF-gvar-shared-points-subset.ttf -u 006C,0069,0048
            // [6=0+221|3=1+225|1=2+742]
            assertShape(shapeText(fontAtWeight200, 'liH'), { glyphs: [6, 3, 1], clusters: [0, 1, 2], advances: [221, 225, 742] }, 'wght 200');
        });

        it('shapes "Hello ill" with the HVAR advances of the instance and the class kerning of l and o', function() {
            // The kerning (PairPos format 2, l and o: -10) has no variation, the advances come from
            // HVAR: not the gvar mechanism of #754.
            const expected = { glyphs: [1, 2, 6, 6, 8, 12, 3, 6, 6], clusters: [0, 1, 2, 3, 4, 5, 6, 7, 8], ends: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
            // hb-shape --no-glyph-names --cluster-level=1 --language=en ReadexPro-VF-gvar-shared-points-subset.ttf -u 0048,0065,006C,006C,006F,0020,0069,006C,006C
            // [1=0+761|2=1+586|6=2+251|6=3+241|8=4+615|12=5+280|3=6+278|6=7+251|6=8+251]
            assertShape(
                shapeText(fonts['default'], 'Hello ill'),
                { ...expected, advances: [761, 586, 251, 241, 615, 280, 278, 251, 251] },
                'default'
            );
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=700 ReadexPro-VF-gvar-shared-points-subset.ttf -u 0048,0065,006C,006C,006F,0020,0069,006C,006C
            // [1=0+780|2=1+587|6=2+304|6=3+294|8=4+640|12=5+319|3=6+321|6=7+304|6=8+304]
            assertShape(
                shapeText(fonts['wght 700'], 'Hello ill'),
                { ...expected, advances: [780, 587, 304, 294, 640, 319, 321, 304, 304] },
                'wght 700'
            );
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=550,HEXP=50 ReadexPro-VF-gvar-shared-points-subset.ttf -u 0048,0065,006C,006C,006F,0020,0069,006C,006C
            // [1=0+925|2=1+759|6=2+414|6=3+404|8=4+800|12=5+402|3=6+432|6=7+414|6=8+414]
            assertShape(
                shapeText(fonts['wght 550, HEXP 50'], 'Hello ill'),
                { ...expected, advances: [925, 759, 414, 404, 800, 402, 432, 414, 414] },
                'wght 550, HEXP 50'
            );
            // The transformed glyph has the HVAR advance too, also a glyph without points
            // (see the known failure of the space without HVAR):
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=700 ReadexPro-VF-gvar-shared-points-subset.ttf -u 0020
            // [12=0+319]
            assert.strictEqual(fonts['wght 700'].variation.getTransform(glyphIndexes.space).advanceWidth, 319);
        });

        itFailsUntilFixed(
            'gives the points of the static instance to i at wght 700, HEXP 100',
            'applyTupleVariationStore (src/variationprocessor.mjs): rounds the points after every tuple instead of once: the first point of the dot is x 297 instead of 296',
            function() {
                const points = getPoints(fonts['wght 700, HEXP 100'], glyphIndexes.i);
                // instancer at wght=700, HEXP=100, glyph i. Three tuples are active with scalar 1,
                // their interpolated x deltas of point 4 are 21.62, 130 and 5.5:
                // 139 + 157.12 = 296.12, while rounding after each one gives 161, 291, 297.
                assert.deepStrictEqual(points, [
                    [216, 0], [216, 531], [377, 531], [377, 0],
                    [296, 646], [251, 646], [200, 689], [200, 729], [200, 766], [252, 812],
                    [296, 812], [341, 812], [392, 769], [392, 729], [392, 692], [340, 646]
                ]);
            }
        );

        // instancer at wght=550, HEXP=50, glyphs uni0660 and uni066A (ARABIC PERCENT SIGN,
        // components fraction, uni0660, uni0660). The normalized location is (0.5, 0.5): deltas
        // and component offsets fall on .5 ties, which the instancer rounds up. Active tuples
        // of uni0660: wght above 400 and HEXP; of uni066A: the same and wght above 400 with HEXP.
        for (const reference of [
            {
                glyphName: 'uni0660',
                scalars: 'the scalars 0.5000000000000007 and 0.5000000000000002 instead of 0.5 and 0.5',
                difference: '1 unit off',
                points: [[181, 338], [280, 238], [182, 140], [83, 238]]
            },
            {
                glyphName: 'uni066A',
                scalars: 'the scalars 0.5000000000000007, 0.5000000000000002 and 0.25000000000000056 instead of 0.5, 0.5 and 0.25',
                difference: '2 units off, its component uni0660 and the offsets of its components',
                points: [
                    [89, 0], [567, 700], [691, 700], [213, 0],
                    [572, 187], [671, 87], [573, -11], [474, 87],
                    [223, 721], [322, 621], [224, 523], [125, 621]
                ]
            }
        ]) {
            itFailsUntilFixed(
                `gives the points of the static instance to ${reference.glyphName} at wght 550, HEXP 50`,
                'getNormalizedCoords and getTupleScalar (src/variationprocessor.mjs): their Number.EPSILON terms give ' +
                `${reference.scalars}, and .5 ties round the other way: ${reference.difference}`,
                function() {
                    const points = getPoints(fonts['wght 550, HEXP 50'], glyphIndexes[reference.glyphName]);
                    assert.deepStrictEqual(points, reference.points);
                }
            );
        }

        itFailsUntilFixed(
            'gives the points of the static instance to the fraction slash at wght 300',
            'getNormalizedCoords and getTupleScalar (src/variationprocessor.mjs): the normalized coordinate is not rounded to F2Dot14 before avar ' +
            '(-0.43748 instead of -0.4375) and the scalar gets Number.EPSILON terms: x 30 instead of 31',
            function() {
                const points = getPoints(fonts['wght 300'], glyphIndexes.fraction);
                // instancer at wght=300, HEXP=0, glyph fraction (one tuple active): 20 + 24 * 0.4375 = 30.5
                assert.deepStrictEqual(points, [[31, 0], [498, 700], [573, 700], [105, 0]]);
            }
        );

        itFailsUntilFixed(
            'gives the HVAR advance of HarfBuzz to o at wght 418',
            'getNormalizedCoords (src/variationprocessor.mjs): does not round the normalized coordinate to F2Dot14 (0.06 instead of 983/16384): ' +
            '615 + 25 * 0.06 rounds to 617 instead of 616',
            function() {
                const advances = shapeText(fonts['wght 418'], 'o').advances;
                // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=418 ReadexPro-VF-gvar-shared-points-subset.ttf -u 006F
                // [8=0+616]
                // The hmtx of the instancer at wght=418 is 616 too.
                assert.deepStrictEqual(advances, [616]);
            }
        );

        for (const reference of leftSideBearingReferences) {
            itFailsUntilFixed(
                `takes the left side bearing from the varied outline when HVAR has no LSB map, at ${reference.location}`,
                'getLeftSideBearing (src/variationprocessor.mjs): returns the default left side bearing when HVAR has no LSB map: 74, 98 and 30 for l, H and lacute at every weight',
                function() {
                    const leftSideBearings = getLeftSideBearings(fonts[reference.location]);
                    assert.deepStrictEqual(leftSideBearings, reference.leftSideBearings);
                }
            );
        }
    });

    describe(`${noHvarFixture} (advance widths from the gvar phantom points)`, function() {
        let fonts;

        beforeEach(function() {
            fonts = loadFonts(noHvarFixture);
        });

        it('varies the advances through the phantom points of simple and empty glyphs', function() {
            // No composite glyph in the text, and l only where its all points tuples are not
            // active, see the known failures below (the all points tuple of H is not active at
            // these locations).
            const text = 'He o i';
            const expected = { glyphs: [1, 2, 12, 8, 12, 3], clusters: [0, 1, 2, 3, 4, 5], ends: [1, 2, 3, 4, 5, 6] };
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=700 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 0048,0065,0020,006F,0020,0069
            // [1=0+780|2=1+587|12=2+319|8=3+640|12=4+319|3=5+321]
            assertShape(
                shapeText(fonts['wght 700'], text),
                { ...expected, advances: [780, 587, 319, 640, 319, 321] },
                'wght 700'
            );
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=160 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 0048,0065,0020,006F,0020,0069
            // [1=0+739|2=1+555|12=2+280|8=3+615|12=4+280|3=5+215]
            assertShape(
                shapeText(fonts['wght 160'], text),
                { ...expected, advances: [739, 555, 280, 615, 280, 215] },
                'wght 160'
            );
            // The phantom point deltas of the active tuples add up (for i: wght, HEXP and wght with HEXP):
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=550,HEXP=50 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 0048,0065,0020,006F,0020,0069
            // [1=0+925|2=1+759|12=2+402|8=3+800|12=4+402|3=5+432]
            assertShape(
                shapeText(fonts['wght 550, HEXP 50'], text),
                { ...expected, advances: [925, 759, 402, 800, 402, 432] },
                'wght 550, HEXP 50'
            );
            // The one active tuple of l at wght 400, HEXP 100 has the shared points [0, 5], where
            // point 5 is the right phantom point:
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=400,HEXP=100 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 006C
            // [6=0+523]
            assertShape(shapeText(fonts['wght 400, HEXP 100'], 'l'), { glyphs: [6], clusters: [0], advances: [523] }, 'wght 400, HEXP 100');
        });

        it('varies the advances of the composites lacute and U+066A once they were transformed', function() {
            // The guard of the known failure of the composites that were not drawn yet.
            const font = fonts['wght 700'];
            font.variation.getTransform(glyphIndexes.lacute);
            font.variation.getTransform(glyphIndexes.uni066A);
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=700 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 013A
            // [7=0+304]
            assertShape(shapeText(font, '\u{13A}'), { glyphs: [7], clusters: [0], advances: [304] }, 'U+013A');
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=700 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 066A
            // [13=0+694]
            assertShape(shapeText(font, '\u{66A}'), { glyphs: [13], clusters: [0], advances: [694] }, 'U+066A');
        });

        it('varies the advance of the composite i.loclTRK through the shared points of its right phantom point', function() {
            // The one active tuple at each location has the shared points [1, 3], where point 3
            // (the number of components plus one) is the right phantom point; no all points tuple
            // is active. Read after a transform, like the guard above.
            const glyphIndex = glyphIndexes['i.loclTRK'];
            // Active tuple: wght above 400.
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr --variations=wght=700 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 0069
            // [5=0+290]
            assert.strictEqual(fonts['wght 700'].variation.getTransform(glyphIndex).advanceWidth, 290, 'wght 700');
            // Active tuple: HEXP.
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr --variations=wght=400,HEXP=100 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 0069
            // [5=0+503]
            assert.strictEqual(fonts['wght 400, HEXP 100'].variation.getTransform(glyphIndex).advanceWidth, 503, 'wght 400, HEXP 100');
        });

        it('takes the left side bearing from the varied outline', function() {
            for (const reference of leftSideBearingReferences) {
                assert.deepStrictEqual(getLeftSideBearings(fonts[reference.location]), reference.leftSideBearings, reference.location);
            }
        });

        for (const reference of [
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=700 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 006C
            // [6=0+304]
            { location: 'wght 700', advance: 304, forkAdvance: 248 },
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=160 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 006C
            // [6=0+216]
            { location: 'wght 160', advance: 216, forkAdvance: 265 }
        ]) {
            itFailsUntilFixed(
                `varies the advance of l through the phantom points of its all points tuples, at ${reference.location}`,
                'getPhantomPointDeltas (src/variationprocessor.mjs): reads an empty private point list (all points) as the shared points [0, 5] of l, ' +
                `and takes the delta of point 1 for the right phantom point, point 5: ${reference.forkAdvance} instead of ${reference.advance}`,
                function() {
                    const advances = shapeText(fonts[reference.location], 'l').advances;
                    assert.deepStrictEqual(advances, [reference.advance]);
                }
            );
        }

        for (const reference of [
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=700 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 013A
            // [7=0+304]
            { name: 'lacute', text: '\u{13A}', advance: 304, defaultAdvance: 251 },
            // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=700 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 066A
            // [13=0+694]
            { name: 'U+066A', text: '\u{66A}', advance: 694, defaultAdvance: 682 }
        ]) {
            itFailsUntilFixed(
                `varies the advance of the composite ${reference.name} that was not drawn yet`,
                'getPhantomPointDeltas (src/variationprocessor.mjs): reads glyph.isComposite before the glyf data of the glyph is parsed: ' +
                `the first advance is ${reference.defaultAdvance}, the default, instead of ${reference.advance}; the next calls are right`,
                function() {
                    const advances = shapeText(fonts['wght 700'], reference.text).advances;
                    assert.deepStrictEqual(advances, [reference.advance]);
                }
            );
        }

        itFailsUntilFixed(
            'varies the advance of the composite i.loclTRK through the phantom points of its all points tuples',
            'getPhantomPointDeltas (src/variationprocessor.mjs): reads an empty private point list (all points) as the shared points [1, 3] of this composite ' +
            'of two components, and takes the delta of its second component for the right phantom point, point 3: 213 instead of 181',
            function() {
                const advanceWidth = fonts['wght 160'].variation.getTransform(glyphIndexes['i.loclTRK']).advanceWidth;
                // hb-shape --no-glyph-names --cluster-level=1 --language=tr --variations=wght=160 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 0069
                // [5=0+181]
                assert.strictEqual(advanceWidth, 181);
            }
        );

        itFailsUntilFixed(
            'gives the varied advance width to the transformed space glyph',
            'getTransform (src/variationprocessor.mjs): does not vary the advance width of a glyph without points when the font has no HVAR: ' +
            '280 instead of 319, while getAdvanceWidth gives 319',
            function() {
                const advanceWidth = fonts['wght 700'].variation.getTransform(glyphIndexes.space).advanceWidth;
                // hb-shape --no-glyph-names --cluster-level=1 --language=en --variations=wght=700 ReadexPro-VF-gvar-shared-points-noHVAR-subset.ttf -u 0020
                // [12=0+319]
                assert.strictEqual(advanceWidth, 319);
            }
        );
    });
});
