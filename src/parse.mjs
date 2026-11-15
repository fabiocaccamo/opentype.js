// Parsing utility functions

import check from './check.mjs';
import { getGlyphVariationPointCount, getTuplePointNumbers, defineLazyProperty } from './util.mjs';

// Retrieve an unsigned byte from the DataView.
function getByte(dataView, offset) {
    return dataView.getUint8(offset);
}

// Retrieve an unsigned 16-bit short from the DataView.
// The value is stored in big endian.
function getUShort(dataView, offset) {
    return dataView.getUint16(offset, false);
}

// Retrieve a signed 16-bit short from the DataView.
// The value is stored in big endian.
function getShort(dataView, offset) {
    return dataView.getInt16(offset, false);
}

function getUInt24(dataView, offset) {
    return (dataView.getUint16(offset) << 8) + dataView.getUint8(offset + 2);
}

// Retrieve an unsigned 32-bit long from the DataView.
// The value is stored in big endian.
function getULong(dataView, offset) {
    return dataView.getUint32(offset, false);
}

// Retrieve a signed 32-bit long from the DataView.
// The value is stored in big endian.
function getLong(dataView, offset) {
    return dataView.getInt32(offset, false);
}


// Retrieve a 32-bit signed fixed-point number (16.16) from the DataView.
// The value is stored in big endian.
function getFixed(dataView, offset) {
    // the 16-bit fraction counts 1/65536 units, so the whole value is a signed 32-bit integer of 1/65536 units
    return dataView.getInt32(offset, false) / 65536;
}

// Retrieve a 4-character tag from the DataView.
// Tags are used to identify tables.
function getTag(dataView, offset) {
    let tag = '';
    for (let i = offset; i < offset + 4; i += 1) {
        tag += String.fromCharCode(dataView.getInt8(i));
    }

    return tag;
}

// Retrieve an offset from the DataView.
// Offsets are 1 to 4 bytes in length, depending on the offSize argument.
function getOffset(dataView, offset, offSize) {
    let v = 0;
    for (let i = 0; i < offSize; i += 1) {
        v <<= 8;
        v += dataView.getUint8(offset + i);
    }

    return v;
}

// Retrieve a number of bytes from start offset to the end offset from the DataView.
function getBytes(dataView, startOffset, endOffset) {
    const bytes = [];
    for (let i = startOffset; i < endOffset; i += 1) {
        bytes.push(dataView.getUint8(i));
    }

    return bytes;
}

// Convert the list of bytes to a string.
function bytesToString(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 1) {
        s += String.fromCharCode(bytes[i]);
    }

    return s;
}

const typeOffsets = {
    byte: 1,
    uShort: 2,
    f2dot14: 2,
    short: 2,
    uInt24: 3,
    uLong: 4,
    fixed: 4,
    longDateTime: 8,
    tag: 4
};

const masks = {
    LONG_WORDS: 0x8000,
    WORD_DELTA_COUNT_MASK: 0x7FFF,
    SHARED_POINT_NUMBERS: 0x8000,
    COUNT_MASK: 0x0FFF,
    EMBEDDED_PEAK_TUPLE: 0x8000,
    INTERMEDIATE_REGION: 0x4000,
    PRIVATE_POINT_NUMBERS: 0x2000,
    TUPLE_INDEX_MASK: 0x0FFF,
    POINTS_ARE_WORDS: 0x80,
    POINT_RUN_COUNT_MASK: 0x7F,
    DELTAS_ARE_ZERO: 0x80,
    DELTAS_ARE_WORDS: 0x40,
    DELTA_RUN_COUNT_MASK: 0x3F,
    INNER_INDEX_BIT_COUNT_MASK: 0x0F,
    MAP_ENTRY_SIZE_MASK: 0x30,
};

// A stateful parser that changes the offset whenever a value is retrieved.
// The data is a DataView.
function Parser(data, offset) {
    this.data = data;
    this.offset = offset;
    this.relativeOffset = 0;
}

Parser.prototype.parseByte = function() {
    const v = this.data.getUint8(this.offset + this.relativeOffset);
    this.relativeOffset += 1;
    return v;
};

Parser.prototype.parseChar = function() {
    const v = this.data.getInt8(this.offset + this.relativeOffset);
    this.relativeOffset += 1;
    return v;
};

Parser.prototype.parseCard8 = Parser.prototype.parseByte;

Parser.prototype.parseUShort = function() {
    const v = this.data.getUint16(this.offset + this.relativeOffset);
    this.relativeOffset += 2;
    return v;
};

Parser.prototype.parseCard16 = Parser.prototype.parseUShort;
Parser.prototype.parseSID = Parser.prototype.parseUShort;
Parser.prototype.parseOffset16 = Parser.prototype.parseUShort;

Parser.prototype.parseShort = function() {
    const v = this.data.getInt16(this.offset + this.relativeOffset);
    this.relativeOffset += 2;
    return v;
};

Parser.prototype.parseF2Dot14 = function() {
    const v = this.data.getInt16(this.offset + this.relativeOffset) / 16384;
    this.relativeOffset += 2;
    return v;
};


Parser.prototype.parseUInt24 = function() {
    const v = getUInt24(this.data, this.offset + this.relativeOffset);
    this.relativeOffset += 3;
    return v;
};

Parser.prototype.parseULong = function() {
    const v = getULong(this.data, this.offset + this.relativeOffset);
    this.relativeOffset += 4;
    return v;
};

Parser.prototype.parseLong = function() {
    const v = getLong(this.data, this.offset + this.relativeOffset);
    this.relativeOffset += 4;
    return v;
};

Parser.prototype.parseOffset32 = Parser.prototype.parseULong;

Parser.prototype.parseFixed = function() {
    const v = getFixed(this.data, this.offset + this.relativeOffset);
    this.relativeOffset += 4;
    return v;
};

Parser.prototype.parseString = function(length) {
    const dataView = this.data;
    const offset = this.offset + this.relativeOffset;
    let string = '';
    this.relativeOffset += length;
    for (let i = 0; i < length; i++) {
        string += String.fromCharCode(dataView.getUint8(offset + i));
    }

    return string;
};

Parser.prototype.parseTag = function() {
    return this.parseString(4);
};

// LONGDATETIME is a 64-bit integer.
// JavaScript and unix timestamps traditionally use 32 bits, so we
// only take the last 32 bits.
// + Since until 2038 those bits will be filled by zeros we can ignore them.
// FIXME: at some point we need to support dates >2038 using the full 64bit
Parser.prototype.parseLongDateTime = function() {
    let v = getULong(this.data, this.offset + this.relativeOffset + 4);
    // Subtract seconds between 01/01/1904 and 01/01/1970
    // to convert Apple Mac timestamp to Standard Unix timestamp
    v -= 2082844800;
    this.relativeOffset += 8;
    return v;
};

Parser.prototype.parseVersion = function(minorBase) {
    const major = getUShort(this.data, this.offset + this.relativeOffset);

    // How to interpret the minor version is very vague in the spec. 0x5000 is 5, 0x1000 is 1
    // Default returns the correct number if minor = 0xN000 where N is 0-9
    // Set minorBase to 1 for tables that use minor = N where N is 0-9
    const minor = getUShort(this.data, this.offset + this.relativeOffset + 2);
    this.relativeOffset += 4;
    if (minorBase === undefined) minorBase = 0x1000;
    return major + minor / minorBase / 10;
};

Parser.prototype.skip = function(type, amount) {
    if (amount === undefined) {
        amount = 1;
    }

    this.relativeOffset += typeOffsets[type] * amount;
};

///// Parsing lists and records ///////////////////////////////

