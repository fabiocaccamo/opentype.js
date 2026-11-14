// opentype.js
// https://github.com/opentypejs/opentype.js
// (c) 2015 Frederik De Bleser
// opentype.js may be freely distributed under the MIT license.

import { tinf_uncompress as inflate } from './tiny-inflate@1.0.3.esm.mjs'; // from code4fukui/tiny-inflate-es
import { parseWOFF2TableEntries } from './woff2.mjs';
import Font from './font.mjs';
import Glyph from './glyph.mjs';
import { CmapEncoding, GlyphNames, addGlyphNames } from './encoding.mjs';
import parse from './parse.mjs';
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

// Public API ///////////////////////////////////////////////////////////

/**
 * Parse the OpenType file data (as an ArrayBuffer) and return a Font object.
 * Throws an error if the font could not be parsed.
 * @param  {ArrayBuffer}
 * @param  {Object} opt - options for parsing
 * @param  {boolean} [opt.layoutCache=true] - whether the layout caches the lookups of the GSUB and GPOS tables of the
 *                                            font (font.isLayoutCacheEnabled): with false a change made directly to
 *                                            the objects of these tables applies at the next layout; any value other
 *                                            than a boolean or undefined throws a TypeError
 * @return {opentype.Font}
 */
function parseBuffer(buffer, opt={}) {
    let indexToLocFormat;
    let ltagTable;

    // Since the constructor can also be called to create new fonts from scratch, we indicate this
    // should be an empty font that we'll fill with our own data.
    const font = new Font({empty: true});
    font.isLayoutCacheEnabled = isLayoutCacheEnabledByOption(opt.layoutCache);

    // OpenType fonts use big endian byte ordering.
    // We can't rely on typed array view types, because they operate with the endianness of the host computer.
    // Instead we use DataViews where we can specify endianness.
    const data = new DataView(getFontFileArrayBuffer(buffer), 0);
    const { outlinesFormat, tableEntries } = parseFontFileTableEntries(data);
    const numTables = tableEntries.length;
    font.outlinesFormat = outlinesFormat;

    // the tags of all the tables of the font file, including the ones opentype.js does
    // not parse (e.g. the color bitmap tables sbix, CBDT and CBLC)
    font.tableTags = tableEntries.map(tableEntry => tableEntry.tag);

    let cffTableEntry;
    let cff2TableEntry;
    let fvarTableEntry;
    let statTableEntry;
    let gvarTableEntry;
    let cvarTableEntry;
    let avarTableEntry;
    let glyfTableEntry;
    let gdefTableEntry;
    let gposTableEntry;
    let gsubTableEntry;
    let hmtxTableEntry;
    let hvarTableEntry;
    let kernTableEntry;
    let locaTableEntry;
    let nameTableEntry;
    let metaTableEntry;
    let mvarTableEntry;
    let p;

    for (let i = 0; i < numTables; i += 1) {
        const tableEntry = tableEntries[i];
        let table;
        switch (tableEntry.tag) {
            case 'avar':
                avarTableEntry = tableEntry;
                break;
            case 'cmap':
                table = uncompressTable(data, tableEntry);
                font.tables.cmap = cmap.parse(table.data, table.offset);
                font.encoding = new CmapEncoding(font.tables.cmap);
                break;
            case 'cvt ' :
                table = uncompressTable(data, tableEntry);
                p = new parse.Parser(table.data, table.offset);
                font.tables.cvt = p.parseShortList(tableEntry.length / 2);
                break;
            case 'fvar':
                fvarTableEntry = tableEntry;
                break;
            case 'STAT':
                statTableEntry = tableEntry;
                break;
            case 'gvar':
                gvarTableEntry = tableEntry;
                break;
            case 'cvar':
                cvarTableEntry = tableEntry;
                break;
            case 'fpgm' :
                table = uncompressTable(data, tableEntry);
                p = new parse.Parser(table.data, table.offset);
                font.tables.fpgm = p.parseByteList(tableEntry.length);
                break;
            case 'head':
                table = uncompressTable(data, tableEntry);
                font.tables.head = head.parse(table.data, table.offset);
                font.unitsPerEm = font.tables.head.unitsPerEm;
                indexToLocFormat = font.tables.head.indexToLocFormat;
                break;
            case 'hhea':
                table = uncompressTable(data, tableEntry);
                font.tables.hhea = hhea.parse(table.data, table.offset);
                font.ascender = font.tables.hhea.ascender;
                font.descender = font.tables.hhea.descender;
                font.numberOfHMetrics = font.tables.hhea.numberOfHMetrics;
                break;
            case 'HVAR':
                hvarTableEntry = tableEntry;
                break;
            case 'MVAR':
                mvarTableEntry = tableEntry;
                break;
            case 'hmtx':
                hmtxTableEntry = tableEntry;
                break;
            case 'ltag':
                table = uncompressTable(data, tableEntry);
                ltagTable = ltag.parse(table.data, table.offset);
                break;
            case 'COLR':
                table = uncompressTable(data, tableEntry);
                font.tables.colr = colr.parse(table.data, table.offset);
                break;
            case 'CPAL':
                table = uncompressTable(data, tableEntry);
                font.tables.cpal = cpal.parse(table.data, table.offset);
                break;
            case 'maxp':
                table = uncompressTable(data, tableEntry);
                font.tables.maxp = maxp.parse(table.data, table.offset);
                font.numGlyphs = font.tables.maxp.numGlyphs;
                break;
            case 'name':
                nameTableEntry = tableEntry;
                break;
            case 'OS/2':
                table = uncompressTable(data, tableEntry);
                font.tables.os2 = os2.parse(table.data, table.offset);
                break;
            case 'post':
                table = uncompressTable(data, tableEntry);
                font.tables.post = post.parse(table.data, table.offset);
                font.glyphNames = new GlyphNames(font.tables.post);
                break;
            case 'prep' :
                table = uncompressTable(data, tableEntry);
                p = new parse.Parser(table.data, table.offset);
                font.tables.prep = p.parseByteList(tableEntry.length);
                break;
            case 'glyf':
                glyfTableEntry = tableEntry;
                break;
            case 'loca':
                locaTableEntry = tableEntry;
                break;
            case 'CFF ':
                cffTableEntry = tableEntry;
                break;
            case 'CFF2':
                cff2TableEntry = tableEntry;
                break;
            case 'kern':
                kernTableEntry = tableEntry;
                break;
            case 'GDEF':
                gdefTableEntry = tableEntry;
                break;
            case 'GPOS':
                gposTableEntry = tableEntry;
                break;
            case 'GSUB':
                gsubTableEntry = tableEntry;
                break;
            case 'meta':
                metaTableEntry = tableEntry;
                break;
            case 'gasp':
                try {
                    table = uncompressTable(data, tableEntry);
                    font.tables.gasp = gasp.parse(table.data, table.offset);
                } catch (e) {
                    console.warn('Failed to parse gasp table, skipping.');
                    console.warn(e);
                }
                break;
            case 'SVG ':
                table = uncompressTable(data, tableEntry);
                font.tables.svg = svg.parse(table.data, table.offset);
                break;
            default:
                // console.info(`Skipping unsupported table ${tableEntry.tag}`);
                break;
        }
    }

    const nameTable = uncompressTable(data, nameTableEntry);
    font.tables.name = _name.parse(nameTable.data, nameTable.offset, ltagTable);
    font.names = font.tables.name;

    if (glyfTableEntry && locaTableEntry) {
        const shortVersion = indexToLocFormat === 0;
        const locaTable = uncompressTable(data, locaTableEntry);
        const locaOffsets = loca.parse(locaTable.data, locaTable.offset, font.numGlyphs, shortVersion);
        const glyfTable = uncompressTable(data, glyfTableEntry);
        font.glyphs = glyf.parse(glyfTable.data, glyfTable.offset, locaOffsets, font, opt);
    } else if (cffTableEntry) {
        const cffTable = uncompressTable(data, cffTableEntry);
        cff.parse(cffTable.data, cffTable.offset, font, opt);
        // the glyph names of a CFF font are in its charset, as the names of its
        // glyphs (see addGlyphNames): its post table usually has none (format 3)
        font.glyphNames = font.glyphNames || new GlyphNames({ version: 3 });
        font.glyphNames.names = font.cffEncoding.charset;
    } else if (cff2TableEntry) {
        const cffTable2 = uncompressTable(data, cff2TableEntry);
        cff.parse(cffTable2.data, cffTable2.offset, font, opt);
    } else {
        throw new Error('Font doesn\'t contain TrueType, CFF or CFF2 outlines.');
    }

    const hmtxTable = uncompressTable(data, hmtxTableEntry);
    hmtx.parse(font, hmtxTable.data, hmtxTable.offset, font.numberOfHMetrics, font.numGlyphs, font.glyphs, opt);
    addGlyphNames(font, opt);

    if (kernTableEntry) {
        const kernTable = uncompressTable(data, kernTableEntry);
        font.kerningPairs = kern.parse(kernTable.data, kernTable.offset);
    } else {
        font.kerningPairs = {};
    }

    if (gdefTableEntry) {
        const gdefTable = uncompressTable(data, gdefTableEntry);
        font.tables.gdef = gdef.parse(gdefTable.data, gdefTable.offset);
        // like HarfBuzz, the layout ignores the broken GDEF tables of a few known fonts
        const gsubLength = gsubTableEntry ? gsubTableEntry.length : 0;
        const gposLength = gposTableEntry ? gposTableEntry.length : 0;
        font.isGdefIgnoredByLayout = gdef.isBlocklisted(gdefTableEntry.length, gsubLength, gposLength);
    }

    if (gposTableEntry) {
        const gposTable = uncompressTable(data, gposTableEntry);
        font.tables.gpos = gpos.parse(gposTable.data, gposTable.offset);
        font.position.init();
    }

    if (gsubTableEntry) {
        const gsubTable = uncompressTable(data, gsubTableEntry);
        font.tables.gsub = gsub.parse(gsubTable.data, gsubTable.offset, font.names);
    }

    if (fvarTableEntry) {
        const fvarTable = uncompressTable(data, fvarTableEntry);
        font.tables.fvar = fvar.parse(fvarTable.data, fvarTable.offset, font.names);
    }

    if (statTableEntry) {
        const statTable = uncompressTable(data, statTableEntry);
        font.tables.stat = stat.parse(statTable.data, statTable.offset, font.tables.fvar);
    }

    if (gvarTableEntry) {
        if (!fvarTableEntry) {
            console.warn('This font provides a gvar table, but no fvar table, which is required for variable fonts.');
        }
        if (!glyfTableEntry) {
            console.warn('This font provides a gvar table, but no glyf table. Glyph variation only works with TrueType outlines.');
        }
        const gvarTable = uncompressTable(data, gvarTableEntry);
        font.tables.gvar = gvar.parse(gvarTable.data, gvarTable.offset, font.tables.fvar, font.glyphs);
    }

    if (cvarTableEntry) {
        if (!fvarTableEntry) {
            console.warn('This font provides a cvar table, but no fvar table, which is required for variable fonts.');
        }
        if (!font.tables.cvt) {
            console.warn('This font provides a cvar table, but no cvt table which could be made variable.');
        }
        if (!glyfTableEntry) {
            console.warn('This font provides a gvar table, but no glyf table. Glyph variation only works with TrueType outlines.');
        }
        const cvarTable = uncompressTable(data, cvarTableEntry);
        font.tables.cvar = cvar.parse(cvarTable.data, cvarTable.offset, font.tables.fvar, font.tables.cvt || []);
    }

    if (avarTableEntry) {
        if (!fvarTableEntry) {
            console.warn('This font provides an avar table, but no fvar table, which is required for variable fonts.');
        }
        const avarTable = uncompressTable(data, avarTableEntry);
        font.tables.avar = avar.parse(avarTable.data, avarTable.offset, font.tables.fvar);
    }

    if (hvarTableEntry) {
        if (!fvarTableEntry) {
            console.warn('This font provides an HVAR table, but no fvar table, which is required for variable fonts.');
        }

        if (!hmtxTableEntry) {
            console.warn('This font provides an HVAR table, but no hmtx table to vary.');
        }

        const hvarTable = uncompressTable(data, hvarTableEntry);
        font.tables.hvar = hvar.parse(hvarTable.data, hvarTable.offset, font.tables.fvar);
    }

    if (mvarTableEntry) {
        if (!fvarTableEntry) {
            console.warn('This font provides an MVAR table, but no fvar table, which is required for variable fonts.');
        }

        const mvarTable = uncompressTable(data, mvarTableEntry);
        font.tables.mvar = mvar.parse(mvarTable.data, mvarTable.offset);
    }

    if (metaTableEntry) {
        const metaTable = uncompressTable(data, metaTableEntry);
        font.tables.meta = meta.parse(metaTable.data, metaTable.offset);
        font.metas = font.tables.meta;
    }
    
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
