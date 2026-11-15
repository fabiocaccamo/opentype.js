import assert from 'assert';
import { unhex } from '../testutil.mjs';
import gdef from '../../src/tables/gdef.mjs';

describe('tables/gdef.mjs', function() {
    const data =
        ' 00 01 00 00 00 0c 00 40 00 78 00 d0 00 02 00 08' +
        ' 00 65 00 65 00 03 00 f2 00 f2 00 01 02 08 02 08' +
        ' 00 01 02 0a 02 0a 00 01 02 1b 02 1b 00 01 02 22' +
        ' 02 22 00 01 03 f3 03 f4 00 02 04 14 04 14 00 03' +
        ' 00 0e 00 05 00 18 00 30 00 20 00 28 00 30 00 02' +
        ' 00 01 00 0f 00 13 00 00 00 03 00 0b 00 0d 00 0e' +
        ' 00 03 00 27 00 28 00 29 00 03 00 04 00 0d 00 0e' +
        ' 00 03 00 18 00 19 00 1a 00 0e 00 05 00 1c 00 24' +
        ' 00 32 00 36 00 44 00 01 00 05 03 ec 03 ed 03 ef' +
        ' 03 f0 03 f1 00 01 00 04 00 01 08 43 00 02 00 06' +
        ' 00 0a 00 01 05 82 00 01 0b 04 00 01 00 1e 00 02' +
        ' 00 06 00 0a 00 01 06 00 00 01 0c 00 00 03 00 08' +
        ' 00 0c 00 10 00 01 04 80 00 01 09 00 00 01 0d 80' +
        ' 00 02 00 05 00 2b 00 2b 00 01 00 2e 00 2e 00 02' +
        ' 00 4a 00 4a 00 04 00 65 00 65 00 01 00 7e 00 7e' +
        ' 00 02';

    const table = {
        version: 1,
        attachList: {
            attachPoints: [
                [11, 13, 14],
                [24, 25, 26],
                [39, 40, 41],
                [4, 13, 14],
                [24, 25, 26]
            ],
            coverage: {
                format: 2,
                ranges: [
                  { end: 19, index: 0, start: 15 }
                ]
            }
        },
        classDef: {
            format: 2,
            ranges: [
                { classId: 3, start: 101, end: 101 },
                { classId: 1, start: 242, end: 242 },
                { classId: 1, start: 520, end: 520 },
                { classId: 1, start: 522, end: 522 },
                { classId: 1, start: 539, end: 539 },
                { classId: 1, start: 546, end: 546 },
                { classId: 2, start: 1011, end: 1012 },
                { classId: 3, start: 1044, end: 1044 }

            ]
        },
        ligCaretList: {
            coverage: {format: 1, glyphs: [1004, 1005, 1007, 1008, 1009]},
            ligGlyphs: [
                  [{coordinate: 2115}],
                  [{coordinate: 1410}, {coordinate: 2820}],
                  [{coordinate: 2304}],
                  [{coordinate: 1536}, {coordinate: 3072}],
                  [{coordinate: 1152}, {coordinate: 2304}, {coordinate: 3456}]
            ]
        },
        markAttachClassDef: {
            format: 2,
            ranges: [
              {classId: 1, start: 43, end: 43},
              {classId: 2, start: 46, end: 46},
              {classId: 4, start: 74, end: 74},
              {classId: 1, start: 101, end: 101},
              {classId: 2, start: 126, end: 126}
           ]
        },
    };

    it('can parse a GDEF table', function() {
        assert.deepEqual(table, gdef.parse(unhex(data)));
    });

    it('can parse the mark glyph sets of a GDEF 1.2 table, with 32-bit coverage offsets', function() {
        const data = unhex(
            '0001 0002 0000 0000 0000 0000 000E' + // version 1.2, no classDef/attachList/ligCaretList/markAttachClassDef, markGlyphSetsDef
            '0001 0002 0000000C 00000012' +        // MarkGlyphSets: format 1, 2 sets, coverage offsets from this table
            '0001 0001 0005' +                     // coverage format 1: glyph 5
            '0001 0002 0007 0008'                  // coverage format 1: glyphs 7, 8
        );
        assert.deepEqual(gdef.parse(data).markGlyphSets, [
            { format: 1, glyphs: [5] },
            { format: 1, glyphs: [7, 8] }
        ]);
    });

    describe('of a GDEF table with broken parts', function() {
        // version 1.3: a GlyphClassDef (glyph 5 a mark), an AttachList offset past the end of the table, a
        // MarkGlyphSetsDef whose first coverage has the format 3 and whose second one covers the glyph 5, and an
        // ItemVariationStore offset past the end of the table
        const data = unhex(
            '0001 0003 0012 0FF0 0000 0000 001A 00000FF0' + // header
            '0001 0005 0001 0003' +                          // GlyphClassDef format 1: glyph 5 of class 3
            '0001 0002 0000000C 00000012' +                  // MarkGlyphSetsDef: format 1, 2 sets
            '0003 0001 0005' +                               // coverage format 3
            '0001 0001 0005'                                 // coverage format 1: glyph 5
        );

        it('reads each part that fails to parse as a NULL offset, like HarfBuzz neuters it, with its error', function() {
            const errors = [];
            const table = gdef.parse(data, 0, (error, partName) => errors.push([partName, error.message]));
            assert.deepStrictEqual(table, {
                version: 1.3,
                classDef: { format: 1, startGlyph: 5, classes: [3] },
                attachList: undefined,
                ligCaretList: undefined,
                markAttachClassDef: undefined,
                markGlyphSets: [undefined, { format: 1, glyphs: [5] }],
                itemVarStore: undefined
            });
            assert.deepStrictEqual(errors, [
                ['AttachList table', 'Offset is outside the bounds of the DataView'],
                ['coverage of the mark glyph set 0', '0x26: Coverage format must be 1 or 2.'],
                ['ItemVariationStore table', 'Offset is outside the bounds of the DataView']
            ]);
        });

        it('throws the error of a part that fails to parse without a callback', function() {
            assert.throws(() => gdef.parse(data), RangeError);
        });

        it('reads a GlyphClassDef past the end of the table as a NULL offset and keeps the MarkAttachClassDef, and the reverse', function() {
            // version 1.0, one ClassDef of format 1 after the header (glyph 5 of class 1, then of class 3), the offset of
            // the other ClassDef past the end of the table
            const errors = [];
            const withoutGlyphClassDef = gdef.parse(unhex('0001 0000 0FF0 0000 0000 000C   0001 0005 0001 0001'), 0,
                (error, partName) => errors.push([partName, error.message]));
            assert.deepStrictEqual(withoutGlyphClassDef, {
                version: 1,
                classDef: undefined,
                attachList: undefined,
                ligCaretList: undefined,
                markAttachClassDef: { format: 1, startGlyph: 5, classes: [1] }
            });
            const withoutMarkAttachClassDef = gdef.parse(unhex('0001 0000 000C 0000 0000 0FF0   0001 0005 0001 0003'), 0,
                (error, partName) => errors.push([partName, error.message]));
            assert.deepStrictEqual(withoutMarkAttachClassDef, {
                version: 1,
                classDef: { format: 1, startGlyph: 5, classes: [3] },
                attachList: undefined,
                ligCaretList: undefined,
                markAttachClassDef: undefined
            });
            assert.deepStrictEqual(errors, [
                ['GlyphClassDef table', 'Offset is outside the bounds of the DataView'],
                ['MarkAttachClassDef table', 'Offset is outside the bounds of the DataView']
            ]);
        });

        it('reads a NULL coverage offset of a mark glyph set as a set that covers no glyph, without error', function() {
            // version 1.2, a MarkGlyphSetsDef of two sets: a NULL coverage offset, then a coverage of the glyph 5
            const errors = [];
            const table = gdef.parse(unhex('0001 0002 0000 0000 0000 0000 000E   0001 0002 00000000 0000000C   0001 0001 0005'), 0,
                (error, partName) => errors.push([partName, error.message]));
            assert.deepStrictEqual(table.markGlyphSets, [undefined, { format: 1, glyphs: [5] }]);
            assert.deepStrictEqual(errors, []);
        });

        it('reads a MarkGlyphSetsDef of an unknown format as a NULL offset, like HarfBuzz (no mark glyph set)', function() {
            const errors = [];
            const table = gdef.parse(unhex('0001 0002 0000 0000 0000 0000 000E   0002 0001 00000008   0001 0001 0005'), 0,
                (error, partName) => errors.push([partName, error.message]));
            assert.strictEqual(table.markGlyphSets, undefined);
            assert.deepStrictEqual(errors, [['MarkGlyphSetsDef table', 'GDEF MarkGlyphSetsDef format must be 1.']]);
        });
    });

    describe('isBlocklisted', function() {
        // the GDEF, GSUB and GPOS table lengths of OT::GDEF::is_blocklisted (hb-ot-layout.cc, HarfBuzz 11.3.2)
        it('recognizes the GDEF tables HarfBuzz ignores by the lengths of the GDEF, GSUB and GPOS tables', function() {
            // OS X 10.11.3 Times New Roman Italic.ttf and Bold Italic.ttf, Windows 8 tahoma.ttf, macOS 15 Courier New.ttf
            assert.equal(gdef.isBlocklisted(490, 3046, 41638), true);
            assert.equal(gdef.isBlocklisted(478, 3046, 41902), true);
            assert.equal(gdef.isBlocklisted(898, 12554, 46470), true);
            assert.equal(gdef.isBlocklisted(588, 5078, 14418), true);
        });

        it('does not recognize the other lengths', function() {
            assert.equal(gdef.isBlocklisted(490, 3046, 41639), false);
            assert.equal(gdef.isBlocklisted(492, 3046, 41638), false);
            assert.equal(gdef.isBlocklisted(490, 0, 41638), false);
            assert.equal(gdef.isBlocklisted(490, 3046, 0), false);
        });
    });
});
