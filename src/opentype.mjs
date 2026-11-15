// opentype.js
// https://github.com/opentypejs/opentype.js
// (c) 2015 Frederik De Bleser
// opentype.js may be freely distributed under the MIT license.

import { tinf_uncompress as inflate } from './tiny-inflate@1.0.3.esm.mjs'; // from code4fukui/tiny-inflate-es
import { parseWOFF2TableEntries } from './woff2.mjs';
import Font from './font.mjs';
import Glyph from './glyph.mjs';
import { CmapEncoding, GlyphNames, addGlyphNames } from './encoding.mjs';
import parse, { getTableView } from './parse.mjs';
import BoundingBox from './bbox.mjs';
import Path from './path.mjs';
import cpal from './tables/cpal.mjs';
import colr from './tables/colr.mjs';
import cmap from './tables/cmap.mjs';
import cff from './tables/cff.mjs';
import stat from './tables/stat.mjs';
import fvar from './tables/fvar.mjs';
import gvar from './tables/gvar.mjs';
import cvar from './tables/cvar.mjs';
import avar from './tables/avar.mjs';
import hvar from './tables/hvar.mjs';
import mvar from './tables/mvar.mjs';
import glyf from './tables/glyf.mjs';
import gdef from './tables/gdef.mjs';
import gpos from './tables/gpos.mjs';
import gsub from './tables/gsub.mjs';
import head from './tables/head.mjs';
import hhea from './tables/hhea.mjs';
import hmtx from './tables/hmtx.mjs';
import kern from './tables/kern.mjs';
import ltag from './tables/ltag.mjs';
import loca from './tables/loca.mjs';
import maxp from './tables/maxp.mjs';
import _name from './tables/name.mjs';
import os2 from './tables/os2.mjs';
import post from './tables/post.mjs';
import meta from './tables/meta.mjs';
import gasp from './tables/gasp.mjs';
import svg from './tables/svg.mjs';
import sfnt, { SFNT_HEADER_SIZE, SFNT_TABLE_RECORD_SIZE } from './tables/sfnt.mjs';
import { PaletteManager } from './palettes.mjs';
/**
 * The opentype library.
 * @namespace opentype
 */

// Table Directory Entries //////////////////////////////////////////////
const WOFF_HEADER_SIZE = 44;
const WOFF_TABLE_DIRECTORY_ENTRY_SIZE = 20;
// the zlib header of a compressed WOFF table, skipped before inflate
const ZLIB_HEADER_SIZE = 2;

/**
 * Throws an error when a range of bytes ends past the end of the font file.
 * @param {DataView} data - the whole font file
 * @param {number} offset
 * @param {number} length
 * @param {string} description - the name of the range, used in the error
 */
function checkFontFileRange(data, offset, length, description) {
    if (offset + length > data.byteLength) {
        throw new Error('Truncated font file: the ' + description + ' ends past the end of the file');
    }
}

/**
 * Parses OpenType table entries.
 * @param  {DataView}
 * @param  {Number}
 * @return {Object[]}
 */
function parseOpenTypeTableEntries(data, numTables) {
    checkFontFileRange(data, SFNT_HEADER_SIZE, numTables * SFNT_TABLE_RECORD_SIZE, 'table directory');
    const tableEntries = [];
    let p = SFNT_HEADER_SIZE;
    for (let i = 0; i < numTables; i += 1) {
        const tag = parse.getTag(data, p);
        const checksum = parse.getULong(data, p + 4);
        const offset = parse.getULong(data, p + 8);
        const length = parse.getULong(data, p + 12);
        tableEntries.push({tag: tag, checksum: checksum, offset: offset, length: length, compression: false});
        p += SFNT_TABLE_RECORD_SIZE;
    }

    return tableEntries;
}

/**
 * Parses WOFF table entries.
 * @param  {DataView}
 * @param  {Number}
 * @return {Object[]}
 */
