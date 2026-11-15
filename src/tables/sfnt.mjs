// The `sfnt` wrapper provides organization for the tables in the font.
// It is the top-level data structure in a font.
// https://www.microsoft.com/typography/OTSPEC/otff.htm
// Recommendations for creating OpenType Fonts:
// http://www.microsoft.com/typography/otspec140/recom.htm

import check from '../check.mjs';
import table from '../table.mjs';

import cmap from './cmap.mjs';
import cff from './cff.mjs';
import head from './head.mjs';
import hhea from './hhea.mjs';
import hmtx from './hmtx.mjs';
import ltag from './ltag.mjs';
import maxp from './maxp.mjs';
import _name from './name.mjs';
import os2 from './os2.mjs';
import post from './post.mjs';
import gsub from './gsub.mjs';
import meta from './meta.mjs';
import colr from './colr.mjs';
import cpal from './cpal.mjs';
import fvar from './fvar.mjs';
import stat from './stat.mjs';
import avar from './avar.mjs';
import cvar from './cvar.mjs';
import gvar from './gvar.mjs';
import gasp from './gasp.mjs';
import svg from './svg.mjs';

const SFNT_HEADER_SIZE = 12;
const SFNT_TABLE_RECORD_SIZE = 16;
const HEAD_CHECKSUM_ADJUSTMENT_OFFSET = 8;
const CHECKSUM_ADJUSTMENT_BASE = 0xB1B0AFBA;

function log2(v) {
    return Math.log(v) / Math.log(2) | 0;
}

function computeCheckSum(bytes) {
    let sum = 0;
    // This rounds to integer multiples of 4.
    const padded = (bytes.length + 3) & ~3;
    for (let i = 0; i < padded; i += 4) {
        // Mask each byte to 0xFF: the byte array may contain values > 255 due to
        // M.CHARARRAY encoding non-ASCII strings with full Unicode codepoints.
        // Uint8Array (used for file output) truncates to 8 bits, so we must do the
        // same here to produce a checksum that matches the actual file bytes.
        const word = (
            ((bytes[i]     || 0) & 0xFF) << 24 |
            ((bytes[i + 1] || 0) & 0xFF) << 16 |
            ((bytes[i + 2] || 0) & 0xFF) << 8  |
            ((bytes[i + 3] || 0) & 0xFF)
        ) >>> 0;
        // modulo 2^32 at every word: past 2^53 the sum of a table larger than 8 MB would lose bits
        sum = (sum + word) >>> 0;
    }
    return sum;
}

/**
 * The fields of the table directory for a binary search of its records
 * (fontTools getSearchRange: rangeShift is 0 for an empty directory)
 * @param {number} numTables
 * @return {{searchRange: number, entrySelector: number, rangeShift: number}}
 */
function getTableDirectorySearchFields(numTables) {
    const entrySelector = numTables > 0 ? log2(numTables) : 0;
    const searchRange = SFNT_TABLE_RECORD_SIZE * Math.pow(2, entrySelector);
    const rangeShift = Math.max(0, numTables * SFNT_TABLE_RECORD_SIZE - searchRange);
    return { searchRange, entrySelector, rangeShift };
}

function compareTableTags(table1, table2) {
    if (table1.tag < table2.tag) {
        return -1;
    }
    if (table1.tag > table2.tag) {
        return 1;
    }
    return 0;
}

function writeTag(view, offset, tag) {
    for (let i = 0; i < 4; i += 1) {
        view.setUint8(offset + i, tag.charCodeAt(i));
    }
}

/**
 * Encodes an sfnt font file from the bytes of its tables, copied as they are: the table records sorted by tag, each
 * table 4-byte aligned with zero padding, the checksums of the tables and head.checkSumAdjustment computed (the checksum
 * of the head table with checkSumAdjustment set to 0, as the OpenType specification requires)
 * @param {string} sfntVersion - the tag of the sfnt version: '\0\x01\0\0', 'true', 'typ1' or 'OTTO'
 * @param {Array<{tag: string, bytes: Uint8Array}>} tables - one table per tag, in any order
 * @return {ArrayBuffer}
 */
