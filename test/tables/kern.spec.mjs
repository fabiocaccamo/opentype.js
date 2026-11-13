import assert from 'assert';
import { Font, Glyph, Path } from '../../src/opentype.mjs';
import kern from '../../src/tables/kern.mjs';
import { itFailsUntilFixed } from '../regression/helpers.mjs';

// The kern tables of these tests have the glyphs A (1), V (2), T (3) and o (4) and the pairs A V and T o.
// The references come from hb-shape on fonts built by fontTools (fontBuilder, a kern table of the same
// subtables, glyphs of 500 units, no GPOS table):
// hb-shape --no-glyph-names --no-clusters <font> -u 41,56,54,6F
const AV = { left: 1, right: 2, value: -50 };
const TO = { left: 3, right: 4, value: -30 };

// the fields of a format 0 subtable after its header: nPairs, searchRange, entrySelector, rangeShift and the pairs
function format0Fields(pairs) {
    const fields = [[2, pairs.length], [2, 0], [2, 0], [2, 0]];
    for (const pair of pairs) {
        fields.push([2, pair.left], [2, pair.right], [-2, pair.value]);
    }
    return fields;
}

// the fields of a format 2 subtable of the OpenType kern table after its header (6 bytes), kerning leftGlyph +
// rightGlyph by value: rowWidth, the offsets of the left and right class tables and of the kerning array from the
// start of the subtable, the class tables (firstGlyph, nGlyphs and the class of the glyph, the offset of its row
// or of its column) and the kerning array of 2 rows of 2 columns
function format2Fields(leftGlyph, rightGlyph, value) {
    return [
        [2, 4], [2, 14], [2, 20], [2, 26],
        [2, leftGlyph], [2, 1], [2, 30],
        [2, rightGlyph], [2, 1], [2, 2],
        [-2, 0], [-2, 0], [-2, 0], [-2, value]
    ];
}

// the size in bytes of fields, each one [size in bytes, value], a negative size for a signed value
function getFieldsSize(fields) {
    return fields.reduce((total, [fieldSize]) => total + Math.abs(fieldSize), 0);
}

// a kern table of the given fields
function createTable(fields) {
    const data = new DataView(new ArrayBuffer(getFieldsSize(fields)));
    let offset = 0;
    for (const [fieldSize, value] of fields) {
        if (fieldSize === 4) {
            data.setUint32(offset, value);
        } else if (fieldSize === 2) {
            data.setUint16(offset, value);
        } else {
            data.setInt16(offset, value);
        }
        offset += Math.abs(fieldSize);
    }
    return data;
}

// an OpenType kern table (version 0) of subtables { version, coverage, pairs, fields, length }: coverage is the
// coverage field with the format in its high byte, fields the fields after the header of a subtable that is not
// in format 0 (pairs otherwise), length the length field when it is not the real one (written modulo 65536)
function createWindowsTable(subtables) {
    const fields = [[2, 0], [2, subtables.length]];
    for (const { version, coverage, pairs, fields: bodyFields, length } of subtables) {
        const body = bodyFields || format0Fields(pairs);
        const subtableLength = length === undefined ? 6 + getFieldsSize(body) : length;
        fields.push([2, version || 0], [2, subtableLength & 0xFFFF], [2, coverage], ...body);
    }
    return createTable(fields);
}

// an Apple kern table (version 1) of subtables { coverage, pairs, fields, length }: coverage is the coverage field
// with the format in its low byte, fields the fields after the header of a subtable that is not in format 0 (pairs
// otherwise), length the length field when it is not the real one
function createMacTable(subtables) {
    const fields = [[4, 0x00010000], [4, subtables.length]];
    for (const { coverage, pairs, fields: bodyFields, length } of subtables) {
        const body = bodyFields || format0Fields(pairs);
        fields.push([4, length === undefined ? 8 + getFieldsSize(body) : length], [2, coverage], [2, 0], ...body);
    }
    return createTable(fields);
}

