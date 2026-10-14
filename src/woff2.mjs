// The WOFF2 format: https://www.w3.org/TR/WOFF2/
//
// A WOFF2 file stores all its tables in a single Brotli stream, and can
// transform the glyf/loca tables (and the hmtx table) into a smaller form.
// parseWOFF2TableEntries decompresses the stream and reconstructs the
// transformed tables, returning table entries that carry their own data, so
// that the tables are then parsed exactly as the ones of a TTF/OTF file.

import { BrotliDecode } from './brotli-decode@3499acb.mjs'; // from google/brotli
import parse from './parse.mjs';

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

    tag() {
        this.require(4);
        const value = parse.getTag(this.view, this.offset);
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
        const tag = tagIndex === ARBITRARY_TAG_INDEX ? reader.tag() : KNOWN_TAGS[tagIndex];
        const transformVersion = flags >> 6;
        const origLength = reader.base128();
        const transformed = isGlyfOrLoca(tag) ? transformVersion !== GLYF_NULL_TRANSFORM : transformVersion !== 0;
        const transformLength = transformed ? reader.base128() : origLength;
        if (tags.has(tag)) {
            fail('duplicate table ' + tag);
        }
        tags.add(tag);
        tables.push({ tag, transformVersion, transformed, transformLength, bytes: null });
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
 * Growable byte buffer used to write the reconstructed glyf table. The writes
 * do not check the capacity: reserve the room of a whole glyph first.
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
        this.bytes[this.length++] = value;
    }

    uint16(value) {
        this.bytes[this.length++] = (value >> 8) & 0xFF;
        this.bytes[this.length++] = value & 0xFF;
    }

    array(values) {
        this.bytes.set(values, this.length);
        this.length += values.length;
    }

    // pads to a multiple of 4 bytes, like the reference decoder (3 bytes at
    // most, already zero: the buffer is never written past the length)
    pad4() {
        this.length = (this.length + 3) & ~3;
    }

    result() {
        return this.bytes.subarray(0, this.length);
    }
}

// sign of a triplet coordinate: bit 0 of the flag set means positive
function withSign(flag, value) {
    return (flag & 1) ? value : -value;
}

// the number of bytes of each triplet flag (§ 5.2, "Triplet Encoding")
function getTripletLength(flag) {
    return flag < 84 ? 1 : flag < 120 ? 2 : flag < 124 ? 3 : 4;
}

/**
 * Decodes the point coordinates of a simple glyph (§ 5.2, "Triplet Encoding").
 * @param {Uint8Array} flags - one flag per point
 * @param {Reader} glyphStream
 * @param {Object} points - output: absolute coordinates (xs, ys), on-curve flags (onCurve), bounding box
 */
function decodeTriplets(flags, glyphStream, points) {
    const { xs, ys, onCurve } = points;
    const data = glyphStream.bytes;
    let offset = glyphStream.offset;
    let x = 0;
    let y = 0;
    let xMin = 0x7FFFFFFF;
    let yMin = 0x7FFFFFFF;
    let xMax = -0x7FFFFFFF;
    let yMax = -0x7FFFFFFF;
    for (let i = 0; i < flags.length; i += 1) {
        const flag = flags[i] & 0x7F;
        onCurve[i] = flags[i] < 0x80 ? 1 : 0;
        const tripletLength = getTripletLength(flag);
        if (offset + tripletLength > data.length) {
            glyphStream.offset = offset;
            glyphStream.require(tripletLength);
        }
        let dx;
        let dy;
        if (flag < 10) {
            dx = 0;
            dy = withSign(flag, ((flag & 14) << 7) + data[offset]);
        } else if (flag < 20) {
            dx = withSign(flag, (((flag - 10) & 14) << 7) + data[offset]);
            dy = 0;
        } else if (flag < 84) {
            const base = flag - 20;
            const byte = data[offset];
            dx = withSign(flag, 1 + (base & 0x30) + (byte >> 4));
            dy = withSign(flag >> 1, 1 + ((base & 0x0C) << 2) + (byte & 0x0F));
        } else if (flag < 120) {
            const base = flag - 84;
            dx = withSign(flag, 1 + (Math.floor(base / 12) << 8) + data[offset]);
            dy = withSign(flag >> 1, 1 + (((base % 12) >> 2) << 8) + data[offset + 1]);
        } else if (flag < 124) {
            const byte1 = data[offset + 1];
            dx = withSign(flag, (data[offset] << 4) + (byte1 >> 4));
            dy = withSign(flag >> 1, ((byte1 & 0x0F) << 8) + data[offset + 2]);
        } else {
            dx = withSign(flag, (data[offset] << 8) + data[offset + 1]);
            dy = withSign(flag >> 1, (data[offset + 2] << 8) + data[offset + 3]);
        }
        offset += tripletLength;
        x += dx;
        y += dy;
        xs[i] = x;
        ys[i] = y;
        xMin = Math.min(xMin, x);
        yMin = Math.min(yMin, y);
        xMax = Math.max(xMax, x);
        yMax = Math.max(yMax, y);
    }
    glyphStream.offset = offset;
    points.bbox = flags.length ? [xMin, yMin, xMax, yMax] : [0, 0, 0, 0];
}