function parseWOFFTableEntries(data, numTables) {
    checkFontFileRange(data, WOFF_HEADER_SIZE, numTables * WOFF_TABLE_DIRECTORY_ENTRY_SIZE, 'table directory');
    const tableEntries = [];
    let p = WOFF_HEADER_SIZE; // offset to the first table directory entry.
    for (let i = 0; i < numTables; i += 1) {
        const tag = parse.getTag(data, p);
        const offset = parse.getULong(data, p + 4);
        const compLength = parse.getULong(data, p + 8);
        const origLength = parse.getULong(data, p + 12);
        if (compLength > origLength) {
            throw new Error('Invalid WOFF table ' + tag + ': its compressed length is larger than its original length');
        }
        if (compLength < origLength && compLength < ZLIB_HEADER_SIZE) {
            throw new Error('Invalid WOFF table ' + tag + ': its compressed length is shorter than a zlib header');
        }

        let compression;
        if (compLength < origLength) {
            compression = 'WOFF';
        } else {
            compression = false;
        }

        tableEntries.push({tag: tag, offset: offset, compression: compression,
            compressedLength: compLength, length: origLength});
        p += WOFF_TABLE_DIRECTORY_ENTRY_SIZE;
    }

    return tableEntries;
}

/**
 * @typedef TableData
 * @type Object
 * @property {DataView} data - The DataView
 * @property {number} offset - The data offset.
 */

/**
 * @param  {DataView}
 * @param  {Object}
 * @return {TableData}
 */
function uncompressTable(data, tableEntry) {
    if (tableEntry.compression === 'WOFF2') {
        // decompressed (and reconstructed) by parseWOFF2TableEntries
        return {data: tableEntry.data, offset: 0};
    } else if (tableEntry.compression === 'WOFF') {
        const inBuffer = new Uint8Array(data.buffer, tableEntry.offset + ZLIB_HEADER_SIZE, tableEntry.compressedLength - ZLIB_HEADER_SIZE);
        // inflate returns a slice of the output for a shorter stream and drops the bytes past its end: one byte more
        // than the table tells a longer stream apart, which comes back with the whole output
        const outBuffer = inflate(inBuffer, new Uint8Array(tableEntry.length + 1));
        if (outBuffer.byteLength !== tableEntry.length) {
            throw new Error('Decompression error: ' + tableEntry.tag + ' decompressed length doesn\'t match recorded length');
        }

        const view = new DataView(outBuffer.buffer, outBuffer.byteOffset, outBuffer.byteLength);
        return {data: view, offset: 0};
    } else {
        return {data: data, offset: tableEntry.offset};
    }
}

/**
 * Whether the layout of a parsed font caches the lookups of its GSUB and GPOS tables, from the layoutCache option of
 * parse: on unless the option is false
 * @param {boolean|undefined} layoutCacheOption
 * @returns {boolean}
 */
function isLayoutCacheEnabledByOption(layoutCacheOption) {
    if (layoutCacheOption === undefined) {
        return true;
    }
    if (typeof layoutCacheOption === 'boolean') {
        return layoutCacheOption;
    }
    throw new TypeError(
        `The layoutCache option must be a boolean, not ${typeof layoutCacheOption} ${String(layoutCacheOption)}`
    );
}

/**
 * Reads the table directory of a font file: a TrueType or CFF sfnt, a WOFF or a WOFF2 file (the tables of a WOFF2 file
 * decompressed and reconstructed). Font collections ('ttcf') are not supported.
 * @param {DataView} data - the whole font file
 * @return {{outlinesFormat: string, sfntVersion: string, tableEntries: Object[]}} the outlines format ('truetype' or
 *         'cff'), the tag of the version of the sfnt the file holds, and the table entries (see uncompressTable)
 */
