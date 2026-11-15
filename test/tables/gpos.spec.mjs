import assert from 'assert';
import { readFileSync } from 'fs';
import { unhex } from '../testutil.mjs';
import { parse } from '../../src/opentype.mjs';
import gpos from '../../src/tables/gpos.mjs';

// Helper that builds a minimal GPOS table to test a lookup subtable.
function parseLookup(lookupType, subTableData) {
    const data = unhex('00010000 000A 000C 000E' +   // header
        '0000' +                                        // ScriptTable - 0 scripts
        '0000' +                                        // FeatureListTable - 0 features
        '0001 0004' +                                   // LookupListTable - 1 lookup table
        '000' + lookupType + '0000 0001 0008' +         // Lookup table - 1 subtable
        subTableData);                                  // sub table start offset: 0x1a
    return gpos.parse(data).lookups[0].subtables[0];
}

describe('tables/gpos.mjs', function() {
    //// Header ///////////////////////////////////////////////////////////////
    it('can parse a GPOS header', function() {
        const data = unhex(
            '00010000 000A 000C 000E' +     // header
            '0000' +                        // ScriptTable - 0 scripts
            '0000' +                        // FeatureListTable - 0 features
            '0000'                          // LookupListTable - 0 lookups
        );
        assert.deepEqual(gpos.parse(data), { version: 1, scripts: [], features: [], lookups: [] });
    });

    it('can parse a GPOS header with null pointers', function() {
        const data = unhex(
            '00010000 0000 0000 0000'
        );
        assert.deepEqual(gpos.parse(data), { version: 1, scripts: [], features: [], lookups: [] });
    });

    //// Lookup type 1 ////////////////////////////////////////////////////////
    it('can parse lookup1 SinglePosFormat1', function() {
        // https://docs.microsoft.com/en-us/typography/opentype/spec/gpos#example-2-singleposformat1-subtable
        const data = '0001 0008 0002   FFB0 0002 0001   01B3 01BC 0000';
        assert.deepEqual(parseLookup(1, data), {
            posFormat: 1,
            coverage: {
                format: 2,
                ranges: [{ start: 0x1b3, end: 0x1bc, index: 0 }]
            },
            value: { yPlacement: -80 }
        });
    });

    it('can parse lookup1 SinglePosFormat1 with ValueFormat Table and ValueRecord', function() {
        // https://docs.microsoft.com/fr-fr/typography/opentype/spec/gpos#example-14-valueformat-table-and-valuerecord
        const data = '0001 000E 0099   0050 00D2 0018 0020   0002 0001 00C8 00D1 0000   000B 000F 0001 5540   000B 000F 0001 5540';
        assert.deepEqual(parseLookup(1, data), {
            posFormat: 1,
            coverage: {
                format: 2,
                ranges: [{ start: 0xc8, end: 0xd1, index: 0 }]
            },
            value: {
                xPlacement: 80,             // 0x50
                yAdvance: 210,              // 0xd2
                // the Device tables at the offsets 0x18 and 0x20 from the start of the subtable
                xPlaDevice: { deltaFormat: 1, startSize: 11, endSize: 15 },
                yAdvDevice: { deltaFormat: 1, startSize: 11, endSize: 15 }
            }
        });
    });

    it('can parse lookup1 SinglePosFormat1 with a Device table and a VariationIndex table', function() {
        // ValueFormat 0x0099 (XPlacement, YAdvance, XPlaDevice, YAdvDevice), the Device table at the offset 0x0e from
        // the start of the subtable and the VariationIndex table at 0x16, then the Coverage at 0x1c (fontTools reads the
        // same fields)
        const data = '0001 001C 0099   0050 00D2 000E 0016   000B 000F 0001 5540   0003 0007 8000   0001 0001 0005';
        assert.deepEqual(parseLookup(1, data), {
            posFormat: 1,
            coverage: {
                format: 1,
                glyphs: [5]
            },
            value: {
                xPlacement: 80,
                yAdvance: 210,
                xPlaDevice: { deltaFormat: 1, startSize: 11, endSize: 15 },
                yAdvDevice: { deltaFormat: 0x8000, deltaSetOuterIndex: 3, deltaSetInnerIndex: 7 }
            }
        });
    });

    it('reads a Device or VariationIndex table that ends past the end of the data as a NULL offset, like HarfBuzz', function() {
        // the subtable of the test above with the offset of its VariationIndex table set to 0xFFF0: in
        // TestSingleAdjustment-Malformed.ttf (see test/generate-malformed-layout-fonts.py) hb-shape keeps the value of
        // the value record of O without its variation delta
        const data = '0001 001C 0099   0050 00D2 000E FFF0   000B 000F 0001 5540   0003 0007 8000   0001 0001 0005';
        assert.deepEqual(parseLookup(1, data).value, {
            xPlacement: 80,
            yAdvance: 210,
            xPlaDevice: { deltaFormat: 1, startSize: 11, endSize: 15 },
            yAdvDevice: undefined
        });
        // XPlacement and XPlaDevice, a Device table of format 1 for the sizes 11 to 15 at 0x10, whose deltas (one 16-bit
        // word after its 6 bytes, HintingDevice::get_size of HarfBuzz) end past the end of the data
        assert.deepEqual(parseLookup(1, '0001 000A 0011 0050 0010   0001 0001 0005   000B 000F 0001').value, {
            xPlacement: 80,
            xPlaDevice: undefined
        });
    });

    it('can parse lookup1 SinglePosFormat2 with VariationIndex tables', function() {
        // ValueFormat 0x0044 (XAdvance, XAdvDevice), two ValueRecords whose VariationIndex tables (deltaFormat 0x8000)
        // are at the offsets 0x10 and 0x16 from the start of the subtable, then the Coverage at 0x1c
        const data = '0002 001C 0044 0002   FFF6 0010   FFEC 0016   0000 0001 8000   0002 0003 8000   0001 0002 0005 0007';
        assert.deepEqual(parseLookup(1, data), {
            posFormat: 2,
            coverage: {
                format: 1,
                glyphs: [5, 7]
            },
            values: [
                { xAdvance: -10, xAdvDevice: { deltaFormat: 0x8000, deltaSetOuterIndex: 0, deltaSetInnerIndex: 1 } },
                { xAdvance: -20, xAdvDevice: { deltaFormat: 0x8000, deltaSetOuterIndex: 2, deltaSetInnerIndex: 3 } }
            ]
        });
    });

    it('can parse lookup1 SinglePosFormat2', function() {
        // https://docs.microsoft.com/en-us/typography/opentype/spec/gpos#example-3-singleposformat2-subtable
        const data = '0002 0014 0005 0003   0032 0032   0019 0019  000A 000A   0001 0003 004F 0125 0129';
        assert.deepEqual(parseLookup(1, data), {
            posFormat: 2,
            coverage: {
                format: 1,
                glyphs: [0x4f, 0x125, 0x129]
            },
            values: [
                { xPlacement: 50, xAdvance: 50 },
                { xPlacement: 25, xAdvance: 25 },
                { xPlacement: 10, xAdvance: 10 }
            ]
        });
    });

    //// Lookup type 2 ////////////////////////////////////////////////////////
    it('can parse lookup2 PairPosFormat1', function() {
        // https://docs.microsoft.com/en-us/typography/opentype/spec/gpos#example-4-pairposformat1-subtable
        const data = '0001 001E 0004 0001 0002 000E 0016   0001 0059 FFE2 FFEC 0001 0059 FFD8 FFE7   0001 0002 002D 0031';
        assert.deepEqual(parseLookup(2, data), {
            posFormat: 1,
            coverage: {
                format: 1,
                glyphs: [0x2d, 0x31]
            },
            valueFormat1: 4,
            valueFormat2: 1,
            pairSets: [
                [{ secondGlyph: 0x59, value1: { xAdvance: -30 }, value2: { xPlacement: -20 } }],
                [{ secondGlyph: 0x59, value1: { xAdvance: -40 }, value2: { xPlacement: -25 } }]
            ]
        });
    });

    it('can parse lookup2 PairPosFormat2', function() {
        // https://docs.microsoft.com/en-us/typography/opentype/spec/gpos#example-5-pairposformat2-subtable
        const data = '0002 0018 0004 0000 0022 0032 0002 0002 0000 0000 0000 FFCE   0001 0003 0046 0047 0049   0002 0002 0046 0047 0001 0049 0049 0001   0002 0001 006A 006B 0001';
        assert.deepEqual(parseLookup(2, data), {
            posFormat: 2,
            coverage: {
                format: 1,
                glyphs: [0x46, 0x47, 0x49]
            },
            valueFormat1: 4,
            valueFormat2: 0,
            classDef1: {
                format: 2,
                ranges: [
                    { start: 0x46, end: 0x47, classId: 1 },
                    { start: 0x49, end: 0x49, classId: 1 }
                ]
            },
            classDef2: {
                format: 2,
                ranges: [
                    { start: 0x6a, end: 0x6b, classId: 1 }
                ]
            },
            class1Count: 2,
            class2Count: 2,
            classRecords: [
                [
                    { value1: { xAdvance: 0 }, value2: undefined },
                    { value1: { xAdvance: 0 }, value2: undefined }
                ],
                [
                    { value1: { xAdvance: 0 }, value2: undefined },
                    { value1: { xAdvance: -50 }, value2: undefined }
                ]
            ]
        });
    });

    // the subtables of the lookup types 3 to 6 below, read the same by fontTools (otTables, from the same GPOS table)

    //// Lookup type 3 ////////////////////////////////////////////////////////
    it('can parse lookup3 CursivePosFormat1 with anchors of format 1 and 2 and a NULL anchor', function() {
        // https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#cursive-attachment-positioning-format1-cursive-attachment
        // the Coverage at 0x0e, the anchors at 0x16 and 0x1c (format 1) and 0x22 (format 2, contour point 3), relative to
        // the subtable; the second glyph has no entry anchor
        const data = '0001 000E 0002 0016 001C 0000 0022   0001 0002 0005 0007   0001 0064 FFEC   0001 01F4 00C8   0002 0258 012C 0003';
        assert.deepStrictEqual(parseLookup(3, data), {
            posFormat: 1,
            coverage: { format: 1, glyphs: [5, 7] },
            entryExitRecords: [
                {
                    entryAnchor: { anchorFormat: 1, xCoordinate: 100, yCoordinate: -20 },
                    exitAnchor: { anchorFormat: 1, xCoordinate: 500, yCoordinate: 200 }
                },
                {
                    entryAnchor: undefined,
                    exitAnchor: { anchorFormat: 2, xCoordinate: 600, yCoordinate: 300, anchorPoint: 3 }
                }
            ]
        });
    });

    //// Lookup type 4 ////////////////////////////////////////////////////////
    it('can parse lookup4 MarkBasePosFormat1 with an anchor of format 3 and a NULL base anchor', function() {
        // https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#mark-to-base-attachment-positioning-format-1-mark-to-base-attachment-point
        // two mark classes; the MarkArray at 0x1a (its anchors relative to it), the BaseArray at 0x30: the anchor of class
        // 0 of the base (format 3, relative to the BaseArray) with a VariationIndex table for x and a Device table for y
        // (relative to the anchor), none for class 1
        const data = '0001 000C 0014 0002 001A 0030   0001 0002 000A 000B   0001 0001 0005   ' +
            '0002 0000 000A 0001 0010 0001 0000 01F4 0001 0000 0258   ' +
            '0001 0006 0000 0003 0096 02BC 000A 0010 0000 0001 8000 000B 000F 0001 5540';
        assert.deepStrictEqual(parseLookup(4, data), {
            posFormat: 1,
            markCoverage: { format: 1, glyphs: [10, 11] },
            baseCoverage: { format: 1, glyphs: [5] },
            markClassCount: 2,
            markArray: [
                { markClass: 0, markAnchor: { anchorFormat: 1, xCoordinate: 0, yCoordinate: 500 } },
                { markClass: 1, markAnchor: { anchorFormat: 1, xCoordinate: 0, yCoordinate: 600 } }
            ],
            baseArray: [[
                {
                    anchorFormat: 3,
                    xCoordinate: 150,
                    yCoordinate: 700,
                    xDevice: { deltaFormat: 0x8000, deltaSetOuterIndex: 0, deltaSetInnerIndex: 1 },
                    yDevice: { deltaFormat: 1, startSize: 11, endSize: 15 }
                },
                undefined
            ]]
        });
    });

    it('reads an anchor of a format that is not 1, 2 or 3 as the anchor 0 0, like HarfBuzz, and throws on a lookup4 format that is not 1', function() {
        // the mark anchor of format 4, its coordinates 0 500 not read: in TestMarkAttachment-Malformed.ttf (see
        // test/generate-malformed-layout-fonts.py) the anchor of i of format 4 is at 0 0 for hb-shape
        const data = '0001 000C 0012 0001 0018 0024   0001 0001 000A   0001 0001 0005   0001 0000 0006 0004 0000 01F4   0001 0004 0001 0000 0258';
        assert.deepStrictEqual(parseLookup(4, data).markArray, [
            { markClass: 0, markAnchor: { anchorFormat: 4, xCoordinate: 0, yCoordinate: 0 } }
        ]);
        assert.throws(() => parseLookup(4, '0002' + data.slice(4)), /GPOS lookup type 4 format must be 1/);
    });

    it('reads an anchor of format 3 with a Device table that ends past the end of the data as a NULL anchor, like HarfBuzz', function() {
        // the base anchor of the subtable of the test above, of format 3 with an x Device table at 0x0A from it, whose
        // 6 bytes end 2 bytes past the end of the data; the same with its y Device table, and with the 2 bytes there
        // (in TestMarkAttachment-Malformed.ttf the entry anchor of z with a Device table past the end of GPOS does
        // not attach for hb-shape)
        const lookup = '0001 000C 0012 0001 0018 0024   0001 0001 000A   0001 0001 0005   0001 0000 0006 0001 0000 01F4   0001 0004   ';
        assert.strictEqual(parseLookup(4, lookup + '0003 0000 0258 000A 0000   0000 0000').baseArray[0][0], undefined);
        assert.strictEqual(parseLookup(4, lookup + '0003 0000 0258 0000 000A   0000 0000').baseArray[0][0], undefined);
        assert.deepStrictEqual(parseLookup(4, lookup + '0003 0000 0258 000A 0000   0000 0000 8000').baseArray[0][0], {
            anchorFormat: 3,
            xCoordinate: 0,
            yCoordinate: 600,
            xDevice: { deltaFormat: 0x8000, deltaSetOuterIndex: 0, deltaSetInnerIndex: 0 },
            yDevice: undefined
        });
    });

    it('throws on a lookup3, lookup5 or lookup6 format that is not 1', function() {
        // the specification defines the format 1 only for these lookup types, read before the rest of the subtable
        for (const lookupType of [3, 5, 6]) {
            assert.throws(() => parseLookup(lookupType, '0002 0000 0000 0000 0000 0000'), new RegExp(`GPOS lookup type ${lookupType} format must be 1`));
        }
    });

    //// Lookup type 5 ////////////////////////////////////////////////////////
    it('can parse lookup5 MarkLigPosFormat1, an anchor by mark class for each component of a ligature', function() {
        // https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#mark-to-ligature-attachment-positioning-format-1-mark-to-ligature-attachment
        // the LigatureArray at 0x24, its LigatureAttach table at 0x04 from it, two components: an anchor for the first
        // one (at 0x06 from the LigatureAttach table), none for the second one
        const data = '0001 000C 0012 0001 0018 0024   0001 0001 000A   0001 0001 0014   0001 0000 0006 0001 0000 01F4   ' +
            '0001 0004 0002 0006 0000 0001 00C8 0320';
        assert.deepStrictEqual(parseLookup(5, data), {
            posFormat: 1,
            markCoverage: { format: 1, glyphs: [10] },
            ligatureCoverage: { format: 1, glyphs: [20] },
            markClassCount: 1,
            markArray: [{ markClass: 0, markAnchor: { anchorFormat: 1, xCoordinate: 0, yCoordinate: 500 } }],
            ligatureArray: [[[{ anchorFormat: 1, xCoordinate: 200, yCoordinate: 800 }], [undefined]]]
        });
    });

    //// Lookup type 6 ////////////////////////////////////////////////////////
    it('can parse lookup6 MarkMarkPosFormat1', function() {
        // https://learn.microsoft.com/en-us/typography/opentype/spec/gpos#mark-to-mark-attachment-positioning-format-1-mark-to-mark-attachment
        // the Mark1Array at 0x18 with an anchor of format 2, the Mark2Array at 0x26
        const data = '0001 000C 0012 0001 0018 0026   0001 0001 000B   0001 0001 000A   0001 0000 0006 0002 0000 0258 0004   ' +
            '0001 0004 0001 0000 0384';
        assert.deepStrictEqual(parseLookup(6, data), {
            posFormat: 1,
            mark1Coverage: { format: 1, glyphs: [11] },
            mark2Coverage: { format: 1, glyphs: [10] },
            markClassCount: 1,
            mark1Array: [{ markClass: 0, markAnchor: { anchorFormat: 2, xCoordinate: 0, yCoordinate: 600, anchorPoint: 4 } }],
            mark2Array: [[{ anchorFormat: 1, xCoordinate: 0, yCoordinate: 900 }]]
        });
    });

    it('can parse a mark record with a NULL MarkAnchor offset', function() {
        // the lookup6 above with the MarkAnchor offset of its Mark1Array record set to 0 (the specification does not allow
        // it, HarfBuzz reads it as the anchor 0 0, see position.spec.mjs), the Mark2Array at 0x1e: fontTools reads the
        // MarkAnchor as None
        const data = '0001 000C 0012 0001 0018 001E   0001 0001 000B   0001 0001 000A   0001 0000 0000   0001 0004 0001 0000 0384';
        const subtable = parseLookup(6, data);
        assert.deepStrictEqual(subtable.mark1Array, [{ markClass: 0, markAnchor: undefined }]);
        assert.deepStrictEqual(subtable.mark2Array, [[{ anchorFormat: 1, xCoordinate: 0, yCoordinate: 900 }]]);
    });

    it('reads the anchors of format 3 of the mark-to-base lookup of a variable font, with their VariationIndex tables', function() {
        // Roboto-VF-gsub-chaining-subset.ttf, lookup 2 (fontTools otTables): the mark dotbelowcomb (class 0) at -597 0,
        // x VariationIndex 4 1; the base j (glyph 7, coverage index 3) at 190 -459, x VariationIndex 2 2
        const font = parse(readFileSync('./test/fonts/regression/Roboto-VF-gsub-chaining-subset.ttf'));
        const subtable = font.tables.gpos.lookups[2].subtables[0];
        assert.deepStrictEqual(subtable.markArray, [{
            markClass: 0,
            markAnchor: {
                anchorFormat: 3, xCoordinate: -597, yCoordinate: 0,
                xDevice: { deltaFormat: 0x8000, deltaSetOuterIndex: 4, deltaSetInnerIndex: 1 }, yDevice: undefined
            }
        }]);
        assert.strictEqual(font.position.getCoverageIndex(subtable.baseCoverage, 7), 3);
        assert.deepStrictEqual(subtable.baseArray[3], [{
            anchorFormat: 3, xCoordinate: 190, yCoordinate: -459,
            xDevice: { deltaFormat: 0x8000, deltaSetOuterIndex: 2, deltaSetInnerIndex: 2 }, yDevice: undefined
        }]);
    });

    it('can parse the mark attachment lookups of an extension lookup', function() {
        const data = '0001 0006 00000008' +
            '0001 000C 0012 0001 0018 0026   0001 0001 000B   0001 0001 000A   0001 0000 0006 0002 0000 0258 0004   ' +
            '0001 0004 0001 0000 0384';
        const subtable = parseLookup(9, data);
        assert.strictEqual(subtable.lookupType, 6);
        assert.deepStrictEqual(subtable.extension.mark2Array, [[{ anchorFormat: 1, xCoordinate: 0, yCoordinate: 900 }]]);
    });

    // lookup type 7
    it('can parse lookup7 SequenceContextFormat1, the glyph rules of each covered glyph', function() {
        // https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2#sequence-context-format-1-simple-glyph-contexts
        const data = '0001 0008 0001 000E' +    // posFormat, coverage offset, seqRuleSetCount, seqRuleSet offset
            '0001 0001 0005' +                  // coverage format 1
            '0001 0004' +                       // seqRuleSet: seqRuleCount, seqRule offset
            '0002 0002 0006 0000 0001 0001 0002'; // seqRule: glyphCount, seqLookupCount, input, two lookup records
        assert.deepStrictEqual(parseLookup(7, data), {
            posFormat: 1,
            coverage: { format: 1, glyphs: [5] },
            ruleSets: [[{
                input: [6],
                lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 1 }, { sequenceIndex: 1, lookupListIndex: 2 }]
            }]]
        });
    });

    it('can parse lookup7 SequenceContextFormat2, the class rules of each class with a NULL class sequence rule set', function() {
        // https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2#sequence-context-format-2-class-based-glyph-contexts
        const data = '0002 000C 0014 0002 0000 001E' +   // posFormat, coverage and classDef offsets, two classSeqRuleSet offsets
            '0001 0002 0005 0006' +                      // coverage format 1
            '0001 0005 0002 0001 0001' +                 // classDef format 1: glyphs 5 and 6 in class 1
            '0001 0004' +                                // classSeqRuleSet: classSeqRuleCount, classSeqRule offset
            '0002 0001 0001 0001 0003';                  // classSeqRule: glyphCount, seqLookupCount, input class, lookup record
        assert.deepStrictEqual(parseLookup(7, data), {
            posFormat: 2,
            coverage: { format: 1, glyphs: [5, 6] },
            classDef: { format: 1, startGlyph: 5, classes: [1, 1] },
            classSets: [undefined, [{ classes: [1], lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 3 }] }]]
        });
    });

    it('can parse lookup7 SequenceContextFormat3, the coverage of each input glyph', function() {
        // https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2#sequence-context-format-3-coverage-based-glyph-contexts
        const data = '0003 0002 0001 000E 0014 0000 0004' + // posFormat, glyphCount, seqLookupCount, coverage offsets, lookup record
            '0001 0001 0005   0001 0001 0006';             // coverage tables format 1
        assert.deepStrictEqual(parseLookup(7, data), {
            posFormat: 3,
            coverages: [{ format: 1, glyphs: [5] }, { format: 1, glyphs: [6] }],
            lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 4 }]
        });
    });

    // lookup type 8
    it('can parse lookup8 ChainedSequenceContextFormat1, the glyph rules of each covered glyph', function() {
        // https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2#chained-sequence-context-format-1-simple-glyph-contexts
        const data = '0001 0008 0001 000E' +    // posFormat, coverage offset, chainedSeqRuleSetCount, chainedSeqRuleSet offset
            '0001 0001 0005' +                  // coverage format 1
            '0001 0004' +                       // chainedSeqRuleSet: chainedSeqRuleCount, chainedSeqRule offset
            '0001 0004   0002 0006   0001 0007   0001 0001 0002'; // backtrack, input, lookahead, lookup records
        assert.deepStrictEqual(parseLookup(8, data), {
            posFormat: 1,
            coverage: { format: 1, glyphs: [5] },
            chainRuleSets: [[{
                backtrack: [4],
                input: [6],
                lookahead: [7],
                lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 2 }]
            }]]
        });
    });

    it('can parse lookup8 ChainedSequenceContextFormat2, the class rules of each input class', function() {
        // https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2#chained-sequence-context-format-2-class-based-glyph-contexts
        const data = '0002 0010 0016 001E 0028 0002 0000 0030' + // posFormat, coverage and classDef offsets, two chainedClassSeqRuleSet offsets
            '0001 0001 0005' +                                   // coverage format 1
            '0001 0004 0001 0001' +                              // backtrack classDef format 1: glyph 4 in class 1
            '0001 0005 0002 0001 0001' +                         // input classDef format 1: glyphs 5 and 6 in class 1
            '0001 0007 0001 0002' +                              // lookahead classDef format 1: glyph 7 in class 2
            '0001 0004' +                                        // chainedClassSeqRuleSet: rule count, rule offset
            '0001 0001   0002 0001   0001 0002   0001 0000 0003'; // backtrack, input, lookahead classes, lookup records
        assert.deepStrictEqual(parseLookup(8, data), {
            posFormat: 2,
            coverage: { format: 1, glyphs: [5] },
            backtrackClassDef: { format: 1, startGlyph: 4, classes: [1] },
            inputClassDef: { format: 1, startGlyph: 5, classes: [1, 1] },
            lookaheadClassDef: { format: 1, startGlyph: 7, classes: [2] },
            chainClassSet: [undefined, [{
                backtrack: [1],
                input: [1],
                lookahead: [2],
                lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 3 }]
            }]]
        });
    });

    it('can parse lookup8 ChainedSequenceContextFormat3, the coverage of each glyph of the sequences', function() {
        // https://learn.microsoft.com/en-us/typography/opentype/spec/chapter2#chained-sequence-context-format-3-coverage-based-glyph-contexts
        const data = '0003 0001 0014 0001 001A 0001 0020 0001 0000 0004' + // posFormat, the coverage offsets of each sequence, lookup record
            '0001 0001 0004   0001 0001 0005   0001 0001 0006';           // coverage tables format 1
        assert.deepStrictEqual(parseLookup(8, data), {
            posFormat: 3,
            backtrackCoverage: [{ format: 1, glyphs: [4] }],
            inputCoverage: [{ format: 1, glyphs: [5] }],
            lookaheadCoverage: [{ format: 1, glyphs: [6] }],
            lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 4 }]
        });
    });

    it('throws on a lookup7 or lookup8 format that is not 1, 2 or 3', function() {
        for (const lookupType of [7, 8]) {
            assert.throws(() => parseLookup(lookupType, '0004 0000 0000 0000'), new RegExp(`GPOS lookup type ${lookupType} format must be 1, 2 or 3`));
        }
    });

    it('can parse the contextual positioning lookups of an extension lookup', function() {
        const data = '0001 0008 00000008' +
            '0003 0001 0014 0001 001A 0001 0020 0001 0000 0004   0001 0001 0004   0001 0001 0005   0001 0001 0006';
        const subtable = parseLookup(9, data);
        assert.strictEqual(subtable.lookupType, 8);
        assert.deepStrictEqual(subtable.extension.inputCoverage, [{ format: 1, glyphs: [5] }]);
    });

    it('reads the contextual positioning lookups of a font like fontTools, in the formats 1, 2 and 3', function() {
        // TestContextualPositioning.ttf, built by test/generate-contextual-positioning-font.py (fontTools otTables): the
        // lookups 9 to 14 of the features ss01 to ss06; a 5, b 6, c 7, d 8, e 9, o 12, x 13, T 3
        const font = parse(readFileSync('./test/fonts/TestContextualPositioning.ttf'));
        const lookups = font.tables.gpos.lookups;
        assert.deepStrictEqual(lookups.slice(9, 15).map(lookup => [lookup.lookupType, lookup.subtables.map(subtable => subtable.posFormat)]),
            [[7, [1]], [7, [2]], [7, [3]], [8, [1]], [8, [2]], [8, [3]]]);
        // CONTEXT_CLASSES: c d in class 2, its rule c d' a b' with lookup SHIFT_UP (2) at the second glyph
        const contextClasses = lookups[10].subtables[0];
        assert.deepStrictEqual(contextClasses.coverage, { format: 1, glyphs: [5, 6, 7, 8, 9, 12] });
        assert.strictEqual(font.position.getGlyphClass(contextClasses.classDef, 8), 2);
        assert.deepStrictEqual(contextClasses.classSets[2], [{ classes: [1], lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 2 }] }]);
        // CHAIN_GLYPHS: T a' lookup TIGHTEN (0) b' x; a' lookup SHIFT_UP (2) x;
        assert.deepStrictEqual(lookups[12].subtables[0].chainRuleSets, [[
            { backtrack: [3], input: [6], lookahead: [13], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] },
            { backtrack: [], input: [], lookahead: [13], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 2 }] }
        ]]);
    });

    //// Lookup type 9 ////////////////////////////////////////////////////////
    it('can parse lookup9 ExtensionPosFormat1 wrapping a PairPosFormat1 subtable', function() {
        // https://docs.microsoft.com/en-us/typography/opentype/spec/gpos#lookuptype-9-extension-positioning
        const data = '0001 0002 00000008' +       // posFormat, extensionLookupType 2, offset from this subtable
            '0001 001E 0004 0001 0002 000E 0016   0001 0059 FFE2 FFEC 0001 0059 FFD8 FFE7   0001 0002 002D 0031';
        assert.deepEqual(parseLookup(9, data), {
            posFormat: 1,
            lookupType: 2,
            extension: {
                posFormat: 1,
                coverage: {
                    format: 1,
                    glyphs: [0x2d, 0x31]
                },
                valueFormat1: 4,
                valueFormat2: 1,
                pairSets: [
                    [{ secondGlyph: 0x59, value1: { xAdvance: -30 }, value2: { xPlacement: -20 } }],
                    [{ secondGlyph: 0x59, value1: { xAdvance: -40 }, value2: { xPlacement: -25 } }]
                ]
            }
        });
    });

    it('can parse lookup9 ExtensionPosFormat1 wrapping a PairPosFormat2 subtable', function() {
        // the wrapped subtable is not adjacent to the extension subtable: its offsets are relative to its own start
        const data = '0001 0002 0000000C' +       // posFormat, extensionLookupType 2, offset from this subtable
            'DEAD BEEF' +                         // unrelated data between the two subtables
            '0002 0018 0004 0000 0022 0032 0002 0002 0000 0000 0000 FFCE   0001 0003 0046 0047 0049   0002 0002 0046 0047 0001 0049 0049 0001   0002 0001 006A 006B 0001';
        const subtable = parseLookup(9, data);
        assert.equal(subtable.lookupType, 2);
        assert.equal(subtable.extension.posFormat, 2);
        assert.deepEqual(subtable.extension.coverage, { format: 1, glyphs: [0x46, 0x47, 0x49] });
        assert.deepEqual(subtable.extension.classRecords[1][1], { value1: { xAdvance: -50 }, value2: undefined });
    });

    it('throws on a malformed lookup9 subtable', function() {
        assert.throws(() => parseLookup(9, '0002 0002 00000008'), /GPOS lookup type 9 format must be 1/);
        assert.throws(() => parseLookup(9, '0001 0009 00000008'), /GPOS extension lookup type must be 1 to 8/);
    });

    describe('with a callback for the subtables that fail to parse', function() {
        // a GPOS table of two lookups: the first one with the subtables at the offsets of subtableOffsets from the
        // lookup (subtableData starts after the lookup table: at the offset 0x0a for two subtables, 0x08 for one), the
        // second one with one single adjustment subtable
        function parseLookups(lookupType, subtableOffsets, subtableData) {
            const toHex = value => value.toString(16).padStart(4, '0');
            const offsets = subtableOffsets.map(toHex).join(' ');
            const firstLookup = '000' + lookupType + ' 0000 ' + toHex(subtableOffsets.length) + ' ' + offsets + subtableData;
            // after the LookupList table (its count and two offsets) and the first lookup
            const firstLookupSize = 6 + 2 * subtableOffsets.length + subtableData.replace(/ /g, '').length / 2;
            const secondLookupOffset = toHex(6 + firstLookupSize);
            const data = unhex('00010000 000A 000C 000E' +   // header
                '0000' +                                        // ScriptTable - 0 scripts
                '0000' +                                        // FeatureListTable - 0 features
                '0002 0006 ' + secondLookupOffset +             // LookupListTable - 2 lookup tables
                firstLookup +
                '0001 0000 0001 0008   0001 0008 0004 FFF6   0001 0001 0005');
            const errors = [];
            const lookups = gpos.parse(data, 0, (error, lookupIndex, subtableIndex) => {
                errors.push([error.message, lookupIndex, subtableIndex]);
            }).lookups;
            return { lookups, errors };
        }

        it('reads a subtable of an unknown format as undefined, with its error, and parses the other subtables', function() {
            // a mark-to-base subtable of format 2, then a NULL subtable offset; HarfBuzz skips a subtable of an unknown
            // format (TestMarkAttachment-Malformed.ttf, see test/generate-malformed-layout-fonts.py)
            const { lookups, errors } = parseLookups(4, [0x0a, 0], '0002 0000 0000 0000 0000 0000');
            assert.deepStrictEqual(lookups[0].subtables, [undefined, undefined]);
            assert.deepStrictEqual(errors, [['0x1e: GPOS lookup type 4 format must be 1.', 0, 0]]);
            assert.deepStrictEqual(lookups[1].subtables, [{ posFormat: 1, coverage: { format: 1, glyphs: [5] }, value: { xAdvance: -10 } }]);
        });

        it('reads the malformed subtables of the lookup types 1 to 9 as undefined, with their errors', function() {
            const malformedSubtables = [
                [1, '0003 0000 0000', /GPOS lookup type 1 format must be 1 or 2/],
                [2, '0003 0000 0000 0000', /GPOS lookup type 2 format must be 1 or 2/],
                [3, '0002 0000 0000', /GPOS lookup type 3 format must be 1/],
                [5, '0002 0000 0000 0000 0000 0000', /GPOS lookup type 5 format must be 1/],
                [6, '0002 0000 0000 0000 0000 0000', /GPOS lookup type 6 format must be 1/],
                [7, '0004 0000 0000 0000', /GPOS lookup type 7 format must be 1, 2 or 3/],
                [8, '0004 0000 0000 0000', /GPOS lookup type 8 format must be 1, 2 or 3/],
                [9, '0002 0002 00000008', /GPOS lookup type 9 format must be 1/],
                [9, '0001 0009 00000008', /GPOS extension lookup type must be 1 to 8/],
                // an extension subtable that wraps a mark-to-mark subtable of format 2
                [9, '0001 0006 00000008 0002 0000 0000 0000 0000 0000', /GPOS lookup type 6 format must be 1/],
                // a coverage table of format 3 (like the fonts of Tabler Icons, opentype.js issue 617)
                [1, '0001 0006 0000 0003 0001 0005', /Coverage format must be 1 or 2/]
            ];
            for (const [lookupType, subtableData, expectedError] of malformedSubtables) {
                // an extension lookup of one subtable: in an extension lookup, a NULL subtable offset (of the extension
                // lookup type 0) next to a subtable of another extension lookup type skips the whole lookup, like
                // HarfBuzz (see parseLookup in parse.mjs)
                const subtableOffsets = lookupType === 9 ? [0x08] : [0x0a, 0];
                const { lookups, errors } = parseLookups(lookupType, subtableOffsets, subtableData);
                assert.deepStrictEqual(lookups[0].subtables, subtableOffsets.map(() => undefined), subtableData);
                assert.strictEqual(errors.length, 1, subtableData);
                assert.match(errors[0][0], expectedError, subtableData);
                assert.deepStrictEqual(errors[0].slice(1), [0, 0], subtableData);
            }
        });

        it('passes the errors of the subtables as Error objects', function() {
            const errors = [];
            const data = unhex('00010000 000A 000C 000E 0000 0000 0001 0004 0004 0000 0001 0008 0002 0000 0000');
            gpos.parse(data, 0, error => errors.push(error));
            assert.strictEqual(errors.length, 1);
            assert.ok(errors[0] instanceof Error);
        });
    });
});
