import assert from 'assert';
import { readFileSync } from 'fs';
import Font from '../../src/font.mjs';
import { parse } from '../../src/opentype.mjs';
import name from '../../src/tables/name.mjs';
import sfnt from '../../src/tables/sfnt.mjs';
import { encode } from '../../src/types.mjs';
import { readSfntFile, getSpecificationCheckSum } from '../testutil.mjs';

function encodeAndParseTable(table, parser) {
    const bytes = encode.TABLE(table);
    const data = new DataView(new ArrayBuffer(bytes.length), 0);
    for (let k = 0; k < bytes.length; k++) {
        data.setUint8(k, bytes[k]);
    }

    return parser(data, 0);
}

describe('tables/sfnt.mjs', function () {
    let font;
    const defaultFont = {
        familyName: 'MyFont',
        styleName: 'Medium',
        unitsPerEm: 1000,
        ascender: 800,
        descender: 0,
    };

    describe('fontToSfntTable', function () {
        beforeEach(function() {
            font = new Font({...defaultFont});
        });

        it('should create an sfnt table object', ()=>{
            const sfnt_table = sfnt.fontToTable(font);
            assert.ok(sfnt_table);
            assert.equal(sfnt_table.tableName, 'sfnt');
        });

        it('should set default values when no name values are set', ()=>{
            const sfnt_table = sfnt.fontToTable(font);
            const name_table = sfnt_table.tables.find((table)=>table.tableName == 'name');

            assert.ok(name_table);
            
            const parsedNameTable = encodeAndParseTable(name_table, name.parse);

            assert.deepEqual(parsedNameTable, {
                macintosh: {
                    copyright: { en: ' ' },
                    fontFamily: { en: defaultFont.familyName }, // 'MyFont'
                    fontSubfamily: { en: defaultFont.styleName }, // 'Medium'
                    fullName: { en: `${defaultFont.familyName} ${defaultFont.styleName}` }, // 'MyFont Medium'
                    version: { en: 'Version 0.1' },
                    postScriptName: { en: `${defaultFont.familyName}${defaultFont.styleName}` }, // 'MyFontMedium'
                    trademark: { en: ' ' },
                    manufacturer: { en: ' ' },
                    designer: { en: ' ' },
                    description: { en: ' ' },
                    manufacturerURL: { en: ' ' },
                    designerURL: { en: ' ' },
                    license: { en: ' ' },
                    licenseURL: { en: ' ' },
                    preferredFamily: { en: defaultFont.familyName }, // 'MyFont'
                    preferredSubfamily: { en: defaultFont.styleName }, // 'Medium'
                    uniqueID: { en: ` : ${defaultFont.familyName} ${defaultFont.styleName}` },
                },
                windows: {
                    copyright: { en: ' ' },
                    fontFamily: { en: defaultFont.familyName }, // 'MyFont'
                    fontSubfamily: { en: defaultFont.styleName }, // 'Medium'
                    fullName: { en: `${defaultFont.familyName} ${defaultFont.styleName}` }, // 'MyFont Medium'
                    version: { en: 'Version 0.1' },
                    postScriptName: { en: `${defaultFont.familyName}${defaultFont.styleName}` }, // 'MyFontMedium'
                    trademark: { en: ' ' },
                    manufacturer: { en: ' ' },
                    designer: { en: ' ' },
                    description: { en: ' ' },
                    manufacturerURL: { en: ' ' },
                    designerURL: { en: ' ' },
                    license: { en: ' ' },
                    licenseURL: { en: ' ' },
                    preferredFamily: { en: defaultFont.familyName }, // 'MyFont'
                    preferredSubfamily: { en: defaultFont.styleName }, // 'Medium'
                    uniqueID: { en: ` : ${defaultFont.familyName} ${defaultFont.styleName}` },
                }
            });
        });

        it('should set values in the names table with the values of the font object\'s names property', ()=>{
            const fontFamily = 'Original Name';
            const fontSubfamily = 'Bold Italic';
            const fullName = 'Original Name Bold Italic';
            const version = 'Version 24';
            const preferredFamily = 'Custom Name';
            const preferredSubfamily = '700 Italic';

            font.names = {
                macintosh: {
                    fontFamily: { en: fontFamily },
                    fontSubfamily: { en: fontSubfamily},
                    fullName: { en: fullName },
                    version: { en: version },
                    preferredFamily: { en: preferredFamily },
                    preferredSubfamily: { en: preferredSubfamily}
                },
                windows: {
                    fontFamily: { en: fontFamily },
                    fontSubfamily: { en: fontSubfamily},
                    fullName: { en: fullName },
                    version: { en: version },
                    preferredFamily: { en: preferredFamily },
                    preferredSubfamily: { en: preferredSubfamily}
                }
            };

            const sfnt_table = sfnt.fontToTable(font);
            const name_table = sfnt_table.tables.find((table)=>table.tableName == 'name');
            const parsedNameTable = encodeAndParseTable(name_table, name.parse);

            assert.deepEqual(parsedNameTable, {
                macintosh: {
                    fontFamily: { en: fontFamily },
                    fontSubfamily: { en: fontSubfamily},
                    fullName: { en: fullName },
                    version: { en: version },
                    preferredFamily: { en: preferredFamily },
                    preferredSubfamily: { en: preferredSubfamily },
                    postScriptName: { en: `${fontFamily.replaceAll(' ', '')}-${fontSubfamily}` },
                    uniqueID: { en: `: ${fontFamily} ${fontSubfamily}` },
                },
                windows: {
                    fontFamily: { en: fontFamily },
                    fontSubfamily: { en: fontSubfamily},
                    fullName: { en: fullName },
                    version: { en: version },
                    preferredFamily: { en: preferredFamily },
                    preferredSubfamily: { en: preferredSubfamily},
                    postScriptName: { en: `${fontFamily.replaceAll(' ', '')}-${fontSubfamily}` },
                    uniqueID: { en: `: ${fontFamily} ${fontSubfamily}` },
                }
            });
        });

        it('should set preferredSubfamily as value of fontSubfamily, if not explicitly set', ()=>{
            const preferredSubfamily = 'Custom Subfamily';
            font.names = { macintosh: {
                fontFamily: {en: defaultFont.familyName },
                fontSubfamily: { en: preferredSubfamily }
            }};

            const sfnt_table = sfnt.fontToTable(font);
            const name_table = sfnt_table.tables.find((table)=>table.tableName == 'name');
            const parsedNameTable = encodeAndParseTable(name_table, name.parse);

            assert.deepEqual(parsedNameTable.macintosh.preferredSubfamily, { en: preferredSubfamily });
            assert.deepEqual(parsedNameTable.windows.preferredSubfamily, { en: preferredSubfamily });
        });

        it('throws an error for a font without the English postScriptName name, nor the fontFamily and fontSubfamily names', ()=>{
            const message = 'A font without the English postScriptName name, nor the fontFamily and fontSubfamily names to make it from (e.g. a parsed font without a name table), cannot be written.';
            for (const names of [{}, { windows: { fontFamily: { en: 'My Family' } } }, { windows: { fontSubfamily: { en: 'Bold' } } }]) {
                font.names = names;
                assert.throws(() => sfnt.fontToTable(font), { name: 'Error', message }, JSON.stringify(names));
            }
            // with the postScriptName name only, or with both the fontFamily and fontSubfamily names, the font is written
            font.names = { windows: { postScriptName: { en: 'MyFamily-Bold' } } };
            assert.strictEqual(sfnt.fontToTable(font).tableName, 'sfnt');
            font.names = { windows: { fontFamily: { en: 'My Family' }, fontSubfamily: { en: 'Bold' } } };
            const nameTable = sfnt.fontToTable(font).tables.find(table => table.tableName === 'name');
            assert.deepStrictEqual(encodeAndParseTable(nameTable, name.parse).windows.postScriptName, { en: 'MyFamily-Bold' });
        });

        it('writes the hmtx advances of a CFF font, not the widths of its charstrings, once the outlines are read', ()=>{
            // TestCFF1-WidthMismatch.otf: the hmtx advances of A and V differ from the widths of their charstrings
            // python -c "from fontTools.ttLib import TTFont; font = TTFont('TestCFF1-WidthMismatch.otf'); print([font['hmtx'][name][0] for name in font.getGlyphOrder()])"
            // [500, 250, 600, 720, 300, 813, 0]
            const cffFont = parse(readFileSync('./test/fonts/regression/TestCFF1-WidthMismatch.otf'));
            for (let i = 0; i < cffFont.numGlyphs; i++) {
                cffFont.glyphs.get(i).getBoundingBox();
            }
            const sfntTable = sfnt.fontToTable(cffFont);
            const hmtxTable = sfntTable.tables.find(table => table.tableName === 'hmtx');
            const advanceWidths = hmtxTable.fields
                .filter(field => field.name.startsWith('advanceWidth_'))
                .map(field => field.value);
            assert.deepEqual(advanceWidths, [500, 250, 600, 720, 300, 813, 0]);
        });
    });

    describe('makeSfntTable', function () {
        it('writes the binary search fields of fontTools getSearchRange in the table directory of font.toArrayBuffer', function () {
            // [numTables, searchRange, entrySelector, rangeShift] of fontTools 4.63.0 getSearchRange(numTables, 16)
            const cases = [
                [new Font({...defaultFont}), [10, 128, 3, 32]],
                [parse(readFileSync('./test/fonts/TestGDEF-Blocklisted.ttf')), [11, 128, 3, 48]],
            ];
            for (const [sourceFont, expected] of cases) {
                const file = readSfntFile(new Uint8Array(sourceFont.toArrayBuffer()));
                assert.deepStrictEqual([file.numTables, file.searchRange, file.entrySelector, file.rangeShift], expected);
            }
        });

        it('writes the binary search fields of fontTools getSearchRange for an empty table directory', function () {
            // fontTools 4.63.0 getSearchRange(0, 16) is (16, 0, 0)
            const header = encode.TABLE(sfnt.make([]));
            assert.deepStrictEqual(Array.from(header.slice(4, 12)), [0, 0, 0, 16, 0, 0, 0, 0]);
        });
    });

    describe('computeCheckSum', function () {
        it('sums the big-endian uint32 values of the bytes modulo 2^32, the last one zero padded', function () {
            assert.equal(sfnt.computeCheckSum(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05])), 0x06020304);
            assert.equal(sfnt.computeCheckSum(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02])), 1);
        });

        it('keeps every bit of the sum of a table larger than 8 MB', function () {
            // 3 * 2^20 values 0xFFFFFFFF: their sum modulo 2^32 is 2^32 - 3 * 2^20
            const bytes = new Uint8Array(12 * 1024 * 1024).fill(0xFF);
            assert.equal(sfnt.computeCheckSum(bytes), 0xFFD00000);
            assert.equal(sfnt.computeCheckSum(bytes), getSpecificationCheckSum(bytes));
        });
    });

    describe('encodeFile', function () {
        const tagBytes = tag => Array.from(tag, character => character.charCodeAt(0));
        const makeTable = (tag, length, firstByte = 1) => ({
            tag,
            bytes: Uint8Array.from({ length }, (_, index) => (firstByte + index) & 0xFF || 1),
        });

        it('writes the sfnt version, the number of tables and the binary search fields of fontTools getSearchRange', function () {
            // [numTables, searchRange, entrySelector, rangeShift] of fontTools 4.63.0 getSearchRange(numTables, 16)
            const expected = [
                [0, 16, 0, 0], [1, 16, 0, 0], [2, 32, 1, 0], [3, 32, 1, 16], [4, 64, 2, 0], [5, 64, 2, 16],
                [15, 128, 3, 112], [16, 256, 4, 0], [17, 256, 4, 16], [32, 512, 5, 0],
            ];
            for (const [numTables, searchRange, entrySelector, rangeShift] of expected) {
                const tables = Array.from({ length: numTables }, (_, index) => makeTable('t' + String(index).padStart(3, '0'), 4));
                const file = readSfntFile(new Uint8Array(sfnt.encodeFile('OTTO', tables)));
                assert.deepStrictEqual(
                    [file.sfntVersion, file.numTables, file.searchRange, file.entrySelector, file.rangeShift],
                    ['OTTO', numTables, searchRange, entrySelector, rangeShift]
                );
            }
        });

        it('sorts the table records by tag and copies each table 4-byte aligned with zero padding', function () {
            // byte order of the tags: uppercase before lowercase, the space before the letters
            const tables = [makeTable('post', 5), makeTable('OS/2', 3, 7), makeTable('CFF ', 1, 9), makeTable('CFF2', 4, 11), makeTable('cmap', 6, 13)];
            const bytes = new Uint8Array(sfnt.encodeFile(String.fromCharCode(0, 1, 0, 0), tables));
            const file = readSfntFile(bytes);
            assert.equal(file.sfntVersion, String.fromCharCode(0, 1, 0, 0));
            assert.deepStrictEqual(file.records.map(record => record.tag), ['CFF ', 'CFF2', 'OS/2', 'cmap', 'post']);
            assert.deepStrictEqual(file.records.map(record => [record.offset, record.length]), [[92, 1], [96, 4], [100, 3], [104, 6], [112, 5]]);
            assert.equal(bytes.length, 120);
            for (const record of file.records) {
                const table = tables.find(candidate => candidate.tag === record.tag);
                assert.deepStrictEqual(file.tables[record.tag], table.bytes);
                assert.ok(bytes.subarray(record.offset + record.length, (record.offset + record.length + 3) & ~3).every(byte => byte === 0));
                assert.equal(record.checkSum, getSpecificationCheckSum(table.bytes));
            }
            assert.deepStrictEqual(Array.from(bytes.subarray(12, 16)), tagBytes('CFF '));
        });

        it('computes the checksum of the head table with checkSumAdjustment set to 0, then head.checkSumAdjustment', function () {
            const head = makeTable('head', 54, 0x80);
            const headBytes = head.bytes.slice();
            const bytes = new Uint8Array(sfnt.encodeFile('OTTO', [makeTable('name', 7), head, makeTable('cmap', 9, 3)]));
            const file = readSfntFile(bytes);
            const headRecord = file.records.find(record => record.tag === 'head');
            const headWithoutAdjustment = headBytes.slice();
            headWithoutAdjustment.fill(0, 8, 12);
            assert.equal(headRecord.checkSum, getSpecificationCheckSum(headWithoutAdjustment));
            assert.deepStrictEqual([...file.tables.head.subarray(0, 8), ...file.tables.head.subarray(12)], [...headBytes.subarray(0, 8), ...headBytes.subarray(12)]);
            // the checksum of the whole file is 0xB1B0AFBA (OpenType specification, head table)
            assert.equal(getSpecificationCheckSum(bytes), 0xB1B0AFBA);
            assert.deepStrictEqual(head.bytes, headBytes, 'the bytes of the table are not changed');
        });

        it('copies the tables of a file without a head table', function () {
            const tables = [makeTable('name', 7), makeTable('cmap', 9, 3)];
            const file = readSfntFile(new Uint8Array(sfnt.encodeFile('OTTO', tables)));
            assert.deepStrictEqual(file.tables.name, tables[0].bytes);
            assert.deepStrictEqual(file.tables.cmap, tables[1].bytes);
        });

        it('throws an error for two tables with the same tag, and for a head table too short for checkSumAdjustment', function () {
            assert.throws(() => sfnt.encodeFile('OTTO', [makeTable('cmap', 4), makeTable('name', 4), makeTable('cmap', 8)]), /Duplicate table cmap/);
            assert.throws(() => sfnt.encodeFile('OTTO', [makeTable('head', 11)]), /The head table is too short to hold checkSumAdjustment/);
        });
    });
});