function parseFontFileTableEntries(data) {
    checkFontFileRange(data, 0, 4, 'signature');
    const signature = parse.getTag(data, 0);
    const isTrueTypeSignature = signature === String.fromCharCode(0, 1, 0, 0) || signature === 'true' || signature === 'typ1';
    if (isTrueTypeSignature || signature === 'OTTO') {
        checkFontFileRange(data, 0, SFNT_HEADER_SIZE, 'sfnt header');
        return {
            outlinesFormat: isTrueTypeSignature ? 'truetype' : 'cff',
            sfntVersion: signature,
            tableEntries: parseOpenTypeTableEntries(data, parse.getUShort(data, 4)),
        };
    } else if (signature === 'wOFF') {
        checkFontFileRange(data, 0, WOFF_HEADER_SIZE, 'WOFF header');
        const flavor = parse.getTag(data, 4);
        let outlinesFormat;
        if (flavor === String.fromCharCode(0, 1, 0, 0)) {
            outlinesFormat = 'truetype';
        } else if (flavor === 'OTTO') {
            outlinesFormat = 'cff';
        } else {
            throw new Error('Unsupported OpenType flavor ' + flavor);
        }

        return {
            outlinesFormat,
            sfntVersion: flavor,
            tableEntries: parseWOFFTableEntries(data, parse.getUShort(data, 12)),
        };
    } else if (signature === 'wOF2') {
        // the signature and the flavor; parseWOFF2TableEntries checks the rest of the header
        checkFontFileRange(data, 0, 8, 'WOFF2 header');
        const flavor = parse.getTag(data, 4);
        let outlinesFormat;
        if (flavor === String.fromCharCode(0, 1, 0, 0) || flavor === 'true') {
            outlinesFormat = 'truetype';
        } else if (flavor === 'OTTO') {
            outlinesFormat = 'cff';
        } else {
            throw new Error('Unsupported OpenType flavor ' + flavor);
        }

        return {
            outlinesFormat,
            sfntVersion: flavor,
            tableEntries: parseWOFF2TableEntries(data),
        };
    } else {
        throw new Error('Unsupported OpenType signature ' + signature);
    }
}

/**
 * The bytes of a table of a font file, decompressed (a view on the file for a table stored as it is)
 * @param {DataView} data - the whole font file
 * @param {Object} tableEntry - an entry of parseFontFileTableEntries
 * @return {Uint8Array}
 */
function getTableBytes(data, tableEntry) {
    if (tableEntry.compression !== 'WOFF2') {
        const storedLength = tableEntry.compression === 'WOFF' ? tableEntry.compressedLength : tableEntry.length;
        checkFontFileRange(data, tableEntry.offset, storedLength, tableEntry.tag + ' table');
    }
    const table = uncompressTable(data, tableEntry);
    return new Uint8Array(table.data.buffer, table.data.byteOffset + table.offset, tableEntry.length);
}

/**
 * The ArrayBuffer of the bytes of a font file given to the public API: an ArrayBuffer, or a copy of the bytes of a
 * Uint8Array or a node Buffer
 * @param {ArrayBuffer|Uint8Array} buffer
 * @return {ArrayBuffer}
 */
function getFontFileArrayBuffer(buffer) {
    if (buffer.constructor !== ArrayBuffer) {
        return new Uint8Array(buffer).buffer;
    }
    return buffer;
}

/**
 * The set of the tags of the tableTags argument of removeTables, which must be an array of table tags: strings of 4
 * printable ASCII characters (the OpenType Tag type, e.g. 'SVG ' with its space)
 * @param {string[]} tableTags
 * @return {Set<string>}
 */
function getTableTagSet(tableTags) {
    if (!Array.isArray(tableTags)) {
        throw new TypeError('The table tags must be an array, not ' + typeof tableTags);
    }
    for (const tag of tableTags) {
        if (typeof tag !== 'string' || !/^[\x20-\x7E]{4}$/.test(tag)) {
            throw new TypeError('Invalid table tag ' + JSON.stringify(tag) + ': a tag is a string of 4 printable ASCII characters');
        }
    }
    return new Set(tableTags);
}

// the tables a font cannot be used without, besides the tables of its outlines (glyf and loca, CFF or CFF2): parse
// throws an error for a font file without one of them, or one of them that fails to parse
const REQUIRED_TABLE_TAGS = ['head', 'hhea', 'maxp', 'hmtx', 'cmap'];

/**
 * The entries of the tables of a font file by tag, the last entry of a tag the file has more than once, like fontTools
 * (SFNTReader)
 * @param {Object[]} tableEntries - see parseFontFileTableEntries
 * @return {Map<string, Object>}
 */
