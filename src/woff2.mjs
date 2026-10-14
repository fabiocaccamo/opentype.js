// The WOFF2 format: https://www.w3.org/TR/WOFF2/
//
// A WOFF2 file stores all its tables in a single Brotli stream, and can
// transform the glyf/loca tables (and the hmtx table) into a smaller form.
// parseWOFF2TableEntries decompresses the stream and reconstructs the
// transformed tables, returning table entries that carry their own data, so
// that the tables are then parsed exactly as the ones of a TTF/OTF file.

import { BrotliDecode } from './brotli-decode@3499acb.mjs'; // from google/brotli

// the tags of the table directory, by index (§ 5.1, "Known Table Tags")
const KNOWN_TAGS = [
    'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
    'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
    'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
    'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];
const ARBITRARY_TAG_INDEX = 63;

const HEADER_SIZE = 48;

// transform versions (§ 5.1): glyf and loca are transformed with version 0
// and stored as they are with version 3, the other tables the other way round
const GLYF_TRANSFORM = 0;
const GLYF_NULL_TRANSFORM = 3;
const HMTX_NULL_TRANSFORM = 0;
const HMTX_TRANSFORM = 1;

// glyf transform header: 2 + 2 + 2 + 2 bytes, then 7 stream sizes
const GLYF_TRANSFORM_HEADER_SIZE = 36;
const GLYF_OPTION_OVERLAP_SIMPLE_BITMAP = 0x0001;

// simple glyph flags
const ON_CURVE_POINT = 0x01;
const X_SHORT_VECTOR = 0x02;
const Y_SHORT_VECTOR = 0x04;
const X_IS_SAME_OR_POSITIVE_X_SHORT_VECTOR = 0x10;
const Y_IS_SAME_OR_POSITIVE_Y_SHORT_VECTOR = 0x20;
const OVERLAP_SIMPLE = 0x40;

// composite glyph flags
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const WE_HAVE_INSTRUCTIONS = 0x0100;

// hmtx transform flags (§ 5.4)
const HMTX_NO_PROPORTIONAL_LSBS = 0x01;
const HMTX_NO_MONOSPACE_LSBS = 0x02;

// offsets of the fields read or written in the other tables
const HEAD_INDEX_TO_LOC_FORMAT_OFFSET = 50;
const HHEA_NUMBER_OF_HMETRICS_OFFSET = 34;
const MAXP_NUM_GLYPHS_OFFSET = 4;

function fail(message) {
    throw new Error('WOFF2: ' + message);
}

/**
 * Bounds-checked big-endian reader over a range of bytes.
 */
class Reader {
    /**
     * @param {Uint8Array} bytes
     * @param {string} name - used in the errors
     */
    constructor(bytes, name) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.name = name;
        this.offset = 0;
    }

    require(length) {
        if (this.offset + length > this.bytes.length) {
            fail('unexpected end of the ' + this.name);
        }
    }

    skip(length) {
        this.require(length);
        this.offset += length;
    }

    uint8() {
        this.require(1);
        return this.bytes[this.offset++];
    }

    uint16() {
        this.require(2);
        const value = this.view.getUint16(this.offset);
        this.offset += 2;
        return value;
    }

    int16() {
        this.require(2);
        const value = this.view.getInt16(this.offset);
        this.offset += 2;
        return value;
    }

    uint32() {
        this.require(4);
        const value = this.view.getUint32(this.offset);
        this.offset += 4;
        return value;
    }

    // UIntBase128 (§ 4.1): up to 5 bytes, 7 bits each, most significant first
    base128() {
        let value = 0;
        for (let i = 0; i < 5; i += 1) {
            const byte = this.uint8();
            if (i === 0 && byte === 0x80) {
                fail('UIntBase128 with leading zeros in the ' + this.name);
            }
            if (value & 0xFE000000) {
                fail('UIntBase128 overflow in the ' + this.name);
            }
            value = (value << 7) | (byte & 0x7F);
            if ((byte & 0x80) === 0) {
                return value >>> 0;
            }
        }
        fail('UIntBase128 longer than 5 bytes in the ' + this.name);
    }

    // 255UInt16 (§ 4.2)
    uint255() {
        const code = this.uint8();
        if (code === 253) {
            return this.uint16();
        }
        if (code === 255) {
            return this.uint8() + 253;
        }
        if (code === 254) {
            return this.uint8() + 253 * 2;
        }
        return code;
    }

    subarray(length) {
        this.require(length);
        const result = this.bytes.subarray(this.offset, this.offset + length);
        this.offset += length;
        return result;
    }
}

