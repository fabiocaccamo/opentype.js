import assert from 'assert';
import { readFileSync } from 'fs';
import { Font, Glyph, Path, parse } from '../src/opentype.mjs';
import { glyphIndexes, createLookupFlagsFont, createLayoutTable } from './lookup-flags-font.mjs';
import { itFailsUntilFixed } from './regression/helpers.mjs';

// a pair adjustment subtable (format 1) kerning leftGlyph + rightGlyph by xAdvance
function pairPosSubtable(leftGlyph, rightGlyph, xAdvance) {
    return {
        posFormat: 1,
        coverage: { format: 1, glyphs: [leftGlyph] },
        valueFormat1: 4,
        valueFormat2: 0,
        pairSets: [[{ secondGlyph: rightGlyph, value1: { xAdvance }, value2: undefined }]]
    };
}

// a pair adjustment subtable (format 2) covering leftGlyph (class 1 of its class definition), with one class
// record by class of the right glyphs: rightGlyphClasses maps a right glyph to its class, the other glyphs are
// in class 0, and xAdvances has the value of each class
function classPairPosSubtable(leftGlyph, rightGlyphClasses, xAdvances) {
    return {
        posFormat: 2,
        coverage: { format: 1, glyphs: [leftGlyph] },
        valueFormat1: 4,
        valueFormat2: 0,
        classDef1: { format: 2, ranges: [{ start: leftGlyph, end: leftGlyph, classId: 1 }] },
        classDef2: {
            format: 2,
            ranges: Object.keys(rightGlyphClasses).map(Number).sort((glyphA, glyphB) => glyphA - glyphB)
                .map(glyph => ({ start: glyph, end: glyph, classId: rightGlyphClasses[glyph] }))
        },
        classRecords: [
            xAdvances.map(() => ({ value1: { xAdvance: 0 }, value2: undefined })),
            xAdvances.map(xAdvance => ({ value1: { xAdvance }, value2: undefined }))
        ]
    };
}

function pairPosLookup(subtables) {
    return { lookupType: 2, lookupFlag: 0, subtables };
}

function extensionLookup(subtables) {
    return {
        lookupType: 9,
        lookupFlag: 0,
        subtables: subtables.map(subtable => ({ posFormat: 1, lookupType: subtable.lookupType, extension: subtable.extension }))
    };
}

function langSys(featureIndexes) {
    return { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes };
}

// a font whose GPOS has the given script records, features and lookups
function createFontWithGpos(scripts, features, lookups) {
    const glyphs = [];
    for (let i = 0; i < 5; i++) {
        glyphs.push(new Glyph({ index: i, name: 'glyph' + i, advanceWidth: 500, path: new Path() }));
    }
    const font = new Font({
        familyName: 'KerningTest',
        styleName: 'Regular',
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
        glyphs
    });
    font.tables.gpos = { version: 1, scripts, features, lookups };
    font.position.init();
    return font;
}

// a font whose GPOS has the DFLT script only, with a kern feature of the given lookups
function createFont(lookups, lookupListIndexes) {
    return createFontWithGpos(
        [{ tag: 'DFLT', script: { defaultLangSys: langSys([0]), langSysRecords: [] } }],
        [{ tag: 'kern', feature: { featureParams: 0, lookupListIndexes } }],
        lookups
    );
}

// a font with one kern feature by script: feature i has the lookup i, that kerns glyph 1 + glyph 2 by -10 * (i + 1)
function createFontWithScripts(scriptTags) {
    return createFontWithGpos(
        scriptTags.map((tag, index) => ({ tag, script: { defaultLangSys: langSys([index]), langSysRecords: [] } })),
        scriptTags.map((tag, index) => ({ tag: 'kern', feature: { featureParams: 0, lookupListIndexes: [index] } })),
        scriptTags.map((tag, index) => pairPosLookup([pairPosSubtable(1, 2, -10 * (index + 1))]))
    );
}

