// The `GPOS` table contains kerning pairs, among other things.
// https://docs.microsoft.com/en-us/typography/opentype/spec/gpos

import check from '../check.mjs';
import { Parser } from '../parse.mjs';
import table from '../table.mjs';

const subtableParsers = new Array(10);         // subtableParsers[0] is unused

// https://docs.microsoft.com/en-us/typography/opentype/spec/gpos#lookup-type-1-single-adjustment-positioning-subtable
// this = Parser instance
subtableParsers[1] = function parseLookup1() {
    const start = this.offset + this.relativeOffset;
    const posformat = this.parseUShort();
    // device offsets of the value records are relative to the SinglePos subtable
    if (posformat === 1) {
        const coverage = this.parsePointer(Parser.coverage);
        const valueFormat = this.parseUShort();
        return {
            posFormat: 1,
            coverage: coverage,
            value: this.parseValueRecord(valueFormat, start)
        };
    } else if (posformat === 2) {
        return {
            posFormat: 2,
            coverage: this.parsePointer(Parser.coverage),
            values: this.parseValueRecordList(start)
        };
    }
    check.assert(false, '0x' + start.toString(16) + ': GPOS lookup type 1 format must be 1 or 2.');
};

// https://docs.microsoft.com/en-us/typography/opentype/spec/gpos#lookup-type-2-pair-adjustment-positioning-subtable
subtableParsers[2] = function parseLookup2() {
    const start = this.offset + this.relativeOffset;
    const posFormat = this.parseUShort();
    check.assert(posFormat === 1 || posFormat === 2, '0x' + start.toString(16) + ': GPOS lookup type 2 format must be 1 or 2.');
    const coverage = this.parsePointer(Parser.coverage);
    const valueFormat1 = this.parseUShort();
    const valueFormat2 = this.parseUShort();
    if (posFormat === 1) {
        // Adjustments for Glyph Pairs
        return {
            posFormat: posFormat,
            coverage: coverage,
            valueFormat1: valueFormat1,
            valueFormat2: valueFormat2,
            pairSets: this.parseList(Parser.pointer(Parser.list(function() {
                // device offsets of a PairValueRecord are relative to its PairSet table
                const pairSetStart = this.offset;
                return {        // pairValueRecord
                    secondGlyph: this.parseUShort(),
                    value1: this.parseValueRecord(valueFormat1, pairSetStart),
                    value2: this.parseValueRecord(valueFormat2, pairSetStart)
                };
            })))
        };
    } else if (posFormat === 2) {
        const classDef1 = this.parsePointer(Parser.classDef);
        const classDef2 = this.parsePointer(Parser.classDef);
        const class1Count = this.parseUShort();
        const class2Count = this.parseUShort();
        return {
            // Class Pair Adjustment
            posFormat: posFormat,
            coverage: coverage,
            valueFormat1: valueFormat1,
            valueFormat2: valueFormat2,
            classDef1: classDef1,
            classDef2: classDef2,
            class1Count: class1Count,
            class2Count: class2Count,
            classRecords: this.parseList(class1Count, Parser.list(class2Count, function() {
                // device offsets of a Class2Record are relative to the PairPos subtable
                return {
                    value1: this.parseValueRecord(valueFormat1, start),
                    value2: this.parseValueRecord(valueFormat2, start)
                };
            }))
        };
    }
};

// https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#anchor-tables
// this = Parser instance at the start of the Anchor table, which the offsets of its Device tables are relative to.
// The contour point of format 2 is read but, like HarfBuzz without hinting, not used: the anchor is its coordinates.
function parseAnchor() {
    const start = this.offset + this.relativeOffset;
    const anchorFormat = this.parseUShort();
    check.assert(anchorFormat >= 1 && anchorFormat <= 3, '0x' + start.toString(16) + ': GPOS anchor format must be 1, 2 or 3.');
    const anchor = {
        anchorFormat,
        xCoordinate: this.parseShort(),
        yCoordinate: this.parseShort()
    };
    if (anchorFormat === 2) {
        anchor.anchorPoint = this.parseUShort();
    } else if (anchorFormat === 3) {
        anchor.xDevice = this.parsePointer(Parser.prototype.parseDeviceTable);
        anchor.yDevice = this.parsePointer(Parser.prototype.parseDeviceTable);
    }
    return anchor;
}

// https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#mark-array-table
// this = Parser instance at the start of the MarkArray table
function parseMarkArray() {
    return this.parseList(function() {
        return {
            markClass: this.parseUShort(),
            markAnchor: this.parsePointer(parseAnchor)
        };
    });
}

// the anchors of the BaseArray, Mark2Array and LigatureAttach tables: for each of their records (base glyph, mark2
// glyph, ligature component), the anchor of each mark class, undefined for a NULL offset
function anchorMatrix(markClassCount) {
    return function() {
        return this.parseList(Parser.list(markClassCount, Parser.pointer(parseAnchor)));
    };
}

// https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#lookup-type-3-cursive-attachment-positioning-subtable
subtableParsers[3] = function parseLookup3() {
    const start = this.offset + this.relativeOffset;
    const posFormat = this.parseUShort();
    check.assert(posFormat === 1, '0x' + start.toString(16) + ': GPOS lookup type 3 format must be 1.');
    return {
        posFormat,
        coverage: this.parsePointer(Parser.coverage),
        entryExitRecords: this.parseList(function() {
            return {
                entryAnchor: this.parsePointer(parseAnchor),
                exitAnchor: this.parsePointer(parseAnchor)
            };
        })
    };
};

