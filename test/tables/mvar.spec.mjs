import assert from 'assert';
import { unhex } from '../testutil.mjs';
import mvar from '../../src/tables/mvar.mjs';

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
});