describe('position.mjs', function() {
    describe('getKerningTables', function() {
        it('includes the pair adjustment subtables wrapped in extension lookups', function() {
            const font = createFont([
                extensionLookup([{ lookupType: 2, extension: pairPosSubtable(1, 2, -30) }])
            ], [0]);
            const kerningTables = font.position.getKerningTables('DFLT');
            assert.equal(kerningTables.length, 1);
            assert.equal(kerningTables[0].lookupType, 2);
            assert.equal(kerningTables[0].subtables[0].posFormat, 1);
            assert.equal(font.getKerningValue(1, 2), -30);
        });

        it('lists the lookups in LookupList order, the order HarfBuzz applies them in, whatever their order in the feature, once each', function() {
            const plainSubtable = pairPosSubtable(1, 2, -10);
            const extensionSubtable = pairPosSubtable(1, 2, -20);
            const font = createFont([
                pairPosLookup([plainSubtable]),
                extensionLookup([{ lookupType: 2, extension: extensionSubtable }])
            ], [1, 0, 1]);
            const kerningTables = font.position.getKerningTables('DFLT');
            assert.deepStrictEqual(kerningTables.map(lookupTable => lookupTable.subtables[0]), [plainSubtable, extensionSubtable]);
        });

        it('ignores extension lookups wrapping other lookup types', function() {
            const font = createFont([
                extensionLookup([{ lookupType: 4, extension: { error: 'GPOS Lookup 4 not supported' } }]),
                pairPosLookup([pairPosSubtable(1, 2, -10)])
            ], [0, 1]);
            assert.equal(font.position.getKerningTables('DFLT').length, 1);
            assert.equal(font.getKerningValue(1, 2), -10);
        });

        it('applies extension kerning in getAdvanceWidth', function() {
            const font = createFont([
                extensionLookup([{ lookupType: 2, extension: pairPosSubtable(1, 2, -100) }])
            ], [0]);
            // the font has no cmap: map the text to the kerned glyphs directly
            font._stringToDirectionalGlyphClusters = () => [
                { glyph: font.glyphs.get(1), start: 0, end: 1, rightToLeft: false },
                { glyph: font.glyphs.get(2), start: 1, end: 2, rightToLeft: false }
            ];
            assert.equal(font.getAdvanceWidth('AB', 1000), 900);
            assert.equal(font.getAdvanceWidth('AB', 1000, { kerning: false }), 1000);
        });

        it('returns undefined without a kern feature for the script, the list of its pair adjustment lookups (maybe empty) with one', function() {
            // undefined means that the kern table applies: HarfBuzz applies it when the GPOS map has no kern feature
            // (hb-ot-shape.cc), and not when the kern feature has no pair adjustment lookup
            const singleAdjustmentLookup = { lookupType: 1, lookupFlag: 0, subtables: [] };
            const font = createFontWithGpos(
                [
                    { tag: 'DFLT', script: { defaultLangSys: langSys([0]), langSysRecords: [] } },
                    { tag: 'latn', script: { defaultLangSys: langSys([1]), langSysRecords: [] } }
                ],
                [
                    { tag: 'dist', feature: { featureParams: 0, lookupListIndexes: [0] } },
                    { tag: 'kern', feature: { featureParams: 0, lookupListIndexes: [0] } }
                ],
                [singleAdjustmentLookup]
            );
            assert.strictEqual(font.position.getKerningTables('DFLT'), undefined);
            assert.deepStrictEqual(font.position.getKerningTables('latn'), []);
            font.tables.gpos = undefined;
            assert.strictEqual(font.position.getKerningTables('latn'), undefined);
        });

        it('takes the kern feature of latn without a script, the script of the latin text', function() {
            const font = createFontWithScripts(['DFLT', 'latn']);
            assert.equal(font.position.getKerningValue(font.position.getKerningTables(), 1, 2), -20);
            // glyphs no character maps to have no script: DFLT, like HarfBuzz for a text of no script (see font.spec)
            assert.equal(font.getKerningValue(1, 2), -10);
            font.glyphs.get(1).addUnicode(0x41);
            font.glyphs.get(2).addUnicode(0x56);
            assert.equal(font.getKerningValue(1, 2), -20);
        });

        it('falls back to DFLT, then dflt, then latn for a script the font has not, like HarfBuzz', function() {
            // hb_ot_layout_table_select_script, checked with hb-shape --script=cyrl on fonts built by fontTools with the
            // same scripts: the kern lookup of DFLT applies, of dflt without DFLT, of latn without both
            const scriptsAndFallbacks = [
                { scriptTags: ['DFLT', 'dflt', 'latn'], kerning: -10 },
                { scriptTags: ['dflt', 'latn'], kerning: -10 },
                { scriptTags: ['grek', 'latn'], kerning: -20 }
            ];
            for (const { scriptTags, kerning } of scriptsAndFallbacks) {
                const font = createFontWithScripts(scriptTags);
                const kerningTables = font.position.getKerningTables('cyrl');
                assert.equal(font.position.getKerningValue(kerningTables, 1, 2), kerning, scriptTags.join());
            }
            assert.strictEqual(createFontWithScripts(['grek']).position.getKerningTables('cyrl'), undefined);
        });

        it('falls back to the default language system of the script for a language the script has not', function() {
            const font = createFontWithGpos(
                [{
                    tag: 'latn',
                    script: { defaultLangSys: langSys([0]), langSysRecords: [{ tag: 'TRK ', langSys: langSys([1]) }] }
                }],
                [
                    { tag: 'kern', feature: { featureParams: 0, lookupListIndexes: [0] } },
                    { tag: 'kern', feature: { featureParams: 0, lookupListIndexes: [1] } }
                ],
                [pairPosLookup([pairPosSubtable(1, 2, -30)]), pairPosLookup([pairPosSubtable(1, 2, -40)])]
            );
            const getKerning = language => font.position.getKerningValue(font.position.getKerningTables('latn', language), 1, 2);
            assert.equal(getKerning('TRK '), -40);
            assert.equal(getKerning('ROM '), -30);
            assert.equal(getKerning(), -30);
        });

        it('returns undefined for a script without a default language system, also when it is the fallback script', function() {
            // the latn script of NotoSansThai-Medium-Testing-v1.ttf has the language systems MOL and ROM only:
            // HarfBuzz finds no kern feature (hb_ot_layout_script_select_language gives no language system) and does
            // not try the next fallback script, hb-shape --text=AV gives the same advances with and without kern
            const font = createFontWithGpos(
                [
                    { tag: 'DFLT', script: { defaultLangSys: langSys([0]), langSysRecords: [] } },
                    { tag: 'latn', script: { defaultLangSys: undefined, langSysRecords: [{ tag: 'ROM ', langSys: langSys([1]) }] } }
                ],
                [
                    { tag: 'kern', feature: { featureParams: 0, lookupListIndexes: [0] } },
                    { tag: 'kern', feature: { featureParams: 0, lookupListIndexes: [1] } }
                ],
                [pairPosLookup([pairPosSubtable(1, 2, -10)]), pairPosLookup([pairPosSubtable(1, 2, -20)])]
            );
            assert.strictEqual(font.position.getKerningTables('latn'), undefined);
            assert.strictEqual(font.position.getKerningTables('latn', 'TRK '), undefined);
            assert.equal(font.position.getKerningValue(font.position.getKerningTables('latn', 'ROM '), 1, 2), -20);
            assert.equal(font.position.getKerningValue(font.position.getKerningTables('DFLT'), 1, 2), -10);
            // a script the font has not falls back to DFLT, that has a default language system
            assert.equal(font.position.getKerningValue(font.position.getKerningTables('cyrl'), 1, 2), -10);
            font.tables.gpos.scripts.shift();
            // without DFLT, cyrl falls back to latn, without default language system: no kern feature
            assert.strictEqual(font.position.getKerningTables('cyrl'), undefined);
        });

        it('returns undefined for hebr without a hebr script, like the Hebrew shaper of HarfBuzz (gpos_tag)', function() {
            // fonts built by fontTools (feaLib: languagesystem DFLT dflt and latn dflt, feature kern
            // { pos alef alef -30; }, glyphs of 600 units), without the hebr script:
            // hb-shape --no-glyph-names --script=Hebr <font> -u 5d0,5d0
            // [1=1+600|1=0+600]: no GPOS kerning (--script=Latn: [1=0+570|1=1+600])
            // and with a kern table that kerns alef alef by -50: [1=1+575|1=0@-25,0+575]
            // with the hebr script (languagesystem hebr dflt) too: [1=1+600|1=0+570]
            const font = createFontWithScripts(['DFLT', 'latn']);
            assert.strictEqual(font.position.getKerningTables('hebr'), undefined);
            assert.equal(font.position.getKerningValue(font.position.getKerningTables('hebr'), 1, 2), 0);
            assert.equal(font.position.getKerningValue(font.position.getKerningTables('cyrl'), 1, 2), -10);
            font.kerningPairs = { '1,2': -50 };
            assert.equal(font.position.getKerningValue(font.position.getKerningTables('hebr'), 1, 2), -50);
            font._stringToDirectionalGlyphClusters = () => [
                { glyph: font.glyphs.get(1), start: 0, end: 1, rightToLeft: false },
                { glyph: font.glyphs.get(2), start: 1, end: 2, rightToLeft: false }
            ];
            assert.equal(font.getAdvanceWidth('אא', font.unitsPerEm, { script: 'hebr' }), 1000 - 50);
            const hebrewFont = createFontWithScripts(['DFLT', 'hebr', 'latn']);
            assert.equal(hebrewFont.position.getKerningValue(hebrewFont.position.getKerningTables('hebr'), 1, 2), -20);
        });

        it('sets the default kerning tables of latn: undefined without a kern feature, empty without pair adjustment lookups', function() {
            const font = createFontWithGpos(
                [{ tag: 'DFLT', script: { defaultLangSys: langSys([0]), langSysRecords: [] } }],
                [{ tag: 'mark', feature: { featureParams: 0, lookupListIndexes: [0] } }],
                [pairPosLookup([pairPosSubtable(1, 2, -10)])]
            );
            assert.strictEqual(font.position.defaultKerningTables, undefined);
            font.tables.gpos.features[0].tag = 'kern';
            font.tables.gpos.lookups[0].lookupType = 1;
            font.position.init();
            assert.deepStrictEqual(font.position.defaultKerningTables, []);
        });
    });

    describe('getKerningValue', function() {
        // like HarfBuzz (PairPosFormat1 and PairPosFormat2): in a lookup the first subtable that applies to the pair
        // gives the value, a format 1 subtable applies to the pairs it lists, a format 2 subtable to the pairs whose
        // left glyph it covers, and the values of the lookups add up
        function getKerning(lookups, leftGlyph, rightGlyph) {
            const font = createFont(lookups, lookups.map((lookup, index) => index));
            return font.position.getKerningValue(font.position.getKerningTables('DFLT'), leftGlyph, rightGlyph);
        }

        it('adds the values of the kern lookups, a plain and an extension one', function() {
            const lookups = [
                pairPosLookup([pairPosSubtable(1, 2, -10)]),
                extensionLookup([{ lookupType: 2, extension: classPairPosSubtable(1, { 2: 1 }, [0, -20]) }])
            ];
            assert.equal(getKerning(lookups, 1, 2), -30);
            assert.equal(getKerning(lookups, 1, 3), 0);
            assert.equal(getKerning(lookups, 3, 2), 0);
        });

        it('applies the first format 1 subtable that lists the pair, after one that covers the left glyph without it', function() {
            const lookups = [pairPosLookup([pairPosSubtable(1, 3, -10), pairPosSubtable(1, 2, -20), pairPosSubtable(1, 2, -30)])];
            assert.equal(getKerning(lookups, 1, 2), -20);
            assert.equal(getKerning(lookups, 1, 3), -10);
        });

        it('stops at a format 2 subtable that covers the left glyph, also with a class record of 0', function() {
            const lookups = [pairPosLookup([classPairPosSubtable(1, { 2: 1 }, [0, -20]), pairPosSubtable(1, 3, -30)])];
            assert.equal(getKerning(lookups, 1, 2), -20);
            assert.equal(getKerning(lookups, 1, 3), 0);
        });

        it('stops at a pair without value record for the left glyph (value format 0)', function() {
            const pairWithoutValue = pairPosSubtable(1, 2, 0);
            pairWithoutValue.valueFormat1 = 0;
            pairWithoutValue.pairSets[0][0].value1 = undefined;
            assert.equal(getKerning([pairPosLookup([pairWithoutValue, pairPosSubtable(1, 2, -30)])], 1, 2), 0);
        });

        it('goes on after a format 2 subtable whose class of the left glyph has no class record', function() {
            const classOutOfRange = classPairPosSubtable(1, { 2: 1 }, [0, -20]);
            classOutOfRange.classDef1.ranges[0].classId = 2;
            assert.equal(getKerning([pairPosLookup([classOutOfRange, pairPosSubtable(1, 2, -30)])], 1, 2), -30);
        });

        it('goes on after a format 2 subtable whose class of the right glyph is out of the class count', function() {
            // HarfBuzz PairPosFormat2: klass2 >= class2Count, the subtable does not apply
            const classOutOfRange = classPairPosSubtable(1, { 2: 1 }, [0, -20]);
            classOutOfRange.classDef2.ranges[0].classId = 2;
            assert.equal(getKerning([pairPosLookup([classOutOfRange, pairPosSubtable(1, 2, -30)])], 1, 2), -30);
        });

        it('gives the value of the kern table without kerning lookups, as getKerningTables returns them without a kern feature', function() {
            // GPOS of TestTracking3.ttf: latn with trak as its required feature and no kern feature
            // python -m fontTools.ttx -q -t kern -o - TestTracking3.ttf: <pair l="A" r="V" v="-152"/>, no pair V T
            const trackingFont = parse(readFileSync('./test/fonts/TestTracking3.ttf'));
            const left = trackingFont.charToGlyphIndex('A');
            const right = trackingFont.charToGlyphIndex('V');
            const unkernedRight = trackingFont.charToGlyphIndex('T');
            for (const script of [undefined, 'latn', 'cyrl']) {
                const kerningTables = trackingFont.position.getKerningTables(script);
                assert.equal(trackingFont.position.getKerningValue(kerningTables, left, right), -152, script);
            }
            trackingFont.tables.gpos = undefined;
            assert.equal(trackingFont.position.getKerningValue(trackingFont.position.getKerningTables(), left, right), -152);
            assert.equal(trackingFont.position.getKerningValue(undefined, right, unkernedRight), 0);
        });

        it('gives 0 for an empty list of kerning lookups, not the value of the kern table', function() {
            // a kern feature without pair adjustment lookups: HarfBuzz does not fall back to the kern table (see the
            // font.spec test of a kern feature with a single adjustment lookup)
            const font = createFont([], []);
            font.kerningPairs = { '1,2': -50 };
            assert.equal(font.position.getKerningValue([], 1, 2), 0);
            assert.equal(font.position.getKerningValue(undefined, 1, 2), -50);
        });

        it('applies no variation delta when the layout ignores the GDEF table, whose item variation store has the deltas', function() {
            // HarfBuzz replaces a blocklisted GDEF table with an empty one (GDEF::accelerator_t), so the device
            // tables of GPOS have no variation store: the value at the default location, wght 200 of Changa
            // hb-shape --no-glyph-names --cluster-level=1 Changa-VariableFont_wght.ttf -u 41,56: [1=0+503|113=1+486],
            // with --features=-kern [1=0+520|113=1+486]; with --variations=wght=800 the font.spec reference is -30
            const variableFont = parse(readFileSync('./test/fonts/Changa-VariableFont_wght.ttf'));
            const kerningTables = variableFont.position.getKerningTables('latn');
            const left = variableFont.charToGlyphIndex('A');
            const right = variableFont.charToGlyphIndex('V');
            variableFont.isGdefIgnoredByLayout = true;
            assert.equal(variableFont.position.getKerningValue(kerningTables, left, right, { wght: 800 }), 503 - 520);
        });
    });

    // the font of test/lookup-flags-font.mjs with the pairs of a, b and acute of its kern feature (feaLib):
    //   lookup KERN_IGNORE_MARKS { lookupflag IgnoreMarks; pos a b -50; pos a acute -40; pos acute b -30; } KERN_IGNORE_MARKS;
    //   lookup KERN_NO_FLAG { pos a acute -20; } KERN_NO_FLAG;
    // hb-shape --no-glyph-names --cluster-level=1 LookupFlags.ttf -u <code points>
    describe('the lookupFlag of the kern lookups', function() {
        const { a: glyphA, b: glyphB, c: glyphC, acute, dotbelow } = glyphIndexes;
        let font;
        let kerningLookups;

        beforeEach(function() {
            const lookups = [
                {
                    lookupType: 2,
                    lookupFlag: 0x0008,
                    subtables: [pairPosSubtable(glyphA, glyphB, -50), pairPosSubtable(glyphA, acute, -40), pairPosSubtable(acute, glyphB, -30)]
                },
                pairPosLookup([pairPosSubtable(glyphA, acute, -20)])
            ];
            font = createLookupFlagsFont({ gpos: createLayoutTable('latn', 'kern', [0, 1], lookups) });
            kerningLookups = font.position.getKerningTables('latn');
        });

        it('kerns a glyph with the next glyph that each lookup does not ignore, across the marks', function() {
            // -u 0061,0301,0062: [1=0+430|5=1+0|2=2+500], the -50 of a b across the mark and the -20 of a acute
            assert.equal(font.position.getGlyphRunKerningValue(kerningLookups, [glyphA, acute, glyphB], 0), -70);
            assert.equal(font.position.getGlyphRunKerningValue(kerningLookups, [glyphA, acute, dotbelow, glyphB], 0), -70);
            // -u 0061,0301,0062: [1=0+430|5=1+0|2=2+500], no lookup applies at a mark it ignores: not the acute b -30
            assert.equal(font.position.getGlyphRunKerningValue(kerningLookups, [glyphA, acute, glyphB], 1), 0);
            // the last glyph of the run, and a glyph followed by ignored glyphs only
            assert.equal(font.position.getGlyphRunKerningValue(kerningLookups, [glyphA, acute, glyphB], 2), 0);
            assert.equal(font.position.getGlyphRunKerningValue(kerningLookups, [glyphB, glyphA, acute], 1), -20);
            assert.equal(font.position.getGlyphRunKerningValue(kerningLookups, [glyphA, glyphC, glyphB], 0), 0);
        });

        it('adds nothing for a lookup that ignores one of the two glyphs of a pair', function() {
            // -u 0061,0301: [1=0+480|5=1+0], the a acute of the lookup without a flag only
            assert.equal(font.position.getKerningValue(kerningLookups, glyphA, acute), -20);
            // -u 0061,0062: [1=0+450|2=1+500]
            assert.equal(font.position.getKerningValue(kerningLookups, glyphA, glyphB), -50);
            // -u 0301,0062: [5=0+0|2=1+500], not the acute b -30 of the lookup with IgnoreMarks
            assert.equal(font.position.getKerningValue(kerningLookups, acute, glyphB), 0);
        });

        it('reads the lookupFlag of an extension kern lookup, not of its subtables', function() {
            // LookupFlagsExtension.ttf: KERN_IGNORE_MARKS in an extension lookup
            // hb-shape --no-glyph-names --cluster-level=1 LookupFlagsExtension.ttf -u 0061,0301,0062: [1=0+430|5=1+0|2=2+500]
            const pairSubtables = [pairPosSubtable(glyphA, glyphB, -50), pairPosSubtable(glyphA, acute, -40), pairPosSubtable(acute, glyphB, -30)];
            const lookups = [
                { ...extensionLookup(pairSubtables.map(extension => ({ lookupType: 2, extension }))), lookupFlag: 0x0008 },
                pairPosLookup([pairPosSubtable(glyphA, acute, -20)])
            ];
            const extensionFont = createLookupFlagsFont({ gpos: createLayoutTable('latn', 'kern', [0, 1], lookups) });
            const extensionKerningLookups = extensionFont.position.getKerningTables('latn');
            assert.equal(extensionFont.position.getGlyphRunKerningValue(extensionKerningLookups, [glyphA, acute, glyphB], 0), -70);
        });

        describe('the kern table', function() {
            // the kern table of the reference font LookupFlagsKernTable.ttf (no GPOS table, a kern table of format 0
            // with the pairs a acute -15 and a b -60), here the kerningPairs of the font read with kerningLookups undefined
            // hb-shape --no-glyph-names --cluster-level=1 LookupFlagsKernTable.ttf -u <code points>
            beforeEach(function() {
                font.kerningPairs = { [`${glyphA},${acute}`]: -15, [`${glyphA},${glyphB}`]: -60 };
            });

            it('gives no kerning to the last glyph of the run', function() {
                assert.equal(font.position.getGlyphRunKerningValue(undefined, [glyphA, acute, glyphB], 2), 0);
            });

            itFailsUntilFixed('kerns a glyph with the next glyph that is not a mark, like HarfBuzz',
                'getGlyphRunKerningValue (src/position.mjs): kerns the glyph with the glyph right after it in the kern table, ' +
                'HarfBuzz skips the marks of GDEF (hb_kern_machine_t, IgnoreMarks): a acute b gives the -15 of a acute',
                function() {
                    // -u 0061,0301,0062: [1=0+470|5=1@-470,562+0|2=2@-30,0+470], the -60 of a b split between the two glyphs
                    assert.equal(font.position.getGlyphRunKerningValue(undefined, [glyphA, acute, glyphB], 0), -60);
                });
        });
    });
});