function getTableEntriesByTag(tableEntries) {
    return new Map(tableEntries.map(tableEntry => [tableEntry.tag, tableEntry]));
}

/**
 * Throw an error when a font file has not one of the REQUIRED_TABLE_TAGS
 * @param {Map<string, Object>} tableEntriesByTag
 */
function checkRequiredTables(tableEntriesByTag) {
    for (const tag of REQUIRED_TABLE_TAGS) {
        if (!tableEntriesByTag.has(tag)) {
            throw new Error('Font doesn\'t contain the required ' + tag + ' table.');
        }
    }
}

/**
 * A problem of the font file that a font was parsed without: an optional table, or a part of it, that failed to parse
 * and was skipped (see Font.warnings)
 * @typedef FontWarning
 * @type Object
 * @property {string} table - the tag of the table, e.g. 'GPOS' or 'SVG '
 * @property {string} message
 * @property {Error} error - the error the table, or its part, failed to parse with
 */

/**
 * Add a warning to the warnings of a font (see FontWarning)
 * @param {opentype.Font} font
 * @param {string} tableTag
 * @param {string} message
 * @param {Error} error
 */
function addFontWarning(font, tableTag, message, error) {
    font.warnings.push({ table: tableTag, message, error });
}

/**
 * Parse an optional table of a font file, one the font can be used without: a table that fails to parse is skipped,
 * with a warning in font.warnings. A WOFF table that fails to decompress throws an error, as the font file is broken.
 * @param {opentype.Font} font
 * @param {DataView} data - the whole font file
 * @param {Object|undefined} tableEntry - see parseFontFileTableEntries, undefined for a table the font file has not
 * @param {function(DataView, number, number): *} parseTable - parses the table from its data (see uncompressTable),
 * its offset in the data and its length
 * @return {*} the result of parseTable, undefined when the font file has not the table or the table fails to parse
 */
function parseOptionalTable(font, data, tableEntry, parseTable) {
    if (!tableEntry) {
        return undefined;
    }
    const table = uncompressTable(data, tableEntry);
    try {
        return parseTable(table.data, table.offset, tableEntry.length);
    } catch (error) {
        addFontWarning(font, tableEntry.tag, 'The table is skipped: ' + error.message, error);
        return undefined;
    }
}

/**
 * Parse a GSUB or GPOS table with a warning in font.warnings for each lookup subtable that fails to parse and is
 * skipped, added once the whole table is parsed: a table that fails to parse after a skipped subtable has only the
 * warning of the skipped table (see parseOptionalTable)
 * @param {opentype.Font} font
 * @param {string} tableTag - 'GSUB' or 'GPOS'
 * @param {function(function(Error, number, number|undefined)): Object} parseTable - parses the table with the callback
 * of the subtables that fail to parse, called with the error, the lookup index and the subtable index, undefined for an
 * extension lookup whose subtables are all skipped (see parseLookup in parse.mjs)
 * @return {Object} the table
 */
function parseLayoutTable(font, tableTag, parseTable) {
    const subtableWarnings = [];
    const table = parseTable((error, lookupIndex, subtableIndex) => subtableWarnings.push({
        message: (subtableIndex === undefined ? 'The lookup ' + lookupIndex :
            'The subtable ' + subtableIndex + ' of the lookup ' + lookupIndex) + ' is skipped: ' + error.message,
        error
    }));
    for (const { message, error } of subtableWarnings) {
        addFontWarning(font, tableTag, message, error);
    }
    return table;
}

/**
 * The message of the warning of the variation data of a glyph of a gvar table that fails to parse, of one of its tuple
 * variation headers or of the data of one of its tuples (see parseTupleVariationStoreList in parse.mjs)
 * @param {Error} error
 * @param {number} glyphIndex
 * @param {number} [tupleIndex] - the tuple whose header or data fail to parse, undefined for the whole variation data
 * @param {boolean} [isHeaderError] - whether the header of the tuple fails to parse, the tuples from it skipped
 * @return {string}
 */