// Parse a list of 32 bit unsigned integers.
Parser.prototype.parseULongList = function(count) {
    if (count === undefined) { count = this.parseULong(); }
    const offsets = new Array(count);
    const dataView = this.data;
    let offset = this.offset + this.relativeOffset;
    for (let i = 0; i < count; i++) {
        offsets[i] = dataView.getUint32(offset);
        offset += 4;
    }

    this.relativeOffset += count * 4;
    return offsets;
};

// Parse a list of 16 bit unsigned integers. The length of the list can be read on the stream
// or provided as an argument.
Parser.prototype.parseOffset16List =
Parser.prototype.parseUShortList = function(count) {
    if (count === undefined) { count = this.parseUShort(); }
    const offsets = new Array(count);
    const dataView = this.data;
    let offset = this.offset + this.relativeOffset;
    for (let i = 0; i < count; i++) {
        offsets[i] = dataView.getUint16(offset);
        offset += 2;
    }

    this.relativeOffset += count * 2;
    return offsets;
};

// Parses a list of 16 bit signed integers.
Parser.prototype.parseShortList = function(count) {
    const list = new Array(count);
    const dataView = this.data;
    let offset = this.offset + this.relativeOffset;
    for (let i = 0; i < count; i++) {
        list[i] = dataView.getInt16(offset);
        offset += 2;
    }

    this.relativeOffset += count * 2;
    return list;
};

// Parses a list of bytes.
Parser.prototype.parseByteList = function(count) {
    const list = new Array(count);
    const dataView = this.data;
    let offset = this.offset + this.relativeOffset;
    for (let i = 0; i < count; i++) {
        list[i] = dataView.getUint8(offset++);
    }

    this.relativeOffset += count;
    return list;
};

/**
 * Parse a list of items.
 * Record count is optional, if omitted it is read from the stream.
 * itemCallback is one of the Parser methods.
 */
Parser.prototype.parseList = function(count, itemCallback) {
    if (!itemCallback) {
        itemCallback = count;
        count = this.parseUShort();
    }
    const list = new Array(count);
    for (let i = 0; i < count; i++) {
        list[i] = itemCallback.call(this);
    }
    return list;
};

Parser.prototype.parseList32 = function(count, itemCallback) {
    if (!itemCallback) {
        itemCallback = count;
        count = this.parseULong();
    }
    const list = new Array(count);
    for (let i = 0; i < count; i++) {
        list[i] = itemCallback.call(this);
    }
    return list;
};

/**
 * Parse a list of records.
 * Record count is optional, if omitted it is read from the stream.
 * Example of recordDescription: { sequenceIndex: Parser.uShort, lookupListIndex: Parser.uShort }
 */
Parser.prototype.parseRecordList = function(count, recordDescription) {
    // If the count argument is absent, read it in the stream.
    if (!recordDescription) {
        recordDescription = count;
        count = this.parseUShort();
    }
    const records = new Array(count);
    const fields = Object.keys(recordDescription);
    for (let i = 0; i < count; i++) {
        const rec = {};
        for (let j = 0; j < fields.length; j++) {
            const fieldName = fields[j];
            const fieldType = recordDescription[fieldName];
            rec[fieldName] = fieldType.call(this);
        }
        records[i] = rec;
    }
    return records;
};

Parser.prototype.parseRecordList32 = function(count, recordDescription) {
    // If the count argument is absent, read it in the stream.
    if (!recordDescription) {
        recordDescription = count;
        count = this.parseULong();
    }
    const records = new Array(count);
    const fields = Object.keys(recordDescription);
    for (let i = 0; i < count; i++) {
        const rec = {};
        for (let j = 0; j < fields.length; j++) {
            const fieldName = fields[j];
            const fieldType = recordDescription[fieldName];
            rec[fieldName] = fieldType.call(this);
        }
        records[i] = rec;
    }
    return records;
};

Parser.prototype.parseTupleRecords = function(tupleCount, axisCount) {
    let tuples = [];
    for (let i = 0; i < tupleCount; i++) {
        let tuple = [];
        for (let axisIndex = 0; axisIndex < axisCount; axisIndex++) {
            tuple.push(this.parseF2Dot14());
        }
        tuples.push(tuple);
    }
    return tuples;
};

// Parse a data structure into an object
// Example of description: { sequenceIndex: Parser.uShort, lookupListIndex: Parser.uShort }
Parser.prototype.parseStruct = function(description) {
    if (typeof description === 'function') {
        return description.call(this);
    } else {
        const fields = Object.keys(description);
        const struct = {};
        for (let j = 0; j < fields.length; j++) {
            const fieldName = fields[j];
            const fieldType = description[fieldName];
            struct[fieldName] = fieldType.call(this);
        }
        return struct;
    }
};

/**
 * Parse a GPOS valueRecord
 * https://docs.microsoft.com/en-us/typography/opentype/spec/gpos#value-record
 * valueFormat is optional, if omitted it is read from the stream.
 * subtableStart is the absolute offset of the subtable the device offsets are
 * relative to: when omitted, the device tables are not parsed.
 */
Parser.prototype.parseValueRecord = function(valueFormat, subtableStart) {
    if (valueFormat === undefined) {
        valueFormat = this.parseUShort();
    }
    if (valueFormat === 0) {
        // valueFormat2 in kerning pairs is most often 0
        // in this case return undefined instead of an empty object, to save space
        return;
    }
    const valueRecord = {};

    if (valueFormat & 0x0001) { valueRecord.xPlacement = this.parseShort(); }
    if (valueFormat & 0x0002) { valueRecord.yPlacement = this.parseShort(); }
    if (valueFormat & 0x0004) { valueRecord.xAdvance = this.parseShort(); }
    if (valueFormat & 0x0008) { valueRecord.yAdvance = this.parseShort(); }

    // Device table (non-variable font) / VariationIndex table (variable font)
    // https://docs.microsoft.com/fr-fr/typography/opentype/spec/chapter2#devVarIdxTbls
    // like HarfBuzz, a device that ends past the end of the data is read as a NULL offset (sanitize_value_devices)
    const parseDevice = (offset) => {
        if (!offset || subtableStart === undefined || !isDeviceTableInData(this.data, subtableStart + offset)) {
            return undefined;
        }
        return new Parser(this.data, subtableStart + offset).parseDeviceTable();
    };
    if (valueFormat & 0x0010) { valueRecord.xPlaDevice = parseDevice(this.parseOffset16()); }
    if (valueFormat & 0x0020) { valueRecord.yPlaDevice = parseDevice(this.parseOffset16()); }
    if (valueFormat & 0x0040) { valueRecord.xAdvDevice = parseDevice(this.parseOffset16()); }
    if (valueFormat & 0x0080) { valueRecord.yAdvDevice = parseDevice(this.parseOffset16()); }

    return valueRecord;
};

/**
 * Parse a Device or VariationIndex table
 * https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2#device-and-variationindex-tables
 * The hinting deltas of a Device table are not decoded.
 */
Parser.prototype.parseDeviceTable = function() {
    const first = this.parseUShort();
    const second = this.parseUShort();
    const deltaFormat = this.parseUShort();
    if (deltaFormat === 0x8000) {
        return { deltaFormat, deltaSetOuterIndex: first, deltaSetInnerIndex: second };
    }
    return { deltaFormat, startSize: first, endSize: second };
};

// the startSize (or deltaSetOuterIndex), endSize (or deltaSetInnerIndex) and deltaFormat fields of a Device or
// VariationIndex table
const DEVICE_TABLE_HEADER_SIZE = 6;

/**
 * The size in bytes of a Device or VariationIndex table, like HarfBuzz (HintingDevice::get_size): the deltas of a
 * Device table of format 1, 2 or 3 after its header, the header only for the other formats
 * @param {{deltaFormat: number, startSize: number, endSize: number}} device - see parseDeviceTable
 * @returns {number}
 */
