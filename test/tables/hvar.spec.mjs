import assert from 'assert';
import { unhex } from '../testutil.mjs';
import hvar from '../../src/tables/hvar.mjs';
import { VariationProcessor } from '../../src/variationprocessor.mjs';

describe('tables/hvar.mjs', function() {
    it('throws an error for a table of another major version, which HarfBuzz does not read (HVARVVAR::sanitize)', function() {
        // version 0.0, then the item variation store and the advance width, lsb and rsb mapping offsets, all NULL
        assert.throws(() => hvar.parse(unhex('00 00 00 00 00000000 00000000 00000000 00000000'), 0), /^Error: Unsupported HVAR table version 0.0$/);
    });

    it('parses a NULL item variation store offset, which varies no advance width nor side bearing, like HarfBuzz', function() {
        // version 1.0, then the item variation store and the advance width, lsb and rsb mapping offsets, all NULL:
        // HarfBuzz reads a NULL ItemVariationStore as an empty one, which gives no delta
        const table = hvar.parse(unhex('00 01 00 00 00000000 00000000 00000000 00000000'), 0);
        assert.deepStrictEqual(table, {
            version: [1, 0],
            itemVariationStore: undefined,
            advanceWidth: undefined,
            lsb: undefined,
            rsb: undefined
        });
        const processor = new VariationProcessor({
            tables: {
                fvar: { axes: [{ tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900 }] },
                hvar: table
            }
        });
        assert.strictEqual(processor.getVariableAdjustment(1, 'hvar', 'advanceWidth', { wght: 900 }), 0);
    });

    it('reads a part that fails to parse as a NULL offset, like HarfBuzz (HVARVVAR::sanitize)', function() {
        // version 1.0, then the item variation store at 0x40 and the advance width mapping at 0x30, past the end of the
        // 20 bytes of the table, and NULL lsb and rsb mappings: HarfBuzz neuters an offset that fails to sanitize
        const data = unhex('00 01 00 00 00000040 00000030 00000000 00000000');
        const partErrors = [];
        const table = hvar.parse(data, 0, (error, partName) => partErrors.push({ error, partName }));
        assert.deepStrictEqual(table, {
            version: [1, 0],
            itemVariationStore: undefined,
            advanceWidth: undefined,
            lsb: undefined,
            rsb: undefined
        });
        assert.deepStrictEqual(partErrors.map(({ partName }) => partName), ['ItemVariationStore table', 'advance width DeltaSetIndexMap table']);
        assert.ok(partErrors.every(({ error }) => error instanceof RangeError));
        assert.throws(() => hvar.parse(data, 0), /^RangeError: Offset is outside the bounds of the DataView$/);
    });
});