function getGlyphVariationsWarningMessage(error, glyphIndex, tupleIndex, isHeaderError) {
    if (tupleIndex === undefined) {
        return 'The variation data of the glyph ' + glyphIndex + ' is skipped: ' + error.message;
    }
    if (isHeaderError) {
        return 'The tuples of the glyph ' + glyphIndex + ' from its tuple ' + tupleIndex + ' are skipped: ' + error.message;
    }
    return 'The glyph ' + glyphIndex + ' is not varied where its tuple ' + tupleIndex + ' applies: ' + error.message;
}

/**
 * The message of the warning of a tuple variation header or of the data of a tuple of a cvar table that fail to parse
 * (see parseTupleVariationStore in parse.mjs)
 * @param {Error} error
 * @param {number} tupleIndex - the tuple whose header or data fail to parse
 * @param {boolean} [isHeaderError] - whether the header of the tuple fails to parse, the tuples from it skipped
 * @return {string}
 */
function getCvtVariationsWarningMessage(error, tupleIndex, isHeaderError) {
    if (isHeaderError) {
        return 'The tuples of the cvar table from the tuple ' + tupleIndex + ' are skipped: ' + error.message;
    }
    return 'The cvt table is not varied where the tuple ' + tupleIndex + ' applies: ' + error.message;
}

/**
 * The callback of the parser of a table (GDEF, HVAR, MVAR) for a part of the table that fails to parse and is skipped:
 * a warning in font.warnings
 * @param {opentype.Font} font
 * @param {string} tableTag
 * @return {function(Error, string)}
 */
function createTablePartErrorRecorder(font, tableTag) {
    return (error, partName) => addFontWarning(font, tableTag,
        'The ' + partName + ' is skipped: ' + error.message, error);
}

/**
 * Throw an error when an optional table needs another table the font has not: one the font file has not, or one that
 * failed to parse and was skipped
 * @param {string} tableTag
 * @param {Object|undefined} requiredTable
 * @param {string} requiredTableTag
 */
function checkTableDependency(tableTag, requiredTable, requiredTableTag) {
    if (!requiredTable) {
        throw new Error('This font provides the ' + tableTag + ' table, but its ' + requiredTableTag +
            ' table, which is required for variable fonts, is missing or was skipped.');
    }
}

// Public API ///////////////////////////////////////////////////////////

/**
 * Parse the OpenType file data (as an ArrayBuffer) and return a Font object.
 * Throws an error if the font could not be parsed: a font file that is not a supported font file, a truncated font
 * file or table directory, a WOFF table that fails to decompress, a font without one of the required tables (head,
 * hhea, maxp, hmtx, cmap, and glyf and loca, 'CFF ' or CFF2), or one of them that fails to parse. Any other table that
 * fails to parse is skipped (undefined in font.tables), and so is a GSUB or GPOS lookup subtable that fails to parse
 * or of a lookup of an unknown type (undefined in its lookup), all the subtables of an extension lookup whose subtables
 * have not all the same extension lookup type (one warning for the lookup), and a part of a GDEF, HVAR or MVAR table
 * that fails to parse (a NULL offset): the font is parsed without them, with a warning for each one in font.warnings.
 * The variation data of a glyph of a gvar table that fail to parse when they are first read are skipped the same way:
 * the glyph is not varied, with a warning added to font.warnings then. Where a tuple whose data fail to parse is
 * active, the glyph (or, for a cvar table, the cvt table) is not varied, with a warning. A font whose GSUB table has a
 * skipped or NULL subtable, or a NULL offset in a subtable, cannot be written by toArrayBuffer, nor a font without the
 * English postScriptName name, nor the fontFamily and fontSubfamily names (e.g. without a name table).
 * @param  {ArrayBuffer}
 * @param  {Object} opt - options for parsing
 * @param  {boolean} [opt.layoutCache=true] - whether the layout caches the lookups of the GSUB and GPOS tables of the
 *                                            font and the kerning lookups of Font.getKerningValue
 *                                            (font.isLayoutCacheEnabled): with false a change made directly to the
 *                                            objects of these tables applies at the next layout; any value other than
 *                                            a boolean or undefined throws a TypeError. The charstrings of a CFF font
 *                                            and the glyph variations of a gvar table are read from the font data when
 *                                            they are first used, with or without lowMemory
 * @return {opentype.Font}
 */
