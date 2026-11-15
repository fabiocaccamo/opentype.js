import assert from 'assert';
import { parse } from '../src/opentype.mjs';
import { readFileSync } from 'fs';
import exp from 'constants';
import { shapeText, assertShape } from './regression/helpers.mjs';
import { formatShape } from './testutil.mjs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

describe('variation.mjs', function() {
    const fonts = {
        avar: loadSync('./test/fonts/TestAVAR.ttf'),
        hvar: loadSync('./test/fonts/TestHVAROne.otf'),
        hvar2: loadSync('./test/fonts/TestHVARTwo.ttf'),
        zycon: loadSync('./test/fonts/Zycon.ttf'),
        cvar1: loadSync('./test/fonts/TestCVARGVAROne.ttf'),
        cvar2: loadSync('./test/fonts/TestCVARGVARTwo.ttf'),
        mvar: loadSync('./test/fonts/TestGVAR-Composite-0.ttf'),
        mvarWithoutCaret: loadSync('./test/fonts/TestItalicSwitch.ttf'),
    };

    it('pads axis tags with spaces for lookup', function() {
        const font = fonts.zycon;
        const untransformedPoints = [
            2026, 1022, 2026, 606, 1437, 17, 1021, 17, 605, 17, 16, 606, 16, 1022, 16, 1438, 605, 2027,
            1021, 2027, 1437, 2027, 2026, 1438, 1976, 1022, 1976, 1418, 1417, 1980, 1021, 1980, 625,
            1980, 66, 1417, 66, 1021, 66, 625, 625, 64, 1021, 64, 1417, 64, 1976, 626, 1586, 1441,
            1378, 1482, 1178, 1418, 1297, 1371, 1297, 1371, 1274, 1334, 1274, 1317, 1274, 1274, 1343,
            1214, 1386, 1214, 1434, 1214, 1494, 1279, 1494, 1326, 1494, 1351, 1474, 1393, 1474, 1393,
            881, 1416, 681, 1485, 484, 1441, 587, 1394, 587, 1394, 562, 1331, 562, 1315, 562, 1265, 635,
            1209, 681, 1209, 718, 1209, 785, 1265, 785, 1304, 785, 1317, 770, 1371, 770, 1371, 1245, 868,
            1245, 868, 1213, 941, 1186, 954, 1159, 967, 1086, 947, 1086, 947, 1027, 1380, 965, 950, 965,
            950, 881, 969, 853, 955, 825, 941, 794, 861, 794, 861, 919, 888, 919, 888, 997, 839, 1033, 839,
            1068, 839, 1142, 885, 1142, 885, 1346, 607, 1294, 577, 1100, 544, 1022, 544, 912, 544, 728, 599,
            698, 614, 727, 529, 914, 422, 1025, 422, 1133, 422, 1321, 546
        ];
        const transformedPoints = untransformedPoints.slice(0, 32)
            .concat([1005, 1980, 983, 1417, 983, 1021, 983, 625, 1005, 64])
            .concat(untransformedPoints.slice(42));
        assert.deepEqual(font.variation.getTransform(15).points.map(p => [p.x, p.y]).flat(), untransformedPoints);
        assert.deepEqual(font.variation.getTransform(15, {M1: 0.48}).points.map(p => [p.x, p.y]).flat(), transformedPoints);
        
        font.variation.set({M1: -0.42});
        assert.deepEqual(font.variation.get(), {
            'M1  ': -0.42,
            'M2  ': 0,
            'T1  ': 0,
            'T2  ': 0,
            'T3  ': 0,
            'T4  ': 0,
        });
    });

    it('keeps the outline of a CFF1 glyph of a font with an fvar table, which does not vary, without parsing it again', function() {
        // TestFvarOnly-CFF.otf (test/generate-fvar-only-fonts.py): CFF outlines, an fvar table, no CFF2, gvar nor HVAR
        // table; a CFF1 charstring has no blend operator, so getTransform gives the glyph with its parsed outline
        const font = loadSync('./test/fonts/TestFvarOnly-CFF.otf');
        const glyph = font.glyphs.get(1);
        const path = glyph.path;
        assert.strictEqual(font.variation.getTransform(glyph, { wght: 900 }), glyph);
        assert.strictEqual(glyph.path, path);
    });

    describe('avar', function() {
        // OpenType precision and rounding requirements (Coordinate scales and normalization, steps 1 to 5),
        // with the axis 100..400..900 and the avar map -1: -1, -0.5: 0, 0: 0, 0.5: 0, 1: 1. At 150 the
        // default normalization is -54613 in 16.16, avar maps it to -65536 + 65536 * 10923 / 32768 = -43690,
        // (-43690 + 2) >> 2 = -10922; at 800 it is 52429, mapped to 39322, (39322 + 2) >> 2 = 9831.
        // fontTools varLib.instancer.normalize, in floats rounded once, gives -10923 and 9830 there.
        it('applies variation limits', function() {
            const font = fonts.avar;
            const expectedFactors = [
                [ -1 ],
                [ -10922 / 16384 ],
                [ -5461 / 16384 ]
            ].concat(Array(9).fill([ 0 ]))
            .concat([
                [ 3277 / 16384 ],
                [ 6554 / 16384 ],
                [ 9831 / 16384 ],
                [ 13107 / 16384 ],
                [ 1 ]
            ]);
            assert.deepStrictEqual(
                [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900].map((v) => {
                    font.variation.set({TEST:v});
                    return font.variation.process.getNormalizedCoords();
                }),
                expectedFactors
            );
        });

        // fontTools: varLib.instancer.normalize at 0, 50, 950 and 1000: -1, -1, 1, 1
        it('clamps the values out of the range of the axis before the avar map', function() {
            const process = fonts.avar.variation.process;
            assert.deepStrictEqual([0, 50, 950, 1000].map(value => process.getNormalizedCoords({ TEST: value })), [[-1], [-1], [1], [1]]);
        });
    });
    
    describe('cvar', function() {
        it('handles cvar data correctly', function() {
            
            ['cvar1','cvar2'].forEach((f) => {
                let font = fonts[f];
                let glyphPos = [];
                assert.equal(
                    font.forEachGlyph('hon', 0, 0, font.unitsPerEm, {}, function(glyph, gX, gY, gFontSize) {
                        glyphPos.push({w: glyph.advanceWidth, lsb: glyph.leftSideBearing, gX, count: glyph.path.commands.length});
                    }),
                    1857
                );
                assert.deepEqual(glyphPos, [
                    {count: 53, w: 635, lsb: 18, gX: 0},
                    {count: 32, w: 577, lsb: 55, gX: 635},
                    {count: 49, w: 645, lsb: 28, gX: 1212},
                ]);
                glyphPos = [];
                // wght 1000 is clamped to the maximum of the axis, 194: the source glyphs keep their
                // metrics, the pen moves by the varied advances
                // hb-shape --no-glyph-names --variations=wght=1000 TestCVARGVAROne.ttf -u 0068,006F,006E
                // [2=0+691|4=1+640|3=2+683]
                font.variation.set({wght: 1000})
                assert.equal(
                    font.forEachGlyph('hon', 0, 0, font.unitsPerEm, {}, function(glyph, gX, gY, gFontSize) {
                        glyphPos.push({w: glyph.advanceWidth, lsb: glyph.leftSideBearing, gX, count: glyph.path.commands.length});
                    }),
                    2014
                );
                assert.deepEqual(glyphPos, [
                    {count: 53, w: 635, lsb: 18, gX: 0},
                    {count: 32, w: 577, lsb: 55, gX: 691},
                    {count: 49, w: 645, lsb: 28, gX: 1331},
                ]);

                font = fonts.hvar2;
                font.variation.set(font.variation.getDefaultCoordinates());
                glyphPos = [];
                assert.equal(
                    font.forEachGlyph('AB', 0, 0, font.unitsPerEm, {}, function(glyph, gX, gY, gFontSize) {
                        glyphPos.push({w: glyph.getAdvanceWidth(font), lsb: font.variation.getLeftSideBearing(glyph), gX});
                    }),
                    900
                );
                assert.deepEqual(glyphPos, [
                    {w: 450, lsb: 0, gX: 0},
                    {w: 450, lsb: 0, gX: 450},
                ]);
                glyphPos = [];
                font.variation.set({wght: 1000})
                assert.equal(
                    font.forEachGlyph('AB', 0, 0, font.unitsPerEm, {}, function(glyph, gX, gY, gFontSize) {
                        glyphPos.push({w: glyph.getAdvanceWidth(font), lsb: font.variation.getLeftSideBearing(glyph), gX});
                    }),
                    1700
                );
                assert.deepEqual(glyphPos, [
                    {w: 850, lsb: 0, gX: 0},
                    {w: 850, lsb: 0, gX: 850},
                ]);
            });
        });
    });
    
    describe('mvar', function() {
        it('parses the value records', function() {
            assert.deepStrictEqual(Object.keys(fonts.mvar.tables.mvar.valueRecords).sort(), ['hcrn', 'hcrs', 'sbxo', 'spxo']);
        });

        // the values of fontTools (varLib.instancer) at each slnt, minus the ones of hhea and OS/2
        it('calculates the adjustment of a metric at a variation', function() {
            const font = fonts.mvar;
            assert.equal(Math.round(font.variation.getMetricAdjustment('hcrs', { slnt: -15 })), 999);
            assert.equal(Math.round(font.variation.getMetricAdjustment('hcrn', { slnt: -15 })), 268);
            assert.equal(Math.round(font.variation.getMetricAdjustment('spxo', { slnt: -15 })), 70);
            assert.equal(Math.round(font.variation.getMetricAdjustment('hcrn', { slnt: -7.5 })), 134);
            assert.equal(font.variation.getMetricAdjustment('hcrn', { slnt: 0 }), 0);
        });

        it('uses the current variation without coordinates', function() {
            const font = loadSync('./test/fonts/TestGVAR-Composite-0.ttf');
            font.variation.set({ slnt: -15 });
            assert.equal(Math.round(font.variation.getMetricAdjustment('hcrn')), 268);
        });

        it('returns 0 for a metric the font does not vary', function() {
            assert.equal(fonts.mvar.variation.getMetricAdjustment('xhgt', { slnt: -15 }), 0);
            assert.equal(fonts.mvarWithoutCaret.variation.getMetricAdjustment('hcrn', { ital: 1 }), 0);
        });

        it('returns 0 without an mvar table', function() {
            assert.equal(fonts.hvar.variation.getMetricAdjustment('hcrn'), 0);
        });
    });

    describe('hvar', function() {
        it('transforms advanceWidth', function() {
            let font = fonts.hvar;
            font.variation.set(font.variation.getDefaultCoordinates());
            let glyphPos = [];
            assert.equal(
                font.forEachGlyph('ABC', 0, 0, font.unitsPerEm, {}, function(glyph, gX, gY, gFontSize) {
                    glyphPos.push({w: glyph.getAdvanceWidth(font), lsb: font.variation.getLeftSideBearing(glyph), gX});
                }),
                1656
            );
            assert.deepEqual(glyphPos, [
                {w: 520, lsb: 10, gX: 0},
                {w: 574, lsb: 100, gX: 520},
                {w: 562, lsb: 56, gX: 1094},
            ]);
            glyphPos = [];
            font.variation.set({wght: 1000})
            // expected values from fontTools.varLib.instancer at wght 1000
            assert.equal(
                font.forEachGlyph('ABC', 0, 0, font.unitsPerEm, {}, function(glyph, gX, gY, gFontSize) {
                    glyphPos.push({w: glyph.getAdvanceWidth(font), lsb: font.variation.getLeftSideBearing(glyph), gX});
                }),
                1782
            );
            assert.deepEqual(glyphPos, [
                {w: 584, lsb: 10, gX: 0},
                {w: 612, lsb: 100, gX: 584},
                {w: 586, lsb: 56, gX: 1196},
            ]);

            font = fonts.hvar2;
            font.variation.set(font.variation.getDefaultCoordinates());
            glyphPos = [];
            assert.equal(
                font.forEachGlyph('AB', 0, 0, font.unitsPerEm, {}, function(glyph, gX, gY, gFontSize) {
                    glyphPos.push({w: glyph.getAdvanceWidth(font), lsb: font.variation.getLeftSideBearing(glyph), gX});
                }),
                900
            );
            assert.deepEqual(glyphPos, [
                {w: 450, lsb: 0, gX: 0},
                {w: 450, lsb: 0, gX: 450},
            ]);
            glyphPos = [];
            font.variation.set({wght: 1000})
            assert.equal(
                font.forEachGlyph('AB', 0, 0, font.unitsPerEm, {}, function(glyph, gX, gY, gFontSize) {
                    glyphPos.push({w: glyph.getAdvanceWidth(font), lsb: font.variation.getLeftSideBearing(glyph), gX});
                }),
                1700
            );
            assert.deepEqual(glyphPos, [
                {w: 850, lsb: 0, gX: 0},
                {w: 850, lsb: 0, gX: 850},
            ]);
        });

        it('computes the varied metrics without modifying the shared glyph', function() {
            const font = fonts.hvar;
            font.variation.set(font.variation.getDefaultCoordinates());
            const glyph = font.charToGlyph('A');
            const defaultAdvanceWidth = glyph.advanceWidth;
            glyph.getPath(0, 0, font.unitsPerEm, { variation: { wght: 1000 } }, font);
            font.variation.getTransform(glyph, { wght: 1000 });
            assert.equal(glyph.advanceWidth, defaultAdvanceWidth);
            assert.equal(glyph.getAdvanceWidth(font, { wght: 1000 }), 584);
            assert.equal(font.variation.getTransform(glyph, { wght: 1000 }).advanceWidth, 584);
            assert.equal(glyph.getAdvanceWidth(font), defaultAdvanceWidth);
        });

        // the item of A and B with the delta -900 instead of 400 at wght max, like negative-hvar.ttf:
        // python -c "from fontTools.ttLib import TTFont; font = TTFont('TestHVARTwo.ttf');
        // font['HVAR'].table.VarStore.VarData[0].Item[1] = [-900, 0, 0, 0, 0]; font.save('negative-hvar.ttf')"
        // hb-shape --no-glyph-names --variations=wght=1000 negative-hvar.ttf -u 0041,0042 [2=0+0|1=1+0]; at wght 500
        // [2=0+262|1=1+262]
        it('gives a varied advance width of 0 where HVAR would make it negative, like HarfBuzz', function() {
            const font = loadSync('./test/fonts/TestHVARTwo.ttf');
            font.tables.hvar.itemVariationStore.itemVariationSubtables[0].deltaSets[1] = [-900, 0, 0, 0, 0];
            const glyphA = font.charToGlyph('A');
            assert.equal(font.variation.getAdvanceWidth(glyphA, { wght: 1000 }), 0);
            assert.equal(font.variation.getAdvanceWidth(glyphA, { wght: 500 }), 262);
            assert.equal(font.variation.getTransform(glyphA, { wght: 1000 }).advanceWidth, 0);
            assertShape(shapeText(font, 'AB', { variation: { wght: 1000 } }), { glyphs: [2, 1], clusters: [0, 1], advances: [0, 0] });
        });

        it('varies the advance width through the gvar phantom points when there is no HVAR', function() {
            const font = loadSync('./test/fonts/VARTest.ttf');
            assert.equal(font.tables.hvar, undefined);
            const glyphA = font.charToGlyph('A');
            const glyphN = font.charToGlyph('n');
            // expected values from fontTools.varLib.instancer at wght 700
            assert.equal(glyphA.getAdvanceWidth(font, { wght: 700 }), 778);
            assert.equal(glyphN.getAdvanceWidth(font, { wght: 700 }), 625);
            assert.equal(font.variation.getLeftSideBearing(glyphA, { wght: 700 }), 40);
            assert.equal(font.variation.getTransform(glyphA, { wght: 700 }).advanceWidth, 778);
            assert.equal(glyphA.advanceWidth, 724);
            font.variation.set({ wght: 700 });
            assert.equal(font.getAdvanceWidth('An', font.unitsPerEm, { kerning: false }), 778 + 625);
        });

        it('keeps the outline of a glyph without gvar variations', function() {
            // Changa: an HVAR table, and the "estimated" glyph has points but no gvar data
            const font = loadSync('./test/fonts/Changa-VariableFont_wght.ttf');
            const glyph = font.nameToGlyph('estimated');
            assert.equal(font.variation.gvar().glyphVariations[glyph.index], undefined);
            const defaultCommands = glyph.getPath(0, 0, font.unitsPerEm).commands;
            assert.ok(defaultCommands.length > 0);
            const transformedGlyph = font.variation.getTransform(glyph, { wght: 800 });
            assert.deepEqual(transformedGlyph.path.commands, glyph.path.commands);
            assert.deepEqual(glyph.getPath(0, 0, font.unitsPerEm, { variation: { wght: 800 } }, font).commands, defaultCommands);
        });

        // HVAR of Changa has no LSB map: the left side bearings vary with the outline
        // fontTools: varLib.instancer.instantiateVariableFont(font, {'wght': ...})['hmtx'][name] for A, H and o:
        // (641, 5), (650, 50), (590, 30) at wght 800, (572, 13), (643, 81), (562, 53) at wght 500
        it('takes the left side bearing from the varied outline when HVAR has no LSB map', function() {
            const font = loadSync('./test/fonts/Changa-VariableFont_wght.ttf');
            const glyphs = ['A', 'H', 'o'].map(character => font.charToGlyph(character));
            for (const [variation, leftSideBearings] of [[{ wght: 800 }, [5, 50, 30]], [{ wght: 500 }, [13, 81, 53]]]) {
                assert.deepStrictEqual(glyphs.map(glyph => font.variation.getLeftSideBearing(glyph, variation)), leftSideBearings);
                assert.deepStrictEqual(glyphs.map(glyph => font.variation.getTransform(glyph, variation).leftSideBearing), leftSideBearings);
            }
        });

        // TestHVARLsbMap.ttf, generated by test/generate-hvar-lsb-map-font.py: at wght max gvar moves the outline
        // of H by x +50, its HVAR LSB map varies the left side bearing 100 by 20 only. The HVAR value wins, like
        // HarfBuzz (hmtx lsb plus the HVAR delta when the LSB map is there):
        // fontTools: VarStoreInstancer(HVAR.VarStore, fvar.axes, {'wght': 1})[HVAR.LsbMap.mapping['H']] is 20,
        // 10 at {'wght': 0.5}
        it('takes the left side bearing from the LSB map of HVAR when it has one', function() {
            const font = loadSync('./test/fonts/TestHVARLsbMap.ttf');
            const glyph = font.charToGlyph('H');
            for (const [variation, advanceWidth, leftSideBearing] of [[{ wght: 900 }, 700, 120], [{ wght: 650 }, 650, 110]]) {
                const transformedGlyph = font.variation.getTransform(glyph, variation);
                assert.deepStrictEqual([transformedGlyph.advanceWidth, transformedGlyph.leftSideBearing], [advanceWidth, leftSideBearing]);
                assert.equal(font.variation.getLeftSideBearing(glyph, variation), leftSideBearing);
                assert.equal(font.variation.getAdvanceWidth(glyph, variation), advanceWidth);
            }
            // the advance widths and the outline, x bearing 150 (not the left side bearing):
            // hb-shape --no-glyph-names --show-extents --variations=wght=900 TestHVARLsbMap.ttf -u 0048
            // [1=0+700<150,700,400,-700>]
            // hb-shape --no-glyph-names --show-extents --variations=wght=650 TestHVARLsbMap.ttf -u 0048
            // [1=0+650<125,700,400,-700>]
            assert.equal(font.variation.getTransform(glyph, { wght: 900 }).points[0].x, 150);
        });

        // TestHVARRegionAxes.ttf, generated by test/generate-hvar-region-axes-font.py: an fvar table of the axis wght
        // only, no gvar table, and an HVAR region list of the axes wght and wdth, whose regions wght max, wdth max and
        // their corner give A the deltas 100, 40 and 20. Like HarfBuzz (VarRegionList::evaluate), the wdth axis is read
        // at the coordinate 0, so that only the region wght max varies A:
        // hb-shape --no-glyph-names --variations=wght=<wght> TestHVARRegionAxes.ttf -u 0041
        // [1=0+600] at 900, [1=0+550] at 650, [1=0+500] at 400
        it('reads an axis of the HVAR region list past the fvar axes at the coordinate 0, like HarfBuzz', function() {
            const font = loadSync('./test/fonts/TestHVARRegionAxes.ttf');
            assert.deepStrictEqual(font.warnings, []);
            const glyph = font.charToGlyph('A');
            for (const [wght, advanceWidth] of [[900, 600], [650, 550], [400, 500]]) {
                assert.strictEqual(glyph.getAdvanceWidth(font, { wght }), advanceWidth, String(wght));
                assert.strictEqual(formatShape(font, [0x41], { variation: { wght } }), `[1=0+${advanceWidth}]`);
                assert.strictEqual(font.getAdvanceWidth('A', 1000, { variation: { wght } }), advanceWidth);
            }
        });

        // the glyph of U+0000 of Changa is named NULL, the Glyph constructor reserves the code point 0 to .null
        it('draws the glyph of U+0000 named other than .null', function() {
            const font = loadSync('./test/fonts/Changa-VariableFont_wght.ttf');
            const glyph = font.charToGlyph('\u0000');
            assert.equal(glyph.name, 'NULL');
            const transformedGlyph = font.variation.getTransform(glyph, { wght: 800 });
            assert.equal(transformedGlyph.name, 'NULL');
            assert.deepStrictEqual(transformedGlyph.unicodes, [0]);
            assert.deepStrictEqual(glyph.getPath(0, 0, font.unitsPerEm, { variation: { wght: 800 } }, font).commands, []);
        });
    });

    describe('normalized coordinates', function() {
        // fontTools: varLib.instancer.normalize(value, triple, None) with the axes wght 28..94..194,
        // wdth 70..100..100 and opsz 12..12..72
        it('clamps the values to the range of their axis, also for an axis whose default is its minimum or maximum', function() {
            const process = fonts.cvar1.variation.process;
            assert.deepStrictEqual(process.getNormalizedCoords({ wght: 20, wdth: 120, opsz: 6 }), [-1, 0, 0]);
            assert.deepStrictEqual(process.getNormalizedCoords({ wght: 300, wdth: 70, opsz: 72 }), [1, -1, 1]);
        });

        it('rounds the normalized coordinates to F2Dot14', function() {
            const process = fonts.cvar1.variation.process;
            // 48 / 100 is 31457.28 / 65536: 31457 in 16.16, (31457 + 2) >> 2 = 7864, 7864 / 16384 = 0.47998046875
            assert.deepStrictEqual(process.getNormalizedCoords({ wght: 142, wdth: 85, opsz: 12 }), [0.47998046875, -0.5, 0]);
            // -0.0000002 rounds to 0, not to -0
            assert.ok(Object.is(process.getNormalizedCoords({ wght: 93.9999 })[0], 0));
        });

        // OpenType precision and rounding requirements, steps 1 to 5, like HarfBuzz: wght 131.1 on 28..94..194
        // is 0.371 (24313.856 / 65536), 24314 in 16.16, (24314 + 2) >> 2 = 6079; wdth 88.39 on 70..100..100 is
        // -0.387 (-25362.4 / 65536), -25362, -6340. fontTools varLib.instancer.normalize gives 6078 and -6341.
        // TestItalicSwitch: wdth 83.75 on 75..100..100 is -0.65, -42598 in 16.16, -10649 (fontTools -10650).
        it('normalizes in 16.16 and converts to F2Dot14 once, without avar', function() {
            assert.deepStrictEqual(fonts.cvar1.variation.process.getNormalizedCoords({ wght: 131.1, wdth: 88.39 }), [6079 / 16384, -6340 / 16384, 0]);
            // hb-shape --no-glyph-names --variations=wght=131.1,wdth=88.39 TestCVARGVAROne.ttf -u 006F
            // [4=0+558]
            assert.equal(fonts.cvar1.variation.getAdvanceWidth(fonts.cvar1.charToGlyph('o'), { wght: 131.1, wdth: 88.39 }), 558);
            const italicFont = fonts.mvarWithoutCaret;
            assert.deepStrictEqual(italicFont.variation.process.getNormalizedCoords({ wdth: 83.75 }), [0, -10649 / 16384, 0]);
            // hb-shape --no-glyph-names --variations=wdth=83.75 TestItalicSwitch.ttf -u 0030
            // [18=0+509]
            assert.equal(italicFont.variation.getAdvanceWidth(italicFont.charToGlyph('0'), { wdth: 83.75 }), 509);
        });

        // step 1 of the OpenType algorithm, with TestVariationPrecision.ttf (wght 100..400..900): wght 650.316615 is
        // 42619149.68 / 65536, 42619150 in 16.16, then normalized to 32809.5 exactly, 32810, (32810 + 2) >> 2 = 8203;
        // normalized without the conversion of step 1 it is 32809.49936, 32809, 8202. The reference is the spec
        // arithmetic: hb-shape reads the user value as a 32-bit float, 650.31658935546875, and gives 8202 here
        it('converts the user coordinates to 16.16 before the normalization', function() {
            const process = loadSync('./test/fonts/TestVariationPrecision.ttf').variation.process;
            assert.deepStrictEqual(process.getNormalizedCoords({ wght: 650.316615 }), [8203 / 16384, 0]);
        });

        // Changa, wght 200..200..800: 222.5 is 0.0375, 2458 in 16.16, avar (0: 0, 0.16668701171875: 0.111083984375)
        // maps it to 7280 * 2458 / 10924 = 1638.04, 1638, (1638 + 2) >> 2 = 410 (fontTools: 409). 207 is 7 / 600,
        // 764.59 in 16.16, 765, avar 7280 * 765 / 10924 = 509.81, rounded 510, (510 + 2) >> 2 = 128; without the
        // rounding of the avar map it is 127 (fontTools: 127).
        // InterVariable, opsz 14..14..32 with an identity map and wght 100..400..900: opsz 20 is 21845 in 16.16, 5461;
        // wght 700 is 39322, avar (0.5999755859375: 0.53997802734375, 0.79998779296875: 0.760009765625) maps it
        // to 35390, 8848 (fontTools: 8847).
        it('maps the coordinates through the avar map of their own axis in 16.16', function() {
            const changaFont = loadSync('./test/fonts/Changa-VariableFont_wght.ttf');
            assert.deepStrictEqual(changaFont.variation.process.getNormalizedCoords({ wght: 222.5 }), [410 / 16384]);
            assert.deepStrictEqual(changaFont.variation.process.getNormalizedCoords({ wght: 207 }), [128 / 16384]);
            // hb-shape --no-glyph-names --variations=wght=222.5 Changa-VariableFont_wght.ttf -u 004C
            // [59=0+426]
            assert.equal(changaFont.variation.getAdvanceWidth(changaFont.charToGlyph('L'), { wght: 222.5 }), 426);
            const interFont = loadSync('./test/fonts/InterVariable.ttf');
            assert.deepStrictEqual(interFont.variation.process.getNormalizedCoords({ opsz: 20, wght: 700 }), [5461 / 16384, 8848 / 16384]);
            // hb-shape --no-glyph-names --variations=wght=700,opsz=14 InterVariable.ttf -u 0032
            // [1343=0+1290]
            assert.equal(interFont.variation.getAdvanceWidth(interFont.charToGlyph('2'), { opsz: 14, wght: 700 }), 1290);
            // hb-shape --no-glyph-names --variations=wght=700,opsz=20 InterVariable.ttf -u 0032
            // [1343=0+1268]
            assert.equal(interFont.variation.getAdvanceWidth(interFont.charToGlyph('2'), { opsz: 20, wght: 700 }), 1268);
        });

        // An avar map without the entries -1 and 1 (out of the spec): a value below the first or above the
        // last entry moves with it, and the result is not clamped, like HarfBuzz and fontTools
        // varLib.models.piecewiseLinearMap: piecewiseLinearMap(1, {-0.5: -0.25, 0: 0, 0.5: 13107 / 16384})
        // is 1.29998779296875 (65536 + 52428 - 32768 = 85196 in 16.16, 21299 / 16384), at -1 it is -0.75.
        // An empty map leaves the coordinate as it is.
        it('maps a value out of the avar map with its first or last entry, without clamping', function() {
            const font = loadSync('./test/fonts/TestVariationPrecision.ttf');
            font.tables.avar = {
                axisSegmentMaps: [
                    { axisValueMaps: [
                        { fromCoordinate: -0.5, toCoordinate: -0.25 },
                        { fromCoordinate: 0, toCoordinate: 0 },
                        { fromCoordinate: 0.5, toCoordinate: 13107 / 16384 }
                    ] },
                    { axisValueMaps: [] }
                ]
            };
            const process = font.variation.process;
            assert.deepStrictEqual(process.getNormalizedCoords({ wght: 900, wdth: 75 }), [21299 / 16384, -0.5]);
            assert.deepStrictEqual(process.getNormalizedCoords({ wght: 100, wdth: 100 }), [-0.75, 0]);
            // fontTools: varLib.models.supportScalar({'wght': 1.3}, {'wght': (0, 1, 1)}) is 0, the space keeps its
            // advance width 250 (its only tuple, at wght max, would give 350 at a clamped 1). HarfBuzz does not
            // clamp either, on TestVariationPrecision.ttf with this avar added by fontTools (newTable('avar'),
            // segments {'wght': {-0.5: -0.25, 0: 0, 0.5: 13107 / 16384}, 'wdth': {}}):
            // hb-shape --no-glyph-names --variations=wght=900 <font with the avar> -u 0020
            // [2=0+250]
            assert.equal(font.variation.getAdvanceWidth(2, { wght: 900 }), 250);
        });
    });

    describe('scalars of the tuples and of the regions', function() {
        let process;

        before(function() {
            process = loadSync('./test/fonts/TestVariationPrecision.ttf').variation.process;
        });

        // fontTools: varLib.models.supportScalar(location, support) for the axis of the peak, the other one
        // does not take part (peak 0)
        it('calculates the exact scalar of a tuple', function() {
            const cases = [
                { header: { peakTuple: [1, 0] }, coordinates: [0.5, 0], scalar: 0.5 },
                { header: { peakTuple: [-1, 0] }, coordinates: [-0.25, 0], scalar: 0.25 },
                { header: { peakTuple: [1, 0] }, coordinates: [0, 0], scalar: 0 },
                { header: { peakTuple: [1, 1] }, coordinates: [0.6, 0.5], scalar: 0.3 },
                { header: { peakTuple: [0.5, 0], intermediateStartTuple: [0.25, 0], intermediateEndTuple: [1, 0] }, coordinates: [0.75, 0], scalar: 0.5 },
                { header: { peakTuple: [0.5, 0], intermediateStartTuple: [0.25, 0], intermediateEndTuple: [1, 0] }, coordinates: [0.375, 0], scalar: 0.5 },
                { header: { peakTuple: [0.5, 0], intermediateStartTuple: [0.25, 0], intermediateEndTuple: [1, 0] }, coordinates: [0.25, 0], scalar: 0 },
                // a region across 0 is invalid: the axis does not take part
                { header: { peakTuple: [0.5, 0], intermediateStartTuple: [-0.5, 0], intermediateEndTuple: [1, 0] }, coordinates: [0.75, 0], scalar: 1 },
                // so is a region whose start is above its peak, or whose peak is above its end:
                // supportScalar({'a': 0.8}, {'a': (0.75, 0.5, 1)}, ot=True) and
                // supportScalar({'a': 0.5}, {'a': (0.2, 0.9, 0.7)}, ot=True) are 1
                { header: { peakTuple: [0.5, 0], intermediateStartTuple: [0.75, 0], intermediateEndTuple: [1, 0] }, coordinates: [0.8, 0], scalar: 1 },
                { header: { peakTuple: [0.9, 0], intermediateStartTuple: [0.2, 0], intermediateEndTuple: [0.7, 0] }, coordinates: [0.5, 0], scalar: 1 }
            ];
            for (const { header, coordinates, scalar } of cases) {
                assert.strictEqual(process.getTupleScalar(header, coordinates, 'cvar'), scalar, JSON.stringify(header));
            }
        });

        it('reads the axes of the tuple, an axis past the coordinates at 0, like HarfBuzz (calculate_scalar)', function() {
            // a tuple of the axisCount of a gvar table that is not the number of axes of the fvar table: an axis past the
            // two coordinates does not take part when its peak is 0, and makes the tuple inactive otherwise, the axes
            // past the tuple do not take part
            const coordinates = [0.5, 1];
            assert.strictEqual(process.getTupleScalar({ peakTuple: [1] }, coordinates, 'cvar'), 0.5);
            assert.strictEqual(process.getTupleScalar({ peakTuple: [1, 1, 0] }, coordinates, 'cvar'), 0.5);
            assert.strictEqual(process.getTupleScalar({ peakTuple: [1, 1, 1] }, coordinates, 'cvar'), 0);
        });

        // a region of each axis and their corner; the normalized location of wght 650, wdth 75 is (0.5, -0.5)
        const itemStore = {
            variationRegions: [
                { regionAxes: [{ startCoord: 0, peakCoord: 1, endCoord: 1 }, { startCoord: 0, peakCoord: 0, endCoord: 0 }] },
                { regionAxes: [{ startCoord: 0, peakCoord: 0, endCoord: 0 }, { startCoord: -1, peakCoord: -1, endCoord: 0 }] },
                { regionAxes: [{ startCoord: 0, peakCoord: 1, endCoord: 1 }, { startCoord: -1, peakCoord: -1, endCoord: 0 }] }
            ],
            itemVariationSubtables: [{ regionIndexes: [0, 1, 2], deltaSets: [[-105, 0, 0], [-85, 0, 0]] }]
        };

        it('calculates the exact scalars of the regions of an item variation store', function() {
            assert.deepStrictEqual(process.getBlendVector(itemStore, 0, { wght: 650, wdth: 75 }), [0.5, 0.5, 0.25]);
            assert.deepStrictEqual(process.getBlendVector(itemStore, 0, { wght: 400, wdth: 100 }), [0, 0, 0]);
        });

        it('gives the scalar 0 to a tuple without a peak, like HarfBuzz (TupleVariationHeader::calculate_scalar)', function() {
            // a cvar tuple without an embedded peak, a gvar tuple whose shared tuple index is past the shared tuples of
            // the table (TestVariationPrecision.ttf has one)
            const coordinates = [1, 1];
            assert.strictEqual(process.gvar().sharedTuples.length, 1);
            assert.strictEqual(process.getTupleScalar({ peakTuple: undefined }, coordinates, 'cvar'), 0);
            assert.strictEqual(process.getTupleScalar({ peakTuple: undefined, sharedTupleRecordsIndex: 5 }, coordinates, 'gvar'), 0);
            // such a tuple is inactive, its data are not read, and the other tuples still apply
            const tupleWithoutPeak = { peakTuple: undefined, privatePoints: null, deltas: null };
            const variationData = { headers: [{ peakTuple: [1, 0], deltas: [10] }, tupleWithoutPeak], sharedPoints: [] };
            assert.deepStrictEqual(process.getActiveTuples(variationData, coordinates, 'cvar')
                .map(({ header, factor }) => ({ header, factor })), [{ header: variationData.headers[0], factor: 1 }]);
        });

        it('gives the scalar 0 to a region index past the region list, like HarfBuzz (VarRegionList::evaluate)', function() {
            // the region indexes 3 and 200 of an item variation data, past the 3 regions of the store, and the same item
            // variation data with a store without regions (a VariationRegionList offset of 0, read at the start of the
            // store, gives a region list of 0 regions)
            const variationSubtable = { regionIndexes: [0, 3, 2, 200], deltaSets: [[-105, 7, 0, 9]] };
            const outOfRangeStore = { variationRegions: itemStore.variationRegions, itemVariationSubtables: [variationSubtable] };
            assert.deepStrictEqual(process.getBlendVector(outOfRangeStore, 0, { wght: 650, wdth: 75 }), [0.5, 0, 0.25, 0]);
            assert.strictEqual(process.getDelta(outOfRangeStore, 0, 0, { wght: 650, wdth: 75 }), -52.5);
            const storeWithoutRegions = { variationRegions: [], itemVariationSubtables: [variationSubtable] };
            assert.deepStrictEqual(process.getBlendVector(storeWithoutRegions, 0, { wght: 650, wdth: 75 }), [0, 0, 0, 0]);
            assert.strictEqual(process.getDelta(storeWithoutRegions, 0, 0, { wght: 650, wdth: 75 }), 0);
        });

        it('reads a region axis past the coordinates at 0, like HarfBuzz (VarRegionList::evaluate)', function() {
            // the regions of a region list of three axes for the two axes of the font: the third axis gives the scalar
            // 0 to a region whose peak on it is not 0, and does not take part in a region whose peak on it is 0
            const thirdAxisStore = {
                variationRegions: [
                    { regionAxes: [...itemStore.variationRegions[0].regionAxes, { startCoord: 0, peakCoord: 1, endCoord: 1 }] },
                    { regionAxes: [...itemStore.variationRegions[0].regionAxes, { startCoord: 0, peakCoord: 0, endCoord: 0 }] },
                    { regionAxes: [...itemStore.variationRegions[1].regionAxes, { startCoord: -1, peakCoord: -1, endCoord: 0 }] }
                ],
                itemVariationSubtables: [{ regionIndexes: [0, 1, 2], deltaSets: [[100, 40, 20]] }]
            };
            assert.deepStrictEqual(process.getBlendVector(thirdAxisStore, 0, { wght: 650, wdth: 75 }), [0, 0.5, 0]);
            assert.strictEqual(process.getDelta(thirdAxisStore, 0, 0, { wght: 650, wdth: 75 }), 20);
        });

        it('gives a delta of exactly 0 at the default location and of exactly a half at a scalar of 0.5', function() {
            // a negative zero rounds to -0: a kerning of -0 instead of 0
            assert.ok(Object.is(process.getDelta(itemStore, 0, 0, { wght: 400, wdth: 100 }), 0));
            assert.strictEqual(process.getDelta(itemStore, 0, 1, { wght: 650, wdth: 75 }), -42.5);
        });
    });

    // TestVariationPrecision.ttf, generated by test/generate-variation-precision-font.py: no avar and no HVAR,
    // the references are fontTools varLib.instancer.instantiateVariableFont(font, location) (glyf and hmtx of
    // the instance, saved and reloaded) and hb-shape
    describe('gvar deltas and phantom points', function() {
        const glyphIndexes = { NULL: 1, space: 2, H: 3, Hdot: 5 };
        let font;

        beforeEach(function() {
            font = loadSync('./test/fonts/TestVariationPrecision.ttf');
        });

        it('has the shared points and the all-points tuple of H', function() {
            const variationData = font.tables.gvar.glyphVariations[glyphIndexes.H];
            assert.deepStrictEqual(variationData.sharedPoints, [0, 5]);
            assert.deepStrictEqual(variationData.headers.map(header => header.privatePoints), [undefined, undefined, []]);
        });

        // glyf['H'].getCoordinates(glyf)[0] at wght=650, wdth=75: the x deltas 0.5 and 0.5 add up to 1;
        // rounded after each tuple they give 102
        it('adds up the deltas of all the active tuples and rounds them once', function() {
            const points = font.variation.getTransform(glyphIndexes.H, { wght: 650, wdth: 75 }).points;
            assert.deepStrictEqual(points.map(point => [point.x, point.y]), [[101, 0], [101, 700], [501, 701], [501, 0]]);
        });

        // hb-shape --no-glyph-names --variations=wght=650,wdth=75 TestVariationPrecision.ttf -u 0048
        // [3=0+613]
        // hb-shape --no-glyph-names --variations=wght=900,wdth=50 TestVariationPrecision.ttf -u 0048
        // [3=0+630]
        it('reads the right phantom point of an all-points tuple next to shared point numbers', function() {
            assert.equal(font.variation.getAdvanceWidth(glyphIndexes.H, { wght: 650, wdth: 75 }), 613);
            assert.equal(font.variation.getAdvanceWidth(glyphIndexes.H, { wght: 900, wdth: 50 }), 630);
        });

        // hb-shape --no-glyph-names --variations=wght=1000,wdth=40 TestVariationPrecision.ttf -u 0048
        // [3=0+630]
        it('clamps the coordinates out of the range of the axes', function() {
            assert.deepStrictEqual(font.variation.process.getNormalizedCoords({ wght: 1000, wdth: 40 }), [1, -1]);
            assert.equal(font.variation.getAdvanceWidth(glyphIndexes.H, { wght: 1000, wdth: 40 }), 630);
        });

        // hb-shape --no-glyph-names --variations=wght=900 TestVariationPrecision.ttf -u 1E22
        // [5=0+640]
        it('varies the advance width of a composite glyph before its outline is parsed', function() {
            assert.equal(font.glyphs.get(glyphIndexes.Hdot).getAdvanceWidth(font, { wght: 900 }), 640);
        });

        // TestGVAR-Composite-Missing: odieresis (o + uni0308) has no gvar data of its own, its components vary.
        // fontTools: instantiateVariableFont(font, {'slnt': -15})['glyf']['odieresis'].getCoordinates(glyf)[0]
        // has 60 points, (129, -10) first, (321, 425) the first of uni0308 and (180, 425) last
        it('varies the components of a composite glyph without gvar data before its outline is parsed', function() {
            const compositeFont = loadSync('./test/fonts/TestGVAR-Composite-Missing.ttf');
            const points = compositeFont.variation.process.getVariedPoints(compositeFont.glyphs.get(6), { slnt: -15 });
            assert.equal(points.length, 60);
            assert.deepStrictEqual([0, 32, 59].map(index => [points[index].x, points[index].y]), [[129, -10], [321, 425], [180, 425]]);
        });

        // fontTools: instantiateVariableFont(font, {'wght': 900, 'wdth': 100})['hmtx']['Hdot'] is (640, 81), as in
        // the test below, here with the glyphs parsed on demand
        it('takes the varied phantom points into the metrics with lowMemory', function() {
            const lowMemoryFont = loadSync('./test/fonts/TestVariationPrecision.ttf', { lowMemory: true });
            assert.equal(lowMemoryFont.variation.getAdvanceWidth(glyphIndexes.Hdot, { wght: 900 }), 640);
            assert.equal(lowMemoryFont.variation.getLeftSideBearing(glyphIndexes.Hdot, { wght: 900 }), 81);
        });

        // Hdot: its tuple at wght max moves the left phantom point by 20 and the right one by 60.
        // fontTools: instantiateVariableFont(font, {'wght': 900, 'wdth': 100})['hmtx']['Hdot'] is (640, 81),
        // at wght 650 (620, 91): the xMin 101 of the varied outline minus the varied origin, 20 and 10
        it('takes the varied left phantom point into the advance width and the left side bearing', function() {
            for (const [variation, advanceWidth, leftSideBearing] of [[{ wght: 900 }, 640, 81], [{ wght: 650 }, 620, 91]]) {
                const transformedGlyph = font.variation.getTransform(glyphIndexes.Hdot, variation);
                assert.deepStrictEqual([transformedGlyph.advanceWidth, transformedGlyph.leftSideBearing], [advanceWidth, leftSideBearing]);
                assert.equal(font.variation.getLeftSideBearing(glyphIndexes.Hdot, variation), leftSideBearing);
            }
            // hb-shape --no-glyph-names --variations=wght=650 TestVariationPrecision.ttf -u 1E22
            // [5=0+620]
            assert.equal(font.variation.getAdvanceWidth(glyphIndexes.Hdot, { wght: 650 }), 620);
        });

        // hb-shape --no-glyph-names --variations=wght=900 TestVariationPrecision.ttf -u 0020
        // [2=0+350]
        it('gives a glyph without points the same varied advance width in getTransform and getAdvanceWidth', function() {
            assert.equal(font.variation.getTransform(glyphIndexes.space, { wght: 900 }).advanceWidth, 350);
            assert.equal(font.variation.getAdvanceWidth(glyphIndexes.space, { wght: 900 }), 350);
        });

        // the tuple of space at wght max with its right phantom point moved by -400 instead of 100, like negative-advance.ttf:
        // python -c "from fontTools.ttLib import TTFont; font = TTFont('TestVariationPrecision.ttf');
        // font['gvar'].variations['space'][0].coordinates[1] = (-400, 0); font.save('negative-advance.ttf')"
        // hb-shape --no-glyph-names --variations=wght=900 negative-advance.ttf -u 0020,0048 [2=0+0|3=1+640]
        // (instantiateVariableFont(font, {'wght': 900, 'wdth': 100})['hmtx']['space'] is (0, 0)); at wght 650
        // [2=0+50|3=1+620]
        it('gives a varied advance width of 0 where the phantom points would make it negative, like HarfBuzz', function() {
            font.tables.gvar.glyphVariations[glyphIndexes.space] = { headers: [{ peakTuple: [1, 0], deltas: [0, -400, 0, 0] }], sharedPoints: [] };
            assert.equal(font.variation.getAdvanceWidth(glyphIndexes.space, { wght: 900 }), 0);
            assert.equal(font.variation.getAdvanceWidth(glyphIndexes.space, { wght: 650 }), 50);
            assertShape(shapeText(font, ' H', { variation: { wght: 900 } }), { glyphs: [2, 3], clusters: [0, 1], advances: [0, 640] });
        });

        it('draws the glyph of U+0000 named NULL', function() {
            const glyph = font.charToGlyph('\u0000');
            assert.equal(glyph.index, glyphIndexes.NULL);
            assert.equal(font.variation.getTransform(glyph, { wght: 900 }).name, 'NULL');
            assert.deepStrictEqual(glyph.getPath(0, 0, font.unitsPerEm, { variation: { wght: 900 } }, font).commands, []);
        });

        // fontTools: instantiateCvar adds up the deltas of the active tuples and rounds them once
        it('rounds the cvt deltas once', function() {
            const variationData = {
                headers: [{ peakTuple: [1, 0], deltas: [1] }, { peakTuple: [0, -1], deltas: [1] }],
                sharedPoints: []
            };
            assert.deepStrictEqual(font.variation.process.applyTupleVariationStore(variationData, [100], { wght: 650, wdth: 75 }, 'cvar'), [101]);
        });

        // cvar has no interpolation: a tuple varies only the cvt values of its point numbers, private or
        // shared (fontTools instantiateCvar); the scalars at wght 650, wdth 75 are 0.5 and 0.5
        it('varies only the cvt values that a tuple lists', function() {
            const variationData = {
                headers: [{ peakTuple: [1, 0], privatePoints: [1, 3], deltas: [10, -6] }, { peakTuple: [0, -1], deltas: [4] }],
                sharedPoints: [0]
            };
            const cvtValues = font.variation.process.applyTupleVariationStore(variationData, [100, 200, 300, 400], { wght: 650, wdth: 75 }, 'cvar');
            assert.deepStrictEqual(cvtValues, [102, 205, 300, 397]);
        });

        // like HarfBuzz (gvar::apply_deltas_to_points), the data of an inactive tuple are not read, and an active
        // tuple whose data failed to parse (null deltas, see parseTupleVariationStore) leaves the values unvaried
        it('varies nothing where a tuple whose data failed to parse is active', function() {
            const brokenTuple = { peakTuple: [-1, 0], privatePoints: null, deltas: null };
            const variationData = { headers: [{ peakTuple: [1, 0], deltas: [10] }, brokenTuple], sharedPoints: [] };
            const process = font.variation.process;
            assert.deepStrictEqual(process.applyTupleVariationStore(variationData, [100], { wght: 650, wdth: 100 }, 'cvar'), [105]);
            assert.deepStrictEqual(process.getActiveTuples(variationData, process.getNormalizedCoords({ wght: 650, wdth: 100 }), 'cvar')
                .map(({ factor, tuplePoints }) => ({ factor, tuplePoints })), [{ factor: 0.5, tuplePoints: [] }]);
            brokenTuple.peakTuple = [1, 0];
            assert.deepStrictEqual(process.applyTupleVariationStore(variationData, [100], { wght: 650, wdth: 100 }, 'cvar'), [100]);
            assert.deepStrictEqual(process.getActiveTuples(variationData, process.getNormalizedCoords({ wght: 650, wdth: 100 }), 'cvar'), []);
        });
    });

});