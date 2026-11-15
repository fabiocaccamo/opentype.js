// The `gvar` table stores information on how to modify glyf outlines across the variation space
// https://learn.microsoft.com/en-us/typography/opentype/spec/gvar

import check from '../check.mjs';
import parse from '../parse.mjs';

/**
 * Parse a gvar table
 * @param {DataView} data
 * @param {number} start - the offset of the table in the data
 * @param {Object} fvar - the fvar table of the font
 * @param {Array} glyphs
 * @param {function(Error, number, number, boolean)} [onGlyphVariationsError] - called with the error and the glyph index
 * of the variation data of a glyph that fails to parse when it is first read, which is then skipped, with the tuple
 * index too for the data of a tuple that fail to parse, the glyph then not varied where the tuple applies, and with true
 * too for a tuple variation header that fails to parse, the tuples from it skipped (see parseTupleVariationStoreList in
 * parse.mjs); the error is thrown if omitted
 * @returns {Object}
 */
function parseGvarTable(data, start, fvar, glyphs, onGlyphVariationsError) {
    const p = new parse.Parser(data, start);
    const tableVersionMajor = p.parseUShort();
    const tableVersionMinor = p.parseUShort();
    // like HarfBuzz, a table of another major version is not read (gvar::sanitize_shallow)
    check.argument(tableVersionMajor === 1, `Unsupported gvar table version ${tableVersionMajor}.${tableVersionMinor}`);
    const axisCount = p.parseUShort();
    if(axisCount !== fvar.axes.length) {
        console.warn(`axisCount ${axisCount} in gvar table does not match the number of axes ${fvar.axes.length} in the fvar table!`);
    }
    const sharedTupleCount = p.parseUShort();

    // like HarfBuzz, the offset of the shared tuples is not nullable: 0 is the start of the table
    const sharedTuples = new parse.Parser(data, start + p.parseOffset32()).parseTupleRecords(sharedTupleCount, axisCount);

    const glyphVariations = p.parseTupleVariationStoreList(axisCount, 'gvar', glyphs, onGlyphVariationsError);

    return {
        version: [tableVersionMajor, tableVersionMinor],
        sharedTuples,
        glyphVariations
    };
}

function makeGvarTable(/*gvar*/) {
    console.warn('Writing of gvar tables is not yet supported.');
}

export default { make: makeGvarTable, parse: parseGvarTable };
