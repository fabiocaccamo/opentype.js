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

    it('throws on an anchor format that is not 1, 2 or 3, and on a lookup4 format that is not 1', function() {
        // the mark anchor of format 4
        const data = '0001 000C 0012 0001 0018 0024   0001 0001 000A   0001 0001 0005   0001 0000 0006 0004 0000 01F4   0001 0004 0001 0000 0258';
        assert.throws(() => parseLookup(4, data), /GPOS anchor format must be 1, 2 or 3/);
        assert.throws(() => parseLookup(4, '0002' + data.slice(4)), /GPOS lookup type 4 format must be 1/);
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

    it('skips a malformed lookup9 subtable without throwing', function() {
        assert.match(parseLookup(9, '0002 0002 00000008').error, /GPOS lookup type 9 format must be 1/);
        assert.match(parseLookup(9, '0001 0009 00000008').error, /GPOS extension lookup type must be 1 to 8/);
    });
});
