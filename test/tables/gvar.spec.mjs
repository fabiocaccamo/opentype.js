import assert from 'assert';
import { parse, removeTables } from '../../src/opentype.mjs';
import { getTableRecordOffset } from '../testutil.mjs';
import { readFileSync } from 'fs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

describe('tables/gvar.mjs', function() {
    const fonts = {
        gvarTest1: loadSync('./test/fonts/TestGVAROne.ttf'),
        gvarTest2: loadSync('./test/fonts/TestGVARTwo.ttf'),
        gvarTest3: loadSync('./test/fonts/TestGVARThree.ttf'),
        gvarTest4: loadSync('./test/fonts/TestGVARFour.ttf'),
        interVariable: loadSync('./test/fonts/InterVariable.ttf'),
        // subset of Geist Italic (OFL 1.1), keeps the composite glyph "j" (uni0237 + uni0307)
        // whose gvar tuples use the all-points encoding with component offset deltas
        geistVariable: loadSync('./test/fonts/GeistVariableItalic-subset.ttf'),
        // Licensing for TestGVAREight and TestGVARNine is not clear,
        // so we can't include them
        // gvarTest8: loadSync('./test/fonts/TestGVAREight.ttf'),
        // gvarTest9: loadSync('./test/fonts/TestGVARNine.ttf'),
        gvarTestComp: loadSync('./test/fonts/TestGVAR-Composite-0.ttf'),
        gvarTestCompMissing: loadSync('./test/fonts/TestGVAR-Composite-Missing.ttf'),
        gvarTestCvar1: loadSync('./test/fonts/TestCVARGVAROne.ttf'),
        gvarTestCvar2: loadSync('./test/fonts/TestCVARGVARTwo.ttf'),
    };
    it('correctly parses the glyph variations table', function() {
        // tests for all fonts
        for(const fontName in fonts) {
            const font = fonts[fontName];
            assert.deepEqual(font.tables.gvar.version, [1,0]);
            assert.equal(font.tables.gvar.sharedTuples.find(t => t.length !== font.tables.fvar.axes.length), undefined);
            assert.deepEqual(Object.keys(font.tables.gvar.glyphVariations), Object.keys(font.glyphs.glyphs));
        };
        
        [1,2,3].forEach(n => {
            const font = fonts[`gvarTest${n}`];
            assert.deepEqual(font.tables.gvar.sharedTuples, [[-1],[1]]);
            assert.deepEqual(font.tables.gvar.glyphVariations[0].headers[0].deltas,
                [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
                    0,0,0,0,1,1,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,
                    0,0,0,0,0,0,0,0,0,0,0,0,0]);
            assert.deepEqual(font.tables.gvar.glyphVariations[0].headers[0].deltasY,
                [-1,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,0,-1,-1,0,0,-1,-1,0,0,0,
                    0,0,0,0,0,0,0,0,0,-1,-1,0,0,0,0,0,0,0,0,0,0,0,0,-1,-1,0,0,0,0,
                    0,0,0,0,0,0,0,0,-1,-1,0,0,-1,-1,-1,-1,-1,-1,0,0,0,0,0]);
            assert.deepEqual(font.tables.gvar.glyphVariations[0].headers[1].deltas,
                [-2,-2,-10,-10,-4,-8,-8,-4,-5,-5,-7,-7,-4,-8,-8,-5,-5,-6,-6,-7,-7,
                    -5,-5,-4,-4,-8,-8,-7,-7,-4,-4,-6,-6,-8,-8,-4,-4,-5,-5,-4,-5,
                    -5,-5,-5,-4,-8,-8,-6,-6,-4,-4,-8,-8,-6,-6,-8,-8,-4,-4,-5,-5,
                    -4,-4,-8,-8,-5,-7,-8,-8,-4,-4,-6,-4,0,-12,0,0]);
            assert.deepEqual(font.tables.gvar.glyphVariations[0].headers[1].deltasY,
                [23,0,0,23,18,18,16,16,17,17,17,17,14,14,12,12,13,13,13,13,13,13,12,
                    12,11,11,9,9,10,10,10,10,8,8,7,7,8,8,9,9,6,5,5,6,7,7,6,6,4,4,4,
                    4,3,3,2,2,2,2,2,2,3,3,21,21,21,21,19,19,18,18,19,19,21,0,0,0,0]);

            assert.deepEqual(font.tables.gvar.glyphVariations[13].headers[0].deltas,
                [0,12,0,15,15,4,4,15,15,-12,-12,-7,-7,-12,-12,-12,-12,-4,13,-12,-12,
                    15,15,24,-12,0,23,23,26,8,-8,3,0,-3,12,0,-3,-12,12,25,11,-8,-7,
                    -12,-23,-23,-23,-23,-9,-20,-4,4,-4,-1,-8,16,19,20,0,-2,0,1,8,16,
                    17,12,11,-13,-13,13,13,7,7,-20,-20,8,8,-16,-16,0,-14,-19,-20,-24,
                    -4,-5,-4,-23,-22,-28,-24,-4,-13,-13,13,13,16,16,-8,-8,20,20,-8,
                    -8,-13,-13,13,13,8,8,-16,-16,16,16,-8,-8,0,0,0,0]);
            assert.deepEqual(font.tables.gvar.glyphVariations[13].headers[0].deltasY,
                [0,-23,-32,4,8,8,-27,-27,-8,-8,-27,-27,8,8,-4,-13,-24,4,1,35,-12,-12,
                    35,19,-12,-47,-26,-8,-6,8,-16,-26,-27,-36,20,20,-5,0,-31,-15,-3,
                    0,-6,-16,-16,20,-8,-12,-27,-24,4,3,16,0,-12,-19,-32,-4,0,-10,-4,
                    -3,-12,8,9,20,4,-8,-43,-43,-8,-12,-28,-28,-12,-35,-2,-2,-35,-12,
                    6,8,5,4,-7,-8,-8,-4,-3,-12,-14,-32,-3,-39,-39,-3,-35,-2,-2,-35,
                    -12,-28,-28,-12,8,-28,-28,8,-18,-8,-8,-18,-18,-8,-8,-18,0,0,0,0]);
            assert.deepEqual(font.tables.gvar.glyphVariations[13].headers[1].deltas,
                [16,8,-14,-20,-20,0,0,-20,-20,20,20,4,4,20,20,11,-4,0,21,20,20,-20,
                    -20,-8,19,0,-6,-16,-6,0,28,16,4,-19,-31,16,29,27,4,-4,-15,24,30,
                    35,0,0,26,39,13,-4,-28,-5,8,8,27,8,-2,-15,16,12,20,7,11,9,10,12,
                    17,35,35,-35,-35,-12,-12,35,35,0,0,15,15,-16,-7,0,0,11,-4,-10,
                    -20,4,7,11,6,0,35,35,-35,-35,-16,-16,-1,-1,-35,-35,12,12,35,35,
                    -35,-35,-35,-35,15,15,-16,-16,34,34,0,0,0,0]);
            assert.deepEqual(font.tables.gvar.glyphVariations[13].headers[1].deltasY,
                [-35,16,11,5,-31,-31,12,12,0,0,12,12,-31,-31,-16,-4,11,-35,-50,-47,
                    -27,-27,-43,-37,-23,0,1,-19,-21,-23,0,7,12,-24,-42,-42,-10,-11,
                    12,14,-15,-20,-12,0,0,-42,-28,-19,-7,4,-31,-42,-47,-37,-23,-16,
                    -12,-23,-24,-39,-24,-7,-5,-32,-42,-47,-40,-35,28,28,-35,-19,35,
                    35,-19,-8,-1,-1,-8,-24,-32,-43,-43,-19,-22,-7,-23,-24,-21,-16,
                    -7,0,-43,23,23,-43,-8,-1,-1,-8,-19,35,35,-19,-31,35,35,-31,5,0,
                    0,5,5,0,0,5,0,0,0,0]);
        });
        
        [1,3].forEach(n => {
            const font = fonts[`gvarTest${n}`];
            assert.deepEqual(font.tables.gvar.glyphVariations[0].sharedPoints, []);
        });
        
        [2].forEach(n => {
            const font = fonts[`gvarTest${n}`];
            assert.deepEqual(font.tables.gvar.glyphVariations[0].sharedPoints, [
                0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
                21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
                41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60,
                61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76
            ]);
        });

        [4].forEach(n => {
            const font = fonts[`gvarTest${n}`];
            assert.deepEqual(font.tables.gvar.sharedTuples, [
                [ 1, -0.63201904296875 ], [ 1, -1 ], [ 1, 0 ], [ 0, -0.63201904296875 ], [ 0,-1 ]
            ]);
        });
        
        ['Comp','CompMissing'].forEach(n => {
            const font = fonts[`gvarTest${n}`];
            assert.deepEqual(font.tables.gvar.sharedTuples, [[-1]]);
        });
    });

    it('parses the variation data of a glyph when it is first read, then keeps it', function() {
        // the tuple variation stores of the glyphs of a large variable font (e.g. Roboto Flex) are most of its parse time
        const font = loadSync('./test/fonts/TestGVAROne.ttf');
        const glyphVariations = font.tables.gvar.glyphVariations;
        assert.strictEqual(typeof Object.getOwnPropertyDescriptor(glyphVariations, 0).get, 'function');
        const variationData = glyphVariations[0];
        assert.strictEqual(Object.getOwnPropertyDescriptor(glyphVariations, 0).value, variationData);
        assert.strictEqual(glyphVariations[0], variationData);
        // ttx -t gvar: the two tuples of .notdef, at wght -1.0 and 1.0 (shared tuples), with the deltas x and y of the
        // point 0, the delta x of the point 15 and the delta y of the point 16
        const sharedTuples = font.tables.gvar.sharedTuples;
        assert.deepStrictEqual(variationData.headers.map(header => [
            header.peakTuple || sharedTuples[header.sharedTupleRecordsIndex],
            header.deltas[0], header.deltasY[0], header.deltas[15], header.deltasY[16]
        ]), [[[-1], 0, -1, 1, -1], [[1], -2, 23, -5, 13]]);
    });

    it('correctly transforms TrueType glyphs', function() {
        ['Cvar1','Cvar2'].forEach(n => {
            const font = fonts[`gvarTest${n}`];
            const untransformedPoints = [
                287,-10,179,-10,55,128,55,269,55,409,174,546,290,546,398,546,522,409,522,269,522,128,
                402,-10,289,42,339,42,399,93,425,194,425,269,425,344,398,443,338,493,288,493,238,493,
                178,443,152,344,152,269,152,194,179,93,239,42
            ];
            const transformedPoints = [];
            assert.deepEqual(font.glyphs.get(4).points.map(p => [p.x, p.y]).flat(), untransformedPoints);
        });
    });

    it('correctly transforms composite glyphs', function() {
        ['Comp','CompMissing'].forEach(n => {
            const font = fonts[`gvarTest${n}`];
            const untransformedPathData =
                'M171 500Q135 500 106.50 483.50Q78 467 62 438.50Q46 410 46 373L46 257' +
                'Q46 220 62 191.50Q78 163 106.50 146.50Q135 130 171 130Q208 130 236 146.50' +
                'Q264 163 280 191.50Q296 220 296 257L296 373Q296 410 280 438.50' +
                'Q264 467 236 483.50Q208 500 171 500ZM171 450Q205 450 225.50 429' +
                'Q246 408 246 373L246 257Q246 222 225.50 201Q205 180 171 180Q' +
                '137 180 116.50 201Q96 222 96 257L96 373Q96 408 116.50 429Q137 450 171 450Z' +
                'M246 65Q236 65 228.50 57.50Q221 50 221 40L221 15Q221 4 228.50-3' +
                'Q236-10 246-10Q257-10 264-3Q271 4 271 15L271 40Q271 50 264 57.50' +
                'Q257 65 246 65ZM96 65Q86 65 78.50 57.50Q71 50 71 40L71 15Q71 4 78.50-3' +
                'Q86-10 96-10Q107-10 114-3Q121 4 121 15L121 40Q121 50 114 57.50Q107 65 96 65Z'
            assert.equal(font.glyphs.get(6).toPathData(), untransformedPathData);
            assert.equal(font.glyphs.get(6).toPathData({}, font), untransformedPathData);
            
            const transformedPathData =
                'M146 500Q109 500 82 483Q55 466 43.50 436Q32 406 38 369L57 253' +
                'Q63 216 83 188.50Q103 161 132.50 145.50Q162 130 197 130Q235 130 261.50 147' +
                'Q288 164 300 193.50Q312 223 306 261L286 377Q280 413 260.50 441Q' +
                '241 469 211.50 484.50Q182 500 146 500ZM146 450Q181 450 206.50 428' +
                'Q232 406 238 369L257 253Q262 219 246 199.50Q230 180 197 180Q162 180 137 202' +
                'Q112 224 106 261L86 377Q81 411 97 430.50Q113 450 146 450ZM291 65' +
                'Q280 65 272.50 56Q265 47 267 36L270 12Q271 2 278-4Q285-10 295-10' +
                'Q306-10 313.50-1Q321 8 319 19L315 43Q314 52 307.50 58.50Q301 65 291 65Z' +
                'M141 65Q130 65 122.50 56Q115 47 117 36L120 12Q121 2 128-4Q135-10 145-10' +
                'Q156-10 163.50-1Q171 8 169 19L165 43Q164 52 157.50 58.50Q151 65 141 65Z';
            assert.equal(font.glyphs.get(6).toPathData({variation: {slnt: -9}}, font), transformedPathData);
            font.variation.set({slnt: -9});
            assert.equal(font.glyphs.get(6).toPathData({}, font), transformedPathData);
        });
    });

    it('correctly transforms glyphs with private point list flag and empty point list (all-points tuple)', function() {
        // InterVariable glyphs D and J have gvar tuples where PRIVATE_POINT_NUMBERS flag is set
        // but the packed point list is empty, which means "all glyph points" in the OpenType spec.
        // before the fix, this was treated as "use shared points" which caused wrong deltas to be
        // read and wrong glyph coordinates.
        // reference coordinates verified with fontTools at wght=900.
        const font = fonts.interVariable;

        const testCases = [
            {
                name: 'D',
                expectedPoints: [
                    670, 0, 262, 0, 262, 344, 654, 344, 765, 344, 922, 414, 1004, 589, 1004, 744,
                    1004, 900, 920, 1075, 759, 1146, 642, 1146, 256, 1146, 256, 1490, 664, 1490,
                    894, 1490, 1228, 1311, 1410, 977, 1410, 744, 1410, 512, 1229, 178, 897, 0,
                    500, 1490, 500, 0, 96, 0, 96, 1490
                ],
            },
            {
                name: 'J',
                expectedPoints: [
                    586, -20, 324, -20, 40, 232, 40, 466, 40, 559, 444, 559, 444, 458, 444, 376,
                    518, 294, 586, 294, 654, 294, 726, 376, 726, 460, 726, 1490, 1124, 1490,
                    1124, 468, 1124, 233, 845, -20
                ],
            },
        ];

        font.variation.set({ wght: 900 });

        for (const { name, expectedPoints } of testCases) {
            let glyphIndex = -1;
            for (let i = 0; i < font.glyphs.length; i++) {
                if (font.glyphs.get(i).name === name) { glyphIndex = i; break; }
            }
            const glyph = font.glyphs.get(glyphIndex);
            const transformed = font.variation.getTransform(glyph).points;
            assert.deepEqual(
                transformed.map(p => [Math.round(p.x), Math.round(p.y)]).flat(),
                expectedPoints,
                `glyph ${name} at wght=900`
            );
        }
    });

    it('correctly transforms composite glyphs with all-points tuples (component offset deltas)', function() {
        // the composite glyph "j" (uni0237 + uni0307) has gvar tuples using the all-points
        // encoding (empty point list): for composite glyphs this means one delta per component
        // (+ 4 phantom points), applied to the component dx/dy offsets.
        // before the fix, the deltas were parsed with the resolved outline point count (reading
        // past the tuple data) and never applied to the component offsets, so the dot of the "j"
        // did not move with the weight axis.
        // reference coordinates verified with fontTools at wght=100 and wght=900.
        const font = fonts.geistVariable;

        let glyphIndex = -1;
        for (let i = 0; i < font.glyphs.length; i++) {
            if (font.glyphs.get(i).name === 'j') { glyphIndex = i; break; }
        }
        const glyph = font.glyphs.get(glyphIndex);
        // make sure the glyph is hydrated so isComposite/components are available
        glyph.path;
        assert.equal(glyph.isComposite, true);
        assert.equal(glyph.components.length, 2);

        // one delta per component + 4 phantom points
        const variationData = font.tables.gvar.glyphVariations[glyphIndex];
        assert.deepEqual(variationData.headers[0].deltas, [0, 12, 0, -31, 0, 0]);
        assert.deepEqual(variationData.headers[0].deltasY, [0, 0, 0, 0, 0, 0]);
        assert.deepEqual(variationData.headers[1].deltas, [0, 39, 0, 116, 0, 0]);
        assert.deepEqual(variationData.headers[1].deltasY, [0, 0, 0, 0, 0, 0]);

        const testCases = [
            {
                wght: 900,
                expectedPoints: [
                    -92, -150, -63, -13, -4, -13, 19, -13, 48, -2, 65, 24, 70, 48, 173, 540,
                    368, 540, 263, 44, 247, -31, 187, -115, 88, -150, 13, -150, 181, 594,
                    209, 730, 409, 730, 381, 594
                ],
            },
            {
                wght: 100,
                expectedPoints: [
                    -93, -150, -87, -122, -60, -122, -31, -122, 9, -108, 35, -66, 44, -24,
                    161, 530, 191, 530, 73, -28, 63, -75, 30, -128, -22, -150, -60, -150,
                    180, 628, 194, 698, 228, 698, 214, 628
                ],
            },
        ];

        for (const { wght, expectedPoints } of testCases) {
            font.variation.set({ wght });
            const transformed = font.variation.getTransform(glyph).points;
            assert.deepEqual(
                transformed.map(p => [Math.round(p.x), Math.round(p.y)]).flat(),
                expectedPoints,
                `composite glyph j at wght=${wght}`
            );
        }
    });

    it('interpolates untouched points (IUP) from the default outline when multiple tuples are active', function() {
        const font = loadSync('./test/fonts/Zycon.ttf');
        const coords = { 'T1  ': 1, 'T2  ': 1, 'T3  ': 1, 'T4  ': 1, 'M1  ': 1, 'M2  ': 1 };
        // expected points from fontTools.varLib.instancer at the same location, not rounded:
        // the varied points are within half a unit of them
        const expectedPoints = [
            [1038, 1786], [-727.06, 1318], [985, -900], [1859, 965], [1485, 2674.06], [-806, 1095],
            [1038, 144], [2731.06, 595], [1097, 2810], [217, 965], [595, -727.06], [2842, 815]
        ];
        const points = font.variation.process.getTransform(font.glyphs.get(16), coords).points;
        assert.equal(points.length, expectedPoints.length);
        expectedPoints.forEach(([x, y], index) => {
            assert.ok(Math.abs(points[index].x - x) <= 0.5, `point ${index} x: ${points[index].x} != ${x}`);
            assert.ok(Math.abs(points[index].y - y) <= 0.5, `point ${index} y: ${points[index].y} != ${y}`);
        });
    });

    it('adds up the component offset deltas of all the active tuples of a composite glyph', function() {
        const font = fonts.interVariable;
        // Adieresis (A + uni0308) at opsz 32 and wght 900 has several active tuples;
        // expected points from fontTools.varLib.instancer at the same location
        const expectedPoints = [
            [0, 0], [500, 1490], [1060, 1490], [1565, 0], [1097, 0], [930, 578], [876, 766], [774, 1133],
            [726, 1331], [838, 1331], [788, 1133], [684, 766], [628, 578], [455, 0], [373, 245], [373, 565],
            [1193, 565], [1193, 245], [1017.18, 1566], [929, 1566], [816, 1672.75], [816, 1755.17],
            [816, 1838.18], [929.33, 1944], [1017.23, 1944], [1105.12, 1944], [1218, 1838.49], [1218, 1755.25],
            [1218, 1672], [1105.36, 1566], [548.68, 1566], [460, 1566], [348, 1672.75], [348, 1755.17],
            [348, 1838.18], [460.33, 1944], [548.73, 1944], [637.12, 1944], [750, 1838.49], [750, 1755.25],
            [750, 1672], [637.36, 1566]
        ];
        const glyph = font.glyphs.get(3);
        // isComposite is set when the glyph is parsed
        glyph.path;
        assert.equal(glyph.isComposite, true);
        const points = font.variation.getTransform(glyph, { opsz: 32, wght: 900 }).points;
        assert.equal(points.length, expectedPoints.length);
        // the expected points are not rounded: the deltas of all the tuples are rounded once,
        // in the points of the components and in their offsets, half a unit at most each
        expectedPoints.forEach(([x, y], index) => {
            assert.ok(Math.abs(points[index].x - x) <= 1, `point ${index} x: ${points[index].x} != ${x}`);
            assert.ok(Math.abs(points[index].y - y) <= 1, `point ${index} y: ${points[index].y} != ${y}`);
        });
    });

    it('skips the variation data of a glyph that fails to parse when it is first read, with a warning', function() {
        // TestGVAROne.ttf with the glyphVariationDataArrayOffset of its gvar table (at 16 in the table) set to the
        // length of the file: the variation data of each glyph, read when the glyph is first varied, starts past the
        // end of the file; HarfBuzz reads such data as no variation data (gvar::get_glyph_var_data_bytes)
        const bytes = new Uint8Array(readFileSync('./test/fonts/TestGVAROne.ttf'));
        const view = new DataView(bytes.buffer);
        view.setUint32(view.getUint32(getTableRecordOffset(bytes, 'gvar') + 8) + 16, bytes.length);
        for (const options of [undefined, { lowMemory: true }]) {
            const optionsName = JSON.stringify(options);
            const font = parse(bytes.buffer, options);
            const fontWithoutGvar = parse(removeTables(readFileSync('./test/fonts/TestGVAROne.ttf'), ['gvar']), options);
            assert.deepStrictEqual(font.warnings, [], optionsName);
            const variation = { wght: 700 };
            const path = font.glyphs.get(13).getPath(0, 0, 1000, { variation }, font).toPathData(3);
            assert.strictEqual(path, fontWithoutGvar.glyphs.get(13).getPath(0, 0, 1000, { variation }, fontWithoutGvar).toPathData(3), optionsName);
            assert.deepStrictEqual(font.warnings.map(({ table, message }) => ({ table, message })), [{
                table: 'gvar',
                message: 'The variation data of the glyph 13 is skipped: Start offset 27964 is outside the bounds of the buffer'
            }], optionsName);
            assert.ok(font.warnings[0].error instanceof RangeError, optionsName);
            // the variation data is read once
            font.glyphs.get(13).getPath(0, 0, 1000, { variation }, font);
            assert.strictEqual(font.warnings.length, 1, optionsName);
        }
    });

    it('reads the variation data of a glyph from its bytes only, and does not vary the glyph where a tuple whose data run past them applies, with a warning', function() {
        // TestGVAROne.ttf (one axis, wght 300 400 700, two tuples by glyph: the minimum then the maximum) with the
        // offset of the end of the GlyphVariationData of the glyph 13 (uni9EAF, the last offset of the long offsets at
        // 20 in the table) 10 bytes lower, so that the data of its tuple 1 run past it. HarfBuzz reads the data of a
        // glyph from its bytes only (gvar::get_glyph_var_data_bytes) and the data of a tuple only where it is active
        // (gvar::apply_deltas_to_points): where the tuple 1 is inactive the tuple 0 varies the glyph, where it is active
        // the glyph is not varied:
        // hb-shape --no-glyph-names --show-extents --variations=wght=300 <font> -u 9EAF [13=0+1000<47,801,871,-903>],
        // the same as TestGVAROne.ttf; --variations=wght=700 [13=0+1000<31,809,895,-899>], the extents of the default
        // instance (--variations=wght=400), where TestGVAROne.ttf gives [13=0+1000<39,809,899,-922>]
        const bytes = new Uint8Array(readFileSync('./test/fonts/TestGVAROne.ttf'));
        const view = new DataView(bytes.buffer);
        const gvarOffset = view.getUint32(getTableRecordOffset(bytes, 'gvar') + 8);
        const glyphCount = view.getUint16(gvarOffset + 12);
        assert.strictEqual(view.getUint16(gvarOffset + 14) & 1, 1, 'long offsets');
        const lastOffsetField = gvarOffset + 20 + 4 * glyphCount;
        view.setUint32(lastOffsetField, view.getUint32(lastOffsetField) - 10);
        const font = parse(bytes.buffer);
        // the bounding box of the outline of the glyph 13 at a font size of one em, the y axis going down
        const getExtents = wght => {
            const box = font.glyphs.get(13).getPath(0, 0, font.unitsPerEm, { variation: { wght } }, font).getBoundingBox();
            return [box.x1, -box.y1, box.x2 - box.x1, box.y1 - box.y2].map(Math.round);
        };
        assert.strictEqual(font.unitsPerEm, 1000);
        assert.deepStrictEqual(getExtents(300), [47, 801, 871, -903]);
        assert.deepStrictEqual(font.warnings, []);
        assert.deepStrictEqual(getExtents(700), [31, 809, 895, -899]);
        assert.deepStrictEqual(getExtents(400), [31, 809, 895, -899]);
        assert.deepStrictEqual(font.warnings.map(({ table, message }) => ({ table, message })), [{
            table: 'gvar',
            message: 'The glyph 13 is not varied where its tuple 1 applies: The serialized data of the tuple end past the end of the data'
        }]);
        assert.ok(font.warnings[0].error instanceof RangeError);
    });

    describe('of a glyph with a tuple whose data fail to parse, of a font with two axes', function() {
        // TestGVARBrokenTuple.ttf, generated by test/generate-gvar-broken-tuple-font.py: the glyph 1 (a) has a tuple
        // at wght max with all the points and a tuple at wdth max whose private point numbers run past the end of the
        // variation data of the glyph. HarfBuzz reads the data of a tuple only where it is active, and does not vary the
        // glyph, its outline nor its advance width, where an active tuple fails to read (gvar::apply_deltas_to_points):
        // hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=100 <font> -u 0061 [1=0+550<100,600,300,-600>]
        // hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=200 <font> -u 0061 [1=0+500<100,500,300,-500>]
        const getShapedGlyph = (font, variation) => {
            const box = font.glyphs.get(1).getPath(0, 0, font.unitsPerEm, { variation }, font).getBoundingBox();
            return {
                advance: font.getAdvanceWidth('a', font.unitsPerEm, { variation }),
                extents: [box.x1, -box.y1, box.x2 - box.x1, box.y1 - box.y2].map(Math.round)
            };
        };

        for (const options of [undefined, { lowMemory: true }]) {
            const optionsName = options ? ' with lowMemory' : '';

            it('varies the glyph by its other tuples where the broken tuple is inactive' + optionsName, function() {
                const font = loadSync('./test/fonts/TestGVARBrokenTuple.ttf', options);
                assert.strictEqual(font.unitsPerEm, 1000);
                assert.deepStrictEqual(getShapedGlyph(font, { wght: 900, wdth: 100 }), { advance: 550, extents: [100, 600, 300, -600] });
                assert.deepStrictEqual(font.warnings, []);
            });

            it('does not vary the glyph where the broken tuple is active, with a warning' + optionsName, function() {
                const font = loadSync('./test/fonts/TestGVARBrokenTuple.ttf', options);
                assert.deepStrictEqual(getShapedGlyph(font, { wght: 900, wdth: 200 }), { advance: 500, extents: [100, 500, 300, -500] });
                assert.deepStrictEqual(font.warnings.map(({ table, message }) => ({ table, message })), [{
                    table: 'gvar',
                    message: 'The glyph 1 is not varied where its tuple 1 applies: The serialized data of the tuple end past the end of the data'
                }]);
                assert.ok(font.warnings[0].error instanceof RangeError);
                // the data of the tuple are read once
                assert.deepStrictEqual(getShapedGlyph(font, { wght: 900, wdth: 100 }), { advance: 550, extents: [100, 600, 300, -600] });
                assert.strictEqual(font.warnings.length, 1);
            });
        }

        it('reads a tuple whose shared tuple index is past the shared tuples as inactive, like HarfBuzz', function() {
            // TestGVARBrokenTuple.ttf (no shared tuples) with the tupleIndex of the tuple 1 of the glyph 1 (its header at 38
            // in the table, after the 4 bytes of the GlyphVariationData of the glyph at 26 and the 8 bytes of the header of
            // the tuple 0) set from 0xA000 (an embedded peak, private point numbers) to 0x2005 (private point numbers, the
            // shared tuple 5): HarfBuzz gives the scalar 0 to a tuple whose peak is not a shared tuple
            // (TupleVariationHeader::calculate_scalar), so its data are not read and the tuple 0 still varies the glyph:
            // hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=200 <font> -u 0061 [1=0+550<100,600,300,-600>]
            // hb-shape --no-glyph-names --show-extents --variations=wght=400,wdth=200 <font> -u 0061 [1=0+500<100,500,300,-500>]
            const bytes = new Uint8Array(readFileSync('./test/fonts/TestGVARBrokenTuple.ttf'));
            const view = new DataView(bytes.buffer);
            const gvarOffset = view.getUint32(getTableRecordOffset(bytes, 'gvar') + 8);
            assert.strictEqual(view.getUint16(gvarOffset + 6), 0, 'sharedTupleCount');
            assert.strictEqual(view.getUint16(gvarOffset + 38 + 2), 0xA000);
            view.setUint16(gvarOffset + 38 + 2, 0x2005);
            const font = parse(bytes.buffer);
            assert.deepStrictEqual(getShapedGlyph(font, { wght: 900, wdth: 200 }), { advance: 550, extents: [100, 600, 300, -600] });
            assert.deepStrictEqual(getShapedGlyph(font, { wght: 400, wdth: 200 }), { advance: 500, extents: [100, 500, 300, -500] });
            assert.deepStrictEqual(font.shape('a', { variation: { wght: 900, wdth: 200 } }).map(({ xAdvance }) => xAdvance), [550]);
            assert.deepStrictEqual(font.warnings, []);
        });

        it('keeps the tuples before the first tuple variation header that does not fit in the data, like HarfBuzz', function() {
            // TestGVARBrokenTuple.ttf with the high byte of the tupleVariationCount of the glyph 1 (at 26 in the table)
            // set from 0x80 to 0xFF: a count of 3842 tuples (0xF02) for the 2 headers of the glyph. HarfBuzz reads the
            // headers up to the first one that does not fit in the data of the glyph (tuple_iterator_t), the bytes after
            // the 2 headers read as headers too, and keeps varying the glyph by them (fontTools rejects the font):
            // hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=100 <font> -u 0061 [1=0+550<100,600,300,-600>]
            // hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=50 <font> -u 0061 [1=0+550<100,600,300,-600>]
            // hb-shape --no-glyph-names --show-extents --variations=wght=600,wdth=150 <font> -u 0061 [1=0+500<100,500,300,-500>]
            const bytes = new Uint8Array(readFileSync('./test/fonts/TestGVARBrokenTuple.ttf'));
            const view = new DataView(bytes.buffer);
            const gvarOffset = view.getUint32(getTableRecordOffset(bytes, 'gvar') + 8);
            assert.strictEqual(view.getUint16(gvarOffset + 26), 0x8002);
            bytes[gvarOffset + 26] = 0xFF;
            const font = parse(bytes.buffer);
            assert.deepStrictEqual(getShapedGlyph(font, { wght: 900, wdth: 100 }), { advance: 550, extents: [100, 600, 300, -600] });
            assert.deepStrictEqual(getShapedGlyph(font, { wght: 900, wdth: 50 }), { advance: 550, extents: [100, 600, 300, -600] });
            assert.deepStrictEqual(font.warnings.map(({ table, message }) => ({ table, message })), [{
                table: 'gvar',
                message: 'The tuples of the glyph 1 from its tuple 5 are skipped: Offset is outside the bounds of the DataView'
            }]);
            assert.ok(font.warnings[0].error instanceof RangeError);
            assert.strictEqual(font.tables.gvar.glyphVariations[1].headers.length, 5);
            // where the tuple 1, whose data run past the data of the glyph, is active, the glyph is not varied
            assert.deepStrictEqual(getShapedGlyph(font, { wght: 600, wdth: 150 }), { advance: 500, extents: [100, 500, 300, -500] });
        });

        it('skips the variation data of a glyph whose shared point numbers fail to parse after a header that does not fit, with its warning only', function() {
            // TestGVARBrokenTuple.ttf with the tupleVariationCount of the glyph 1 (at 26 in the table) set to 0x8FFF
            // (shared point numbers, 4095 tuples) and its dataOffset (at 28) to 0xFFF0: a header past the 2 headers of the
            // glyph does not fit, and the shared point numbers at the dataOffset are past the end of the data of the
            // glyph, so its variation data are skipped and the tuples before the header that does not fit are not kept:
            // HarfBuzz does not vary a glyph whose shared point numbers fail to read (gvar::apply_deltas_to_points):
            // hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=100 <font> -u 0061 [1=0+500<100,500,300,-500>]
            const bytes = new Uint8Array(readFileSync('./test/fonts/TestGVARBrokenTuple.ttf'));
            const view = new DataView(bytes.buffer);
            const gvarOffset = view.getUint32(getTableRecordOffset(bytes, 'gvar') + 8);
            assert.strictEqual(view.getUint16(gvarOffset + 26), 0x8002);
            view.setUint16(gvarOffset + 26, 0x8FFF);
            view.setUint16(gvarOffset + 28, 0xFFF0);
            const font = parse(bytes.buffer);
            assert.deepStrictEqual(getShapedGlyph(font, { wght: 900, wdth: 100 }), { advance: 500, extents: [100, 500, 300, -500] });
            assert.deepStrictEqual(font.warnings.map(({ table, message }) => ({ table, message })), [{
                table: 'gvar',
                message: 'The variation data of the glyph 1 is skipped: Offset is outside the bounds of the DataView'
            }]);
            assert.strictEqual(font.tables.gvar.glyphVariations[1], undefined);
        });

        // TestGVARBrokenTuple.ttf with the axisCount of the gvar table (at 4) set from 2, the axes of the fvar table, to
        // another count: HarfBuzz reads the tuples with the axisCount of the gvar table and an axis past the
        // coordinates of the font at 0 (TupleVariationHeader::calculate_scalar)
        const parseFontWithGvarAxisCount = axisCount => {
            const bytes = new Uint8Array(readFileSync('./test/fonts/TestGVARBrokenTuple.ttf'));
            const view = new DataView(bytes.buffer);
            const gvarOffset = view.getUint32(getTableRecordOffset(bytes, 'gvar') + 8);
            assert.strictEqual(view.getUint16(gvarOffset + 4), 2);
            view.setUint16(gvarOffset + 4, axisCount);
            return parse(bytes.buffer);
        };

        it('reads the tuples of a gvar axisCount below the axes of the fvar table, like HarfBuzz', function() {
            // with 1 axis the tuple 0 is the peak wght 1 and the bytes after it read as an inactive tuple:
            // hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=100 <font> -u 0061 [1=0+550<100,600,300,-600>]
            // hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=200 <font> -u 0061 [1=0+550<100,600,300,-600>]
            // hb-shape --no-glyph-names --show-extents --variations=wght=650,wdth=150 <font> -u 0061 [1=0+525<100,550,300,-550>]
            const font = parseFontWithGvarAxisCount(1);
            assert.deepStrictEqual(getShapedGlyph(font, { wght: 900, wdth: 100 }), { advance: 550, extents: [100, 600, 300, -600] });
            assert.deepStrictEqual(getShapedGlyph(font, { wght: 900, wdth: 200 }), { advance: 550, extents: [100, 600, 300, -600] });
            assert.deepStrictEqual(getShapedGlyph(font, { wght: 650, wdth: 150 }), { advance: 525, extents: [100, 550, 300, -550] });
            assert.deepStrictEqual(font.shape('a', { variation: { wght: 900, wdth: 200 } }).map(({ xAdvance }) => xAdvance), [550]);
            assert.deepStrictEqual(font.warnings, []);
        });

        it('reads the tuples of a gvar axisCount above the axes of the fvar table, like HarfBuzz', function() {
            // with 3 axes the peak of the tuple 0 has a third axis that is not 0, past the 2 coordinates of the font, so
            // the tuple is inactive, and so are the bytes after it read as a tuple:
            // hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=100 <font> -u 0061 [1=0+500<100,500,300,-500>]
            // hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=200 <font> -u 0061 [1=0+500<100,500,300,-500>]
            const font = parseFontWithGvarAxisCount(3);
            assert.deepStrictEqual(getShapedGlyph(font, { wght: 900, wdth: 100 }), { advance: 500, extents: [100, 500, 300, -500] });
            assert.deepStrictEqual(getShapedGlyph(font, { wght: 900, wdth: 200 }), { advance: 500, extents: [100, 500, 300, -500] });
            assert.deepStrictEqual(font.warnings, []);
        });
    });

    it('skips the variation data of a glyph whose end offset is below its start offset, with a warning', function() {
        // TestGVAROne.ttf with the offset of the end of the GlyphVariationData of the glyph 13 (the last offset of the
        // long offsets at 20 in the table) set 4 bytes below its start offset: HarfBuzz reads the data of a glyph whose
        // end offset is below its start offset as no variation data (gvar::get_glyph_var_data_bytes), fontTools as no
        // tuple (TTFont(path)['gvar'].variations['uni9EAF'] is []):
        // hb-shape --no-glyph-names --show-extents --variations=wght=300 <font> -u 9EAF [13=0+1000<31,809,895,-899>]
        // hb-shape --no-glyph-names --show-extents --variations=wght=700 <font> -u 9EAF [13=0+1000<31,809,895,-899>]
        const bytes = new Uint8Array(readFileSync('./test/fonts/TestGVAROne.ttf'));
        const view = new DataView(bytes.buffer);
        const gvarOffset = view.getUint32(getTableRecordOffset(bytes, 'gvar') + 8);
        const glyphCount = view.getUint16(gvarOffset + 12);
        assert.strictEqual(glyphCount, 14);
        assert.strictEqual(view.getUint16(gvarOffset + 14) & 1, 1, 'long offsets');
        const lastOffsetField = gvarOffset + 20 + 4 * glyphCount;
        view.setUint32(lastOffsetField, view.getUint32(lastOffsetField - 4) - 4);
        const font = parse(bytes.buffer);
        const getExtents = wght => {
            const box = font.glyphs.get(13).getPath(0, 0, font.unitsPerEm, { variation: { wght } }, font).getBoundingBox();
            return [box.x1, -box.y1, box.x2 - box.x1, box.y1 - box.y2].map(Math.round);
        };
        assert.deepStrictEqual(font.warnings, []);
        assert.deepStrictEqual(getExtents(300), [31, 809, 895, -899]);
        assert.deepStrictEqual(getExtents(700), [31, 809, 895, -899]);
        assert.deepStrictEqual(font.warnings.map(({ table, message }) => ({ table, message })), [{
            table: 'gvar',
            message: 'The variation data of the glyph 13 is skipped: Invalid DataView length -4'
        }]);
        assert.ok(font.warnings[0].error instanceof RangeError);
    });

    describe('of a patched TestGVAROne.ttf', function() {
        // TestGVAROne.ttf (one axis, wght 300 400 700, two shared tuples) with a field of the header of its gvar table
        // set to a value; the extents of the glyph 13 (uni9EAF), the y axis going down, as hb-shape --show-extents
        const parsePatchedFont = (fieldOffset, setField) => {
            const bytes = new Uint8Array(readFileSync('./test/fonts/TestGVAROne.ttf'));
            const view = new DataView(bytes.buffer);
            setField(view, view.getUint32(getTableRecordOffset(bytes, 'gvar') + 8) + fieldOffset);
            return parse(bytes.buffer);
        };
        const getExtents = (font, wght) => {
            const box = font.glyphs.get(13).getPath(0, 0, font.unitsPerEm, { variation: { wght } }, font).getBoundingBox();
            return [box.x1, -box.y1, box.x2 - box.x1, box.y1 - box.y2].map(Math.round);
        };

        it('reads the shared tuples of a sharedTuplesOffset 0 at the start of the table, like HarfBuzz', function() {
            // the sharedTuplesOffset (at 8) set to 0: HarfBuzz reads this offset as not nullable (NNOffset32To), so the
            // two shared tuples are the first 4 bytes of the table, the version 1.0 (peaks 1/16384 and 0): the tuple of
            // the peak 0 applies everywhere, hb-shape --no-glyph-names --show-extents --variations=wght=300 (500, 700)
            // <font> -u 9EAF [13=0+1000<39,809,899,-922>] at the 3 coordinates, where TestGVAROne.ttf gives
            // <47,801,871,-903> at wght 300 and <39,809,899,-922> at wght 700
            const font = parsePatchedFont(8, (view, fieldOffset) => view.setUint32(fieldOffset, 0));
            assert.deepStrictEqual(font.tables.gvar.sharedTuples, [[1 / 16384], [0]]);
            for (const wght of [300, 500, 700]) {
                assert.deepStrictEqual(getExtents(font, wght), [39, 809, 899, -922], String(wght));
                assert.strictEqual(font.getAdvanceWidth('\u9EAF', 1000, { variation: { wght } }), 1000, String(wght));
            }
            assert.deepStrictEqual(font.warnings, []);
            assert.deepStrictEqual(getExtents(fonts.gvarTest1, 300), [47, 801, 871, -903]);
        });

        it('skips a table of another major version, like HarfBuzz', function() {
            // the majorVersion (at 0) set to 2: HarfBuzz does not read the table (gvar::sanitize_shallow), the glyph is
            // not varied, hb-shape --no-glyph-names --show-extents --variations=wght=700 <font> -u 9EAF
            // [13=0+1000<31,809,895,-899>], the extents of the default instance
            const font = parsePatchedFont(0, (view, fieldOffset) => view.setUint16(fieldOffset, 2));
            assert.deepStrictEqual(font.warnings.map(({ table, message }) => ({ table, message })), [{
                table: 'gvar',
                message: 'The table is skipped: Unsupported gvar table version 2.0'
            }]);
            assert.strictEqual(font.tables.gvar, undefined);
            assert.deepStrictEqual(getExtents(font, 700), [31, 809, 895, -899]);
        });
    });
});