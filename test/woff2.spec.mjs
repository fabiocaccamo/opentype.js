import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { brotliCompressSync } from 'zlib';
import { parse } from '../src/opentype.mjs';
import { parseWOFF2TableEntries } from '../src/woff2.mjs';

const FONTS_DIR = './test/fonts';
const WOFF2_DIR = FONTS_DIR + '/woff2';

const loadSync = (url, opt) => parse(readFileSync(url), opt);

// the fixtures of generate-woff2-fonts.py and generate-woff2-fonts-google.mjs,
// grouped by source font: { 'Changa-Regular.ttf': ['Changa-Regular.glyf.woff2', ...] }
function getFixtures() {
    const sources = readdirSync(FONTS_DIR).filter(name => /\.(ttf|otf)$/.test(name));
    const fixtures = {};
    for (const name of readdirSync(WOFF2_DIR).sort()) {
        const baseName = name.replace(/\.[a-z]+\.woff2$/, '');
        const source = sources.find(candidate => candidate.replace(/\.(ttf|otf)$/, '') === baseName);
        (fixtures[source] = fixtures[source] || []).push(name);
    }
    return fixtures;
}

// everything opentype.js exposes about a glyph
function getGlyphFingerprint(font, glyphIndex) {
    const glyph = font.glyphs.get(glyphIndex);
    const path = glyph.path; // parses the outline (lazy)
    return {
        name: glyph.name,
        unicodes: glyph.unicodes,
        advanceWidth: glyph.advanceWidth,
        leftSideBearing: glyph.leftSideBearing,
        bbox: [glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax],
        points: glyph.points && glyph.points.map(point => [point.x, point.y, point.onCurve, Boolean(point.lastPointOfContour)]),
        components: glyph.components && JSON.parse(JSON.stringify(glyph.components)),
        instructions: glyph.instructions && Array.from(glyph.instructions),
        pathData: path.toPathData(),
    };
}

// the parsed tables; head without the fields a WOFF2 encoder may change
function getTablesFingerprint(font) {
    const tables = {};
    for (const [tag, table] of Object.entries(font.tables)) {
        tables[tag] = table;
    }
    const head = { ...font.tables.head };
    delete head.checkSumAdjustment;
    head.flags &= ~(1 << 11); // set by the encoders when the glyf table is transformed
    tables.head = head;
    return JSON.parse(JSON.stringify(tables));
}

function assertSameFont(woff2Font, sourceFont) {
    assert.equal(woff2Font.outlinesFormat, sourceFont.outlinesFormat);
    assert.equal(woff2Font.numGlyphs, sourceFont.numGlyphs);
    assert.equal(woff2Font.unitsPerEm, sourceFont.unitsPerEm);
    assert.equal(woff2Font.ascender, sourceFont.ascender);
    assert.equal(woff2Font.descender, sourceFont.descender);
    assert.deepStrictEqual(woff2Font.names, sourceFont.names);
    if (sourceFont.tableTags) { // font.tableTags is not in every version of opentype.js
        // the encoders drop the DSIG table, which a WOFF2 transform would invalidate
        const getTags = font => font.tableTags.filter(tag => tag !== 'DSIG').sort();
        assert.deepStrictEqual(getTags(woff2Font), getTags(sourceFont));
    }
    assert.deepStrictEqual(getTablesFingerprint(woff2Font), getTablesFingerprint(sourceFont));
    for (let glyphIndex = 0; glyphIndex < sourceFont.numGlyphs; glyphIndex += 1) {
        assert.deepStrictEqual(getGlyphFingerprint(woff2Font, glyphIndex), getGlyphFingerprint(sourceFont, glyphIndex), 'glyph ' + glyphIndex);
    }
    // variable fonts: the glyphs at every named instance
    if (sourceFont.tables.fvar) {
        for (const instance of sourceFont.tables.fvar.instances) {
            for (let glyphIndex = 0; glyphIndex < sourceFont.numGlyphs; glyphIndex += 1) {
                const woff2Glyph = woff2Font.variation.getTransform(glyphIndex, instance.coordinates);
                const sourceGlyph = sourceFont.variation.getTransform(glyphIndex, instance.coordinates);
                assert.deepStrictEqual(woff2Glyph.getPath(0, 0, 1000).toPathData(), sourceGlyph.getPath(0, 0, 1000).toPathData(), 'glyph ' + glyphIndex + ' at ' + JSON.stringify(instance.coordinates));
                assert.equal(woff2Glyph.advanceWidth, sourceGlyph.advanceWidth);
            }
        }
    }
}

