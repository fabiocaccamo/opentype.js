/**
 * Regression: gvar deltas of the component offsets of composite glyphs.
 *
 * Upstream: issue #783 (open). With font.variation.set({ wght: 200, wdth: 75 }) the diacritics
 * of the composite glyphs keep the offsets of the default instance (reported with Roboto Flex,
 * Open Sans and Noto Sans variable), while font.variation.set({ wght: 400, wdth: 400 }), "the
 * default axes" of the report, draws them right.
 *
 * Fixture: NotoSans-VF-composite-diacritics-subset.ttf (how it was built is in
 * test/fonts/regression/README.md), a subset of the variable Noto Sans: wght 100 to 900
 * (default 400), wdth 62.5 to 100 (default 100), avar, HVAR, unitsPerEm 1000, no language
 * system. Characters U+00C1, U+00E4, U+00E7, U+00F6, U+0160 and the small caps of their layout
 * closure (26 glyphs), with aalt, c2sc, smcp and a class kerning between the small caps (GPOS
 * PairPos format 2 in an extension lookup, its values vary with the GDEF variation store).
 * The left side bearing of a composite with a scaled component is asserted on Changa variable
 * (test/fonts/Changa-VariableFont_wght.ttf), in the last describe.
 *
 * Mechanism: each glyf composite is a base (offset 0, 0, USE_MY_METRICS) and a mark. Its gvar
 * data has one "point" per component, the delta of the offset of the component, and the 4
 * phantom points. adieresis, ccedilla and odieresis have tuples with all the points, Aacute and
 * Scaron tuples with point numbers (2 of 6 points), scaron.sc both kinds. With both axes away
 * from their default 3 tuples are active together (wght, wdth, and the corner of the two), 4
 * for the glyphs below when the normalized wght is between 0.61 and 1.
 * S, caron, Scaron, a.sc, o.sc, odieresis.sc, uni0308.sc and acutecomb.sc have two intermediate
 * wght tuples, (0, 0.61, 1) and (0.61, 1, 1), in place of the tuple (0, 1, 1) of the other
 * glyphs (their corner tuple keeps (0, 1, 1) on wght). The advances come from HVAR, which has
 * the same two intermediate regions.
 *
 * On upstream master (5d65b6d) the tests of the offsets fail at every location but the default
 * one, the tests of the outlines fail (points up to 154 units away, and Glyph.getPath closes no
 * contour there), and forEachGlyph gives the advances of the default location at every
 * location. The tests that shape a text cannot run there: stringToGlyphClusters is an API of
 * the fork.
 */

import assert from 'assert';
import {
    loadFont,
    shapeText,
    assertShape,
    getPathOutline,
    getOutline,
    assertOutlineClose,
    itFailsUntilFixed
} from './helpers.mjs';

const fixture = 'NotoSans-VF-composite-diacritics-subset.ttf';

// U+00C1 A with acute, U+00E4 a with diaeresis, U+00E7 c with cedilla, U+00F6 o with diaeresis,
// U+0160 S with caron
const text = '\u{C1}\u{E4}\u{E7}\u{F6}\u{160}';

// glyph index of each composite and of its components, the base and the mark
// (fontTools: font.getGlyphOrder() and the components of the glyf table)
const composites = {
    Aacute: { index: 9, components: [1, 7] },
    adieresis: { index: 10, components: [3, 6] },
    ccedilla: { index: 11, components: [4, 8] },
    odieresis: { index: 12, components: [5, 6] },
    Scaron: { index: 13, components: [2, 14] },
    'aacute.sc': { index: 16, components: [15, 25] },
    'adieresis.sc': { index: 17, components: [15, 24] },
    'ccedilla.sc': { index: 19, components: [18, 8] },
    'odieresis.sc': { index: 21, components: [20, 24] },
    'scaron.sc': { index: 23, components: [22, 14] }
};

const capitalAndLowercaseNames = ['Aacute', 'adieresis', 'ccedilla', 'odieresis', 'Scaron'];