function getDeviceTableSize(device) {
    const { deltaFormat, startSize, endSize } = device;
    if (deltaFormat < 1 || deltaFormat > 3 || startSize > endSize) {
        return DEVICE_TABLE_HEADER_SIZE;
    }
    return 2 * (4 + ((endSize - startSize) >> (4 - deltaFormat)));
}

/**
 * Whether the Device or VariationIndex table at an offset of the data ends inside the data, which HarfBuzz checks when
 * it sanitizes the table (Device::sanitize)
 * @param {DataView} data - the data of the table that has the device, e.g. a GPOS table
 * @param {number} offset - the offset of the device in the data
 * @returns {boolean}
 */
function isDeviceTableInData(data, offset) {
    if (offset + DEVICE_TABLE_HEADER_SIZE > data.byteLength) {
        return false;
    }
    const device = new Parser(data, offset).parseDeviceTable();
    return offset + getDeviceTableSize(device) <= data.byteLength;
}

/**
 * Parse a list of GPOS valueRecords
 * https://docs.microsoft.com/en-us/typography/opentype/spec/gpos#value-record
 * valueFormat and valueCount are read from the stream.
 * subtableStart is the absolute offset of the subtable the device offsets are
 * relative to (see parseValueRecord).
 */
Parser.prototype.parseValueRecordList = function(subtableStart) {
    const valueFormat = this.parseUShort();
    const valueCount = this.parseUShort();
    const values = new Array(valueCount);
    for (let i = 0; i < valueCount; i++) {
        values[i] = this.parseValueRecord(valueFormat, subtableStart);
    }
    return values;
};

Parser.prototype.parsePointer = function(description) {
    const structOffset = this.parseOffset16();
    if (structOffset > 0) {
        // NULL offset => return undefined
        return new Parser(this.data, this.offset + structOffset).parseStruct(description);
    }
    return undefined;
};

Parser.prototype.parsePointer32 = function(description) {
    const structOffset = this.parseOffset32();
    if (structOffset > 0) {
        // NULL offset => return undefined
        return new Parser(this.data, this.offset + structOffset).parseStruct(description);
    }
    return undefined;
};

/**
 * Parse a list of offsets to lists of 16-bit integers,
 * or a list of offsets to lists of offsets to any kind of items.
 * If itemCallback is not provided, a list of list of UShort is assumed.
 * If provided, itemCallback is called on each item and must parse the item.
 * A NULL offset, to a list or to an item, is read as undefined.
 * See examples in tables/gsub.mjs
 */
Parser.prototype.parseListOfLists = function(itemCallback) {
    const offsets = this.parseOffset16List();
    const count = offsets.length;
    const relativeOffset = this.relativeOffset;
    const list = new Array(count);
    for (let i = 0; i < count; i++) {
        const start = offsets[i];
        if (start === 0) {
            // NULL offset
            // Add i as owned property to list. Convenient with assert.
            list[i] = undefined;
            continue;
        }
        this.relativeOffset = start;
        if (itemCallback) {
            const subOffsets = this.parseOffset16List();
            const subList = new Array(subOffsets.length);
            for (let j = 0; j < subOffsets.length; j++) {
                if (subOffsets[j] === 0) {
                    subList[j] = undefined;
                    continue;
                }
                this.relativeOffset = start + subOffsets[j];
                subList[j] = itemCallback.call(this);
            }
            list[i] = subList;
        } else {
            list[i] = this.parseUShortList();
        }
    }
    this.relativeOffset = relativeOffset;
    return list;
};

///// Complex tables parsing //////////////////////////////////

// Parse a coverage table in a GSUB, GPOS or GDEF table.
// https://www.microsoft.com/typography/OTSPEC/chapter2.htm
// parser.offset must point to the start of the table containing the coverage.
Parser.prototype.parseCoverage = function() {
    const startOffset = this.offset + this.relativeOffset;
    const format = this.parseUShort();
    const count = this.parseUShort();
    if (format === 1) {
        return {
            format: 1,
            glyphs: this.parseUShortList(count)
        };
    } else if (format === 2) {
        const ranges = new Array(count);
        for (let i = 0; i < count; i++) {
            ranges[i] = {
                start: this.parseUShort(),
                end: this.parseUShort(),
                index: this.parseUShort()
            };
        }
        return {
            format: 2,
            ranges: ranges
        };
    }
    throw new Error('0x' + startOffset.toString(16) + ': Coverage format must be 1 or 2.');
};

// Parse a Class Definition Table in a GSUB, GPOS or GDEF table.
// https://www.microsoft.com/typography/OTSPEC/chapter2.htm
Parser.prototype.parseClassDef = function() {
    const startOffset = this.offset + this.relativeOffset;
    const format = this.parseUShort();
    if (format === 1) {
        return {
            format: 1,
            startGlyph: this.parseUShort(),
            classes: this.parseUShortList()
        };
    } else if (format === 2) {
        return {
            format: 2,
            ranges: this.parseRecordList({
                start: Parser.uShort,
                end: Parser.uShort,
                classId: Parser.uShort
            })
        };
    }

    console.warn(`0x${startOffset.toString(16)}: This font file uses an invalid ClassDef format of ${format}. It might be corrupted and should be reacquired if it doesn't display as intended.`);
    return {
        format: format
    };
};

///// Static methods ///////////////////////////////////
// These convenience methods can be used as callbacks and should be called with "this" context set to a Parser instance.

Parser.list = function(count, itemCallback) {
    return function() {
        return this.parseList(count, itemCallback);
    };
};

Parser.list32 = function(count, itemCallback) {
    return function() {
        return this.parseList32(count, itemCallback);
    };
};

Parser.recordList = function(count, recordDescription) {
    return function() {
        return this.parseRecordList(count, recordDescription);
    };
};

Parser.recordList32 = function(count, recordDescription) {
    return function() {
        return this.parseRecordList32(count, recordDescription);
    };
};

Parser.pointer = function(description) {
    return function() {
        return this.parsePointer(description);
    };
};

Parser.pointer32 = function(description) {
    return function() {
        return this.parsePointer32(description);
    };
};

Parser.tag = Parser.prototype.parseTag;
Parser.byte = Parser.prototype.parseByte;
Parser.uShort = Parser.offset16 = Parser.prototype.parseUShort;
Parser.uShortList = Parser.prototype.parseUShortList;
Parser.uInt24 = Parser.prototype.parseUInt24;
Parser.uLong = Parser.offset32 = Parser.prototype.parseULong;
Parser.uLongList = Parser.prototype.parseULongList;
Parser.fixed = Parser.prototype.parseFixed;
Parser.f2Dot14 = Parser.prototype.parseF2Dot14;
Parser.struct = Parser.prototype.parseStruct;
Parser.coverage = Parser.prototype.parseCoverage;
Parser.classDef = Parser.prototype.parseClassDef;

///// Script, Feature, Lookup lists ///////////////////////////////////////////////
// https://www.microsoft.com/typography/OTSPEC/chapter2.htm

const langSysTable = {
    reserved: Parser.uShort,
    reqFeatureIndex: Parser.uShort,
    featureIndexes: Parser.uShortList
};

Parser.prototype.parseScriptList = function() {
    return this.parsePointer(Parser.recordList({
        tag: Parser.tag,
        script: Parser.pointer({
            defaultLangSys: Parser.pointer(langSysTable),
            langSysRecords: Parser.recordList({
                tag: Parser.tag,
                langSys: Parser.pointer(langSysTable)
            })
        })
    })) || [];
};

// https://learn.microsoft.com/en-us/typography/opentype/spec/features_pt#ss01---ss20
const STYLISTIC_SET_TAG = /^ss(0[1-9]|1\d|20)$/;
// https://learn.microsoft.com/en-us/typography/opentype/spec/features_ae#cv01-cv99
const CHARACTER_VARIANT_TAG = /^cv(0[1-9]|[1-9]\d)$/;

