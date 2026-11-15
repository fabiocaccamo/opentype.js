// The `MVAR` table stores variation data for the font-wide metrics of other
// tables (e.g. the caret slope of hhea, the x-height of OS/2), by value tag.
// https://learn.microsoft.com/en-us/typography/opentype/spec/mvar

import check from '../check.mjs';
import { Parser, createSkippablePartParser, throwError } from '../parse.mjs';

/**
 * Parse an MVAR table. Like HarfBuzz (MVAR::sanitize) neuters the offset of an ItemVariationStore table that fails to
 * sanitize, an ItemVariationStore table that fails to parse is read as a NULL offset, which varies no metric; a header
 * or value records that fail to parse, or a major version other than 1, throw an error.
 * https://learn.microsoft.com/en-us/typography/opentype/spec/mvar
 * @param {DataView} data
 * @param {number} start - the offset of the table in the data
 * @param {function(Error, string)} [onPartError] - called with the error and the name of the part that fails to parse,
 * 'ItemVariationStore table'; the error is thrown if omitted
 * @returns {Object}
 */
function parseMvarTable(data, start, onPartError = throwError) {
    const p = new Parser(data, start);
    const tableVersionMajor = p.parseUShort();
    const tableVersionMinor = p.parseUShort();

    // like HarfBuzz, a table of another major version is not read (MVAR::sanitize)
    check.argument(tableVersionMajor === 1, `Unsupported MVAR table version ${tableVersionMajor}.${tableVersionMinor}`);

    const version = [
        tableVersionMajor, tableVersionMinor
    ];

    p.parseUShort(); // reserved
    const valueRecordSize = p.parseUShort();
    const valueRecordCount = p.parseUShort();
    const itemVariationStoreOffset = p.parseOffset16();

    // the value records follow the header, each valueRecordSize bytes long
    // (a larger size leaves room for fields of future versions)
    const valueRecords = {};
    const recordsStart = p.relativeOffset;
    for (let i = 0; i < valueRecordCount; i++) {
        p.relativeOffset = recordsStart + i * valueRecordSize;
        const tag = p.parseTag();
        valueRecords[tag] = {
            outerIndex: p.parseUShort(),
            innerIndex: p.parseUShort(),
        };
    }

    const itemVariationStore = createSkippablePartParser(data, start, onPartError)('ItemVariationStore table',
        itemVariationStoreOffset, Parser.prototype.parseItemVariationStore);

    return {
        version,
        itemVariationStore,
        valueRecords,
    };
}

function makeMvarTable(/*fvar*/) {
    console.warn('Writing of mvar tables is not yet supported.');
}

export default { make: makeMvarTable, parse: parseMvarTable };
