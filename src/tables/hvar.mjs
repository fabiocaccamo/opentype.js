// The `hvar` table stores variation data for the hmtx table.
// https://learn.microsoft.com/en-us/typography/opentype/spec/hvar

import check from '../check.mjs';
import { Parser, createSkippablePartParser, throwError } from '../parse.mjs';

/**
 * Parse an HVAR table. Like HarfBuzz (HVARVVAR::sanitize) neuters the offset of a part of the table that fails to
 * sanitize, a part that fails to parse (its ItemVariationStore table or one of its DeltaSetIndexMap tables) is read as a
 * NULL offset: a NULL ItemVariationStore gives no delta, a NULL advance width mapping varies a glyph by the item of its
 * glyph index in the first item variation data; a header that fails to parse, or of a major version other than 1,
 * throws an error.
 * https://learn.microsoft.com/en-us/typography/opentype/spec/hvar
 * @param {DataView} data
 * @param {number} start - the offset of the table in the data
 * @param {function(Error, string)} [onPartError] - called with the error and the name of each part that fails to
 * parse, e.g. 'ItemVariationStore table'; the error is thrown if omitted
 * @returns {Object}
 */
function parseHvarTable(data, start, onPartError = throwError) {
    const p = new Parser(data, start);
    const tableVersionMajor = p.parseUShort();
    const tableVersionMinor = p.parseUShort();

    // like HarfBuzz, a table of another major version is not read (HVARVVAR::sanitize)
    check.argument(tableVersionMajor === 1, `Unsupported HVAR table version ${tableVersionMajor}.${tableVersionMinor}`);

    const itemVariationStoreOffset = p.parseOffset32();
    const advanceWidthOffset = p.parseOffset32();
    const leftSideBearingMappingOffset = p.parseOffset32();
    const rightSideBearingMappingOffset = p.parseOffset32();
    const parsePart = createSkippablePartParser(data, start, onPartError);

    return {
        version: [tableVersionMajor, tableVersionMinor],
        itemVariationStore: parsePart('ItemVariationStore table', itemVariationStoreOffset, Parser.prototype.parseItemVariationStore),
        advanceWidth: parsePart('advance width DeltaSetIndexMap table', advanceWidthOffset, Parser.prototype.parseDeltaSetIndexMap),
        lsb: parsePart('lsb DeltaSetIndexMap table', leftSideBearingMappingOffset, Parser.prototype.parseDeltaSetIndexMap),
        rsb: parsePart('rsb DeltaSetIndexMap table', rightSideBearingMappingOffset, Parser.prototype.parseDeltaSetIndexMap),
    };
}

function makeHvarTable(/*fvar*/) {
    console.warn('Writing of hvar tables is not yet supported.');
}


export default { make: makeHvarTable, parse: parseHvarTable };