// the bytes of a coordinate delta: 0 (same), 1 (short) or 2
function getDeltaLength(delta) {
    return delta === 0 ? 0 : (delta > -256 && delta < 256) ? 1 : 2;
}

/**
 * Writes the points of a simple glyph in the glyf format: flags (with the
 * repeat flag), then the x and the y deltas, each as short or long.
 * The writer must have the room for 5 bytes per point.
 */
function writeSimpleGlyphPoints(writer, pointCount, points, overlap) {
    const { xs, ys, onCurve, flags } = points;
    for (let i = 0; i < pointCount; i += 1) {
        const dx = xs[i] - (i ? xs[i - 1] : 0);
        const dy = ys[i] - (i ? ys[i - 1] : 0);
        let flag = onCurve[i] ? ON_CURVE_POINT : 0;
        if (i === 0 && overlap) {
            flag |= OVERLAP_SIMPLE;
        }
        const dxLength = getDeltaLength(dx);
        if (dxLength === 0 || (dxLength === 1 && dx > 0)) {
            flag |= X_IS_SAME_OR_POSITIVE_X_SHORT_VECTOR;
        }
        if (dxLength === 1) {
            flag |= X_SHORT_VECTOR;
        }
        const dyLength = getDeltaLength(dy);
        if (dyLength === 0 || (dyLength === 1 && dy > 0)) {
            flag |= Y_IS_SAME_OR_POSITIVE_Y_SHORT_VECTOR;
        }
        if (dyLength === 1) {
            flag |= Y_SHORT_VECTOR;
        }
        flags[i] = flag;
    }

    // a run of equal flags is written once, with the repeat flag (0x08)
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

    writeDeltas(writer, pointCount, xs, flags, X_SHORT_VECTOR, X_IS_SAME_OR_POSITIVE_X_SHORT_VECTOR);
    writeDeltas(writer, pointCount, ys, flags, Y_SHORT_VECTOR, Y_IS_SAME_OR_POSITIVE_Y_SHORT_VECTOR);
}

function writeDeltas(writer, pointCount, coordinates, flags, shortFlag, sameFlag) {
    for (let i = 0; i < pointCount; i += 1) {
        const delta = coordinates[i] - (i ? coordinates[i - 1] : 0);
        if (flags[i] & shortFlag) {
            writer.uint8(delta < 0 ? -delta : delta);
        } else if (!(flags[i] & sameFlag)) {
            writer.uint16(delta & 0xFFFF);
        }
    }
}

/**
 * Buffers reused by the simple glyphs of a font, grown on demand (their
 * content is not kept when they grow).
 */
class PointBuffers {
    constructor() {
        this.pointCapacity = 0;
        this.contourCapacity = 0;
    }

    ensureContours(contourCount) {
        if (contourCount > this.contourCapacity) {
            this.contourCapacity = Math.max(contourCount, this.contourCapacity * 2, 64);
            this.endPoints = new Uint16Array(this.contourCapacity);
        }
    }

