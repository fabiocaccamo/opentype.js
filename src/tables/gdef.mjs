// The `GDEF` table contains various glyph properties
// https://docs.microsoft.com/en-us/typography/opentype/spec/gdef

import check from '../check.mjs';
import { Parser, createSkippablePartParser, throwError } from '../parse.mjs';

var attachList = function() {
    return {
        coverage: this.parsePointer(Parser.coverage),
        attachPoints: this.parseList(Parser.pointer(Parser.uShortList))
    };
};

var caretValue = function() {
    var format = this.parseUShort();
    check.argument(format === 1 || format === 2 || format === 3,
        'Unsupported CaretValue table version.');
    if (format === 1) {
        return { coordinate: this.parseShort() };
    } else if (format === 2) {
        return { pointindex: this.parseShort() };
    } else if (format === 3) {
        // Device / Variation Index tables unsupported
        return { coordinate: this.parseShort() };
    }
};

var ligGlyph = function() {
    return this.parseList(Parser.pointer(caretValue));
};

var ligCaretList = function() {
    return {
        coverage: this.parsePointer(Parser.coverage),
        ligGlyphs: this.parseList(Parser.pointer(ligGlyph))
    };
};

/**
 * The parser of a MarkGlyphSetsDef table: like HarfBuzz, the coverage of a mark glyph set that fails to parse is read
 * as a NULL offset, a set that covers no glyph
 * @param {function(Error, string)} onPartError - see parseGDEFTable
 * @returns {function(): Array<object|undefined>}
 */
function createMarkGlyphSetsParser(onPartError) {
    return function() {
        const markGlyphSetsStart = this.offset;
        const format = this.parseUShort();
        check.argument(format === 1, 'GDEF MarkGlyphSetsDef format must be 1.');
        // the coverage offsets of the mark glyph sets are 32-bit
        const coverageOffsets = this.parseULongList(this.parseUShort());
        const parsePart = createSkippablePartParser(this.data, markGlyphSetsStart, onPartError);
        return coverageOffsets.map((coverageOffset, markGlyphSetIndex) =>
            parsePart('coverage of the mark glyph set ' + markGlyphSetIndex, coverageOffset, Parser.coverage));
    };
}

/**
 * Parse a GDEF table. Like HarfBuzz neuters the offset of a part of the table that fails to sanitize, a part that fails
 * to parse (its GlyphClassDef, AttachList, LigCaretList, MarkAttachClassDef, MarkGlyphSetsDef or ItemVariationStore
 * table, or the coverage of a mark glyph set) is read as a NULL offset; a header that fails to parse throws an error.
 * https://docs.microsoft.com/en-us/typography/opentype/spec/gdef
 * @param {DataView} data
 * @param {number} [start=0] - the offset of the table in the data
 * @param {function(Error, string)} [onPartError] - called with the error and the name of each part that fails to
 * parse, e.g. 'ItemVariationStore table'; the error is thrown if omitted
 * @returns {object}
 */
function parseGDEFTable(data, start, onPartError = throwError) {
    start = start || 0;
    const p = new Parser(data, start);
    const tableVersion = p.parseVersion(1);
    check.argument(tableVersion === 1 || tableVersion === 1.2 || tableVersion === 1.3,
        'Unsupported GDEF table version.');
    const classDefOffset = p.parseOffset16();
    const attachListOffset = p.parseOffset16();
    const ligCaretListOffset = p.parseOffset16();
    const markAttachClassDefOffset = p.parseOffset16();
    const markGlyphSetsOffset = tableVersion >= 1.2 ? p.parseOffset16() : 0;
    const itemVariationStoreOffset = tableVersion >= 1.3 ? p.parseOffset32() : 0;
    const parsePart = createSkippablePartParser(data, start, onPartError);
    const gdef = {
        version: tableVersion,
        classDef: parsePart('GlyphClassDef table', classDefOffset, Parser.classDef),
        attachList: parsePart('AttachList table', attachListOffset, attachList),
        ligCaretList: parsePart('LigCaretList table', ligCaretListOffset, ligCaretList),
        markAttachClassDef: parsePart('MarkAttachClassDef table', markAttachClassDefOffset, Parser.classDef)
    };
    if (tableVersion >= 1.2) {
        gdef.markGlyphSets = parsePart('MarkGlyphSetsDef table', markGlyphSetsOffset, createMarkGlyphSetsParser(onPartError));
    }
    if (tableVersion >= 1.3) {
        // deltas referenced by the VariationIndex tables of GPOS value records
        gdef.itemVarStore = parsePart('ItemVariationStore table', itemVariationStoreOffset, Parser.prototype.parseItemVariationStore);
    }
    return gdef;
}

// the GDEF, GSUB and GPOS table lengths of the fonts whose GDEF table HarfBuzz ignores (OT::GDEF::is_blocklisted
// in hb-ot-layout.cc of HarfBuzz 11.3.2): GDEF tables with wrong glyph classes, like the ASCII double quotation mark
// as a mark in some versions of Times New Roman Italic and Bold Italic, or spacing glyphs as marks in some
// versions of Tahoma, Microsoft Himalaya, Cantarell, Padauk and Courier New
const BLOCKLISTED_TABLE_LENGTHS = [
    [442, 2874, 42038], [430, 2874, 40662], [442, 2874, 39116], [430, 2874, 39374],
    [490, 3046, 41638], [478, 3046, 41902],
    [898, 12554, 46470], [910, 12566, 47732], [928, 23298, 59332], [940, 23310, 60732],
    [964, 23836, 60072], [976, 23832, 61456], [994, 24474, 60336], [1006, 24470, 61740],
    [1006, 24576, 61346], [1018, 24572, 62828], [1006, 24576, 61352], [1018, 24572, 62834],
    [832, 7324, 47162], [844, 7302, 45474],
    [180, 13054, 7254], [192, 12638, 7254], [192, 12690, 7254],
    [188, 248, 3852], [188, 264, 3426],
    [1058, 47032, 11818], [1046, 47030, 12600], [1058, 71796, 16770], [1046, 71790, 17862],
    [1046, 71788, 17112], [1058, 71794, 17514], [1330, 109904, 57938], [1330, 109904, 58972],
    [1004, 59092, 14836],
    [588, 5078, 14418], [588, 5078, 14238], [894, 17162, 33960], [894, 17154, 34472],
    [816, 7868, 17052], [816, 7868, 17138]
];

/**
 * Whether the GDEF table of a font is one of the broken GDEF tables HarfBuzz ignores, by the lengths of the
 * GDEF, GSUB and GPOS tables of the font.
 * @param {number} gdefLength
 * @param {number} gsubLength - 0 without a GSUB table
 * @param {number} gposLength - 0 without a GPOS table
 * @returns {boolean}
 */
function isBlocklisted(gdefLength, gsubLength, gposLength) {
    return BLOCKLISTED_TABLE_LENGTHS.some(([blocklistedGdefLength, blocklistedGsubLength, blocklistedGposLength]) =>
        gdefLength === blocklistedGdefLength && gsubLength === blocklistedGsubLength && gposLength === blocklistedGposLength);
}

export default { parse: parseGDEFTable, isBlocklisted };
