import assert from 'assert';
import { Font, Glyph, Path } from '../src/opentype.mjs';
import FeatureQuery from '../src/features/featureQuery.mjs';
import {
    glyphIndexes,
    createLookupFlagsFont,
    createLayoutTable,
    createCoverage,
    createCoverages,
    createMultipleLookup,
    subAcuteBLookup
} from './lookup-flags-font.mjs';
import { loadFont, shapeText, assertShape, itFailsUntilFixed } from './regression/helpers.mjs';

/**
 * Nested lookups of contextual substitutions (context and chaining context),
 * shaped end to end through the 'liga' feature.
 *
 * Glyphs:
 *   0: .notdef
 *   1: A, 2: B, 3: C (mapped to the characters A, B, C)
 *   4: A.alt, 5: B.alt, 6: C.alt, 7: B.alt2
 *
 * Lookups (the first ones are only referenced by the contextual rules):
 *   0: single substitution format 1, A B C -> A.alt B.alt C.alt (deltaGlyphId 3)
 *   1: single substitution format 2, B.alt -> B.alt2
 *   2: ligature substitution A B -> A.alt (a type that is not applied as a nested lookup)
 *   3: the contextual lookup under test, set by each test
 */
const glyphNames = ['.notdef', 'A', 'B', 'C', 'A.alt', 'B.alt', 'C.alt', 'B.alt2'];

const singleFormat1Lookup = {
    lookupType: 1,
    lookupFlag: 0,
    subtables: [{ substFormat: 1, coverage: { format: 1, glyphs: [1, 2, 3] }, deltaGlyphId: 3 }]
};

const singleFormat2Lookup = {
    lookupType: 1,
    lookupFlag: 0,
    subtables: [{ substFormat: 2, coverage: { format: 1, glyphs: [5] }, substitute: [7] }]
};

const ligatureLookup = {
    lookupType: 4,
    lookupFlag: 0,
    subtables: [{ substFormat: 1, coverage: { format: 1, glyphs: [1] }, ligatureSets: [[{ ligGlyph: 4, components: [2] }]] }]
};

function createFont(contextualLookup) {
    const glyphs = glyphNames.map((name, index) => {
        const unicodes = index >= 1 && index <= 3 ? [64 + index] : [];
        return new Glyph({ index, name, unicode: unicodes[0], unicodes, advanceWidth: 500, path: new Path() });
    });
    const font = new Font({
        familyName: 'ContextualNestedLookups',
        styleName: 'Regular',
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
        glyphs
    });
    font.tables.gsub = {
        version: 1,
        scripts: [{
            tag: 'DFLT',
            script: { defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0] }, langSysRecords: [] }
        }],
        features: [{ tag: 'liga', feature: { params: 0, lookupListIndexes: [3] } }],
        lookups: [singleFormat1Lookup, singleFormat2Lookup, ligatureLookup, contextualLookup]
    };
    return font;
}

function chainingFormat3Lookup(inputGlyphs, lookupRecords) {
    return {
        lookupType: 6,
        lookupFlag: 0,
        subtables: [{
            substFormat: 3,
            backtrackCoverage: [],
            inputCoverage: inputGlyphs.map(glyph => ({ format: 1, glyphs: [glyph] })),
            lookaheadCoverage: [],
            lookupRecords
        }]
    };
}

function shape(font, text) {
    return font.stringToGlyphIndexes(text).map(index => glyphNames[index]);
}