function parseBuffer(buffer, opt={}) {
    // Since the constructor can also be called to create new fonts from scratch, we indicate this
    // should be an empty font that we'll fill with our own data.
    const font = new Font({empty: true});
    font.isLayoutCacheEnabled = isLayoutCacheEnabledByOption(opt.layoutCache);

    // OpenType fonts use big endian byte ordering.
    // We can't rely on typed array view types, because they operate with the endianness of the host computer.
    // Instead we use DataViews where we can specify endianness.
    const data = new DataView(getFontFileArrayBuffer(buffer), 0);
    const { outlinesFormat, tableEntries } = parseFontFileTableEntries(data);
    font.outlinesFormat = outlinesFormat;

    // the tags of all the tables of the font file, including the ones opentype.js does
    // not parse (e.g. the color bitmap tables sbix, CBDT and CBLC)
    font.tableTags = tableEntries.map(tableEntry => tableEntry.tag);

    const tableEntriesByTag = getTableEntriesByTag(tableEntries);
    checkRequiredTables(tableEntriesByTag);
    const parseRequiredTable = (tag, parseTable) => {
        const table = uncompressTable(data, tableEntriesByTag.get(tag));
        return parseTable(table.data, table.offset);
    };
    const parseOptional = (tag, parseTable) => parseOptionalTable(font, data, tableEntriesByTag.get(tag), parseTable);
    // parse an optional table into font.tables, where a table that fails to parse is not set
    const parseOptionalIntoTables = (tableName, tag, parseTable) => {
        const table = parseOptional(tag, parseTable);
        if (table !== undefined) {
            font.tables[tableName] = table;
        }
        return table;
    };

    font.tables.head = parseRequiredTable('head', head.parse);
    font.unitsPerEm = font.tables.head.unitsPerEm;
    font.tables.hhea = parseRequiredTable('hhea', hhea.parse);
    font.ascender = font.tables.hhea.ascender;
    font.descender = font.tables.hhea.descender;
    font.numberOfHMetrics = font.tables.hhea.numberOfHMetrics;
    font.tables.maxp = parseRequiredTable('maxp', maxp.parse);
    font.numGlyphs = font.tables.maxp.numGlyphs;
    font.tables.cmap = parseRequiredTable('cmap', cmap.parse);
    font.encoding = new CmapEncoding(font.tables.cmap);

    const ltagTable = parseOptional('ltag', ltag.parse);
    // without a name table, or with one that fails to parse, the font has no names
    font.names = parseOptionalIntoTables('name', 'name', (tableData, start) => _name.parse(tableData, start, ltagTable)) || {};
    parseOptionalIntoTables('os2', 'OS/2', os2.parse);
    parseOptionalIntoTables('post', 'post', post.parse);
    // without a post table, or with one that fails to parse, the glyphs have no names, like with a post table of
    // version 3; the glyph names of a CFF font are in its charset (see addGlyphNames)
    font.glyphNames = new GlyphNames(font.tables.post || { version: 3 });
    parseOptionalIntoTables('cvt', 'cvt ', (tableData, start, length) => new parse.Parser(tableData, start).parseShortList(length / 2));
    parseOptionalIntoTables('fpgm', 'fpgm', (tableData, start, length) => new parse.Parser(tableData, start).parseByteList(length));
    parseOptionalIntoTables('prep', 'prep', (tableData, start, length) => new parse.Parser(tableData, start).parseByteList(length));
    parseOptionalIntoTables('colr', 'COLR', colr.parse);
    parseOptionalIntoTables('cpal', 'CPAL', cpal.parse);
    parseOptionalIntoTables('gasp', 'gasp', gasp.parse);
    parseOptionalIntoTables('svg', 'SVG ', svg.parse);
    const metaTable = parseOptionalIntoTables('meta', 'meta', meta.parse);
    if (metaTable) {
        font.metas = metaTable;
    }

    const glyfTableEntry = tableEntriesByTag.get('glyf');
    const locaTableEntry = tableEntriesByTag.get('loca');
    const cffTableEntry = tableEntriesByTag.get('CFF ');
    const cff2TableEntry = tableEntriesByTag.get('CFF2');
    if (glyfTableEntry && locaTableEntry) {
        const shortVersion = font.tables.head.indexToLocFormat === 0;
        const locaOffsets = parseRequiredTable('loca', (tableData, start) => loca.parse(tableData, start, font.numGlyphs, shortVersion));
        font.glyphs = parseRequiredTable('glyf', (tableData, start) => glyf.parse(tableData, start, locaOffsets, font, opt));
    } else if (cffTableEntry) {
        parseRequiredTable('CFF ', (tableData, start) => cff.parse(tableData, start, font, opt));
        // the glyph names of a CFF font are in its charset, as the names of its
        // glyphs (see addGlyphNames): its post table usually has none (format 3)
        font.glyphNames.names = font.cffEncoding.charset;
    } else if (cff2TableEntry) {
        parseRequiredTable('CFF2', (tableData, start) => cff.parse(tableData, start, font, opt));
    } else {
        throw new Error('Font doesn\'t contain TrueType, CFF or CFF2 outlines.');
    }

    parseRequiredTable('hmtx', (tableData, start) =>
        hmtx.parse(font, tableData, start, font.numberOfHMetrics, font.numGlyphs, font.glyphs, opt));
    addGlyphNames(font, opt);

    font.kerningPairs = parseOptional('kern', kern.parse) || {};

    const gdefTableEntry = tableEntriesByTag.get('GDEF');
    const gsubTableEntry = tableEntriesByTag.get('GSUB');
    const gposTableEntry = tableEntriesByTag.get('GPOS');
    if (parseOptionalIntoTables('gdef', 'GDEF', (tableData, start, length) =>
        gdef.parse(getTableView(tableData, start, length), 0, createTablePartErrorRecorder(font, 'GDEF')))) {
        // like HarfBuzz, the layout ignores the broken GDEF tables of a few known fonts
        const gsubLength = gsubTableEntry ? gsubTableEntry.length : 0;
        const gposLength = gposTableEntry ? gposTableEntry.length : 0;
        font.isGdefIgnoredByLayout = gdef.isBlocklisted(gdefTableEntry.length, gsubLength, gposLength);
    }

    if (parseOptionalIntoTables('gpos', 'GPOS', (tableData, start, length) =>
        parseLayoutTable(font, 'GPOS', onSubtableError => gpos.parse(getTableView(tableData, start, length), 0, onSubtableError)))) {
        font.position.init();
    }

    parseOptionalIntoTables('gsub', 'GSUB', (tableData, start, length) =>
        parseLayoutTable(font, 'GSUB', onSubtableError => gsub.parse(getTableView(tableData, start, length), 0, font.names, onSubtableError)));

    parseOptionalIntoTables('fvar', 'fvar', (tableData, start) => fvar.parse(tableData, start, font.names));

    parseOptionalIntoTables('stat', 'STAT', (tableData, start) => stat.parse(tableData, start, font.tables.fvar));

    parseOptionalIntoTables('gvar', 'gvar', (tableData, start, length) => {
        checkTableDependency('gvar', font.tables.fvar, 'fvar');
        if (!glyfTableEntry) {
            console.warn('This font provides a gvar table, but no glyf table. Glyph variation only works with TrueType outlines.');
        }
        return gvar.parse(getTableView(tableData, start, length), 0, font.tables.fvar, font.glyphs, (error, glyphIndex, tupleIndex, isHeaderError) =>
            addFontWarning(font, 'gvar', getGlyphVariationsWarningMessage(error, glyphIndex, tupleIndex, isHeaderError), error));
    });

    parseOptionalIntoTables('cvar', 'cvar', (tableData, start, length) => {
        checkTableDependency('cvar', font.tables.fvar, 'fvar');
        if (!font.tables.cvt) {
            console.warn('This font provides a cvar table, but no cvt table which could be made variable.');
        }
        if (!glyfTableEntry) {
            console.warn('This font provides a gvar table, but no glyf table. Glyph variation only works with TrueType outlines.');
        }
        return cvar.parse(getTableView(tableData, start, length), 0, font.tables.fvar, font.tables.cvt || [],
            (error, tupleIndex, isHeaderError) => addFontWarning(font, 'cvar',
                getCvtVariationsWarningMessage(error, tupleIndex, isHeaderError), error));
    });

    parseOptionalIntoTables('avar', 'avar', (tableData, start) => {
        checkTableDependency('avar', font.tables.fvar, 'fvar');
        return avar.parse(tableData, start, font.tables.fvar);
    });

    parseOptionalIntoTables('hvar', 'HVAR', (tableData, start, length) => {
        if (!font.tables.fvar) {
            console.warn('This font provides an HVAR table, but its fvar table, which is required for variable fonts, is missing or was skipped.');
        }
        return hvar.parse(getTableView(tableData, start, length), 0, createTablePartErrorRecorder(font, 'HVAR'));
    });

    parseOptionalIntoTables('mvar', 'MVAR', (tableData, start, length) => {
        if (!font.tables.fvar) {
            console.warn('This font provides an MVAR table, but its fvar table, which is required for variable fonts, is missing or was skipped.');
        }
        return mvar.parse(getTableView(tableData, start, length), 0, createTablePartErrorRecorder(font, 'MVAR'));
    });

    font.palettes = new PaletteManager(font);

    return font;
}

