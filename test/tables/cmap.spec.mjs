import assert from 'assert';
import { unhex } from '../testutil.mjs';
import { Parser } from '../../src/parse.mjs';
import { parseCmapTableFormat14, parseCmapTableFormat0, makeCmapTable } from '../../src/tables/cmap.mjs';
import cmapTable from '../../src/tables/cmap.mjs';
import { Font, Path, Glyph, parse } from '../../src/opentype.mjs';
import { readFileSync } from 'fs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

describe('tables/cmap.mjs', function() {

    it('can parse a CMAP format 14 table', function() {
        const cmapData =
            '000E 00000045 00000003 ' + // format, length, numVarSelectorRecords
            // varSelector[numVarSelectorRecords]: varSelector, defaultUVSOffset, nonDefaultUVSOffset
            '00FE00 00000000 0000002B' + 
            '0E0100 00000034 00000000' +
            '0E0101 00000000 0000003C' + 
            // varSelector[0] nonDefaultUVS: numUVSMappings
            '00000001 ' +
            // VariationSelector Record: unicodeValue, glyphID
            '002269 0003 ' +
            // varSelector[1] defaultUVS: numUnicodeValueRanges
            '00000001 ' +
            // UnicodeRange Record: startUnicodeValue, additionalCount
            '0082A600 ' +
            // varSelector[2] nonDefaultUVS: numUVSMappings
            '00000001 ' +
            // UnicodeRange Record: startUnicodeValue, additionalCount
            '0082A6 0002';
        const cmap = {};
        const expectedData = {
            '65024': {
                varSelector: 65024,
                nonDefaultUVS: {
                    uvsMappings: {
                        8809: { glyphID: 3, unicodeValue: 8809 }
                    }
                }
            },
            '917760': {
                varSelector: 917760,
                defaultUVS: {
                    ranges: [{ additionalCount: 0, startUnicodeValue: 33446 }]
                }
            },
            '917761': {
                varSelector: 917761,
                nonDefaultUVS: {
                    uvsMappings: {
                        33446: { glyphID: 2, unicodeValue: 33446}
                    }
                }
            }
        };
        const p = new Parser(unhex(cmapData), 0);
        p.skip('uShort'); // skip format
        assert.doesNotThrow(function() { parseCmapTableFormat14(cmap, p); });
        assert.deepEqual(cmap.varSelectorList, expectedData);
    });

    it('can parse CMAP format 0 legacy Mac encoding', function() {
        let font;
        assert.doesNotThrow(function() {
            font = loadSync('./test/fonts/TestCMAPMacTurkish.ttf');
        });
        const testString = '“ABÇĞIİÖŞÜ”abçğıiöşüÄƒ';
        const glyphIds = [];
        const expectedGlyphIds = [200,34,35,126,176,42,178,140,181,145,201,66,67,154,177,222,74,168,182,174,123,184];
        for (let i = 0; i < testString.length; i++) {
            glyphIds.push(font.charToGlyphIndex(testString.charAt(i)));
        }
        assert.deepEqual(glyphIds, expectedGlyphIds);
    });

    it('can parse CMAP table format 13', function() {
        let font;
        assert.doesNotThrow(function() {
            font = loadSync('./test/fonts/TestCMAP13.ttf');
        });
        const testString = 'U\u13EF\u{1203C}\u{1FA00}';
        const glyphIds = font.stringToGlyphIndexes(testString);
        const expectedGlyphIds = [1,2,3,4];
        assert.deepEqual(glyphIds, expectedGlyphIds);
    });

    // Helper: create a mock GlyphSet for makeCmapTable
    function mockGlyphs(glyphDefs) {
        // glyphDefs: array of { unicodes: [number, ...] }
        return {
            length: glyphDefs.length,
            get(i) {
                const def = glyphDefs[i];
                return { ...def, unicode: def.unicodes[0] };
            }
        };
    }

    describe('sub-table selection', function() {
        const hex = (value, bytes) => value.toString(16).padStart(bytes * 2, '0');

        // format 4 sub-table mapping one code point to one glyph
        function format4(code, glyphIndex) {
            return '0004 0020 0000 0004 0004 0001 0000' +  // format, length, language, segCountX2, searchRange, entrySelector, rangeShift
                hex(code, 2) + ' FFFF 0000' +             // endCode, reservedPad
                hex(code, 2) + ' FFFF' +                  // startCode
                hex((glyphIndex - code) & 0xFFFF, 2) + ' 0001' + // idDelta
                '0000 0000';                              // idRangeOffset
        }

        // format 0 sub-table (8-bit Macintosh) mapping one byte to one glyph
        function format0(code, glyphIndex) {
            const glyphIds = new Array(256).fill('00');
            glyphIds[code] = hex(glyphIndex, 1);
            return '0000 0106 0000' + glyphIds.join('');
        }

        // format 12 sub-table mapping one code point to one glyph
        function format12(code, glyphIndex) {
            return '000C 0000 0000001C 00000000 00000001' + hex(code, 4) + hex(code, 4) + hex(glyphIndex, 4);
        }

        // format 6 sub-table (not supported)
        function format6() {
            return '0006 000C 0000 0041 0001 0007';
        }

        function cmapData(records) {
            let offset = 4 + records.length * 8;
            let header = '0000' + hex(records.length, 2);
            let body = '';
            for (const record of records) {
                header += hex(record.platformId, 2) + hex(record.encodingId, 2) + hex(offset, 4);
                const subtable = record.subtable.replace(/ /g, '');
                body += subtable;
                offset += subtable.length / 2;
            }
            return unhex(header + body);
        }

        it('prefers a Unicode sub-table over a Macintosh one listed after it', function() {
            const cmap = cmapTable.parse(cmapData([
                { platformId: 0, encodingId: 3, subtable: format4(0x41, 1) },
                { platformId: 1, encodingId: 0, subtable: format4(0x41, 2) }
            ]), 0);
            assert.equal(cmap.glyphIndexMap[0x41], 1);
        });

        it('prefers a full Unicode repertoire sub-table over a BMP one', function() {
            const cmap = cmapTable.parse(cmapData([
                { platformId: 0, encodingId: 4, subtable: format12(0x1F600, 3) },
                { platformId: 3, encodingId: 1, subtable: format4(0x41, 1) }
            ]), 0);
            assert.equal(cmap.format, 12);
            assert.equal(cmap.glyphIndexMap[0x1F600], 3);
        });

        it('skips a better ranked sub-table of an unsupported format', function() {
            const cmap = cmapTable.parse(cmapData([
                { platformId: 0, encodingId: 3, subtable: format6() },
                { platformId: 1, encodingId: 0, subtable: format0(0x41, 2) }
            ]), 0);
            assert.equal(cmap.format, 0);
            assert.equal(cmap.glyphIndexMap[0x41], 2);
        });

        it('decodes a Macintosh format 0 sub-table with its own platform and encoding', function() {
            // the record before the Macintosh one is an unsupported Windows encoding
            const cmap = cmapTable.parse(cmapData([
                { platformId: 3, encodingId: 2, subtable: format4(0x41, 1) },
                { platformId: 1, encodingId: 0, subtable: format0(0x8E, 5) }
            ]), 0);
            assert.equal(cmap.format, 0);
            // 0x8E is "é" in Mac Roman
            assert.equal(cmap.glyphIndexMap[0xE9], 5);
        });

        it('does not map the upper half of a Macintosh format 0 sub-table as Latin-1 code points', function() {
            // 0xB9 is "π" in Mac Roman, U+00B9 is "¹", which Mac Roman does not have
            const cmap = cmapTable.parse(cmapData([
                { platformId: 1, encodingId: 0, subtable: format0(0xB9, 7) }
            ]), 0);
            assert.equal(cmap.glyphIndexMap[0x03C0], 7);
            assert.equal(cmap.glyphIndexMap[0xB9], undefined);
        });

        it('throws when no sub-table has a supported format', function() {
            assert.throws(() => cmapTable.parse(cmapData([
                { platformId: 0, encodingId: 3, subtable: format6() }
            ]), 0), /found format 6, platformId 0, encodingId 3/);
        });
    });

    describe('makeCmapTable segment merging', function() {
        it('merges contiguous codepoints with same delta into one segment', function() {
            // Glyphs: .notdef (index 0), A=65 (index 1), B=66 (index 2), C=67 (index 3)
            // All have contiguous unicodes and contiguous glyph indices → same delta
            const glyphs = mockGlyphs([
                { unicodes: [] },       // .notdef
                { unicodes: [65] },     // A → glyph 1
                { unicodes: [66] },     // B → glyph 2
                { unicodes: [67] },     // C → glyph 3
            ]);

            const t = makeCmapTable(glyphs);
            // Should be 1 merged segment (65-67) + terminator = 2 segments
            assert.equal(t.segments.length, 2, `Expected 2 segments (1 merged + terminator), got ${t.segments.length}`);
            // Verify the merged segment covers the full range
            assert.equal(t.segments[0].start, 65);
            assert.equal(t.segments[0].end, 67);
        });

        it('does NOT merge non-contiguous codepoints', function() {
            // A=65 (index 1), C=67 (index 2) — gap in codepoints
            const glyphs = mockGlyphs([
                { unicodes: [] },
                { unicodes: [65] },     // A → glyph 1
                { unicodes: [67] },     // C → glyph 2 (skips B=66)
            ]);

            const t = makeCmapTable(glyphs);
            // 2 separate segments + terminator = 3
            assert.equal(t.segments.length, 3);
        });

        it('does NOT merge segments with different deltas', function() {
            // A=65 (index 1), B=66 (index 3) — contiguous codepoints but non-contiguous glyph indices
            const glyphs = mockGlyphs([
                { unicodes: [] },
                { unicodes: [65] },     // A → glyph 1, delta = -(65-1) = -64
                { unicodes: [] },       // glyph 2 (no unicode)
                { unicodes: [66] },     // B → glyph 3, delta = -(66-3) = -63
            ]);

            const t = makeCmapTable(glyphs);
            // Different deltas → 2 separate segments + terminator = 3
            assert.equal(t.segments.length, 3);
        });

        it('merges segments near 0xFFFF as long as end does not reach the BMP terminator', function() {
            // 0xFFFD (index 1) and 0xFFFE (index 2) — contiguous with same delta
            // But merging would make end=0xFFFE which is < 0xFFFF, so it SHOULD merge
            // Only end === 0xFFFF is reserved for the terminator
            const glyphs = mockGlyphs([
                { unicodes: [] },
                { unicodes: [0xFFFD] },     // glyph 1
                { unicodes: [0xFFFE] },     // glyph 2
            ]);

            const t = makeCmapTable(glyphs);
            // Should merge: end=0xFFFE < 0xFFFF → 1 merged segment + terminator = 2
            assert.equal(t.segments.length, 2);
            assert.equal(t.segments[0].start, 0xFFFD);
            assert.equal(t.segments[0].end, 0xFFFE);
        });

        it('handles glyphs with multiple unicodes', function() {
            // Glyph 1 has two unicodes: 65 (A) and 100 (d)
            const glyphs = mockGlyphs([
                { unicodes: [] },
                { unicodes: [65, 100] },
            ]);

            const t = makeCmapTable(glyphs);
            // Two non-contiguous codepoints → 2 segments + terminator = 3
            assert.equal(t.segments.length, 3);
        });

        it('round-trips A-Z through toArrayBuffer and parse', function() {
            const notdefGlyph = new Glyph({
                name: '.notdef',
                advanceWidth: 650,
                path: new Path()
            });
            const glyphs = [notdefGlyph];
            for (let i = 0; i < 26; i++) {
                glyphs.push(new Glyph({
                    name: String.fromCharCode(65 + i),
                    unicode: 65 + i,
                    advanceWidth: 650,
                    path: new Path()
                }));
            }
            const font = new Font({
                familyName: 'TestFont',
                styleName: 'Regular',
                unitsPerEm: 1000,
                ascender: 800,
                descender: -200,
                glyphs: glyphs
            });
            const buffer = font.toArrayBuffer();
            const parsedFont = parse(buffer);

            for (let i = 0; i < 26; i++) {
                const char = String.fromCharCode(65 + i);
                const glyphIndex = parsedFont.charToGlyphIndex(char);
                assert.equal(glyphIndex, i + 1, `charToGlyphIndex('${char}') should be ${i + 1}, got ${glyphIndex}`);
            }
        });

        it('merges contiguous non-BMP segments for Format 12', function() {
            // Three contiguous emoji codepoints: U+1F600, U+1F601, U+1F602
            const glyphs = mockGlyphs([
                { unicodes: [] },
                { unicodes: [0x1F600] },    // glyph 1
                { unicodes: [0x1F601] },    // glyph 2
                { unicodes: [0x1F602] },    // glyph 3
            ]);

            const t = makeCmapTable(glyphs);
            assert.equal(t.numTables, 2); // Format 4 + Format 12
            // Non-BMP: segments above 0xFFFF are not subject to 0xFFFF guard
            // Should merge into 1 segment + terminator = 2
            assert.equal(t.segments.length, 2);
            assert.equal(t.segments[0].start, 0x1F600);
            assert.equal(t.segments[0].end, 0x1F602);
        });
    });
});