/**
 * Parse the FeatureParams table of a stylistic set (ss01-ss20) or character variant (cv01-cv99) feature,
 * the only features whose FeatureParams table (holding the name IDs of their UI names) is parsed.
 * @param {string} tag feature tag
 * @returns {object|undefined}
 */
Parser.prototype.parseFeatureParams = function(tag) {
    if (STYLISTIC_SET_TAG.test(tag)) {
        return {
            version: this.parseUShort(),
            uiNameID: this.parseUShort()
        };
    }
    if (CHARACTER_VARIANT_TAG.test(tag)) {
        const featureParams = {
            format: this.parseUShort(),
            featUiLabelNameID: this.parseUShort(),
            featUiTooltipTextNameID: this.parseUShort(),
            sampleTextNameID: this.parseUShort(),
            numNamedParameters: this.parseUShort(),
            firstParamUiLabelNameID: this.parseUShort()
        };
        const charCount = this.parseUShort();
        featureParams.characters = new Array(charCount);
        for (let i = 0; i < charCount; i++) {
            featureParams.characters[i] = this.parseUInt24();
        }
        return featureParams;
    }
};

Parser.prototype.parseFeatureList = function() {
    // the tag of the feature record being parsed, which tells how to parse its FeatureParams table
    let tag;
    const parseFeature = function() {
        // the FeatureParams offset is relative to the start of the Feature table
        const featureStart = this.offset;
        const feature = {
            featureParams: this.parseOffset16(),
            lookupListIndexes: this.parseUShortList()
        };
        if (feature.featureParams) {
            let featureParamsTable;
            try {
                featureParamsTable = new Parser(this.data, featureStart + feature.featureParams).parseFeatureParams(tag);
            } catch (error) {
                // a malformed FeatureParams table only loses the UI names, not the feature
                console.warn('Failed to parse the FeatureParams table of the ' + tag + ' feature, skipping: ' + error.message);
            }
            if (featureParamsTable) {
                feature.featureParamsTable = featureParamsTable;
            }
        }
        return feature;
    };
    return this.parsePointer(Parser.recordList({
        tag: function() {
            tag = this.parseTag();
            return tag;
        },
        // like HarfBuzz (the Null Feature), a NULL Feature offset reads as a Feature table without lookups
        feature: function() {
            return this.parsePointer(parseFeature) || { featureParams: 0, lookupListIndexes: [] };
        }
    })) || [];
};

/**
 * Throw an error: what the parsers that take a callback for the errors of the parts of a table they can skip (e.g.
 * parseLookupList) do when they are given no callback
 * @param {Error} error
 */
function throwError(error) {
    throw error;
}

/**
 * Parse a part of a table (e.g. GDEF, GSUB, GPOS, HVAR, MVAR) at an offset of the data, like HarfBuzz neuters the
 * offset of a part that fails to sanitize: a part that fails to parse (e.g. of an unknown format, or that ends past the
 * end of the data) is read as a NULL offset, and its error is passed to onError
 * @param {DataView} data
 * @param {number} structStart - the offset of the part in the data
 * @param {function(): object} description - the parser of the part, called on a Parser at its start
 * @param {function(Error)} onError
 * @returns {object|undefined} undefined for a part that fails to parse
 */
function parseSkippableStruct(data, structStart, description, onError) {
    try {
        return new Parser(data, structStart).parseStruct(description);
    } catch (error) {
        onError(error);
        return undefined;
    }
}

/**
 * The parser of the parts of a table (e.g. GDEF, HVAR) at their offsets from the start of the table, like HarfBuzz
 * neuters the offset of a part that fails to sanitize: parsePart(partName, partOffset, description) gives undefined for
 * a NULL offset and for a part that fails to parse (see parseSkippableStruct), whose error is passed to onPartError
 * with the name of the part
 * @param {DataView} data
 * @param {number} tableStart - the offset of the table, or of the part that holds the offsets, in the data
 * @param {function(Error, string)} onPartError
 * @returns {function(string, number, function(): object): (object|undefined)}
 */
function createSkippablePartParser(data, tableStart, onPartError) {
    return (partName, partOffset, description) => partOffset ?
        parseSkippableStruct(data, tableStart + partOffset, description, error => onPartError(error, partName)) : undefined;
}

/**
 * Parse the LookupList of a GSUB or GPOS table: its lookups (undefined for a NULL lookup offset), each one with its
 * subtables, undefined for a NULL subtable offset and for a subtable that fails to parse (see parseSkippableStruct)
 * @param {Array<function(): object>} lookupTableParsers - the parser of the subtables of each lookup type
 * @param {function(Error, number, number|undefined)} [onSubtableError] - called with the error, the lookup index and
 * the subtable index of each subtable that fails to parse, and with an undefined subtable index for an extension lookup
 * whose subtables are all skipped (see parseLookup); the error is thrown if omitted
 * @param {number} [extensionLookupType] - the lookup type of the extension lookups of the table: 7 in GSUB, 9 in GPOS
 * @returns {Array<object|undefined>}
 */
Parser.prototype.parseLookupList = function(lookupTableParsers, onSubtableError = throwError, extensionLookupType) {
    return this.parsePointer(function() {
        const lookupOffsets = this.parseOffset16List();
        return lookupOffsets.map((lookupOffset, lookupIndex) => {
            if (!lookupOffset) {
                return undefined;
            }
            return new Parser(this.data, this.offset + lookupOffset).parseLookup(lookupTableParsers,
                (error, subtableIndex) => onSubtableError(error, lookupIndex, subtableIndex), extensionLookupType);
        });
    }) || [];
};

/**
 * The extensionLookupType of a subtable of an extension lookup (GSUB type 7, GPOS type 9), like HarfBuzz
 * (Extension::get_type): 0 for a NULL subtable offset and a subtable of a format other than 1. A subtable that does not
 * fit in the data has the type 0 too, so that only its lookup is skipped, where HarfBuzz rejects the whole GSUB or GPOS
 * table for an extension lookup of two or more subtables (see Fonts with broken tables in README.md)
 * @param {DataView} data
 * @param {number} lookupStart - the offset of the lookup in the data
 * @param {number} subtableOffset - the offset of the subtable from the start of the lookup
 * @returns {number}
 */
function getExtensionSubtableLookupType(data, lookupStart, subtableOffset) {
    // the format and the extensionLookupType of an Extension subtable
    const extensionHeaderSize = 4;
    const subtableStart = lookupStart + subtableOffset;
    if (!subtableOffset || subtableStart + extensionHeaderSize > data.byteLength) {
        return 0;
    }
    const parser = new Parser(data, subtableStart);
    return parser.parseUShort() === 1 ? parser.parseUShort() : 0;
}

/**
 * The parser of the subtables of a lookup type without a parser, which fails to parse each one
 * @param {number} lookupType
 * @returns {function(): object}
 */
function createUnknownLookupTypeParser(lookupType) {
    return () => {
        throw new Error('GPOS/GSUB lookup type ' + lookupType + ' unknown.');
    };
}

/**
 * Parse a Lookup table of a GSUB or GPOS table (see parseLookupList). Like HarfBuzz ignores a lookup of an unknown
 * type (Lookup::dispatch), the subtables of a lookup type without a parser in lookupTableParsers fail to parse: the
 * lookup keeps its type, its subtables are undefined. So are the subtables of an extension lookup whose subtables have
 * not all the same extensionLookupType, which the specification requires: HarfBuzz drops such a lookup
 * (Lookup::sanitize), its error is passed to onSubtableError with an undefined subtable index, and its subtables are
 * not parsed.
 * @param {Array<function(): object>} lookupTableParsers
 * @param {function(Error, number|undefined)} onSubtableError - called with the error and the subtable index of each
 * subtable that fails to parse, and with an undefined subtable index for an extension lookup whose subtables are all
 * skipped
 * @param {number} [extensionLookupType] - the lookup type of the extension lookups: 7 in GSUB, 9 in GPOS
 * @returns {{lookupType: number, lookupFlag: number, subtables: Array<object|undefined>, markFilteringSet: number}}
 */
