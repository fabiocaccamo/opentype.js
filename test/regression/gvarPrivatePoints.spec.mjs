/**
 * Upstream PRs #856 (Roboto variable, the period distorted when wght > 400), #872 (synthetic
 * font) and #849 (Inter variable, D and J at wght 900): the same gvar mechanism. The scenario
 * of #856 is asserted here on its own font; the font of #872 is not committed and the glyphs
 * of #849 are already asserted in test/tables/gvar.spec.mjs, both are covered here through
 * the mechanism only.
 *
 * Mechanism: a glyph has a list of shared point numbers, and one of its tuples has the
 * PRIVATE_POINT_NUMBERS flag with a packed point count of 0, which means "all the points of
 * the glyph, phantom points included". Such a tuple was read with the count of the shared
 * points and applied to the shared points.
 *
 * Fixtures (how they were built: test/fonts/regression/README.md):
 * - Roboto-VF-gvar-private-points-subset.ttf: Roboto variable 3.015, axes wght 100..400..900
 *   with avar and wdth 75..100..100, glyf, gvar, HVAR with an advance width map and no LSB map
 * - Roboto-VF-gvar-private-points-noHVAR-subset.ttf: the same subset without HVAR, the advance
 *   widths vary only through the gvar phantom points
 * Glyph ids: .notdef 0, hyphen 1, period 2, colon 3, H 5, z 6, Eacute 11.
 * Tuples with private point numbers for all points: period (7 shared points, the wght max
 * tuple), hyphen and z (3 and 9 shared points, the wdth min tuple), H (7 shared points, the
 * tuple of an intermediate region, wght above the default and wdth below it), Eacute (composite,
 * 2 shared points, 3 tuples of which the wdth min one is asserted). .notdef and the colon (a
 * composite of two periods) have the inverse arrangement: shared point numbers that are all
 * their points, and one tuple with an explicit private list (.notdef: 10 points, 25 is its
 * right phantom point, in the region wght -1..-0.5..0 and wdth min; the colon: [1, 3], the
 * second component and the right phantom point, at wght min and wdth min).
 *
 * References: "instance at <location>" is the static instance of
 * fontTools.varLib.instancer.instantiateVariableFont(TTFont(fixture), location) with the two
 * axes pinned (the one that is not named at its default), saved and reloaded so that glyf and
 * hmtx are rounded. The points are those of
 * glyphSet[name].drawPoints(DecomposingRecordingPointPen(glyphSet)) of
 * fontTools.pens.recordingPen (the components of a composite are drawn as contours), the path
 * is the one of SVGPathPen. The static instance of hb-subset --variations has the same points
 * for every glyph and location asserted here, but for two values of H at wght 700, wdth 85:
 * HarfBuzz maps avar before it rounds the normalized wght to F2Dot14, which gives another
 * location there (see the test of H). The advances and the x bearings are those of hb-shape
 * (HarfBuzz 11.3.2, run from test/fonts/regression/), equal to the hmtx of the instance but
 * for the x bearing of H at the same location, for the same reason.
 *
 * On upstream master (5d65b6d) every test of the points and of the path fails; the points of
 * .notdef, a guard of the inverse arrangement, are right there too. With the fix of the
 * mechanism alone on top of it (the branch fix-gvar-private-points-all-points-tuple of the
 * fork) the points of the period, the hyphen, z, H and .notdef are right: these are the
 * regression tests of the fix. The points of Eacute and of the colon and the path of the period
 * need other fixes of the fork too.
 * The tests of the metrics call what upstream master does not have (stringToGlyphClusters,
 * variation.getLeftSideBearing, Glyph.prototype.getAdvanceWidth) and cannot run there.
 *
 * The same mechanism and the same three gaps of the metrics (the left side bearing with an HVAR
 * without LSB map, the phantom deltas of an all-points tuple read through the shared points,
 * isComposite read before the lazy outline) are tracked on Readex Pro in
 * readexProVariable.spec.mjs (#754). This spec adds the composite with all-points tuples
 * (Eacute), the all-points tuple of an intermediate region (H) and the inverse arrangement
 * (.notdef and the colon).
 */

import assert from 'assert';
import { loadFont, shapeText, assertShape, getOutline, assertOutlineClose, itFailsUntilFixed } from './helpers.mjs';

