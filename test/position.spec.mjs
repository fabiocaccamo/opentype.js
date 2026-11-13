import assert from 'assert';
import { readFileSync } from 'fs';
import { Font, Glyph, Path, parse } from '../src/opentype.mjs';
import {
    DEFAULT_POSITIONING_FEATURES,
    MarkAdvanceZeroing,
    getMarkAdvanceZeroing,
    getMarkLigatureComponentIndex,
    areMarksOfSameGlyph,
    positionGlyphRun
} from '../src/position.mjs';
import { glyphIndexes, createLookupFlagsFont, createLayoutTable } from './lookup-flags-font.mjs';
import { replaceTextGlyphs } from './testutil.mjs';
import { loadFont, shapeText, assertShape, itFailsUntilFixed } from './regression/helpers.mjs';

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

// position glyphs of a font as one run with positionGlyphRun, in visual order, in the format of hb-shape without the
// clusters: glyph@x,y+advance, the offsets when one is not 0, the y advance after the x advance (+x,y) when it is not 0;
// the run options are the ones of a left-to-right latn run of the default GPOS features and of the default shaper of
// HarfBuzz if omitted
function positionGlyphs(font, glyphIndexes, runOptions) {
    const glyphPositions = glyphIndexes.map(glyphIndex => ({
        xAdvance: font.glyphs.get(glyphIndex).advanceWidth,
        yAdvance: 0,
        xOffset: 0,
        yOffset: 0
    }));
    positionGlyphRun(font.position, glyphIndexes, glyphPositions, Object.assign({
        rightToLeft: false,
        script: 'latn',
        language: undefined,
        featureTags: DEFAULT_POSITIONING_FEATURES,
        variation: undefined,
        markAdvanceZeroing: MarkAdvanceZeroing.AFTER_POSITIONING
    }, runOptions));
    return glyphPositions.map(({ xAdvance, yAdvance, xOffset, yOffset }, index) =>
        `${glyphIndexes[index]}${xOffset || yOffset ? `@${xOffset},${yOffset}` : ''}+${xAdvance}${yAdvance ? `,${yAdvance}` : ''}`
    ).join('|');
}

