import assert from 'assert';
import { unhex, hex } from '../testutil.mjs';
import Glyph from '../../src/glyph.mjs';
import glyphset from '../../src/glyphset.mjs';
import Path from '../../src/path.mjs';
import cff from '../../src/tables/cff.mjs';
import sfnt from '../../src/tables/sfnt.mjs';
import { encode } from '../../src/types.mjs';
import { Font, parse } from '../../src/opentype.mjs';
import { readFileSync } from 'fs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

const loadModes = [{}, { lowMemory: true }];

// the ways of reading the outline of a glyph, each of them parses its charstring
const outlineReaders = [
    glyph => glyph.path,
    (glyph, font) => glyph.getPath(0, 0, 72, undefined, font),
    glyph => glyph.getBoundingBox()
];

// the advance widths of the glyphs of a font once all their outlines are read
function getAdvanceWidthsAfterOutlines(font, readOutline) {
    const glyphs = [];
    for (let i = 0; i < font.numGlyphs; i += 1) {
        glyphs.push(font.glyphs.get(i));
    }
    for (const glyph of glyphs) {
        readOutline(glyph, font);
    }
    return glyphs.map(glyph => glyph.advanceWidth);
}

// the bounds of the outlines of the glyphs of a font like the BoundsPen of fontTools gives
// them: null for a glyph without outline (getBoundingBox gives it a box of zeros)
function getOutlineBounds(font) {
    const bounds = [];
    for (let i = 0; i < font.numGlyphs; i += 1) {
        const glyph = font.glyphs.get(i);
        const boundingBox = glyph.getBoundingBox();
        bounds.push(glyph.path.commands.length === 0 ? null : [boundingBox.x1, boundingBox.y1, boundingBox.x2, boundingBox.y2]);
    }
    return bounds;
}

// the commands of the outline of a square
const squareCommands = [
    { type: 'M', x: 100, y: 0 },
    { type: 'L', x: 400, y: 0 },
    { type: 'L', x: 400, y: 300 },
    { type: 'L', x: 100, y: 300 },
    { type: 'Z' }
];

// a font of a .notdef glyph without outline and a glyph with the outline commands given, with
// the advance widths given
function makeFont(advanceWidths, commands) {
    const path = new Path();
    path.extend(commands);
    return new Font({
        familyName: 'Square',
        styleName: 'Regular',
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
        glyphs: [
            new Glyph({ name: '.notdef', path: new Path(), advanceWidth: advanceWidths[0] }),
            new Glyph({ name: 'square', unicode: 0x25A1, path, advanceWidth: advanceWidths[1] })
        ]
    });
}

// the charstrings of the CFF table that toArrayBuffer writes for a font
function getWrittenCharStrings(font) {
    const cffTable = sfnt.fontToTable(font).tables.find(table => table.tableName === 'CFF ');
    return cffTable.charStringsIndex.charStrings;
}

