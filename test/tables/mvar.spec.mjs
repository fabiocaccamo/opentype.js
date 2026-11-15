import assert from 'assert';
import { unhex } from '../testutil.mjs';
import mvar from '../../src/tables/mvar.mjs';
import { VariationProcessor } from '../../src/variationprocessor.mjs';

// a font with one wght axis (100 to 900, 400 by default) and the given mvar table
function createVariationProcessor(mvarTable) {
    return new VariationProcessor({
        tables: {
            fvar: { axes: [{ tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900 }] },
            mvar: mvarTable,
        },
    });
}

describe('tables/mvar.mjs', function() {
    it('can parse the value records of a metrics variations table', function() {
        const data =
            // version 1.0, reserved, valueRecordSize 8, valueRecordCount 2, no item variation store
            '00 01 00 00 00 00 00 08 00 02 00 00 ' +
            // "hcrn" -> outer 0, inner 2
            '68 63 72 6E 00 00 00 02 ' +
            // "xhgt" -> outer 1, inner 0
            '78 68 67 74 00 01 00 00';
        assert.deepStrictEqual(mvar.parse(unhex(data), 0), {
            version: [1, 0],
            itemVariationStore: undefined,
            valueRecords: {
                hcrn: { outerIndex: 0, innerIndex: 2 },
                xhgt: { outerIndex: 1, innerIndex: 0 },
            },
        });
    });

    it('skips the fields of a value record larger than the known ones', function() {
        const data =
            // version 1.0, reserved, valueRecordSize 10, valueRecordCount 2, no item variation store
            '00 01 00 00 00 00 00 0A 00 02 00 00 ' +
            // "hcrs" -> outer 0, inner 3, plus 2 bytes of a future field
            '68 63 72 73 00 00 00 03 FF FF ' +
            // "cpht" -> outer 0, inner 1, plus 2 bytes of a future field
            '63 70 68 74 00 00 00 01 FF FF';
        assert.deepStrictEqual(mvar.parse(unhex(data), 0).valueRecords, {
            hcrs: { outerIndex: 0, innerIndex: 3 },
            cpht: { outerIndex: 0, innerIndex: 1 },
        });
    });

    it('adjusts a metric with the deltas of its item variation store', function() {
        const data =
            // version 1.0, reserved, valueRecordSize 8, valueRecordCount 1, item variation store at 20
            '00 01 00 00 00 00 00 08 00 01 00 14 ' +
            // "xhgt" -> outer 0, inner 0
            '78 68 67 74 00 00 00 00 ' +
            // item variation store: format 1, region list at 12, 1 item variation data at 22
            '00 01 00 00 00 0C 00 01 00 00 00 16 ' +
            // region list: 1 axis, 1 region from 0 to 1 peaking at 1 (the maximum)
            '00 01 00 01 00 00 40 00 40 00 ' +
            // item variation data: 1 item, no word deltas, 1 region (index 0), delta 50
            '00 01 00 00 00 01 00 00 32';
        const processor = createVariationProcessor(mvar.parse(unhex(data), 0));
        assert.equal(processor.getMetricAdjustment('xhgt', { wght: 900 }), 50);
        assert.equal(Math.round(processor.getMetricAdjustment('xhgt', { wght: 650 })), 25);
        assert.equal(Math.round(processor.getMetricAdjustment('xhgt', { wght: 400 })), 0);
        assert.equal(processor.getMetricAdjustment('cpht', { wght: 900 }), 0);
    });

    it('does not adjust the metrics without an item variation store', function() {
        const data =
            // version 1.0, reserved, valueRecordSize 8, valueRecordCount 1, no item variation store
            '00 01 00 00 00 00 00 08 00 01 00 00 ' +
            // "xhgt" -> outer 0, inner 0
            '78 68 67 74 00 00 00 00';
        const processor = createVariationProcessor(mvar.parse(unhex(data), 0));
        assert.equal(processor.getMetricAdjustment('xhgt', { wght: 900 }), 0);
    });

    it('reads an item variation store that fails to parse as a NULL offset, like HarfBuzz (MVAR::sanitize)', function() {
        const data =
            // version 1.0, reserved, valueRecordSize 8, valueRecordCount 1, item variation store at 0x40, past the end of
            // the 20 bytes of the table: HarfBuzz neuters an offset that fails to sanitize
            '00 01 00 00 00 00 00 08 00 01 00 40 ' +
            // "xhgt" -> outer 0, inner 0
            '78 68 67 74 00 00 00 00';
        const partErrors = [];
        const table = mvar.parse(unhex(data), 0, (error, partName) => partErrors.push({ error, partName }));
        assert.deepStrictEqual(table, {
            version: [1, 0],
            itemVariationStore: undefined,
            valueRecords: { xhgt: { outerIndex: 0, innerIndex: 0 } },
        });
        assert.deepStrictEqual(partErrors.map(({ partName }) => partName), ['ItemVariationStore table']);
        assert.ok(partErrors[0].error instanceof RangeError);
        assert.equal(createVariationProcessor(table).getMetricAdjustment('xhgt', { wght: 900 }), 0);
        assert.throws(() => mvar.parse(unhex(data), 0), /^RangeError: Offset is outside the bounds of the DataView$/);
    });

    it('throws an error for value records that run past the end of the table, which HarfBuzz does not read (MVAR::sanitize)', function() {
        // version 1.0, reserved, valueRecordSize 8, valueRecordCount 2, no item variation store, one value record
        const data = '00 01 00 00 00 00 00 08 00 02 00 00 78 68 67 74 00 00 00 00';
        assert.throws(() => mvar.parse(unhex(data), 0, () => assert.fail('no part is skipped')), /^RangeError: Offset is outside the bounds of the DataView$/);
    });

    it('throws an error for a table of another major version, which HarfBuzz does not read (MVAR::sanitize)', function() {
        // version 2.0, reserved, valueRecordSize 8, valueRecordCount 0, no item variation store
        assert.throws(() => mvar.parse(unhex('00 02 00 00 00 00 00 08 00 00 00 00'), 0), /^Error: Unsupported MVAR table version 2.0$/);
    });
});