function tagFromUint32(value) {
    return String.fromCharCode((value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF);
}

function isGlyfOrLoca(tag) {
    return tag === 'glyf' || tag === 'loca';
}

/**
 * Reads the table directory (§ 5).
 * @param {Reader} reader - positioned at the first entry
 * @param {number} numTables
 * @return {Object[]}
 */
function readTableDirectory(reader, numTables) {
    const tables = [];
    const tags = new Set();
    for (let i = 0; i < numTables; i += 1) {
        const flags = reader.uint8();
        const tagIndex = flags & 0x3F;
        const tag = tagIndex === ARBITRARY_TAG_INDEX ? tagFromUint32(reader.uint32()) : KNOWN_TAGS[tagIndex];
        const transformVersion = flags >> 6;
        const origLength = reader.base128();
        const transformed = isGlyfOrLoca(tag) ? transformVersion !== GLYF_NULL_TRANSFORM : transformVersion !== 0;
        const transformLength = transformed ? reader.base128() : origLength;
        if (tags.has(tag)) {
            fail('duplicate table ' + tag);
        }
        tags.add(tag);
        tables.push({ tag, transformVersion, transformed, origLength, transformLength, bytes: null });
    }
    return tables;
}

/**
 * Checks the transforms of the tables (§ 5.1): glyf and loca are transformed
 * together, hmtx only together with glyf, no other table is transformed.
 * @param {Map<string, Object>} tablesByTag
 */
function validateTransforms(tablesByTag) {
    for (const table of tablesByTag.values()) {
        if (isGlyfOrLoca(table.tag)) {
            if (table.transformVersion !== GLYF_TRANSFORM && table.transformVersion !== GLYF_NULL_TRANSFORM) {
                fail('unknown transform ' + table.transformVersion + ' of the ' + table.tag + ' table');
            }
        } else if (table.tag === 'hmtx') {
            if (table.transformVersion !== HMTX_NULL_TRANSFORM && table.transformVersion !== HMTX_TRANSFORM) {
                fail('unknown transform ' + table.transformVersion + ' of the hmtx table');
            }
        } else if (table.transformed) {
            fail('unknown transform ' + table.transformVersion + ' of the ' + table.tag + ' table');
        }
    }
    const glyf = tablesByTag.get('glyf');
    const loca = tablesByTag.get('loca');
    if (glyf || loca) {
        if (!glyf || !loca) {
            fail('glyf and loca tables must be both present');
        }
        if (glyf.transformed !== loca.transformed) {
            fail('glyf and loca tables must have the same transform');
        }
        if (loca.transformed && loca.transformLength !== 0) {
            fail('transformed loca table with data');
        }
    }
    const hmtx = tablesByTag.get('hmtx');
    if (hmtx && hmtx.transformed && !(glyf && glyf.transformed)) {
        fail('transformed hmtx table without a transformed glyf table');
    }
}

/**
 * Growable byte buffer used to write the reconstructed glyf table.
 */
class Writer {
    constructor(capacity) {
        this.bytes = new Uint8Array(Math.max(capacity, 1024));
        this.length = 0;
    }

    reserve(length) {
        if (this.length + length > this.bytes.length) {
            let capacity = this.bytes.length * 2;
            while (capacity < this.length + length) {
                capacity *= 2;
            }
            const bytes = new Uint8Array(capacity);
            bytes.set(this.bytes.subarray(0, this.length));
            this.bytes = bytes;
        }
    }

    uint8(value) {
        this.reserve(1);
        this.bytes[this.length++] = value;
    }

    uint16(value) {
        this.reserve(2);
        this.bytes[this.length++] = (value >> 8) & 0xFF;
        this.bytes[this.length++] = value & 0xFF;
    }

    array(values) {
        this.reserve(values.length);
        this.bytes.set(values, this.length);
        this.length += values.length;
    }

    // pads with zeros to a multiple of 4 bytes, like the reference decoder
    pad4() {
        while (this.length % 4 !== 0) {
            this.uint8(0);
        }
    }

    result() {
        return this.bytes.slice(0, this.length);
    }
}

// sign of a triplet coordinate: bit 0 of the flag set means positive
function withSign(flag, value) {
    return (flag & 1) ? value : -value;
}

/**
 * Decodes the point coordinates of a simple glyph (§ 5.2, "Triplet Encoding").
 * @param {Uint8Array} flags - one flag per point
 * @param {Reader} glyphStream
 * @param {Int32Array} xs - output, absolute coordinates
 * @param {Int32Array} ys - output, absolute coordinates
 * @param {Uint8Array} onCurve - output, 1 for on-curve points
 */
function decodeTriplets(flags, glyphStream, xs, ys, onCurve) {
    let x = 0;
    let y = 0;
    for (let i = 0; i < flags.length; i += 1) {
        const flag = flags[i] & 0x7F;
        onCurve[i] = (flags[i] >> 7) === 0 ? 1 : 0;
        let dx;
        let dy;
        if (flag < 10) {
            dx = 0;
            dy = withSign(flag, ((flag & 14) << 7) + glyphStream.uint8());
        } else if (flag < 20) {
            dx = withSign(flag, (((flag - 10) & 14) << 7) + glyphStream.uint8());
            dy = 0;
        } else if (flag < 84) {
            const base = flag - 20;
            const byte = glyphStream.uint8();
            dx = withSign(flag, 1 + (base & 0x30) + (byte >> 4));
            dy = withSign(flag >> 1, 1 + ((base & 0x0C) << 2) + (byte & 0x0F));
        } else if (flag < 120) {
            const base = flag - 84;
            dx = withSign(flag, 1 + (Math.floor(base / 12) << 8) + glyphStream.uint8());
            dy = withSign(flag >> 1, 1 + (((base % 12) >> 2) << 8) + glyphStream.uint8());
        } else if (flag < 124) {
            const byte0 = glyphStream.uint8();
            const byte1 = glyphStream.uint8();
            const byte2 = glyphStream.uint8();
            dx = withSign(flag, (byte0 << 4) + (byte1 >> 4));
            dy = withSign(flag >> 1, ((byte1 & 0x0F) << 8) + byte2);
        } else {
            const byte0 = glyphStream.uint8();
            const byte1 = glyphStream.uint8();
            const byte2 = glyphStream.uint8();
            const byte3 = glyphStream.uint8();
            dx = withSign(flag, (byte0 << 8) + byte1);
            dy = withSign(flag >> 1, (byte2 << 8) + byte3);
        }
        x += dx;
        y += dy;
        xs[i] = x;
        ys[i] = y;
    }
}

/**
 * Writes the coordinates of a simple glyph in the glyf format: flags (with
 * the repeat flag), then the x and the y deltas, each as short or long.
 */
function writeSimpleGlyphPoints(writer, xs, ys, onCurve, overlap) {
    const pointCount = xs.length;
    const flags = new Uint8Array(pointCount);
    let xLength = 0;
    let yLength = 0;
    let previousX = 0;
    let previousY = 0;
    for (let i = 0; i < pointCount; i += 1) {
        const dx = xs[i] - previousX;
        const dy = ys[i] - previousY;
        let flag = onCurve[i] ? ON_CURVE_POINT : 0;
        if (i === 0 && overlap) {
            flag |= OVERLAP_SIMPLE;
        }
        if (dx === 0) {
            flag |= X_IS_SAME_OR_POSITIVE_X_SHORT_VECTOR;
        } else if (dx > -256 && dx < 256) {
            flag |= X_SHORT_VECTOR | (dx > 0 ? X_IS_SAME_OR_POSITIVE_X_SHORT_VECTOR : 0);
            xLength += 1;
        } else {
            xLength += 2;
        }
        if (dy === 0) {
            flag |= Y_IS_SAME_OR_POSITIVE_Y_SHORT_VECTOR;
        } else if (dy > -256 && dy < 256) {
            flag |= Y_SHORT_VECTOR | (dy > 0 ? Y_IS_SAME_OR_POSITIVE_Y_SHORT_VECTOR : 0);
            yLength += 1;
        } else {
            yLength += 2;
        }
        flags[i] = flag;
        previousX = xs[i];
        previousY = ys[i];
    }

    // flags, a run of equal flags written once with the repeat flag (0x08)
    for (let i = 0; i < pointCount;) {
        let repeat = 0;
        while (i + repeat + 1 < pointCount && flags[i + repeat + 1] === flags[i] && repeat < 255) {
            repeat += 1;
        }
        if (repeat > 0) {
            writer.uint8(flags[i] | 0x08);
            writer.uint8(repeat);
        } else {
            writer.uint8(flags[i]);
        }
        i += repeat + 1;
    }

    writer.reserve(xLength + yLength);
    for (const [coordinates, shortFlag] of [[xs, X_SHORT_VECTOR], [ys, Y_SHORT_VECTOR]]) {
        let previous = 0;
        for (let i = 0; i < pointCount; i += 1) {
            const delta = coordinates[i] - previous;
            previous = coordinates[i];
            if (delta === 0) {
                continue;
            }
            if (flags[i] & shortFlag) {
                writer.uint8(Math.abs(delta));
            } else {
                writer.uint16(delta & 0xFFFF);
            }
        }
    }
}

/**
 * Reconstructs the glyf and loca tables from the transformed glyf table
 * (§ 5.2 and § 5.3).
 * @param {Uint8Array} bytes - the transformed glyf table
 * @return {{ glyf: Uint8Array, loca: Uint8Array, indexFormat: number, xMins: Int16Array }}
 */
function reconstructGlyfAndLoca(bytes) {
    const header = new Reader(bytes, 'glyf transform header');
    header.skip(2); // reserved
    const optionFlags = header.uint16();
    const numGlyphs = header.uint16();
    const indexFormat = header.uint16();
    if (indexFormat > 1) {
        fail('unknown loca index format ' + indexFormat);
    }
    const streamSizes = [];
    for (let i = 0; i < 7; i += 1) {
        streamSizes.push(header.uint32());
    }

    const streamNames = ['nContour stream', 'nPoints stream', 'flag stream', 'glyph stream', 'composite stream', 'bbox stream', 'instruction stream'];
    const streams = [];
    let offset = GLYF_TRANSFORM_HEADER_SIZE;
    for (let i = 0; i < streamSizes.length; i += 1) {
        if (offset + streamSizes[i] > bytes.length) {
            fail('the ' + streamNames[i] + ' exceeds the glyf table');
        }
        streams.push(new Reader(bytes.subarray(offset, offset + streamSizes[i]), streamNames[i]));
        offset += streamSizes[i];
    }
    const [nContourStream, nPointsStream, flagStream, glyphStream, compositeStream, bboxStreamWithBitmap, instructionStream] = streams;

    const bboxBitmap = bboxStreamWithBitmap.subarray(4 * ((numGlyphs + 31) >> 5));
    const bboxStream = new Reader(bboxStreamWithBitmap.bytes.subarray(bboxStreamWithBitmap.offset), 'bbox stream');

    let overlapBitmap = null;
    if (optionFlags & GLYF_OPTION_OVERLAP_SIMPLE_BITMAP) {
        const overlapBitmapLength = (numGlyphs + 7) >> 3;
        if (offset + overlapBitmapLength > bytes.length) {
            fail('the overlapSimpleBitmap exceeds the glyf table');
        }
        overlapBitmap = bytes.subarray(offset, offset + overlapBitmapLength);
    }

    const isBitSet = (bitmap, index) => (bitmap[index >> 3] & (0x80 >> (index & 7))) !== 0;
    const readBbox = () => [bboxStream.int16(), bboxStream.int16(), bboxStream.int16(), bboxStream.int16()];

    const writer = new Writer(bytes.length * 2);
    const offsets = new Uint32Array(numGlyphs + 1);
    const xMins = new Int16Array(numGlyphs);

    for (let glyphIndex = 0; glyphIndex < numGlyphs; glyphIndex += 1) {
        offsets[glyphIndex] = writer.length;
        const numberOfContours = nContourStream.int16();
        const hasBbox = isBitSet(bboxBitmap, glyphIndex);

        if (numberOfContours === 0) {
            // empty glyph
            if (hasBbox) {
                fail('empty glyph ' + glyphIndex + ' with a bounding box');
            }
            continue;
        }

        if (numberOfContours === -1) {
            // composite glyph: the components are stored as they are
            if (!hasBbox) {
                fail('composite glyph ' + glyphIndex + ' without a bounding box');
            }
            const compositeStart = compositeStream.offset;
            let haveInstructions = false;
            let flags;
            do {
                flags = compositeStream.uint16();
                haveInstructions = haveInstructions || (flags & WE_HAVE_INSTRUCTIONS) !== 0;
                let argumentsLength = 2 + ((flags & ARG_1_AND_2_ARE_WORDS) ? 4 : 2); // glyph index + arguments
                if (flags & WE_HAVE_A_SCALE) {
                    argumentsLength += 2;
                } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
                    argumentsLength += 4;
                } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
                    argumentsLength += 8;
                }
                compositeStream.skip(argumentsLength);
            } while (flags & MORE_COMPONENTS);
            const components = compositeStream.bytes.subarray(compositeStart, compositeStream.offset);
            const bbox = readBbox();
            xMins[glyphIndex] = bbox[0];

            writer.uint16(0xFFFF); // numberOfContours -1
            for (const value of bbox) {
                writer.uint16(value & 0xFFFF);
            }
            writer.array(components);
            if (haveInstructions) {
                const instructionLength = glyphStream.uint255();
                writer.uint16(instructionLength);
                writer.array(instructionStream.subarray(instructionLength));
            }
            writer.pad4();
            continue;
        }

        if (numberOfContours < 0) {
            fail('invalid number of contours ' + numberOfContours + ' of glyph ' + glyphIndex);
        }

        // simple glyph
        const endPoints = new Uint16Array(numberOfContours);
        let pointCount = 0;
        for (let contour = 0; contour < numberOfContours; contour += 1) {
            pointCount += nPointsStream.uint255();
            if (pointCount > 0xFFFF) {
                fail('too many points in glyph ' + glyphIndex);
            }
            endPoints[contour] = pointCount - 1;
        }
        const pointFlags = flagStream.subarray(pointCount);
        const xs = new Int32Array(pointCount);
        const ys = new Int32Array(pointCount);
        const onCurve = new Uint8Array(pointCount);
        decodeTriplets(pointFlags, glyphStream, xs, ys, onCurve);
        const instructionLength = glyphStream.uint255();
        const instructions = instructionStream.subarray(instructionLength);

        let bbox;
        if (hasBbox) {
            bbox = readBbox();
        } else if (pointCount > 0) {
            bbox = [xs[0], ys[0], xs[0], ys[0]];
            for (let i = 1; i < pointCount; i += 1) {
                bbox[0] = Math.min(bbox[0], xs[i]);
                bbox[1] = Math.min(bbox[1], ys[i]);
                bbox[2] = Math.max(bbox[2], xs[i]);
                bbox[3] = Math.max(bbox[3], ys[i]);
            }
        } else {
            bbox = [0, 0, 0, 0];
        }
        xMins[glyphIndex] = bbox[0];

        writer.uint16(numberOfContours);
        for (const value of bbox) {
            writer.uint16(value & 0xFFFF);
        }
        for (let contour = 0; contour < numberOfContours; contour += 1) {
            writer.uint16(endPoints[contour]);
        }
        writer.uint16(instructionLength);
        writer.array(instructions);
        const overlap = overlapBitmap !== null && isBitSet(overlapBitmap, glyphIndex);
        writeSimpleGlyphPoints(writer, xs, ys, onCurve, overlap);
        writer.pad4();
    }
    offsets[numGlyphs] = writer.length;

    // loca, in the format of the transform header
    const loca = new Uint8Array((numGlyphs + 1) * (indexFormat ? 4 : 2));
    const locaView = new DataView(loca.buffer);
    for (let i = 0; i <= numGlyphs; i += 1) {
        if (indexFormat) {
            locaView.setUint32(i * 4, offsets[i]);
        } else {
            if (offsets[i] / 2 > 0xFFFF) {
                fail('glyf table too large for the short loca format');
            }
            locaView.setUint16(i * 2, offsets[i] / 2);
        }
    }

    return { glyf: writer.result(), loca, indexFormat, xMins };
}