// https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#lookup-type-4-mark-to-base-attachment-positioning-subtable
subtableParsers[4] = function parseLookup4() {
    const start = this.offset + this.relativeOffset;
    const posFormat = this.parseUShort();
    check.assert(posFormat === 1, '0x' + start.toString(16) + ': GPOS lookup type 4 format must be 1.');
    const markCoverage = this.parsePointer(Parser.coverage);
    const baseCoverage = this.parsePointer(Parser.coverage);
    const markClassCount = this.parseUShort();
    return {
        posFormat,
        markCoverage,
        baseCoverage,
        markClassCount,
        markArray: this.parsePointer(parseMarkArray),
        baseArray: this.parsePointer(anchorMatrix(markClassCount))
    };
};

// https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#lookup-type-5-mark-to-ligature-attachment-positioning-subtable
subtableParsers[5] = function parseLookup5() {
    const start = this.offset + this.relativeOffset;
    const posFormat = this.parseUShort();
    check.assert(posFormat === 1, '0x' + start.toString(16) + ': GPOS lookup type 5 format must be 1.');
    const markCoverage = this.parsePointer(Parser.coverage);
    const ligatureCoverage = this.parsePointer(Parser.coverage);
    const markClassCount = this.parseUShort();
    return {
        posFormat,
        markCoverage,
        ligatureCoverage,
        markClassCount,
        markArray: this.parsePointer(parseMarkArray),
        // the anchors of each component of each ligature (see anchorMatrix), undefined for a NULL LigatureAttach offset
        ligatureArray: this.parsePointer(Parser.list(Parser.pointer(anchorMatrix(markClassCount))))
    };
};

// https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#lookup-type-6-mark-to-mark-attachment-positioning-subtable
subtableParsers[6] = function parseLookup6() {
    const start = this.offset + this.relativeOffset;
    const posFormat = this.parseUShort();
    check.assert(posFormat === 1, '0x' + start.toString(16) + ': GPOS lookup type 6 format must be 1.');
    const mark1Coverage = this.parsePointer(Parser.coverage);
    const mark2Coverage = this.parsePointer(Parser.coverage);
    const markClassCount = this.parseUShort();
    return {
        posFormat,
        mark1Coverage,
        mark2Coverage,
        markClassCount,
        mark1Array: this.parsePointer(parseMarkArray),
        mark2Array: this.parsePointer(anchorMatrix(markClassCount))
    };
};

// https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#lookup-type-7-contextual-positioning-subtables
subtableParsers[7] = function parseLookup7() {
    return this.parseSequenceContext('posFormat', 'GPOS lookup type 7');
};

// https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#lookup-type-8-chained-contexts-positioning-subtable
subtableParsers[8] = function parseLookup8() {
    return this.parseChainedSequenceContext('posFormat', 'GPOS lookup type 8');
};
// https://docs.microsoft.com/en-us/typography/opentype/spec/gpos#lookup-type-9-extension-positioning
subtableParsers[9] = function parseLookup9() {
    // Extension Positioning subtable: wraps a subtable of another lookup type behind a 32-bit offset
    const start = this.offset + this.relativeOffset;
    const posFormat = this.parseUShort();
    const extensionLookupType = this.parseUShort();
    // a malformed extension subtable is skipped (see getLookupSubtables in position.mjs), without failing the parsing
    if (posFormat !== 1) {
        return { error: '0x' + start.toString(16) + ': GPOS lookup type 9 format must be 1.' };
    }
    if (extensionLookupType < 1 || extensionLookupType > 8) {
        return { error: '0x' + start.toString(16) + ': GPOS extension lookup type must be 1 to 8.' };
    }
    // the offset is relative to the start of this Extension Positioning subtable
    const extensionParser = new Parser(this.data, start + this.parseOffset32());
    return {
        posFormat: 1,
        lookupType: extensionLookupType,
        extension: subtableParsers[extensionLookupType].call(extensionParser)
    };
};

// https://docs.microsoft.com/en-us/typography/opentype/spec/gpos
function parseGposTable(data, start) {
    start = start || 0;
    const p = new Parser(data, start);
    const tableVersion = p.parseVersion(1);
    check.argument(tableVersion === 1 || tableVersion === 1.1, 'Unsupported GPOS table version ' + tableVersion);

    if (tableVersion === 1) {
        return {
            version: tableVersion,
            scripts: p.parseScriptList(),
            features: p.parseFeatureList(),
            lookups: p.parseLookupList(subtableParsers)
        };
    } else {
        return {
            version: tableVersion,
            scripts: p.parseScriptList(),
            features: p.parseFeatureList(),
            lookups: p.parseLookupList(subtableParsers),
            variations: p.parseFeatureVariationsList()
        };
    }

}

// GPOS Writing //////////////////////////////////////////////
// NOT SUPPORTED
const subtableMakers = new Array(10);

function makeGposTable(gpos) {
    return new table.Table('GPOS', [
        {name: 'version', type: 'ULONG', value: 0x10000},
        {name: 'scripts', type: 'TABLE', value: new table.ScriptList(gpos.scripts)},
        {name: 'features', type: 'TABLE', value: new table.FeatureList(gpos.features)},
        {name: 'lookups', type: 'TABLE', value: new table.LookupList(gpos.lookups, subtableMakers)}
    ]);
}

export default { parse: parseGposTable, make: makeGposTable };