Parser.prototype.parseLookup = function(lookupTableParsers, onSubtableError, extensionLookupType) {
    const lookupType = this.parseUShort();
    const parseSubtable = lookupTableParsers[lookupType] || createUnknownLookupTypeParser(lookupType);
    const lookupFlag = this.parseUShort();
    const useMarkFilteringSet = lookupFlag & 0x10;
    const subtableOffsets = this.parseOffset16List();
    const lookup = {
        lookupType: lookupType,
        lookupFlag: lookupFlag,
        subtables: subtableOffsets.map(() => undefined),
        markFilteringSet: useMarkFilteringSet ? this.parseUShort() : undefined
    };
    if (lookupType === extensionLookupType) {
        const extensionLookupTypes = subtableOffsets.map(subtableOffset =>
            getExtensionSubtableLookupType(this.data, this.offset, subtableOffset));
        if (extensionLookupTypes.some(subtableLookupType => subtableLookupType !== extensionLookupTypes[0])) {
            onSubtableError(new Error('The subtables of an extension lookup must have the same extension lookup ' +
                'type, not ' + extensionLookupTypes.join(', ')), undefined);
            return lookup;
        }
    }
    lookup.subtables = subtableOffsets.map((subtableOffset, subtableIndex) => {
        if (!subtableOffset) {
            return undefined;
        }
        return parseSkippableStruct(this.data, this.offset + subtableOffset, parseSubtable,
            error => onSubtableError(error, subtableIndex));
    });
    return lookup;
};

// sequence context tables
// The contextual lookups of GSUB (types 5 and 6) and of GPOS (types 7 and 8) share these tables, only the name of
// their format field differs (substFormat, posFormat).
// https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2#sequence-context-format-1-simple-glyph-contexts

const sequenceLookupRecordDescription = {
    sequenceIndex: Parser.uShort,
    lookupListIndex: Parser.uShort
};

/**
 * The length of the input of a rule after its first glyph, like HarfBuzz (Rule::sanitize): a glyph count of 0, which
 * the specification does not allow, gives an empty input.
 * @param {number} glyphCount - the input glyphs of the rule, its first glyph included
 * @returns {number}
 */
function getRuleInputLength(glyphCount) {
    return glyphCount ? glyphCount - 1 : 0;
}

/**
 * The number of lookup records of a rule to parse, like HarfBuzz: none for a glyph count of 0, whose sequence indexes
 * are all past the input (apply_lookup), so that the rule matches its first glyph and applies nothing.
 * @param {number} glyphCount - the input glyphs of the rule, its first glyph included
 * @param {number} sequenceLookupCount - the lookup records of the rule
 * @returns {number}
 */
function getRuleLookupRecordCount(glyphCount, sequenceLookupCount) {
    return glyphCount ? sequenceLookupCount : 0;
}

/**
 * Parse a sequence context subtable of format 1, 2 or 3 (GSUB lookup type 5, GPOS lookup type 7).
 * @param {string} formatField - the name of the format field of the subtable: substFormat or posFormat
 * @param {string} lookupName - the name of the lookup type in the error of an unknown format, e.g. 'GPOS lookup type 7'
 * @returns {object} rule sets of glyphs (format 1), of classes (format 2), or coverages (format 3), with their lookup
 * records
 */
Parser.prototype.parseSequenceContext = function(formatField, lookupName) {
    const start = this.offset + this.relativeOffset;
    const format = this.parseUShort();
    if (format === 1) {
        return {
            [formatField]: format,
            coverage: this.parsePointer(Parser.coverage),
            ruleSets: this.parseListOfLists(function() {
                const glyphCount = this.parseUShort();
                const sequenceLookupCount = this.parseUShort();
                return {
                    input: this.parseUShortList(getRuleInputLength(glyphCount)),
                    lookupRecords: this.parseRecordList(
                        getRuleLookupRecordCount(glyphCount, sequenceLookupCount), sequenceLookupRecordDescription
                    )
                };
            })
        };
    } else if (format === 2) {
        return {
            [formatField]: format,
            coverage: this.parsePointer(Parser.coverage),
            classDef: this.parsePointer(Parser.classDef),
            classSets: this.parseListOfLists(function() {
                const glyphCount = this.parseUShort();
                const sequenceLookupCount = this.parseUShort();
                return {
                    classes: this.parseUShortList(getRuleInputLength(glyphCount)),
                    lookupRecords: this.parseRecordList(
                        getRuleLookupRecordCount(glyphCount, sequenceLookupCount), sequenceLookupRecordDescription
                    )
                };
            })
        };
    } else if (format === 3) {
        const glyphCount = this.parseUShort();
        const sequenceLookupCount = this.parseUShort();
        return {
            [formatField]: format,
            coverages: this.parseList(glyphCount, Parser.pointer(Parser.coverage)),
            lookupRecords: this.parseRecordList(sequenceLookupCount, sequenceLookupRecordDescription)
        };
    }
    check.assert(false, '0x' + start.toString(16) + ': ' + lookupName + ' format must be 1, 2 or 3.');
};

// a chained sequence rule (format 1) or chained class sequence rule (format 2)
function parseChainedSequenceRule() {
    const backtrack = this.parseUShortList();
    const inputGlyphCount = this.parseUShort();
    const input = this.parseUShortList(getRuleInputLength(inputGlyphCount));
    const lookahead = this.parseUShortList();
    const sequenceLookupCount = this.parseUShort();
    const lookupRecords = this.parseRecordList(
        getRuleLookupRecordCount(inputGlyphCount, sequenceLookupCount), sequenceLookupRecordDescription
    );
    return { backtrack, input, lookahead, lookupRecords };
}

/**
 * Parse a chained sequence context subtable of format 1, 2 or 3 (GSUB lookup type 6, GPOS lookup type 8).
 * @param {string} formatField - the name of the format field of the subtable: substFormat or posFormat
 * @param {string} lookupName - the name of the lookup type in the error of an unknown format, e.g. 'GPOS lookup type 8'
 * @returns {object} rule sets of glyphs (format 1), of classes (format 2), or coverages (format 3), with their lookup
 * records
 */
Parser.prototype.parseChainedSequenceContext = function(formatField, lookupName) {
    const start = this.offset + this.relativeOffset;
    const format = this.parseUShort();
    if (format === 1) {
        return {
            [formatField]: format,
            coverage: this.parsePointer(Parser.coverage),
            chainRuleSets: this.parseListOfLists(parseChainedSequenceRule)
        };
    } else if (format === 2) {
        return {
            [formatField]: format,
            coverage: this.parsePointer(Parser.coverage),
            backtrackClassDef: this.parsePointer(Parser.classDef),
            inputClassDef: this.parsePointer(Parser.classDef),
            lookaheadClassDef: this.parsePointer(Parser.classDef),
            chainClassSet: this.parseListOfLists(parseChainedSequenceRule)
        };
    } else if (format === 3) {
        return {
            [formatField]: format,
            backtrackCoverage: this.parseList(Parser.pointer(Parser.coverage)),
            inputCoverage: this.parseList(Parser.pointer(Parser.coverage)),
            lookaheadCoverage: this.parseList(Parser.pointer(Parser.coverage)),
            lookupRecords: this.parseRecordList(sequenceLookupRecordDescription)
        };
    }
    check.assert(false, '0x' + start.toString(16) + ': ' + lookupName + ' format must be 1, 2 or 3.');
};