const hvarFixture = 'Roboto-VF-gvar-private-points-subset.ttf';
const noHvarFixture = 'Roboto-VF-gvar-private-points-noHVAR-subset.ttf';

const glyphIndexes = { notdef: 0, hyphen: 1, period: 2, colon: 3, H: 5, z: 6, Eacute: 11 };

const allPointsPhantomDeltasReason = 'getPhantomPointDeltas (src/variationprocessor.mjs): takes the empty list of private point numbers of an all-points tuple for no list and looks its phantom points up in the shared point numbers, so it reads the delta of another point or none';

/**
 * Points of a glyph at the current variation of the font, like a fontTools
 * DecomposingRecordingPointPen records them (the components of a composite are drawn as
 * contours): ['on', x, y] for a point with a segment type, ['off', x, y] for a point without,
 * ['end'] for endPath. The shape of the outlines of helpers.mjs, so that assertOutlineClose
 * compares them.
 */
function getGlyphPoints(font, glyphIndex) {
    const points = [];
    for (const point of font.variation.getTransform(font.glyphs.get(glyphIndex)).points) {
        points.push([point.onCurve ? 'on' : 'off', point.x, point.y]);
        if (point.lastPointOfContour) {
            points.push(['end']);
        }
    }
    return points;
}

/**
 * getPath draws a zero length line on every on-curve point that follows a curve or the
 * start of the contour, a fontTools pen does not: drop them before comparing.
 */
function dropZeroLengthLines(outline) {
    return outline.filter((command, index) => {
        if (command[0] !== 'L' || index === 0) {
            return true;
        }
        const [previousX, previousY] = outline[index - 1].slice(-2);
        return previousX !== command[1] || previousY !== command[2];
    });
}

/**
 * Left side bearings of the six glyphs of the fixtures at the current variation of the font,
 * in the order period, hyphen, H, z, colon, Eacute.
 */
function getLeftSideBearings(font) {
    return ['period', 'hyphen', 'H', 'z', 'colon', 'Eacute'].map(name => font.variation.getLeftSideBearing(glyphIndexes[name]));
}