function encodeSfntFile(sfntVersion, tables) {
    const sortedTables = tables.slice().sort(compareTableTags);
    for (let i = 1; i < sortedTables.length; i += 1) {
        if (sortedTables[i].tag === sortedTables[i - 1].tag) {
            throw new Error('Duplicate table ' + sortedTables[i].tag);
        }
    }

    const directoryLength = SFNT_HEADER_SIZE + SFNT_TABLE_RECORD_SIZE * sortedTables.length;
    const tableOffsets = [];
    let fileLength = directoryLength;
    for (const table of sortedTables) {
        tableOffsets.push(fileLength);
        fileLength += (table.bytes.length + 3) & ~3;
    }

    const bytes = new Uint8Array(fileLength);
    const view = new DataView(bytes.buffer);
    const { searchRange, entrySelector, rangeShift } = getTableDirectorySearchFields(sortedTables.length);
    writeTag(view, 0, sfntVersion);
    view.setUint16(4, sortedTables.length);
    view.setUint16(6, searchRange);
    view.setUint16(8, entrySelector);
    view.setUint16(10, rangeShift);

    let fileCheckSum = 0;
    let headOffset = -1;
    for (let i = 0; i < sortedTables.length; i += 1) {
        const table = sortedTables[i];
        const offset = tableOffsets[i];
        bytes.set(table.bytes, offset);
        if (table.tag === 'head') {
            if (table.bytes.length < HEAD_CHECKSUM_ADJUSTMENT_OFFSET + 4) {
                throw new Error('The head table is too short to hold checkSumAdjustment');
            }
            headOffset = offset;
            view.setUint32(offset + HEAD_CHECKSUM_ADJUSTMENT_OFFSET, 0);
        }
        const checkSum = computeCheckSum(bytes.subarray(offset, offset + table.bytes.length));
        const recordOffset = SFNT_HEADER_SIZE + SFNT_TABLE_RECORD_SIZE * i;
        writeTag(view, recordOffset, table.tag);
        view.setUint32(recordOffset + 4, checkSum);
        view.setUint32(recordOffset + 8, offset);
        view.setUint32(recordOffset + 12, table.bytes.length);
        fileCheckSum = (fileCheckSum + checkSum) >>> 0;
    }

    // the tables are 4-byte aligned and zero padded: the checksum of the file is the sum of the one of the directory
    // and the ones of the tables
    fileCheckSum = (fileCheckSum + computeCheckSum(bytes.subarray(0, directoryLength))) >>> 0;
    if (headOffset !== -1) {
        view.setUint32(headOffset + HEAD_CHECKSUM_ADJUSTMENT_OFFSET, (CHECKSUM_ADJUSTMENT_BASE - fileCheckSum) >>> 0);
    }
    return bytes.buffer;
}

function makeTableRecord(tag, checkSum, offset, length) {
    return new table.Record('Table Record', [
        {name: 'tag', type: 'TAG', value: tag !== undefined ? tag : ''},
        {name: 'checkSum', type: 'ULONG', value: checkSum !== undefined ? checkSum : 0},
        {name: 'offset', type: 'ULONG', value: offset !== undefined ? offset : 0},
        {name: 'length', type: 'ULONG', value: length !== undefined ? length : 0}
    ]);
}

function makeSfntTable(tables) {
    const sfnt = new table.Table('sfnt', [
        {name: 'version', type: 'TAG', value: 'OTTO'},
        {name: 'numTables', type: 'USHORT', value: 0},
        {name: 'searchRange', type: 'USHORT', value: 0},
        {name: 'entrySelector', type: 'USHORT', value: 0},
        {name: 'rangeShift', type: 'USHORT', value: 0}
    ]);
    sfnt.tables = tables;
    sfnt.numTables = tables.length;
    Object.assign(sfnt, getTableDirectorySearchFields(sfnt.numTables));

    const recordFields = [];
    const tableFields = [];

    let offset = sfnt.sizeOf() + (makeTableRecord().sizeOf() * sfnt.numTables);
    while (offset % 4 !== 0) {
        offset += 1;
        tableFields.push({name: 'padding', type: 'BYTE', value: 0});
    }

    for (let i = 0; i < tables.length; i += 1) {
        const t = tables[i];
        check.argument(t.tableName.length === 4, 'Table name' + t.tableName + ' is invalid.');
        const tableLength = t.sizeOf();
        const tableRecord = makeTableRecord(t.tableName, computeCheckSum(t.encode()), offset, tableLength);
        recordFields.push({name: tableRecord.tag + ' Table Record', type: 'RECORD', value: tableRecord});
        tableFields.push({name: t.tableName + ' table', type: 'RECORD', value: t});
        offset += tableLength;
        check.argument(!isNaN(offset), 'Something went wrong calculating the offset.');
        while (offset % 4 !== 0) {
            offset += 1;
            tableFields.push({name: 'padding', type: 'BYTE', value: 0});
        }
    }

    // Table records need to be sorted alphabetically.
    recordFields.sort(function(r1, r2) {
        if (r1.value.tag > r2.value.tag) {
            return 1;
        } else {
            return -1;
        }
    });

    sfnt.fields = sfnt.fields.concat(recordFields);
    sfnt.fields = sfnt.fields.concat(tableFields);
    return sfnt;
}

