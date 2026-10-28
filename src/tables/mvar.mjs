// The `MVAR` table stores variation data for the font-wide metrics of other
// tables (e.g. the caret slope of hhea, the x-height of OS/2), by value tag.
// https://learn.microsoft.com/en-us/typography/opentype/spec/mvar

import parse from '../parse.mjs';

function parseMvarTable(data, start) {
    const p = new parse.Parser(data, start);
    const tableVersionMajor = p.parseUShort();
    const tableVersionMinor = p.parseUShort();

    if (tableVersionMajor !== 1) {
        console.warn(`Unsupported mvar table version ${tableVersionMajor}.${tableVersionMinor}`);
    }

    const version = [
        tableVersionMajor, tableVersionMinor
    ];

    p.parseUShort(); // reserved
    const valueRecordSize = p.parseUShort();
    const valueRecordCount = p.parseUShort();
    const itemVariationStore = p.parsePointer(function() {
        return this.parseItemVariationStore();
    });

    // the value records follow the header, each valueRecordSize bytes long
    // (a larger size leaves room for fields of future versions)
    const valueRecords = {};
    const recordsStart = p.relativeOffset;
    for (let i = 0; i < valueRecordCount; i++) {
        p.relativeOffset = recordsStart + i * valueRecordSize;
        const tag = p.parseTag();
        valueRecords[tag] = {
            outerIndex: p.parseUShort(),
            innerIndex: p.parseUShort(),
        };
    }

    return {
        version,
        itemVariationStore,
        valueRecords,
    };
}

function makeMvarTable(/*fvar*/) {
    console.warn('Writing of mvar tables is not yet supported.');
}

export default { make: makeMvarTable, parse: parseMvarTable };