/**
 * The bytes of a font file without some of its tables, as a plain sfnt file. The input is a TrueType or CFF sfnt, a
 * WOFF or a WOFF2 file (font collections, 'ttcf', an unknown signature, a truncated file, two tables with the same tag
 * or a WOFF table whose lengths do not match its data throw an error); the output has the sfnt version of the input
 * (0x00010000, 'true', 'typ1' or 'OTTO') and every table of the input except the listed ones, byte for byte
 * (decompressed, the transformed glyf, loca and hmtx tables of a WOFF2 file reconstructed by parseWOFF2TableEntries):
 * only the table directory, the padding and head.checkSumAdjustment are written. The DSIG table is always left out, like the WOFF2
 * encoders and the subsetters of fontTools and HarfBuzz do: its signature does not match the new file.
 * A tag the font does not have is ignored. A required table (e.g. head, cmap, hmtx, glyf, CFF ) can be removed, but
 * the result may then not load. The input buffer is not changed.
 * @param {ArrayBuffer} buffer - the font file (a node Buffer is accepted too, as by parse)
 * @param {string[]} tableTags - the tags of the tables to remove, e.g. ['COLR', 'CPAL', 'SVG ']; a tag that is not a
 *                               string of 4 printable ASCII characters throws a TypeError
 * @return {ArrayBuffer}
 */