// Get the metrics for a character. If the string has more than one character
// this function returns metrics for the first available character.
// You can provide optional fallback metrics if no characters are available.
function metricsForChar(font, chars, notFoundMetrics) {
    for (let i = 0; i < chars.length; i += 1) {
        const glyphIndex = font.charToGlyphIndex(chars[i]);
        if (glyphIndex > 0) {
            const glyph = font.glyphs.get(glyphIndex);
            return glyph.getMetrics();
        }
    }

    return notFoundMetrics;
}

function average(vs) {
    let sum = 0;
    for (let i = 0; i < vs.length; i += 1) {
        sum += vs[i];
    }

    return sum / vs.length;
}

// Convert the font object to a SFNT data structure.
// This structure contains all the necessary tables and metadata to create a binary OTF file.
function fontToSfntTable(font) {
    const xMins = [];
    const yMins = [];
    const xMaxs = [];
    const yMaxs = [];
    const advanceWidths = [];
    const leftSideBearings = [];
    const rightSideBearings = [];
    let firstCharIndex;
    let lastCharIndex = 0;
    let ulUnicodeRange1 = 0;
    let ulUnicodeRange2 = 0;
    let ulUnicodeRange3 = 0;
    let ulUnicodeRange4 = 0;

    for (let i = 0; i < font.glyphs.length; i += 1) {
        const glyph = font.glyphs.get(i);
        const unicode = glyph.unicode | 0;

        if (isNaN(glyph.advanceWidth)) {
            throw new Error('Glyph ' + glyph.name + ' (' + i + '): advanceWidth is not a number.');
        }

        if (firstCharIndex > unicode || firstCharIndex === undefined) {
            // ignore .notdef char
            if (unicode > 0) {
                firstCharIndex = unicode;
            }
        }

        if (lastCharIndex < unicode) {
            lastCharIndex = unicode;
        }

        const position = os2.getUnicodeRange(unicode);
        if (position < 32) {
            ulUnicodeRange1 |= 1 << position;
        } else if (position < 64) {
            ulUnicodeRange2 |= 1 << position - 32;
        } else if (position < 96) {
            ulUnicodeRange3 |= 1 << position - 64;
        } else if (position < 123) {
            ulUnicodeRange4 |= 1 << position - 96;
        } else {
            throw new Error('Unicode ranges bits > 123 are reserved for internal usage');
        }
        // Skip non-important characters.
        if (glyph.name === '.notdef') continue;
        const metrics = glyph.getMetrics();
        xMins.push(metrics.xMin);
        yMins.push(metrics.yMin);
        xMaxs.push(metrics.xMax);
        yMaxs.push(metrics.yMax);
        leftSideBearings.push(metrics.leftSideBearing);
        rightSideBearings.push(metrics.rightSideBearing);
        advanceWidths.push(glyph.advanceWidth);
    }

    const globals = {
        xMin: Math.min.apply(null, xMins),
        yMin: Math.min.apply(null, yMins),
        xMax: Math.max.apply(null, xMaxs),
        yMax: Math.max.apply(null, yMaxs),
        advanceWidthMax: Math.max.apply(null, advanceWidths),
        advanceWidthAvg: average(advanceWidths),
        minLeftSideBearing: Math.min.apply(null, leftSideBearings),
        maxLeftSideBearing: Math.max.apply(null, leftSideBearings),
        minRightSideBearing: Math.min.apply(null, rightSideBearings)
    };
    globals.ascender = font.ascender;
    globals.descender = font.descender;

    // macStyle bits must agree with the fsSelection bits
    let macStyle = 0;
    if (font.weightClass >= 600) {
        macStyle |= font.macStyleValues.BOLD;
    }
    if (font.italicAngle < 0) {
        macStyle |= font.macStyleValues.ITALIC;
    } 

    const headTable = head.make({
        flags: 3, // 00000011 (baseline for font at y=0; left sidebearing point at x=0)
        unitsPerEm: font.unitsPerEm,
        xMin: globals.xMin,
        yMin: globals.yMin,
        xMax: globals.xMax,
        yMax: globals.yMax,
        lowestRecPPEM: 3,
        macStyle: macStyle,
        createdTimestamp: font.createdTimestamp
    });

    const hheaTable = hhea.make({
        ascender: globals.ascender,
        descender: globals.descender,
        advanceWidthMax: globals.advanceWidthMax,
        minLeftSideBearing: globals.minLeftSideBearing,
        minRightSideBearing: globals.minRightSideBearing,
        xMaxExtent: globals.maxLeftSideBearing + (globals.xMax - globals.xMin),
        numberOfHMetrics: font.glyphs.length,
    });

    const maxpTable = maxp.make(font.glyphs.length);

    const os2Table = os2.make(Object.assign({
        xAvgCharWidth: Math.round(globals.advanceWidthAvg),
        usFirstCharIndex: firstCharIndex,
        usLastCharIndex: lastCharIndex,
        ulUnicodeRange1: ulUnicodeRange1,
        ulUnicodeRange2: ulUnicodeRange2,
        ulUnicodeRange3: ulUnicodeRange3,
        ulUnicodeRange4: ulUnicodeRange4,
        // See http://typophile.com/node/13081 for more info on vertical metrics.
        // We get metrics for typical characters (such as "x" for xHeight).
        // We provide some fallback characters if characters are unavailable: their
        // ordering was chosen experimentally.
        sTypoAscender: globals.ascender,
        sTypoDescender: globals.descender,
        sTypoLineGap: 0,
        usWinAscent: globals.yMax,
        usWinDescent: Math.abs(globals.yMin),
        ulCodePageRange1: 1, // FIXME: hard-code Latin 1 support for now
        sxHeight: metricsForChar(font, 'xyvw', {yMax: Math.round(globals.ascender / 2)}).yMax,
        sCapHeight: metricsForChar(font, 'HIKLEFJMNTZBDPRAGOQSUVWXY', globals).yMax,
        usDefaultChar: font.hasChar(' ') ? 32 : 0, // Use space as the default character, if available.
        usBreakChar: font.hasChar(' ') ? 32 : 0, // Use space as the break character, if available.
    }, font.tables.os2));

    const hmtxTable = hmtx.make(font.glyphs);
    const cmapTable = cmap.make(font.glyphs);

    const englishFamilyName = font.getEnglishName('fontFamily');
    const englishStyleName = font.getEnglishName('fontSubfamily');
    const englishFullName = englishFamilyName + ' ' + englishStyleName;
    let postScriptName = font.getEnglishName('postScriptName');
    if (!postScriptName) {
        if (englishFamilyName === undefined || englishStyleName === undefined) {
            throw new Error('A font without the English postScriptName name, nor the fontFamily and fontSubfamily names to make it from (e.g. a parsed font without a name table), cannot be written.');
        }
        postScriptName = englishFamilyName.replace(/\s/g, '') + '-' + englishStyleName;
    }

    const names = {};
    for (let n in font.names) {
        names[n] = font.names[n];
    }

    names.unicode = names.unicode || {};
    names.macintosh = names.macintosh || {};
    names.windows = names.windows || {};

    const fontNamesUnicode = font.names.unicode || {};
    const fontNamesMacintosh = font.names.macintosh || {};
    const fontNamesWindows = font.names.windows || {};

    // do this as a loop to reduce redundant code
    for (const platform in names) {

        names[platform] = names[platform] || {};

        if (!names[platform].uniqueID) {
            const manufacturer = font.getEnglishName('manufacturer') || '';
            names[platform].uniqueID = { en: `${manufacturer}: ${englishFullName}` };
        }

        if (!names[platform].postScriptName) {
            names[platform].postScriptName = {en: postScriptName};
        }
    }

    // this cannot be done as a loop as each one is unique.
    if (!names.unicode.preferredFamily) {
        names.unicode.preferredFamily = fontNamesUnicode.fontFamily || fontNamesMacintosh.fontFamily || fontNamesWindows.fontFamily;
    }

    if (!names.macintosh.preferredFamily) {
        names.macintosh.preferredFamily = fontNamesMacintosh.fontFamily || fontNamesUnicode.fontFamily || fontNamesWindows.fontFamily;
    }

    if (!names.windows.preferredFamily) {
        names.windows.preferredFamily = fontNamesWindows.fontFamily || fontNamesUnicode.fontFamily || fontNamesMacintosh.fontFamily;
    }

    if (!names.unicode.preferredSubfamily) {
        names.unicode.preferredSubfamily = fontNamesUnicode.fontSubfamily || fontNamesMacintosh.fontSubfamily || fontNamesWindows.fontSubfamily;
    }

    if (!names.macintosh.preferredSubfamily) {
        names.macintosh.preferredSubfamily = fontNamesMacintosh.fontSubfamily || fontNamesUnicode.fontSubfamily || fontNamesWindows.fontSubfamily;
    }

    if (!names.windows.preferredSubfamily) {
        names.windows.preferredSubfamily = fontNamesWindows.fontSubfamily || fontNamesUnicode.fontSubfamily || fontNamesMacintosh.fontSubfamily;
    }

    const languageTags = [];
    const nameTable = _name.make(names, languageTags);
    const ltagTable = (languageTags.length > 0 ? ltag.make(languageTags) : undefined);

    const postTable = post.make(font);
    const cffTable = cff.make(font.glyphs, {
        version: font.getEnglishName('version'),
        fullName: englishFullName,
        familyName: englishFamilyName,
        weightName: englishStyleName,
        postScriptName: postScriptName,
        unitsPerEm: font.unitsPerEm,
        fontBBox: [0, globals.yMin, globals.ascender, globals.advanceWidthMax],
        topDict: font.tables.cff && font.tables.cff.topDict || {}
    });

    const metaTable = (font.metas && Object.keys(font.metas).length > 0) ? meta.make(font.metas) : undefined;

    // The order does not matter because makeSfntTable() will sort them.
    const tables = [headTable, hheaTable, maxpTable, os2Table, nameTable, cmapTable, postTable, cffTable, hmtxTable];
    if (ltagTable) {
        tables.push(ltagTable);
    }

    // Optional tables
    const optionalTables = {
        gsub,
        cpal,
        colr,
        stat,
        avar,
        cvar,
        fvar, 
        gvar,
        gasp,
        svg,
    };

    const optionalTableArgs = {
        avar: [font.tables.fvar],
        fvar: [font.names],
    };

    for (let tableName in optionalTables) {
        const table = font.tables[tableName];
        if (table) {
            const tableData = optionalTables[tableName].make.call(font, table, ...(optionalTableArgs[tableName] || []));
            if (tableData) {
                tables.push(tableData);
            }
        }
    }

    if (metaTable) {
        tables.push(metaTable);
    }

    const sfntTable = makeSfntTable(tables);

    // Compute the font's checkSum and store it in head.checkSumAdjustment.
    const bytes = sfntTable.encode();
    const checkSum = computeCheckSum(bytes);
    const tableFields = sfntTable.fields;
    let checkSumAdjusted = false;
    for (let i = 0; i < tableFields.length; i += 1) {
        if (tableFields[i].name === 'head table') {
            tableFields[i].value.checkSumAdjustment = (CHECKSUM_ADJUSTMENT_BASE - checkSum) >>> 0;
            checkSumAdjusted = true;
            break;
        }
    }

    if (!checkSumAdjusted) {
        throw new Error('Could not find head table with checkSum to adjust.');
    }

    return sfntTable;
}

export { SFNT_HEADER_SIZE, SFNT_TABLE_RECORD_SIZE };

export default { make: makeSfntTable, fontToTable: fontToSfntTable, computeCheckSum, encodeFile: encodeSfntFile };