// test font builders

function concatBytes(arrays) {
    const result = new Uint8Array(arrays.reduce((length, array) => length + array.length, 0));
    let offset = 0;
    for (const array of arrays) {
        result.set(array, offset);
        offset += array.length;
    }
    return result;
}

function uint16(value) {
    return [(value >> 8) & 0xFF, value & 0xFF];
}

function uint32(value) {
    return [(value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF];
}

function base128(value) {
    const bytes = [value & 0x7F];
    for (value >>>= 7; value > 0; value >>>= 7) {
        bytes.unshift(0x80 | (value & 0x7F));
    }
    return bytes;
}

const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep'];

// the tables of a TTF/OTF file: { tag: Uint8Array }
function readSfntTables(path) {
    const bytes = new Uint8Array(readFileSync(path));
    const view = new DataView(bytes.buffer);
    const tables = {};
    for (let i = 0; i < view.getUint16(4); i += 1) {
        const entry = 12 + i * 16;
        const tag = String.fromCharCode(...bytes.subarray(entry, entry + 4));
        const offset = view.getUint32(entry + 8);
        tables[tag] = bytes.slice(offset, offset + view.getUint32(entry + 12));
    }
    return tables;
}

/**
 * Builds a WOFF2 file. Each table: { tag, data, transformVersion = 0, origLength = data.length, arbitraryTag = false },
 * the glyf and loca tables transformed when transformVersion is 0.
 * Options: flavor, directory (raw directory bytes in place of the generated ones), compressed (raw compressed bytes).
 */
function buildWOFF2(tables, options = {}) {
    const directory = options.directory || tables.flatMap(table => {
        const transformVersion = table.transformVersion || 0;
        const knownIndex = KNOWN_TAGS.indexOf(table.tag);
        const tagIndex = knownIndex === -1 || table.arbitraryTag ? 63 : knownIndex;
        const entry = [tagIndex | (transformVersion << 6)];
        if (tagIndex === 63) {
            entry.push(...table.tag.split('').map(character => character.charCodeAt(0)));
        }
        entry.push(...base128(table.origLength === undefined ? table.data.length : table.origLength));
        const glyfOrLoca = table.tag === 'glyf' || table.tag === 'loca';
        if (glyfOrLoca ? transformVersion !== 3 : transformVersion !== 0) {
            entry.push(...base128(table.data.length));
        }
        return entry;
    });
    const compressed = options.compressed || brotliCompressSync(concatBytes(tables.map(table => table.data)));
    const header = [
        ...uint32(0x774F4632), // wOF2
        ...uint32(options.flavor || 0x00010000),
        ...uint32(48 + directory.length + compressed.length),
        ...uint16(tables.length),
        ...uint16(0),
        ...uint32(0), // totalSfntSize
        ...uint32(compressed.length),
        ...uint16(1), ...uint16(0), // version
        ...uint32(0), ...uint32(0), ...uint32(0), // metadata
        ...uint32(0), ...uint32(0), // private data
    ];
    return concatBytes([new Uint8Array(header), new Uint8Array(directory), compressed]);
}

/**
 * Builds a transformed glyf table from its streams (arrays of bytes).
 */
function buildTransformedGlyf({ numGlyphs, indexFormat = 0, optionFlags = 0, nContour, nPoints = [], flags = [], glyph = [], composite = [], bboxBitmap, bbox = [], instruction = [], overlapBitmap = [] }) {
    const bboxStream = [...bboxBitmap, ...bbox];
    const streams = [nContour, nPoints, flags, glyph, composite, bboxStream, instruction];
    return new Uint8Array([
        ...uint16(0), ...uint16(optionFlags), ...uint16(numGlyphs), ...uint16(indexFormat),
        ...streams.flatMap(stream => uint32(stream.length)),
        ...streams.flat(),
        ...overlapBitmap,
    ]);
}

function int16(value) {
    return uint16(value & 0xFFFF);
}

// TestCMAP13.ttf has 5 glyphs: the crafted glyf tables replace its outlines
const CRAFT_SOURCE = FONTS_DIR + '/TestCMAP13.ttf';

function buildCraftedFont(transformedGlyf, options = {}) {
    const sourceTables = readSfntTables(CRAFT_SOURCE);
    const tables = [];
    for (const [tag, data] of Object.entries(sourceTables)) {
        if (tag === 'glyf') {
            tables.push({ tag, data: transformedGlyf, transformVersion: 0, origLength: 0 });
        } else if (tag === 'loca') {
            tables.push({ tag, data: new Uint8Array(0), transformVersion: 0, origLength: 0 });
        } else if (tag === 'hmtx' && options.hmtx) {
            tables.push({ tag, data: options.hmtx, transformVersion: 1, origLength: data.length });
        } else if (tag === 'head' && options.headIndexToLocFormat !== undefined) {
            const head = data.slice();
            new DataView(head.buffer).setInt16(50, options.headIndexToLocFormat);
            tables.push({ tag, data: head });
        } else {
            tables.push({ tag, data });
        }
    }
    return buildWOFF2(tables);
}

// a glyph with its outline parsed (lazy)
function getParsedGlyph(font, glyphIndex) {
    const glyph = font.glyphs.get(glyphIndex);
    assert.ok(glyph.path);
    return glyph;
}

function getPoints(font, glyphIndex) {
    return getParsedGlyph(font, glyphIndex).points.map(point => [point.x, point.y, point.onCurve]);
}

describe('woff2.mjs', function() {
    describe('decodes the fixtures exactly as their source fonts', function() {
        const fixtures = getFixtures();
        for (const [source, woff2Files] of Object.entries(fixtures)) {
            for (const woff2File of woff2Files) {
                it(woff2File, function() {
                    const sourceFont = loadSync(FONTS_DIR + '/' + source);
                    assertSameFont(loadSync(WOFF2_DIR + '/' + woff2File), sourceFont);
                });
            }
        }

        it('covers every transform and both encoders', function() {
            const names = Object.values(fixtures).flat();
            for (const variant of ['glyf', 'hmtx', 'null', 'google', 'fonttools']) {
                assert.ok(names.some(name => name.endsWith('.' + variant + '.woff2')), variant);
            }
        });

        it('also with the lowMemory option', function() {
            const sourceFont = loadSync(FONTS_DIR + '/Changa-Regular.ttf', {lowMemory: true});
            assertSameFont(loadSync(WOFF2_DIR + '/Changa-Regular.hmtx.woff2', {lowMemory: true}), sourceFont);
        });

        it('keeps the OVERLAP_SIMPLE glyphs of the overlapSimpleBitmap', function() {
            // VARTest.glyf.woff2 has the bitmap (option flag 1): the outlines are unchanged
            const sourceFont = loadSync(FONTS_DIR + '/VARTest.ttf');
            const woff2Font = loadSync(WOFF2_DIR + '/VARTest.glyf.woff2');
            assert.equal(woff2Font.outlinesFormat, 'truetype');
            assertSameFont(woff2Font, sourceFont);
        });
    });

    describe('reconstructs the transformed glyf table', function() {
        it('decodes every range of the triplet encoding', function() {
            // [flag, data bytes, dx, dy]: the values of the WOFF2 specification (§ 5.2)
            const triplets = [
                [0, [5], 0, -5],
                [3, [7], 0, 263],
                [11, [9], 9, 0],
                [12, [1], -257, 0],
                [20, [0x35], -4, -6],
                [83, [0xF0], 64, 49],
                [84, [10, 20], -11, -21],
                [119, [3, 4], 516, 517],
                [120, [0x12, 0x34, 0x56], -291, -1110],
                [123, [0xFF, 0xFF, 0xFF], 4095, 4095],
                [124, [0x01, 0x02, 0x03, 0x04], -258, -772],
                [127, [0x00, 0x10, 0x00, 0x20], 16, 32],
            ];
            const expected = [];
            let x = 0;
            let y = 0;
            for (let index = 0; index < triplets.length; index += 1) {
                x += triplets[index][2];
                y += triplets[index][3];
                expected.push([x, y, index % 2 === 0]);
            }
            const font = parse(buildCraftedFont(buildTransformedGlyf({
                numGlyphs: 5,
                nContour: [...int16(0), ...int16(1), ...int16(0), ...int16(0), ...int16(0)],
                nPoints: [triplets.length],
                // odd points off-curve (bit 7)
                flags: triplets.map(([flag], index) => flag | (index % 2 === 0 ? 0 : 0x80)),
                glyph: [...triplets.flatMap(([, data]) => data), 0], // then instructionLength 0
                bboxBitmap: [0, 0, 0, 0],
            })).buffer);
            assert.deepStrictEqual(getPoints(font, 1), expected);
            const glyph = font.glyphs.get(1);
            assert.deepStrictEqual([glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax], [
                Math.min(...expected.map(point => point[0])), Math.min(...expected.map(point => point[1])),
                Math.max(...expected.map(point => point[0])), Math.max(...expected.map(point => point[1])),
            ]);
        });

        it('reads the 255UInt16 values, the explicit bounding boxes and the instructions', function() {
            // glyph 1: 2 contours (1 and 2 points), 300 bytes of instructions (code 253),
            // glyph 2: 1 point, 260 bytes (code 255), glyph 3: 1 point, 507 bytes (code 254)
            const instructions = length => Array.from({length}, (_, index) => index & 0xFF);
            const font = parse(buildCraftedFont(buildTransformedGlyf({
                numGlyphs: 5,
                nContour: [...int16(0), ...int16(2), ...int16(1), ...int16(1), ...int16(0)],
                nPoints: [1, 2, 1, 1],
                flags: [0, 0, 0, 0, 0],
                glyph: [
                    10, 10, 10, 253, ...uint16(300),
                    10, 255, 7,
                    10, 254, 1,
                ],
                bboxBitmap: [0b01000000, 0, 0, 0], // explicit bounding box of glyph 1
                bbox: [...int16(-100), ...int16(-200), ...int16(300), ...int16(400)],
                instruction: [...instructions(300), ...instructions(260), ...instructions(507)],
            })).buffer);
            const glyph1 = getParsedGlyph(font, 1);
            assert.deepStrictEqual(getPoints(font, 1), [[0, -10, true], [0, -20, true], [0, -30, true]]);
            assert.deepStrictEqual(glyph1.points.map(point => Boolean(point.lastPointOfContour)), [true, false, true]);
            assert.deepStrictEqual([glyph1.xMin, glyph1.yMin, glyph1.xMax, glyph1.yMax], [-100, -200, 300, 400]);
            assert.deepStrictEqual(Array.from(glyph1.instructions), instructions(300));
            assert.deepStrictEqual(Array.from(getParsedGlyph(font, 2).instructions), instructions(260));
            assert.deepStrictEqual(Array.from(getParsedGlyph(font, 3).instructions), instructions(507));
        });

        it('copies the composite glyphs and their instructions', function() {
            const component1 = [
                ...uint16(0x0001 | 0x0002 | 0x0008 | 0x0020), // ARG_1_AND_2_ARE_WORDS, ARGS_ARE_XY_VALUES, WE_HAVE_A_SCALE, MORE_COMPONENTS
                ...uint16(1), ...int16(-500), ...int16(600), ...uint16(0x2000), // glyph 1, dx, dy, scale 0.5
            ];
            const component2 = [
                ...uint16(0x0002 | 0x0080 | 0x0100), // ARGS_ARE_XY_VALUES, WE_HAVE_A_TWO_BY_TWO, WE_HAVE_INSTRUCTIONS
                ...uint16(1), 5, 0xFB, ...uint16(0x4000), ...uint16(0), ...uint16(0), ...uint16(0x4000), // glyph 1, dx 5, dy -5, identity
            ];
            const component3 = [
                ...uint16(0x0002 | 0x0040), // ARGS_ARE_XY_VALUES, WE_HAVE_AN_X_AND_Y_SCALE
                ...uint16(1), 1, 2, ...uint16(0x4000), ...uint16(0x2000), // glyph 1, dx 1, dy 2, x scale 1, y scale 0.5
            ];
            const font = parse(buildCraftedFont(buildTransformedGlyf({
                numGlyphs: 5,
                nContour: [...int16(0), ...int16(1), ...int16(-1), ...int16(-1), ...int16(0)],
                nPoints: [2],
                flags: [11, 1], // dx 100 then dy 100
                glyph: [100, 100, 0, 3], // glyph 1 points and instructionLength, then the 3 instructions of glyph 2
                composite: [...component1, ...component2, ...component3],
                bboxBitmap: [0b00110000, 0, 0, 0], // glyphs 2 and 3
                bbox: [...int16(-450), ...int16(550), ...int16(105), ...int16(600), ...int16(1), ...int16(2), ...int16(101), ...int16(52)],
                instruction: [0xB0, 0x01, 0x2B],
            })).buffer);
            const glyph2 = getParsedGlyph(font, 2);
            assert.equal(glyph2.isComposite, true);
            assert.deepStrictEqual(glyph2.components.map(component => [component.glyphIndex, component.dx, component.dy, component.xScale, component.yScale]), [
                [1, -500, 600, 0.5, 0.5],
                [1, 5, -5, 1, 1],
            ]);
            assert.deepStrictEqual(Array.from(glyph2.instructions), [0xB0, 0x01, 0x2B]);
            assert.deepStrictEqual([glyph2.xMin, glyph2.yMin, glyph2.xMax, glyph2.yMax], [-450, 550, 105, 600]);
            const glyph3 = getParsedGlyph(font, 3);
            assert.deepStrictEqual(glyph3.components.map(component => [component.glyphIndex, component.dx, component.dy, component.xScale, component.yScale]), [[1, 1, 2, 1, 0.5]]);
            assert.deepStrictEqual(getPoints(font, 3), [[101, 2, true], [101, 52, true]]);
        });

        it('writes the long loca format and fixes the head table to match it', function() {
            const glyf = buildTransformedGlyf({
                numGlyphs: 5,
                indexFormat: 1,
                nContour: [...int16(0), ...int16(1), ...int16(0), ...int16(1), ...int16(0)],
                nPoints: [1, 1],
                flags: [11, 11],
                glyph: [7, 0, 9, 0],
                bboxBitmap: [0, 0, 0, 0],
            });
            const font = parse(buildCraftedFont(glyf, {headIndexToLocFormat: 0}).buffer);
            assert.equal(font.tables.head.indexToLocFormat, 1);
            assert.deepStrictEqual(getPoints(font, 1), [[7, 0, true]]);
            assert.deepStrictEqual(getPoints(font, 3), [[9, 0, true]]);
        });

        it('reconstructs the left side bearings of the transformed hmtx table', function() {
            const sourceTables = readSfntTables(CRAFT_SOURCE);
            const numberOfHMetrics = new DataView(sourceTables.hhea.buffer).getUint16(34);
            const glyf = buildTransformedGlyf({
                numGlyphs: 5,
                nContour: [...int16(0), ...int16(1), ...int16(1), ...int16(1), ...int16(1)],
                nPoints: [1, 1, 1, 1],
                flags: [11, 12, 11, 12],
                glyph: [30, 0, 40, 0, 50, 0, 60, 0], // x 30, -296 (256 + 40), 50, -316, each with instructionLength 0
                bboxBitmap: [0, 0, 0, 0],
            });
            // flags 3: no left side bearing stored, all from the xMin of the glyphs
            const hmtx = new Uint8Array([3, ...Array.from({length: numberOfHMetrics}, (_, index) => uint16(1000 + index)).flat()]);
            const file = buildCraftedFont(glyf, {hmtx});
            const xMins = [0, 30, -296, 50, -316];
            const expected = [];
            for (let glyphIndex = 0; glyphIndex < 5; glyphIndex += 1) {
                if (glyphIndex < numberOfHMetrics) {
                    expected.push(...uint16(1000 + glyphIndex));
                }
                expected.push(...int16(xMins[glyphIndex]));
            }
            const hmtxEntry = parseWOFF2TableEntries(new DataView(file.buffer)).find(entry => entry.tag === 'hmtx');
            assert.deepStrictEqual(Array.from(new Uint8Array(hmtxEntry.data.buffer)), expected);
            // and through the parser, for the glyphs with their own metrics
            const font = parse(file.buffer);
            for (let glyphIndex = 0; glyphIndex < numberOfHMetrics; glyphIndex += 1) {
                assert.equal(font.glyphs.get(glyphIndex).leftSideBearing, xMins[glyphIndex]);
                assert.equal(font.glyphs.get(glyphIndex).advanceWidth, 1000 + glyphIndex);
            }
        });

        it('reads the left side bearings stored in the transformed hmtx table', function() {
            const sourceTables = readSfntTables(CRAFT_SOURCE);
            const numberOfHMetrics = new DataView(sourceTables.hhea.buffer).getUint16(34);
            const glyf = buildTransformedGlyf({
                numGlyphs: 5,
                nContour: [...int16(0), ...int16(1), ...int16(1), ...int16(1), ...int16(1)],
                nPoints: [1, 1, 1, 1],
                flags: [11, 12, 11, 12],
                glyph: [30, 0, 40, 0, 50, 0, 60, 0],
                bboxBitmap: [0, 0, 0, 0],
            });
            // flags 0: both arrays of left side bearings stored
            const hmtx = new Uint8Array([
                0,
                ...Array.from({length: numberOfHMetrics}, (_, index) => uint16(1000 + index)).flat(),
                ...Array.from({length: numberOfHMetrics}, (_, index) => int16(-7 - index)).flat(),
                ...Array.from({length: 5 - numberOfHMetrics}, (_, index) => int16(70 + index)).flat(),
            ]);
            const expected = [];
            for (let glyphIndex = 0; glyphIndex < 5; glyphIndex += 1) {
                if (glyphIndex < numberOfHMetrics) {
                    expected.push(...uint16(1000 + glyphIndex), ...int16(-7 - glyphIndex));
                } else {
                    expected.push(...int16(70 + glyphIndex - numberOfHMetrics));
                }
            }
            const hmtxEntry = parseWOFF2TableEntries(new DataView(buildCraftedFont(glyf, {hmtx}).buffer)).find(entry => entry.tag === 'hmtx');
            assert.deepStrictEqual(Array.from(new Uint8Array(hmtxEntry.data.buffer)), expected);
        });
    });

    describe('reads the table directory', function() {
        it('reads an arbitrary tag (index 63) and the tables stored as they are', function() {
            const sourceTables = readSfntTables(FONTS_DIR + '/TestCMAP13.ttf');
            const tables = Object.entries(sourceTables).map(([tag, data]) => ({
                tag, data, arbitraryTag: tag === 'name', transformVersion: (tag === 'glyf' || tag === 'loca') ? 3 : 0,
            }));
            assertSameFont(parse(buildWOFF2(tables).buffer), loadSync(FONTS_DIR + '/TestCMAP13.ttf'));
        });
    });

    describe('rejects invalid files with an error', function() {
        const validFile = () => new Uint8Array(readFileSync(WOFF2_DIR + '/Changa-Regular.glyf.woff2'));
        const sourceTables = () => Object.entries(readSfntTables(FONTS_DIR + '/TestCMAP13.ttf')).map(([tag, data]) => ({
            tag, data, transformVersion: (tag === 'glyf' || tag === 'loca') ? 3 : 0,
        }));

        it('truncated files', function() {
            const file = validFile();
            for (const length of [10, 47, 60, 200, file.length - 100]) {
                assert.throws(() => parse(file.slice(0, length).buffer), /WOFF2|Unsupported|offset|bounds/, 'length ' + length);
            }
        });

        it('font collections', function() {
            const file = validFile();
            file.set([0x74, 0x74, 0x63, 0x66], 4); // ttcf
            assert.throws(() => parse(file.buffer), /flavor ttcf/);
        });

        it('a corrupted Brotli stream', function() {
            const tables = sourceTables();
            assert.throws(() => parse(buildWOFF2(tables, {compressed: new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF])}).buffer), /WOFF2/);
        });

        it('a decompressed stream shorter than the tables', function() {
            const tables = sourceTables();
            const compressed = brotliCompressSync(concatBytes(tables.map(table => table.data)).subarray(0, 100));
            assert.throws(() => parse(buildWOFF2(tables, {compressed}).buffer), /WOFF2: unexpected end of the decompressed tables/);
        });

        it('invalid UIntBase128 values', function() {
            const tables = sourceTables().slice(0, 1);
            const cmapIndex = 0;
            assert.throws(() => parse(buildWOFF2(tables, {directory: [cmapIndex, 0x80, 0x01]}).buffer), /leading zeros/);
            assert.throws(() => parse(buildWOFF2(tables, {directory: [cmapIndex, 0x81, 0x81, 0x81, 0x81, 0x81, 0x01]}).buffer), /WOFF2: UIntBase128/);
            assert.throws(() => parse(buildWOFF2(tables, {directory: [cmapIndex, 0x90, 0x80, 0x80, 0x80, 0x00]}).buffer), /overflow/);
        });

        it('unknown or inconsistent transforms', function() {
            const tables = sourceTables();
            const withTransform = (tag, transformVersion) => tables.map(table => table.tag === tag ? {...table, transformVersion} : table);
            assert.throws(() => parse(buildWOFF2(withTransform('cmap', 1)).buffer), /unknown transform 1 of the cmap table/);
            assert.throws(() => parse(buildWOFF2(withTransform('hmtx', 2)).buffer), /unknown transform 2 of the hmtx table/);
            assert.throws(() => parse(buildWOFF2(withTransform('hmtx', 1)).buffer), /transformed hmtx table without a transformed glyf table/);
            assert.throws(() => parse(buildWOFF2(withTransform('loca', 0)).buffer), /same transform/);
            assert.throws(() => parse(buildWOFF2(tables.filter(table => table.tag !== 'loca')).buffer), /glyf and loca tables must be both present/);
        });

        it('invalid transformed glyf tables', function() {
            const glyf = overrides => buildTransformedGlyf({numGlyphs: 5, nContour: [...int16(0), ...int16(0), ...int16(0), ...int16(0), ...int16(0)], bboxBitmap: [0, 0, 0, 0], ...overrides});
            assert.throws(() => parse(buildCraftedFont(glyf({nContour: [...int16(0), ...int16(-1), ...int16(0), ...int16(0), ...int16(0)], composite: [0, 0, 0, 1, 0, 0]})).buffer), /composite glyph 1 without a bounding box/);
            assert.throws(() => parse(buildCraftedFont(glyf({bboxBitmap: [0b10000000, 0, 0, 0], bbox: [0, 0, 0, 0, 0, 0, 0, 0]})).buffer), /empty glyph 0 with a bounding box/);
            assert.throws(() => parse(buildCraftedFont(glyf({nContour: [...int16(0), ...int16(-2), ...int16(0), ...int16(0), ...int16(0)]})).buffer), /invalid number of contours -2/);
            assert.throws(() => parse(buildCraftedFont(glyf({indexFormat: 2})).buffer), /unknown loca index format 2/);
            assert.throws(() => parse(buildCraftedFont(glyf({nContour: [...int16(0), ...int16(0)]})).buffer), /unexpected end of the nContour stream/);
            assert.throws(() => parse(buildCraftedFont(glyf({nContour: [...int16(0), ...int16(1), ...int16(0), ...int16(0), ...int16(0)], nPoints: [2], flags: [0]})).buffer), /unexpected end of the flag stream/);
        });
    });
});