// position the glyphs of the characters of a text (see positionGlyphs)
function positionTextGlyphs(font, text, runOptions) {
    return positionGlyphs(font, Array.from(text).map(character => font.charToGlyphIndex(character)), runOptions);
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

        it('leaves out the single adjustment lookups of the kern feature, which the text layout applies', function() {
            // TestSingleAdjustment.ttf: the kern feature has the single adjustment lookups 5 (an extension lookup), 6 and 7
            const singleFont = parse(readFileSync('./test/fonts/TestSingleAdjustment.ttf'));
            // c has the -10 of the plain lookup 6: -u 0063,0064 [10=0+490|11=1+460], 0 for getKerningValue
            const kerningTables = singleFont.position.getKerningTables('latn');
            const [glyphC, glyphD] = [singleFont.charToGlyphIndex('c'), singleFont.charToGlyphIndex('d')];
            assert.strictEqual(singleFont.position.getKerningValue(kerningTables, glyphC, glyphD), 0);
            assert.deepStrictEqual(kerningTables, []);
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
            replaceTextGlyphs(font, [1, 2]);
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
            replaceTextGlyphs(font, [1, 2]);
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

        it('goes on after a format 1 subtable whose coverage index of the left glyph has no PairSet', function() {
            // HarfBuzz PairPosFormat1 reads a PairSet past PairSetCount as the Null PairSet, which has no pair
            const shortPairSets = pairPosSubtable(1, 2, -10);
            shortPairSets.coverage.glyphs = [1, 3];
            const lookups = [pairPosLookup([shortPairSets, pairPosSubtable(3, 2, -30)])];
            assert.equal(getKerning(lookups, 1, 2), -10);
            assert.equal(getKerning(lookups, 3, 2), -30);
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
            // the lookups of the lookup list, the extension lookup as the GPOS parser gives it
            assert.equal(extensionFont.position.getGlyphRunKerningValue(lookups, [glyphA, acute, glyphB], 0), -70);
        });

        it('skips a malformed extension subtable without a warning, and applies the next subtable', function() {
            // the GPOS parser gives { error } for an extension subtable whose format or lookup type is wrong (parseLookup9);
            // the a b -50 of KERN_IGNORE_MARKS, -u 0061,0062: [1=0+450|2=1+500]
            const extensionLookupTable = extensionLookup([{ lookupType: 2, extension: pairPosSubtable(glyphA, glyphB, -50) }]);
            extensionLookupTable.subtables.unshift({ error: '0x0: GPOS lookup type 9 format must be 1.' });
            const warnings = [];
            const consoleWarn = console.warn;
            console.warn = message => warnings.push(message);
            try {
                assert.equal(font.position.getGlyphRunKerningValue([extensionLookupTable], [glyphA, glyphB], 0), -50);
            } finally {
                console.warn = consoleWarn;
            }
            assert.deepStrictEqual(warnings, []);
        });

        describe('the kern table', function() {
            // the kern table of the reference font LookupFlagsKernTable.ttf (no GPOS table, a kern table of format 0
            // with the pairs a acute -15, a b -60, acute b -40 and A V -100), here its pairs of a, acute and b as the
            // kerningPairs of the font read with kerningLookups undefined
            // hb-shape --no-glyph-names --cluster-level=1 LookupFlagsKernTable.ttf -u <code points>
            beforeEach(function() {
                font.kerningPairs = {
                    [`${glyphA},${acute}`]: -15,
                    [`${glyphA},${glyphB}`]: -60,
                    [`${acute},${glyphB}`]: -40
                };
            });

            it('gives no kerning to the last glyph of the run', function() {
                assert.equal(font.position.getGlyphRunKerningValue(undefined, [glyphA, acute, glyphB], 2), 0);
            });

            it('gives no kerning to a position outside the run', function() {
                assert.equal(font.position.getGlyphRunKerningValue(undefined, [glyphA, glyphB], 2), 0);
                assert.equal(font.position.getGlyphRunKerningValue(undefined, [glyphA, glyphB], -1), 0);
                assert.equal(font.position.getGlyphRunKerningValue(undefined, [], 0), 0);
            });

            it('kerns a glyph with the next glyph that is not a mark, like HarfBuzz', function() {
                // -u 0061,0301,0062: [1=0+470|5=1@-470,562+0|2=2@-30,0+470], the -60 of a b split between the two glyphs
                assert.equal(font.position.getGlyphRunKerningValue(undefined, [glyphA, acute, glyphB], 0), -60);
            });

            it('kerns the glyph after a pair with the next glyph, not the marks between them', function() {
                // -u 0062,0061,0062: [2=0+500|1=1+470|2=2@-30,0+470], -u 0061,0062,0301: [1=0+470|2=1@-30,0+470|5=2@-470,562+0]
                assert.equal(font.position.getGlyphRunKerningValue(undefined, [glyphB, glyphA, glyphB], 1), -60);
                // -u 0061,0301,0062: [1=0+470|5=1@-470,562+0|2=2@-30,0+470], the acute after a starts no pair: not the
                // acute b -40
                assert.equal(font.position.getGlyphRunKerningValue(undefined, [glyphA, acute, glyphB], 1), 0);
                // -u 0061,0301: [1=0+500|5=1@-500,562+0], no glyph after a that is not a mark
                assert.equal(font.position.getGlyphRunKerningValue(undefined, [glyphA, acute], 0), 0);
            });

            it('kerns a mark at the start of the run with the next glyph', function() {
                // -u 0301,0062: [5=0@20,0+0|2=1@-20,0+480], the -40 of acute b split between the two glyphs; HarfBuzz then
                // sets the advance of the acute, a GDEF mark, to 0 and moves its offset back by the -20 it loses
                // (zero_mark_widths_by_gdef and adjust_mark_offsets, see the test of Font.shape)
                assert.equal(font.position.getGlyphRunKerningValue(undefined, [acute, glyphB], 0), -40);
                assert.equal(font.position.getKerningValue(undefined, acute, glyphB), -40);
            });

            it('gives no kerning to a pair whose right glyph is a mark, like HarfBuzz', function() {
                // -u 0061,0301: [1=0+500|5=1@-500,562+0], not the a acute -15
                assert.equal(font.position.getKerningValue(undefined, glyphA, acute), 0);
                assert.equal(font.position.getKerningValue(undefined, glyphA, glyphB), -60);
                const kernTableFont = createLookupFlagsFont();
                kernTableFont.kerningPairs = font.kerningPairs;
                assert.equal(kernTableFont.getKerningValue(glyphA, acute), 0);
                assert.equal(kernTableFont.getKerningValue(glyphA, glyphB), -60);
            });
        });
    });

    // TestPairPositioning.ttf, built by test/generate-pair-positioning-font.py:
    // hb-shape --no-glyph-names --cluster-level=1 TestPairPositioning.ttf -u <code points>
    describe('getValueRecordXAdvance', function() {
        // TestPairPositioning.ttf (test/generate-pair-positioning-font.py): lookup 0 pos A <10 20 -30 40> V <-5 15 -25 35>;,
        // lookup 3 pos T a with VariationIndex tables, the x advance of T from -20 at wght 100 to -60 at wght 900
        let pairFont;

        before(function() {
            pairFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
        });

        // the first value record of the first pair of the first subtable (format 1) of a lookup
        function getFirstValueRecord(lookupListIndex) {
            return pairFont.tables.gpos.lookups[lookupListIndex].subtables[0].pairSets[0][0].value1;
        }

        it('gives the x advance of a value record, not its placements or its y advance', function() {
            // -u 0041,0056: [2=0@10,20+570|4=1@-5,15+575], --features=-kern -u 0041,0056: [2=0+600|4=1+600]
            assert.strictEqual(pairFont.position.getValueRecordXAdvance(getFirstValueRecord(0)), 570 - 600);
        });

        it('adds the delta of the VariationIndex table of the x advance at the variation, the current one without it', function() {
            // -u 0054,0061: [3=0@10,0+480|5=1+500], --variations=wght=300: [3=0@15,10+470|5=1@-2,5+497],
            // --variations=wght=900: [3=0@30,40+440|5=1@-10,20+488]; --features=-kern -u 0054,0061: [3=0+500|5=1+500]
            const valueRecord = getFirstValueRecord(3);
            assert.strictEqual(pairFont.position.getValueRecordXAdvance(valueRecord), 480 - 500);
            assert.strictEqual(pairFont.position.getValueRecordXAdvance(valueRecord, { wght: 300 }), 470 - 500);
            assert.strictEqual(pairFont.position.getValueRecordXAdvance(valueRecord, { wght: 900 }), 440 - 500);
        });
    });

    describe('positionGlyphRun', function() {
        let pairFont;

        before(function() {
            pairFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
        });

        function positionText(text, runOptions, font = pairFont) {
            return positionTextGlyphs(font, text, runOptions);
        }

        it('applies the two value records of a pair, their placements and their x advances', function() {
            // -u 0041,0056: [2=0@10,20+570|4=1@-5,15+575], pos A <10 20 -30 40> V <-5 15 -25 35>;: the y advance is for
            // vertical text (HarfBuzz ValueFormat::apply_value)
            assert.strictEqual(positionText('AV'), '2@10,20+570|4@-5,15+575');
            // -u 0054,006F: [3=0+460|9=1@15,-10+500], -u 0054,0064,006F: [3=0+460|8=1@15,-10+500|9=2+500], class pairs
            assert.strictEqual(positionText('To'), '3+460|9@15,-10+500');
            assert.strictEqual(positionText('Tdo'), '3+460|8@15,-10+500|9+500');
        });

        it('goes on after the second glyph of a pair with a second value record, at the second glyph otherwise', function() {
            // -u 0061,0062,0063,0064: [5=0+450|6=1+480|7=2+460|8=3+500], b c skipped after a b, c d applied
            assert.strictEqual(positionText('abcd'), '5+450|6+480|7+460|8+500');
            // -u 0062,0063,0064: [6=0+470|7=1+460|8=2+500], b c then c d
            assert.strictEqual(positionText('bcd'), '6+470|7+460|8+500');
        });

        it('kerns across the marks a lookup ignores', function() {
            // -u 0054,0301,006F: [3=0+460|10=1+0|9=2@15,-10+500]
            assert.strictEqual(positionText('T\u{301}o'), '3+460|10+0|9@15,-10+500');
        });

        it('applies the variation deltas of the VariationIndex tables of every field', function() {
            // --variations=wght=500 -u 0054,0061: [3=0@20,20+460|5=1@-5,10+494]
            assert.strictEqual(positionText('Ta', { variation: { wght: 500 } }), '3@20,20+460|5@-5,10+494');
            // -u 0054,0061: [3=0@10,0+480|5=1+500]
            assert.strictEqual(positionText('Ta'), '3@10,0+480|5+500');
        });

        it('ignores the hinting deltas of the Device tables, like HarfBuzz in font units', function() {
            // TestPairPositioning.ttf with a Device table (format 1, from size 12 to 12, a delta of 1 pixel) for the x and
            // y placements and the x advance of A in pos A V (fontTools): -u 0041,0056 [2=0@10,20+570|4=1@-5,15+575],
            // the same with --variations=wght=300 and with --variations=wght=900; HarfBuzz applies them at a ppem only:
            // --font-ppem=12 --font-size=1000 [2=0@93,103+653|4=1@-5,15+575]
            const deviceFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
            const valueRecord = deviceFont.tables.gpos.lookups[0].subtables[0].pairSets[0][0].value1;
            for (const deviceField of ['xPlaDevice', 'yPlaDevice', 'xAdvDevice']) {
                valueRecord[deviceField] = { deltaFormat: 1, startSize: 12, endSize: 12 };
            }
            for (const variation of [undefined, { wght: 300 }, { wght: 900 }]) {
                assert.strictEqual(positionText('AV', { variation }, deviceFont), '2@10,20+570|4@-5,15+575', JSON.stringify(variation));
            }
        });

        it('applies no pair to a glyph that a format 1 subtable covers without a PairSet, like HarfBuzz', function() {
            // TestPairPositioning.ttf with the Coverage of PAIR_ALL_FIELDS (one PairSet, for A) set to A and V (fontTools),
            // saved as short-pairsets.ttf: hb-shape --no-glyph-names --cluster-level=1 short-pairsets.ttf -u <code points>
            const shortPairSetsFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
            const glyphV = shortPairSetsFont.charToGlyphIndex('V');
            shortPairSetsFont.tables.gpos.lookups[0].subtables[0].coverage.glyphs.push(glyphV);
            // -u 0041,0056: [2=0@10,20+570|4=1@-5,15+575], -u 0056,0041: [4=0+600|2=1+600]
            assert.strictEqual(positionText('AV', {}, shortPairSetsFont), '2@10,20+570|4@-5,15+575');
            assert.strictEqual(positionText('VA', {}, shortPairSetsFont), '4+600|2+600');
            // -u 0056,0041,0056: [4=0+600|2=1@10,20+570|4=2@-5,15+575], the lookup goes on at A
            assert.strictEqual(positionText('VAV', {}, shortPairSetsFont), '4+600|2@10,20+570|4@-5,15+575');
        });

        it('applies the pair adjustments of an extension lookup', function() {
            // -u 006F,0063: [9=0@5,0+485|7=1+495]
            assert.strictEqual(positionText('oc'), '9@5,0+485|7+495');
        });

        it('applies the pairs of a right-to-left run in the order of the text', function() {
            // -u 0631,0627: [11=1@0,30+240|13=0@-100,0+300], the glyphs in visual order: alef, then reh
            assert.strictEqual(positionText('\u{627}\u{631}', { rightToLeft: true, script: 'arab' }), '11@0,30+240|13@-100,0+300');
        });

        it('applies the lookups of the given features, once each', function() {
            // -u 0064,0061: [8=0+430|5=1+500], d a -70 in dist and in kern; --features=-dist,-kern [8=0+500|5=1+500]
            assert.strictEqual(positionText('da'), '8+430|5+500');
            assert.strictEqual(positionText('da', { featureTags: ['dist'] }), '8+430|5+500');
            assert.strictEqual(positionText('da', { featureTags: ['mark'] }), '8+500|5+500');
            // --features=+ss01 -u 0064,006F: [8=0+420|9=1+500]
            assert.strictEqual(positionText('do', { featureTags: ['ss01'] }), '8+420|9+500');
        });

        it('applies no GPOS lookup to hebr without a hebr script, like the Hebrew shaper of HarfBuzz', function() {
            // --script=hebr -u 0041,0056: [4=1+600|2=0+600]
            assert.strictEqual(positionText('AV', { script: 'hebr' }), '2+600|4+600');
        });

        it('computes the lookups of the features of a run once for the GPOS table', function() {
            // the language system is read only when the lookups are computed (without kern, whose kern table fallback
            // reads it at every run)
            const cachedFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
            const getLangSysTable = cachedFont.position.getLangSysTable;
            let langSysReadCount = 0;
            cachedFont.position.getLangSysTable = function(...langSysArguments) {
                langSysReadCount++;
                return getLangSysTable.apply(this, langSysArguments);
            };
            // --features=ss01 -u 0064,006F: [8=0+420|9=1+500], the d o -80 of ss01
            assert.strictEqual(positionText('do', { featureTags: ['ss01'] }, cachedFont), '8+420|9+500');
            const firstRunReadCount = langSysReadCount;
            assert.ok(firstRunReadCount > 0);
            assert.strictEqual(positionText('do', { featureTags: ['ss01'] }, cachedFont), '8+420|9+500');
            assert.strictEqual(langSysReadCount, firstRunReadCount);
        });

        it('applies a lookup added to a feature through the Layout methods after a run was positioned', function() {
            // the lookups of the features of a run are cached for the GPOS table: getLookupTables with create clears them
            const editedFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
            const [glyphD, glyphO] = ['d', 'o'].map(character => editedFont.charToGlyphIndex(character));
            // -u 0064,006F: [8=0+500|9=1+500], no ss02
            assert.strictEqual(positionText('do', { featureTags: ['ss02'] }, editedFont), '8+500|9+500');
            const [lookupTable] = editedFont.position.getLookupTables('latn', undefined, 'ss02', 2, true);
            lookupTable.subtables.push({
                posFormat: 1,
                coverage: { format: 1, glyphs: [glyphD] },
                valueFormat1: 4,
                valueFormat2: 0,
                pairSets: [[{ secondGlyph: glyphO, value1: { xAdvance: -50 } }]]
            });
            // the d o -50 of the new pair adjustment
            assert.strictEqual(positionText('do', { featureTags: ['ss02'] }, editedFont), '8+450|9+500');
        });

        describe('the required feature of the language system', function() {
            // TestPairPositioning.ttf with ss01 as the ReqFeatureIndex of the DefaultLangSys of each script and not in its
            // FeatureIndex (fontTools: ReqFeatureIndex set, FeatureIndex without ss01, saved as required.ttf)
            // hb-shape --no-glyph-names --cluster-level=1 required.ttf -u <code points>
            // the GPOS table is edited before the font shapes a text: the lookups of its features are cached for the table
            beforeEach(function() {
                pairFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
                const ss01FeatureIndex = pairFont.tables.gpos.features.findIndex(featureRecord => featureRecord.tag === 'ss01');
                for (const scriptRecord of pairFont.tables.gpos.scripts) {
                    const defaultLangSys = scriptRecord.script.defaultLangSys;
                    defaultLangSys.reqFeatureIndex = ss01FeatureIndex;
                    defaultLangSys.featureIndexes = defaultLangSys.featureIndexes.filter(featureIndex => featureIndex !== ss01FeatureIndex);
                }
            });

            after(function() {
                pairFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
            });

            it('applies its lookups whatever the features, like HarfBuzz', function() {
                // -u 0064,006F: [8=0+420|9=1+500], the d o -80 of ss01; the same with --features=-kern and --features=-ss01
                assert.strictEqual(positionText('do'), '8+420|9+500');
                assert.strictEqual(positionText('do', { featureTags: [] }), '8+420|9+500');
                // with the lookups of the features, in lookup list order: -u 0041,0056: [2=0@10,20+570|4=1@-5,15+575]
                assert.strictEqual(positionText('AV'), '2@10,20+570|4@-5,15+575');
                // --script=hebr -u 0064,006F: [9=1+500|8=0+500], no GPOS lookup applies to hebr without a hebr script
                assert.strictEqual(positionText('do', { script: 'hebr' }), '8+500|9+500');
            });

            it('ignores a required feature index past the FeatureList, like HarfBuzz', function() {
                // TestPairPositioning.ttf with ReqFeatureIndex 99 in each DefaultLangSys: -u 0064,006F: [8=0+500|9=1+500]
                // (ss01, off by default, gives nothing either way)
                for (const scriptRecord of pairFont.tables.gpos.scripts) {
                    scriptRecord.script.defaultLangSys.reqFeatureIndex = 99;
                }
                assert.strictEqual(positionText('do'), '8+500|9+500');
            });
        });

        describe('the required feature of a language system of a language', function() {
            // TestPairPositioning.ttf with ss01 as the ReqFeatureIndex of latn ROM only and not in its FeatureIndex
            // (fontTools: ReqFeatureIndex set, FeatureIndex without ss01, saved as romanian-required.ttf)
            // hb-shape --no-glyph-names --cluster-level=1 romanian-required.ttf -u <code points>
            // the GPOS table is edited before the font shapes a text: the lookups of its features are cached for the table
            before(function() {
                pairFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
                const ss01FeatureIndex = pairFont.tables.gpos.features.findIndex(featureRecord => featureRecord.tag === 'ss01');
                const latinScript = pairFont.tables.gpos.scripts.find(scriptRecord => scriptRecord.tag === 'latn').script;
                const romanianLangSys = latinScript.langSysRecords.find(langSysRecord => langSysRecord.tag === 'ROM ').langSys;
                romanianLangSys.reqFeatureIndex = ss01FeatureIndex;
                romanianLangSys.featureIndexes = romanianLangSys.featureIndexes.filter(featureIndex => featureIndex !== ss01FeatureIndex);
            });

            after(function() {
                pairFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
            });

            it('applies the required feature of the language system of the language, like HarfBuzz', function() {
                // --language=ro -u 0064,006F: [8=0+420|9=1+500], the d o -80 of ss01; the same with --features=-ss01
                assert.strictEqual(positionText('do', { language: 'ROM' }), '8+420|9+500');
                assert.strictEqual(positionText('do', { language: 'ROM', featureTags: [] }), '8+420|9+500');
                // -u 0064,006F: [8=0+500|9=1+500], the default language system has no required feature
                assert.strictEqual(positionText('do'), '8+500|9+500');
            });
        });

        describe('a GPOS table without kern feature and a kern table', function() {
            // TestPairPositioning.ttf with kern out of the FeatureIndex of every language system and the kern table
            // d a -20, A V -100 (fontTools), saved as gpos-kern-table.ttf:
            // hb-shape --no-glyph-names --cluster-level=1 gpos-kern-table.ttf -u <code points>
            // the GPOS table is edited before the font shapes a text: the lookups of its features are cached for the table
            before(function() {
                pairFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
                const kernFeatureIndex = pairFont.tables.gpos.features.findIndex(featureRecord => featureRecord.tag === 'kern');
                for (const scriptRecord of pairFont.tables.gpos.scripts) {
                    const langSystems = [scriptRecord.script.defaultLangSys, ...scriptRecord.script.langSysRecords.map(langSysRecord => langSysRecord.langSys)];
                    for (const langSystem of langSystems) {
                        langSystem.featureIndexes = langSystem.featureIndexes.filter(featureIndex => featureIndex !== kernFeatureIndex);
                    }
                }
                const [glyphA, glyphV, glyphD, glyphLowerA] = ['A', 'V', 'd', 'a'].map(character => pairFont.charToGlyphIndex(character));
                pairFont.kerningPairs = { [`${glyphD},${glyphLowerA}`]: -20, [`${glyphA},${glyphV}`]: -100 };
            });

            after(function() {
                pairFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
            });

            it('applies the GPOS lookups of the features, then the kern table, like HarfBuzz', function() {
                // -u 0064,0061: [8=0+420|5=1@-10,0+490], the d a -70 of dist and the d a -20 of the kern table
                assert.strictEqual(positionText('da'), '8+420|5@-10,0+490');
                // --features=-dist -u 0064,0061: [8=0+490|5=1@-10,0+490]
                assert.strictEqual(positionText('da', { featureTags: DEFAULT_POSITIONING_FEATURES.filter(tag => tag !== 'dist') }), '8+490|5@-10,0+490');
                // --features=-kern -u 0064,0061: [8=0+430|5=1+500]
                assert.strictEqual(positionText('da', { featureTags: DEFAULT_POSITIONING_FEATURES.filter(tag => tag !== 'kern') }), '8+430|5+500');
                // -u 0041,0056: [2=0+550|4=1@-50,0+550]
                assert.strictEqual(positionText('AV'), '2+550|4@-50,0+550');
            });
        });

        describe('the kern table', function() {
            // TestPairPositioning.ttf without GPOS, with the kern table A V +61 (fontTools), saved as odd-kern-table.ttf:
            // hb-shape --no-glyph-names --cluster-level=1 odd-kern-table.ttf -u <code points>
            before(function() {
                pairFont.tables.gpos = undefined;
                const [glyphA, glyphV] = ['A', 'V'].map(character => pairFont.charToGlyphIndex(character));
                pairFont.kerningPairs = { [`${glyphA},${glyphV}`]: 61 };
            });

            after(function() {
                pairFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
            });

            it('splits a positive odd value of a pair, half of it rounded down to the first glyph, like HarfBuzz', function() {
                // -u 0041,0056: [2=0+630|4=1@31,0+631]
                assert.strictEqual(positionText('AV'), '2+630|4@31,0+631');
            });
        });

        describe('single adjustments', function() {
            // TestSingleAdjustment.ttf, built by test/generate-single-adjustment-font.py:
            // hb-shape --no-glyph-names --cluster-level=1 --features=<features> TestSingleAdjustment.ttf -u <code points>
            let singleFont;

            beforeEach(function() {
                singleFont = parse(readFileSync('./test/fonts/TestSingleAdjustment.ttf'));
            });

            it('applies the value record of a format 1 subtable, its y advance for vertical text only', function() {
                // --features=case -u 0048: [5=0@10,20+570], pos H <10 20 -30 40>;, --features=vpal -u 0056: [7=0@0,50+600],
                // pos V <0 50 0 -100>; (HarfBuzz ValueFormat::apply_value), the y advances 0; --features=-kern: H and V +600
                assert.strictEqual(positionText('H', { featureTags: ['case'] }, singleFont), '5@10,20+570');
                assert.strictEqual(positionText('V', { featureTags: ['vpal'] }, singleFont), '7@0,50+600');
                assert.strictEqual(positionText('HV', { featureTags: [] }, singleFont), '5+600|7+600');
            });

            it('applies the value records of a right-to-left run to their glyphs, in the order of the text', function() {
                // -u 05D0,05D1: [15=1@-5,0+530|14=0@10,0+480], the glyphs in visual order: bet, then alef, pos alef
                // <10 0 -20 0>; pos bet <-5 0 30 0>; (format 2)
                assert.strictEqual(positionText('\u{5D1}\u{5D0}', { rightToLeft: true, script: 'hebr' }, singleFont), '15@-5,0+530|14@10,0+480');
            });

            it('applies the variation deltas of the VariationIndex tables of the value records of a format 2 subtable', function() {
                // --features=lfbd -u 0041,0042: [2=0@10,0+580|3=1@-5,0+510], --variations=wght=500 [2=0@20,0+560|3=1@-15,0+530],
                // --variations=wght=900 [2=0@30,0+540|3=1@-25,0+550]
                assert.strictEqual(positionText('AB', { featureTags: ['lfbd'] }, singleFont), '2@10,0+580|3@-5,0+510');
                assert.strictEqual(positionText('AB', { featureTags: ['lfbd'], variation: { wght: 500 } }, singleFont), '2@20,0+560|3@-15,0+530');
                assert.strictEqual(positionText('AB', { featureTags: ['lfbd'], variation: { wght: 900 } }, singleFont), '2@30,0+540|3@-25,0+550');
            });

            it('skips the marks out of the mark filtering set or of another mark attachment class of the lookup', function() {
                // --features=ss01 -u 0061,0301,0300: [8=0+500|13=1@0,20+0|16=2@0,10+0], the acute out of the mark filtering
                // set of the first lookup, the grave of another mark attachment class than the second one
                assert.strictEqual(positionText('a\u{301}\u{300}', { featureTags: ['ss01'] }, singleFont), '8+500|13@0,20+0|16@0,10+0');
            });

            it('applies the value record of the coverage index of a glyph in a format 2 subtable, not the next subtables', function() {
                // --features=cpsp -u 0041,0042,0043,0048: [2=0@5,0+610|3=1@-10,0+520|4=2@15,0+530|5=3@-20,0+615], not the
                // pos C <0 0 99 0>; of the second subtable
                assert.strictEqual(positionText('ABCH', { featureTags: ['cpsp'] }, singleFont), '2@5,0+610|3@-10,0+520|4@15,0+530|5@-20,0+615');
            });

            it('adds up the single adjustments of the lookups of the features', function() {
                // --features=case,cpsp -u 0048: [5=0@-10,20+585]
                assert.strictEqual(positionText('H', { featureTags: ['case', 'cpsp'] }, singleFont), '5@-10,20+585');
            });

            it('skips a glyph that the lookupFlag ignores', function() {
                // --features=palt -u 0061,0301,0061: [8=0@-20,0+450|13=1+0|8=2@-20,0+450], the acute covered and ignored
                assert.strictEqual(positionText('a\u{301}a', { featureTags: ['palt'] }, singleFont), '8@-20,0+450|13+0|8@-20,0+450');
            });

            it('applies the variation deltas of the VariationIndex tables of every field', function() {
                // --features=halt -u 004F,006F: [6=0@10,0+580|12=1@-10,5+490], --variations=wght=500
                // [6=0@20,20+560|12=1@-20,-5+470], --variations=wght=900 [6=0@30,40+540|12=1@-30,-15+450]
                assert.strictEqual(positionText('Oo', { featureTags: ['halt'] }, singleFont), '6@10,0+580|12@-10,5+490');
                assert.strictEqual(positionText('Oo', { featureTags: ['halt'], variation: { wght: 500 } }, singleFont), '6@20,20+560|12@-20,-5+470');
                assert.strictEqual(positionText('Oo', { featureTags: ['halt'], variation: { wght: 900 } }, singleFont), '6@30,40+540|12@-30,-15+450');
            });

            it('applies the single adjustments of the kern feature, of an extension lookup and of the first subtable that covers a glyph', function() {
                // -u 0062,0063,0064: [9=0+485|10=1+490|11=2+460], the b -15 of the extension lookup, the c -10 of the first
                // subtable, the d -40 of the second one; --features=-kern [9=0+500|10=1+500|11=2+500]
                assert.strictEqual(positionText('bcd', {}, singleFont), '9+485|10+490|11+460');
                assert.strictEqual(positionText('bcd', { featureTags: [] }, singleFont), '9+500|10+500|11+500');
            });

            it('goes on at the next subtable for a glyph whose coverage index is out of the value records of format 2, like HarfBuzz', function() {
                // TestSingleAdjustment.ttf with the value records of A and B only in the format 2 subtable of cpsp (fontTools),
                // saved as short-values.ttf: --features=cpsp -u 0041,0042,0043,0048 [2=0@5,0+610|3=1@-10,0+520|4=2+599|5=3+600],
                // the C +99 of the second subtable (SinglePosFormat2::apply)
                const valueRecordsSubtable = singleFont.tables.gpos.lookups[1].subtables[0];
                valueRecordsSubtable.values = valueRecordsSubtable.values.slice(0, 2);
                assert.strictEqual(positionText('ABCH', { featureTags: ['cpsp'] }, singleFont), '2@5,0+610|3@-10,0+520|4+599|5+600');
            });

            it('applies a subtable of value format 0 to the glyphs it covers, so the next subtables do not, like HarfBuzz', function() {
                // TestSingleAdjustment.ttf with the value format 0 in the first subtable of SINGLE_FIRST_SUBTABLE, pos c
                // (fontTools), saved as value-format-0.ttf: -u 0062,0063,0064 [9=0+485|10=1+500|11=2+460], not the c -40 of
                // the second subtable
                singleFont.tables.gpos.lookups[6].subtables[0].value = undefined;
                assert.strictEqual(positionText('bcd', {}, singleFont), '9+485|10+500|11+460');
            });

            it('applies a format 2 subtable of value format 0 to the glyphs it covers, so the next subtables do not, like HarfBuzz', function() {
                // TestSingleAdjustment.ttf with the value format 0 in the format 2 subtable of cpsp, pos A B C H (fontTools),
                // saved as format2-value-format-0.ttf: --features=cpsp -u 0041,0042,0043,0048 [2=0+600|3=1+500|4=2+500|5=3+600],
                // not the C +99 of the second subtable (SinglePosFormat2::apply)
                const valueRecordsSubtable = singleFont.tables.gpos.lookups[1].subtables[0];
                valueRecordsSubtable.values = valueRecordsSubtable.values.map(() => undefined);
                assert.strictEqual(positionText('ABCH', { featureTags: ['cpsp'] }, singleFont), '2+600|3+500|4+500|5+600');
            });
        });
    });

    describe('getMarkAdvanceZeroing', function() {
        // TestMarkAttachment.ttf (a mark with an advance of 100, ss01 adds 40 to it) with the script record DFLT of GSUB
        // renamed to the tag of the script (fontTools), -u 0061,0323 --features=+ss01: the advance of the mark is 0 after
        // GPOS (default shaper), 40 before it (USE, Myanmar), 140 never (Indic, Khmer, Hangul)
        it('sets the advance of the marks to 0 after GPOS with the default, Arabic, Hebrew and Thai shapers of HarfBuzz', function() {
            for (const [scriptTags, gsubScriptTag] of [[['latn'], 'latn'], [['arab'], 'arab'], [['hebr'], 'DFLT'], [['thai'], 'thai'], [['cyrl'], undefined]]) {
                assert.strictEqual(getMarkAdvanceZeroing(scriptTags, gsubScriptTag), MarkAdvanceZeroing.AFTER_POSITIONING, scriptTags.join());
            }
        });

        it('keeps the advance of the marks with the Indic shaper of HarfBuzz, before GPOS with the USE shaper (a tag of the third version)', function() {
            // --script=Deva with deva or dev2 in GSUB, or no GSUB: 140; with dev3: 40
            const devanagariTags = ['dev3', 'dev2', 'deva'];
            assert.strictEqual(getMarkAdvanceZeroing(devanagariTags, 'deva'), MarkAdvanceZeroing.NONE);
            assert.strictEqual(getMarkAdvanceZeroing(devanagariTags, 'dev2'), MarkAdvanceZeroing.NONE);
            assert.strictEqual(getMarkAdvanceZeroing(devanagariTags, undefined), MarkAdvanceZeroing.NONE);
            assert.strictEqual(getMarkAdvanceZeroing(devanagariTags, 'dev3'), MarkAdvanceZeroing.BEFORE_POSITIONING);
            assert.strictEqual(getMarkAdvanceZeroing(['bng2'], 'bng2'), MarkAdvanceZeroing.NONE);
        });

        it('sets the advance of the marks to 0 before GPOS with the USE and Myanmar shapers of HarfBuzz', function() {
            // --script=Gonm with gonm in GSUB or no GSUB: 40, --script=Mymr with mym2 or no GSUB: 40, with mymr: 0
            assert.strictEqual(getMarkAdvanceZeroing(['gonm'], 'gonm'), MarkAdvanceZeroing.BEFORE_POSITIONING);
            assert.strictEqual(getMarkAdvanceZeroing(['gonm'], undefined), MarkAdvanceZeroing.BEFORE_POSITIONING);
            assert.strictEqual(getMarkAdvanceZeroing(['nko '], 'nko '), MarkAdvanceZeroing.BEFORE_POSITIONING);
            assert.strictEqual(getMarkAdvanceZeroing(['mym2', 'mymr'], 'mym2'), MarkAdvanceZeroing.BEFORE_POSITIONING);
            assert.strictEqual(getMarkAdvanceZeroing(['mym2', 'mymr'], undefined), MarkAdvanceZeroing.BEFORE_POSITIONING);
            assert.strictEqual(getMarkAdvanceZeroing(['mym2', 'mymr'], 'mymr'), MarkAdvanceZeroing.AFTER_POSITIONING);
        });

        it('takes the default shaper of HarfBuzz for an Indic, USE or Myanmar run whose GSUB script is DFLT or latn', function() {
            // --script=Deva, Gonm and Mymr with DFLT and latn in GSUB: 0
            for (const scriptTags of [['dev3', 'dev2', 'deva'], ['gonm'], ['mym2', 'mymr']]) {
                for (const gsubScriptTag of ['DFLT', 'latn']) {
                    assert.strictEqual(getMarkAdvanceZeroing(scriptTags, gsubScriptTag), MarkAdvanceZeroing.AFTER_POSITIONING, `${scriptTags} ${gsubScriptTag}`);
                }
            }
            // not dflt, the tag that some fonts use by mistake: --script=Deva with dflt in GSUB: 140
            assert.strictEqual(getMarkAdvanceZeroing(['dev3', 'dev2', 'deva'], 'dflt'), MarkAdvanceZeroing.NONE);
        });

        it('keeps the advance of the marks with the Khmer and Hangul shapers of HarfBuzz, whatever the GSUB script', function() {
            // --script=Khmr and Hang with DFLT and latn in GSUB, or no GSUB: 140
            for (const scriptTag of ['khmr', 'hang']) {
                for (const gsubScriptTag of [scriptTag, 'DFLT', undefined]) {
                    assert.strictEqual(getMarkAdvanceZeroing([scriptTag], gsubScriptTag), MarkAdvanceZeroing.NONE, `${scriptTag} ${gsubScriptTag}`);
                }
            }
        });
    });

    // the values of MarkLigPosFormat1::apply of HarfBuzz (hb-ot-layout-gpos-table.hh): with lig_id, mark_id and mark_comp
    // the ligatureId of the ligature and of the mark and the component of the mark, comp_count the components of the
    // ligature in the subtable, comp_index = min(comp_count, mark_comp) - 1 when lig_id && lig_id == mark_id &&
    // mark_comp > 0, comp_count - 1 otherwise
    describe('getMarkLigatureComponentIndex', function() {
        const ligatureId = Symbol('ligature');
        const ligatureProperties = { ligatureId, ligatureComponentCount: 3 };

        it('gives the component the ligature substitution recorded for a mark of the ligature', function() {
            assert.strictEqual(getMarkLigatureComponentIndex({ ligatureId, ligatureComponent: 1 }, ligatureProperties, 3), 0);
            assert.strictEqual(getMarkLigatureComponentIndex({ ligatureId, ligatureComponent: 2 }, ligatureProperties, 3), 1);
        });

        it('gives the last component of the subtable for a component past it', function() {
            assert.strictEqual(getMarkLigatureComponentIndex({ ligatureId, ligatureComponent: 3 }, ligatureProperties, 2), 1);
        });

        it('gives the last component for a mark of another ligature, without component or without ligature properties', function() {
            assert.strictEqual(getMarkLigatureComponentIndex({ ligatureId: Symbol('other'), ligatureComponent: 1 }, ligatureProperties, 3), 2);
            assert.strictEqual(getMarkLigatureComponentIndex({ ligatureId }, ligatureProperties, 3), 2);
            assert.strictEqual(getMarkLigatureComponentIndex(undefined, ligatureProperties, 3), 2);
            // a ligature without ligatureId (of a base glyph and marks): a mark without one does not belong to it
            assert.strictEqual(getMarkLigatureComponentIndex({ ligatureComponent: 1 }, undefined, 3), 2);
        });
    });

    // the values of MarkMarkPosFormat1::apply of HarfBuzz: with id1, id2, comp1 and comp2 the ligatureIds and the
    // components of the two marks, they attach when id1 == id2 and (id1 == 0 or comp1 == comp2), or when id1 != id2
    // and ((id1 > 0 and comp1 == 0) or (id2 > 0 and comp2 == 0)), one of them a ligature
    describe('areMarksOfSameGlyph', function() {
        const ligatureId = Symbol('ligature');

        it('takes two marks of no ligature as marks of the same glyph', function() {
            assert.strictEqual(areMarksOfSameGlyph(undefined, undefined), true);
        });

        it('takes two marks of a ligature as marks of the same glyph when they follow the same component', function() {
            assert.strictEqual(areMarksOfSameGlyph({ ligatureId, ligatureComponent: 2 }, { ligatureId, ligatureComponent: 2 }), true);
            assert.strictEqual(areMarksOfSameGlyph({ ligatureId, ligatureComponent: 2 }, { ligatureId, ligatureComponent: 1 }), false);
        });

        it('does not take marks of different ligatures as marks of the same glyph, unless one of them is a ligature', function() {
            const otherLigatureId = Symbol('other');
            assert.strictEqual(areMarksOfSameGlyph({ ligatureId, ligatureComponent: 1 }, { ligatureId: otherLigatureId, ligatureComponent: 1 }), false);
            assert.strictEqual(areMarksOfSameGlyph({ ligatureId, ligatureComponent: 1 }, undefined), false);
            assert.strictEqual(areMarksOfSameGlyph({ ligatureId, ligatureComponentCount: 2 }, undefined), true);
            assert.strictEqual(areMarksOfSameGlyph(undefined, { ligatureId, ligatureComponentCount: 2 }), true);
            assert.strictEqual(areMarksOfSameGlyph({ ligatureId: otherLigatureId, ligatureComponent: 1 }, { ligatureId, ligatureComponentCount: 2 }), true);
        });
    });

    // TestMarkAttachment.ttf, built by test/generate-mark-attachment-font.py:
    // hb-shape --no-glyph-names --cluster-level=1 [--features=<features>] TestMarkAttachment.ttf -u <code points>
    describe('the mark and cursive attachments', function() {
        let markFont;

        beforeEach(function() {
            markFont = parse(readFileSync('./test/fonts/TestMarkAttachment.ttf'));
        });

        // position the glyphs of a text as one run of TestMarkAttachment.ttf (see positionGlyphs)
        function positionMarkText(text, runOptions) {
            return positionTextGlyphs(markFont, text, runOptions);
        }

        it('attaches a mark to the base before it, at their anchors of the class of the mark', function() {
            // -u 0061,0301: [2=0+500|10=1@-250,20+0], the acute at 0 500 on the a at 250 520, moved back by the advance of a
            assert.strictEqual(positionMarkText('a\u{301}'), '2+500|10@-250,20+0');
            // -u 0062,0323: [3=0+500|12=1+0], b has no anchor for the class of the dot below
            assert.strictEqual(positionMarkText('b\u{323}'), '3+500|12+0');
        });

        it('attaches a mark to the glyph before it that is not a mark, past the marks between them', function() {
            // --features=-mkmk -u 0061,0323,0301: [2=0+500|12=1@-300,30+0|10=2@-250,20+0], the acute on the a
            assert.strictEqual(positionMarkText('a\u{323}\u{301}', { featureTags: ['mark'] }), '2+500|12@-300,30+0|10@-250,20+0');
        });

        it('attaches a mark to the glyph before it that is not a mark whatever the lookupFlag of its lookup, like HarfBuzz', function() {
            // MARK_TO_BASE_IGNORE_LIGATURES (ss04, lookupflag IgnoreLigatures): --features=-mark,+ss04 -u 0061,0066,0069,0301
            // [2=0+500|9=1+550|10=3+0], the ligature f_i before the acute, which the lookup does not cover, is not
            // skipped; -u 0061,0301 [2=0+500|10=1@-250,400+0]
            const ligatureGlyphIndexes = [markFont.charToGlyphIndex('a'), markFont.nameToGlyphIndex('f_i'), markFont.charToGlyphIndex('\u{301}')];
            assert.strictEqual(positionGlyphs(markFont, ligatureGlyphIndexes, { featureTags: ['ss04'] }), '2+500|9+550|10+0');
            assert.strictEqual(positionMarkText('a\u{301}', { featureTags: ['ss04'] }), '2+500|10@-250,400+0');
        });

        it('attaches the marks of a long run to the base before them', function() {
            // --features=-mkmk -u 0061 followed by 3000 times 0301: [2=0+500|10=1@-250,20+0|...|10=3000@-250,20+0]
            const shape = positionMarkText('a' + '\u{301}'.repeat(3000), { featureTags: ['mark'] });
            assert.strictEqual(shape, ['2+500'].concat(Array(3000).fill('10@-250,20+0')).join('|'));
        });

        it('attaches a mark whose mark record has no anchor at the anchor 0 0, like HarfBuzz', function() {
            // TestMarkAttachment.ttf with the MarkAnchor of acutecomb in MARK_TO_BASE set to None (fontTools), a NULL
            // offset: -u 0061,0301 [2=0+500|10=1@-250,520+0]
            const subtable = markFont.tables.gpos.lookups[0].subtables[0];
            const acuteCoverageIndex = markFont.position.getCoverageIndex(subtable.markCoverage, markFont.charToGlyphIndex('\u{301}'));
            subtable.markArray[acuteCoverageIndex].markAnchor = undefined;
            assert.strictEqual(positionMarkText('a\u{301}'), '2+500|10@-250,520+0');
        });

        it('skips the marks of another mark attachment class or out of the mark filtering set of the lookup', function() {
            // MARK_TO_BASE_ATTACHMENT_TYPE (ss13, MarkAttachmentType [acutecomb]): --features=-mark,-mkmk,+ss13
            // -u 0061,0301 [2=0+500|10=1@-250,400+0], -u 0061,0300 [2=0+500|11=1+0]; the same with MARK_TO_BASE_FILTERED
            // (ss14, UseMarkFilteringSet [acutecomb]); MARK_TO_LIGATURE_ATTACHMENT_TYPE (ss15, MarkAttachmentType
            // [acutecomb]): --features=-mark,-mkmk,+ss15 -u 0066,0069,0301 [9=0+550|10=2@-130,400+0], -u 0066,0069,0300
            // [9=0+550|11=2+0]
            const ligature = markFont.nameToGlyphIndex('f_i');
            for (const featureTag of ['ss13', 'ss14']) {
                assert.strictEqual(positionMarkText('a\u{301}', { featureTags: [featureTag] }), '2+500|10@-250,400+0');
                assert.strictEqual(positionMarkText('a\u{300}', { featureTags: [featureTag] }), '2+500|11+0');
            }
            assert.strictEqual(positionGlyphs(markFont, [ligature, markFont.charToGlyphIndex('\u{301}')], { featureTags: ['ss15'] }), '9+550|10@-130,400+0');
            assert.strictEqual(positionGlyphs(markFont, [ligature, markFont.charToGlyphIndex('\u{300}')], { featureTags: ['ss15'] }), '9+550|11+0');
        });

        it('does not attach the marks that a mark-to-base or mark-to-ligature lookup ignores as marks without the glyph classes of GDEF, like HarfBuzz', function() {
            // TestMarkAttachment.ttf with the GlyphClassDef of GDEF removed (fontTools), whose marks HarfBuzz takes from
            // Unicode, without a mark attachment class: --features=-mark,-mkmk,+ss13 -u 0061,0301 [2=0+500|10=1+0],
            // --features=-mark,-mkmk,+ss14 -u 0061,0301 [2=0+500|10=1@-250,400+0] (the mark glyph set of GDEF covers the
            // acute) and -u 0061,0300 [2=0+500|11=1+0], --features=-mark,-mkmk,+ss15 -u 0066,0069,0301 [9=0+550|10=2+0];
            // the mark-to-base lookup without lookupFlag, --features=-mkmk -u 0061,0301 [2=0+500|10=1@-250,20+0]
            const ligature = markFont.nameToGlyphIndex('f_i');
            markFont.tables.gdef.classDef = undefined;
            assert.strictEqual(positionMarkText('a\u{301}', { featureTags: ['ss13'] }), '2+500|10+0');
            assert.strictEqual(positionMarkText('a\u{301}', { featureTags: ['ss14'] }), '2+500|10@-250,400+0');
            assert.strictEqual(positionMarkText('a\u{300}', { featureTags: ['ss14'] }), '2+500|11+0');
            assert.strictEqual(positionGlyphs(markFont, [ligature, markFont.charToGlyphIndex('\u{301}')], { featureTags: ['ss15'] }), '9+550|10+0');
            assert.strictEqual(positionMarkText('a\u{301}', { featureTags: ['mark'] }), '2+500|10@-250,20+0');
            // a GDEF table that the layout ignores, like HarfBuzz the GDEF of the fonts of its blocklist: TestMarkAttachment.ttf
            // without GDEF (fontTools), --features=-mark,-mkmk,+ss14 -u 0061,0301 [2=0+500|10=1+0]
            markFont.isGdefIgnoredByLayout = true;
            assert.strictEqual(positionMarkText('a\u{301}', { featureTags: ['ss14'] }), '2+500|10+0');
        });

        itFailsUntilFixed('attaches a mark after a default ignorable to the base before it, like HarfBuzz',
            'getMarkBaseIndexes (src/position.mjs): the glyph of the soft hyphen U+00AD, which the font has not, is the base ' +
            'of the acute, .notdef drawn with its advance, which MARK_TO_BASE does not cover, so the acute is not attached; ' +
            'HarfBuzz skips the default ignorables but U+200D when it looks for the base of a mark and hides them with the ' +
            'space glyph and an advance of 0 (hb_ot_hide_default_ignorables)',
            function() {
                // -u 0061,00AD,0301: [2=0+500|1=1+0|10=2@-250,20+0], the acute on the a, the same with U+200C and U+034F;
                // -u 0061,200D,0301: [2=0+500|1=1+0|10=2+0], the acute not attached
                assertShape(shapeText(markFont, 'a\u{AD}\u{301}'), {
                    glyphs: [2, 1, 10], clusters: [0, 1, 2], advances: [500, 0, 0], offsets: [[0, 0], [0, 0], [-250, 20]]
                });
            });

        itFailsUntilFixed('attaches the glyph of a spacing character that a mark-to-base lookup ignoring marks covers, without the glyph classes of GDEF, like HarfBuzz',
            'isMarkIgnoredWithoutGlyphClasses (src/layout.mjs): every glyph the subtable covers is taken as a mark, where HarfBuzz ' +
            'takes only the glyphs of nonspacing marks (Mn), so the acute of U+00B4 is ignored by the MarkAttachmentType of the lookup',
            function() {
                // TestMarkAttachment.ttf with the GlyphClassDef of GDEF removed and U+00B4 mapped to acutecomb (fontTools):
                // --features=-mark,-mkmk,+ss13 -u 0061,00B4 [2=0+500|10=1@-250,400+0], a base glyph for HarfBuzz, which no
                // lookupFlag skips (-u 0061,0301 [2=0+500|10=1+0])
                markFont.tables.gdef.classDef = undefined;
                markFont.tables.cmap.glyphIndexMap[0xB4] = markFont.nameToGlyphIndex('acutecomb');
                assertShape(shapeText(markFont, 'a\u{B4}', { features: { mark: false, mkmk: false, ss13: true } }), {
                    glyphs: [2, 10], clusters: [0, 1], advances: [500, 0], offsets: [[0, 0], [-250, 400]]
                });
            });

        it('applies the variation deltas of the VariationIndex tables of the anchors', function() {
            // -u 0062,0301: [3=0+500|10=1@-240,200+0], --variations=wght=500 [3=0+500|10=1@-220,230+0],
            // --variations=wght=900 [3=0+500|10=1@-200,260+0]
            assert.strictEqual(positionMarkText('b\u{301}'), '3+500|10@-240,200+0');
            assert.strictEqual(positionMarkText('b\u{301}', { variation: { wght: 500 } }), '3+500|10@-220,230+0');
            assert.strictEqual(positionMarkText('b\u{301}', { variation: { wght: 900 } }), '3+500|10@-200,260+0');
        });

        it('takes the coordinates of an anchor of format 2, without its contour point, like HarfBuzz without hinting', function() {
            // -u 0069,0301: [5=0+250|10=1@-125,100+0], the anchor 125 600 contourpoint 2 of i
            assert.strictEqual(positionMarkText('i\u{301}'), '5+250|10@-125,100+0');
        });

        it('attaches a mark to the mark before it of the same base, at their anchors', function() {
            // -u 0061,0301,0301: [2=0+500|10=1@-250,20+0|10=2@-250,270+0], -u 0061,0301,0300: [2=0+500|10=1@-250,20+0|11=2@-250,270+0]
            assert.strictEqual(positionMarkText('a\u{301}\u{301}'), '2+500|10@-250,20+0|10@-250,270+0');
            assert.strictEqual(positionMarkText('a\u{301}\u{300}'), '2+500|10@-250,20+0|11@-250,270+0');
            // -u 0061,0301,0300,0301: [2=0+500|10=1@-250,20+0|11=2@-250,270+0|10=3@-250,20+0], the second acute after the
            // grave, which mkmk does not cover as a base mark
            assert.strictEqual(positionMarkText('a\u{301}\u{300}\u{301}'), '2+500|10@-250,20+0|11@-250,270+0|10@-250,20+0');
            // --variations=wght=500 -u 0062,0301,0301: [3=0+500|10=1@-220,230+0|10=2@-220,480+0], the variable anchor of b
            assert.strictEqual(positionMarkText('b\u{301}\u{301}', { variation: { wght: 500 } }), '3+500|10@-220,230+0|10@-220,480+0');
        });

        it('attaches a mark to the mark before it that the mark filtering set of the lookup does not skip', function() {
            // MARK_TO_MARK_FILTERED (ss02, UseMarkFilteringSet [acutecomb]): --features=-mkmk,+ss02 -u 0061,0301,0300,0301
            // [2=0+500|10=1@-250,20+0|11=2@-250,20+0|10=3@-250,270+0], the second acute on the first one, past the grave
            assert.strictEqual(positionMarkText('a\u{301}\u{300}\u{301}', { featureTags: ['mark', 'ss02'] }), '2+500|10@-250,20+0|11@-250,20+0|10@-250,270+0');
        });

        it('attaches a mark to the mark before it that the mark attachment type of the lookup does not skip', function() {
            // MARK_TO_MARK_ATTACHMENT_TYPE (ss08, MarkAttachmentType [acutecomb]): --features=-mkmk,+ss08
            // -u 0061,0301,0300,0301 [2=0+500|10=1@-250,20+0|11=2@-250,20+0|10=3@-250,270+0]
            assert.strictEqual(positionMarkText('a\u{301}\u{300}\u{301}', { featureTags: ['mark', 'ss08'] }), '2+500|10@-250,20+0|11@-250,20+0|10@-250,270+0');
        });

        it('attaches a mark to a mark whatever the IgnoreBaseGlyphs of the lookup, like HarfBuzz', function() {
            // MARK_TO_MARK_IGNORE_BASES (ss06, IgnoreBaseGlyphs): --features=-mkmk,+ss06 -u 0061,0301,0062,0301
            // [2=0+450|10=1@-200,20+0|3=2+500|10=3@-240,200+0], the acute of b on b, not on the acute of a past b
            const featureTags = DEFAULT_POSITIONING_FEATURES.filter(featureTag => featureTag !== 'mkmk').concat('ss06');
            assert.strictEqual(positionMarkText('a\u{301}b\u{301}', { featureTags }), '2+450|10@-200,20+0|3+500|10@-240,200+0');
        });

        it('attaches a mark to a mark whatever the IgnoreLigatures of the lookup, like HarfBuzz', function() {
            // MARK_TO_MARK_IGNORE_LIGATURES (ss18, IgnoreLigatures): --features=-mark,-mkmk,+ss18 -u 0061,0301,0066,0069,0301
            // [2=0+500|10=1+0|9=2+550|10=4+0], the ligature f_i before the second acute is not skipped, so the acute is
            // not attached to the acute of a past it
            const acute = markFont.charToGlyphIndex('\u{301}');
            const ligatureGlyphIndexes = [markFont.charToGlyphIndex('a'), acute, markFont.nameToGlyphIndex('f_i'), acute];
            assert.strictEqual(positionGlyphs(markFont, ligatureGlyphIndexes, { featureTags: ['ss18'] }), '2+500|10+0|9+550|10+0');
        });

        it('attaches the marks at the start of a run to no base, and the second one to the first one, like HarfBuzz', function() {
            // -u 0301,0301,0061: [10=0+0|10=1@0,250+0|2=2+500]
            assert.strictEqual(positionMarkText('\u{301}\u{301}a'), '10+0|10@0,250+0|2+500');
        });

        it('attaches a glyph that is not a mark to the mark before it whatever the IgnoreMarks of the mark-to-mark lookup, like HarfBuzz', function() {
            // TestMarkAttachment.ttf with MARK_TO_MARK (mkmk) set to IgnoreMarks and b added to its Mark1Coverage with the
            // mark record of the acute (fontTools): --features=-kern -u 0061,0301,0062
            // [2=0+500|10=1@-250,20+0|3=2@-250,270+500], b on the acute, which the lookup does not skip
            const lookup = markFont.tables.gpos.lookups[2];
            const subtable = lookup.subtables[0];
            const glyphB = markFont.charToGlyphIndex('b');
            const markGlyphIndexes = ['\u{301}', '\u{300}'].map(char => markFont.charToGlyphIndex(char));
            const markRecords = markGlyphIndexes.map(glyphIndex => subtable.mark1Array[markFont.position.getCoverageIndex(subtable.mark1Coverage, glyphIndex)]);
            lookup.lookupFlag = 0x0008;
            subtable.mark1Coverage = { format: 1, glyphs: [glyphB, ...markGlyphIndexes] };
            subtable.mark1Array = [markRecords[0], ...markRecords];
            assert.strictEqual(positionMarkText('a\u{301}b', { featureTags: ['mark', 'mkmk'] }), '2+500|10@-250,20+0|3@-250,270+500');
        });

        it('does not attach a mark to a glyph before it that is not a GDEF mark, even when the mark-to-mark subtable covers it, like HarfBuzz', function() {
            // MARK_TO_MARK_BASE_GLYPH (ss19), whose Mark2Coverage covers a: --features=-mark,-mkmk,+ss19 -u 0061,0301
            // [2=0+500|10=1+0]
            assert.strictEqual(positionMarkText('a\u{301}', { featureTags: ['ss19'] }), '2+500|10+0');
        });

        it('moves an attached mark back over the advances of the glyphs from its base, after the advances of the marks are set to 0', function() {
            // -u 0061,0323,0301: [2=0+500|12=1@-300,30+0|10=2@-250,20+0], the dot below loses its advance of 100
            assert.strictEqual(positionMarkText('a\u{323}\u{301}', { featureTags: ['mark'] }), '2+500|12@-300,30+0|10@-250,20+0');
            // -u 0061,0301,0062: [2=0+450|10=1@-200,20+0|3=2+500], the a b -50 of kern (IgnoreMarks) shortens the advance
            // of a, which the acute follows
            assert.strictEqual(positionMarkText('a\u{301}b'), '2+450|10@-200,20+0|3+500');
        });

        it('sets the advance of the marks to 0 before the lookups or never, as the shaper of the run', function() {
            // TestMarkAttachment.ttf with the script record DFLT of GSUB renamed gonm (fontTools): --script=Gonm
            // --features=+ss01 -u 0061,0323,0301 [2=0+500|12=1@-300,30+40|10=2@-290,20+0], the 40 of ss01 after the advance of
            // the dot below is set to 0 (the USE shaper of HarfBuzz)
            const features = DEFAULT_POSITIONING_FEATURES.concat('ss01');
            assert.strictEqual(positionMarkText('a\u{323}\u{301}', { featureTags: features, markAdvanceZeroing: MarkAdvanceZeroing.BEFORE_POSITIONING }),
                '2+500|12@-300,30+40|10@-290,20+0');
            // --script=Gonm -u 0062,0323: [3=0+500|12=1+0], the dot below, which b does not attach, keeps its x offset in a
            // font with a GPOS table
            assert.strictEqual(positionMarkText('b\u{323}', { markAdvanceZeroing: MarkAdvanceZeroing.BEFORE_POSITIONING }), '3+500|12+0');
            // --script=Khmr -u 0061,0323,0301: [2=0+500|12=1@-300,30+100|10=2@-350,20+0], --script=Khmr --features=+ss01
            // -u 0061,0323,0062: [2=0+450|12=1@-250,30+140|3=2+500]
            assert.strictEqual(positionMarkText('a\u{323}\u{301}', { markAdvanceZeroing: MarkAdvanceZeroing.NONE }), '2+500|12@-300,30+100|10@-350,20+0');
            assert.strictEqual(positionMarkText('a\u{323}b', { featureTags: features, markAdvanceZeroing: MarkAdvanceZeroing.NONE }), '2+450|12@-250,30+140|3+500');
            assert.throws(() => positionMarkText('a', { markAdvanceZeroing: 'late' }), /Unknown mark advance zeroing: late/);
        });

        it('moves the x offset of a mark back by the advance it loses in a font without GPOS, in a left-to-right run only, like HarfBuzz', function() {
            // TestMarkAttachment.ttf without GPOS and with the script record DFLT of GSUB renamed gonm (fontTools): --script=Gonm
            // -u 0061,0323 [2=0+500|12=1@-100,0+0]; renamed adlm: --script=Adlm -u 0061,0323 [12=1+0|2=0+500], the USE
            // shaper, which has no fallback mark positioning
            delete markFont.tables.gpos;
            assert.strictEqual(positionMarkText('a\u{323}', { markAdvanceZeroing: MarkAdvanceZeroing.BEFORE_POSITIONING }), '2+500|12@-100,0+0');
            assert.strictEqual(positionMarkText('\u{323}a', { rightToLeft: true, script: 'arab', markAdvanceZeroing: MarkAdvanceZeroing.BEFORE_POSITIONING }),
                '12+0|2+500');
        });

        it('moves an attached mark of a right-to-left run forward over the advances of the glyphs from its base', function() {
            // TestMarkAttachment.ttf with the script record DFLT of GSUB renamed adlm (fontTools): --script=Adlm
            // --features=+ss01 -u 0061,0323,0301 [10=2@290,20+0|12=1@240,30+40|2=0+500], the glyphs in visual order
            const features = DEFAULT_POSITIONING_FEATURES.concat('ss01');
            assert.strictEqual(
                positionMarkText('\u{301}\u{323}a', { rightToLeft: true, script: 'arab', featureTags: features, markAdvanceZeroing: MarkAdvanceZeroing.BEFORE_POSITIONING }),
                '10@290,20+0|12@240,30+40|2+500'
            );
            // -u 0628,064E: [14=1@260,30+0|13=0+500]
            assert.strictEqual(positionMarkText('\u{64E}\u{628}', { rightToLeft: true, script: 'arab' }), '14@260,30+0|13+500');
        });

        it('joins the exit anchor of a glyph to the entry anchor of the next one, the glyph after attached to the glyph before', function() {
            // CURSIVE_LEFT_TO_RIGHT (curs): -u 0078,0079,007A [6=0+450|7=1@-30,100+440|8=2@-20,0+480]: the advance of x ends
            // at its exit anchor, y starts at its entry anchor and is attached to x, 100 higher; z is attached to y,
            // whose exit anchor is 60 lower, 40 under its entry anchor (the Device tables of z do not apply)
            assert.strictEqual(positionMarkText('xyz'), '6+450|7@-30,100+440|8@-20,0+480');
            // TestMarkAttachment.ttf with the script record DFLT of GSUB renamed adlm (fontTools): --script=Adlm
            // -u 0078,0079,007A [8=2+20|7=1@-470,100+-440|6=0@-450,0+50], in a right-to-left run the glyph after starts at
            // its entry anchor and the glyph before ends at its exit anchor
            assert.strictEqual(positionMarkText('zyx', { rightToLeft: true, script: 'arab' }), '8+20|7@-470,100+-440|6@-450,0+50');
        });

        it('applies the variation deltas of the VariationIndex tables of the cursive anchors', function() {
            // CURSIVE_VARIABLE (ss07): --features=-curs,+ss07 -u 0078,0079 [6=0+450|7=1@-30,100+470],
            // --variations=wght=900 [6=0+450|7=1@-90,180+410]
            assert.strictEqual(positionMarkText('xy', { featureTags: ['ss07'] }), '6+450|7@-30,100+470');
            assert.strictEqual(positionMarkText('xy', { featureTags: ['ss07'], variation: { wght: 900 } }), '6+450|7@-90,180+410');
        });

        it('applies the cursive attachments of an extension lookup', function() {
            // TestMarkAttachment.ttf with CURSIVE_LEFT_TO_RIGHT in an extension lookup (useExtension of feaLib): -u
            // 0078,0079,007A [6=0+450|7=1@-30,100+440|8=2@-20,0+480]
            const lookups = markFont.tables.gpos.lookups;
            lookups[6] = extensionLookup(lookups[6].subtables.map(extension => ({ lookupType: 3, extension })));
            assert.strictEqual(positionMarkText('xyz'), '6+450|7@-30,100+440|8@-20,0+480');
        });

        it('attaches the glyph before to the glyph after with the RightToLeft flag, the last glyph on the baseline', function() {
            // CURSIVE_RIGHT_TO_LEFT (curs, RightToLeft and IgnoreMarks): -u 0628,0628,0628 [13=2+480|13=1@-20,30+460|13=0@-20,60+480]
            assert.strictEqual(positionMarkText('\u{628}\u{628}\u{628}', { rightToLeft: true, script: 'arab' }), '13+480|13@-20,30+460|13@-20,60+480');
            // -u 0628,064E,0628: [13=2+480|14=1@240,60+0|13=0@-20,30+480], across the fatha, which follows its beh
            assert.strictEqual(positionMarkText('\u{628}\u{64E}\u{628}', { rightToLeft: true, script: 'arab' }), '13+480|14@240,60+0|13@-20,30+480');
            // SINGLE_BEH (ss09, before CURSIVE_RIGHT_TO_LEFT): --features=+ss09 -u 0628,0628 [13=1@15,0+495|13=0@-20,30+465],
            // the advance of the glyph after ends at its entry anchor moved by its x offset
            const featureTags = DEFAULT_POSITIONING_FEATURES.concat('ss09');
            assert.strictEqual(positionMarkText('\u{628}\u{628}', { rightToLeft: true, script: 'arab', featureTags }), '13@15,0+495|13@-20,30+465');
        });

        it('turns a cursive attachment of a glyph the other way round when it gets a new parent, like HarfBuzz', function() {
            // CURSIVE_REVERSED (ss03, RightToLeft) attaches x to y and y to z, then CURSIVE_LEFT_TO_RIGHT (curs) y to x and z
            // to y: --features=+ss03 -u 0078,0079,007A [6=0+450|7=1@-30,100+440|8=2@-20,0+480], -u 0078,0079
            // [6=0+450|7=1@-30,100+470]
            const featureTags = DEFAULT_POSITIONING_FEATURES.concat('ss03');
            assert.strictEqual(positionMarkText('xyz', { featureTags }), '6+450|7@-30,100+440|8@-20,0+480');
            assert.strictEqual(positionMarkText('xy', { featureTags }), '6+450|7@-30,100+470');
            // CURSIVE_REVERSED alone: --features=-curs,+ss03 -u 0078,0079,007A [6=0@0,50+450|7=1@-30,100+440|8=2@-20,0+480],
            // z on the baseline, y 100 higher, x 50 under y
            assert.strictEqual(positionMarkText('xyz', { featureTags: ['ss03'] }), '6@0,50+450|7@-30,100+440|8@-20,0+480');
            // CURSIVE_X_Y (ss05) after CURSIVE_REVERSED joins x and y only, so z keeps its attachment to y, turned the other
            // way round: --features=-curs,+ss03,+ss05 -u 0078,0079,007A [6=0+450|7=1@-30,70+440|8=2@-20,-30+480]
            assert.strictEqual(positionMarkText('xyz', { featureTags: ['ss03', 'ss05'] }), '6+450|7@-30,70+440|8@-20,-30+480');
        });

        it('turns a long chain of cursive attachments the other way round, like HarfBuzz', function() {
            // --features=+ss03 -u 0078, 10000 times 0079, 007A: [6=0+450|7=1@-30,100+440|7=2@-30,40+440|...
            // |7=10000@-30,-599840+440|8=10001@-20,-599940+480], each y 60 under the one before it
            const length = 10000;
            const featureTags = DEFAULT_POSITIONING_FEATURES.concat('ss03');
            const expectedGlyphs = ['6+450'];
            for (let i = 0; i < length; i++) {
                expectedGlyphs.push(`7@-30,${100 - 60 * i}+440`);
            }
            expectedGlyphs.push(`8@-20,${-60 * (length - 1)}+480`);
            assert.strictEqual(positionMarkText('x' + 'y'.repeat(length) + 'z', { featureTags }), expectedGlyphs.join('|'));
        });

        it('adds up the y offsets of a chain of cursive attachments up to 64 glyphs, like HarfBuzz', function() {
            // seventy beh: -u 0628,...,0628 [13=69+480|13=68@-20,30+460|...|13=0@-20,1950+480]: each beh 30 higher than the
            // next one, the chain from the first beh added up over 64 glyphs (HB_MAX_NESTING_LEVEL), so the beh 64 does not
            // get the offset of the beh 65 and the ones before it start again from 30
            const shape = positionMarkText('\u{628}'.repeat(70), { rightToLeft: true, script: 'arab' }).split('|');
            const yOffsets = shape.map(glyph => glyph.includes('@') ? Number(glyph.split(',')[1].split('+')[0]) : 0);
            const expectedYOffsets = shape.map((glyph, visualIndex) => {
                const textIndex = 69 - visualIndex;
                return textIndex >= 65 ? 30 * (69 - textIndex) : 30 * (65 - textIndex);
            });
            assert.deepStrictEqual(yOffsets, expectedYOffsets);
            assert.strictEqual(shape[69], '13@-20,1950+480');
        });

        // TestMarkAttachment.ttf with a copy of the first subtable of a lookup, whose coverage and records keep fewer
        // glyphs, prepended to the lookup (fontTools): the first subtable that applies at a glyph applies, like HarfBuzz
        describe('a subtable that does not apply', function() {
            // prepend to a lookup a copy of its first subtable with the given fields
            function prependSubtable(lookupIndex, fields) {
                const subtables = markFont.tables.gpos.lookups[lookupIndex].subtables;
                subtables.unshift({ ...subtables[0], ...fields });
            }

            // the coverage of one glyph
            function createCoverage(glyphIndex) {
                return { format: 1, glyphs: [glyphIndex] };
            }

            // the record of a glyph in a list of records by coverage index
            function getCoverageRecord(coverage, records, glyphIndex) {
                return records[markFont.position.getCoverageIndex(coverage, glyphIndex)];
            }

            it('lets the next subtable attach a mark to a base that the mark-to-base subtable does not cover', function() {
                // a first MARK_TO_BASE subtable of b only: --features=-mkmk -u 0061,0301 [2=0+500|10=1@-250,20+0]
                const subtable = markFont.tables.gpos.lookups[0].subtables[0];
                const glyphB = markFont.charToGlyphIndex('b');
                prependSubtable(0, {
                    baseCoverage: createCoverage(glyphB),
                    baseArray: [getCoverageRecord(subtable.baseCoverage, subtable.baseArray, glyphB)]
                });
                assert.strictEqual(positionMarkText('a\u{301}', { featureTags: ['mark'] }), '2+500|10@-250,20+0');
            });

            it('lets the next subtable attach a mark to a base without an anchor for the class of the mark', function() {
                // a first MARK_TO_BASE subtable of a only, without its anchor for @TOP: --features=-mkmk -u 0061,0301
                // [2=0+500|10=1@-250,20+0]
                const subtable = markFont.tables.gpos.lookups[0].subtables[0];
                const glyphA = markFont.charToGlyphIndex('a');
                const acuteRecord = getCoverageRecord(subtable.markCoverage, subtable.markArray, markFont.charToGlyphIndex('\u{301}'));
                const anchorsWithoutTop = getCoverageRecord(subtable.baseCoverage, subtable.baseArray, glyphA).slice();
                anchorsWithoutTop[acuteRecord.markClass] = undefined;
                prependSubtable(0, { baseCoverage: createCoverage(glyphA), baseArray: [anchorsWithoutTop] });
                assert.strictEqual(positionMarkText('a\u{301}', { featureTags: ['mark'] }), '2+500|10@-250,20+0');
            });

            it('lets the next subtable attach a mark to a ligature that the mark-to-ligature subtable does not cover', function() {
                // a first MARK_TO_LIGATURE subtable of a_f_i only: -u 0066,0069,0301 [9=0+550|10=2@-130,200+0]
                const subtable = markFont.tables.gpos.lookups[1].subtables[0];
                const ligature = markFont.nameToGlyphIndex('a_f_i');
                prependSubtable(1, {
                    ligatureCoverage: createCoverage(ligature),
                    ligatureArray: [getCoverageRecord(subtable.ligatureCoverage, subtable.ligatureArray, ligature)]
                });
                const glyphIndexes = [markFont.nameToGlyphIndex('f_i'), markFont.charToGlyphIndex('\u{301}')];
                assert.strictEqual(positionGlyphs(markFont, glyphIndexes, { featureTags: ['mark'] }), '9+550|10@-130,200+0');
            });

            it('lets the next subtable attach a mark to a mark that the mark-to-mark subtable does not cover', function() {
                // a first MARK_TO_MARK subtable whose Mark2Coverage has the grave only: -u 0061,0301,0301
                // [2=0+500|10=1@-250,20+0|10=2@-250,270+0]
                const subtable = markFont.tables.gpos.lookups[2].subtables[0];
                prependSubtable(2, { mark2Coverage: createCoverage(markFont.charToGlyphIndex('\u{300}')), mark2Array: [subtable.mark2Array[0]] });
                assert.strictEqual(positionMarkText('a\u{301}\u{301}'), '2+500|10@-250,20+0|10@-250,270+0');
            });

            it('lets the next subtable join a glyph to the glyph before it without an exit anchor in the cursive subtable', function() {
                // a first CURSIVE_LEFT_TO_RIGHT subtable of y only: -u 0078,0079 [6=0+450|7=1@-30,100+470]
                const subtable = markFont.tables.gpos.lookups[6].subtables[0];
                const glyphY = markFont.charToGlyphIndex('y');
                prependSubtable(6, {
                    coverage: createCoverage(glyphY),
                    entryExitRecords: [getCoverageRecord(subtable.coverage, subtable.entryExitRecords, glyphY)]
                });
                assert.strictEqual(positionMarkText('xy'), '6+450|7@-30,100+470');
            });
        });

        describe('of ligatures', function() {
            // the glyphs of font.shape, with the GSUB ligature of liga (lookupflag IgnoreMarks; sub f i by f_i;)
            it('attaches a mark after a ligature to its last component', function() {
                // -u 0066,0069,0301: [9=0+550|10=2@-130,200+0], at the 420 700 of the second component
                assertShape(shapeText(markFont, 'fi\u{301}'), { glyphs: [9, 10], clusters: [0, 2], advances: [550, 0], offsets: [[0, 0], [-130, 200]] });
                // -u 0066,0069,0323: [9=0+550|12=2+0], the second component has no anchor for the dot below
                assertShape(shapeText(markFont, 'fi\u{323}'), { glyphs: [9, 12], clusters: [0, 2], advances: [550, 0], offsets: [[0, 0], [0, 0]] });
            });

            it('attaches a mark that the ligature substitution skipped to the component it follows', function() {
                // -u 0066,0301,0069: [9=0+550|10=0@-400,200+0], at the 150 700 of the first component
                assertShape(shapeText(markFont, 'f\u{301}i'), { glyphs: [9, 10], clusters: [0, 0], advances: [550, 0], offsets: [[0, 0], [-400, 200]] });
                // -u 0066,0323,0069: [9=0+550|12=0@-450,30+0]
                assertShape(shapeText(markFont, 'f\u{323}i'), { glyphs: [9, 12], clusters: [0, 0], advances: [550, 0], offsets: [[0, 0], [-450, 30]] });
            });

            it('does not attach a mark to a mark of another component of the ligature', function() {
                // -u 0066,0301,0069,0300: [9=0+550|10=0@-400,200+0|11=3@-130,200+0], the grave on the second component, not
                // on the acute of the first one
                assertShape(shapeText(markFont, 'f\u{301}i\u{300}'), {
                    glyphs: [9, 10, 11], clusters: [0, 0, 3], advances: [550, 0, 0], offsets: [[0, 0], [-400, 200], [-130, 200]]
                });
            });

            it('does not attach a mark to a mark of another component of the same ligature', function() {
                // LIGA_F_I: sub f i i by f_i; -u 0066,0301,0069,0301,0069: [9=0+550|10=0@-400,200+0|10=0@-130,200+0], the
                // second acute on the second component, not on the first acute
                assertShape(shapeText(markFont, 'f\u{301}i\u{301}i'), {
                    glyphs: [9, 10, 10], clusters: [0, 0, 0], advances: [550, 0, 0], offsets: [[0, 0], [-400, 200], [-130, 200]]
                });
            });

            it('attaches a mark that the ligature of a contextual rule skipped to the component it follows', function() {
                // CONTEXTUAL_LIGA_F_I (ss11, IgnoreMarks): sub f' lookup LIGA_F_I i'; --features=-liga,+ss11
                // -u 0066,0301,0069,0300: [9=0+550|10=0@-400,200+0|11=3@-130,200+0]
                assertShape(shapeText(markFont, 'f\u{301}i\u{300}', { features: { liga: false, ss11: true } }), {
                    glyphs: [9, 10, 11], clusters: [0, 0, 3], advances: [550, 0, 0], offsets: [[0, 0], [-400, 200], [-130, 200]]
                });
            });

            it('attaches a mark after a component that is a ligature at its component of the new ligature', function() {
                // LIGA_A_F_I (ss12, IgnoreMarks): sub a f_i by a_f_i; after sub f i by f_i; --features=+ss12
                // -u 0061,0066,0301,0069,0300: [15=0+1000|10=0@-400,200+0|11=4@-150,200+0], the acute on the second
                // component of a_f_i (the f of f_i, at 600 700), the grave after the ligature on its last component
                assertShape(shapeText(markFont, 'af\u{301}i\u{300}', { features: { ss12: true } }), {
                    glyphs: [15, 10, 11], clusters: [0, 0, 4], advances: [1000, 0, 0], offsets: [[0, 0], [-400, 200], [-150, 200]]
                });
            });

            it('attaches a mark after a component that is a ligature, of none of its components, to the last component of that ligature', function() {
                // LIGA_F_I_A (ss16, IgnoreMarks): sub f_i a by a_f_i; after sub f i by f_i; --features=+ss16
                // -u 0066,0069,0301,0061: [15=0+1000|10=0@-400,200+0], the acute after f_i on the second component of a_f_i
                // (the i of f_i, at 600 700)
                assertShape(shapeText(markFont, 'fi\u{301}a', { features: { ss16: true } }), {
                    glyphs: [15, 10], clusters: [0, 0], advances: [1000, 0], offsets: [[0, 0], [-400, 200]]
                });
            });

            it('attaches a mark of a multiple substitution that a ligature skipped at the component its index in the substitution gives it, like HarfBuzz', function() {
                // MULTIPLE_Z_MARKS (ss20): sub z by dotbelowcomb acutecomb; after sub f i by f_i; then LIGA_F_I_A (ss16,
                // IgnoreMarks): sub f_i a by a_f_i; --features=+ss20,+ss16 fiza: [15=0+1000|12=0+0|10=0@-750,200+0], the
                // acute, the second glyph of the substitution, on the first component of a_f_i (at 250 700), the dot below
                // on its last component (no anchor)
                assertShape(shapeText(markFont, 'fiza', { features: { ss20: true, ss16: true } }), {
                    glyphs: [15, 12, 10], clusters: [0, 0, 0], advances: [1000, 0, 0], offsets: [[0, 0], [0, 0], [-750, 200]]
                });
                // --features=+ss20 fiza: [9=0+550|12=2+0|10=2@-130,200+0|2=3+500], the acute after f_i on its last component
                assertShape(shapeText(markFont, 'fiza', { features: { ss20: true } }), {
                    glyphs: [9, 12, 10, 2], clusters: [0, 2, 2, 3], advances: [550, 0, 0, 500], offsets: [[0, 0], [0, 0], [-130, 200], [0, 0]]
                });
            });

            it('does not attach a ligature of marks to a mark of a component of a ligature, like HarfBuzz', function() {
                // LIGA_MARKS (ss17): sub dotbelowcomb gravecomb by acutecomb; --features=+ss17 -u 0066,0301,0069,0323,0300:
                // [9=0+550|10=0@-400,200+0|10=3@-130,200+0], the ligature of marks takes no ligature of its own, so mkmk
                // does not attach it to the acute of the first component of f_i: it stays on the last component
                assertShape(shapeText(markFont, 'f\u{301}i\u{323}\u{300}', { features: { ss17: true } }), {
                    glyphs: [9, 10, 10], clusters: [0, 0, 3], advances: [550, 0, 0], offsets: [[0, 0], [-400, 200], [-130, 200]]
                });
            });

            it('does not attach a mark to a ligature without anchors, like HarfBuzz', function() {
                // TestMarkAttachment.ttf with the LigatureAttach of f_i in MARK_TO_LIGATURE set to None, or without
                // ComponentRecord (fontTools): -u 0066,0069,0301 [9=0+550|10=2+0], -u 0066,0301,0069 [9=0+550|10=0+0]
                const ligatureArray = markFont.tables.gpos.lookups[1].subtables[0].ligatureArray;
                for (const componentAnchors of [undefined, []]) {
                    ligatureArray[0] = componentAnchors;
                    assertShape(shapeText(markFont, 'fi\u{301}'), { glyphs: [9, 10], clusters: [0, 2], advances: [550, 0], offsets: [[0, 0], [0, 0]] });
                    assertShape(shapeText(markFont, 'f\u{301}i'), { glyphs: [9, 10], clusters: [0, 0], advances: [550, 0], offsets: [[0, 0], [0, 0]] });
                }
            });

            it('attaches the marks without the ligature as usual', function() {
                // --features=-liga -u 0066,0301,0069: [4=0+300|10=1+0|5=2+250], f has no anchor
                assertShape(shapeText(markFont, 'f\u{301}i', { features: { liga: false } }), {
                    glyphs: [4, 10, 5], clusters: [0, 1, 2], advances: [300, 0, 250], offsets: [[0, 0], [0, 0], [0, 0]]
                });
                // --features=-liga -u 0066,0069,0301: [4=0+300|5=1+250|10=2@-125,100+0], on the i
                assertShape(shapeText(markFont, 'fi\u{301}', { features: { liga: false } }), {
                    glyphs: [4, 5, 10], clusters: [0, 1, 2], advances: [300, 250, 0], offsets: [[0, 0], [0, 0], [-125, 100]]
                });
            });
        });

        itFailsUntilFixed('attaches a mark after the second glyph of a multiple substitution that the subtable does not cover to the first glyph, like HarfBuzz',
            'applyMarkToBaseAttachment (src/position.mjs): the base of the mark is the glyph before it, the x of the substitution, ' +
            'which MARK_TO_BASE does not cover, so the mark is not attached (https://github.com/harfbuzz/harfbuzz/issues/740)',
            function() {
                // MULTIPLE_Z (ss10): sub z by a x; --features=+ss10 -u 007A,0301: [2=0+500|6=0+500|10=1@-750,20+0], the acute
                // on the a
                assertShape(shapeText(markFont, 'z\u{301}', { features: { ss10: true } }), {
                    glyphs: [2, 6, 10], clusters: [0, 0, 1], advances: [500, 500, 0], offsets: [[0, 0], [0, 0], [-750, 20]]
                });
            });
    });

    describe('the mark and cursive attachments of real fonts', function() {
        // hb-shape --no-glyph-names --cluster-level=1 <font> -u <code points>
        it('places the marks of a variable Latin font at a variation, with the deltas of its anchors', function() {
            // Roboto-VF-gsub-chaining-subset.ttf --language=en --variations=wght=750,wdth=80 -u 006A,0301,0301:
            // [25=0+559|17=1@156,-25+0|17=2@156,351+0], the dotless j of ccmp and two acutes (mark, then mkmk); -u
            // 006E,0323,0301: [36=0+1038|17=2@-69,0+0], the ligature of n and the dot below, then the acute
            const robotoFont = loadFont('Roboto-VF-gsub-chaining-subset.ttf');
            const variation = { wght: 750, wdth: 80 };
            assertShape(shapeText(robotoFont, 'j\u{301}\u{301}', { variation }), {
                glyphs: [25, 17, 17], clusters: [0, 1, 2], advances: [559, 0, 0], offsets: [[0, 0], [156, -25], [156, 351]]
            });
            assertShape(shapeText(robotoFont, 'n\u{323}\u{301}', { variation }), {
                glyphs: [36, 17], clusters: [0, 2], advances: [1038, 0], offsets: [[0, 0], [-69, 0]]
            });
        });

        it('places the marks of a variable Thai font at the default location and at a variation', function() {
            // NotoSansThaiLooped-VF-gsub-chaining-subset.ttf -u 0E01,0E34,0E49: [1=0+616|8=1@-7,0+0|6=2@-6,-18+0], the
            // mai tho on the sara i (mkmk); --variations=wght=700,wdth=70: [1=0+508|8=1@-6,0+0|6=2@-6,-19+0]
            const thaiFont = loadFont('NotoSansThaiLooped-VF-gsub-chaining-subset.ttf');
            assertShape(shapeText(thaiFont, '\u{E01}\u{E34}\u{E49}'), {
                glyphs: [1, 8, 6], clusters: [0, 1, 2], advances: [616, 0, 0], offsets: [[0, 0], [-7, 0], [-6, -18]]
            });
            assertShape(shapeText(thaiFont, '\u{E01}\u{E34}\u{E49}', { variation: { wght: 700, wdth: 70 } }), {
                glyphs: [1, 8, 6], clusters: [0, 1, 2], advances: [508, 0, 0], offsets: [[0, 0], [-6, 0], [-6, -19]]
            });
            // NotoSansThai-Medium-Testing-v1.ttf -u 0E1B,0E37,0E49: [343=0+614|464=1@-1,0+0|444=2@-208,0+0], the mai tho
            // moved left of the tall ascender of po pla
            const notoThaiFont = loadFont('../NotoSansThai-Medium-Testing-v1.ttf');
            assertShape(shapeText(notoThaiFont, '\u{E1B}\u{E37}\u{E49}'), {
                glyphs: [343, 464, 444], clusters: [0, 1, 2], advances: [614, 0, 0], offsets: [[0, 0], [-1, 0], [-208, 0]]
            });
        });

        it('places the marks of the script fonts Pacifico and Playwrite', function() {
            // Pacifico-Regular-calt-kern-subset.ttf -u 0061,0301: [18=0+458|44=1@149,0+0]
            assertShape(shapeText(loadFont('Pacifico-Regular-calt-kern-subset.ttf'), 'a\u{301}'), {
                glyphs: [18, 44], clusters: [0, 1], advances: [458, 0], offsets: [[0, 0], [149, 0]]
            });
            // PlaywriteUSTrad-VF-calt-subset.ttf -u 0065,0301,006C,0075: [20=0+444|25=0+0|8=0@-267,0+0|32=2+394|18=2+0|16=3+671],
            // the acute after the connector of e (calt); its cluster is 1 in the fork, which does not compose e and the
            // acute (see playwriteCursive.spec.mjs)
            assertShape(shapeText(loadFont('PlaywriteUSTrad-VF-calt-subset.ttf'), 'e\u{301}lu'), {
                glyphs: [20, 25, 8, 32, 18, 16], clusters: [0, 0, 1, 2, 2, 3], advances: [444, 0, 0, 394, 0, 671],
                offsets: [[0, 0], [0, 0], [-267, 0], [0, 0], [0, 0], [0, 0]]
            });
        });

        it('places the marks of Arabic fonts, on a lam alef ligature at the component of each mark', function() {
            // Changa-Regular.ttf -u 0644,064E,0627: [773=0@375,180+0|458=0+635], the fatha on the lam of the ligature; -u
            // 0644,0627,064E: [773=2@57,75+0|458=0+635], on the alef
            const changaFont = loadFont('../Changa-Regular.ttf');
            assertShape(shapeText(changaFont, '\u{644}\u{64E}\u{627}'), {
                glyphs: [773, 458], clusters: [0, 0], advances: [0, 635], offsets: [[375, 180], [0, 0]]
            });
            assertShape(shapeText(changaFont, '\u{644}\u{627}\u{64E}'), {
                glyphs: [773, 458], clusters: [2, 0], advances: [0, 635], offsets: [[57, 75], [0, 0]]
            });
            // -u 0628,064E,0633,0645: [408=3+655|343=2+926|773=1@63,0+0|294=0+320], the cursive attachment of curs
            // (RightToLeft, IgnoreMarks) across the fatha
            assertShape(shapeText(changaFont, '\u{628}\u{64E}\u{633}\u{645}'), {
                glyphs: [408, 343, 773, 294], clusters: [3, 2, 1, 0], advances: [655, 926, 0, 320], offsets: [[0, 0], [0, 0], [63, 0], [0, 0]]
            });
            // Scheherazade-Bold.ttf --shapers=ot --features=-kern -u 0628,064E,0628,064E:
            // [1075=3@607,-393+0|609=2+1498|1075=1@85,-93+0|932=0+439], the fathas follow the cursive y offsets of the beh
            assertShape(shapeText(loadFont('../Scheherazade-Bold.ttf'), '\u{628}\u{64E}\u{628}\u{64E}', { kerning: false }), {
                glyphs: [1075, 609, 1075, 932], clusters: [3, 2, 1, 0], advances: [0, 1498, 0, 439], offsets: [[607, -393], [0, 0], [85, -93], [0, 0]]
            });
        });

        it('joins the cursive Arabic presentation forms from right to left, like HarfBuzz', function() {
            // Changa-Regular.ttf -u FEDB,FE98,FE8E,FE8F: [0=3+600|276=2+280|301=1+320|394=0@-1,0+701], the forms of
            // Arabic Presentation Forms-B joined by curs in a right-to-left run; -u FE92,FE92,FE92:
            // [293=2+320|293=1+320|293=0+320], an advance of 960
            const changaFont = loadFont('../Changa-Regular.ttf');
            assertShape(shapeText(changaFont, '\u{FEDB}\u{FE98}\u{FE8E}\u{FE8F}'), {
                glyphs: [0, 276, 301, 394], clusters: [3, 2, 1, 0], advances: [600, 280, 320, 701], offsets: [[0, 0], [0, 0], [0, 0], [-1, 0]]
            });
            assertShape(shapeText(changaFont, '\u{FE92}'.repeat(3)), {
                glyphs: [293, 293, 293], clusters: [2, 1, 0], advances: [320, 320, 320], offsets: [[0, 0], [0, 0], [0, 0]]
            });
            assert.strictEqual(changaFont.getAdvanceWidth('\u{FE92}'.repeat(3), changaFont.unitsPerEm), 960);
        });
    });

    describe('the single adjustments of real fonts', function() {
        // hb-shape --no-glyph-names --cluster-level=1 <font> -u <code points>
        let cidKeyedFont;
        let trackingFont;
        let abrilFont;

        before(function() {
            cidKeyedFont = parse(readFileSync('./test/fonts/regression/TestCFF1-CIDKeyed-subset.otf'));
            abrilFont = parse(readFileSync('./test/fonts/AbrilFatface-Regular.otf'));
        });

        beforeEach(function() {
            trackingFont = parse(readFileSync('./test/fonts/TestTracking3.ttf'));
        });

        it('applies the palt and vpal of a CJK font, its format 2 subtables, to the full width glyphs of fwid', function() {
            // TestCFF1-CIDKeyed-subset.otf, --features=fwid -u 0041,0056,004F,4E00: [13=0+1000|15=1+1000|14=2+1000|11=3+1000]
            const fullWidth = { glyphs: [13, 15, 14, 11], clusters: [0, 1, 2, 3] };
            assertShape(shapeText(cidKeyedFont, 'AVO\u{4E00}', { features: { fwid: true } }),
                { ...fullWidth, advances: [1000, 1000, 1000, 1000], offsets: [[0, 0], [0, 0], [0, 0], [0, 0]] }, 'fwid');
            // --features=fwid,palt: [13=0@-107,0+776|15=1@-96,0+809|14=2@-60,0+880|11=3+1000]
            assertShape(shapeText(cidKeyedFont, 'AVO\u{4E00}', { features: { fwid: true, palt: true } }),
                { ...fullWidth, advances: [776, 809, 880, 1000], offsets: [[-107, 0], [-96, 0], [-60, 0], [0, 0]] }, 'fwid palt');
            // --features=fwid,palt,vpal: [13=0@-107,42+776|15=1@-96,27+809|14=2@-60,43+880|11=3@0,100+1000], the y
            // placements of vpal without its y advances
            const features = { fwid: true, palt: true, vpal: true };
            assertShape(shapeText(cidKeyedFont, 'AVO\u{4E00}', { features }),
                { ...fullWidth, advances: [776, 809, 880, 1000], offsets: [[-107, 42], [-96, 27], [-60, 43], [0, 100]] }, 'fwid palt vpal');
            assert.deepStrictEqual(cidKeyedFont.shape('AVO\u{4E00}', { features }).map(({ yAdvance }) => yAdvance), [0, 0, 0, 0]);
        });

        it('applies the GPOS vert of a CJK font, a format 1 subtable with x and y placements', function() {
            // TestCFF1-CIDKeyed-subset.otf, --features=vert -u 31B4: [10=0@800,1000+600], the y advance 0; -u 31B4: [10=0+600]
            assertShape(shapeText(cidKeyedFont, '\u{31B4}', { features: { vert: true } }),
                { glyphs: [10], clusters: [0], advances: [600], offsets: [[800, 1000]] });
            assert.strictEqual(cidKeyedFont.shape('\u{31B4}', { features: { vert: true } })[0].yAdvance, 0);
        });

        it('applies the case of a Latin font with its GSUB substitutions', function() {
            // AbrilFatface-Regular.otf, --features=case -u 0028,0048,0029,002D,005B,0040,005D:
            // [77=0@0,40+351|27=1+749|78=2@0,40+351|132=3+352|75=4@0,40+329|19=5+879|76=6@0,40+328]
            assertShape(shapeText(abrilFont, '(H)-[@]', { features: { case: true } }), {
                glyphs: [77, 27, 78, 132, 75, 19, 76],
                clusters: [0, 1, 2, 3, 4, 5, 6],
                advances: [351, 749, 351, 352, 329, 879, 328],
                offsets: [[0, 40], [0, 0], [0, 40], [0, 0], [0, 40], [0, 0], [0, 40]]
            });
        });

        it('applies the variation deltas of the VariationIndex tables of the trak lookups of a variable font', function() {
            // TestTracking3.ttf with the trak feature (its required feature) of its single adjustment lookups 1, 2 and 3 only,
            // extension lookups of format 1 subtables with VariationIndex tables for the x placement and the x advance; lookup
            // 0, a chained context, left out (fontTools), saved as trak-single.ttf: -u 0041,0056,0054,006F,0020,0061 with the
            // kern table pairs A V -152 and T o -113
            trackingFont.tables.gpos.features[0].feature.lookupListIndexes = [1, 2, 3];
            const glyphs = { glyphs: [36, 57, 55, 82, 3, 68], clusters: [0, 1, 2, 3, 4, 5] };
            // [36=0+1290|57=1@-76,0+1290|55=2+1137|82=3@-113,0+1026|3=4+569|68=5+1139]
            assertShape(shapeText(trackingFont, 'AVTo a'), {
                ...glyphs,
                advances: [1290, 1290, 1137, 1026, 569, 1139],
                offsets: [[0, 0], [-76, 0], [0, 0], [-113, 0], [0, 0], [0, 0]]
            }, 'default');
            // --variations=TRAK=1: [36=0@-409,0+2518|57=1@-485,0+2518|55=2@-409,0+2365|82=3@-522,0+2254|3=4@-409,0+1797|68=5@-409,0+2367]
            assertShape(shapeText(trackingFont, 'AVTo a', { variation: { TRAK: 1 } }), {
                ...glyphs,
                advances: [2518, 2518, 2365, 2254, 1797, 2367],
                offsets: [[-409, 0], [-485, 0], [-409, 0], [-522, 0], [-409, 0], [-409, 0]]
            }, 'TRAK 1');
            // --variations=TRAK=-0.3: [36=0@31,0+1136|57=1@-45,0+1136|55=2@31,0+983|82=3@-82,0+872|3=4@31,0+415|68=5@31,0+985]
            assertShape(shapeText(trackingFont, 'AVTo a', { variation: { TRAK: -0.3 } }), {
                ...glyphs,
                advances: [1136, 1136, 983, 872, 415, 985],
                offsets: [[31, 0], [-45, 0], [31, 0], [-82, 0], [31, 0], [31, 0]]
            }, 'TRAK -0.3');
            // --variations=TRAK=0.5,TRKS=1: the space of lookup 1, [36=0@-204,0+1905|57=1@-280,0+1905|55=2@-204,0+1752|
            // 82=3@-317,0+1641|3=4@-2252,0+3232|68=5@-204,0+1754]
            assertShape(shapeText(trackingFont, 'AVTo a', { variation: { TRAK: 0.5, TRKS: 1 } }), {
                ...glyphs,
                advances: [1905, 1905, 1752, 1641, 3232, 1754],
                offsets: [[-204, 0], [-280, 0], [-204, 0], [-317, 0], [-2252, 0], [-204, 0]]
            }, 'TRAK 0.5 TRKS 1');
        });
    });

    // TestContextualPositioning.ttf, built by test/generate-contextual-positioning-font.py: each feature ss01 to ss20 and
    // cv01 to cv05 has one contextual lookup, the generator lists them; the references are
    // hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature> TestContextualPositioning.ttf -u <code points>
    // (glyphs: A 2, T 3, V 4, a 5, b 6, c 7, d 8, e 9, o 12, x 13, acutecomb 14, alef 15, bet 16, f_i 17, gravecomb 18)
    describe('the contextual positionings', function() {
        let contextualFont;

        before(function() {
            contextualFont = parse(readFileSync('./test/fonts/TestContextualPositioning.ttf'));
        });

        // position the glyphs of a text as one run with the lookups of one feature (see positionGlyphs)
        function positionContextualText(text, featureTag, runOptions) {
            return positionTextGlyphs(contextualFont, text, { featureTags: [featureTag], ...runOptions });
        }

        it('applies the lookup records of the first glyph rule that matches (lookup type 7, format 1), then goes on after its input', function() {
            // pos a' lookup TIGHTEN b' lookup WIDEN; pos a' lookup SHIFT_UP c'; pos a' lookup WIDEN b' c';
            // -u 0061,0062: [5=0+460|6=1@10,0+525], -u 0061,0063: [5=0@0,30+500|7=1+500], -u 0061,0064: [5=0+500|8=1+500]
            assert.strictEqual(positionContextualText('ab', 'ss01'), '5+460|6@10,0+525');
            assert.strictEqual(positionContextualText('ac', 'ss01'), '5@0,30+500|7+500');
            assert.strictEqual(positionContextualText('ad', 'ss01'), '5+500|8+500');
            // -u 0061,0062,0063: [5=0+460|6=1@10,0+525|7=2+500], the first rule wins
            assert.strictEqual(positionContextualText('abc', 'ss01'), '5+460|6@10,0+525|7+500');
            // -u 0061,0062,0061,0063: [5=0+460|6=1@10,0+525|5=2@0,30+500|7=3+500]
            assert.strictEqual(positionContextualText('abac', 'ss01'), '5+460|6@10,0+525|5@0,30+500|7+500');
        });

        it('applies the lookup records of the class rules of the class of the glyph (lookup type 7, format 2)', function() {
            // pos [a b]' lookup TIGHTEN [c d]'; pos [c d]' [a b]' lookup SHIFT_UP; pos [e o]' lookup WIDEN [e o]' lookup WIDEN;
            // -u 0061,0063: [5=0+460|7=1+500], -u 0064,0062: [8=0+500|6=1@0,30+500], -u 0065,006F: [9=0@10,0+525|12=1@10,0+525]
            assert.strictEqual(positionContextualText('ac', 'ss02'), '5+460|7+500');
            assert.strictEqual(positionContextualText('db', 'ss02'), '8+500|6@0,30+500');
            assert.strictEqual(positionContextualText('eo', 'ss02'), '9@10,0+525|12@10,0+525');
            // -u 006F,006F,0065: [12=0@10,0+525|12=1@10,0+525|9=2+500], -u 0061,0065: [5=0+500|9=1+500]
            assert.strictEqual(positionContextualText('ooe', 'ss02'), '12@10,0+525|12@10,0+525|9+500');
            assert.strictEqual(positionContextualText('ae', 'ss02'), '5+500|9+500');
        });

        it('applies the lookup records of the coverage rule (lookup type 7, format 3)', function() {
            // pos [A T]' lookup WIDEN [V o]' lookup TIGHTEN;
            // -u 0041,0056: [2=0@10,0+625|4=1+560], -u 0054,006F: [3=0@10,0+625|12=1+460], -u 0041,0061: [2=0+600|5=1+500]
            assert.strictEqual(positionContextualText('AV', 'ss03'), '2@10,0+625|4+560');
            assert.strictEqual(positionContextualText('To', 'ss03'), '3@10,0+625|12+460');
            assert.strictEqual(positionContextualText('Aa', 'ss03'), '2+600|5+500');
        });

        it('applies the lookup records of the first chained glyph rule that matches (lookup type 8, format 1)', function() {
            // pos T a' lookup TIGHTEN b' x; pos a' lookup SHIFT_UP x;
            // -u 0054,0061,0062,0078: [3=0+600|5=1+460|6=2+500|13=3+500], -u 0061,0062,0078: [5=0+500|6=1+500|13=2+500]
            assert.strictEqual(positionContextualText('Tabx', 'ss04'), '3+600|5+460|6+500|13+500');
            assert.strictEqual(positionContextualText('abx', 'ss04'), '5+500|6+500|13+500');
            // -u 0054,0061,0062: [3=0+600|5=1+500|6=2+500], -u 0054,0061,0078: [3=0+600|5=1@0,30+500|13=2+500]
            assert.strictEqual(positionContextualText('Tab', 'ss04'), '3+600|5+500|6+500');
            assert.strictEqual(positionContextualText('Tax', 'ss04'), '3+600|5@0,30+500|13+500');
        });

        it('applies the lookup records of the chained class rules of the input class of the glyph (lookup type 8, format 2)', function() {
            // pos [T V] [a o]' lookup TIGHTEN [b d]; pos [a o]' lookup SHIFT_UP [c e];
            // -u 0054,0061,0062: [3=0+600|5=1+460|6=2+500], -u 0056,006F,0064: [4=0+600|12=1+460|8=2+500]
            assert.strictEqual(positionContextualText('Tab', 'ss05'), '3+600|5+460|6+500');
            assert.strictEqual(positionContextualText('Vod', 'ss05'), '4+600|12+460|8+500');
            // -u 0061,0062: [5=0+500|6=1+500], -u 006F,0065: [12=0@0,30+500|9=1+500]
            assert.strictEqual(positionContextualText('ab', 'ss05'), '5+500|6+500');
            assert.strictEqual(positionContextualText('oe', 'ss05'), '12@0,30+500|9+500');
        });

        it('applies the lookup records of the chained coverage rule (lookup type 8, format 3)', function() {
            // pos [A T] [a o]' lookup WIDEN [b c]' [e x];
            // -u 0041,0061,0062,0065: [2=0+600|5=1@10,0+525|6=2+500|9=3+500], -u 0054,006F,0063,0078: [3=0+600|12=1@10,0+525|7=2+500|13=3+500]
            assert.strictEqual(positionContextualText('Aabe', 'ss06'), '2+600|5@10,0+525|6+500|9+500');
            assert.strictEqual(positionContextualText('Tocx', 'ss06'), '3+600|12@10,0+525|7+500|13+500');
            // -u 0061,0062,0065: [5=0+500|6=1+500|9=2+500], -u 0041,0061,0062: [2=0+600|5=1+500|6=2+500]
            assert.strictEqual(positionContextualText('abe', 'ss06'), '5+500|6+500|9+500');
            assert.strictEqual(positionContextualText('Aab', 'ss06'), '2+600|5+500|6+500');
        });

        it('matches the backtrack, the input and the lookahead on the glyphs the lookupFlag does not ignore', function() {
            // pos T o' lookup TIGHTEN x; with IgnoreMarks (ss07), without (ss08)
            // ss07 -u 0054,0301,006F,0301,0078: [3=0+600|14=1+0|12=2+460|14=3+0|13=4+500]
            assert.strictEqual(positionContextualText('T\u{301}o\u{301}x', 'ss07'), '3+600|14+0|12+460|14+0|13+500');
            // ss08 -u 0054,0301,006F,0301,0078: [3=0+600|14=1+0|12=2+500|14=3+0|13=4+500], -u 0054,006F,0078: [3=0+600|12=1+460|13=2+500]
            assert.strictEqual(positionContextualText('T\u{301}o\u{301}x', 'ss08'), '3+600|14+0|12+500|14+0|13+500');
            assert.strictEqual(positionContextualText('Tox', 'ss08'), '3+600|12+460|13+500');
        });

        it('matches the input of a contextual positioning (lookup type 7) on the glyphs its lookupFlag does not ignore', function() {
            // pos [T V]' lookup TIGHTEN [o a]'; with IgnoreMarks, -u 0054,0301,006F: [3=0+560|14=1+0|12=2+500],
            // -u 0054,006F: [3=0+560|12=1+500]
            assert.strictEqual(positionContextualText('T\u{301}o', 'ss18'), '3+560|14+0|12+500');
            assert.strictEqual(positionContextualText('To', 'ss18'), '3+560|12+500');
        });

        it('matches across the marks out of the mark filtering set or of another mark attachment class of the lookup', function() {
            // pos T o' lookup TIGHTEN x; with UseMarkFilteringSet [gravecomb] (ss19) and MarkAttachmentType [gravecomb] (ss20)
            // ss19 -u 0054,006F,0301,0078: [3=0+600|12=1+460|14=2+0|13=3+500]
            assert.strictEqual(positionContextualText('To\u{301}x', 'ss19'), '3+600|12+460|14+0|13+500');
            // ss19 -u 0054,006F,0300,0078: [3=0+600|12=1+500|18=2+0|13=3+500]
            assert.strictEqual(positionContextualText('To\u{300}x', 'ss19'), '3+600|12+500|18+0|13+500');
            // ss20 -u 0054,006F,0301,0078: [3=0+600|12=1+460|14=2+0|13=3+500]
            assert.strictEqual(positionContextualText('To\u{301}x', 'ss20'), '3+600|12+460|14+0|13+500');
            // ss20 -u 0054,0300,006F,0078: [3=0+600|18=1+0|12=2+500|13=3+500]
            assert.strictEqual(positionContextualText('T\u{300}ox', 'ss20'), '3+600|18+0|12+500|13+500');
        });

        it('pairs a nested pair adjustment with the next glyph its own lookupFlag does not ignore, past the input, like HarfBuzz', function() {
            // pos T' lookup PAIR_IGNORE_MARKS; pos A' lookup PAIR_IGNORE_MARKS; PAIR_IGNORE_MARKS: IgnoreMarks, pos T o -60; pos A V -80;
            // -u 0054,0301,006F: [3=0+540|14=1+0|12=2+500], -u 0041,0301,0301,0056: [2=0+520|14=1+0|14=2+0|4=3+600]
            assert.strictEqual(positionContextualText('T\u{301}o', 'ss09'), '3+540|14+0|12+500');
            assert.strictEqual(positionContextualText('A\u{301}\u{301}V', 'ss09'), '2+520|14+0|14+0|4+600');
            // -u 0054,0041,0056: [3=0+600|2=1+520|4=2+600]
            assert.strictEqual(positionContextualText('TAV', 'ss09'), '3+600|2+520|4+600');
        });

        it('applies a nested lookup at its glyph even when its own lookupFlag ignores the glyph, like HarfBuzz', function() {
            // pos a acutecomb' lookup SHIFT_MARK_IGNORE_MARKS; SHIFT_MARK_IGNORE_MARKS: IgnoreMarks, pos acutecomb <0 40 0 0>;
            // -u 0061,0301: [5=0+500|14=1@0,40+0], -u 0062,0301: [6=0+500|14=1+0]
            assert.strictEqual(positionContextualText('a\u{301}', 'ss14'), '5+500|14@0,40+0');
            assert.strictEqual(positionContextualText('b\u{301}', 'ss14'), '6+500|14+0');
        });

        it('applies a nested contextual lookup at its glyph', function() {
            // pos b c' lookup INNER_CONTEXT; INNER_CONTEXT: pos c' lookup TIGHTEN e;
            // -u 0062,0063,0065: [6=0+500|7=1+460|9=2+500], -u 0062,0063,0078: [6=0+500|7=1+500|13=2+500]
            assert.strictEqual(positionContextualText('bce', 'ss10'), '6+500|7+460|9+500');
            assert.strictEqual(positionContextualText('bcx', 'ss10'), '6+500|7+500|13+500');
        });

        it('nests the lookups of the lookup records up to 64 levels, like HB_MAX_NESTING_LEVEL of HarfBuzz', function() {
            // pos d' lookup PLUS_ONE; with a second lookup record, at d, to the lookup itself: PLUS_ONE (pos d <0 0 1 0>;)
            // applies at the 64 levels HarfBuzz nests, -u 0064: [8=0+564], -u 0064,0064: [8=0+564|8=1+564]
            assert.strictEqual(positionContextualText('d', 'ss11'), '8+564');
            assert.strictEqual(positionContextualText('dd', 'ss11'), '8+564|8+564');
        });

        it('applies at most 1024 nested lookups by glyph of the run, 16384 at least, like the max_ops of HarfBuzz', function() {
            // pos d' lookup PLUS_ONE; with two more lookup records, at d, to the lookup itself: without the budget the
            // nested lookups grow as 2^64; -u 0064: [8=0+5980], -u 0064,0064: [8=0+5980|8=1+500], the first d takes the
            // budget of the run
            assert.strictEqual(positionContextualText('d', 'ss15'), '8+5980');
            assert.strictEqual(positionContextualText('dd', 'ss15'), '8+5980|8+500');
            // 21 d, a budget of 21 * 1024: [8=0+7686|8=1+500|...|8=20+500]
            const glyphs = positionContextualText('d'.repeat(21), 'ss15');
            assert.strictEqual(glyphs, ['8+7686', ...Array(20).fill('8+500')].join('|'));
        });

        it('applies the first subtable of a nested lookup that applies', function() {
            // pos [T V]' lookup PAIR_SECOND_SUBTABLE [o a]; PAIR_SECOND_SUBTABLE: pos T o -10; subtable; pos [T V] [o a] -40;
            // -u 0054,006F: [3=0+590|12=1+500], -u 0056,006F: [4=0+560|12=1+500], -u 0054,0061: [3=0+560|5=1+500]
            assert.strictEqual(positionContextualText('To', 'ss16'), '3+590|12+500');
            assert.strictEqual(positionContextualText('Vo', 'ss16'), '4+560|12+500');
            assert.strictEqual(positionContextualText('Ta', 'ss16'), '3+560|5+500');
        });

        it('goes on after the input of the rule, at the second glyph of a nested pair with a second value record', function() {
            // pos T' lookup PAIR_BOTH_GLYPHS; pos o' lookup TIGHTEN; PAIR_BOTH_GLYPHS: pos T <0 0 -20 0> o <0 0 -10 0>;
            // -u 0054,006F: [3=0+580|12=1+450], -u 006F: [12=0+460]
            assert.strictEqual(positionContextualText('To', 'cv04'), '3+580|12+450');
            assert.strictEqual(positionContextualText('o', 'cv04'), '12+460');
        });

        it('attaches the mark of a nested mark-to-mark lookup', function() {
            // pos acutecomb gravecomb' lookup MARK_TO_MARK; MARK_TO_MARK: pos mark acutecomb <anchor -100 700> mark
            // @GRAVE_MARKS (gravecomb <anchor -100 500>); -u 0065,0301,0300: [9=0+500|14=1+0|18=2@0,200+0],
            // -u 0065,0300: [9=0+500|18=1+0]
            assert.strictEqual(positionContextualText('e\u{301}\u{300}', 'cv01'), '9+500|14+0|18@0,200+0');
            assert.strictEqual(positionContextualText('e\u{300}', 'cv01'), '9+500|18+0');
        });

        it('applies a nested cursive attachment with the RightToLeft flag of the nested lookup', function() {
            // pos x x' lookup CURSIVE; CURSIVE: pos cursive x <anchor 50 0> <anchor 450 100>; without RightToLeft (cv02)
            // the second x follows the first one, with it (cv03) the first x follows the second one;
            // cv02 -u 0078,0078: [13=0+450|13=1@-50,100+450], cv03 -u 0078,0078: [13=0@0,-100+450|13=1@-50,0+450]
            assert.strictEqual(positionContextualText('xx', 'cv02'), '13+450|13@-50,100+450');
            assert.strictEqual(positionContextualText('xx', 'cv03'), '13@0,-100+450|13@-50,0+450');
            // cv02 -u 0078,0078,0078: [13=0+450|13=1@-50,100+400|13=2@-50,200+450]
            assert.strictEqual(positionContextualText('xxx', 'cv02'), '13+450|13@-50,100+400|13@-50,200+450');
        });

        it('attaches the marks of nested mark-to-base and mark-to-ligature lookups, at the component of each mark', function() {
            // pos e acutecomb' lookup MARK_TO_BASE; pos f_i acutecomb' lookup MARK_TO_LIGATURE;
            // pos acutecomb acutecomb' lookup MARK_TO_LIGATURE; and the liga of GSUB, IgnoreMarks: sub f i by f_i;
            const options = { features: { kern: false, ss12: true } };
            // --features=-kern,+ss12 -u 0065,0301: [9=0+500|14=1@-150,20+0], -u 0061,0301: [5=0+500|14=1+0]
            assertShape(shapeText(contextualFont, 'e\u{301}', options),
                { glyphs: [9, 14], clusters: [0, 1], advances: [500, 0], offsets: [[0, 0], [-150, 20]] }, 'e acute');
            assertShape(shapeText(contextualFont, 'a\u{301}', options),
                { glyphs: [5, 14], clusters: [0, 1], advances: [500, 0], offsets: [[0, 0], [0, 0]] }, 'a acute');
            // -u 0066,0301,0069,0301: [17=0+600|14=0@-350,250+0|14=3@-50,250+0], each acute on its component of f_i
            assertShape(shapeText(contextualFont, 'f\u{301}i\u{301}', options),
                { glyphs: [17, 14, 14], clusters: [0, 0, 3], advances: [600, 0, 0], offsets: [[0, 0], [-350, 250], [-50, 250]] }, 'f_i');
        });

        it('attaches the marks of nested mark-to-base and mark-to-ligature lookups whose lookupFlag ignores them', function() {
            // pos e acutecomb' lookup MARK_TO_BASE_IGNORE_MARKS; pos f_i acutecomb' lookup MARK_TO_LIGATURE_ATTACHMENT_TYPE;
            // IgnoreMarks and MarkAttachmentType [gravecomb], which ignore the acute
            const options = { features: { kern: false, cv06: true } };
            // --features=-kern,+cv06 -u 0065,0301: [9=0+500|14=1@-150,20+0]
            assertShape(shapeText(contextualFont, 'e\u{301}', options),
                { glyphs: [9, 14], clusters: [0, 1], advances: [500, 0], offsets: [[0, 0], [-150, 20]] }, 'e acute');
            // --features=-kern,+cv06 -u 0066,0069,0301: [17=0+600|14=2@-50,250+0]
            assertShape(shapeText(contextualFont, 'fi\u{301}', options),
                { glyphs: [17, 14], clusters: [0, 2], advances: [600, 0], offsets: [[0, 0], [-50, 250]] }, 'f_i acute');
        });

        it('matches the context of a right-to-left run in the order of the text', function() {
            // pos alef bet' lookup TIGHTEN; --features=-kern,+ss13 -u 05D0,05D1: [16=1+460|15=0+500], the glyphs in visual
            // order; -u 05D0,05D1,05D1: [16=2+500|16=1+460|15=0+500]
            const hebrew = { rightToLeft: true, script: 'hebr' };
            assert.strictEqual(positionContextualText('\u{5D1}\u{5D0}', 'ss13', hebrew), '16+460|15+500');
            assert.strictEqual(positionContextualText('\u{5D1}\u{5D1}\u{5D0}', 'ss13', hebrew), '16+500|16+460|15+500');
        });

        it('applies a contextual kerning of the kern feature with its exception, a matching rule without lookup records', function() {
            // ignore pos T' o' x; pos T' lookup KERN_PAIRS o; KERN_PAIRS: pos T o -70;
            // -u 0054,006F: [3=0+530|12=1+500], -u 0054,006F,0078: [3=0+600|12=1+500|13=2+500], -u 0054,006F,0061: [3=0+530|12=1+500|5=2+500]
            assert.strictEqual(positionTextGlyphs(contextualFont, 'To'), '3+530|12+500');
            assert.strictEqual(positionTextGlyphs(contextualFont, 'Tox'), '3+600|12+500|13+500');
            assert.strictEqual(positionTextGlyphs(contextualFont, 'Toa'), '3+530|12+500|5+500');
        });

        it('ends the lookup at an exception rule of an earlier subtable, and tries the next subtable when no rule matches', function() {
            // ignore pos [T V]' [o a]' x; pos [T V]' lookup KERN_PAIRS [o a]; one format 3 subtable by rule, the
            // exception first; -u 0054,006F,0078: [3=0+600|12=1+500|13=2+500], -u 0054,006F: [3=0+530|12=1+500]
            assert.strictEqual(positionContextualText('Tox', 'ss17'), '3+600|12+500|13+500');
            assert.strictEqual(positionContextualText('To', 'ss17'), '3+530|12+500');
        });

        it('skips a lookup index past the LookupList, like HarfBuzz', function() {
            // like recurse of HarfBuzz (hb-ot-layout-gsubgpos.hh), a lookup index past the LookupList is the Null lookup,
            // which applies nothing; the record of a sequence index past the input (2) is skipped too, which the positions
            // cannot show: it has no glyph to apply its lookup at
            const coverage = glyph => ({ format: 1, glyphs: [glyph] });
            const font = createFont([
                { lookupType: 1, lookupFlag: 0, subtables: [{ posFormat: 1, coverage: { format: 1, glyphs: [1, 2] }, value: { xAdvance: -10 } }] },
                {
                    lookupType: 7,
                    lookupFlag: 0,
                    subtables: [{
                        posFormat: 3,
                        coverages: [coverage(1), coverage(2)],
                        lookupRecords: [
                            { sequenceIndex: 2, lookupListIndex: 0 },
                            { sequenceIndex: 0, lookupListIndex: 9 },
                            { sequenceIndex: 1, lookupListIndex: 0 }
                        ]
                    }]
                }
            ], [1]);
            assert.strictEqual(positionGlyphs(font, [1, 2, 1, 2], { script: 'DFLT' }), '1+500|2+490|1+500|2+490');
        });

        it('throws on a lookup type that is not a GPOS lookup type', function() {
            // a parsed font has GPOS lookup types 1 to 9 only (see parseLookupList), a lookup built by hand can have another
            const font = createFont([{ lookupType: 10, lookupFlag: 0, subtables: [{}] }], [0]);
            assert.throws(() => positionGlyphs(font, [1, 2], { script: 'DFLT' }), /Unknown GPOS lookup type: 10/);
        });

        it('sets to 0 the advance that a nested lookup gives to a GDEF mark', function() {
            // pos a acutecomb' lookup MARK_ADVANCE; MARK_ADVANCE: pos acutecomb <0 0 10 0>; -u 0061,0301: [5=0+500|14=1+0]
            assert.strictEqual(positionContextualText('a\u{301}', 'cv05'), '5+500|14+0');
        });

        itFailsUntilFixed('matches the context of a contextual positioning across a default ignorable, like HarfBuzz',
            'getNotIgnoredGlyphPositions (src/layout.mjs): the soft hyphen U+00AD, which the font has not, is .notdef in the ' +
            'input of the rule T a\' b\' x, which then does not match, drawn with its advance; HarfBuzz skips the default ' +
            'ignorables when it matches the backtrack, the input and the lookahead of a contextual rule, and hides them with ' +
            'the space glyph and an advance of 0 (hb_ot_hide_default_ignorables)',
            function() {
                // pos T a' lookup TIGHTEN b' x; --features=-kern,+ss04 -u 0054,0061,00AD,0062,0078:
                // [3=0+600|5=1+460|1=2+0|6=3+500|13=4+500], the a tightened as without the soft hyphen
                assertShape(shapeText(contextualFont, 'Ta\u{AD}bx', { features: { kern: false, ss04: true } }), {
                    glyphs: [3, 5, 1, 6, 13], clusters: [0, 1, 2, 3, 4], advances: [600, 460, 0, 500, 500]
                });
            });
    });

    describe('the contextual positionings with lookup records past the LookupList', function() {
        let fontWithInvalidLookupRecords;

        before(function() {
            // TestContextualPositioning.ttf with three lookup records { sequenceIndex 0, lookupListIndex 999 } after the
            // first lookup record of SELF_RECURSIVE_TWICE (ss15), the same records set with fontTools for hb-shape
            fontWithInvalidLookupRecords = parse(readFileSync('./test/fonts/TestContextualPositioning.ttf'));
            const invalidLookupRecords = Array.from({ length: 3 }, () => ({ sequenceIndex: 0, lookupListIndex: 999 }));
            fontWithInvalidLookupRecords.tables.gpos.lookups[25].subtables[0].lookupRecords.splice(1, 0, ...invalidLookupRecords);
        });

        it('takes one operation of the budget of the run for each lookup record past the LookupList, like HarfBuzz', function() {
            // like recurse of HarfBuzz, which counts the operation before it finds the Null lookup;
            // --features=-kern,+ss15 -u 0064: [8=0+3240], -u 0064,0064: [8=0+3240|8=1+500] (8=0+5980 without these records)
            const runOptions = { featureTags: ['ss15'] };
            assert.strictEqual(positionTextGlyphs(fontWithInvalidLookupRecords, 'd', runOptions), '8+3240');
            assert.strictEqual(positionTextGlyphs(fontWithInvalidLookupRecords, 'dd', runOptions), '8+3240|8+500');
        });
    });

    describe('the contextual positionings without the glyph classes of GDEF', function() {
        let fontWithoutGlyphClasses;

        before(function() {
            fontWithoutGlyphClasses = parse(readFileSync('./test/fonts/TestContextualPositioning.ttf'));
            fontWithoutGlyphClasses.tables.gdef.classDef = undefined;
        });

        it('attaches the marks of nested mark-to-base and mark-to-ligature lookups whose lookupFlag ignores them, like HarfBuzz', function() {
            // TestContextualPositioning.ttf with the GlyphClassDef of GDEF removed (fontTools), whose marks HarfBuzz
            // takes from Unicode: pos e acutecomb' lookup MARK_TO_BASE_IGNORE_MARKS; pos f_i acutecomb' lookup
            // MARK_TO_LIGATURE_ATTACHMENT_TYPE; the lookupFlag of a nested lookup does not skip the glyph it applies at
            const options = { features: { kern: false, cv06: true } };
            // --features=-kern,+cv06 -u 0065,0301: [9=0+500|14=1@-150,20+0]
            assertShape(shapeText(fontWithoutGlyphClasses, 'e\u{301}', options),
                { glyphs: [9, 14], clusters: [0, 1], advances: [500, 0], offsets: [[0, 0], [-150, 20]] }, 'e acute');
            // --features=-kern,+cv06 -u 0066,0069,0301: [17=0+600|14=2@-50,250+0]
            assertShape(shapeText(fontWithoutGlyphClasses, 'fi\u{301}', options),
                { glyphs: [17, 14], clusters: [0, 2], advances: [600, 0], offsets: [[0, 0], [-50, 250]] }, 'f_i acute');
        });

        itFailsUntilFixed('sets to 0 the advance that a nested lookup gives to a nonspacing mark, like HarfBuzz',
            'zeroMarkAdvances (src/position.mjs): without the GlyphClassDef of GDEF no glyph is a mark, so the acute keeps ' +
            'the advance of 10 of the nested single adjustment; HarfBuzz takes the glyphs of the nonspacing marks of ' +
            'Unicode (Mn) as marks (hb_synthesize_glyph_classes) and sets their advance to 0 (the Hebrew holam of Tahoma, ' +
            'whose GDEF HarfBuzz ignores, gets the same)',
            function() {
                // TestContextualPositioning.ttf with the GlyphClassDef of GDEF removed (fontTools): pos a acutecomb' lookup
                // MARK_ADVANCE; MARK_ADVANCE: pos acutecomb <0 0 10 0>; --features=-kern,+cv05 -u 0061,0301 [5=0+500|14=1+0]
                assertShape(shapeText(fontWithoutGlyphClasses, 'a\u{301}', { features: { kern: false, cv05: true } }), {
                    glyphs: [5, 14], clusters: [0, 1], advances: [500, 0], offsets: [[0, 0], [0, 0]]
                });
            });
    });

    describe('the contextual positionings of real fonts', function() {
        // hb-shape --no-glyph-names --cluster-level=1 <font> -u <code points>, --shapers=ot for Scheherazade-Bold.ttf

        it('applies the chained contextual kerning and mark positioning of an Arabic font', function() {
            // Scheherazade-Bold.ttf, the kern lookups 1 and 8 to 14 and the mark lookups 3 to 5 of type 8, format 3
            const scheherazadeFont = loadFont('../Scheherazade-Bold.ttf');
            // reh hah, -u 0631,062D: [396=1+1144|328=0@-130,0+508]
            assertShape(shapeText(scheherazadeFont, '\u{631}\u{62D}'),
                { glyphs: [396, 328], clusters: [1, 0], advances: [1144, 508], offsets: [[0, 0], [-130, 0]] }, 'reh hah');
            // beh kasratan ain, -u 0628,064D,0639: [670=2+921|1073=1@26,-240+0|932=0+439]
            assertShape(shapeText(scheherazadeFont, '\u{628}\u{64D}\u{639}'),
                { glyphs: [670, 1073, 932], clusters: [2, 1, 0], advances: [921, 0, 439], offsets: [[0, 0], [26, -240], [0, 0]] }, 'beh kasratan ain');
        });

        it('applies the chained contextual kerning of the digits after the end of ayah', function() {
            // Jomhuria-Regular.ttf, kern lookup 0 of type 8, format 3: -u 06DD,0031,0032,0033:
            // [615=0+4071|1916=1@-3030,0+0|1917=2@-2380,0+0|1918=3@-1730,0+0]
            assertShape(shapeText(loadFont('../Jomhuria-Regular.ttf'), '\u{6DD}123'), {
                glyphs: [615, 1916, 1917, 1918],
                clusters: [0, 1, 2, 3],
                advances: [4071, 0, 0, 0],
                offsets: [[0, 0], [-3030, 0], [-2380, 0], [-1730, 0]]
            });
        });

        it('applies the trak required feature of a variable font, a chained context of an extension lookup', function() {
            // TestTracking3.ttf: lookup 0 (IgnoreMarks), an extension lookup of type 8, format 2, applies the single
            // adjustment lookup 3 after a glyph of its backtrack class and the lookup 2 otherwise
            const trackingFont = loadFont('../TestTracking3.ttf');
            const glyphs = { glyphs: [36, 57, 55, 82, 3, 68], clusters: [0, 1, 2, 3, 4, 5] };
            // -u 0041,0056,0054,006F,0020,0061: [36=0+1290|57=1@-76,0+1290|55=2+1137|82=3@-113,0+1026|3=4+569|68=5+1139]
            assertShape(shapeText(trackingFont, 'AVTo a'), {
                ...glyphs,
                advances: [1290, 1290, 1137, 1026, 569, 1139],
                offsets: [[0, 0], [-76, 0], [0, 0], [-113, 0], [0, 0], [0, 0]]
            }, 'default');
            // --variations=TRAK=1: [36=0+2109|57=1@-485,0+1699|55=2@-409,0+1546|82=3@-522,0+1435|3=4@-409,0+978|68=5@-409,0+1548]
            assertShape(shapeText(trackingFont, 'AVTo a', { variation: { TRAK: 1 } }), {
                ...glyphs,
                advances: [2109, 1699, 1546, 1435, 978, 1548],
                offsets: [[0, 0], [-485, 0], [-409, 0], [-522, 0], [-409, 0], [-409, 0]]
            }, 'TRAK 1');
            // --variations=TRAK=0.5,TRKS=1: [36=0+1700|57=1@-280,0+1495|55=2@-204,0+1342|82=3@-317,0+1231|
            // 3=4@-2252,0+2822|68=5@-204,0+1344]
            assertShape(shapeText(trackingFont, 'AVTo a', { variation: { TRAK: 0.5, TRKS: 1 } }), {
                ...glyphs,
                advances: [1700, 1495, 1342, 1231, 2822, 1344],
                offsets: [[0, 0], [-280, 0], [-204, 0], [-317, 0], [-2252, 0], [-204, 0]]
            }, 'TRAK 0.5 TRKS 1');
        });
    });

    describe('getGlyphRunKerningValue with second value records', function() {
        it('adds the x advance of the second value record of a pair, and skips the pair of its second glyph', function() {
            // -u 0061,0062,0063,0064: [5=0+450|6=1+480|7=2+460|8=3+500], -u 0041,0056: [2=0@10,20+570|4=1@-5,15+575]
            const pairFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
            const kerningLookups = pairFont.position.getKerningTables('latn');
            const textGlyphIndexes = Array.from('abcd').map(character => pairFont.charToGlyphIndex(character));
            assert.deepStrictEqual(
                textGlyphIndexes.map((glyphIndex, index) => pairFont.position.getGlyphRunKerningValue(kerningLookups, textGlyphIndexes, index)),
                [-50, -20, -40, 0]
            );
            assert.equal(pairFont.getKerningValue(pairFont.charToGlyph('A'), pairFont.charToGlyph('V')), -30);
        });

        it('gives no kerning to a position outside the run, like the kern table', function() {
            const pairFont = parse(readFileSync('./test/fonts/TestPairPositioning.ttf'));
            const kerningLookups = pairFont.position.getKerningTables('latn');
            const textGlyphIndexes = Array.from('ab').map(character => pairFont.charToGlyphIndex(character));
            assert.equal(pairFont.position.getGlyphRunKerningValue(kerningLookups, textGlyphIndexes, 2), 0);
            assert.equal(pairFont.position.getGlyphRunKerningValue(kerningLookups, textGlyphIndexes, -1), 0);
            assert.equal(pairFont.position.getGlyphRunKerningValue(kerningLookups, [], 0), 0);
        });
    });
});