describe('regression: gvar private point numbers for all points in a glyph with shared points (#856, #872, #849)', function() {
    describe('Roboto variable with HVAR', function() {
        describe('at wght 500, normalized 0.37 through avar', function() {
            let font;

            beforeEach(function() {
                font = loadFont(hvarFixture, { wght: 500 });
            });

            it('varies all the points of the period', function() {
                // instance at wght=500, glyph period, DecomposingRecordingPointPen
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.period), [
                    ['on', 134, 120], ['off', 134, 176], ['off', 210, 253],
                    ['on', 275, 253], ['off', 341, 253], ['off', 416, 176],
                    ['on', 416, 120], ['off', 416, 64], ['off', 341, -12],
                    ['on', 275, -12], ['off', 210, -12], ['off', 134, 64], ['end']
                ], 0, 'period');
            });
        });

        describe('at wght 700, normalized 0.68 through avar', function() {
            let font;

            beforeEach(function() {
                font = loadFont(hvarFixture, { wght: 700 });
            });

            it('varies all the points of the period', function() {
                // instance at wght=700, glyph period, DecomposingRecordingPointPen
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.period), [
                    ['on', 126, 139], ['off', 126, 203], ['off', 215, 289],
                    ['on', 289, 289], ['off', 363, 289], ['off', 452, 203],
                    ['on', 452, 139], ['off', 452, 75], ['off', 363, -11],
                    ['on', 289, -11], ['off', 215, -11], ['off', 126, 75], ['end']
                ], 0, 'period');
            });
        });

        describe('at wght 900, the all-points tuple of the period alone at its peak', function() {
            let font;

            beforeEach(function() {
                font = loadFont(hvarFixture, { wght: 900 });
            });

            it('varies all the points of the period', function() {
                // instance at wght=900, glyph period, DecomposingRecordingPointPen
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.period), [
                    ['on', 117, 158], ['off', 117, 230], ['off', 221, 327],
                    ['on', 303, 327], ['off', 386, 327], ['off', 489, 230],
                    ['on', 489, 158], ['off', 489, 86], ['off', 386, -11],
                    ['on', 303, -11], ['off', 221, -11], ['off', 117, 86], ['end']
                ], 0, 'period');
            });

            it('draws the path of the period like a fontTools pen', function() {
                // instance at wght=900, glyph period, SVGPathPen:
                // M117 158Q117 230 169.0 278.5Q221 327 303 327Q386 327 437.5 278.5Q489 230 489 158Q489 86 437.5 37.5Q386 -11 303 -11Q221 -11 169.0 37.5Q117 86 117 158Z
                assertOutlineClose(dropZeroLengthLines(getOutline(font, glyphIndexes.period)), [
                    ['M', 117, 158],
                    ['Q', 117, 230, 169, 278.5],
                    ['Q', 221, 327, 303, 327],
                    ['Q', 386, 327, 437.5, 278.5],
                    ['Q', 489, 230, 489, 158],
                    ['Q', 489, 86, 437.5, 37.5],
                    ['Q', 386, -11, 303, -11],
                    ['Q', 221, -11, 169, 37.5],
                    ['Q', 117, 86, 117, 158],
                    ['Z']
                ], 0, 'period');
            });

            itFailsUntilFixed(
                'has the left side bearing of the varied period',
                'getLeftSideBearing (src/variationprocessor.mjs): returns the default left side bearing (144) when HVAR has no LSB mapping, instead of the one of the varied points and phantom points',
                function() {
                    const leftSideBearing = font.variation.getLeftSideBearing(glyphIndexes.period);
                    // the x bearing, equal to the left side bearing of the hmtx of the instance at wght=900
                    // hb-shape --no-glyph-names --cluster-level=1 --show-extents --variations=wght=900 Roboto-VF-gvar-private-points-subset.ttf -u 002E
                    // [2=0+620<117,327,372,-338>]
                    assert.strictEqual(leftSideBearing, 117);
                }
            );
        });

        describe('at wdth 75, the all-points tuples of the hyphen, z and Eacute alone at their peak', function() {
            let font;

            beforeEach(function() {
                font = loadFont(hvarFixture, { wdth: 75 });
            });

            it('varies all the points of the hyphen and of z, and moves the components of Eacute', function() {
                // instance at wdth=75, glyph hyphen, DecomposingRecordingPointPen
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.hyphen), [
                    ['on', 461, 695], ['on', 461, 543], ['on', 48, 543], ['on', 48, 695], ['end']
                ], 0, 'hyphen');
                // instance at wdth=75, glyph z, DecomposingRecordingPointPen
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.z), [
                    ['on', 818, 152], ['on', 818, 0], ['on', 163, 0], ['on', 163, 152], ['end'],
                    ['on', 798, 951], ['on', 203, 0], ['on', 95, 0], ['on', 95, 136], ['on', 686, 1082], ['on', 798, 1082], ['end'],
                    ['on', 721, 1082], ['on', 721, 929], ['on', 98, 929], ['on', 98, 1082], ['end']
                ], 0, 'z');
                // instance at wdth=75, glyph Eacute, DecomposingRecordingPointPen
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.Eacute), [
                    ['on', 940, 157], ['on', 940, 0], ['on', 308, 0], ['on', 308, 157], ['end'],
                    ['on', 341, 1456], ['on', 341, 0], ['on', 157, 0], ['on', 157, 1456], ['end'],
                    ['on', 855, 830], ['on', 855, 673], ['on', 308, 673], ['on', 308, 830], ['end'],
                    ['on', 930, 1456], ['on', 930, 1298], ['on', 308, 1298], ['on', 308, 1456], ['end'],
                    ['on', 438, 1564], ['on', 632, 1858], ['on', 855, 1858], ['on', 587, 1564], ['end']
                ], 0, 'Eacute');
            });
        });

        describe('at wght 700, wdth 85, several active tuples', function() {
            // instance at wght=700,wdth=85, glyph period, DecomposingRecordingPointPen
            const periodPoints = [
                ['on', 126, 141], ['off', 126, 207], ['off', 215, 295],
                ['on', 289, 295], ['off', 364, 295], ['off', 453, 207],
                ['on', 453, 141], ['off', 453, 76], ['off', 364, -11],
                ['on', 289, -11], ['off', 215, -11], ['off', 126, 76], ['end']
            ];
            let font;

            beforeEach(function() {
                font = loadFont(hvarFixture, { wght: 700, wdth: 85 });
            });

            it('adds the all-points tuple of the period to a tuple of 9 private points, within 1 unit', function() {
                // 1 unit: the fork rounds after each tuple, see the known failure below
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.period), periodPoints, 1, 'period');
            });

            itFailsUntilFixed(
                'has the exact points of the period',
                'applyTupleVariationStore (src/variationprocessor.mjs): rounds the points after each tuple instead of once after all of them, 9 coordinates of the period are 1 unit off',
                function() {
                    const points = getGlyphPoints(font, glyphIndexes.period);
                    assertOutlineClose(points, periodPoints, 0, 'period');
                }
            );

            it('varies all the points of H with a tuple of an intermediate region', function() {
                // instance at wght=700,wdth=85, glyph H, DecomposingRecordingPointPen. HarfBuzz has 122
                // where the instance has 123, the x of the two left points of the left stem, because
                // it maps avar in 16.16 before it rounds to F2Dot14 (hb_ot_var_normalize_coords): wght
                // 700 is 11102/16384 there, 11101/16384 in fontTools and in the OpenType algorithm
                // (F2Dot14 rounding, then avar), and the unrounded x is 122.4988 instead of 122.5023.
                // The fork does not round the normalized coordinates (wght 0.6775709, wdth -0.6):
                // its unrounded x is 122.5009.
                // hb-shape --no-glyph-names --cluster-level=1 --show-extents --variations=wght=700,wdth=85 Roboto-VF-gvar-private-points-subset.ttf -u 0048
                // [5=0+1333<122,1456,1086,-1456>]
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.H), [
                    ['on', 995, 865], ['on', 995, 626], ['on', 333, 626], ['on', 333, 865], ['end'],
                    ['on', 418, 1456], ['on', 418, 0], ['on', 123, 0], ['on', 123, 1456], ['end'],
                    ['on', 1208, 1456], ['on', 1208, 0], ['on', 915, 0], ['on', 915, 1456], ['end']
                ], 0, 'H');
            });
        });

        describe('at wght 900, wdth 75', function() {
            let font;

            beforeEach(function() {
                font = loadFont(hvarFixture, { wght: 900, wdth: 75 });
            });

            it('varies all the points of the hyphen and of z with their wdth min tuple, added to a shared point tuple', function() {
                // instance at wght=900,wdth=75, glyph hyphen, DecomposingRecordingPointPen
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.hyphen), [
                    ['on', 688, 758], ['on', 688, 497], ['on', 162, 497], ['on', 162, 758], ['end']
                ], 0, 'hyphen');
                // instance at wght=900,wdth=75, glyph z, DecomposingRecordingPointPen
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.z), [
                    ['on', 856, 260], ['on', 856, 0], ['on', 150, 0], ['on', 150, 260], ['end'],
                    ['on', 855, 900], ['on', 299, 0], ['on', 73, 0], ['on', 73, 188], ['on', 629, 1082], ['on', 855, 1082], ['end'],
                    ['on', 749, 1082], ['on', 749, 822], ['on', 88, 822], ['on', 88, 1082], ['end']
                ], 0, 'z');
            });

            it('moves the components of Eacute with its all-points wdth min tuple, and draws the colon with two varied periods', function() {
                // instance at wght=900,wdth=75, glyph Eacute, DecomposingRecordingPointPen
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.Eacute), [
                    ['on', 959, 270], ['on', 959, 0], ['on', 322, 0], ['on', 322, 270], ['end'],
                    ['on', 441, 1456], ['on', 441, 0], ['on', 99, 0], ['on', 99, 1456], ['end'],
                    ['on', 876, 878], ['on', 876, 617], ['on', 322, 617], ['on', 322, 878], ['end'],
                    ['on', 962, 1456], ['on', 962, 1185], ['on', 322, 1185], ['on', 322, 1456], ['end'],
                    ['on', 411, 1532], ['on', 609, 1846], ['on', 965, 1846], ['on', 686, 1532], ['end']
                ], 0, 'Eacute');
                // instance at wght=900,wdth=75, glyph colon, DecomposingRecordingPointPen
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.colon), [
                    ['on', 123, 158], ['off', 123, 230], ['off', 227, 327],
                    ['on', 309, 327], ['off', 392, 327], ['off', 495, 230],
                    ['on', 495, 158], ['off', 495, 86], ['off', 392, -11],
                    ['on', 309, -11], ['off', 227, -11], ['off', 123, 86], ['end'],
                    ['on', 121, 956], ['off', 121, 1028], ['off', 225, 1125],
                    ['on', 307, 1125], ['off', 390, 1125], ['off', 493, 1028],
                    ['on', 493, 956], ['off', 493, 884], ['off', 390, 787],
                    ['on', 307, 787], ['off', 225, 787], ['off', 121, 884], ['end']
                ], 0, 'colon');
            });
        });

        describe('advance widths', function() {
            // period, hyphen, H, z, colon, U+00C9 LATIN CAPITAL LETTER E WITH ACUTE
            const text = '.-Hz:\u{C9}';
            const references = [
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=500 Roboto-VF-gvar-private-points-subset.ttf -u 002E,002D,0048,007A,003A,00C9
                // [2=0+569|1=1+696|5=2+1453|6=3+1030|3=4+540|11=5+1157]
                { variation: { wght: 500 }, advances: [569, 696, 1453, 1030, 540, 1157] },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=700 Roboto-VF-gvar-private-points-subset.ttf -u 002E,002D,0048,007A,003A,00C9
                // [2=0+594|1=1+807|5=2+1446|6=3+1042|3=4+577|11=5+1152]
                { variation: { wght: 700 }, advances: [594, 807, 1446, 1042, 577, 1152] },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900 Roboto-VF-gvar-private-points-subset.ttf -u 002E,002D,0048,007A,003A,00C9
                // [2=0+620|1=1+921|5=2+1439|6=3+1055|3=4+615|11=5+1146]
                { variation: { wght: 900 }, advances: [620, 921, 1439, 1055, 615, 1146] },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wdth=75 Roboto-VF-gvar-private-points-subset.ttf -u 002E,002D,0048,007A,003A,00C9
                // [2=0+540|1=1+508|5=2+1270|6=3+899|3=4+478|11=5+1018]
                { variation: { wdth: 75 }, advances: [540, 508, 1270, 899, 478, 1018] },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=700,wdth=85 Roboto-VF-gvar-private-points-subset.ttf -u 002E,002D,0048,007A,003A,00C9
                // [2=0+595|1=1+766|5=2+1333|6=3+973|3=4+566|11=5+1064]
                { variation: { wght: 700, wdth: 85 }, advances: [595, 766, 1333, 973, 566, 1064] },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900,wdth=75 Roboto-VF-gvar-private-points-subset.ttf -u 002E,002D,0048,007A,003A,00C9
                // [2=0+620|1=1+863|5=2+1248|6=3+938|3=4+597|11=5+1000]
                { variation: { wght: 900, wdth: 75 }, advances: [620, 863, 1248, 938, 597, 1000] }
            ];
            let fonts;

            before(function() {
                fonts = references.map(reference => loadFont(hvarFixture, reference.variation));
            });

            it('has the advance widths of HarfBuzz at the six locations of the outlines above', function() {
                for (let i = 0; i < references.length; i++) {
                    assertShape(
                        shapeText(fonts[i], text),
                        { glyphs: [2, 1, 5, 6, 3, 11], clusters: [0, 1, 2, 3, 4, 5], ends: [1, 2, 3, 4, 5, 6], advances: references[i].advances },
                        JSON.stringify(references[i].variation)
                    );
                }
            });
        });

        describe('at wght 250, wdth 75, the inverse arrangement: all the points shared, a tuple of private points', function() {
            let font;

            beforeEach(function() {
                font = loadFont(hvarFixture, { wght: 250, wdth: 75 });
            });

            it('varies the points of .notdef with its tuple of 10 private points, and moves the second period of the colon with its tuple of private points [1, 3]', function() {
                // instance at wght=250,wdth=75, glyph .notdef, DecomposingRecordingPointPen
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.notdef), [
                    ['on', 674, 1456], ['on', 674, 1402], ['on', 127, 1402], ['on', 127, 1456], ['end'],
                    ['on', 149, 1456], ['on', 149, 0], ['on', 104, 0], ['on', 104, 1456], ['end'],
                    ['on', 701, 1456], ['on', 701, 0], ['on', 654, 0], ['on', 654, 1456], ['end'],
                    ['on', 674, 54], ['on', 674, 0], ['on', 127, 0], ['on', 127, 54], ['end'],
                    ['on', 674, 1426], ['on', 175, 30], ['on', 126, 30], ['on', 625, 1426], ['end'],
                    ['on', 625, 30], ['on', 126, 1426], ['on', 175, 1426], ['on', 674, 30], ['end']
                ], 0, '.notdef');
                // instance at wght=250,wdth=75, glyph colon, DecomposingRecordingPointPen. Within 1 unit:
                // the fork rounds the points of the periods after each tuple, see the known failure of
                // the period at wght 700, wdth 85
                assertOutlineClose(getGlyphPoints(font, glyphIndexes.colon), [
                    ['on', 130, 66], ['off', 130, 97], ['off', 170, 142],
                    ['on', 205, 142], ['off', 240, 142], ['off', 283, 98],
                    ['on', 283, 66], ['off', 283, 35], ['off', 240, -8],
                    ['on', 205, -8], ['off', 170, -8], ['off', 130, 35], ['end'],
                    ['on', 133, 998], ['off', 133, 1029], ['off', 173, 1074],
                    ['on', 208, 1074], ['off', 243, 1074], ['off', 286, 1030],
                    ['on', 286, 998], ['off', 286, 967], ['off', 243, 924],
                    ['on', 208, 924], ['off', 173, 924], ['off', 133, 967], ['end']
                ], 1, 'colon');
            });
        });
    });

    describe('Roboto variable without HVAR: metrics from the gvar phantom points', function() {
        describe('at wght 900, the all-points tuple of the period alone at its peak', function() {
            let font;

            beforeEach(function() {
                font = loadFont(noHvarFixture, { wght: 900 });
            });

            it('takes the advance widths of the hyphen, H and z from the phantom points of their shared point tuples', function() {
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 002D,0048,007A
                // [1=0+921|5=1+1439|6=2+1055]
                assertShape(shapeText(font, '-Hz'), { glyphs: [1, 5, 6], clusters: [0, 1, 2], ends: [1, 2, 3], advances: [921, 1439, 1055] });
            });

            it('takes the advance widths of the composites from their phantom points, once their outline is loaded', function() {
                // before its outline is loaded the advance width of a composite is the default one,
                // see the known failure of the colon below
                getOutline(font, glyphIndexes.colon);
                getOutline(font, glyphIndexes.Eacute);
                // colon, U+00C9 LATIN CAPITAL LETTER E WITH ACUTE
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 003A,00C9
                // [3=0+615|11=1+1146]
                assertShape(shapeText(font, ':\u{C9}'), { glyphs: [3, 11], clusters: [0, 1], ends: [1, 2], advances: [615, 1146] });
            });

            it('takes the left side bearings from the varied points, the values that stay at their default with HVAR', function() {
                // the x bearings, equal to the left side bearings of the hmtx of the instance at wght=900
                // hb-shape --no-glyph-names --cluster-level=1 --show-extents --variations=wght=900 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 002E,002D,0048,007A,003A,00C9
                // [2=0+620<117,327,372,-338>|1=1+921<152,758,601,-261>|5=2+1439<111,1456,1217,-1456>|6=3+1055<67,1082,918,-1082>|3=4+615<118,1125,372,-1136>|11=5+1146<111,1846,1005,-1846>]
                assert.deepStrictEqual(getLeftSideBearings(font), [117, 152, 111, 67, 118, 111]);
            });

            itFailsUntilFixed(
                'takes the advance width of the period from the phantom points of its all-points tuple',
                `${allPointsPhantomDeltasReason}: 655 instead of 620`,
                function() {
                    const advances = shapeText(font, '.').advances;
                    // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 002E
                    // [2=0+620]
                    assert.deepStrictEqual(advances, [620]);
                }
            );
        });

        describe('at wdth 75, the all-points tuples of the hyphen and z alone at their peak', function() {
            let font;

            beforeEach(function() {
                font = loadFont(noHvarFixture, { wdth: 75 });
            });

            itFailsUntilFixed(
                'takes the advance widths of the hyphen and z from the phantom points of their all-points tuple',
                `${allPointsPhantomDeltasReason}: 576, 902 instead of 508, 899`,
                function() {
                    const advances = shapeText(font, '-z').advances;
                    // hb-shape --no-glyph-names --cluster-level=1 --variations=wdth=75 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 002D,007A
                    // [1=0+508|6=1+899]
                    assert.deepStrictEqual(advances, [508, 899]);
                }
            );
        });

        describe('at wght 700, wdth 85, the all-points tuple of H is active', function() {
            let font;

            beforeEach(function() {
                font = loadFont(noHvarFixture, { wght: 700, wdth: 85 });
            });

            itFailsUntilFixed(
                'takes the advance width of H from the phantom points of its all-points tuple of an intermediate region',
                `${allPointsPhantomDeltasReason}: 1331 instead of 1333`,
                function() {
                    const advances = shapeText(font, 'H').advances;
                    // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=700,wdth=85 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 0048
                    // [5=0+1333]
                    assert.deepStrictEqual(advances, [1333]);
                }
            );
        });

        describe('at wght 900, wdth 75', function() {
            let font;

            beforeEach(function() {
                font = loadFont(noHvarFixture, { wght: 900, wdth: 75 });
            });

            it('takes the left side bearings from the varied points, with all-points tuples active and in the composites', function() {
                // the x bearings, equal to the left side bearings of the hmtx of the instance at wght=900,wdth=75
                // hb-shape --no-glyph-names --cluster-level=1 --show-extents --variations=wght=900,wdth=75 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 002E,002D,0048,007A,003A,00C9
                // [2=0+620<117,327,372,-338>|1=1+863<162,758,526,-261>|5=2+1248<99,1456,1051,-1456>|6=3+938<73,1082,783,-1082>|3=4+597<121,1125,374,-1136>|11=5+1000<99,1846,866,-1846>]
                assert.deepStrictEqual(getLeftSideBearings(font), [117, 162, 99, 73, 121, 99]);
            });

            itFailsUntilFixed(
                'takes the advance widths of the period, the hyphen and z from the phantom points of their all-points tuple',
                `${allPointsPhantomDeltasReason}: 655, 931, 941 instead of 620, 863, 938`,
                function() {
                    const advances = shapeText(font, '.-z').advances;
                    // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900,wdth=75 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 002E,002D,007A
                    // [2=0+620|1=1+863|6=2+938]
                    assert.deepStrictEqual(advances, [620, 863, 938]);
                }
            );

            itFailsUntilFixed(
                'takes the advance width of the colon from its phantom points at the first call, before its outline is loaded',
                'getPhantomPointDeltas (src/variationprocessor.mjs): reads glyph.isComposite before the lazy outline of the glyph is parsed, so the first call counts its points instead of its components and returns the default advance width (496)',
                function() {
                    const advanceWidth = font.glyphs.get(glyphIndexes.colon).getAdvanceWidth(font);
                    // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900,wdth=75 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 003A
                    // [3=0+597]
                    assert.strictEqual(advanceWidth, 597);
                }
            );

            itFailsUntilFixed(
                'takes the advance width of Eacute from the phantom points of its all-points wdth min tuple, once its outline is loaded',
                `${allPointsPhantomDeltasReason}, also in a composite: 1067 instead of 1000`,
                function() {
                    // the outline is loaded first, so that the bug of the first call (the test above) does not hide this one
                    getOutline(font, glyphIndexes.Eacute);
                    const advanceWidth = font.glyphs.get(glyphIndexes.Eacute).getAdvanceWidth(font);
                    // U+00C9 LATIN CAPITAL LETTER E WITH ACUTE
                    // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900,wdth=75 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 00C9
                    // [11=0+1000]
                    assert.strictEqual(advanceWidth, 1000);
                }
            );
        });

        describe('at wght 250, wdth 75, the inverse arrangement in .notdef', function() {
            let font;

            beforeEach(function() {
                font = loadFont(noHvarFixture, { wght: 250, wdth: 75 });
            });

            it('takes the advance width of .notdef from the right phantom point of its tuple of 10 private points', function() {
                // U+0041 LATIN CAPITAL LETTER A, not in the font: .notdef
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=250,wdth=75 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 0041
                // [0=0+804]
                assertShape(shapeText(font, 'A'), { glyphs: [0], clusters: [0], ends: [1], advances: [804] });
            });
        });

        describe('at wght 100, wdth 75, the inverse arrangement in the colon', function() {
            let font;

            beforeEach(function() {
                font = loadFont(noHvarFixture, { wght: 100, wdth: 75 });
            });

            it('takes the advance width of the colon from the right phantom point of its tuple of private points [1, 3], once its outline is loaded', function() {
                // before its outline is loaded the advance width of a composite is the default one,
                // see the known failure of the colon above
                getOutline(font, glyphIndexes.colon);
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100,wdth=75 Roboto-VF-gvar-private-points-noHVAR-subset.ttf -u 003A
                // [3=0+355]
                assertShape(shapeText(font, ':'), { glyphs: [3], clusters: [0], ends: [1], advances: [355] });
            });
        });
    });
});
