// The `cvar` table stores variation data for CVT values
// https://learn.microsoft.com/en-us/typography/opentype/spec/cvar

import check from '../check.mjs';
import parse from '../parse.mjs';

/**
 * Parse a cvar table
 * @param {DataView} data
 * @param {number} start - the offset of the table in the data
 * @param {Object} fvar - the fvar table of the font
 * @param {Array<number>} cvt - the cvt table of the font
 * @param {function(Error, number, boolean)} [onTupleError] - called with the error and the tuple index of the data of a
 * tuple that fail to parse when they are first read, which then vary no cvt value where the tuple applies, and with true
 * too for a tuple variation header that fails to parse, the tuples from it skipped (see parseTupleVariationStore in
 * parse.mjs); the error is thrown if omitted
 * @returns {Object}
 */
function parseCvarTable(data, start, fvar, cvt, onTupleError) {
    const p = new parse.Parser(data, start);
    const tableVersionMajor = p.parseUShort();
    const tableVersionMinor = p.parseUShort();
    // like HarfBuzz, a table of another major version is not read (cvar::sanitize)
    check.argument(tableVersionMajor === 1, `Unsupported cvar table version ${tableVersionMajor}.${tableVersionMinor}`);
    // the store starts at the start of the table, after the version fields (see parseTupleVariationStore)
    const cvtVariations = p.parseTupleVariationStore(
        0,
        fvar.axes.length,
        'cvar',
        cvt,
        undefined,
        onTupleError
    );

    return {
        version: [tableVersionMajor, tableVersionMinor],
        ...cvtVariations,
    };
}

function makeCvarTable(/*cvar*/) {
    console.warn('Writing of cvar tables is not yet supported.');
}

export default { make: makeCvarTable, parse: parseCvarTable };
