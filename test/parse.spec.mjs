import assert from 'assert';
import { unhex } from './testutil.mjs';
import { Parser, createSkippablePartParser, getTableView, isDeviceTableInData, parseSkippableStruct, throwError } from '../src/parse.mjs';

describe('parse.mjs', function() {
    // interpret hex as signed integer
    const signed = hex => {
        const bitLength = hex.toString(16).length * 4;
        const mask = 1 << (bitLength - 1);
        const maxUnsigned = (1 << bitLength) - 1;
        return (hex & mask) ? -(~hex & maxUnsigned) - 1 : hex;
    };    

    describe('parseFixed', function() {
        it('can parse 16.16 fixed-point values exactly', function() {
            const p = new Parser(unhex('00010000 00018000 FFF68000 0000FFFF 7FFFFFFF 80000000'), 0);
            assert.strictEqual(p.parseFixed(), 1);
            assert.strictEqual(p.parseFixed(), 1.5);
            assert.strictEqual(p.parseFixed(), -9.5);
            assert.strictEqual(p.parseFixed(), 65535 / 65536);
            assert.strictEqual(p.parseFixed(), 32767 + 65535 / 65536);
            assert.strictEqual(p.parseFixed(), -32768);
            assert.equal(p.relativeOffset, 24);
        });
    });

    describe('parseUShortList', function() {
        it('can parse an empty list', function() {
            const p = new Parser(unhex('0000'), 0);
            assert.deepEqual(p.parseUShortList(), []);
        });

        it('can parse a list', function() {
            const p = new Parser(unhex('0003 1234 DEAD BEEF'), 0);
            assert.deepEqual(p.parseUShortList(), [0x1234, 0xdead, 0xbeef]);
        });

        it('can parse a list of predefined length', function() {
            const p = new Parser(unhex('1234 DEAD BEEF 5678 9ABC'), 2);
            assert.deepEqual(p.parseUShortList(3), [0xdead, 0xbeef, 0x5678]);
        });
    });

    describe('parseList', function() {
        it('can parse a list of values', function() {
            const data = '0003 12 34 56 78 9A BC';
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseList(Parser.uShort), [0x1234, 0x5678, 0x9abc]);
            assert.equal(p.relativeOffset, 8);
        });

        it('can parse a list of values of predefined length', function() {
            const data = '12 34 56 78 9A BC';
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseList(3, Parser.uShort), [0x1234, 0x5678, 0x9abc]);
            assert.equal(p.relativeOffset, 6);
        });
    });

    describe('parseRecordList', function() {
        it('can parse a list of records', function() {
            const data = '0002 12 34 56 78 9A BC';
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseRecordList({ a: Parser.byte, b: Parser.uShort }), [
                { a: 0x12, b: 0x3456 },
                { a: 0x78, b: 0x9abc }
            ]);
            assert.equal(p.relativeOffset, 8);
        });

        it('can parse an empty list of records', function() {
            const data = '0000';
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseRecordList({ a: Parser.byte, b: Parser.uShort }), []);
            assert.equal(p.relativeOffset, 2);
        });

        it('can parse a list of records of predefined length', function() {
            const data = '12 34 56 78 9A BC';
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseRecordList(2, { a: Parser.byte, b: Parser.uShort }), [
                { a: 0x12, b: 0x3456 },
                { a: 0x78, b: 0x9abc }
            ]);
            assert.equal(p.relativeOffset, 6);
        });
    });

    describe('parseListOfLists', function() {
        it('can parse a list of lists of 16-bit integers', function() {
            const data = '0003 0008 000E 0016' +      // 3 lists
                '0002 1234 5678' +                  // list 1
                '0003 DEAD BEEF FADE' +             // list 2
                '0001 9876';                        // list 3
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseListOfLists(), [
                [0x1234, 0x5678],
                [0xdead, 0xbeef, 0xfade],
                [0x9876]
            ]);
        });

        it('can parse an empty list of lists', function() {
            const p = new Parser(unhex('0000'), 0);
            assert.deepEqual(p.parseListOfLists(), []);
        });

        it('can parse list of empty lists', function() {
            const p = new Parser(unhex('0001 0004 0000'), 0);
            assert.deepEqual(p.parseListOfLists(), [[]]);
        });

        it('can parse a list of lists of records', function() {
            const data = '0002 0006 0012' +                   // 2 lists
                '0002 0006 0009 12 34 56 78 9A BC' +        // list 1
                '0001 0004 DE F0 12';                       // list 2

            const p = new Parser(unhex(data), 0);
            function parseRecord() {
                return { a: p.parseByte(), b: p.parseUShort() };
            }

            assert.deepEqual(p.parseListOfLists(parseRecord), [
                [{ a: 0x12, b: 0x3456 }, { a: 0x78, b: 0x9abc }],
                [{ a: 0xde, b: 0xf012 }]
            ]);
        });

        it('reads a NULL offset to a list or to an item as undefined', function() {
            // like a LigatureSet (list 1) whose first Ligature offset is NULL, and a NULL LigatureSet (list 2): the item
            // is not read from the bytes of its list
            const data = '0002 0006 0000' +                   // 2 lists, the second one NULL
                '0002 0000 0006 12 34 56';                  // list 1: a NULL item, then an item
            const p = new Parser(unhex(data), 0);
            function parseRecord() {
                return { a: p.parseByte(), b: p.parseUShort() };
            }
            assert.deepStrictEqual(p.parseListOfLists(parseRecord), [[undefined, { a: 0x12, b: 0x3456 }], undefined]);
        });
    });

    describe('parseCoverage', function() {
        it('should parse a CoverageFormat1 table', function() {
            // https://www.microsoft.com/typography/OTSPEC/chapter2.htm Example 5
            const data = '0004 1234' +                // coverageOffset + filler
                '0001 0005 0038 003B 0041 0042 004A';
            const p = new Parser(unhex(data), 4);
            assert.deepEqual(p.parseCoverage(), {
                format: 1,
                glyphs: [0x38, 0x3b, 0x41, 0x42, 0x4a]
            });
            assert.equal(p.relativeOffset, 14);
        });

        it('should parse a CoverageFormat2 table', function() {
            // https://www.microsoft.com/typography/OTSPEC/chapter2.htm Example 6
            const data = '0004 1234' +                // coverageOffset + filler
                '0002 0001 004E 0057 0000';
            const p = new Parser(unhex(data), 4);
            assert.deepEqual(p.parseCoverage(), {
                format: 2,
                ranges: [{ start: 0x4e, end: 0x57, index: 0 }]
            });
            assert.equal(p.relativeOffset, 10);
        });
    });

    describe('parseClassDef', function() {
        it('should parse a ClassDefFormat1 table', function() {
            // https://docs.microsoft.com/en-us/typography/opentype/spec/chapter2#example-7-classdefformat1-table-class-array
            const data = '0001 0032 001A' +
                '0000 0001 0000 0001 0000 0001 0002 0001 0000 0002 0001 0001 0000' +
                '0000 0000 0002 0002 0000 0000 0001 0000 0000 0000 0000 0002 0001';
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseClassDef(), {
                format: 1,
                startGlyph: 0x32,
                classes: [
                    0, 1, 0, 1, 0, 1, 2, 1, 0, 2, 1, 1, 0,
                    0, 0, 2, 2, 0, 0, 1, 0, 0, 0, 0, 2, 1
                ]
            });
            assert.equal(p.relativeOffset, 58);
        });

        it('should parse a ClassDefFormat2 table', function() {
            // https://docs.microsoft.com/en-us/typography/opentype/spec/chapter2#example-8-classdefformat2-table-class-ranges
            const data = '0002 0003 0030 0031 0002 0040 0041 0003 00D2 00D3 0001';
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseClassDef(), {
                format: 2,
                ranges: [
                    { start: 0x30, end: 0x31, classId: 2 },
                    { start: 0x40, end: 0x41, classId: 3 },
                    { start: 0xd2, end: 0xd3, classId: 1 }
                ]
            });
            assert.equal(p.relativeOffset, 22);
        });
    });

    describe('parseScriptList', function() {
        it('should parse a ScriptList table', function() {
            // https://www.microsoft.com/typography/OTSPEC/chapter2.htm Examples 1 & 2
            const data = '0004 1234' +                // coverageOffset + filler
                '0003 68616E69 0014 6B616E61 0018 6C61746E 001C' +  // Example 1
                '0000 0000 0000 0000' +                             // 2 empty Script Tables
                '000A 0001 55524420 0016' +                         // Example 2
                '0000 FFFF 0003 0000 0001 0002' +                   // DefLangSys
                '0000 0003 0003 0000 0001 0002';                    // UrduLangSys
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseScriptList(), [
                { tag: 'hani', script: { defaultLangSys: undefined, langSysRecords: [] } },
                { tag: 'kana', script: { defaultLangSys: undefined, langSysRecords: [] } },
                { tag: 'latn', script: {
                    defaultLangSys: {
                        reserved: 0,
                        reqFeatureIndex: 0xffff,
                        featureIndexes: [0, 1, 2]
                    },
                    langSysRecords: [{
                        tag: 'URD ',
                        langSys: {
                            reserved: 0,
                            reqFeatureIndex: 3,
                            featureIndexes: [0, 1, 2]
                        }
                    }]
                } },
            ]);
            assert.equal(p.relativeOffset, 2);
        });
    });

    describe('parseFeatureList', function() {
        it('should parse a FeatureList table', function() {
            // https://www.microsoft.com/typography/OTSPEC/chapter2.htm Example 3
            const data = '0004 0000' +                                // table offset + filler
                '0003 6C696761 0014 6C696761 001A 6C696761 0022' +  // feature list
                // There is an error in the online example, count is 3 for the 3rd feature.
                '0000 0001 0000   0000 0002 0000 0001   0000 0003 0000 0001 0002';
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseFeatureList(), [
                { tag: 'liga', feature: { featureParams: 0, lookupListIndexes: [0] } },
                { tag: 'liga', feature: { featureParams: 0, lookupListIndexes: [0, 1] } },
                { tag: 'liga', feature: { featureParams: 0, lookupListIndexes: [0, 1, 2] } }
            ]);
            assert.equal(p.relativeOffset, 2);
        });
    });

        it('should parse the FeatureParams tables of stylistic set and character variant features', function() {
            const data = '0004 0000' +                                // table offset + filler
                '0003 73733031 0014 63763031 001E 6C696761 0038' +  // feature list: ss01, cv01, liga
                '0006 0001 0000   0000 0100' +                      // ss01 feature, FeatureParams: version 0, uiNameID 256
                '0006 0001 0001   0000 0101 0102 0000 0002 0103' +  // cv01 feature, FeatureParams: format 0, label 257, tooltip 258,
                '0002 000061 01D5BA' +                              //   no sample text, 2 parameters from 259, 2 characters
                '0006 0001 0002   DEAD';                            // liga feature with a FeatureParams offset, not parsed
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseFeatureList(), [
                { tag: 'ss01', feature: { featureParams: 6, lookupListIndexes: [0], featureParamsTable: { version: 0, uiNameID: 256 } } },
                { tag: 'cv01', feature: { featureParams: 6, lookupListIndexes: [1], featureParamsTable: {
                    format: 0,
                    featUiLabelNameID: 257,
                    featUiTooltipTextNameID: 258,
                    sampleTextNameID: 0,
                    numNamedParameters: 2,
                    firstParamUiLabelNameID: 259,
                    characters: [0x61, 0x1D5BA]
                } } },
                { tag: 'liga', feature: { featureParams: 6, lookupListIndexes: [2] } }
            ]);
        });

        it('should ignore a FeatureParams table outside of the data', function() {
            const data = '0004 0000' +       // table offset + filler
                '0001 73733031 0008' +      // feature list: ss01
                '7FF0 0001 0000';           // ss01 feature, with a FeatureParams offset beyond the data
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseFeatureList(), [
                { tag: 'ss01', feature: { featureParams: 0x7FF0, lookupListIndexes: [0] } }
            ]);
        });

        it('reads a NULL Feature offset as a Feature table without lookups, like the Null Feature of HarfBuzz', function() {
            const data = '0004 0000' +                  // table offset + filler
                '0002 6B65726E 0000 6C696761 000E' +    // feature list: kern with a NULL Feature offset, liga
                '0000 0001 0003';                       // liga feature
            const p = new Parser(unhex(data), 0);
            assert.deepStrictEqual(p.parseFeatureList(), [
                { tag: 'kern', feature: { featureParams: 0, lookupListIndexes: [] } },
                { tag: 'liga', feature: { featureParams: 0, lookupListIndexes: [3] } }
            ]);
        });

    describe('parseLookupList', function() {
        it('should parse a LookupList table', function() {
            // https://www.microsoft.com/typography/OTSPEC/chapter2.htm Example 4
            const data = '0004 0000' +                    // table offset + filler
                '0003 0008 0010 0018' +                 // lookup list
                '0004 000C 0001 0018' +                 // FfiFi lookup
                '0004 000C 0001 0028' +                 // FflFlFf lookup
                '0004 000C 0001 0038' +                 // Eszet lookup
                '1234 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000' +
                '5678 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000' +
                '9ABC';
            const lookupTableParsers = [0, 0, 0, 0, Parser.uShort];
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseLookupList(lookupTableParsers), [
                { lookupType: 4, lookupFlag: 0x000c, subtables: [0x1234], markFilteringSet: undefined },
                { lookupType: 4, lookupFlag: 0x000c, subtables: [0x5678], markFilteringSet: undefined },
                { lookupType: 4, lookupFlag: 0x000c, subtables: [0x9abc], markFilteringSet: undefined },
            ]);
            assert.equal(p.relativeOffset, 2);
        });

        describe('of malformed lookups', function() {
            // a lookup list of three lookups: a NULL lookup offset, a lookup of type 1 with a NULL subtable offset and
            // the subtables 0x1234 and 0x0BAD (which its parser rejects), a lookup of type 2 with the subtable 0x0BAD
            const data = '0004 0000' +                    // table offset + filler
                '0003 0000 0008 0018' +                 // lookup list
                '0001 0000 0003 0000 000C 000E' +       // lookup of type 1
                '1234 0BAD' +
                '0002 0000 0001 0008 0BAD';             // lookup of type 2
            const parseSubtable = function() {
                const value = this.parseUShort();
                if (value === 0x0BAD) {
                    throw new Error('bad subtable');
                }
                return value;
            };
            const lookupTableParsers = [undefined, parseSubtable, parseSubtable];

            it('reads a NULL lookup or subtable offset and a subtable that fails to parse as undefined', function() {
                const errors = [];
                const lookups = new Parser(unhex(data), 0).parseLookupList(lookupTableParsers, (error, lookupIndex, subtableIndex) => {
                    assert.ok(error instanceof Error);
                    errors.push([error.message, lookupIndex, subtableIndex]);
                });
                assert.deepStrictEqual(lookups, [
                    undefined,
                    { lookupType: 1, lookupFlag: 0, subtables: [undefined, 0x1234, undefined], markFilteringSet: undefined },
                    { lookupType: 2, lookupFlag: 0, subtables: [undefined], markFilteringSet: undefined }
                ]);
                assert.deepStrictEqual(errors, [['bad subtable', 1, 2], ['bad subtable', 2, 0]]);
            });

            it('throws the error of a subtable that fails to parse without a callback', function() {
                assert.throws(() => new Parser(unhex(data), 0).parseLookupList(lookupTableParsers), /bad subtable/);
            });

            it('reads the subtables of a lookup type without a parser as subtables that fail to parse, like HarfBuzz', function() {
                // HarfBuzz ignores a lookup of an unknown type (Lookup::dispatch): it keeps its type and applies nothing
                const errors = [];
                const lookups = new Parser(unhex(data), 0).parseLookupList([undefined, parseSubtable], (error, lookupIndex, subtableIndex) => {
                    errors.push([error.message, lookupIndex, subtableIndex]);
                });
                assert.deepStrictEqual(lookups[2], { lookupType: 2, lookupFlag: 0, subtables: [undefined], markFilteringSet: undefined });
                assert.deepStrictEqual(errors, [['bad subtable', 1, 2], ['GPOS/GSUB lookup type 2 unknown.', 2, 0]]);
                assert.throws(() => new Parser(unhex(data), 0).parseLookupList([undefined, value => value]),
                    /GPOS\/GSUB lookup type 2 unknown./);
            });
        });

        describe('of extension lookups', function() {
            // four lookups of type 7, the extension lookup type given to parseLookupList, whose subtables are an
            // Extension format (1) and an extensionLookupType: two subtables of type 1; a subtable of type 1 and one of
            // type 9; a subtable of type 1 and a NULL subtable; a NULL subtable, a subtable of format 2 and a subtable
            // past the end of the data, which HarfBuzz all reads as of type 0 (Extension::get_type)
            const data = '0004 0000' +                    // table offset + filler
                '0004 000A 001C 002E 003C' +            // lookup list
                '0007 0000 0002 000A 000E 0001 0001 0001 0001' +
                '0007 0000 0002 000A 000E 0001 0001 0001 0009' +
                '0007 0000 0002 000A 0000 0001 0001' +
                '0007 0000 0003 0000 000C 0FFF 0002 0001';
            const parseExtensionHeader = function() {
                return [this.parseUShort(), this.parseUShort()];
            };
            const lookupTableParsers = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, parseExtensionHeader];
            const parseLookups = extensionLookupType => {
                const errors = [];
                const lookups = new Parser(unhex(data), 0).parseLookupList(lookupTableParsers, (error, lookupIndex, subtableIndex) => {
                    errors.push([error.message, lookupIndex, subtableIndex]);
                }, extensionLookupType);
                return { subtables: lookups.map(lookup => lookup.subtables), errors };
            };

            it('skips the subtables of an extension lookup whose subtables have different extension lookup types, like HarfBuzz', function() {
                // HarfBuzz drops such a lookup (Lookup::sanitize), whose subtables are then not parsed
                const { subtables, errors } = parseLookups(7);
                assert.deepStrictEqual(subtables, [[[1, 1], [1, 1]], [undefined, undefined], [undefined, undefined], [undefined, [2, 1], undefined]]);
                assert.deepStrictEqual(errors, [
                    ['The subtables of an extension lookup must have the same extension lookup type, not 1, 9', 1, undefined],
                    ['The subtables of an extension lookup must have the same extension lookup type, not 1, 0', 2, undefined],
                    ['Offset is outside the bounds of the DataView', 3, 2]
                ]);
                assert.throws(() => new Parser(unhex(data), 0).parseLookupList(lookupTableParsers, undefined, 7),
                    /The subtables of an extension lookup must have the same extension lookup type, not 1, 9/);
            });

            it('does not compare the subtables of the lookups of another type than the extension lookup type', function() {
                const { subtables, errors } = parseLookups(9);
                assert.deepStrictEqual(subtables, [[[1, 1], [1, 1]], [[1, 1], [1, 9]], [[1, 1], undefined], [undefined, [2, 1], undefined]]);
                assert.deepStrictEqual(errors, [['Offset is outside the bounds of the DataView', 3, 2]]);
            });
        });
    });

    describe('parseTupleVariationStore', function() {
        // a cvar table of one axis: its version, a tupleVariationCount of 0x8002 (shared point numbers, 2 tuples), a
        // dataOffset, the header of the tuple 0 (variationDataSize 2, an embedded peak of 0.25), and the header of the
        // tuple 1 does not fit in the data
        const parseStore = data => {
            const errors = [];
            const store = new Parser(unhex(data), 0).parseTupleVariationStore(0, 1, 'cvar', [0], undefined,
                (error, tupleIndex, isHeaderError) => errors.push([error.message, tupleIndex, isHeaderError]));
            return { store, errors };
        };

        it('passes the error of the first header that does not fit once the shared point numbers are parsed', function() {
            // the shared point numbers at the dataOffset 14: a packed point count of 0, all the points
            const { store, errors } = parseStore('0001 0000 8002 000E 0002 8000 1000 00');
            assert.deepStrictEqual(store.headers.map(header => header.peakTuple), [[0.25]]);
            assert.deepStrictEqual(store.sharedPoints, []);
            assert.deepStrictEqual(errors, [['Offset is outside the bounds of the DataView', 1, true]]);
        });

        it('passes no header error for a store whose shared point numbers fail to parse', function() {
            // the shared point numbers at the dataOffset 0xFF, past the end of the data: the store fails whole
            const errors = [];
            assert.throws(() => new Parser(unhex('0001 0000 8002 00FF 0002 8000 1000 00'), 0).parseTupleVariationStore(0, 1,
                'cvar', [0], undefined, error => errors.push(error.message)), /Offset is outside the bounds of the DataView/);
            assert.deepStrictEqual(errors, []);
        });
    });

    describe('parseSkippableStruct', function() {
        it('reads a part that fails to parse as undefined, with its error passed to the callback', function() {
            const errors = [];
            const parseUShortPair = function() {
                return [this.parseUShort(), this.parseUShort()];
            };
            assert.deepStrictEqual(parseSkippableStruct(unhex('0001 0002 0003'), 2, parseUShortPair, error => errors.push(error)), [2, 3]);
            assert.deepStrictEqual(errors, []);
            assert.strictEqual(parseSkippableStruct(unhex('0001 0002 0003'), 4, parseUShortPair, error => errors.push(error)), undefined);
            assert.strictEqual(errors.length, 1);
            assert.ok(errors[0] instanceof RangeError);
            assert.throws(() => parseSkippableStruct(unhex('0001'), 0, parseUShortPair, throwError), RangeError);
        });
    });

    describe('createSkippablePartParser', function() {
        it('reads a part at its offset from the start of the table, undefined for a NULL offset or a part that fails to parse, with its error and its name', function() {
            const partErrors = [];
            const parseUShortPair = function() {
                return [this.parseUShort(), this.parseUShort()];
            };
            // a table at 2 in the data, the ushorts 2 and 3 at 2 in the table
            const parsePart = createSkippablePartParser(unhex('FFFF 0001 0002 0003'), 2, (error, partName) => partErrors.push({ error, partName }));
            assert.deepStrictEqual(parsePart('first part', 2, parseUShortPair), [2, 3]);
            assert.strictEqual(parsePart('NULL part', 0, parseUShortPair), undefined);
            assert.deepStrictEqual(partErrors, []);
            assert.strictEqual(parsePart('second part', 4, parseUShortPair), undefined);
            assert.deepStrictEqual(partErrors.map(({ partName }) => partName), ['second part']);
            assert.ok(partErrors[0].error instanceof RangeError);
            assert.throws(() => createSkippablePartParser(unhex('0001'), 0, throwError)('part', 1, parseUShortPair), RangeError);
        });
    });

    describe('getTableView', function() {
        const getBytes = view => Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));

        it('gives a view on the bytes of a part of the data only', function() {
            const data = unhex('0001 0203 0405');
            const view = getTableView(data, 2, 3);
            assert.strictEqual(view.buffer, data.buffer);
            assert.deepStrictEqual([view.byteOffset, view.byteLength], [2, 3]);
            assert.deepStrictEqual(getBytes(view), [2, 3, 4]);
            assert.strictEqual(getTableView(data, 6, 0).byteLength, 0);
        });

        it('cuts a part that ends past the end of the data there', function() {
            const view = getTableView(unhex('0001 0203 0405'), 4, 10);
            assert.deepStrictEqual([view.byteOffset, view.byteLength], [4, 2]);
            assert.deepStrictEqual(getBytes(view), [4, 5]);
        });

        it('throws a RangeError for a part that starts past the end of the data, or of a negative length', function() {
            assert.throws(() => getTableView(unhex('0001 0203 0405'), 7, 1), RangeError);
            assert.throws(() => getTableView(unhex('0001 0203 0405'), 2, -1), RangeError);
        });

        it('gives a view on a part of a view, from the offset of the view', function() {
            const data = getTableView(unhex('0001 0203 0405'), 1, 4);
            const view = getTableView(data, 1, 10);
            assert.deepStrictEqual([view.byteOffset, view.byteLength], [2, 3]);
            assert.deepStrictEqual(getBytes(view), [2, 3, 4]);
            assert.throws(() => getTableView(data, 5, 1), RangeError);
        });
    });

    describe('isDeviceTableInData', function() {
        it('tells whether a Device or VariationIndex table ends inside the data, like HarfBuzz', function() {
            // a VariationIndex table (6 bytes), and Device tables of format 1, 2 and 3 for the sizes 11 to 15 (5 deltas of
            // 2, 4 and 8 bits: one, two and three 16-bit words after the 6 bytes of the header)
            assert.strictEqual(isDeviceTableInData(unhex('0000 0001 8000'), 0), true);
            assert.strictEqual(isDeviceTableInData(unhex('0000 0001 8000'), 2), false);
            assert.strictEqual(isDeviceTableInData(unhex('0000 0000 0001 8000'), 2), true);
            for (const [deltaFormat, wordCount] of [[1, 1], [2, 2], [3, 3]]) {
                const header = '000B 000F 000' + deltaFormat;
                assert.strictEqual(isDeviceTableInData(unhex(header + ' 0000'.repeat(wordCount)), 0), true, 'format ' + deltaFormat);
                assert.strictEqual(isDeviceTableInData(unhex(header + ' 0000'.repeat(wordCount - 1)), 0), false, 'format ' + deltaFormat);
            }
            // a Device table of an unknown format or whose startSize is after its endSize has no deltas
            assert.strictEqual(isDeviceTableInData(unhex('000B 000F 0004'), 0), true);
            assert.strictEqual(isDeviceTableInData(unhex('000F 000B 0001'), 0), true);
        });
    });

    describe('parseSequenceContext and parseChainedSequenceContext', function() {
        // the contextual subtables of GSUB (types 5 and 6) and GPOS (types 7 and 8), see gsub.spec.mjs and gpos.spec.mjs
        // for each format
        it('names the format field of the subtable as given', function() {
            // a sequence context of format 3 at the offset 2 (after a filler): one input glyph, no lookup record
            const sequenceContext = '0000 0003 0001 0000 0008   0001 0001 0005';
            assert.deepStrictEqual(new Parser(unhex(sequenceContext), 2).parseSequenceContext('posFormat', 'GPOS lookup type 7'), {
                posFormat: 3,
                coverages: [{ format: 1, glyphs: [5] }],
                lookupRecords: []
            });
            assert.strictEqual(new Parser(unhex(sequenceContext), 2).parseSequenceContext('substFormat', 'lookup type 5').substFormat, 3);
            // a chained sequence context of format 3: no backtrack, one input glyph, no lookahead, no lookup record
            const chainedSequenceContext = '0003 0000 0001 000C 0000 0000   0001 0001 0006';
            assert.deepStrictEqual(new Parser(unhex(chainedSequenceContext), 0).parseChainedSequenceContext('substFormat', 'lookup type 6'), {
                substFormat: 3,
                backtrackCoverage: [],
                inputCoverage: [{ format: 1, glyphs: [6] }],
                lookaheadCoverage: [],
                lookupRecords: []
            });
        });

        it('reads a rule with a glyph count of 0 as an empty input without lookup records, like HarfBuzz', function() {
            // the glyph count includes the first glyph, so the specification does not allow 0; HarfBuzz reads an empty
            // input (Rule::sanitize, inputCount ? inputCount - 1 : 0) and applies none of the lookup records, all past
            // its input (apply_lookup): the rule matches its first glyph and applies nothing
            const lookupRecord = { sequenceIndex: 0, lookupListIndex: 2 };
            // format 1: coverage [5], one rule: glyphCount 0, seqLookupCount 1, a lookup record
            const glyphRules = '0001 0008 0001 000E   0001 0001 0005   0001 0004   0000 0001 0000 0002';
            assert.deepStrictEqual(new Parser(unhex(glyphRules), 0).parseSequenceContext('substFormat', 'lookup type 5'), {
                substFormat: 1,
                coverage: { format: 1, glyphs: [5] },
                ruleSets: [[{ input: [], lookupRecords: [] }]]
            });
            // format 2: coverage [5], glyph 5 in class 0, one class rule: glyphCount 0, seqLookupCount 1, a lookup record
            const classRules = '0002 000A 0010 0001 0018   0001 0001 0005   0001 0005 0001 0000   0001 0004   0000 0001 0000 0002';
            assert.deepStrictEqual(new Parser(unhex(classRules), 0).parseSequenceContext('posFormat', 'GPOS lookup type 7'), {
                posFormat: 2,
                coverage: { format: 1, glyphs: [5] },
                classDef: { format: 1, startGlyph: 5, classes: [0] },
                classSets: [[{ classes: [], lookupRecords: [] }]]
            });
            // the first rule has a glyph count of 1, the same record
            const glyphRule = '0001 0008 0001 000E   0001 0001 0005   0001 0004   0001 0001 0000 0002';
            assert.deepStrictEqual(new Parser(unhex(glyphRule), 0).parseSequenceContext('posFormat', 'GPOS lookup type 7').ruleSets,
                [[{ input: [], lookupRecords: [lookupRecord] }]]);
        });

        it('reads a chained rule with an input glyph count of 0 as an empty input without lookup records, like HarfBuzz', function() {
            // format 1: coverage [5], one rule: no backtrack, inputGlyphCount 0, no lookahead, a lookup record
            const glyphRules = '0001 0008 0001 000E   0001 0001 0005   0001 0004   0000 0000 0000 0001 0000 0004';
            assert.deepStrictEqual(new Parser(unhex(glyphRules), 0).parseChainedSequenceContext('posFormat', 'GPOS lookup type 8'), {
                posFormat: 1,
                coverage: { format: 1, glyphs: [5] },
                chainRuleSets: [[{ backtrack: [], input: [], lookahead: [], lookupRecords: [] }]]
            });
            // format 2: coverage [5], NULL backtrack and lookahead class definitions, glyph 5 in input class 0, one
            // class rule: a backtrack class 1, inputGlyphCount 0, a lookahead class 2, a lookup record
            const classRules = '0002 000E 0000 0014 0000 0001 001C   0001 0001 0005   0001 0005 0001 0000   0001 0004   ' +
                '0001 0001 0000 0001 0002 0001 0000 0005';
            assert.deepStrictEqual(new Parser(unhex(classRules), 0).parseChainedSequenceContext('substFormat', 'lookup type 6'), {
                substFormat: 2,
                coverage: { format: 1, glyphs: [5] },
                backtrackClassDef: undefined,
                inputClassDef: { format: 1, startGlyph: 5, classes: [0] },
                lookaheadClassDef: undefined,
                chainClassSet: [[{ backtrack: [1], input: [], lookahead: [2], lookupRecords: [] }]]
            });
            // the input glyph count is a uint16: 0x8000 reads past the end of the data, not a negative length
            const longInput = '0001 0008 0001 000E   0001 0001 0005   0001 0004   0000 8000';
            assert.throws(() => new Parser(unhex(longInput), 0).parseChainedSequenceContext('posFormat', 'GPOS lookup type 8'),
                /Offset is outside the bounds of the DataView/);
        });

        it('throws on a format that is not 1, 2 or 3, with the name of the lookup type', function() {
            assert.throws(() => new Parser(unhex('0000 0004'), 2).parseSequenceContext('substFormat', 'lookup type 5'),
                /0x2: lookup type 5 format must be 1, 2 or 3/);
            assert.throws(() => new Parser(unhex('0000'), 0).parseChainedSequenceContext('posFormat', 'GPOS lookup type 8'),
                /0x0: GPOS lookup type 8 format must be 1, 2 or 3/);
        });
    });

    describe('parseValueRecordList', function() {
        // a SinglePosFormat2 subtable at the offset 2 (after a filler), its ValueFormat 0x0044 (XAdvance, XAdvDevice)
        // list of two ValueRecords at the offset 4, then their VariationIndex tables (deltaFormat 0x8000) at the
        // offsets 0x0e and 0x14 from the start of the subtable (OpenType GPOS, ValueRecord)
        const data = '0000   0002   0044 0002 FFF6 000E FFEC 0014   0000 0001 8000   0002 0003 8000';

        it('parses the device tables at their offsets from the start of the subtable', function() {
            const p = new Parser(unhex(data), 4);
            assert.deepStrictEqual(p.parseValueRecordList(2), [
                { xAdvance: -10, xAdvDevice: { deltaFormat: 0x8000, deltaSetOuterIndex: 0, deltaSetInnerIndex: 1 } },
                { xAdvance: -20, xAdvDevice: { deltaFormat: 0x8000, deltaSetOuterIndex: 2, deltaSetInnerIndex: 3 } }
            ]);
            assert.equal(p.relativeOffset, 12);
        });

        it('does not parse the device tables without the start of the subtable', function() {
            const p = new Parser(unhex(data), 4);
            assert.deepStrictEqual(p.parseValueRecordList(), [
                { xAdvance: -10, xAdvDevice: undefined },
                { xAdvance: -20, xAdvDevice: undefined }
            ]);
            assert.equal(p.relativeOffset, 12);
        });

        it('reads a device table that ends past the end of the data as a NULL offset, like HarfBuzz (sanitize_value_devices)', function() {
            // the data above without the last byte of the second VariationIndex table: the second value record keeps
            // its x advance, without its device
            const p = new Parser(unhex(data.slice(0, -2)), 4);
            assert.deepStrictEqual(p.parseValueRecordList(2), [
                { xAdvance: -10, xAdvDevice: { deltaFormat: 0x8000, deltaSetOuterIndex: 0, deltaSetInnerIndex: 1 } },
                { xAdvance: -20, xAdvDevice: undefined }
            ]);
            assert.equal(p.relativeOffset, 12);
        });
    });

    describe('parseDeltaSets', function() {
        it('should parse DeltaSets without the LONG_WORDS flag', function() {
            const data = '0123 4567 891A BCDE FADE C0FF EE0F DEAD BEEF BADA 55DE CADE';
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseDeltaSets(4, 0x0000, 2), [
                [0x01, 0x23], [0x45, 0x67], [0x89, 0x1A], [0xBC, 0xDE]
            ].map(x => x.map(signed)));
            assert.deepEqual(p.parseDeltaSets(4, 0x0001, 3), [
                [0xFADE, 0xC0, 0xFF], [0xEE0F, 0xDE, 0xAD],
                [0xBEEF, 0xBA, 0xDA], [0x55DE, 0xCA, 0xDE]
            ].map(x => x.map(signed)));
            p.relativeOffset = 0;
            assert.deepEqual(p.parseDeltaSets(4, 0x0002, 4), [
                [0x0123, 0x4567, 0x89, 0x1A], [0xBCDE, 0xFADE, 0xC0, 0xFF],
                [0xEE0F, 0xDEAD, 0xBE, 0xEF], [0xBADA, 0x55DE, 0xCA, 0xDE],
            ].map(x => x.map(signed)));
        });

        it('should parse DeltaSets with the LONG_WORDS flag', function() {
            const data = '0123 4567 891A BCDE FADE C0FF EEEE BA5E DEAD BEEF DEFA CE0F BADA 55E5 0011 2233 2211 2233 2211';
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseDeltaSets(4, 0x8000, 2), [
                [0x0123, 0x4567], [0x891A, 0xBCDE], [0xFADE, 0xC0FF], [0xEEEE, 0xBA5E]
            ].map(x => x.map(signed)));
            p.relativeOffset = 0;
            assert.deepEqual(p.parseDeltaSets(1, 0x8001, 3), [
                [0x01234567, 0x891A, 0xBCDE ],
            ].map(x => x.map(signed)));
            p.relativeOffset = 28;
            assert.deepEqual(p.parseDeltaSets(1, 0x8002, 3), [
                [0x00112233, 0x22112233, 0x2211],
            ].map(x => x.map(signed)));
        });
    });

    describe('parseVariationRegionList', function() {
        it('should parse a VariationRegionList', function() {
            // https://learn.microsoft.com/en-us/typography/opentype/spec/otvarcommonformats#variation-regions
            const data = '0002 0002 ' + // axisCount: 2, regionCount: 2
                'C000 E000 0000 ' + // variationRegions[0], regionAxes[0]
                'C000 C000 E000 ' + // variationRegions[0], regionAxes[1]
                'C000 C000 E000 ' + // variationRegions[1], regionAxes[0]
                'C000 E000 0000 ';  // variationRegions[1], regionAxes[1]
            const p = new Parser(unhex(data), 0);
            assert.deepEqual(p.parseVariationRegionList(), [
                {
                    regionAxes: [
                        { startCoord: -1.0, peakCoord: -0.5, endCoord: 0.0 },
                        { startCoord: -1.0, peakCoord: -1.0, endCoord: -0.5 }
                    ]
                },
                {
                    regionAxes: [
                        { startCoord: -1.0, peakCoord: -1.0, endCoord: -0.5 },
                        { startCoord: -1.0, peakCoord: -0.5, endCoord: 0.0 }
                    ]
                }
            ]);
            assert.equal(p.relativeOffset, 28);
        });
    });

    describe('parseDeltaSetIndexMap', function() {
        it('should parse a DeltaSetIndexMap', function() {
            // https://learn.microsoft.com/en-us/typography/opentype/spec/otvarcommonformats#associating-target-items-to-variation-data
            // format 0, entryFormat 0x10 (2-byte entries, 1 bit of inner index), mapCount 2
            assert.deepStrictEqual(new Parser(unhex('00 10 0002 0003 0004'), 0).parseDeltaSetIndexMap(), {
                format: 0,
                entryFormat: 0x10,
                map: [{ outerIndex: 1, innerIndex: 1 }, { outerIndex: 2, innerIndex: 0 }]
            });
        });

        it('gives a map without entries for a mapCount of 0 and for an unknown format, like HarfBuzz (DeltaSetIndexMap::map)', function() {
            // HarfBuzz maps each index to itself with such a map, the implicit mapping of getVariableAdjustment
            assert.deepStrictEqual(new Parser(unhex('00 10 0000'), 0).parseDeltaSetIndexMap(), { format: 0, entryFormat: 0x10, map: [] });
            assert.deepStrictEqual(new Parser(unhex('01 10 00000000'), 0).parseDeltaSetIndexMap(), { format: 1, entryFormat: 0x10, map: [] });
            assert.deepStrictEqual(new Parser(unhex('FF 10 0002 0003 0004'), 0).parseDeltaSetIndexMap(), { format: 0xFF, entryFormat: 0x10, map: [] });
        });
    });

    describe('parseLongDateTime', function() {
        it('should parse LONGDATETIME values', function() {
            // FIXME: test dates > 2038 once all 64bit are supported
            const date1 = new Date('1904-01-01T00:00:00.000Z').getTime();
            const date2 = new Date('1970-01-01T00:00:00.000Z').getTime();
            const date3 = new Date('2038-12-31T23:59:59.000Z').getTime();
            const hex1 = '00 00 00 00 00 00 00 00';
            const hex2 = '00 00 00 00 7C 25 B0 80';
            const hex3 = '00 00 00 00 FD EE FB 7F';
            const p1 = new Parser(unhex(hex1), 0);
            const p2 = new Parser(unhex(hex2), 0);
            const p3 = new Parser(unhex(hex3), 0);
            assert.equal(new Date(p1.parseLongDateTime() * 1000).getTime(), date1);
            assert.equal(new Date(p2.parseLongDateTime() * 1000).getTime(), date2);
            assert.equal(new Date(p3.parseLongDateTime() * 1000).getTime(), date3);
        });
    });

    describe('font variation data', function() {
        it('should parse packed point numbers', function() {
            let p = new Parser(unhex('00'), 0);
            assert.deepEqual(p.parsePackedPointNumbers(), []);
            p = new Parser(unhex('32 18' + ' 01'.repeat(25) + '18' + ' 05'.repeat(25)), 0);
            assert.deepEqual(p.parsePackedPointNumbers(), [
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
                30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150
            ]);
            p = new Parser(unhex(
                '81 22 02 04 01 03 ff' + ' 00 01'.repeat(128) +
                '7f' + ' 01'.repeat(128) +
                '1e' + ' 02'.repeat(31)
            ), 0);
            assert.deepEqual(p.parsePackedPointNumbers(), [
                4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
                36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
                65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93,
                94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117,
                118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140,
                141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163,
                164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186,
                187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209,
                210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232,
                233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255,
                256, 257, 258, 259, 260, 261, 262, 263, 264, 266, 268, 270, 272, 274, 276, 278, 280, 282, 284, 286, 288, 290, 292,
                294, 296, 298, 300, 302, 304, 306, 308, 310, 312, 314, 316, 318, 320, 322, 324, 326
            ]);
        });

        describe('of a GlyphVariationData table whose tuple data end past the end of the data', function() {
            // one tuple (tupleVariationCount 1, its serialized data at 0x0a), with an embedded peak tuple of one axis
            // (1.0) and private point numbers (tupleIndex 0xA000), of 7 bytes: the point 0, the x delta 5, then no
            // byte for the y delta
            const data = '0001 000A   0007 A000 4000   01 00 00   00 05';

            it('reads the point numbers and the deltas of the tuple as null when they are first read, with the error passed to the callback', function() {
                const errors = [];
                const store = new Parser(unhex(data), 0).parseTupleVariationStore(0, 1, 'gvar', [], 0,
                    (error, tupleIndex) => errors.push([error, tupleIndex]));
                assert.deepStrictEqual(errors, []);
                assert.strictEqual(store.headers[0].privatePoints, null);
                assert.strictEqual(store.headers[0].deltas, null);
                assert.strictEqual(store.headers[0].deltasY, null);
                assert.strictEqual(errors.length, 1);
                assert.ok(errors[0][0] instanceof RangeError);
                assert.strictEqual(errors[0][1], 0);
            });

            it('throws the error when the data of the tuple are first read without a callback', function() {
                const store = new Parser(unhex(data), 0).parseTupleVariationStore(0, 1, 'gvar', [], 0);
                assert.throws(() => store.headers[0].privatePoints, RangeError);
                assert.throws(() => store.headers[0].deltas, RangeError);
            });
        });

        it('reads the data of a tuple from its variationDataSize bytes only, like HarfBuzz', function() {
            // the store above with a variationDataSize of 5 and two more bytes (00 07) after the data of the tuple: the
            // y delta would be 7, but HarfBuzz decompiles the deltas of a tuple up to the end of its serialized data
            // (gvar::apply_deltas_to_points, decompile_deltas with end = p + length), so the y delta runs past them
            const errors = [];
            const store = new Parser(unhex('0001 000A   0005 A000 4000   01 00 00   00 05   00 07'), 0)
                .parseTupleVariationStore(0, 1, 'gvar', [], 0, (error, tupleIndex) => errors.push([error, tupleIndex]));
            assert.strictEqual(store.headers[0].deltasY, null);
            assert.strictEqual(errors.length, 1);
            assert.ok(errors[0][0] instanceof RangeError);
            const validStore = new Parser(unhex('0001 000A   0007 A000 4000   01 00 00   00 05   00 07'), 0)
                .parseTupleVariationStore(0, 1, 'gvar', [], 0);
            assert.deepStrictEqual(validStore.headers[0].privatePoints, [0]);
            assert.deepStrictEqual(validStore.headers[0].deltas, [5]);
            assert.deepStrictEqual(validStore.headers[0].deltasY, [7]);
        });

        it('parses the private point numbers of a tuple only when the data of the tuple are first read', function() {
            // two tuples: the private point numbers of the tuple 0 (a count of 2, then a run of a single point) run past
            // its 3 bytes, the tuple 1 (5 bytes) is the point 0 with the x and y deltas 0 (a run of 1 zero delta, 0x80)
            const errors = [];
            const store = new Parser(unhex('0002 0010   0003 A000 4000   0005 A000 C000   02 00 00   01 00 00 80 80'), 0)
                .parseTupleVariationStore(0, 1, 'gvar', [], 0, (error, tupleIndex) => errors.push([error, tupleIndex]));
            assert.deepStrictEqual(errors, []);
            assert.deepStrictEqual(store.headers[1].privatePoints, [0]);
            assert.deepStrictEqual(store.headers[1].deltas, [0]);
            assert.deepStrictEqual(store.headers[1].deltasY, [0]);
            assert.deepStrictEqual(errors, []);
            assert.strictEqual(store.headers[0].privatePoints, null);
            assert.deepStrictEqual(errors.map(([error, tupleIndex]) => [error instanceof RangeError, tupleIndex]), [[true, 0]]);
        });

        it('skips the tuples from the first tuple variation header that does not fit in the data, like HarfBuzz (tuple_iterator_t)', function() {
            // a cvar store (after the 4 bytes of the version) of 2 tuples and shared point numbers (tupleVariationCount
            // 0x8002), its serialized data at 0x0E, with the header of the tuple 0 only (2 bytes of data, an embedded
            // peak of one axis, 1.0): the shared point numbers are all the points (00), the delta of the cvt value 0 is
            // 5 (00 05); the header of the tuple 1 would start at 0x0E, where 3 bytes are left
            const data = '0001 0000   8002 000E   0002 8000 4000   00   00 05';
            const errors = [];
            const store = new Parser(unhex(data), 0).parseTupleVariationStore(0, 1, 'cvar', [100], undefined,
                (error, tupleIndex, isHeaderError) => errors.push([error, tupleIndex, isHeaderError]));
            assert.deepStrictEqual(errors.map(([error, tupleIndex, isHeaderError]) => [error.name, error.message, tupleIndex, isHeaderError]),
                [['RangeError', 'Offset is outside the bounds of the DataView', 1, true]]);
            assert.strictEqual(store.headers.length, 1);
            assert.deepStrictEqual(store.headers[0].peakTuple, [1]);
            assert.deepStrictEqual(store.headers[0].deltas, [5]);
            assert.deepStrictEqual(store.sharedPoints, []);
            assert.strictEqual(errors.length, 1);
            // without a callback the error is thrown
            assert.throws(() => new Parser(unhex(data), 0).parseTupleVariationStore(0, 1, 'cvar', [100]),
                { name: 'RangeError', message: 'Offset is outside the bounds of the DataView' });
        });

        it('sets the point numbers and the deltas of a tuple, the other data of the tuple kept', function() {
            // the valid store of the test of the variationDataSize above: the point 0 with the x delta 5 and the y delta 7
            const parseStore = () => new Parser(unhex('0001 000A   0007 A000 4000   01 00 00   00 05   00 07'), 0)
                .parseTupleVariationStore(0, 1, 'gvar', [], 0);
            const header = parseStore().headers[0];
            header.deltas = [9];
            assert.deepStrictEqual([header.privatePoints, header.deltas, header.deltasY], [[0], [9], [7]]);
            header.deltasY = [8];
            assert.deepStrictEqual([header.privatePoints, header.deltas, header.deltasY], [[0], [9], [8]]);
            header.privatePoints = [1];
            assert.deepStrictEqual([header.privatePoints, header.deltas, header.deltasY], [[1], [9], [8]]);
            // a setter parses the data first
            const unreadHeader = parseStore().headers[0];
            unreadHeader.privatePoints = [2];
            assert.deepStrictEqual([unreadHeader.privatePoints, unreadHeader.deltas, unreadHeader.deltasY], [[2], [5], [7]]);
        });

        it('passes the error and the glyph index of the variation data of a glyph that fails to parse when it is first read', function() {
            // a GlyphVariationData offsets array (glyphCount 2, short offsets, the data array at 0x10) where the data of
            // the glyph 1, from 0 to 0x14 bytes after the array, ends past the end of the data
            const errors = [];
            const glyphVariations = new Parser(unhex('0002 0000 00000010 0000 0000 000A'), 0)
                .parseTupleVariationStoreList(1, 'gvar', [], (error, glyphIndex, tupleIndex) => errors.push([error, glyphIndex, tupleIndex]));
            assert.deepStrictEqual(errors, []);
            assert.strictEqual(glyphVariations[0], undefined);
            assert.strictEqual(glyphVariations[1], undefined);
            assert.strictEqual(errors.length, 1);
            assert.ok(errors[0][0] instanceof RangeError);
            assert.strictEqual(errors[0][1], 1);
            assert.strictEqual(errors[0][2], undefined);
            const throwingVariations = new Parser(unhex('0002 0000 00000010 0000 0000 000A'), 0).parseTupleVariationStoreList(1, 'gvar', []);
            assert.throws(() => throwingVariations[1], RangeError);
        });

        it('reads the variation data of a glyph from its bytes only, like HarfBuzz', function() {
            // glyphCount 2, short offsets (0, 16 and 18 bytes), the data array at 0x0e: the data of the glyph 0 is the
            // store of the tests above with the run header of its y delta (00, one byte), whose value would be the
            // first byte (09) of the data of the glyph 1; HarfBuzz reads the data of a glyph up to the offset of the
            // next one (gvar::get_glyph_var_data_bytes), so the y delta runs past the data of the glyph 0
            const data = '0002 0000 0000000E   0000 0008 0009' +
                '0001 000A   0007 A000 4000   01 00 00   00 05   00' +
                '09 00';
            const errors = [];
            const glyphVariations = new Parser(unhex(data), 0)
                .parseTupleVariationStoreList(1, 'gvar', [], (error, glyphIndex, tupleIndex) => errors.push([error, glyphIndex, tupleIndex]));
            const header = glyphVariations[0].headers[0];
            assert.strictEqual(header.privatePoints, null);
            assert.strictEqual(header.deltas, null);
            assert.strictEqual(header.deltasY, null);
            assert.strictEqual(errors.length, 1);
            assert.ok(errors[0][0] instanceof RangeError);
            assert.deepStrictEqual(errors[0].slice(1), [0, 0]);
        });
    });
});