// https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2#featurevariations-table
Parser.prototype.parseFeatureVariationsList = function() {
    return this.parsePointer32(function() {
        const featureVariationsStart = this.offset;
        const majorVersion = this.parseUShort();
        const minorVersion = this.parseUShort();
        check.argument(majorVersion === 1 && minorVersion < 1, 'GPOS/GSUB feature variations table unknown.');
        const featureVariations = this.parseRecordList32({
            conditionSetOffset: Parser.offset32,
            featureTableSubstitutionOffset: Parser.offset32
        });
        for (let i = 0; i < featureVariations.length; i++) {
            const record = featureVariations[i];
            record.conditions = record.conditionSetOffset ?
                new Parser(this.data, featureVariationsStart + record.conditionSetOffset).parseConditionSet() : [];
            record.substitutions = record.featureTableSubstitutionOffset ?
                new Parser(this.data, featureVariationsStart + record.featureTableSubstitutionOffset).parseFeatureTableSubstitution() : [];
        }
        return featureVariations;
    }) || [];
};

// the conditions on the axis values of a feature variation record, all of them must be met:
// format 1 is an axis range in normalized coordinates, other formats are kept as unsupported
Parser.prototype.parseConditionSet = function() {
    const conditionSetStart = this.offset;
    const conditionOffsets = this.parseULongList(this.parseUShort());
    return conditionOffsets.map(conditionOffset => {
        const p = new Parser(this.data, conditionSetStart + conditionOffset);
        const format = p.parseUShort();
        if (format !== 1) {
            return { format };
        }
        return {
            format,
            axisIndex: p.parseUShort(),
            filterRangeMinValue: p.parseF2Dot14(),
            filterRangeMaxValue: p.parseF2Dot14()
        };
    });
};

// the alternate feature tables of a feature variation record, by feature index
Parser.prototype.parseFeatureTableSubstitution = function() {
    const substitutionStart = this.offset;
    this.parseUShort(); // majorVersion
    this.parseUShort(); // minorVersion
    const substitutionCount = this.parseUShort();
    const substitutions = [];
    for (let i = 0; i < substitutionCount; i++) {
        const featureIndex = this.parseUShort();
        const alternateFeatureOffset = this.parseOffset32();
        const p = new Parser(this.data, substitutionStart + alternateFeatureOffset);
        substitutions.push({
            featureIndex,
            feature: {
                featureParams: p.parseOffset16(),
                lookupListIndexes: p.parseUShortList()
            }
        });
    }
    return substitutions;
};

// VariationStore, ItemVariationStore, VariationRegionList, regionAxes, ItemVariationSubtables ...
// https://learn.microsoft.com/en-us/typography/opentype/spec/otvarcommonformats
// https://learn.microsoft.com/en-us/typography/opentype/spec/otvarcommonformats#item-variation-store-header-and-item-variation-data-subtables

Parser.prototype.parseVariationStore = function() {
    const vsOffset = this.relativeOffset;
    const length = this.parseUShort();
    const variationStore = {
        itemVariationStore: this.parseItemVariationStore()
    };
    this.relativeOffset = vsOffset + length + 2; // + 2 for length field
    return variationStore;
};

Parser.prototype.parseItemVariationStore = function() {
    const itemStoreOffset = this.relativeOffset;
    const iVStore = {
        format: this.parseUShort(),
        variationRegions: [],
        itemVariationSubtables: []
    };

    const variationRegionListOffset = this.parseOffset32();
    const itemVariationDataCount = this.parseUShort();
    const itemVariationDataOffsets = this.parseULongList(itemVariationDataCount);    
    
    this.relativeOffset = itemStoreOffset + variationRegionListOffset;
    iVStore.variationRegions = this.parseVariationRegionList();
    
    for( let i = 0; i < itemVariationDataCount; i++ ) {
        const subtableOffset = itemVariationDataOffsets[i];
        this.relativeOffset = itemStoreOffset + subtableOffset;
        iVStore.itemVariationSubtables.push(this.parseItemVariationSubtable());
    }

    return iVStore;
};

Parser.prototype.parseVariationRegionList = function() {
    const axisCount = this.parseUShort();
    const regionCount = this.parseUShort();
    return  this.parseRecordList(regionCount, {
        regionAxes: Parser.recordList(axisCount, {
            startCoord: Parser.f2Dot14,
            peakCoord: Parser.f2Dot14,
            endCoord: Parser.f2Dot14,
        })
    });
};

Parser.prototype.parseItemVariationSubtable = function() {
    const itemCount = this.parseUShort();
    const wordDeltaCount = this.parseUShort();

    const regionIndexes = this.parseUShortList();
    const regionIndexCount = regionIndexes.length;
    
    const subtable = {
        regionIndexes,
        deltaSets: itemCount && regionIndexCount ? this.parseDeltaSets(itemCount, wordDeltaCount, regionIndexCount) : []
    };

    return subtable;
};

Parser.prototype.parseDeltaSetIndexMap = function() {
    const format = this.parseByte();
    const entryFormat = this.parseByte();
    const map = [];
    let mapCount = 0;
    
    switch(format) {
        case 0:
            mapCount = this.parseUShort();
            break;
        case 1:
            mapCount = this.parseULong();
            break;
        default:
            console.error(`unsupported DeltaSetIndexMap format ${format}`);
    }

    // like HarfBuzz (DeltaSetIndexMap::map), a map without entries (a mapCount of 0, or an unknown format) maps each
    // glyph to the item of its glyph index (see getVariableAdjustment)
    if(!mapCount) return {
        format,
        entryFormat,
        map
    };

    const bitCount = (entryFormat & masks.INNER_INDEX_BIT_COUNT_MASK) + 1;
    const entrySize = ((entryFormat & masks.MAP_ENTRY_SIZE_MASK) >> 4) + 1;

    for (let n = 0; n < mapCount; n++) {
        let entry;
        if (entrySize === 1) {
            entry = this.parseByte();
        } else if (entrySize === 2) {
            entry = this.parseUShort();
        } else if (entrySize === 3) {
            entry = this.parseUInt24();
        } else if (entrySize === 4) {
            entry = this.parseULong();
        } else {
            throw new Error(`Invalid entry size of ${entrySize}`);
        }
    
        const outerIndex = entry >> bitCount;
        const innerIndex = entry & ((1 << bitCount) - 1);
        map.push({ outerIndex, innerIndex });
    }

    return {
        format,
        entryFormat,
        map,
    };
};

Parser.prototype.parseDeltaSets = function(itemCount, wordDeltaCount, regionIndexCount) {
    const deltas = Array.from({length: itemCount},()=>[]); // two-dimensional array with empty rows and columns

    const longFlag = wordDeltaCount & masks.LONG_WORDS;
    const wordCount = wordDeltaCount & masks.WORD_DELTA_COUNT_MASK;

    if(wordCount > regionIndexCount) {
        throw Error('wordCount must be less than or equal to regionIndexCount');
    }
    
    const wordParser = (longFlag ? this.parseLong : this.parseShort).bind(this);
    const restParser = (longFlag ? this.parseShort : this.parseChar).bind(this);
    
    for (let i = 0; i < itemCount; i++) {
        for (let j = 0; j < regionIndexCount; j++) {
            if (j < wordCount) {
                deltas[i].push(wordParser());
            } else {
                deltas[i].push(restParser());
            }
        }
    }

    return deltas;
};

