import { tinf_uncompress as inflate } from './tiny-inflate@1.0.3.esm.mjs';

// Check if 2 arrays of primitives are equal.
function arraysEqual(ar1, ar2) {
    const n = ar1.length;
    if (n !== ar2.length) { return false; }
    for (let i = 0; i < n; i++) {
        if (ar1[i] !== ar2[i]) { return false; }
    }
    return true;
}

// perform a binary search on an array of objects for a specific key and value
// the array MUST already be sorted by the key in ascending order
// this is way faster than Array.prototype.find()
function binarySearch(array, key, value) {
    let low = 0, high = array.length - 1;
    let result = null;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const record = array[mid];
        const recordValue = record[key];
        if (recordValue < value) {
            low = mid + 1;
        } else if (recordValue > value) {
            high = mid - 1;
        } else {
            result = record;
            break;
        }
    }
    return result;
}

function binarySearchIndex(array, key, value) {
    let low = 0, high = array.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const element = array[mid];
        if (element[key] < value) {
            low = mid + 1;
        } else if (element[key] > value) {
            high = mid - 1;
        } else {
            return mid; // Element found
        }
    }
    return -1; // Element not found
}

function binarySearchInsert(array, key, value) {
    let low = 0, high = array.length;
    const compare = (a, b) => a[key] - b[key];
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (compare(array[mid], value) < 0) low = mid + 1;
        else high = mid;
    }
    array.splice(low, 0, value);

    return low;
}

/**
 * [GZIP File Format Specification](https://datatracker.ietf.org/doc/html/rfc1952#section-2.3)
 * @param {Uint8Array} buf
 * @returns {boolean}
 */
function isGzip(buf) {
    return buf[0] === 31 && buf[1] === 139 && buf[2] === 8;
}

/**
 * [GZIP File Format Specification](https://datatracker.ietf.org/doc/html/rfc1952#section-2.3)
 * @param {Uint8Array} gzip
 * @returns {Uint8Array}
 */
function unGzip(gzip) {
    const data = new DataView(gzip.buffer, gzip.byteOffset, gzip.byteLength);

    let start = 10;
    const end = gzip.byteLength - 8;
    const flg = data.getInt8(3);
    // FEXTRA
    if (flg & 0b00000100) {
        start += 2 + data.getUint16(start, true);
    }
    // FNAME
    if (flg & 0b00001000) {
        while (start < end) if (gzip[start++] === 0) break;
    }
    // FCOMMENT
    if (flg & 0b00010000) {
        while (start < end) if (gzip[start++] === 0) break;
    }
    // FHCRC
    if (flg & 0b00000010) {
        start += 2;
    }

    if (start >= end) throw new Error('Can\'t find compressed blocks');

    const isize = data.getUint32(data.byteLength - 4, true);

    return inflate(gzip.subarray(start, end), new Uint8Array(isize));
}

function copyPoint(p) {
    return {
        x: p.x,
        y: p.y,
        onCurve: p.onCurve,
        lastPointOfContour: p.lastPointOfContour,
    };
}

function copyComponent(c) {
    return {
        glyphIndex: c.glyphIndex,
        xScale: c.xScale,
        scale01: c.scale01,
        scale10: c.scale10,
        yScale: c.yScale,
        dx: c.dx,
        dy: c.dy,
    };
}

/**
 * Number of the points of a glyph in its gvar data, phantom points excluded: one per
 * component (its offset) for a composite glyph, its outline points otherwise.
 * @param {Glyph} glyph
 * @returns {number}
 */
function getGlyphVariationPointCount(glyph) {
    // the points first: reading them parses a lazy glyph, which sets isComposite
    const points = glyph.points;
    if (glyph.isComposite) {
        return glyph.components.length;
    }
    return points ? points.length : 0;
}

/**
 * Point numbers of a tuple of a tuple variation store (gvar, cvar): its private ones when
 * it has the flag (an empty list means all the points, phantom points included), otherwise
 * the shared ones.
 * @param {Object} header - Tuple variation header.
 * @param {Array<number>} sharedPoints
 * @returns {Array<number>}
 */
function getTuplePointNumbers(header, sharedPoints) {
    return header.privatePoints ? header.privatePoints : sharedPoints;
}

// font -> kind of warning -> the values already warned about for the font
const fontWarnings = new WeakMap();

/**
 * Warn about a value of a font (e.g. a lookup type that is not supported yet), once per font, kind and value. The
 * message is built at the first warning only, as the callers check their warning at every text they lay out.
 * @param {opentype.Font} font
 * @param {string} kind - e.g. 'GSUB substitutionType'
 * @param {number|string} value - e.g. the substitution type
 * @param {function(): string} getMessage
 */
function warnOncePerFont(font, kind, value, getMessage) {
    if (!fontWarnings.has(font)) {
        fontWarnings.set(font, new Map());
    }
    const kindWarnings = fontWarnings.get(font);
    if (!kindWarnings.has(kind)) {
        kindWarnings.set(kind, new Set());
    }
    const warnedValues = kindWarnings.get(kind);
    if (!warnedValues.has(value)) {
        warnedValues.add(value);
        console.warn(getMessage());
    }
}

/**
 * Define an enumerable property of an object whose value is computed at its first read, then kept as the value of the
 * property, like a property set to the computed value: setting it before replaces the value without computing it
 * @param {Object} object
 * @param {string|number} propertyName
 * @param {function(): any} computeValue
 */
function defineLazyProperty(object, propertyName, computeValue) {
    const setValue = value => Object.defineProperty(object, propertyName, {
        value, writable: true, enumerable: true, configurable: true
    });
    Object.defineProperty(object, propertyName, {
        get: function() {
            const value = computeValue();
            setValue(value);
            return value;
        },
        set: setValue,
        enumerable: true,
        configurable: true
    });
}

export { arraysEqual, binarySearch, binarySearchIndex, binarySearchInsert, isGzip, unGzip, copyPoint, copyComponent, getGlyphVariationPointCount, getTuplePointNumbers, warnOncePerFont, defineLazyProperty };