/**
 * Reconstructs the hmtx table from the transformed hmtx table (§ 5.4): the
 * left side bearings left out are the xMin of the glyphs.
 * @param {Uint8Array} bytes - the transformed hmtx table
 * @param {number} numberOfHMetrics
 * @param {number} numGlyphs
 * @param {Int16Array} xMins
 * @return {Uint8Array}
 */
function reconstructHmtx(bytes, numberOfHMetrics, numGlyphs, xMins) {
    if (numberOfHMetrics < 1 || numberOfHMetrics > numGlyphs) {
        fail('invalid numberOfHMetrics ' + numberOfHMetrics);
    }
    const reader = new Reader(bytes, 'hmtx table');
    const flags = reader.uint8();
    if (flags & ~(HMTX_NO_PROPORTIONAL_LSBS | HMTX_NO_MONOSPACE_LSBS)) {
        fail('reserved hmtx transform flags set');
    }
    const advanceWidths = new Uint16Array(numberOfHMetrics);
    for (let i = 0; i < numberOfHMetrics; i += 1) {
        advanceWidths[i] = reader.uint16();
    }
    const xMinOf = (glyphIndex) => glyphIndex < xMins.length ? xMins[glyphIndex] : 0;

    const hmtx = new Uint8Array(numberOfHMetrics * 4 + (numGlyphs - numberOfHMetrics) * 2);
    const view = new DataView(hmtx.buffer);
    for (let i = 0; i < numberOfHMetrics; i += 1) {
        const leftSideBearing = (flags & HMTX_NO_PROPORTIONAL_LSBS) ? xMinOf(i) : reader.int16();
        view.setUint16(i * 4, advanceWidths[i]);
        view.setInt16(i * 4 + 2, leftSideBearing);
    }
    for (let i = numberOfHMetrics; i < numGlyphs; i += 1) {
        const leftSideBearing = (flags & HMTX_NO_MONOSPACE_LSBS) ? xMinOf(i) : reader.int16();
        view.setInt16(numberOfHMetrics * 4 + (i - numberOfHMetrics) * 2, leftSideBearing);
    }
    return hmtx;
}