describe('nested lookups of contextual substitutions', function() {
    describe('chaining context substitution format 3', function() {
        it('applies a nested single substitution format 1', function() {
            const font = createFont(chainingFormat3Lookup([1], [{ sequenceIndex: 0, lookupListIndex: 0 }]));
            assert.deepEqual(shape(font, 'AB'), ['A.alt', 'B']);
        });

        it('substitutes the glyph at the sequence index of the lookup record', function() {
            const font = createFont(chainingFormat3Lookup([1, 2, 3], [{ sequenceIndex: 1, lookupListIndex: 0 }]));
            assert.deepEqual(shape(font, 'ABC'), ['A', 'B.alt', 'C']);
        });

        it('applies the lookup records in order, each one on the result of the previous ones', function() {
            const font = createFont(chainingFormat3Lookup([1, 2], [
                { sequenceIndex: 1, lookupListIndex: 0 },
                { sequenceIndex: 1, lookupListIndex: 1 },
                { sequenceIndex: 0, lookupListIndex: 0 }
            ]));
            assert.deepEqual(shape(font, 'AB'), ['A.alt', 'B.alt2']);
        });

        it('skips nested lookups of unsupported types without throwing', function() {
            const font = createFont(chainingFormat3Lookup([1, 2], [
                { sequenceIndex: 0, lookupListIndex: 2 },
                { sequenceIndex: 1, lookupListIndex: 0 }
            ]));
            assert.deepEqual(shape(font, 'AB'), ['A', 'B.alt']);
        });
    });

    describe('chaining context substitution format 2 (class-based rules)', function() {
        // classes: input A = 1, B = 2; backtrack C = 1; lookahead B = 1
        function chainingFormat2Lookup(chainClassSet) {
            return {
                lookupType: 6,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 2,
                    coverage: { format: 1, glyphs: [1, 2] },
                    backtrackClassDef: { format: 2, ranges: [{ start: 3, end: 3, classId: 1 }] },
                    inputClassDef: { format: 2, ranges: [{ start: 1, end: 1, classId: 1 }, { start: 2, end: 2, classId: 2 }] },
                    lookaheadClassDef: { format: 2, ranges: [{ start: 2, end: 2, classId: 1 }] },
                    chainClassSet
                }]
            };
        }

        it('matches the backtrack and lookahead classes around the input', function() {
            // C A' B -> C A.alt B
            const font = createFont(chainingFormat2Lookup([
                undefined,
                [{ backtrack: [1], input: [], lookahead: [1], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }]
            ]));
            assert.deepEqual(shape(font, 'CAB'), ['C', 'A.alt', 'B']);
            assert.deepEqual(shape(font, 'AB'), ['A', 'B']);
            assert.deepEqual(shape(font, 'CAC'), ['C', 'A', 'C']);
        });

        it('matches input sequences of several classes and substitutes at the sequence index', function() {
            // A B' -> A B.alt
            const font = createFont(chainingFormat2Lookup([
                undefined,
                [{ backtrack: [], input: [2], lookahead: [], lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 0 }] }]
            ]));
            assert.deepEqual(shape(font, 'AB'), ['A', 'B.alt']);
            assert.deepEqual(shape(font, 'BA'), ['B', 'A']);
        });

        it('applies the first matching rule only, even when it substitutes nothing', function() {
            const font = createFont(chainingFormat2Lookup([
                undefined,
                [
                    // exception: A followed by B is left as is
                    { backtrack: [], input: [], lookahead: [1], lookupRecords: [] },
                    { backtrack: [], input: [], lookahead: [], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }
                ]
            ]));
            assert.deepEqual(shape(font, 'AB'), ['A', 'B']);
            assert.deepEqual(shape(font, 'AC'), ['A.alt', 'C']);
        });
    });

    describe('contextual rules ending a lookup', function() {
        it('skips the next subtables of the lookup once a rule matches, even when it substitutes nothing', function() {
            const lookup = chainingFormat3Lookup([1], []);
            // subtable 0: exception, A followed by B is left as is; subtable 1: A -> A.alt
            lookup.subtables[0].lookaheadCoverage = [{ format: 1, glyphs: [2] }];
            lookup.subtables.push(chainingFormat3Lookup([1], [{ sequenceIndex: 0, lookupListIndex: 0 }]).subtables[0]);
            const font = createFont(lookup);
            assert.deepEqual(shape(font, 'AB'), ['A', 'B']);
            assert.deepEqual(shape(font, 'AC'), ['A.alt', 'C']);
        });
    });

    describe('nested lookups of several subtables', function() {
        it('applies the first subtable that substitutes the glyph only, not the next one that covers its substitute', function() {
            // the font of test/lookup-flags-font.mjs, LookupFlagsNestedTwoSubtables.ttf: calt sub c' lookup C_THEN_A b; (feaLib:
            // ChainContextSubst format 3), whose nested lookup has the subtables sub c by a; and sub a by a.alt;
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsNestedTwoSubtables.ttf -u 0063,0062: [1=0+500|2=1+500]
            const { a: glyphA, b: glyphB, c: glyphC } = glyphIndexes;
            const nestedLookup = {
                lookupType: 1,
                lookupFlag: 0,
                subtables: [
                    { substFormat: 2, coverage: createCoverage([glyphC]), substitute: [glyphA] },
                    { substFormat: 2, coverage: createCoverage([glyphA]), substitute: [glyphIndexes['a.alt']] }
                ]
            };
            const chainingLookup = {
                lookupType: 6,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 3,
                    backtrackCoverage: [],
                    inputCoverage: [createCoverage([glyphC])],
                    lookaheadCoverage: [createCoverage([glyphB])],
                    lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }]
                }]
            };
            const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [1], [nestedLookup, chainingLookup]) });
            assert.deepStrictEqual(font.stringToGlyphIndexes('cb'), [glyphA, glyphB]);
        });
    });

    describe('context substitution format 2 (class-based rules)', function() {
        it('matches the classes of the input sequence', function() {
            // classes: A = 1, B = 2; A B -> A.alt B
            const font = createFont({
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 2,
                    coverage: { format: 1, glyphs: [1] },
                    classDef: { format: 1, startGlyph: 1, classes: [1, 2] },
                    classSets: [undefined, [{ classes: [2], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }]]
                }]
            });
            assert.deepEqual(shape(font, 'AB'), ['A.alt', 'B']);
            assert.deepEqual(shape(font, 'AC'), ['A', 'C']);
        });
    });

    describe('context substitution format 1', function() {
        it('only matches the rules of the rule set of the current glyph', function() {
            const font = createFont({
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 1,
                    coverage: { format: 1, glyphs: [1, 2] },
                    ruleSets: [
                        // A C -> A.alt C
                        [{ input: [3], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }],
                        // B C -> B C.alt
                        [{ input: [3], lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 0 }] }]
                    ]
                }]
            });
            assert.deepEqual(shape(font, 'AC'), ['A.alt', 'C']);
            assert.deepEqual(shape(font, 'BC'), ['B', 'C.alt']);
        });
    });

    describe('context substitution format 3', function() {
        it('substitutes the glyph at the sequence index of the lookup record', function() {
            const font = createFont({
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 3,
                    coverages: [{ format: 1, glyphs: [1] }, { format: 1, glyphs: [2] }],
                    lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 0 }]
                }]
            });
            assert.deepEqual(shape(font, 'AB'), ['A', 'B.alt']);
        });
    });

    describe('nested multiple substitutions', function() {
        // the font of test/lookup-flags-font.mjs, whose calt feature has the lookup 2, the contextual lookup under test;
        // each lookup in the feaLib syntax, then its hb-shape outputs
        // (hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature of the lookup> LookupFlags.ttf -u <code points>)
        const { a: glyphA, b: glyphB, c: glyphC, acute } = glyphIndexes;
        const IGNORE_MARKS = 0x0008;
        // lookup 0: MULTIPLE_C, sub c by a acute; (or the given sequence); lookup 1: SUB_ACUTE_B, sub acute by acute.alt; sub b by b.alt;
        function createNestedMultipleFont(contextualLookup, sequence = [glyphA, acute]) {
            const lookups = [createMultipleLookup([glyphC], [sequence]), subAcuteBLookup, contextualLookup];
            return createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [2], lookups) });
        }
        const shapeNames = (font, text) => font.stringToGlyphs(text).map(glyph => glyph.name);
        const multipleThenSingleRecords = [{ sequenceIndex: 0, lookupListIndex: 0 }, { sequenceIndex: 1, lookupListIndex: 1 }];

        it('points the sequence index of a later lookup record into the glyphs of a nested multiple substitution: context format 3', function() {
            // ss23: sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B; (feaLib: ContextSubst format 3): the sequence index 1 is the acute
            // -u 0063,0062: [1=0+500|11=0+0|2=1+500]
            const font = createNestedMultipleFont({
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{ substFormat: 3, coverages: createCoverages([glyphC, glyphB]), lookupRecords: multipleThenSingleRecords }]
            });
            assert.deepEqual(shapeNames(font, 'cb'), ['a', 'acute.alt', 'b']);
        });

        it('points the sequence index of a later lookup record into the glyphs of a nested multiple substitution: chaining context format 3', function() {
            // ss24: lookupflag IgnoreMarks; sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B c; (ChainContextSubst format 3): the glyphs
            // of the multiple substitution are counted in the input even when the lookup ignores them
            // -u 0063,0062,0063: [1=0+500|11=0+0|2=1+500|3=2+500]
            const font = createNestedMultipleFont({
                lookupType: 6,
                lookupFlag: IGNORE_MARKS,
                subtables: [{
                    substFormat: 3,
                    backtrackCoverage: [],
                    inputCoverage: createCoverages([glyphC, glyphB]),
                    lookaheadCoverage: createCoverages([glyphC]),
                    lookupRecords: multipleThenSingleRecords
                }]
            });
            assert.deepEqual(shapeNames(font, 'cbc'), ['a', 'acute.alt', 'b', 'c']);
            // -u 0063,0062: [3=0+500|2=1+500]
            assert.deepEqual(shapeNames(font, 'cb'), ['c', 'b']);
        });

        it('points the sequence index of a later lookup record into the glyphs of a nested multiple substitution: formats 1 and 2', function() {
            // the rule of ss23 (sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B;) in the glyph and class formats of context and
            // chaining context substitutions, which match the same glyphs as its format 3 in LookupFlags.ttf
            // -u 0063,0062: [1=0+500|11=0+0|2=1+500]
            const classDef = { format: 2, ranges: [{ start: glyphB, end: glyphB, classId: 2 }, { start: glyphC, end: glyphC, classId: 1 }] };
            const subtables = [
                { lookupType: 5, subtable: { substFormat: 1, coverage: createCoverage([glyphC]), ruleSets: [[{ input: [glyphB], lookupRecords: multipleThenSingleRecords }]] } },
                { lookupType: 5, subtable: { substFormat: 2, coverage: createCoverage([glyphC]), classDef, classSets: [undefined, [{ classes: [2], lookupRecords: multipleThenSingleRecords }]] } },
                {
                    lookupType: 6,
                    subtable: {
                        substFormat: 1,
                        coverage: createCoverage([glyphC]),
                        chainRuleSets: [[{ backtrack: [], input: [glyphB], lookahead: [], lookupRecords: multipleThenSingleRecords }]]
                    }
                },
                {
                    lookupType: 6,
                    subtable: {
                        substFormat: 2,
                        coverage: createCoverage([glyphC]),
                        backtrackClassDef: classDef,
                        inputClassDef: classDef,
                        lookaheadClassDef: classDef,
                        chainClassSet: [undefined, [{ backtrack: [], input: [2], lookahead: [], lookupRecords: multipleThenSingleRecords }]]
                    }
                }
            ];
            for (const { lookupType, subtable } of subtables) {
                const font = createNestedMultipleFont({ lookupType, lookupFlag: 0, subtables: [subtable] });
                assert.deepEqual(shapeNames(font, 'cb'), ['a', 'acute.alt', 'b'], `lookup type ${lookupType} format ${subtable.substFormat}`);
            }
        });

        it('goes on after the glyphs of a nested multiple substitution of the current glyph', function() {
            // ss29: lookup MULTIPLE_C_A_C { sub c by a c; } sub c' lookup MULTIPLE_C_A_C;
            // -u 0063,0063: [1=0+500|3=0+500|1=1+500|3=1+500], the c of the substitution is not substituted again
            const font = createNestedMultipleFont({
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{ substFormat: 3, coverages: createCoverages([glyphC]), lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }]
            }, [glyphA, glyphC]);
            assert.deepEqual(shapeNames(font, 'cc'), ['a', 'c', 'a', 'c']);
            const clusters = font.stringToGlyphClusters('cc');
            assert.deepEqual(clusters.map(cluster => [cluster.start, cluster.end]), [[0, 1], [0, 1], [1, 2], [1, 2]]);
        });

        it('skips a lookup record whose sequence index is past the end of the input after a nested multiple substitution', function() {
            // the rule of ss23 with the second record at the sequence index 3: c b, then a acute b, there is no glyph at the index 3
            // --features=-kern,+ss23 LookupFlagsNestedSequenceIndexPastEnd.ttf -u 0063,0062: [1=0+500|5=0+0|2=1+500]
            const font = createNestedMultipleFont({
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 3,
                    coverages: createCoverages([glyphC, glyphB]),
                    lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }, { sequenceIndex: 3, lookupListIndex: 1 }]
                }]
            });
            assert.deepEqual(shapeNames(font, 'cb'), ['a', 'acute', 'b']);
        });

        it('applies the lookup records after one whose sequence index is past the end of the input', function() {
            // the rule of ss23 with the records at the sequence indexes 0, 3 and 2: there is no glyph at the index 3, b is at the index 2
            // --features=-kern,+ss23 LookupFlagsNestedSequenceIndexPastEndThenValid.ttf -u 0063,0062: [1=0+500|5=0+0|8=1+500]
            const font = createNestedMultipleFont({
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 3,
                    coverages: createCoverages([glyphC, glyphB]),
                    lookupRecords: [
                        { sequenceIndex: 0, lookupListIndex: 0 },
                        { sequenceIndex: 3, lookupListIndex: 1 },
                        { sequenceIndex: 2, lookupListIndex: 1 }
                    ]
                }]
            });
            assert.deepEqual(shapeNames(font, 'cb'), ['a', 'acute', 'b.alt']);
        });

        describe('a real font', function() {
            let sourceSansFont;
            let interFont;

            before(function() {
                sourceSansFont = loadFont('../SourceSansPro-Regular.otf');
                interFont = loadFont('../InterVariable.ttf');
            });

            itFailsUntilFixed('applies a nested ligature substitution: Inter, the locl of the language system CAT',
                'applyNestedLookupRecords (src/features/featureQuery.mjs): a nested lookup of type 4 is skipped (NESTED_SUBSTITUTION_TYPES), ' +
                'so the chaining rule l\' lookup 15 periodcentered\' l of lookup 14 keeps l periodcentered l',
                function() {
                    // lookup 15 is the ligature l periodcentered -> ldot (fontTools)
                    // hb-shape --no-glyph-names --cluster-level=1 --language=ca InterVariable.ttf -u 006C,00B7,006C
                    // [743=0+736|736=2+496]
                    assert.deepStrictEqual(interFont.stringToGlyphIndexes('l\u{B7}l', { language: 'CAT' }), [743, 736]);
                });

            it('decomposes a letter with a capital accent before a combining accent: Source Sans Pro, ccmp', function() {
                // ccmp lookup 4, a chaining context of format 3, applies the multiple substitution of lookup 3 to Emacron before
                // the combining acute: E uni0304.cap, then uni0301. HarfBuzz composes U+0112 U+0301 into U+1E16 when the font
                // maps it, the reference comes from a copy of the font without U+1E16, U+1E17, U+1E52 and U+1E53 in its cmap
                // hb-shape --no-glyph-names --cluster-level=1 SourceSansPro-Regular-no-1E16.otf -u 0112,0301
                // [6=0+527|765=0@-242,0+0|758=1@-242,170+0]
                const reference = { glyphs: [6, 765, 758], clusters: [0, 0, 1], advances: [527, 0, 0] };
                assertShape(shapeText(sourceSansFont, '\u{112}\u{301}'), reference, 'Emacron, combining acute');
            });
        });
    });

    describe('single substitution format 1', function() {
        it('adds the delta modulo 65536', function() {
            // in a font with more than 32768 glyphs, glyph 40000 -> glyph 100 is stored as the delta 25636 (100 - 40000 + 65536)
            const lookupTable = {
                lookupType: 1,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, coverage: { format: 1, glyphs: [40000] }, deltaGlyphId: 25636 }]
            };
            const query = new FeatureQuery(createFont(chainingFormat3Lookup([1], [])));
            assert.equal(query.getLookupMethod(lookupTable, lookupTable.subtables[0])(40000), 100);
        });
    });
});