// The locations of the tests with their reference values.
// offsets: fontTools.varLib.instancer.instantiateVariableFont(font, {'wght': ..., 'wdth': ...})
// at the wght and wdth of the location (instance saved and loaded again), x and y of
// glyf[glyphName].components. The default location is the glyf table of the fixture.
// advances and smallCapsAdvances: the hb-shape command above each of them.
const locations = [
    {
        // no variation is set
        name: 'the default location',
        offsets: {
            Aacute: [[0, 0], [225, 178]],
            adieresis: [[0, 0], [-8, 0]],
            ccedilla: [[0, 0], [170, 0]],
            odieresis: [[0, 0], [14, 0]],
            Scaron: [[0, 0], [76, 178]],
            'aacute.sc': [[0, 0], [-1, 0]],
            'adieresis.sc': [[0, 0], [-29, 0]],
            'ccedilla.sc': [[0, 0], [198, 0]],
            'odieresis.sc': [[0, 0], [21, 0]],
            'scaron.sc': [[0, 0], [30, 36]]
        },
        // hb-shape --no-glyph-names --cluster-level=1 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [9=0+639|10=1+561|11=2+480|12=3+605|13=4+549]
        advances: [639, 561, 480, 605, 549],
        // hb-shape --no-glyph-names --cluster-level=1 --features=smcp,c2sc NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [16=0+528|17=1+518|19=2+504|21=3+632|23=4+453]
        smallCapsAdvances: [528, 518, 504, 632, 453]
    },
    {
        name: 'wght 200, wdth 75, the location of the issue',
        variation: { wght: 200, wdth: 75 },
        offsets: {
            Aacute: [[0, 0], [142, 185]],
            adieresis: [[0, 0], [-59, 0]],
            ccedilla: [[0, 0], [126, 0]],
            odieresis: [[0, 0], [-38, 0]],
            Scaron: [[0, 0], [67, 185]],
            'aacute.sc': [[0, 0], [-16, 0]],
            'adieresis.sc': [[0, 0], [-29, 0]],
            'ccedilla.sc': [[0, 0], [133, 0]],
            'odieresis.sc': [[0, 0], [16, 0]],
            'scaron.sc': [[0, 0], [16, 33]]
        },
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=200,wdth=75 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [9=0+451|10=1+420|11=2+366|12=3+462|13=4+439]
        advances: [451, 420, 366, 462, 439],
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=200,wdth=75 --features=smcp,c2sc NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [16=0+378|17=1+371|19=2+373|21=3+468|23=4+333]
        smallCapsAdvances: [378, 371, 373, 468, 333]
    },
    {
        name: 'the corner wght 900, wdth 62.5 (3 tuples with a scalar of 1)',
        variation: { wght: 900, wdth: 62.5 },
        offsets: {
            Aacute: [[0, 0], [148, 161]],
            adieresis: [[0, 0], [27, 0]],
            ccedilla: [[0, 0], [182, 0]],
            odieresis: [[0, 0], [28, 0]],
            Scaron: [[0, 0], [33, 161]],
            'aacute.sc': [[0, 0], [11, 0]],
            'adieresis.sc': [[0, 0], [20, 0]],
            'ccedilla.sc': [[0, 0], [189, 0]],
            'odieresis.sc': [[0, 0], [30, 0]],
            'scaron.sc': [[0, 0], [0, 36]]
        },
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900,wdth=62.5 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [9=0+574|10=1+494|11=2+433|12=3+516|13=4+454]
        advances: [574, 494, 433, 516, 454],
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900,wdth=62.5 --features=smcp,c2sc NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [16=0+525|17=1+519|19=2+430|21=3+537|23=4+412]
        smallCapsAdvances: [525, 519, 430, 537, 412]
    },
    {
        // normalized wght 0.495: the tuple (0, 0.61, 1) before its peak, the tuple (0.61, 1, 1) off
        name: 'wght 650, wdth 80 (rising side of the first intermediate wght tuple)',
        variation: { wght: 650, wdth: 80 },
        offsets: {
            Aacute: [[0, 0], [175, 169]],
            adieresis: [[0, 0], [-7, 0]],
            ccedilla: [[0, 0], [158, 0]],
            odieresis: [[0, 0], [1, 0]],
            Scaron: [[0, 0], [38, 170]],
            'aacute.sc': [[0, 0], [6, 0]],
            'adieresis.sc': [[0, 0], [-1, 0]],
            'ccedilla.sc': [[0, 0], [170, 0]],
            'odieresis.sc': [[0, 0], [27, 0]],
            'scaron.sc': [[0, 0], [6, 36]]
        },
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=650,wdth=80 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [9=0+585|10=1+514|11=2+441|12=3+541|13=4+477]
        advances: [585, 514, 441, 541, 477],
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=650,wdth=80 --features=smcp,c2sc NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [16=0+512|17=1+504|19=2+450|21=3+573|23=4+415]
        smallCapsAdvances: [512, 504, 450, 573, 415]
    },
    {
        // normalized wght 0.79: the tuple (0, 0.61, 1) after its peak and the tuple (0.61, 1, 1)
        // after its start, the wdth tuples off
        name: 'wght 800, wdth 100, the ExtraBold instance (between the peaks of the intermediate wght tuples)',
        variation: { wght: 800, wdth: 100 },
        offsets: {
            Aacute: [[0, 0], [224, 165]],
            adieresis: [[0, 0], [0, 0]],
            ccedilla: [[0, 0], [167, 0]],
            odieresis: [[0, 0], [10, 0]],
            Scaron: [[0, 0], [33, 165]],
            'aacute.sc': [[0, 0], [19, 0]],
            'adieresis.sc': [[0, 0], [4, 0]],
            'ccedilla.sc': [[0, 0], [187, 0]],
            'odieresis.sc': [[0, 0], [32, 0]],
            'scaron.sc': [[0, 0], [6, 38]]
        },
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=800,wdth=100 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [9=0+708|10=1+610|11=2+527|12=3+630|13=4+563]
        advances: [708, 610, 527, 630, 563],
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=800,wdth=100 --features=smcp,c2sc NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [16=0+611|17=1+601|19=2+532|21=3+673|23=4+482]
        smallCapsAdvances: [611, 601, 532, 673, 482]
    },
    {
        // normalized wght 0.895 and wdth -0.70001: for Scaron and odieresis.sc the two intermediate
        // wght tuples (scalars 0.27 and 0.73), the wdth tuple (0.70) and the corner (0.63)
        name: 'wght 850, wdth 75 (4 tuples: the two intermediate wght tuples, wdth and the corner)',
        variation: { wght: 850, wdth: 75 },
        offsets: {
            Aacute: [[0, 0], [169, 163]],
            adieresis: [[0, 0], [14, 0]],
            ccedilla: [[0, 0], [173, 0]],
            odieresis: [[0, 0], [17, 0]],
            Scaron: [[0, 0], [32, 163]],
            'aacute.sc': [[0, 0], [13, 0]],
            'adieresis.sc': [[0, 0], [14, 0]],
            'ccedilla.sc': [[0, 0], [183, 0]],
            'odieresis.sc': [[0, 0], [31, 0]],
            'scaron.sc': [[0, 0], [1, 36]]
        },
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=850,wdth=75 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [9=0+608|10=1+525|11=2+457|12=3+546|13=4+483]
        advances: [608, 525, 457, 546, 483],
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=850,wdth=75 --features=smcp,c2sc NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [16=0+545|17=1+538|19=2+457|21=3+574|23=4+428]
        smallCapsAdvances: [545, 538, 457, 574, 428]
    },
    {
        name: 'wght 400, wdth 62.5 (the wdth tuple alone)',
        variation: { wght: 400, wdth: 62.5 },
        offsets: {
            Aacute: [[0, 0], [128, 177]],
            adieresis: [[0, 0], [-48, 0]],
            ccedilla: [[0, 0], [120, 0]],
            odieresis: [[0, 0], [-40, 0]],
            Scaron: [[0, 0], [45, 177]],
            'aacute.sc': [[0, 0], [-8, 0]],
            'adieresis.sc': [[0, 0], [-11, 0]],
            'ccedilla.sc': [[0, 0], [121, 0]],
            'odieresis.sc': [[0, 0], [19, 0]],
            'scaron.sc': [[0, 0], [-1, 34]]
        },
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=400,wdth=62.5 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [9=0+450|10=1+416|11=2+347|12=3+445|13=4+413]
        advances: [450, 416, 347, 445, 413],
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=400,wdth=62.5 --features=smcp,c2sc NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [16=0+395|17=1+389|19=2+361|21=3+453|23=4+332]
        smallCapsAdvances: [395, 389, 361, 453, 332]
    }
];

