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
});