function readUint16At(table, offset, name) {
    if (!table || table.bytes.length < offset + 2) {
        fail('missing or truncated ' + name + ' table');
    }
    return (table.bytes[offset] << 8) | table.bytes[offset + 1];
}

/**
 * Parses the table entries of a WOFF2 file, decompressing all the tables and
 * reconstructing the transformed ones. Each entry carries its table in `data`
 * (a DataView of the table alone), see uncompressTable.
 * Font collections (flavor 'ttcf') are not supported.
 * @param {DataView} data - the whole WOFF2 file
 * @return {Object[]}
 */
function parseWOFF2TableEntries(data) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const header = new Reader(bytes, 'WOFF2 header');
    if (header.uint32() !== 0x774F4632) { // 'wOF2'
        fail('invalid signature');
    }
    const flavor = header.uint32();
    if (flavor === 0x74746366) { // 'ttcf'
        fail('font collections are not supported');
    }
    header.skip(4); // length
    const numTables = header.uint16();
    if (numTables === 0) {
        fail('no tables');
    }
    header.skip(2); // reserved
    header.skip(4); // totalSfntSize
    const totalCompressedSize = header.uint32();
    header.skip(HEADER_SIZE - header.offset); // version, metadata and private data blocks

    const tables = readTableDirectory(header, numTables);
    const compressed = header.subarray(totalCompressedSize);

    let decompressed;
    try {
        decompressed = BrotliDecode(new Int8Array(compressed.buffer, compressed.byteOffset, compressed.length));
    } catch (error) {
        fail('invalid Brotli stream (' + error.message + ')');
    }
    const stream = new Reader(new Uint8Array(decompressed.buffer, decompressed.byteOffset, decompressed.length), 'decompressed tables');
    for (const table of tables) {
        table.bytes = stream.subarray(table.transformLength);
    }

    const tablesByTag = new Map(tables.map(table => [table.tag, table]));
    validateTransforms(tablesByTag);

    const glyf = tablesByTag.get('glyf');
    if (glyf && glyf.transformed) {
        const loca = tablesByTag.get('loca');
        const reconstructed = reconstructGlyfAndLoca(glyf.bytes);
        glyf.bytes = reconstructed.glyf;
        loca.bytes = reconstructed.loca;

        // the loca format of the transform header wins over the head table
        const head = tablesByTag.get('head');
        if (readUint16At(head, HEAD_INDEX_TO_LOC_FORMAT_OFFSET, 'head') !== reconstructed.indexFormat) {
            head.bytes = head.bytes.slice();
            new DataView(head.bytes.buffer).setUint16(HEAD_INDEX_TO_LOC_FORMAT_OFFSET, reconstructed.indexFormat);
        }

        const hmtx = tablesByTag.get('hmtx');
        if (hmtx && hmtx.transformed) {
            const numberOfHMetrics = readUint16At(tablesByTag.get('hhea'), HHEA_NUMBER_OF_HMETRICS_OFFSET, 'hhea');
            const numGlyphs = readUint16At(tablesByTag.get('maxp'), MAXP_NUM_GLYPHS_OFFSET, 'maxp');
            hmtx.bytes = reconstructHmtx(hmtx.bytes, numberOfHMetrics, numGlyphs, reconstructed.xMins);
        }
    }

    return tables.map(table => {
        // each table in a buffer of its own, starting at 0 like the WOFF tables
        const tableBytes = table.bytes.byteOffset === 0 && table.bytes.byteLength === table.bytes.buffer.byteLength ? table.bytes : table.bytes.slice();
        return {
            tag: table.tag,
            offset: 0,
            length: tableBytes.length,
            compression: 'WOFF2',
            data: new DataView(tableBytes.buffer),
        };
    });
}

export { parseWOFF2TableEntries };