// a new font per location
function loadFontsOfLocations() {
    return new Map(locations.map(location => [location, loadFont(fixture, location.variation)]));
}

function moveOutline(outline, offsetX, offsetY) {
    return outline.map(([type, ...coordinates]) => {
        return [type, ...coordinates.map((coordinate, index) => coordinate + (index % 2 === 0 ? offsetX : offsetY))];
    });
}

// The offsets [dx, dy] of the components of a composite at the current variation, measured on
// the outlines: the outline of a composite is the outlines of its components one after the
// other, each of them moved by its offset. They cannot be read from glyph.components, which
// keeps the dx and dy of the default instance.
function getComponentOffsets(font, glyphName) {
    const { index, components } = composites[glyphName];
    const outline = getOutline(font, index);
    let commandIndex = 0;
    const offsets = components.map((componentIndex) => {
        const componentOutline = getOutline(font, componentIndex);
        const offsetX = outline[commandIndex][1] - componentOutline[0][1];
        const offsetY = outline[commandIndex][2] - componentOutline[0][2];
        assert.deepStrictEqual(
            outline.slice(commandIndex, commandIndex + componentOutline.length),
            moveOutline(componentOutline, offsetX, offsetY),
            `${glyphName}: the component ${componentIndex} is not the outline of its glyph moved by one offset`
        );
        commandIndex += componentOutline.length;
        return [offsetX, offsetY];
    });
    assert.strictEqual(commandIndex, outline.length, `${glyphName}: commands of the components`);
    return offsets;
}

function getOffsetsOfComposites(font, glyphNames) {
    return Object.fromEntries(glyphNames.map(glyphName => [glyphName, getComponentOffsets(font, glyphName)]));
}

function assertOutlinesOfComposites(font, expectedOutlines, tolerance) {
    for (const [glyphName, expectedOutline] of Object.entries(expectedOutlines)) {
        assertOutlineClose(getOutline(font, composites[glyphName].index), expectedOutline, tolerance, glyphName);
    }
}