describe('tables/kern.mjs', function() {
    describe('OpenType kern table (version 0)', function() {
        it('adds up the pairs of all the horizontal subtables', function() {
            // [1+475|2@-25,0+475|3+485|4@-15,0+485]
            const table = createWindowsTable([{ coverage: 0x0001, pairs: [AV] }, { coverage: 0x0001, pairs: [TO] }]);
            assert.deepStrictEqual(kern.parse(table, 0), { '1,2': -50, '3,4': -30 });
        });

        it('adds up the values of a pair in two subtables, also with the override bit, ignoring the minimum bit', function() {
            // coverage 1 then 1, and coverage 1 then 9 (override): [1+465|2@-35,0+465|3+500|4+500]
            const pairAV20 = { left: 1, right: 2, value: -20 };
            for (const overrideCoverage of [0x0001, 0x0009]) {
                const table = createWindowsTable([{ coverage: 0x0001, pairs: [AV] }, { coverage: overrideCoverage, pairs: [pairAV20] }]);
                assert.deepStrictEqual(kern.parse(table, 0), { '1,2': -70 }, 'coverage ' + overrideCoverage);
            }
            // coverage 3 (minimum) then 1: [1+475|2@-25,0+475|3+485|4@-15,0+485]
            const table = createWindowsTable([{ coverage: 0x0003, pairs: [AV] }, { coverage: 0x0001, pairs: [TO] }]);
            assert.deepStrictEqual(kern.parse(table, 0), { '1,2': -50, '3,4': -30 });
        });

        it('keeps one record of a pair listed twice in a subtable, like HarfBuzz', function() {
            // HarfBuzz finds one record of a pair in a subtable (a binary search), the values add up across
            // subtables only. A V -50 twice, then T o: [1+475|2@-25,0+475|3+485|4@-15,0+485]
            const sameValueTable = createWindowsTable([{ coverage: 0x0001, pairs: [AV, AV, TO] }]);
            assert.deepStrictEqual(kern.parse(sameValueTable, 0), { '1,2': -50, '3,4': -30 });
            // A V -50, then A V -20: [1+475|2@-25,0+475|3+500|4+500]
            const pairAV20 = { left: 1, right: 2, value: -20 };
            const twoValuesTable = createWindowsTable([{ coverage: 0x0001, pairs: [AV, pairAV20] }]);
            assert.deepStrictEqual(kern.parse(twoValuesTable, 0), { '1,2': -50 });
        });

        it('skips a format 2 subtable before a format 0 subtable', function() {
            // a format 2 subtable (coverage 0x0201) with A V -80, then T o: [1+460|2@-40,0+460|3+485|4@-15,0+485]
            // (the A V value is the known failure of the format 2 subtables below)
            const table = createWindowsTable([{ coverage: 0x0201, fields: format2Fields(1, 2, -80) }, { coverage: 0x0001, pairs: [TO] }]);
            assert.deepStrictEqual(kern.parse(table, 0), { '3,4': -30 });
        });

        it('skips a vertical and a cross-stream subtable', function() {
            // coverage 0 then 1: [1+500|2+500|3+485|4@-15,0+485]
            const verticalTable = createWindowsTable([{ coverage: 0x0000, pairs: [AV] }, { coverage: 0x0001, pairs: [TO] }]);
            assert.deepStrictEqual(kern.parse(verticalTable, 0), { '3,4': -30 });
            // coverage 5 then 1, the cross-stream pair moves the y offset: [1+500|2@0,-50+500|3@0,-50+485|4@-15,-50+485]
            const crossStreamTable = createWindowsTable([{ coverage: 0x0005, pairs: [AV] }, { coverage: 0x0001, pairs: [TO] }]);
            assert.deepStrictEqual(kern.parse(crossStreamTable, 0), { '3,4': -30 });
        });

        it('reads the pairs of a subtable by their count, not by the length of the subtable', function() {
            // a big subtable has a length over 16 bits, written modulo 65536: the font of the first test with the
            // two pairs in one subtable whose length is patched to 14 (the header only)
            // [1+475|2@-25,0+475|3+485|4@-15,0+485]
            const table = createWindowsTable([{ coverage: 0x0001, pairs: [AV, TO], length: 14 }]);
            assert.deepStrictEqual(kern.parse(table, 0), { '1,2': -50, '3,4': -30 });
        });

        it('gives no pairs when a subtable but the last one is shorter than its pairs, like HarfBuzz', function() {
            // the first subtable has A V and 10921 pairs of T with the glyphs 100 to 11020: its length, 65546,
            // overflows and is written as 10, then T o: [1+500|2+500|3+500|4+500]
            const fillerPairs = Array.from({ length: 10921 }, (element, index) => ({ left: 3, right: 100 + index, value: -10 }));
            const overflowTable = createWindowsTable([{ coverage: 0x0001, pairs: [AV, ...fillerPairs] }, { coverage: 0x0001, pairs: [TO] }]);
            assert.deepStrictEqual(kern.parse(overflowTable, 0), {});
            // the same subtables the other way round, the last length is not checked:
            // [1+475|2@-25,0+475|3+485|4@-15,0+485]
            const lastOverflowTable = createWindowsTable([{ coverage: 0x0001, pairs: [TO] }, { coverage: 0x0001, pairs: [AV, ...fillerPairs] }]);
            assert.equal(Object.keys(kern.parse(lastOverflowTable, 0)).length, 10923);
            // a vertical subtable is checked too, a length of 6 (the header) then T o: [1+500|2+500|3+500|4+500]
            const verticalTable = createWindowsTable([{ coverage: 0x0000, pairs: [AV], length: 6 }, { coverage: 0x0001, pairs: [TO] }]);
            assert.deepStrictEqual(kern.parse(verticalTable, 0), {});
        });

        it('gives no pairs when a subtable is shorter than its header, like HarfBuzz, and reads a last subtable of the length of its header', function() {
            // a length of 0, then A V -20: [1+500|2+500|3+500|4+500]
            const pairAV20 = { left: 1, right: 2, value: -20 };
            const zeroLengthTable = createWindowsTable([{ coverage: 0x0001, pairs: [AV], length: 0 }, { coverage: 0x0001, pairs: [pairAV20] }]);
            assert.deepStrictEqual(kern.parse(zeroLengthTable, 0), {});
            // A V, then T o with a length of 0 or 4: [1+500|2+500|3+500|4+500]
            for (const length of [0, 4]) {
                const table = createWindowsTable([{ coverage: 0x0001, pairs: [AV] }, { coverage: 0x0001, pairs: [TO], length }]);
                assert.deepStrictEqual(kern.parse(table, 0), {}, 'length ' + length);
            }
            // T o, then A V with a length of 6 (the header only), read by its count:
            // [1+475|2@-25,0+475|3+485|4@-15,0+485]
            const headerLengthTable = createWindowsTable([{ coverage: 0x0001, pairs: [TO] }, { coverage: 0x0001, pairs: [AV], length: 6 }]);
            assert.deepStrictEqual(kern.parse(headerLengthTable, 0), { '1,2': -50, '3,4': -30 });
        });

        it('ignores the version of the subtables, like HarfBuzz', function() {
            // versions 1 and 5: [1+475|2@-25,0+475|3+485|4@-15,0+485]
            const table = createWindowsTable([{ version: 1, coverage: 0x0001, pairs: [AV] }, { version: 5, coverage: 0x0001, pairs: [TO] }]);
            assert.deepStrictEqual(kern.parse(table, 0), { '1,2': -50, '3,4': -30 });
        });

        itFailsUntilFixed('reads a format 2 subtable',
            'parseWindowsKernTable (src/tables/kern.mjs): a format 2 subtable (classes) is skipped',
            function() {
                // T o, then a format 2 subtable (coverage 0x0201) with A V -80: [1+460|2@-40,0+460|3+485|4@-15,0+485]
                const table = createWindowsTable([{ coverage: 0x0001, pairs: [TO] }, { coverage: 0x0201, fields: format2Fields(1, 2, -80) }]);
                assert.deepStrictEqual(kern.parse(table, 0), { '1,2': -80, '3,4': -30 });
            });
    });

    describe('Apple kern table (version 1)', function() {
        it('adds up the pairs of all the horizontal subtables', function() {
            // [1+475|2@-25,0+475|3+485|4@-15,0+485]
            const table = createMacTable([{ coverage: 0x0000, pairs: [AV] }, { coverage: 0x0000, pairs: [TO] }]);
            assert.deepStrictEqual(kern.parse(table, 0), { '1,2': -50, '3,4': -30 });
        });

        it('skips a vertical, a cross-stream and a variation subtable', function() {
            // coverage 0x8000 (vertical) or 0x2000 (variation) then 0: [1+500|2+500|3+485|4@-15,0+485]
            // coverage 0x4000 (cross-stream) then 0: [1+500|2@0,-50+500|3@0,-50+485|4@-15,-50+485]
            for (const coverage of [0x8000, 0x4000, 0x2000]) {
                const table = createMacTable([{ coverage, pairs: [AV] }, { coverage: 0x0000, pairs: [TO] }]);
                assert.deepStrictEqual(kern.parse(table, 0), { '3,4': -30 }, 'coverage ' + coverage);
            }
        });

        it('skips a subtable of another format before a format 0 subtable', function() {
            // coverage 0x0002 (format 2) then T o: [1+500|2+500|3+485|4@-15,0+485]
            const table = createMacTable([{ coverage: 0x0002, fields: format2Fields(1, 2, -80) }, { coverage: 0x0000, pairs: [TO] }]);
            assert.deepStrictEqual(kern.parse(table, 0), { '3,4': -30 });
        });

        it('gives no pairs when a subtable but the last one is shorter than its header or its pairs, like HarfBuzz', function() {
            // A V and A V -20 with the length of one pair, then T o; a length of 0, then A V -20:
            // [1+500|2+500|3+500|4+500]
            const pairAV20 = { left: 1, right: 2, value: -20 };
            const shortTable = createMacTable([{ coverage: 0x0000, pairs: [AV, pairAV20], length: 8 + 8 + 6 }, { coverage: 0x0000, pairs: [TO] }]);
            assert.deepStrictEqual(kern.parse(shortTable, 0), {});
            const zeroLengthTable = createMacTable([{ coverage: 0x0000, pairs: [AV], length: 0 }, { coverage: 0x0000, pairs: [pairAV20] }]);
            assert.deepStrictEqual(kern.parse(zeroLengthTable, 0), {});
        });

        it('gives no pairs when the last subtable is shorter than its header, like HarfBuzz', function() {
            // T o, then A V with a length of 6: [1+500|2+500|3+500|4+500]
            const table = createMacTable([{ coverage: 0x0000, pairs: [TO] }, { coverage: 0x0000, pairs: [AV], length: 6 }]);
            assert.deepStrictEqual(kern.parse(table, 0), {});
        });
    });

    describe('the kern table in Font.shape', function() {
        // a font of the glyphs A (1), V (2), T (3) and o (4) of the kern tables above, with the pairs of a kern table;
        // the references come from hb-shape on the fonts of the header, of the subtables of each test
        function createKerningFont(table) {
            const glyphs = ['.notdef', 'A', 'V', 'T', 'o'].map((name, index) => new Glyph({
                index,
                name,
                unicodes: index ? [name.codePointAt(0)] : [],
                advanceWidth: 500,
                path: new Path()
            }));
            const font = new Font({ familyName: 'Kern', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
            font.kerningPairs = kern.parse(table, 0);
            return font;
        }

        it('splits the value of a pair between its two glyphs', function() {
            // the subtables A V -50 and T o -30, both of coverage 1:
            // hb-shape --no-glyph-names --no-clusters <font> -u 41,56,54,6F: [1+475|2@-25,0+475|3+485|4@-15,0+485]
            const font = createKerningFont(createWindowsTable([{ coverage: 0x0001, pairs: [AV] }, { coverage: 0x0001, pairs: [TO] }]));
            const positions = font.shape('AVTo').map(({ xAdvance, xOffset }) => [xAdvance, xOffset]);
            assert.deepStrictEqual(positions, [[475, 0], [475, -25], [485, 0], [485, -15]]);
        });

        itFailsUntilFixed('splits the value of a pair in each subtable on its own, like HarfBuzz',
            'parseWindowsKernTable (src/tables/kern.mjs): the values of a pair in the subtables are added up, and Font.shape ' +
            'splits the sum -30 into -15 and -15, HarfBuzz applies each subtable on its own (hb_kern_machine_t) and splits each -15 ' +
            'into -8 and -7: the same position of V, other advances',
            function() {
                // the subtables A V -15 and A V -15, both of coverage 1:
                // hb-shape --no-glyph-names --no-clusters <font> -u 41,56: [1+484|2@-14,0+486]
                const pairAV15 = { left: 1, right: 2, value: -15 };
                const font = createKerningFont(createWindowsTable([{ coverage: 0x0001, pairs: [pairAV15] }, { coverage: 0x0001, pairs: [pairAV15] }]));
                const positions = font.shape('AV').map(({ xAdvance, xOffset }) => [xAdvance, xOffset]);
                assert.deepStrictEqual(positions, [[484, 0], [486, -14]]);
            });
    });
});