describe('tables/cff.mjs', function () {
    const data =
        '01 00 04 01 00 01 01 01 03 70 73 00 01 01 01 32 ' +
        'F8 1B 00 F8 1C 02 F8 1C 03 F8 1D 04 1D 00 00 00 ' +
        '55 0F 1D 00 00 00 58 11 8B 1D 00 00 00 80 12 1E ' +
        '0A 12 5F 1E 0F 1E 0F 1E 0A 12 5F 1E 0F 1E 0F 0C ' +
        '07 00 04 01 01 02 04 06 0B 30 66 6E 77 6E 62 75 ' +
        '6D 70 73 00 00 00 01 8A 00 02 01 01 03 23 9B 0E ' +
        '9B 8B 8B 15 8C 8D 8B 8B 8C 89 08 89 8B 15 8C 8D ' +
        '8B 8B 8C 89 08 89 8B 15 8C 8D 8B 8B 8C 89 08 0E';

    it('can make a cff tag table', function () {
        const options = {
            unitsPerEm: 8,
            version: '0',
            fullName: 'fn',
            postScriptName: 'ps',
            familyName: 'fn',
            weightName: 'wn',
            fontBBox: [0, 0, 0, 0],
        };
        const path = new Path();
        path.moveTo(0, 0);
        path.quadraticCurveTo(1, 3, 2, 0);
        path.moveTo(0, 0);
        path.quadraticCurveTo(1, 3, 2, 0);
        path.moveTo(0, 0);
        path.quadraticCurveTo(1, 3, 2, 0);
        const bumpsGlyph = new Glyph({ name: 'bumps', path, advanceWidth: 16 });
        const nodefGlyph = new Glyph({ name: 'nodef', path: new Path(), advanceWidth: 16 });
        const glyphSetFont = { unitsPerEm: 8 };
        const glyphs = new glyphset.GlyphSet(glyphSetFont, [nodefGlyph, bumpsGlyph]);

        assert.deepEqual(data, hex(cff.make(glyphs, options).encode()));
    });

    it('gives no glyph to a CFF table whose CharStrings INDEX is empty', function () {
        // the table above with the count of its CharStrings INDEX set to 0: an empty INDEX is a count of 0 without the
        // other fields (Adobe Technical Note 5176, 5 INDEX Data)
        const font = { tables: {} };
        cff.parse(unhex(data), 0, font, {});
        const emptyCharStringsData = unhex(data);
        emptyCharStringsData.setUint16(font.tables.cff.topDict.charStrings, 0);
        for (const options of loadModes) {
            const emptyFont = { tables: {} };
            cff.parse(emptyCharStringsData, 0, emptyFont, options);
            assert.deepStrictEqual([emptyFont.nGlyphs, emptyFont.glyphs.length], [0, 0], JSON.stringify(options));
        }
    });

    it('gives a CFF font the glyphs of its CharStrings INDEX in both load modes', function () {
        // fontTools: len(CharStrings) is 1113, as maxp.numGlyphs, the last glyph is uniFEFF with an advance of 0
        for (const options of loadModes) {
            const font = loadSync('./test/fonts/SourceSansPro-Regular.otf', options);
            const lastGlyph = font.glyphs.get(font.nGlyphs - 1);
            assert.deepStrictEqual(
                [font.nGlyphs, lastGlyph.name, lastGlyph.advanceWidth], [1113, 'uniFEFF', 0], JSON.stringify(options)
            );
        }
    });

    /**
     * @see https://github.com/opentypejs/opentype.js/issues/524
     */
    it('can fall back to CIDs instead of strings when parsing the charset', function () {
        // the table above with the SID of its glyph bumps in its format 0 charset set to 395, past the 391 standard
        // strings and the 4 strings of its String INDEX: the charset keeps the SID
        const font = { tables: {} };
        cff.parse(unhex(data), 0, font, {});
        const unknownStringData = unhex(data);
        unknownStringData.setUint16(font.tables.cff.topDict.charset + 1, 395);
        for (const options of loadModes) {
            const unknownStringFont = { tables: {} };
            cff.parse(unknownStringData, 0, unknownStringFont, options);
            const charset = unknownStringFont.cffEncoding.charset;
            assert.deepStrictEqual(charset, ['.notdef', 395], JSON.stringify(options));
        }
    });

    it('gives the lowMemory charset of a CFF font the names of its glyphs', function () {
        // fontTools: the charset has the 1151 names of the 1151 glyphs, the last one f_l
        const font = loadSync('./test/fonts/FiraSansOT-Medium.otf', { lowMemory: true });
        const charset = font.cffEncoding.charset;
        assert.deepStrictEqual([charset.length, new Set(charset).size, charset[charset.length - 1]], [1151, 1151, 'f_l']);
        assert.equal(charset.includes(undefined), false);
    });

    it('can parse a CFF2 table', function() {
        const data =
            '01 02 03 04' + // just some dummy padding to test offsets
            // https://learn.microsoft.com/en-us/typography/opentype/spec/cff2#appendix-a-example-cff2-font
            '02 00 05 00 07 CF 0C 24 C3 11 9B 18 00 00 00 00 ' +
            '00 26 00 01 00 00 00 0C 00 01 00 00 00 1C 00 01 ' +
            '00 02 C0 00 E0 00 00 00 C0 00 C0 00 E0 00 00 00 ' +
            '00 00 00 02 00 00 00 01 00 00 00 02 01 01 03 05 ' +
            '20 0A 20 0A 00 00 00 01 01 01 05 F7 06 DA 12 77 ' +
            '9F F8 6C 9D AE 9A F4 9A 95 9F B3 9F 8B 8B 8B 8B ' +
            '85 9A 8B 8B 97 73 8B 8B 8C 80 8B 8B 8B 8D 8B 8B ' +
            '8C 8A 8B 8B 97 17 06 FB 8E 95 86 9D 8B 8B 8D 17 ' +
            '07 77 9F F8 6D 9D AD 9A F3 9A 95 9F B3 9F 08 FB ' +
            '8D 95 09 1E A0 37 5F 0C 09 8B 0C 0B C2 6E 9E 8C ' +
            '17 0A DB 57 F7 02 8C 17 0B B3 9A 77 9F 82 8A 8D ' +
            '17 0C 0C DB 95 57 F7 02 85 8B 8D 17 0C 0D F7 06 ' +
            '13 00 00 00 01 01 01 1B BD BD EF 8C 10 8B 15 F8 ' +
            '88 27 FB 5C 8C 10 06 F8 88 07 FC 88 EF F7 5C 8C ' +
            '10 06';
        const font = {
            encoding: 'cmap_encoding',
            tables: {maxp: {version: 0.5, numGlyphs: 2}}
        };
        const opt = {};
        cff.parse(unhex(data), 4, font, opt);
        const topDict = font.tables.cff2.topDict;
        const fontDict1 = topDict._fdArray[0];
        const variationStore = topDict._vstore;
        const privateDict1 = fontDict1._privateDict;

        assert.notEqual(font.tables.cff2, undefined);

        assert.equal(font.encoding, 'cmap_encoding');
        assert.equal(font.nGlyphs, 2);

        assert.deepEqual(topDict.fontMatrix, [0.001, 0, 0, 0.001, 0, 0]);
        assert.equal(topDict.charStrings, 56);
        assert.equal(topDict.vstore, 16);
        assert.equal(topDict.fdSelect, null);

        assert.deepEqual(privateDict1.blueValues, [-20, 20, 472, 18, 35, 15, 105, 15, 10, 20, 40, 20]);
        assert.deepEqual(privateDict1.otherBlues, [-250, 10]);
        assert.deepEqual(privateDict1.familyBlues, [-20, 20, 473, 18, 34, 15, 104, 15, 10, 20, 40, 20]);
        assert.deepEqual(privateDict1.familyOtherBlues, [ -249, 10 ]);
        assert.equal(privateDict1.blueScale, 0.0375);
        assert.equal(privateDict1.blueShift, 7);
        assert.equal(privateDict1.blueFuzz, 0);
        assert.equal(privateDict1.stdHW, 55);
        assert.equal(privateDict1.stdVW, 80);
        assert.deepEqual(privateDict1.stemSnapH, [40, 15]);
        assert.deepEqual(privateDict1.stemSnapV, [80, 10]);
        assert.equal(privateDict1.languageGroup, 0);
        assert.equal(privateDict1.expansionFactor, 0.06);
        assert.deepEqual(privateDict1.vsindex, 0);
        assert.equal(privateDict1.subrs, 114);

        assert.deepEqual(variationStore, {
            itemVariationStore: {
                format: 1,
                itemVariationSubtables: [
                    { deltaSets: [], regionIndexes: [0, 1] }
                ],
                variationRegions: [
                    {
                        regionAxes: [
                            { startCoord: -1.0, peakCoord: -0.5, endCoord: 0.0 },
                        ]
                    },
                    {
                        regionAxes: [
                            { startCoord: -1.0, peakCoord: -1.0, endCoord: -0.5 }
                        ]
                    }
                ]
            }
        });

        assert.deepEqual(font.glyphs.get(0).path, font.glyphs.get(1).path);
        assert.deepEqual(font.glyphs.get(0).path.commands, [
            { type: 'M', x: 50, y: 0 },
            { type: 'L', x: 550, y: 0 },
            { type: 'L', x: 550, y: 500 },
            { type: 'L', x: 50, y: 500 },
            { type: 'Z' }
        ] );
    });

    it('closes the last contour of CFF2 glyphs, which have no endchar operator', function() {
        const font = loadSync('./test/fonts/TestRVRN-CFF2.otf');
        const glyph = font.glyphs.get(1);
        const countClosedContours = commands => commands.filter(command => command.type === 'Z').length;
        const countContours = commands => commands.filter(command => command.type === 'M').length;
        const defaultCommands = glyph.path.commands;
        assert.ok(countContours(defaultCommands) > 0);
        assert.equal(countClosedContours(defaultCommands), countContours(defaultCommands));
        assert.equal(defaultCommands[defaultCommands.length - 1].type, 'Z');
        const variedCommands = glyph.getPath(0, 0, 1000, { variation: { wght: 900 } }, font).commands;
        assert.equal(countClosedContours(variedCommands), countContours(variedCommands));
        assert.equal(variedCommands[variedCommands.length - 1].type, 'Z');
    });

    it('can handle standard encoding accented characters via endchar', function() {
        const font = loadSync('./test/fonts/AbrilFatface-Regular.otf', { lowMemory: true });
        const glyph13 = font.glyphs.get(13); // the semicolon is combined of comma and period
        const commands = glyph13.path.commands;
        assert.equal(glyph13.isComposite, true);
        assert.equal(commands.length, 15);
        assert.deepEqual(commands[0], { type: 'M', x: 86, y: -156 });
        assert.deepEqual(commands[7], { type: 'C', x: 74, y: -141, x1: 174, y1: -35, x2: 162, y2: -66 });
        assert.deepEqual(commands[9], { type: 'M', x: 36, y: 407 });
        assert.deepEqual(commands[13], { type: 'C', x: 36, y: 407, x1: 66, y1: 495, x2: 36, y2: 456 });
        assert.deepEqual(commands[14], { type: 'Z' });
    });

    it('handles PaintType and StrokeWidth', function() {
        const font = loadSync('./test/fonts/CFF1SingleLinePaintTypeTEST.otf', { lowMemory: true });
        assert.equal(font.tables.cff.topDict.paintType, 2);
        assert.equal(font.tables.cff.topDict.strokeWidth, 50);
        let path;
        const redraw = () => path = font.getPath('10', 0, 0, 12);
        redraw();
        assert.equal(path.commands.filter(c => c.type === 'Z').length, 0);
        assert.equal(path.fill, null);
        assert.equal(path.stroke, 'black');
        assert.equal(path.strokeWidth, 0.6);
        const svg1 = '<path d="M5.44-9.45C4.61-8.12 2.05-9.23 2.05-9.23M4.01-8.80C3.50-3.57 7.36 2.11 5.24-0.27C3.32-2.43 0.34-3.38 0.34-3.38M7.58-2.39L6.47-6.41L10.21-9.33L14.60-7.54L15.25-2.84L11.98-0.60" fill="none" stroke="black" stroke-width="0.6"/>';
        assert.equal(path.toSVG(),svg1);
        font.tables.cff.topDict.paintType = 0;
        // redraw
        redraw();
        path = font.getPath('10', 0, 0, 12);
        assert.equal(path.fill, 'black');
        assert.equal(path.stroke, null);
        assert.equal(path.strokeWidth, 1);
        const svg2 = '<path d="M5.44-9.45C4.61-8.12 2.05-9.23 2.05-9.23M4.01-8.80C3.50-3.57 7.36 2.11 5.24-0.27C3.32-2.43 0.34-3.38 0.34-3.38M7.58-2.39L6.47-6.41L10.21-9.33L14.60-7.54L15.25-2.84L11.98-0.60"/>';
        assert.equal(path.toSVG(), svg2);
    });

    it('should not crash on CFF fonts with recursive subroutine calls', function () {
        // Regression test for CVE: CFF Charstring VM Unbounded Subroutine Recursion (CWE-674)
        // The test font has a local subroutine that calls itself, creating infinite recursion.
        const font = loadSync('./test/fonts/CFFRecursionTest.otf');
        // Accessing the glyph path triggers charstring parsing, which would
        // overflow the call stack without a recursion depth limit.
        assert.doesNotThrow(() => {
            font.glyphs.get(1).path;
        });
    });

    it('can draw glyphs of a static CFF2 font without VariationStore and with an empty Private DICT', function() {
        const font = loadSync('./test/fonts/TestCFF2-Static.otf');
        const topDict = font.tables.cff2.topDict;
        assert.equal(topDict._vstore, undefined);
        assert.equal(topDict._fdArray[0]._privateDict, undefined);
        const commands = font.charToGlyph('A').getPath(0, 0, 1000).commands;
        assert.deepEqual(commands.map(command => [command.type, command.x, command.y]), [
            ['M', 100, 0], ['L', 500, 0], ['L', 500, -700], ['L', 100, -700], ['Z', undefined, undefined]
        ]);
    });

    it('correctly transforms CFF2 variable font glyphs using blend operations', function() {
        const font = loadSync('./test/fonts/TestRVRN-CFF2.otf');
        const untransformedPoints = [
            200,700,200,100,800,100,800,700,250,150,250,650,750,650,750,150,417,254,417,240,579,
            240,579,254,508,254,508,560,495,560,436,541,436,530,493,530,493,254
        ];
        const transformedPoints = [
            200,700,200,100,800,100,800,700,275,175,275,625,725,625,725,175,395,310,395,241,606,
            241,606,310,549,310,549,558,486,558,403,527,403,474,463,474,463,310
        ];
        assert.deepEqual(
            font.glyphs.get(1).path.commands
                .filter(c => c.type !== 'Z')
                .map(c => [c.x, c.y]).flat(),
            untransformedPoints
        );
        assert.deepEqual(
            font.variation.getTransform(1).path.commands
                .filter(c => c.type !== 'Z')
                .map(c => [c.x, c.y])
                .flat(),
            untransformedPoints
        );
        assert.deepEqual(
            font.variation.getTransform(1, {wght: 900, opsz: 10}).path.commands
                .filter(c => c.type !== 'Z')
                .map(c => [c.x, c.y])
                .flat(),
            transformedPoints
        );
        font.variation.set({wght: 900, opsz: 10});
        assert.deepEqual(
            font.variation.getTransform(font.glyphs.get(1)).path.commands
                .filter(c => c.type !== 'Z')
                .map(c => [c.x, c.y])
                .flat(),
            transformedPoints
        );
    });

    it('varies the outline of a CFF2 glyph whose outline was never read, in getTransform and toPathData', function() {
        const hintedVariableFont = './test/fonts/regression/TestCFF2-HintedVariable-subset.otf';
        // the bounds of A at wght 900: hb-shape --glyphs --no-glyph-names --show-extents --variations=wght=900
        // TestCFF2-HintedVariable-subset.otf '[2]' [2=0+680<10,652,655,-652>] (at the default: <5,675,648,-675>)
        const boundingBox = loadSync(hintedVariableFont).variation.getTransform(2, { wght: 900 }).path.getBoundingBox();
        assert.deepStrictEqual([boundingBox.x1, boundingBox.y1, boundingBox.x2, boundingBox.y2], [10, 0, 665, 652]);
        // its first contour: python -c "from fontTools.ttLib import TTFont; from fontTools.pens.recordingPen import
        // RecordingPen; font = TTFont('TestCFF2-HintedVariable-subset.otf'); pen = RecordingPen();
        // font.getGlyphSet(location={'wght': 900})['A'].draw(pen); print(pen.value[:8])"
        // [('moveTo', ((10.0, 0),)), ('lineTo', ((220.0, 0),)), ('lineTo', ((220.0, 59.0),)), ('lineTo', ((131.0, 74.0),)),
        // ('lineTo', ((114.0, 74.0),)), ('lineTo', ((10.0, 59.0),)), ('lineTo', ((10.0, 0.0),)), ('closePath', ())]
        const font = loadSync(hintedVariableFont);
        const pathData = font.glyphs.get(2).toPathData({ variation: { wght: 900 }, decimalPlaces: 0, optimize: false, flipY: false }, font);
        assert.strictEqual(pathData.split('Z')[0], 'M10 0L220 0L220 59L131 74L114 74L10 59L10 0');
    });

    describe('advance widths', function() {
        // TestCFF1-WidthMismatch.otf (test/generate-cff-width-fonts.py --hmtx-mismatch): each glyph gives
        // its charstring width with another operator (rmoveto, endchar, hmoveto, vmoveto, hstem, hstemhm
        // and hintmask, none), and the hmtx advances of A and V differ from those widths
        const widthMismatchFont = './test/fonts/regression/TestCFF1-WidthMismatch.otf';
        // the bounds of its outlines, apart from the width operands:
        // python -c "from fontTools.ttLib import TTFont; from fontTools.pens.boundsPen import BoundsPen; font = TTFont('TestCFF1-WidthMismatch.otf'); glyphSet = font.getGlyphSet(); pens = {name: BoundsPen(glyphSet) for name in font.getGlyphOrder()}; [glyphSet[name].draw(pens[name]) for name in pens]; print([pens[name].bounds for name in pens])"
        // [(100, 0, 400, 700), None, (40, 0, 640, 700), (0, 0, 600, 700), (110, 0, 190, 700), (90, 0, 723, 700), (-200, 600, -100, 750)]
        const widthMismatchBounds = [[100, 0, 400, 700], null, [40, 0, 640, 700], [0, 0, 600, 700], [110, 0, 190, 700], [90, 0, 723, 700], [-200, 600, -100, 750]];
        // TestCFF1-WidthOperators.otf (test/generate-cff-width-operators-font.py): nominalWidthX 100,
        // defaultWidthX 450, the width before rmoveto, hmoveto, a seac endchar (Aacute), pushed by a
        // local subroutine (I), before a global subroutine that holds hmoveto (H), and none before a
        // hintmask with implicit vstems (O), an hmoveto (E) or a vmoveto (T)
        const widthOperatorsFont = './test/fonts/regression/TestCFF1-WidthOperators.otf';
        // TestCFF2-HintedVariable-subset.otf: CFF2 charstrings with hint operators, HVAR
        const hintedVariableFont = './test/fonts/regression/TestCFF2-HintedVariable-subset.otf';

        it('takes the advance of a CFF glyph from hmtx, never from the width of its charstring, once its outline is read (also in lowMemory mode)', function() {
            // python -c "from fontTools.ttLib import TTFont; font = TTFont('TestCFF1-WidthMismatch.otf'); print([font['hmtx'][name][0] for name in font.getGlyphOrder()])"
            // [500, 250, 600, 720, 300, 813, 0]
            // (the widths of the charstrings are [500, 250, 749, 680, 300, 813, 0])
            for (const options of loadModes) {
                for (const readOutline of outlineReaders) {
                    const font = loadSync(widthMismatchFont, options);
                    assert.deepEqual(getAdvanceWidthsAfterOutlines(font, readOutline), [500, 250, 600, 720, 300, 813, 0]);
                }
            }
        });

        it('takes the width off the stack of the first stack-clearing operator of a CFF charstring (also in lowMemory mode)', function() {
            for (const options of loadModes) {
                assert.deepEqual(getOutlineBounds(loadSync(widthMismatchFont, options)), widthMismatchBounds);
            }
        });

        it('takes the width off the stack before a seac endchar and through subroutines, counts the implicit vstems of a first hintmask, and takes no width off a first hmoveto or vmoveto with one operand (also in lowMemory mode)', function() {
            // python -c "from fontTools.ttLib import TTFont; from fontTools.pens.boundsPen import BoundsPen; font = TTFont('TestCFF1-WidthOperators.otf'); glyphSet = font.getGlyphSet(); pens = {name: BoundsPen(glyphSet) for name in font.getGlyphOrder()}; [glyphSet[name].draw(pens[name]) for name in pens]; print([pens[name].bounds for name in pens], [font['hmtx'][name][0] for name in font.getGlyphOrder()])"
            // [(100, 0, 400, 700), (40, 0, 560, 700), (150, 750, 250, 900), (40, 0, 560, 1020), (110, 0, 190, 700), (90, 0, 723, 700), (90, 0, 170, 700), (110, 0, 190, 700), (0, 120, 100, 700)] [500, 600, 450, 600, 300, 813, 450, 450, 450]
            const bounds = [
                [100, 0, 400, 700], [40, 0, 560, 700], [150, 750, 250, 900], [40, 0, 560, 1020], [110, 0, 190, 700],
                [90, 0, 723, 700], [90, 0, 170, 700], [110, 0, 190, 700], [0, 120, 100, 700]
            ];
            for (const options of loadModes) {
                const font = loadSync(widthOperatorsFont, options);
                assert.deepEqual(getOutlineBounds(font), bounds);
                assert.deepEqual(getAdvanceWidthsAfterOutlines(font, outlineReaders[2]), [500, 600, 450, 600, 300, 813, 450, 450, 450]);
            }
        });

        it('counts the stems of a first hint operator without a width before its hintmask (also in lowMemory mode)', function() {
            // FDArrayTest257.otf: the first hint operator of cid00020, cid00025 and cid00050 has an even
            // stack (no width) and a hintmask follows it
            // python -c "from fontTools.ttLib import TTFont; from fontTools.pens.boundsPen import BoundsPen; font = TTFont('FDArrayTest257.otf'); glyphSet = font.getGlyphSet(); pens = {name: BoundsPen(glyphSet) for name in ('cid00020', 'cid00025', 'cid00050')}; [glyphSet[name].draw(pens[name]) for name in pens]; print([pens[name].bounds for name in pens])"
            // [(82, -12, 926, 716), (82, -12, 938, 716), (46, -12, 940, 716)]
            for (const options of loadModes) {
                const font = loadSync('./test/fonts/FDArrayTest257.otf', options);
                const bounds = [20, 25, 50].map(index => {
                    const boundingBox = font.glyphs.get(index).getBoundingBox();
                    return [boundingBox.x1, boundingBox.y1, boundingBox.x2, boundingBox.y2];
                });
                assert.deepEqual(bounds, [[82, -12, 926, 716], [82, -12, 938, 716], [46, -12, 940, 716]]);
            }
        });

        it('keeps the hmtx and HVAR advances of a CFF2 glyph with hint operators once its outline is read (also in lowMemory mode)', function() {
            // python -c "from fontTools.ttLib import TTFont; font = TTFont('TestCFF2-HintedVariable-subset.otf'); print([font['hmtx'][name][0] for name in font.getGlyphOrder()])"
            // [640, 233, 664, 674, 549]
            // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900 TestCFF2-HintedVariable-subset.otf -u 0041
            // [2=0+680]
            // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=200,opsz=60 TestCFF2-HintedVariable-subset.otf -u 006F
            // [4=0+480]
            for (const options of loadModes) {
                for (const readOutline of outlineReaders) {
                    const font = loadSync(hintedVariableFont, options);
                    assert.deepEqual(getAdvanceWidthsAfterOutlines(font, readOutline), [640, 233, 664, 674, 549]);
                }
                const font = loadSync(hintedVariableFont, options);
                assert.equal(font.variation.getTransform(2, { wght: 900 }).advanceWidth, 680);
                assert.equal(font.variation.getTransform(4, { wght: 200, opsz: 60 }).advanceWidth, 480);
                assert.equal(font.glyphs.get(2).advanceWidth, 664);
                assert.equal(font.glyphs.get(4).advanceWidth, 549);
            }
        });

        it('writes the width of a charstring as the difference of its hmtx advance from a nominalWidthX, 0 unless an advance is above 32767', function() {
            // each font written by toArrayBuffer and read with fontTools: the Private DICT, the hmtx
            // advances, the width operands of the charstrings and their widths
            // python -c "from fontTools.ttLib import TTFont; from fontTools.pens.basePen import NullPen; font = TTFont('Square.otf'); top = font['CFF '].cff.topDictIndex[0]; charStrings = top.CharStrings; [charStrings[name].draw(NullPen()) for name in font.getGlyphOrder()]; print(top.Private.rawDict, [font['hmtx'][name][0] for name in font.getGlyphOrder()], [charStrings[name].program[0] for name in font.getGlyphOrder()], [charStrings[name].width for name in font.getGlyphOrder()])"
            // [500, 32767]: {} [500, 32767] [500, 32767] [500, 32767]
            // [500, 32768]: {'nominalWidthX': 1} [500, 32768] [499, 32767] [500, 32768]
            // [0, 65535]: {'nominalWidthX': 32768} [0, 65535] [-32768, 32767] [0, 65535]
            // hmtx holds the integer part of a fractional advance, and so does the charstring:
            // [250.5, 500.75]: {} [250, 500] [250, 500] [250, 500]
            // [500, 32767.5]: {} [500, 32767] [500, 32767] [500, 32767]
            // [500, 40000.5]: {'nominalWidthX': 7233} [500, 40000] [-6733, 32767] [500, 40000]
            // the widest advance on .notdef, the first glyph:
            // [40000, 500]: {'nominalWidthX': 7233} [40000, 500] [32767, -6733] [40000, 500]
            // and the outline of the square:
            // python -c "from fontTools.ttLib import TTFont; from fontTools.pens.recordingPen import RecordingPen; font = TTFont('Square.otf'); pen = RecordingPen(); font.getGlyphSet()['square'].draw(pen); print(pen.value)"
            // [('moveTo', ((100, 0),)), ('lineTo', ((400, 0),)), ('lineTo', ((400, 300),)), ('lineTo', ((100, 300),)), ('closePath', ())]
            const cases = [
                { advanceWidths: [500, 32767], hmtxAdvanceWidths: [500, 32767], nominalWidthX: 0, widthOperands: [500, 32767] },
                { advanceWidths: [500, 32768], hmtxAdvanceWidths: [500, 32768], nominalWidthX: 1, widthOperands: [499, 32767] },
                { advanceWidths: [0, 65535], hmtxAdvanceWidths: [0, 65535], nominalWidthX: 32768, widthOperands: [-32768, 32767] },
                { advanceWidths: [250.5, 500.75], hmtxAdvanceWidths: [250, 500], nominalWidthX: 0, widthOperands: [250, 500] },
                { advanceWidths: [500, 32767.5], hmtxAdvanceWidths: [500, 32767], nominalWidthX: 0, widthOperands: [500, 32767] },
                { advanceWidths: [500, 40000.5], hmtxAdvanceWidths: [500, 40000], nominalWidthX: 7233, widthOperands: [-6733, 32767] },
                { advanceWidths: [40000, 500], hmtxAdvanceWidths: [40000, 500], nominalWidthX: 7233, widthOperands: [32767, -6733] }
            ];
            for (const { advanceWidths, hmtxAdvanceWidths, nominalWidthX, widthOperands } of cases) {
                const sourceFont = makeFont(advanceWidths, squareCommands);
                const charStrings = getWrittenCharStrings(sourceFont);
                assert.deepEqual(charStrings.map(charString => charString.value[0].value), widthOperands);
                const font = parse(sourceFont.toArrayBuffer());
                assert.equal(font.nominalWidthX, nominalWidthX);
                assert.deepEqual(getAdvanceWidthsAfterOutlines(font, outlineReaders[0]), hmtxAdvanceWidths);
                assert.deepEqual(font.glyphs.get(1).path.commands, squareCommands);
            }
        });

        it('writes the coordinate deltas of an outline as charstring integers, from -32768 to 32767', function() {
            // a moveto, a lineto and a curveto whose deltas are 32767, -32768 and -32767, written by
            // toArrayBuffer and read with fontTools:
            // python -c "from fontTools.ttLib import TTFont; from fontTools.pens.recordingPen import RecordingPen; font = TTFont('Square.otf'); print(font['CFF '].cff.topDictIndex[0].CharStrings['square'].bytecode.hex(' ').upper()); pen = RecordingPen(); font.getGlyphSet()['square'].draw(pen); print(pen.value)"
            // F8 88 1C 7F FF 1C 80 00 15 1C 80 00 1C 7F FF 05 1C 7F FF 1C 80 01 1C 80 00 1C 7F FF 1C 7F FF 1C 80 00 08 0E
            // [('moveTo', ((32767, -32768),)), ('lineTo', ((-1, -1),)), ('curveTo', ((32766, -32768), (-2, -1), (32765, -32769))), ('closePath', ())]
            const commands = [
                { type: 'M', x: 32767, y: -32768 },
                { type: 'L', x: -1, y: -1 },
                { type: 'C', x1: 32766, y1: -32768, x2: -2, y2: -1, x: 32765, y: -32769 },
                { type: 'Z' }
            ];
            const sourceFont = makeFont([500, 500], commands);
            const charStrings = getWrittenCharStrings(sourceFont);
            assert.equal(hex(encode.CHARSTRING(charStrings[1].value)),
                'F8 88 1C 7F FF 1C 80 00 15 1C 80 00 1C 7F FF 05 1C 7F FF 1C 80 01 1C 80 00 1C 7F FF 1C 7F FF 1C 80 00 08 0E');
            const font = parse(sourceFont.toArrayBuffer());
            assert.deepEqual(font.glyphs.get(1).path.commands, commands);
        });

        it('throws for a coordinate delta of an outline that a charstring integer cannot hold', function() {
            // a charstring integer is from -32768 to 32767 (Type 2 Charstring Format, 3.2): each outline
            // has one delta of 32768, in another operand
            const origin = { type: 'M', x: 0, y: 0 };
            const outlines = [
                [{ type: 'M', x: 32768, y: 0 }],
                [{ type: 'M', x: 0, y: 32768 }],
                [origin, { type: 'L', x: 32768, y: 0 }],
                [origin, { type: 'L', x: 0, y: 32768 }],
                [origin, { type: 'C', x1: 32768, y1: 0, x2: 32768, y2: 0, x: 32768, y: 0 }],
                [origin, { type: 'C', x1: 0, y1: 32768, x2: 0, y2: 32768, x: 0, y: 32768 }],
                [origin, { type: 'C', x1: 0, y1: 0, x2: 32768, y2: 0, x: 32768, y: 0 }],
                [origin, { type: 'C', x1: 0, y1: 0, x2: 0, y2: 32768, x: 0, y: 32768 }],
                [origin, { type: 'C', x1: 0, y1: 0, x2: 0, y2: 0, x: 32768, y: 0 }],
                [origin, { type: 'C', x1: 0, y1: 0, x2: 0, y2: 0, x: 0, y: 32768 }]
            ];
            for (const commands of outlines) {
                assert.throws(() => makeFont([500, 500], commands).toArrayBuffer(), /Value 32768 is not a charstring integer/, JSON.stringify(commands));
            }
        });

        it('throws for an outline with a coordinate that is not a number', function() {
            const commands = [{ type: 'M', x: NaN, y: 0 }, { type: 'L', x: 200, y: 0 }, { type: 'L', x: 200, y: 10 }, { type: 'Z' }];
            assert.throws(() => makeFont([500, 500], commands).toArrayBuffer(), /Value NaN is not a charstring integer/);
        });

        it('writes a font whose hmtx advances and outlines are the ones of the source, read with fontTools', function() {
            // TestCFF1-WidthMismatch.otf written by toArrayBuffer once its outlines are read, and read with fontTools:
            // python -c "from fontTools.ttLib import TTFont; from fontTools.pens.basePen import NullPen; font = TTFont('Written.otf'); charStrings = font['CFF '].cff.topDictIndex[0].CharStrings; [charStrings[name].draw(NullPen()) for name in font.getGlyphOrder()]; print([font['hmtx'][name][0] for name in font.getGlyphOrder()], [charStrings[name].width for name in font.getGlyphOrder()])"
            // [500, 250, 600, 720, 300, 813, 0] [500, 250, 600, 720, 300, 813, 0]
            // its outlines drawn with a RecordingPen are the ones of the source, so are their bounds
            const font = loadSync(widthMismatchFont);
            getAdvanceWidthsAfterOutlines(font, outlineReaders[2]);
            const writtenFont = parse(font.toArrayBuffer());
            assert.deepEqual(getAdvanceWidthsAfterOutlines(writtenFont, outlineReaders[2]), [500, 250, 600, 720, 300, 813, 0]);
            assert.deepEqual(getOutlineBounds(writtenFont), widthMismatchBounds);
        });
    });
});