describe('regression: gvar deltas of the component offsets of composite glyphs (#783)', function() {
    describe('offsets of the components', function() {
        let fonts;
        let fontBeyondWidthRange;

        beforeEach(function() {
            fonts = loadFontsOfLocations();
            fontBeyondWidthRange = loadFont(fixture, { wght: 400, wdth: 400 });
        });

        for (const location of locations) {
            it(`gives the components the offsets of the instance at ${location.name}`, function() {
                const offsets = getOffsetsOfComposites(fonts.get(location), Object.keys(location.offsets));
                assert.deepStrictEqual(offsets, location.offsets);
            });
        }

        // wdth 400 is over the maximum of its axis (100, its default too): the references clamp it,
        // their instance is the default one (see the tests of the values out of the range of an axis).
        // fontTools.varLib.instancer at wght=400, wdth=400: the glyf table of the fixture
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=400,wdth=400 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
        // [9=0+639|10=1+561|11=2+480|12=3+605|13=4+549]
        it('keeps the default offsets and advances at wght 400, wdth 400, the default axes of the issue', function() {
            const defaultOffsets = Object.fromEntries(capitalAndLowercaseNames.map(glyphName => [glyphName, locations[0].offsets[glyphName]]));
            assert.deepStrictEqual(getOffsetsOfComposites(fontBeyondWidthRange, capitalAndLowercaseNames), defaultOffsets);
            assertShape(shapeText(fontBeyondWidthRange, text), {
                glyphs: [9, 10, 11, 12, 13],
                clusters: [0, 1, 2, 3, 4],
                advances: [639, 561, 480, 605, 549]
            });
        });

        describe('sum of the deltas next to a half', function() {
            let odieresisSmallCapOffsets;
            let scaronSmallCapOffsets;

            before(function() {
                odieresisSmallCapOffsets = getComponentOffsets(loadFont(fixture, { wght: 100, wdth: 75 }), 'odieresis.sc');
                scaronSmallCapOffsets = getComponentOffsets(loadFont(fixture, { wght: 300, wdth: 100 }), 'scaron.sc');
            });

            // The normalized wdth is -0.70001 for the references (wdth 75 is -0.66669 in F2Dot14,
            // a value of the avar map), -0.69999 without the F2Dot14 rounding. The deltas of the dx
            // of the mark, -3 (wght), -2 (wdth) and -3 (corner) in the gvar tuples of the glyph, add
            // up to -3 - 5 * 0.70001 = -6.50006 (21 - 6.50006 rounds to 14) and to -6.49996 (15).
            // fontTools.varLib.instancer at wght=100, wdth=75, x and y of glyf['odieresis.sc'].components
            it('moves the mark of odieresis.sc at wght 100, wdth 75', function() {
                assert.deepStrictEqual(odieresisSmallCapOffsets, [[0, 0], [14, 0]]);
            });

            // The normalized wght is -0.5 for the references (wght 300 is -0.33331 in F2Dot14, a
            // value of the avar map), -0.500018 without the F2Dot14 rounding: the delta of the mark
            // in the wght tuple, (29, -5), gives (14.5, -2.5) and the offset (44.5, 33.5), rounded
            // to (45, 34). A scalar of 0.49999999999999989 instead of 0.5 (Number.EPSILON terms)
            // gives (44, 34).
            // fontTools.varLib.instancer at wght=300, wdth=100, x and y of glyf['scaron.sc'].components
            it('moves the mark of scaron.sc at wght 300, wdth 100, the Light instance', function() {
                assert.deepStrictEqual(scaronSmallCapOffsets, [[0, 0], [45, 34]]);
            });
        });
    });

    // Reference of all the outlines of this describe: fontTools.varLib.instancer.instantiateVariableFont
    // at the wght and wdth of the constant (instance saved and loaded again), then
    // glyf[glyphName].getCoordinates(glyf): the points of the glyph with its components, their
    // on curve flags and the end points of the contours. Each contour is written with the
    // commands of getPath (src/tables/glyf.mjs): M to its last point when it is on the curve,
    // otherwise to its first point (in every contour here one of the two is on the curve); then
    // for each point, from the first one, L to a point on the curve, or Q with a point off the
    // curve as control point, to the next point when it is on the curve and to the middle of the
    // two otherwise; Z.
    describe('outlines of the composites', function() {
        // wght=900, wdth=62.5, glyphs Aacute and adieresis
        const expectedCornerOutlines = {
            Aacute: [
                ['M', 574, 0], ['L', 392, 0], ['L', 365, 139], ['L', 211, 139], ['L', 184, 0], ['L', 0, 0],
                ['L', 174, 714], ['L', 398, 714], ['L', 574, 0], ['Z'], ['M', 339, 285], ['L', 310, 445],
                ['Q', 305, 472, 301, 497], ['Q', 297, 522, 294, 545.5], ['Q', 291, 569, 288, 589], ['L', 288, 589],
                ['Q', 286, 570, 283, 547], ['Q', 280, 524, 275.5, 499], ['Q', 271, 474, 266, 447], ['L', 266, 447],
                ['L', 236, 285], ['L', 339, 285], ['Z'], ['M', 448, 927], ['L', 448, 917],
                ['Q', 438, 904, 421.5, 886], ['Q', 405, 868, 385.5, 847], ['Q', 366, 826, 346, 805.5],
                ['Q', 326, 785, 307, 767], ['L', 307, 767], ['L', 188, 767], ['L', 188, 781],
                ['Q', 204, 808, 218, 833], ['Q', 232, 858, 244, 881.5], ['Q', 256, 905, 266, 927], ['L', 266, 927],
                ['L', 448, 927], ['Z']
            ],
            adieresis: [
                ['M', 266, 563], ['L', 266, 563], ['Q', 349, 563, 397, 513.5], ['Q', 445, 464, 445, 363],
                ['L', 445, 363], ['L', 445, 0], ['L', 328, 0], ['L', 301, 73], ['L', 298, 73],
                ['Q', 280, 45, 260.5, 26.5], ['Q', 241, 8, 216, -1], ['Q', 191, -10, 156, -10], ['L', 156, -10],
                ['Q', 109, -10, 80, 16], ['Q', 51, 42, 38, 83], ['Q', 25, 124, 25, 169], ['L', 25, 169],
                ['Q', 25, 258, 72.5, 301.5], ['Q', 120, 345, 211, 349], ['L', 211, 349], ['L', 283, 352],
                ['L', 283, 366], ['Q', 283, 400, 270, 417], ['Q', 257, 434, 230, 434], ['L', 230, 434],
                ['Q', 206, 434, 177, 424], ['Q', 148, 414, 111, 393], ['L', 111, 393], ['L', 69, 513],
                ['Q', 110, 537, 159.5, 550], ['Q', 209, 563, 266, 563], ['Z'], ['M', 283, 247], ['L', 253, 245],
                ['Q', 220, 244, 203.5, 226.5], ['Q', 187, 209, 187, 176], ['L', 187, 176],
                ['Q', 187, 148, 197, 133.5], ['Q', 207, 119, 226, 119], ['L', 226, 119], ['Q', 250, 119, 266.5, 141],
                ['Q', 283, 163, 283, 198], ['L', 283, 198], ['L', 283, 247], ['Z'], ['M', 88, 690], ['L', 88, 690],
                ['Q', 88, 727, 107.5, 747], ['Q', 127, 767, 159, 767], ['L', 159, 767], ['Q', 193, 767, 212.5, 746],
                ['Q', 232, 725, 232, 690], ['L', 232, 690], ['Q', 232, 656, 212.5, 635], ['Q', 193, 614, 159, 614],
                ['L', 159, 614], ['Q', 127, 614, 107.5, 634], ['Q', 88, 654, 88, 690], ['Z'], ['M', 281, 690],
                ['L', 281, 690], ['Q', 281, 727, 300.5, 747], ['Q', 320, 767, 353, 767], ['L', 353, 767],
                ['Q', 388, 767, 407, 746], ['Q', 426, 725, 426, 690], ['L', 426, 690], ['Q', 426, 656, 407, 635],
                ['Q', 388, 614, 353, 614], ['L', 353, 614], ['Q', 319, 614, 300, 634.5], ['Q', 281, 655, 281, 690],
                ['Z']
            ]
        };

        // wght=200, wdth=75, glyphs Aacute and adieresis
        const expectedIssueLocationOutlines = {
            Aacute: [
                ['M', 451, 0], ['L', 412, 0], ['L', 337, 267], ['L', 116, 267], ['L', 40, 0], ['L', 0, 0],
                ['L', 204, 715], ['L', 250, 715], ['L', 451, 0], ['Z'], ['M', 327, 303], ['L', 249, 591],
                ['Q', 245, 607, 241.5, 621], ['Q', 238, 635, 234, 649.5], ['Q', 230, 664, 227, 679], ['L', 227, 679],
                ['Q', 223, 665, 219.5, 650.5], ['Q', 216, 636, 212, 621.5], ['Q', 208, 607, 204, 591],
                ['L', 204, 591], ['L', 125, 303], ['L', 327, 303], ['Z'], ['M', 340, 949], ['L', 340, 942],
                ['Q', 328, 925, 311.5, 904.5], ['Q', 295, 884, 276.5, 863.5], ['Q', 258, 843, 240, 824.5],
                ['Q', 222, 806, 206, 791], ['L', 206, 791], ['L', 182, 791], ['L', 182, 801],
                ['Q', 204, 826, 224, 851], ['Q', 244, 876, 262.5, 900.5], ['Q', 281, 925, 296, 949], ['L', 296, 949],
                ['L', 340, 949], ['Z']
            ],
            adieresis: [
                ['M', 210, 539], ['L', 210, 539], ['Q', 281, 539, 314, 496.5], ['Q', 347, 454, 347, 357],
                ['L', 347, 357], ['L', 347, 0], ['L', 318, 0], ['L', 313, 92], ['L', 311, 92],
                ['Q', 301, 65, 284.5, 42], ['Q', 268, 19, 240.5, 4.5], ['Q', 213, -10, 172, -10], ['L', 172, -10],
                ['Q', 127, -10, 98, 9.5], ['Q', 69, 29, 54.5, 61.5], ['Q', 40, 94, 40, 133], ['L', 40, 133],
                ['Q', 40, 212, 91.5, 252.5], ['Q', 143, 293, 237, 301], ['L', 237, 301], ['L', 310, 307],
                ['L', 310, 353], ['Q', 310, 437, 285.5, 471], ['Q', 261, 505, 208, 505], ['L', 208, 505],
                ['Q', 182, 505, 154, 497.5], ['Q', 126, 490, 94, 472], ['L', 94, 472], ['L', 80, 503],
                ['Q', 110, 520, 143.5, 529.5], ['Q', 177, 539, 210, 539], ['Z'], ['M', 311, 276], ['L', 240, 271],
                ['Q', 160, 264, 119.5, 231], ['Q', 79, 198, 79, 133], ['L', 79, 133], ['Q', 79, 80, 105, 51],
                ['Q', 131, 22, 177, 22], ['L', 177, 22], ['Q', 247, 22, 278.5, 76], ['Q', 310, 130, 311, 218],
                ['L', 311, 218], ['L', 311, 276], ['Z'], ['M', 104, 668], ['L', 104, 668],
                ['Q', 104, 684, 111.5, 694], ['Q', 119, 704, 132, 704], ['L', 132, 704], ['Q', 146, 704, 153.5, 694],
                ['Q', 161, 684, 161, 668], ['L', 161, 668], ['Q', 161, 652, 153.5, 642.5], ['Q', 146, 633, 132, 633],
                ['L', 132, 633], ['Q', 119, 633, 111.5, 643], ['Q', 104, 653, 104, 668], ['Z'], ['M', 261, 669],
                ['L', 261, 669], ['Q', 261, 685, 269, 694.5], ['Q', 277, 704, 290, 704], ['L', 290, 704],
                ['Q', 304, 704, 311.5, 694.5], ['Q', 319, 685, 319, 669], ['L', 319, 669],
                ['Q', 319, 653, 311.5, 643], ['Q', 304, 633, 289, 633], ['L', 289, 633], ['Q', 277, 633, 269, 643],
                ['Q', 261, 653, 261, 669], ['Z']
            ]
        };

        // wght=650, wdth=80, glyph Scaron
        const expectedIntermediateOutlines = {
            Scaron: [
                ['M', 441, 198], ['L', 441, 198], ['Q', 441, 134, 412.5, 87], ['Q', 384, 40, 333.5, 15],
                ['Q', 283, -10, 214, -10], ['L', 214, -10], ['Q', 185, -10, 154.5, -5.5], ['Q', 124, -1, 94.5, 8],
                ['Q', 65, 17, 39, 30], ['L', 39, 30], ['L', 39, 161], ['Q', 82, 140, 128, 123],
                ['Q', 174, 106, 219, 106], ['L', 219, 106], ['Q', 251, 106, 271, 117.5], ['Q', 291, 129, 301, 148],
                ['Q', 311, 167, 311, 191], ['L', 311, 191], ['Q', 311, 219, 296.5, 239], ['Q', 282, 259, 256, 276.5],
                ['Q', 230, 294, 195, 314], ['L', 195, 314], ['Q', 172, 328, 146.5, 344.5], ['Q', 121, 361, 98, 385],
                ['Q', 75, 409, 60, 442.5], ['Q', 45, 476, 45, 523], ['L', 45, 523], ['Q', 45, 584, 70.5, 629],
                ['Q', 96, 674, 143.5, 699], ['Q', 191, 724, 257, 724], ['L', 257, 724], ['Q', 302, 724, 345.5, 712.5],
                ['Q', 389, 701, 438, 677], ['L', 438, 677], ['L', 397, 567], ['Q', 355, 587, 323, 597],
                ['Q', 291, 607, 257, 607], ['L', 257, 607], ['Q', 232, 607, 214, 597], ['Q', 196, 587, 186, 569.5],
                ['Q', 176, 552, 176, 529], ['L', 176, 529], ['Q', 176, 501, 187.5, 482], ['Q', 199, 463, 224, 446.5],
                ['Q', 249, 430, 288, 408], ['L', 288, 408], ['Q', 338, 381, 371.5, 352], ['Q', 405, 323, 423, 286],
                ['Q', 441, 249, 441, 198], ['Z'], ['M', 327, 776], ['L', 185, 776], ['Q', 174, 797, 155, 824],
                ['Q', 136, 851, 115.5, 878], ['Q', 95, 905, 78, 924], ['L', 78, 924], ['L', 78, 936], ['L', 158, 936],
                ['Q', 179, 921, 206, 898], ['Q', 233, 875, 256, 848], ['L', 256, 848], ['Q', 280, 877, 306, 897.5],
                ['Q', 332, 918, 354, 936], ['L', 354, 936], ['L', 435, 936], ['L', 435, 924],
                ['Q', 418, 905, 397.5, 878.5], ['Q', 377, 852, 358, 825], ['Q', 339, 798, 327, 776], ['L', 327, 776],
                ['Z']
            ]
        };

        let cornerFont;
        let issueLocationFont;
        let intermediateFont;

        beforeEach(function() {
            cornerFont = loadFont(fixture, { wght: 900, wdth: 62.5 });
            issueLocationFont = loadFont(fixture, { wght: 200, wdth: 75 });
            intermediateFont = loadFont(fixture, { wght: 650, wdth: 80 });
        });

        it('draws Aacute and adieresis like the instance at the corner wght 900, wdth 62.5', function() {
            assertOutlinesOfComposites(cornerFont, expectedCornerOutlines, 0);
        });

        // The line of the two glyphs, adieresis moved by the advance of Aacute:
        // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900,wdth=62.5 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4
        // [9=0+574|10=1+494]
        it('draws a text with font.getPath like the instance at the corner wght 900, wdth 62.5', function() {
            // U+00C1 A with acute, U+00E4 a with diaeresis
            const path = cornerFont.getPath('\u{C1}\u{E4}', 0, 0, cornerFont.unitsPerEm);
            const expectedOutline = [
                ...expectedCornerOutlines.Aacute,
                ...moveOutline(expectedCornerOutlines.adieresis, 574, 0)
            ];
            assertOutlineClose(getPathOutline(path), expectedOutline, 0, 'line');
        });

        // The points of the simple glyphs need their deltas rounded once after all the active
        // tuples and, at this location, the normalized coordinates rounded to F2Dot14: with either
        // one missing, values are 1 unit away. The outlines of upstream master are 85 and 52 units away.
        it('draws Aacute and adieresis like the instance at wght 200, wdth 75, with the helper of the composites', function() {
            assertOutlinesOfComposites(issueLocationFont, expectedIssueLocationOutlines, 0);
        });

        // The deltas rounded after each tuple give values 1 unit away. The outline of upstream
        // master is 49 units away.
        it('draws Scaron like the instance at wght 650, wdth 80, with the helper of the composites', function() {
            assertOutlinesOfComposites(intermediateFont, expectedIntermediateOutlines, 0);
        });

        for (const glyphName of Object.keys(expectedIssueLocationOutlines)) {
            it(`draws ${glyphName} like the instance at wght 200, wdth 75`, function() {
                const outline = getOutline(issueLocationFont, composites[glyphName].index);
                assertOutlineClose(outline, expectedIssueLocationOutlines[glyphName], 0, glyphName);
            });
        }

        it('draws Scaron like the instance at wght 650, wdth 80', function() {
            const outline = getOutline(intermediateFont, composites.Scaron.index);
            assertOutlineClose(outline, expectedIntermediateOutlines.Scaron, 0, 'Scaron');
        });
    });

    // The text layout of upstream master (forEachGlyph) gives the advances of the default
    // location at every location.
    describe('advances of the composites (HVAR)', function() {
        let fonts;

        beforeEach(function() {
            fonts = loadFontsOfLocations();
        });

        it('gives the glyph ids, the clusters and the advances of HarfBuzz at every location', function() {
            for (const location of locations) {
                assertShape(shapeText(fonts.get(location), text), {
                    glyphs: [9, 10, 11, 12, 13],
                    clusters: [0, 1, 2, 3, 4],
                    advances: location.advances
                }, location.name);
            }
        });

        // c2sc and smcp give the small caps composites, with the class kerning of adieresis.sc
        // before ccedilla.sc and of ccedilla.sc before odieresis.sc: -10 units at the default
        // location, a value that varies (-7 at wght 200, wdth 75, -6 at the corner).
        it('gives the small caps and their advances, variable kerning included, at every location', function() {
            for (const location of locations) {
                assertShape(shapeText(fonts.get(location), text, { features: { smcp: true, c2sc: true } }), {
                    glyphs: [16, 17, 19, 21, 23],
                    clusters: [0, 1, 2, 3, 4],
                    advances: location.smallCapsAdvances
                }, location.name);
            }
        });

        describe('delta next to a half', function() {
            let shaped;

            before(function() {
                shaped = shapeText(loadFont(fixture, { wght: 400, wdth: 75 }), text);
            });

            // The HVAR delta of adieresis in the wdth region is -145: -101.502 at the normalized
            // wdth of the reference, -0.70001 (561 - 101.502 rounds to 459), and -101.499 at
            // -0.69999, the coordinate without the F2Dot14 rounding (460).
            it('gives the advance of adieresis at wght 400, wdth 75', function() {
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=400,wdth=75 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
                // [9=0+507|10=1+459|11=2+387|12=3+493|13=4+454]
                assert.deepStrictEqual(shaped.advances, [507, 459, 387, 493, 454]);
            });
        });
    });

    // font.variation.set({ wght: 200, wdth: 75 }), the call of the issue, is out of the wght
    // range of Open Sans (300 to 800), one of the fonts of the report. HarfBuzz, fontTools and
    // the browsers clamp a value to the range of its axis.
    describe('values out of the range of an axis', function() {
        // fontTools.varLib.instancer at wght=50, wdth=80 (the same instance as at wght=100, wdth=80),
        // x and y of glyf[glyphName].components
        const expectedOffsetsBelowWeightRange = {
            Aacute: [[0, 0], [151, 187]],
            adieresis: [[0, 0], [-58, 0]],
            ccedilla: [[0, 0], [134, 0]],
            odieresis: [[0, 0], [-34, 0]],
            Scaron: [[0, 0], [77, 187]]
        };
        let advancesBeyondBothRanges;
        let advancesBelowWeightRange;
        let offsetsBelowWeightRange;

        before(function() {
            advancesBeyondBothRanges = shapeText(loadFont(fixture, { wght: 1000, wdth: 50 }), text).advances;
            const fontBelowWeightRange = loadFont(fixture, { wght: 50, wdth: 80 });
            advancesBelowWeightRange = shapeText(fontBelowWeightRange, text).advances;
            offsetsBelowWeightRange = getOffsetsOfComposites(fontBelowWeightRange, Object.keys(expectedOffsetsBelowWeightRange));
        });

        // The line of the corner wght 900, wdth 62.5. Without the clamping the tuples and the
        // regions of an axis out of its range are skipped, like at its default: the advances of
        // the default location, 639, 561, 480, 605 and 549.
        it('gives wght 1000, wdth 50 the advances of the corner wght 900, wdth 62.5', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=1000,wdth=50 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
            // [9=0+574|10=1+494|11=2+433|12=3+516|13=4+454]
            assert.deepStrictEqual(advancesBeyondBothRanges, [574, 494, 433, 516, 454]);
        });

        // Without the clamping only the axis out of its range falls back: the advances of wght 400,
        // wdth 80, 532, 479, 405, 514 and 472.
        it('gives wght 50, wdth 80 the advances of wght 100, wdth 80', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=50,wdth=80 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
            // [9=0+464|10=1+429|11=2+382|12=3+478|13=4+456]
            // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100,wdth=80 NotoSans-VF-composite-diacritics-subset.ttf -u 00C1,00E4,00E7,00F6,0160
            // [9=0+464|10=1+429|11=2+382|12=3+478|13=4+456]
            assert.deepStrictEqual(advancesBelowWeightRange, [464, 429, 382, 478, 456]);
        });

        it('moves the marks at wght 50, wdth 80 like at wght 100, wdth 80', function() {
            assert.deepStrictEqual(offsetsBelowWeightRange, expectedOffsetsBelowWeightRange);
        });
    });

    // Changa-VariableFont_wght.ttf (test/fonts/), hbar (glyph 170): a composite of h and of uni0335
    // scaled by 0.9 x 0.55, HVAR without LSB map, so the left side bearing comes from the varied outline.
    // The unrounded xMin at wght 600 is 8.97 (the x 22.556 of uni0335, scaled, plus the offset -11.333),
    // the fork has 9.70 (the rounded x 23 of uni0335, scaled, plus the rounded offset -11).
    describe('left side bearing of a composite with a scaled component (Changa)', function() {
        let changaFont;

        before(function() {
            changaFont = loadFont('../Changa-VariableFont_wght.ttf');
        });

        itFailsUntilFixed(
            'has the left side bearing 9 of hbar at wght 600, like HarfBuzz and fontTools',
            'VariationProcessor.getLeftSideBearingFromPoints (src/variationprocessor.mjs): takes the xMin of a ' +
            'composite from the points of its components already rounded and offset by rounded deltas, 9.70 ' +
            'instead of 8.97, which rounds to 10',
            function() {
                // hb-shape --no-glyph-names --show-extents --variations=wght=600 ../Changa-VariableFont_wght.ttf -u 0127
                // [170=0+585<9,665,511,-665>]
                // fontTools: instantiateVariableFont(TTFont('../Changa-VariableFont_wght.ttf'), {'wght': 600})['hmtx']['hbar']
                // (585, 9)
                assert.strictEqual(changaFont.variation.getLeftSideBearing(170, { wght: 600 }), 9);
            }
        );
    });
});