function removeTables(buffer, tableTags) {
    const removedTags = getTableTagSet(tableTags);
    const data = new DataView(getFontFileArrayBuffer(buffer), 0);
    const { sfntVersion, tableEntries } = parseFontFileTableEntries(data);
    const tables = tableEntries
        .filter(tableEntry => tableEntry.tag !== 'DSIG' && !removedTags.has(tableEntry.tag))
        .map(tableEntry => ({ tag: tableEntry.tag, bytes: getTableBytes(data, tableEntry) }));
    return sfnt.encodeFile(sfntVersion, tables);
}

/**
 * Asynchronously load the font from a URL or a filesystem. When done, call the callback
 * with two arguments `(err, font)`. The `err` will be null on success,
 * the `font` is a Font object.
 * We use the node.js callback convention so that
 * opentype.js can integrate with frameworks like async.js.
 * @alias opentype.load
 * @deprecated
 */
function load() {
    console.error('DEPRECATED! migrate to: opentype.parse(buffer, opt) See: https://github.com/opentypejs/opentype.js/issues/675');
}

/**
 * Synchronously load the font from a URL or file.
 * When done, returns the font object or throws an error.
 * @alias opentype.loadSync
 * @deprecated
 */
function loadSync() {
    console.error('DEPRECATED! migrate to: opentype.parse(require("fs").readFileSync(url), opt)');
}

export {
    Font,
    Glyph,
    Path,
    BoundingBox,
    parse as _parse,
    parseBuffer as parse,
    removeTables,
    load,
    loadSync
};