/**
 * A view on the bytes of a table, or of a part of a table, only, like a sub-blob of HarfBuzz (hb_blob_create_sub_blob):
 * for the parsers that read an offset past the end of the table as a NULL offset (see isDeviceTableInData), or fail to
 * parse a part that ends past it, like HarfBuzz sanitizes the layout tables and reads the variation data of a glyph of a
 * gvar table. A part that ends past the end of the data is cut there; a part that starts past it, or of a negative
 * length, throws a RangeError.
 * @param {DataView} data - the data of the table or of the part (e.g. the data of the font file)
 * @param {number} start - the offset of the table or of the part in the data
 * @param {number} length - the length of the table or of the part
 * @return {DataView}
 */
function getTableView(data, start, length) {
    return new DataView(data.buffer, data.byteOffset + start, Math.min(length, data.byteLength - start));
}

/**
 * Parse the GlyphVariationData of a glyph of a gvar table (see parseTupleVariationStore) from its bytes only, like
 * HarfBuzz (gvar::get_glyph_var_data_bytes): undefined, the glyph not varied, when its header or its shared point
 * numbers fail to parse, the tuples from the first tuple variation header that fails to parse skipped, and the data of
 * a tuple that fail to parse (e.g. that run past the end of the data of the glyph) null when they are first read, each
 * error passed to onGlyphVariationsError
 * @param {DataView} data - the data of the gvar table
 * @param {number} start - the offset of the GlyphVariationData of the glyph in the data
 * @param {number} length - its length, up to the offset of the GlyphVariationData of the next glyph
 * @param {number} axisCount
 * @param {string} flavor
 * @param {Array} glyphs
 * @param {number} glyphIndex
 * @param {function(Error, number, number, boolean)} onGlyphVariationsError - see parseTupleVariationStoreList
 * @returns {object|undefined}
 */
function parseGlyphVariations(data, start, length, axisCount, flavor, glyphs, glyphIndex, onGlyphVariationsError) {
    try {
        return new Parser(getTableView(data, start, length), 0).parseTupleVariationStore(0, axisCount, flavor, glyphs,
            glyphIndex, (error, tupleIndex, isHeaderError) => onGlyphVariationsError(error, glyphIndex, tupleIndex, isHeaderError));
    } catch (error) {
        onGlyphVariationsError(error, glyphIndex);
        return undefined;
    }
}

/**
 * Parse the GlyphVariationData offsets of a gvar table: the variation data of each glyph, read when it is first used
 * @param {number} axisCount
 * @param {string} flavor - 'gvar'
 * @param {Array} glyphs
 * @param {function(Error, number, number, boolean)} [onGlyphVariationsError] - called with the error and the glyph index
 * of the variation data of a glyph that fails to parse when it is first read (see parseGlyphVariations), which is then
 * undefined, with the error, the glyph index and the tuple index of the data of a tuple that fail to parse when they
 * are first read, which are then null, and with true too for the first tuple variation header that fails to parse, the
 * tuples from it skipped (see parseTupleVariationStore); the error is thrown if omitted
 * @returns {Object<number, object|undefined>} the variation data by glyph index
 */
Parser.prototype.parseTupleVariationStoreList = function(axisCount, flavor, glyphs, onGlyphVariationsError = throwError) {
    const glyphCount = this.parseUShort();
    const flags = this.parseUShort();
    const offsetSizeIs32Bit = flags & 0x01;

    const glyphVariationDataArrayOffset = this.parseOffset32();
    const parseOffset = (offsetSizeIs32Bit ? this.parseULong : this.parseUShort).bind(this);

    const glyphVariations = {};

    let currentOffset = parseOffset();
    if (!offsetSizeIs32Bit) currentOffset *= 2;
    let nextOffset;

    for (let i = 0; i < glyphCount; i++) {
        nextOffset = parseOffset();
        if (!offsetSizeIs32Bit) nextOffset *= 2;
        
        const length = nextOffset - currentOffset;
        const glyphVariationsStart = this.offset + glyphVariationDataArrayOffset + currentOffset;

        // the variation data of a glyph is parsed when it is first read, e.g. when its outline is first varied
        if (length) {
            defineLazyProperty(glyphVariations, i, () => parseGlyphVariations(this.data, glyphVariationsStart, length,
                axisCount, flavor, glyphs, i, onGlyphVariationsError));
        } else {
            glyphVariations[i] = undefined;
        }

        currentOffset = nextOffset;
    }

    return glyphVariations;
};

/**
 * Parse the serialized data of a tuple of a tuple variation store from its bytes only, like HarfBuzz
 * (gvar::apply_deltas_to_points): its private point numbers, when it has them, and its deltas, x and y for gvar
 * @param {DataView} data
 * @param {number} start - the offset of the serialized data of the tuple in the data
 * @param {number} size - the variationDataSize of the tuple
 * @param {boolean} hasPrivatePoints
 * @param {function(Array<number>|undefined): number} getDeltaCount - the number of deltas of the tuple, from its private
 * point numbers (undefined without them)
 * @param {string} flavor - 'gvar' or 'cvar'
 * @returns {{privatePoints: Array<number>|undefined, deltas: Array<number>, deltasY: Array<number>|undefined}}
 */
function parseTupleData(data, start, size, hasPrivatePoints, getDeltaCount, flavor) {
    if (start + size > data.byteLength) {
        throw new RangeError('The serialized data of the tuple end past the end of the data');
    }
    const parser = new Parser(getTableView(data, start, size), 0);
    const privatePoints = hasPrivatePoints ? parser.parsePackedPointNumbers() : undefined;
    const deltaCount = getDeltaCount(privatePoints);
    const deltas = parser.parsePackedDeltas(deltaCount);
    const deltasY = flavor === 'gvar' ? parser.parsePackedDeltas(deltaCount) : undefined;
    return { privatePoints, deltas, deltasY };
}

/**
 * Parse a tuple variation store of a gvar table (the GlyphVariationData of a glyph) or of a cvar table: the tuple
 * variation headers and the shared point numbers, then the private point numbers and the deltas of each tuple, read
 * when one of them is first used. Like HarfBuzz reads the data of a tuple only when it is active
 * (gvar::apply_deltas_to_points), the data of a tuple that fail to parse (e.g. that end past the end of the store) fail
 * when they are first read: its privatePoints, deltas and deltasY are then null. Like HarfBuzz (tuple_iterator_t), the
 * tuples from the first tuple variation header that fails to parse (e.g. a tupleVariationCount larger than the headers
 * the store has) are skipped, and the tuples before it are kept.
 * @param {number} tableOffset - the offset of the store in the table
 * @param {number} axisCount
 * @param {string} flavor - 'gvar' or 'cvar'
 * @param {Array} glyphs - the glyphs of the font for gvar, the cvt table for cvar
 * @param {number} [glyphIndex] - the glyph of the store, for gvar
 * @param {function(Error, number, boolean)} [onTupleError] - called with the error and the tuple index of the data of a
 * tuple that fail to parse when they are first read, and with the error, the tuple index and true for the first header
 * that fails to parse, the tuples from it skipped, once the shared point numbers are parsed (not for a store that
 * fails to parse); the error is thrown if omitted
 * @returns {{headers: object[], sharedPoints: number[]}}
 */