    ensurePoints(pointCount) {
        if (pointCount > this.pointCapacity) {
            this.pointCapacity = Math.max(pointCount, this.pointCapacity * 2, 256);
            this.xs = new Int32Array(this.pointCapacity);
            this.ys = new Int32Array(this.pointCapacity);
            this.onCurve = new Uint8Array(this.pointCapacity);
            this.flags = new Uint8Array(this.pointCapacity);
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
    const writeGlyphHeader = (numberOfContours, bbox) => {
        writer.uint16(numberOfContours & 0xFFFF);
        for (let i = 0; i < 4; i += 1) {
            writer.uint16(bbox[i] & 0xFFFF);
        }
    };

    const writer = new Writer(bytes.length * 2);
    const offsets = new Uint32Array(numGlyphs + 1);
    const xMins = new Int16Array(numGlyphs);
    const points = new PointBuffers();

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
            const instructions = haveInstructions ? instructionStream.subarray(glyphStream.uint255()) : null;
            xMins[glyphIndex] = bbox[0];

            writer.reserve(10 + components.length + (instructions ? 2 + instructions.length : 0) + 3);
            writeGlyphHeader(numberOfContours, bbox);
            writer.array(components);
            if (instructions) {
                writer.uint16(instructions.length);
                writer.array(instructions);
            }
            writer.pad4();
            continue;
        }

        if (numberOfContours < 0) {
            fail('invalid number of contours ' + numberOfContours + ' of glyph ' + glyphIndex);
        }

        // simple glyph
        points.ensureContours(numberOfContours);
        let pointCount = 0;
        for (let contour = 0; contour < numberOfContours; contour += 1) {
            pointCount += nPointsStream.uint255();
            if (pointCount > 0xFFFF) {
                fail('too many points in glyph ' + glyphIndex);
            }
            points.endPoints[contour] = pointCount - 1;
        }
        points.ensurePoints(pointCount);
        decodeTriplets(flagStream.subarray(pointCount), glyphStream, points);
        const instructions = instructionStream.subarray(glyphStream.uint255());
        const bbox = hasBbox ? readBbox() : points.bbox;
        xMins[glyphIndex] = bbox[0];

        // header, end points, instructions, then 5 bytes per point at most
        writer.reserve(10 + numberOfContours * 2 + 2 + instructions.length + pointCount * 5 + 3);
        writeGlyphHeader(numberOfContours, bbox);
        for (let contour = 0; contour < numberOfContours; contour += 1) {
            writer.uint16(points.endPoints[contour]);
        }
        writer.uint16(instructions.length);
        writer.array(instructions);
        const overlap = overlapBitmap !== null && isBitSet(overlapBitmap, glyphIndex);
        writeSimpleGlyphPoints(writer, pointCount, points, overlap);
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
 * The caller checks the signature and the flavor (font collections, 'ttcf',
 * are not supported).
 * @param {DataView} data - the whole WOFF2 file
 * @return {Object[]}
 */
function parseWOFF2TableEntries(data) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const header = new Reader(bytes, 'WOFF2 header');
    header.skip(12); // signature, flavor and length
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
    if (stream.offset !== stream.bytes.length) {
        fail('decompressed tables longer than the table directory');
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
            new DataView(head.bytes.buffer, head.bytes.byteOffset).setUint16(HEAD_INDEX_TO_LOC_FORMAT_OFFSET, reconstructed.indexFormat);
        }

        const hmtx = tablesByTag.get('hmtx');
        if (hmtx && hmtx.transformed) {
            const numberOfHMetrics = readUint16At(tablesByTag.get('hhea'), HHEA_NUMBER_OF_HMETRICS_OFFSET, 'hhea');
            const numGlyphs = readUint16At(tablesByTag.get('maxp'), MAXP_NUM_GLYPHS_OFFSET, 'maxp');
            hmtx.bytes = reconstructHmtx(hmtx.bytes, numberOfHMetrics, numGlyphs, reconstructed.xMins);
        }
    }

    // views on the decompressed buffer, not copies
    return tables.map(table => ({
        tag: table.tag,
        offset: 0,
        length: table.bytes.length,
        compression: 'WOFF2',
        data: new DataView(table.bytes.buffer, table.bytes.byteOffset, table.bytes.byteLength),
    }));
}

export { parseWOFF2TableEntries };
