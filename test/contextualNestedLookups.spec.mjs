import assert from 'assert';
import { Font, Glyph, Path } from '../src/opentype.mjs';
import FeatureQuery from '../src/features/featureQuery.mjs';

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