Parser.prototype.parseTupleVariationStore = function(tableOffset, axisCount, flavor, glyphs, glyphIndex, onTupleError = throwError) {
    const relativeOffset = this.relativeOffset;
    
    this.relativeOffset = tableOffset;
    if(flavor === 'cvar') {
        this.relativeOffset+= 4; // we already parsed the version fields in cvar.mjs directly
    }

    // header
    const tupleVariationCount = this.parseUShort();
    const hasSharedPoints = !!(tupleVariationCount & masks.SHARED_POINT_NUMBERS);
    // const reserved = tupleVariationCount & 0x7000;
    const count = tupleVariationCount & masks.COUNT_MASK;
    let dataOffset = this.parseOffset16();
    const headers = [];
    let sharedPoints = [];
    // the error of the first header that does not fit in the data, passed to onTupleError once the shared point
    // numbers are parsed: a store whose shared point numbers fail to parse fails whole, with no header error
    let headerError;

    for (let i = 0; i < count; i++) {
        let header;
        try {
            header = this.parseTupleVariationHeader(axisCount, flavor);
        } catch (error) {
            // like HarfBuzz (tuple_iterator_t), the tuples from the first header that does not fit in the data are
            // skipped
            headerError = { error, tupleIndex: i };
            break;
        }
        headers.push(header);
    }

    if (this.relativeOffset !== tableOffset + dataOffset) {
        console.warn(`Unexpected offset after parsing tuple variation headers! Expected ${tableOffset + dataOffset}, actually ${this.relativeOffset}`);
        this.relativeOffset = tableOffset + dataOffset;
    }    

    if (hasSharedPoints) {
        sharedPoints = this.parsePackedPointNumbers();
    }
    if (headerError) {
        onTupleError(headerError.error, headerError.tupleIndex, true);
    }

    let serializedDataOffset = this.relativeOffset;

    for(let h = 0; h < headers.length; h++) {
        const header = headers[h];

        if(flavor === 'cvar' && !header.peakTuple) {
            console.warn('An embedded peak tuple is required in TupleVariationHeaders for the cvar table.');
        }

        const hasPrivatePoints = header.flags.privatePointNumbers;
        delete header.flags; // we don't need to expose this

        // one delta per point number of the tuple, like fontTools (TupleVariation.decompileDeltas_)
        const getDeltaCount = (privatePoints) => {
            // if the tuple had private points flag, use that list length (even if empty = all points).
            // if no flag, fall back to shared points length.
            const pointCount = getTuplePointNumbers({ privatePoints }, sharedPoints).length;
            if (pointCount) {
                return pointCount;
            }
            if (flavor === 'cvar') {
                return glyphs.length; // glyphs here is actually font.tables.cvt
            }
            // empty glyphs (eg. space) have no points but still have phantom points
            // add 4 phantom points, see https://learn.microsoft.com/en-us/typography/opentype/spec/tt_instructing_glyphs#phantoms
            // @TODO: actually generate these points from glyph.getBoundingBox() and glyph.getMetrics(),
            // as they may be influenced by variation as well
            return getGlyphVariationPointCount(glyphs.get(glyphIndex)) + 4;
        };
        const tupleDataStart = this.offset + serializedDataOffset;
        const tupleDataSize = header.variationDataSize;

        // the private point numbers and the deltas of the tuple, all parsed when one of them is first read, null when
        // they fail to parse
        let tupleData = undefined;
        const getTupleData = () => {
            if (tupleData === undefined) {
                try {
                    tupleData = parseTupleData(this.data, tupleDataStart, tupleDataSize, hasPrivatePoints,
                        getDeltaCount, flavor);
                } catch (error) {
                    onTupleError(error, h);
                    tupleData = null;
                }
            }
            return tupleData;
        };
        const defineTupleDataProperty = (propertyName, enumerable) => {
            Object.defineProperty(header, propertyName, {
                configurable: true,
                enumerable,
                get: () => getTupleData() && tupleData[propertyName],
                set: (value) => {
                    tupleData = Object.assign({}, getTupleData(), { [propertyName]: value });
                }
            });
        };

        if (hasPrivatePoints) {
            defineTupleDataProperty('privatePoints', true);
        }
        defineTupleDataProperty('deltas', false);
        if(flavor === 'gvar') {
            defineTupleDataProperty('deltasY', false);
        }

        serializedDataOffset += header.variationDataSize;
        delete header.variationDataSize; // we don't need to expose this
    }

    this.relativeOffset = relativeOffset;
    const result = {
        headers,
    };

    result.sharedPoints = sharedPoints;

    return result;
};

Parser.prototype.parseTupleVariationHeader = function(axisCount, flavor) {
    const variationDataSize = this.parseUShort();
    const tupleIndex = this.parseUShort();

    const embeddedPeakTuple = !!(tupleIndex & masks.EMBEDDED_PEAK_TUPLE);
    const intermediateRegion = !!(tupleIndex & masks.INTERMEDIATE_REGION);
    const privatePointNumbers = !!(tupleIndex & masks.PRIVATE_POINT_NUMBERS);
    // const reserved = tupleIndex & 0x1000;
    const sharedTupleRecordsIndex = embeddedPeakTuple ? undefined : tupleIndex & masks.TUPLE_INDEX_MASK;

    const peakTuple = embeddedPeakTuple ? this.parseTupleRecords(1, axisCount)[0] : undefined;
    const intermediateStartTuple = intermediateRegion ? this.parseTupleRecords(1, axisCount)[0] : undefined;
    const intermediateEndTuple = intermediateRegion ? this.parseTupleRecords(1, axisCount)[0] : undefined;

    const result = {
        variationDataSize,
        peakTuple,
        intermediateStartTuple,
        intermediateEndTuple,
        flags: {
            embeddedPeakTuple,
            intermediateRegion,
            privatePointNumbers,
        }
    };

    if(flavor === 'gvar') {
        result.sharedTupleRecordsIndex = sharedTupleRecordsIndex;
    }

    return result;
};

Parser.prototype.parsePackedPointNumbers = function() {
    const countByte1 = this.parseByte();
    const points = [];
    let totalPointCount = countByte1;
    
    if (countByte1 >= 128) {
        // High bit is set, need to read a second byte and combine.
        const countByte2 = this.parseByte();
    
        // Combine as big-endian uint16, with high bit of the first byte cleared.
        // This is done by masking the first byte with 0x7F (to clear the high bit)
        // and then shifting it left by 8 bits before adding the second byte.
        totalPointCount = ((countByte1 & masks.POINT_RUN_COUNT_MASK) << 8) | countByte2;
    }
    
    let lastPoint = 0;
    while (points.length < totalPointCount) {
        const controlByte = this.parseByte();
        const numbersAre16Bit = !!(controlByte & masks.POINTS_ARE_WORDS); // Check if high bit is set
        let runCount = (controlByte & masks.POINT_RUN_COUNT_MASK) + 1; // Number of points in this run
        for (let i = 0; i < runCount && points.length < totalPointCount; i++) {
            let pointDelta;
            if (numbersAre16Bit) {
                pointDelta = this.parseUShort(); // Parse delta as uint16
            } else {
                pointDelta = this.parseByte(); // Parse delta as uint8
            }
            // For the first point of the first run, use the value directly. Otherwise, accumulate.
            lastPoint = lastPoint + pointDelta;
            points.push(lastPoint);
        }
    }

    return points;
};

Parser.prototype.parsePackedDeltas = function(expectedCount) {
    const deltas = [];
    
    while (deltas.length < expectedCount) {
        const controlByte = this.parseByte();
        const zeroData = !!(controlByte & masks.DELTAS_ARE_ZERO);
        const deltaWords = !!(controlByte & masks.DELTAS_ARE_WORDS);
        const runCount = (controlByte & masks.DELTA_RUN_COUNT_MASK) + 1;
        
        for (let i = 0; i < runCount && deltas.length < expectedCount; i++) {
            if(zeroData) {
                deltas.push(0);
            } else if (deltaWords) {
                deltas.push(this.parseShort());
            } else {
                deltas.push(this.parseChar());
            }
        }
    }

    return deltas;
};

export default {
    getByte,
    getCard8: getByte,
    getUShort,
    getCard16: getUShort,
    getShort,
    getUInt24,
    getULong,
    getFixed,
    getTag,
    getOffset,
    getBytes,
    bytesToString,
    Parser,
};

export { Parser, createSkippablePartParser, getTableView, isDeviceTableInData, parseSkippableStruct, throwError };
