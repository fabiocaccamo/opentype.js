// The `kern` table contains kerning pairs.
// Note that some fonts use the GPOS OpenType layout table to specify kerning.
// https://www.microsoft.com/typography/OTSPEC/kern.htm
// Like HarfBuzz, the values of a pair in all the format 0 subtables of horizontal kerning add up (the minimum and
// override bits are ignored), and the vertical, cross-stream and variation subtables are skipped.
// The format 2 subtables (classes) are not read yet.
// Like the sanitizer of HarfBuzz, a table gives no pairs when a subtable is shorter than its header, or when
// a subtable but the last one is shorter than its format 0 pairs: the last subtable is read by its count of
// pairs, since its length can overflow its 16 bits. The version of a subtable is ignored.

import parse from '../parse.mjs';

// coverage bits of a subtable of the OpenType kern table (version 0), the format is the high byte
const WINDOWS_HORIZONTAL = 0x0001;
const WINDOWS_CROSS_STREAM = 0x0004;
const WINDOWS_HEADER_SIZE = 6;
// coverage bits of a subtable of the Apple kern table (version 1), the format is the low byte
const MAC_VERTICAL = 0x8000;
const MAC_CROSS_STREAM = 0x4000;
const MAC_VARIATION = 0x2000;
const MAC_HEADER_SIZE = 8;
// nPairs, searchRange, entrySelector and rangeShift, then 6 bytes by pair
const FORMAT_0_HEADER_SIZE = 8;
const FORMAT_0_PAIR_SIZE = 6;

// Whether the length of a subtable holds its header and, in format 0 and unless it is the last subtable,
// its pairs, given the parser just after its header.
function holdsSubtable(parser, subtableLength, headerSize, format, isLastSubtable) {
    if (subtableLength < headerSize) {
        return false;
    }
    if (format !== 0 || isLastSubtable) {
        return true;
    }
    const pairCount = parse.getUShort(parser.data, parser.offset + parser.relativeOffset);
    return headerSize + FORMAT_0_HEADER_SIZE + pairCount * FORMAT_0_PAIR_SIZE <= subtableLength;
}

// The pairs of a format 0 subtable, reading as many pairs as nPairs says (the length of a big subtable can
// overflow its 16 bits). HarfBuzz finds one record of a pair in a subtable (a binary search): a pair listed
// twice, which the spec does not allow, keeps its first record, the one HarfBuzz finds for two records.
function parseFormat0Pairs(parser) {
    const pairs = {};
    const pairCount = parser.parseUShort();
    // Skip searchRange, entrySelector, rangeShift.
    parser.skip('uShort', 3);
    for (let i = 0; i < pairCount; i += 1) {
        const leftIndex = parser.parseUShort();
        const rightIndex = parser.parseUShort();
        const value = parser.parseShort();
        const key = leftIndex + ',' + rightIndex;
        if (!(key in pairs)) {
            pairs[key] = value;
        }
    }
    return pairs;
}

// Add the values of the pairs of a subtable to the pairs of the table.
function addSubtablePairs(pairs, subtablePairs) {
    for (const key of Object.keys(subtablePairs)) {
        pairs[key] = (pairs[key] || 0) + subtablePairs[key];
    }
}

function parseWindowsKernTable(parser) {
    const pairs = {};
    const subtableCount = parser.parseUShort();
    for (let i = 0; i < subtableCount; i += 1) {
        const subtableStart = parser.relativeOffset;
        // Skip the version.
        parser.skip('uShort');
        const subtableLength = parser.parseUShort();
        const coverage = parser.parseUShort();
        const format = coverage >> 8;
        if (!holdsSubtable(parser, subtableLength, WINDOWS_HEADER_SIZE, format, i === subtableCount - 1)) {
            return {};
        }
        if (format === 0 && (coverage & WINDOWS_HORIZONTAL) && !(coverage & WINDOWS_CROSS_STREAM)) {
            addSubtablePairs(pairs, parseFormat0Pairs(parser));
        }
        parser.relativeOffset = subtableStart + subtableLength;
    }
    return pairs;
}

function parseMacKernTable(parser) {
    const pairs = {};
    // The Mac kern table stores the version as a fixed (32 bits) but we only loaded the first 16 bits.
    // Skip the rest.
    parser.skip('uShort');
    const subtableCount = parser.parseULong();
    for (let i = 0; i < subtableCount; i += 1) {
        const subtableStart = parser.relativeOffset;
        const subtableLength = parser.parseULong();
        const coverage = parser.parseUShort();
        // Skip tupleIndex.
        parser.skip('uShort');
        const format = coverage & 0xFF;
        if (!holdsSubtable(parser, subtableLength, MAC_HEADER_SIZE, format, i === subtableCount - 1)) {
            return {};
        }
        if (format === 0 && !(coverage & (MAC_VERTICAL | MAC_CROSS_STREAM | MAC_VARIATION))) {
            addSubtablePairs(pairs, parseFormat0Pairs(parser));
        }
        parser.relativeOffset = subtableStart + subtableLength;
    }
    return pairs;
}

// Parse the `kern` table which contains kerning pairs.
function parseKernTable(data, start) {
    const parser = new parse.Parser(data, start);
    const tableVersion = parser.parseUShort();
    if (tableVersion === 0) {
        return parseWindowsKernTable(parser);
    } else if (tableVersion === 1) {
        return parseMacKernTable(parser);
    } else {
        throw new Error('Unsupported kern table version (' + tableVersion + ').');
    }
}

export default { parse: parseKernTable };
