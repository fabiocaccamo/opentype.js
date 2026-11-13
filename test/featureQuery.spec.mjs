import assert from 'assert';
import { parse } from '../src/opentype.mjs';
import FeatureQuery, { getSubstitutionGlyphEdits } from '../src/features/featureQuery.mjs';
import { ContextParams } from '../src/tokenizer.mjs';
import {
    glyphIndexes,
    createLookupFlagsFont,
    createLayoutTable,
    createCoverage,
    createCoverages,
    createSingleLookup,
    createMultipleLookup,
    createLigatureLookup,
    subAcuteBLookup
} from './lookup-flags-font.mjs';
import { readFileSync } from 'fs';
import { itFailsUntilFixed } from './regression/helpers.mjs';
import { getFeatureLookupTables } from './testutil.mjs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

// the result of a contextual rule that matches: the substitutions of its nested lookups in the order they apply, and the
// number of glyphs from the current one to its last input glyph after them
const contextualMatch = (substitutions, inputLength) => ({ substitutions, inputLength });
// a substitution of a nested lookup at an offset from the current glyph, of the type id: single substitution format 1
// (11) or 2 (12), multiple substitution (21), ligature substitution (41)
const nestedSubstitution = (offset, id, substitution) => ({ offset, id, substitution });

// a b in class 1, the other glyphs in class 0
const classDef = { format: 2, ranges: [{ start: glyphIndexes.a, end: glyphIndexes.b, classId: 1 }] };
// a b in class 1, c in class 2, the other glyphs in class 0
const classDefWithC = {
    format: 2,
    ranges: [{ start: glyphIndexes.a, end: glyphIndexes.b, classId: 1 }, { start: glyphIndexes.c, end: glyphIndexes.c, classId: 2 }]
};

// the chaining context subtables of formats 1, 2 and 3 of a rule of the glyphs a, b and c
function chainingSubtables(backtrack, input, lookahead, lookupRecords) {
    const glyphClasses = glyphs => glyphs.map(glyph => glyph === glyphIndexes.c ? 2 : 1);
    const coverages = glyphs => glyphs.map(glyph => ({ format: 1, glyphs: [glyph] }));
    const firstCoverage = coverages([input[0]])[0];
    return [
        {
            substFormat: 1,
            coverage: firstCoverage,
            chainRuleSets: [[{ backtrack: backtrack.slice().reverse(), input: input.slice(1), lookahead, lookupRecords }]]
        },
        {
            substFormat: 2,
            coverage: firstCoverage,
            backtrackClassDef: classDefWithC,
            inputClassDef: classDefWithC,
            lookaheadClassDef: classDefWithC,
            chainClassSet: [[], [{
                backtrack: glyphClasses(backtrack.slice().reverse()),
                input: glyphClasses(input.slice(1)),
                lookahead: glyphClasses(lookahead),
                lookupRecords
            }]]
        },
        {
            substFormat: 3,
            backtrackCoverage: coverages(backtrack.slice().reverse()),
            inputCoverage: coverages(input),
            lookaheadCoverage: coverages(lookahead),
            lookupRecords
        }
    ];
}

describe('featureQuery.mjs', function() {
    let arabicFont;
    let arabicFontChanga;
    let latinFont;
    let sub5Font;

    let query = {};
    beforeEach(function () {
        /**
         * arab
         */
        arabicFont = loadSync('./test/fonts/Scheherazade-Bold.ttf');
        arabicFontChanga = loadSync('./test/fonts/Changa-Regular.ttf');
        query.arabic = new FeatureQuery(arabicFont);
        query.arabicChanga = new FeatureQuery(arabicFontChanga);
        /**
         * latin
         */
        latinFont = loadSync('./test/fonts/FiraSansMedium.woff');
        query.latin = new FeatureQuery(latinFont);
        /**
         * default
         */
        sub5Font = loadSync('./test/fonts/sub5.ttf');
        query.sub5 = new FeatureQuery(sub5Font);
    });
    describe('getScriptFeature', function () {
        it('should return features indexes of a given script tag', function () {
            /** arab */
            let arabFeaturesIndexes = query.arabic.getScriptFeaturesIndexes('arab');
            assert.equal(arabFeaturesIndexes.length, 24);
            /** latin */
            let latnFeaturesIndexes = query.latin.getScriptFeaturesIndexes('latn');
            assert.equal(latnFeaturesIndexes.length, 20);
        });
        it('should return features of a given script', function () {
            /** arab */
            let arabFeatures = query.arabic.getScriptFeatures('arab');
            assert.equal(arabFeatures.length, 24);
            /** latin */
            let latnFeatures = query.latin.getScriptFeatures('latn');
            assert.equal(latnFeatures.length, 20);
        });
        it('should return a feature lookup tables', function () {
            /** arab */
            const initFeature = query.arabic.getFeature({tag: 'init', script: 'arab'});
            assert.deepEqual(initFeature.lookupListIndexes, [7]);
            const initFeatureLookups = getFeatureLookupTables(query.arabic, initFeature);
            assert.deepEqual(initFeatureLookups[0], arabicFont.tables.gsub.lookups[7]);
            /** latin */
            const ligaFeature = query.latin.getFeature({tag: 'liga', script: 'latn'});
            assert.deepEqual(ligaFeature.lookupListIndexes, [35]);
            const ligaFeatureLookups = getFeatureLookupTables(query.latin, ligaFeature);
            assert.deepEqual(ligaFeatureLookups[0], latinFont.tables.gsub.lookups[35]);
        });
        it('should return lookup subtables', function () {
            /** arab */
            const initFeature = query.arabic.getFeature({tag: 'init', script: 'arab'});
            const initFeatureLookups = getFeatureLookupTables(query.arabic, initFeature);
            const initLookupSubtables = query.arabic.getLookupSubtables(initFeatureLookups[0]);
            assert.deepEqual(initLookupSubtables.length, arabicFont.tables.gsub.lookups[7].subtables.length);
            /** latin */
            const ligaFeature = query.latin.getFeature({tag: 'liga', script: 'latn'});
            const ligaFeatureLookups = getFeatureLookupTables(query.latin, ligaFeature);
            const ligaLookupSubtables = query.latin.getLookupSubtables(ligaFeatureLookups[0]);
            assert.deepEqual(ligaLookupSubtables.length, latinFont.tables.gsub.lookups[35].subtables.length);
        });
        it('should return subtable lookup method', function () {
            /** arab */
            const initFeature = query.arabic.getFeature({tag: 'init', script: 'arab'});
            const initFeatureLookups = getFeatureLookupTables(query.arabic, initFeature);
            const initLookupTable = initFeatureLookups[0];
            const initLookupSubtables = query.arabic.getLookupSubtables(initLookupTable);
            const initSubtable = initLookupSubtables[0];
            const initSubsType = query.arabic.getSubstitutionType(initLookupTable, initSubtable);
            const initLookupFn = query.arabic.getLookupMethod(initLookupTable, initSubtable);
            assert.deepEqual(initSubsType, '12'); // supported: single substitution '12'
            assert.deepEqual(typeof initLookupFn, 'function');
            /** latin */
            const ligaFeature = query.latin.getFeature({tag: 'liga', script: 'latn'});
            const ligaFeatureLookups = getFeatureLookupTables(query.latin, ligaFeature);
            const ligaLookupTable = ligaFeatureLookups[0];
            const ligaLookupSubtables = query.latin.getLookupSubtables(ligaLookupTable);
            const ligaSubtable = ligaLookupSubtables[0];
            const ligaSubsType = query.latin.getSubstitutionType(ligaLookupTable, ligaSubtable);
            const ligaLookupFn = query.latin.getLookupMethod(ligaLookupTable, ligaSubtable);
            assert.deepEqual(ligaSubsType, '41'); // supported: ligature substitution '41'
            assert.deepEqual(typeof ligaLookupFn, 'function');
        });
        it('should find a substitute - single substitution format 1 (11)', function () {
            const feature = query.arabicChanga.getFeature({tag: 'init', script: 'arab'});
            const featureLookups = getFeatureLookupTables(query.arabicChanga, feature);
            const lookupSubtables = query.arabicChanga.getLookupSubtables(featureLookups[0]);
            const substitutionType = query.arabicChanga.getSubstitutionType(featureLookups[0], lookupSubtables[0]);
            assert.equal(substitutionType, 11);
            const lookup = query.arabicChanga.getLookupMethod(featureLookups[0], lookupSubtables[0]);
            const substitution = lookup(291);
            assert.equal(substitution, 294);
        });
        it('should find a substitute - single substitution format 2 (12)', function () {
            const feature = query.arabic.getFeature({tag: 'init', script: 'arab'});
            const featureLookups = getFeatureLookupTables(query.arabic, feature);
            const lookupSubtables = query.arabic.getLookupSubtables(featureLookups[0]);
            const substitutionType = query.arabic.getSubstitutionType(featureLookups[0], lookupSubtables[0]);
            assert.equal(substitutionType, 12);
            const lookup = query.arabic.getLookupMethod(featureLookups[0], lookupSubtables[0]);
            const substitution = lookup(351);
            assert.equal(substitution, 910);
        });
        it('should find a substitute - chaining context substitution format 3 (63)', function () {
            const feature = query.arabic.getFeature({tag: 'rlig', script: 'arab'});
            const featureLookups = getFeatureLookupTables(query.arabic, feature);
            const lookupSubtables = query.arabic.getLookupSubtables(featureLookups[0]);
            const substitutionType = query.arabic.getSubstitutionType(featureLookups[0], lookupSubtables[0]);
            assert.equal(substitutionType, 63);
            const lookup = query.arabic.getLookupMethod(featureLookups[0], lookupSubtables[0]);
            let contextParams = new ContextParams([882, 520], 0);
            const substitutions = lookup(contextParams, featureLookups[0]);
            // an input of one glyph, 520 is the lookahead
            assert.deepEqual(substitutions, contextualMatch([nestedSubstitution(0, 12, 1348)], 1));
        });
        it('should find a substitute - required ligature substitution format 1 (41)', function () {
            /** arab */
            const initFeature = query.arabic.getFeature({tag: 'rlig', script: 'arab'});
            const initFeatureLookups = getFeatureLookupTables(query.arabic, initFeature);
            const lookupSubtables = query.arabic.getLookupSubtables(initFeatureLookups[1]);
            const substitutionType = query.arabic.getSubstitutionType(initFeatureLookups[1], lookupSubtables[0]);
            assert.equal(substitutionType, 41);
            const lookup = query.arabic.getLookupMethod(initFeatureLookups[1], lookupSubtables[0]);
            let contextParams = new ContextParams([1075, 1081], 0);
            const substitutions = lookup(contextParams, initFeatureLookups[1]);
            // the ligature glyph and the offset of the component 1081 from the current glyph
            assert.deepEqual(substitutions, { ligGlyph: 1311, componentOffsets: [1] });
        });
        it('should find a substitute - ligature substitution format 1 (41)', function () {
            /** latin */
            const ligaFeature = query.latin.getFeature({tag: 'liga', script: 'latn'});
            const ligaFeatureLookups = getFeatureLookupTables(query.latin, ligaFeature);
            const ligaLookupTable = ligaFeatureLookups[0];
            const ligaLookupSubtables = query.latin.getLookupSubtables(ligaLookupTable);
            const ligaSubtable = ligaLookupSubtables[0];
            const ligaSubsType = query.latin.getSubstitutionType(ligaLookupTable, ligaSubtable);
            const lookup = query.latin.getLookupMethod(ligaLookupTable, ligaSubtable);
            assert.deepEqual(ligaSubsType, '41'); // supported single substitution '41'
            let contextParams = new ContextParams([73, 76], 0);
            const substitutions = lookup(contextParams, ligaLookupTable);
            // the ligature glyph and the offset of the component 76 from the current glyph
            assert.deepEqual(substitutions, { ligGlyph: 1145, componentOffsets: [1] });
        });
        it('should parse multiple glyphs -ligature substitution format 1 (51)', function () {
            const feature = query.sub5.getFeature({tag: 'ccmp', script: 'DFLT'});
            const featureLookups = getFeatureLookupTables(query.sub5, feature);
            const lookupSubtables = query.sub5.getLookupSubtables(featureLookups[0]);
            const substitutionType = query.sub5.getSubstitutionType(featureLookups[0], lookupSubtables[0]);
            assert.equal(substitutionType, 51);
            const lookup = query.sub5.getLookupMethod(featureLookups[0], lookupSubtables[0]);
            // space endash space: both spaces become uni2009 (86), like HarfBuzz does;
            // the endash (88) is not substituted, so no substitution applies at its offset
            let contextParams = new ContextParams([1, 88, 1], 0);
            const { substitutions, inputLength } = lookup(contextParams, featureLookups[0]);
            assert.deepEqual(substitutions, [nestedSubstitution(0, 11, 86), nestedSubstitution(2, 11, 86)]);
            assert.equal(inputLength, 3);
        });
        it('should parse multiple glyphs -ligature substitution format 3 (53)', function () {
            const feature = query.sub5.getFeature({tag: 'ccmp', script: 'DFLT'});
            const featureLookups = getFeatureLookupTables(query.sub5, feature);
            const lookupSubtables = query.sub5.getLookupSubtables(featureLookups[1]);
            const substitutionType = query.sub5.getSubstitutionType(featureLookups[1], lookupSubtables[0]);
            assert.equal(substitutionType, 53);
            const lookup = query.sub5.getLookupMethod(featureLookups[0], lookupSubtables[0]);
            let contextParams = new ContextParams([2, 3], 0);
            const substitutions = lookup(contextParams, featureLookups[1]);
            assert.deepEqual(substitutions, contextualMatch([nestedSubstitution(0, 12, 54), nestedSubstitution(1, 12, 54)], 2));
        });
        it('should decompose a glyph - multiple substitution format 1 (21)', function () {
            const feature = query.arabic.getFeature({tag: 'ccmp', script: 'arab'});
            const featureLookups = getFeatureLookupTables(query.arabic, feature);
            const lookupSubtables = query.arabic.getLookupSubtables(featureLookups[1]);
            const substitutionType = query.arabic.getSubstitutionType(featureLookups[1], lookupSubtables[0]);
            assert.equal(substitutionType, 21);
            const lookup = query.arabic.getLookupMethod(featureLookups[1], lookupSubtables[0]);
            const substitution = lookup(271);
            assert.deepEqual(substitution, [273, 1087]);
        });
    });
    describe('unsupported lookups', function() {
        it('skips an unsupported lookup and still applies the supported lookups of the same feature', function () {
            const font = loadSync('./test/fonts/TestGSUB-UnsupportedLookup.ttf');
            const originalWarn = console.warn;
            const warnings = [];
            console.warn = message => warnings.push(message);
            try {
                assert.deepEqual(font.stringToGlyphs('fia').map(glyph => glyph.name), ['f_i', 'a']);
                assert.deepEqual(font.stringToGlyphs('fia').map(glyph => glyph.name), ['f_i', 'a']);
            } finally {
                console.warn = originalWarn;
            }
            assert.equal(warnings.length, 1);
            assert.match(warnings[0], /lookupType: 3 - substFormat: 1 is not yet supported, lookup skipped/);
        });

        it('warns once for each unsupported substitution type of a font', function () {
            // calt: an alternate substitution (lookup type 3) of a, a reverse chaining substitution (lookup type 8) of b
            const alternateLookup = {
                lookupType: 3,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, coverage: createCoverage([glyphIndexes.a]), alternateSets: [[glyphIndexes['a.alt']]] }]
            };
            const reverseChainingLookup = {
                lookupType: 8,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 1,
                    coverage: createCoverage([glyphIndexes.b]),
                    backtrackCoverage: [],
                    lookaheadCoverage: [],
                    substitutes: [glyphIndexes['b.alt']]
                }]
            };
            const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [0, 1], [alternateLookup, reverseChainingLookup]) });
            const originalWarn = console.warn;
            const warnings = [];
            console.warn = message => warnings.push(message);
            try {
                font.stringToGlyphIndexes('ab');
                font.stringToGlyphIndexes('ab');
            } finally {
                console.warn = originalWarn;
            }
            assert.deepStrictEqual(warnings, [
                '[opentype.js] substitutionType: 31 lookupType: 3 - substFormat: 1 is not yet supported, lookup skipped',
                '[opentype.js] substitutionType: 81 lookupType: 8 - substFormat: 1 is not yet supported, lookup skipped'
            ]);
        });
    });

    // the font of test/lookup-flags-font.mjs; the rules of the latinFeatures.spec.mjs tests of the lookupFlag in the
    // other formats, the same matches in HarfBuzz: in the lookups of IgnoreMarks the mark between a and b is skipped
    // hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature of the lookup> LookupFlags.ttf -u <code points>
    describe('lookupFlag', function() {
        const { a: glyphA, b: glyphB, c: glyphC, acute, dotbelow, alef, fatha, lam } = glyphIndexes;
        const aAlternate = glyphIndexes['a.alt'];
        const bAlternate = glyphIndexes['b.alt'];
        const IGNORE_BASE_GLYPHS = 0x0002;
        const IGNORE_MARKS = 0x0008;
        // lookup 0: sub a by a.alt; lookup 1: sub b by b.alt; the lookup under test is lookup 2
        const nestedLookups = [
            { lookupType: 1, lookupFlag: 0, subtables: [{ substFormat: 2, coverage: { format: 1, glyphs: [glyphA] }, substitute: [aAlternate] }] },
            { lookupType: 1, lookupFlag: 0, subtables: [{ substFormat: 2, coverage: { format: 1, glyphs: [glyphB] }, substitute: [bAlternate] }] }
        ];
        const aCoverage = { format: 1, glyphs: [glyphA] };
        const bCoverage = { format: 1, glyphs: [glyphB] };

        function createQuery(lookupTable, scriptTag = 'latn', featureTag = 'calt') {
            const lookups = nestedLookups.concat([lookupTable]);
            return new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable(scriptTag, featureTag, [2], lookups) }));
        }

        // the substitution of a lookup at a position of a context
        function substituteIn(lookupTable, context, position) {
            const action = createQuery(lookupTable).lookupSubstitution(lookupTable, new ContextParams(context, position), 'calt');
            return action && action.substitution;
        }

        // the substitution of a lookup at a position of a, acute, b
        function substituteAt(lookupTable, position) {
            return substituteIn(lookupTable, [glyphA, acute, glyphB], position);
        }

        it('skips the marks of the input sequence: context formats 1, 2 and 3', function() {
            // lookupflag IgnoreMarks; sub a' b' lookup SUB_B; -u 0061,0301,0062: [1=0+500|5=1+0|8=2+500]
            const lookupRecords = [{ sequenceIndex: 1, lookupListIndex: 1 }];
            const subtables = [
                { substFormat: 1, coverage: aCoverage, ruleSets: [[{ input: [glyphB], lookupRecords }]] },
                { substFormat: 2, coverage: aCoverage, classDef, classSets: [[], [{ classes: [1], lookupRecords }]] },
                { substFormat: 3, coverages: [aCoverage, bCoverage], lookupRecords }
            ];
            for (const subtable of subtables) {
                const lookupTable = { lookupType: 5, lookupFlag: IGNORE_MARKS, subtables: [subtable] };
                assert.deepStrictEqual(substituteAt(lookupTable, 0), contextualMatch([nestedSubstitution(2, 12, bAlternate)], 3), `format ${subtable.substFormat}`);
                assert.equal(substituteAt({ ...lookupTable, lookupFlag: 0 }, 0), null, `format ${subtable.substFormat} without the flag`);
            }
        });

        it('skips the marks of the backtrack: chaining context formats 1, 2 and 3', function() {
            // lookupflag IgnoreMarks; sub a b' by b.alt; -u 0061,0301,0062: [1=0+500|5=1+0|8=2+500]
            const lookupRecords = [{ sequenceIndex: 0, lookupListIndex: 1 }];
            const subtables = [
                { substFormat: 1, coverage: bCoverage, chainRuleSets: [[{ backtrack: [glyphA], input: [], lookahead: [], lookupRecords }]] },
                {
                    substFormat: 2,
                    coverage: bCoverage,
                    backtrackClassDef: classDef,
                    inputClassDef: classDef,
                    lookaheadClassDef: classDef,
                    chainClassSet: [[], [{ backtrack: [1], input: [], lookahead: [], lookupRecords }]]
                },
                { substFormat: 3, backtrackCoverage: [aCoverage], inputCoverage: [bCoverage], lookaheadCoverage: [], lookupRecords }
            ];
            for (const subtable of subtables) {
                const lookupTable = { lookupType: 6, lookupFlag: IGNORE_MARKS, subtables: [subtable] };
                assert.deepStrictEqual(substituteAt(lookupTable, 2), contextualMatch([nestedSubstitution(0, 12, bAlternate)], 1), `format ${subtable.substFormat}`);
                assert.equal(substituteAt({ ...lookupTable, lookupFlag: 0 }, 2), null, `format ${subtable.substFormat} without the flag`);
            }
        });

        it('skips the marks of the lookahead: chaining context formats 1, 2 and 3', function() {
            // lookupflag IgnoreMarks; sub a' b by a.alt; -u 0061,0301,0062: [7=0+500|5=1+0|2=2+500]
            const lookupRecords = [{ sequenceIndex: 0, lookupListIndex: 0 }];
            const subtables = [
                { substFormat: 1, coverage: aCoverage, chainRuleSets: [[{ backtrack: [], input: [], lookahead: [glyphB], lookupRecords }]] },
                {
                    substFormat: 2,
                    coverage: aCoverage,
                    backtrackClassDef: classDef,
                    inputClassDef: classDef,
                    lookaheadClassDef: classDef,
                    chainClassSet: [[], [{ backtrack: [], input: [], lookahead: [1], lookupRecords }]]
                },
                { substFormat: 3, backtrackCoverage: [], inputCoverage: [aCoverage], lookaheadCoverage: [bCoverage], lookupRecords }
            ];
            for (const subtable of subtables) {
                const lookupTable = { lookupType: 6, lookupFlag: IGNORE_MARKS, subtables: [subtable] };
                assert.deepStrictEqual(substituteAt(lookupTable, 0), contextualMatch([nestedSubstitution(0, 12, aAlternate)], 1), `format ${subtable.substFormat}`);
                assert.equal(substituteAt({ ...lookupTable, lookupFlag: 0 }, 0), null, `format ${subtable.substFormat} without the flag`);
            }
        });

        it('matches the components of a ligature across the marks, with their offsets from the first one', function() {
            // lookupflag IgnoreMarks; sub a b by a_b; -u 0061,0301,0062: [9=0+500|5=0+0]
            const lookupTable = {
                lookupType: 4,
                lookupFlag: IGNORE_MARKS,
                subtables: [{ substFormat: 1, coverage: aCoverage, ligatureSets: [[{ ligGlyph: glyphIndexes.a_b, components: [glyphB] }]] }]
            };
            assert.deepStrictEqual(substituteAt(lookupTable, 0), { ligGlyph: glyphIndexes.a_b, componentOffsets: [2] });
            assert.equal(substituteAt({ ...lookupTable, lookupFlag: 0 }, 0), null);
        });

        it('matches a ligature of one component, the current glyph', function() {
            // LookupFlagsOneComponentLigature.ttf: the ligature of ss10 with the component a only, by a.alt
            // --features=-kern,+ss10 LookupFlagsOneComponentLigature.ttf -u 0061,0062: [7=0+500|2=1+500]
            const lookupTable = {
                lookupType: 4,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, coverage: aCoverage, ligatureSets: [[{ ligGlyph: aAlternate, components: [] }]] }]
            };
            assert.deepStrictEqual(substituteIn(lookupTable, [glyphA, glyphB], 0), { ligGlyph: aAlternate, componentOffsets: [] });
        });

        it('ignores the glyph classes of a GDEF table HarfBuzz ignores: ligature and single substitution', function() {
            // LookupFlagsBlocklistedGDEF.ttf: the GDEF table of LookupFlags.ttf, where ff is a ligature, padded with its GSUB and GPOS
            // tables to the lengths of a font of the blocklist of HarfBuzz, which drops the GDEF table and synthesizes the glyph
            // classes from the general category (GDEF::accelerator_t, hb_synthesize_glyph_classes): ff (U+FB00, Ll) is a base
            const IGNORE_LIGATURES = 0x0004;
            const { ff } = glyphIndexes;
            const ligatureLookup = {
                lookupType: 4,
                lookupFlag: IGNORE_LIGATURES,
                subtables: [{ substFormat: 1, coverage: aCoverage, ligatureSets: [[{ ligGlyph: glyphIndexes.a_b, components: [glyphB] }]] }]
            };
            const singleLookup = {
                lookupType: 1,
                lookupFlag: IGNORE_LIGATURES,
                subtables: [{ substFormat: 2, coverage: { format: 1, glyphs: [ff] }, substitute: [glyphIndexes.a_b_c] }]
            };
            const createBlocklistedQuery = lookupTable => {
                const query = createQuery(lookupTable);
                query.font.isGdefIgnoredByLayout = true;
                return query;
            };
            const substituteWith = (query, lookupTable, context) => {
                const action = query.lookupSubstitution(lookupTable, new ContextParams(context, 0), 'calt');
                return action && action.substitution;
            };
            // ss01: lookupflag IgnoreLigatures; sub a b by a_b; --features=-kern,+ss01 -u 0061,FB00,0062: [1=0+500|4=1+500|2=2+500],
            // no ligature across ff; the same lookup with the GDEF table, ss18 of LookupFlags.ttf: [9=0+500|4=0+500]
            assert.equal(substituteWith(createBlocklistedQuery(ligatureLookup), ligatureLookup, [glyphA, ff, glyphB]), null);
            const ligature = substituteWith(createQuery(ligatureLookup), ligatureLookup, [glyphA, ff, glyphB]);
            assert.deepStrictEqual(ligature, { ligGlyph: glyphIndexes.a_b, componentOffsets: [2] });
            // ss02: lookupflag IgnoreLigatures; sub ff by a_b_c; --features=-kern,+ss02 -u 0061,FB00,0062: [1=0+500|10=1+500|2=2+500];
            // with the GDEF table the lookup does not apply at the ligature ff
            assert.equal(substituteWith(createBlocklistedQuery(singleLookup), singleLookup, [ff]), glyphIndexes.a_b_c);
            assert.equal(substituteWith(createQuery(singleLookup), singleLookup, [ff]), null);
        });

        it('maps the sequence indexes of the input to their offsets across the marks: context formats 1, 2 and 3', function() {
            // ss15: lookupflag IgnoreMarks; sub a' b' a' lookup SUB_A; (the nested lookup at the sequence index 2)
            // -u 0061,0301,0062,0323,0061: [1=0+500|5=1+0|2=2+500|6=3+0|7=4+500]
            const lookupRecords = [{ sequenceIndex: 2, lookupListIndex: 0 }];
            const subtables = [
                { substFormat: 1, coverage: aCoverage, ruleSets: [[{ input: [glyphB, glyphA], lookupRecords }]] },
                { substFormat: 2, coverage: aCoverage, classDef, classSets: [[], [{ classes: [1, 1], lookupRecords }]] },
                { substFormat: 3, coverages: [aCoverage, bCoverage, aCoverage], lookupRecords }
            ];
            for (const subtable of subtables) {
                const lookupTable = { lookupType: 5, lookupFlag: IGNORE_MARKS, subtables: [subtable] };
                const substitutions = substituteIn(lookupTable, [glyphA, acute, glyphB, dotbelow, glyphA], 0);
                assert.deepStrictEqual(substitutions, contextualMatch([nestedSubstitution(4, 12, aAlternate)], 5), `format ${subtable.substFormat}`);
            }
        });

        it('matches the lookahead after the last input glyph: chaining context formats 1, 2 and 3', function() {
            // ss12: lookupflag IgnoreMarks; sub a' lookup SUB_A b' c;
            // -u 0061,0062,0301,0063: [7=0+500|2=1+500|5=2+0|3=3+500]
            for (const subtable of chainingSubtables([], [glyphA, glyphB], [glyphC], [{ sequenceIndex: 0, lookupListIndex: 0 }])) {
                const lookupTable = { lookupType: 6, lookupFlag: IGNORE_MARKS, subtables: [subtable] };
                const message = `format ${subtable.substFormat}`;
                const aSubstitution = nestedSubstitution(0, 12, aAlternate);
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphA, glyphB, acute, glyphC], 0), contextualMatch([aSubstitution], 2), message);
                // -u 0061,0301,0062,0063: [7=0+500|5=1+0|2=2+500|3=3+500], the mark inside the input
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphA, acute, glyphB, glyphC], 0), contextualMatch([aSubstitution], 3), `inside ${message}`);
                // -u 0061,0062,0063: [7=0+500|2=1+500|3=2+500]
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphA, glyphB, glyphC], 0), contextualMatch([aSubstitution], 2), message);
            }
        });

        it('matches the backtrack before the current glyph, a nested lookup after a mark: chaining context formats 1, 2 and 3', function() {
            // ss13: lookupflag IgnoreMarks; sub c a' b' lookup SUB_B;
            for (const subtable of chainingSubtables([glyphC], [glyphA, glyphB], [], [{ sequenceIndex: 1, lookupListIndex: 1 }])) {
                const lookupTable = { lookupType: 6, lookupFlag: IGNORE_MARKS, subtables: [subtable] };
                // -u 0063,0301,0061,0062: [3=0+500|5=1+0|1=2+500|8=3+500]
                const message = `format ${subtable.substFormat}`;
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphC, acute, glyphA, glyphB], 2), contextualMatch([nestedSubstitution(1, 12, bAlternate)], 2), message);
                // -u 0063,0061,0301,0062: [3=0+500|1=1+500|5=2+0|8=3+500]
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphC, glyphA, acute, glyphB], 1), contextualMatch([nestedSubstitution(2, 12, bAlternate)], 3), message);
            }
        });

        it('matches each glyph of a multiple substitution as a glyph of its own: chaining context formats 1, 2 and 3', function() {
            // ss14: sub c by a acute; then lookupflag IgnoreMarks; sub b' a by b.alt;
            // -u 0062,0063: [8=0+500|1=1+500|5=1+0], the lookahead a is the first glyph of the glyphs of c
            for (const subtable of chainingSubtables([], [glyphB], [glyphA], [{ sequenceIndex: 0, lookupListIndex: 1 }])) {
                const lookupTable = { lookupType: 6, lookupFlag: IGNORE_MARKS, subtables: [subtable] };
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphB, glyphA, acute], 0), contextualMatch([nestedSubstitution(0, 12, bAlternate)], 1), `format ${subtable.substFormat}`);
                assert.equal(substituteIn(lookupTable, [glyphB, acute, glyphC], 0), null, `format ${subtable.substFormat}`);
            }
        });

        it('matches the first glyph of a multiple substitution as the current glyph: context and chaining context formats 1, 2 and 3', function() {
            // ss21: sub c by a acute; then lookupflag IgnoreMarks; sub a' b' lookup SUB_B;
            // --features=-kern,+ss21 -u 0063,0062: [1=0+500|5=0+0|8=1+500], the current glyph a is the first glyph of the glyphs of c
            const lookupRecords = [{ sequenceIndex: 1, lookupListIndex: 1 }];
            const contextSubtables = [
                { substFormat: 1, coverage: aCoverage, ruleSets: [[{ input: [glyphB], lookupRecords }]] },
                { substFormat: 2, coverage: aCoverage, classDef, classSets: [[], [{ classes: [1], lookupRecords }]] },
                { substFormat: 3, coverages: [aCoverage, bCoverage], lookupRecords }
            ];
            const lookupTables = [
                ...contextSubtables.map(subtable => ({ lookupType: 5, lookupFlag: IGNORE_MARKS, subtables: [subtable] })),
                ...chainingSubtables([], [glyphA, glyphB], [], lookupRecords).map(subtable => ({ lookupType: 6, lookupFlag: IGNORE_MARKS, subtables: [subtable] }))
            ];
            for (const lookupTable of lookupTables) {
                const message = `lookup type ${lookupTable.lookupType} format ${lookupTable.subtables[0].substFormat}`;
                // the glyphs of c, a acute, then b: the acute is a glyph of its own that the lookup skips
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphA, acute, glyphB], 0), contextualMatch([nestedSubstitution(2, 12, bAlternate)], 3), message);
            }
        });

        it('does not apply a lookup at the first glyph of a multiple substitution that it ignores', function() {
            // ss19: sub c by a acute; then lookupflag IgnoreBaseGlyphs; sub a' lookup SUB_A;
            // --features=-kern,+ss19 -u 0063,0062: [1=0+500|5=0+0|2=1+500], a stays a
            const lookupTable = {
                lookupType: 6,
                lookupFlag: IGNORE_BASE_GLYPHS,
                subtables: [chainingSubtables([], [glyphA], [], [{ sequenceIndex: 0, lookupListIndex: 0 }])[2]]
            };
            // the glyphs of c, a acute, then b
            const context = [glyphA, acute, glyphB];
            assert.equal(substituteIn(lookupTable, context, 0), null);
            // ss20, the same rule without the flag: [7=0+500|5=0+0|2=1+500]
            assert.deepStrictEqual(substituteIn({ ...lookupTable, lookupFlag: 0 }, context, 0), contextualMatch([nestedSubstitution(0, 12, aAlternate)], 1));
        });

        it('matches nothing with a rule of format 3 without input glyphs', function() {
            // ss01 and ss02 of the font with a GlyphCount (ContextSubst format 3) and an InputGlyphCount
            // (ChainContextSubst format 3) of 0: HarfBuzz substitutes nothing
            // --features=-kern,+ss01 LookupFlagsEmptyContextInput.ttf -u 0061,0301,0062: [1=0+500|5=1+0|2=2+500]
            const lookupRecords = [{ sequenceIndex: 0, lookupListIndex: 1 }];
            const contextLookup = { lookupType: 5, lookupFlag: IGNORE_MARKS, subtables: [{ substFormat: 3, coverages: [], lookupRecords }] };
            // --features=-kern,+ss02 LookupFlagsEmptyChainInput.ttf -u 0061,0301,0062: [1=0+500|5=1+0|2=2+500]
            const chainingLookup = {
                lookupType: 6,
                lookupFlag: IGNORE_MARKS,
                subtables: [{ substFormat: 3, backtrackCoverage: [aCoverage], inputCoverage: [], lookaheadCoverage: [], lookupRecords }]
            };
            for (const lookupTable of [contextLookup, chainingLookup]) {
                for (const position of [0, 2]) {
                    assert.equal(substituteAt(lookupTable, position), null, `lookup type ${lookupTable.lookupType} at ${position}`);
                }
            }
        });

        it('matches no item of class 0 past the end or the start of the context: context and chaining context format 2', function() {
            // LookupFlags.ttf with these subtables (a b in class 1, sub a by a.alt at the sequence index 0) in ss01, ss02
            // and ss03, without lookupFlag: hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature>
            const lookupRecords = [{ sequenceIndex: 0, lookupListIndex: 0 }];
            const chainingSubtable = (backtrack, lookahead) => ({
                substFormat: 2,
                coverage: aCoverage,
                backtrackClassDef: classDef,
                inputClassDef: classDef,
                lookaheadClassDef: classDef,
                chainClassSet: [[], [{ backtrack, input: [], lookahead, lookupRecords }]]
            });
            const { ff } = glyphIndexes;
            // ss01, a then class 0: -u 0061: [1=0+500], -u 0061,FB00: [7=0+500|4=1+500]
            const contextLookup = { lookupType: 5, lookupFlag: 0, subtables: [{ substFormat: 2, coverage: aCoverage, classDef, classSets: [[], [{ classes: [0], lookupRecords }]] }] };
            assert.equal(substituteIn(contextLookup, [glyphA], 0), null);
            const aSubstitution = nestedSubstitution(0, 12, aAlternate);
            assert.deepStrictEqual(substituteIn(contextLookup, [glyphA, ff], 0), contextualMatch([aSubstitution], 2));
            // ss02, the lookahead class 0: -u 0061: [1=0+500], -u 0061,FB00: [7=0+500|4=1+500]
            const lookaheadLookup = { lookupType: 6, lookupFlag: 0, subtables: [chainingSubtable([], [0])] };
            assert.equal(substituteIn(lookaheadLookup, [glyphA], 0), null);
            assert.deepStrictEqual(substituteIn(lookaheadLookup, [glyphA, ff], 0), contextualMatch([aSubstitution], 1));
            // ss03, the backtrack class 0: -u 0061: [1=0+500], -u FB00,0061: [4=0+500|7=1+500]
            const backtrackLookup = { lookupType: 6, lookupFlag: 0, subtables: [chainingSubtable([0], [])] };
            assert.equal(substituteIn(backtrackLookup, [glyphA], 0), null);
            assert.deepStrictEqual(substituteIn(backtrackLookup, [ff, glyphA], 1), contextualMatch([aSubstitution], 1));
        });

        it('matches nothing at a glyph outside of the first coverage of a rule of format 3: context and chaining context', function() {
            // ss01: lookupflag IgnoreMarks; sub a' b' lookup SUB_B; at b b, whose second b matches the second coverage
            // --features=-kern,+ss01 -u 0062,0062: [2=0+500|2=1+500]
            const contextLookup = {
                lookupType: 5,
                lookupFlag: IGNORE_MARKS,
                subtables: [{ substFormat: 3, coverages: [aCoverage, bCoverage], lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 1 }] }]
            };
            assert.equal(substituteIn(contextLookup, [glyphB, glyphB], 0), null);
            // ss13: lookupflag IgnoreMarks; sub c a' b' lookup SUB_B; at the first b of c b b
            // --features=-kern,+ss13 -u 0063,0062,0062: [3=0+500|2=1+500|2=2+500]
            const chainingSubtable = chainingSubtables([glyphC], [glyphA, glyphB], [], [{ sequenceIndex: 1, lookupListIndex: 1 }])[2];
            const chainingLookup = { lookupType: 6, lookupFlag: IGNORE_MARKS, subtables: [chainingSubtable] };
            assert.equal(substituteIn(chainingLookup, [glyphC, glyphB, glyphB], 1), null);
        });

        describe('an extension lookup', function() {
            // LookupFlagsExtension.ttf: ss03 (lookupflag IgnoreMarks; sub a' b by a.alt;) in an extension lookup
            // --features=-kern,+ss03 LookupFlagsExtension.ttf -u 0061,0301,0062: [7=0+500|5=1+0|2=2+500]
            const extensionLookup = {
                lookupType: 7,
                lookupFlag: IGNORE_MARKS,
                subtables: [{
                    substFormat: 1,
                    lookupType: 6,
                    extension: chainingSubtables([], [glyphA], [glyphB], [{ sequenceIndex: 0, lookupListIndex: 0 }])[2]
                }]
            };

            it('skips the glyphs its lookupFlag ignores in a contextual rule, not the flags of its subtable', function() {
                assert.deepStrictEqual(substituteAt(extensionLookup, 0), contextualMatch([nestedSubstitution(0, 12, aAlternate)], 1));
            });
        });

        // lookupflag IgnoreMarks; sub acute by acute.alt;
        const acuteLookup = {
            lookupType: 1,
            lookupFlag: IGNORE_MARKS,
            subtables: [{ substFormat: 2, coverage: { format: 1, glyphs: [acute] }, substitute: [glyphIndexes['acute.alt']] }]
        };

        it('does not apply a lookup at a glyph it ignores', function() {
            // HarfBuzz checks the glyph before the lookup applies (apply_forward)
            assert.equal(substituteAt(acuteLookup, 1), null);
            assert.equal(substituteAt({ ...acuteLookup, lookupFlag: 0 }, 1), glyphIndexes['acute.alt']);
        });

        it('applies the lookupFlag of a chaining lookup and of a single lookup of a feature of the default language system of a script', function() {
            // the lookahead rule above in the ccmp feature of thai
            const lookaheadLookup = {
                lookupType: 6,
                lookupFlag: IGNORE_MARKS,
                subtables: [{
                    substFormat: 3,
                    backtrackCoverage: [],
                    inputCoverage: [aCoverage],
                    lookaheadCoverage: [bCoverage],
                    lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }]
                }]
            };
            const substituteInFeature = (lookupTable, scriptTag, featureTag, context, position) => {
                const action = createQuery(lookupTable, scriptTag, featureTag).lookupSubstitution(lookupTable, new ContextParams(context, position), featureTag);
                return action && action.substitution;
            };
            assert.deepStrictEqual(substituteInFeature(lookaheadLookup, 'thai', 'ccmp', [glyphA, acute, glyphB], 0), contextualMatch([nestedSubstitution(0, 12, aAlternate)], 1));
            assert.strictEqual(substituteInFeature(acuteLookup, 'thai', 'ccmp', [glyphA, acute, glyphB], 1), null);
        });

        it('matches the components of a ligature across the marks, in the rlig of arab', function() {
            // rlig: lookupflag IgnoreMarks; sub lam alef by lam_alef;
            // --features=-kern -u 0644,064E,0627 (rlig is on by default): [14=0+0|19=0+500]
            const ligatureLookup = {
                lookupType: 4,
                lookupFlag: IGNORE_MARKS,
                subtables: [{
                    substFormat: 1,
                    coverage: { format: 1, glyphs: [lam] },
                    ligatureSets: [[{ ligGlyph: glyphIndexes.lam_alef, components: [alef] }]]
                }]
            };
            const ligatureQuery = createQuery(ligatureLookup, 'arab', 'rlig');
            const action = ligatureQuery.lookupSubstitution(ligatureLookup, new ContextParams([lam, fatha, alef], 0), 'rlig');
            assert.deepStrictEqual(action.substitution, { ligGlyph: glyphIndexes.lam_alef, componentOffsets: [2] });
        });
    });

    // the font of test/lookup-flags-font.mjs; the rules of the nested multiple substitutions of contextualNestedLookups.spec.mjs
    // hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature of the lookup> LookupFlags.ttf -u <code points>
    // (or a variant of LookupFlags.ttf of test/generate-lookup-flags-font.py)
    describe('nested multiple substitutions', function() {
        const { a: glyphA, b: glyphB, c: glyphC, acute } = glyphIndexes;
        const acuteAlternate = glyphIndexes['acute.alt'];
        const IGNORE_MARKS = 0x0008;
        const multipleThenSingleRecords = [{ sequenceIndex: 0, lookupListIndex: 0 }, { sequenceIndex: 1, lookupListIndex: 1 }];
        const bAlternate = glyphIndexes['b.alt'];
        // the nested substitution of c by the glyphs of MULTIPLE_C, at the offset 0
        const multipleCSubstitution = sequence => nestedSubstitution(0, 21, sequence);

        // the substitution of a contextual lookup at a position of a context, with the nested lookups
        // 0: MULTIPLE_C, sub c by a acute; (or the given sequence) and 1: SUB_ACUTE_B, sub acute by acute.alt; sub b by b.alt;
        function substituteIn(lookupTable, context, position, sequence = [glyphA, acute]) {
            const lookups = [createMultipleLookup([glyphC], [sequence]), subAcuteBLookup, lookupTable];
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [2], lookups) }));
            const action = query.lookupSubstitution(lookupTable, new ContextParams(context, position), 'calt');
            return action && action.substitution;
        }

        it('gives the glyphs of a nested multiple substitution, with the substitutions of the later lookup records', function() {
            // ss23: sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B;
            // -u 0063,0062: [1=0+500|11=0+0|2=1+500], the sequence index 1 is the acute of the glyphs of c, b is kept
            const contextLookup = {
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{ substFormat: 3, coverages: createCoverages([glyphC, glyphB]), lookupRecords: multipleThenSingleRecords }]
            };
            const substitutions = [multipleCSubstitution([glyphA, acute]), nestedSubstitution(1, 12, acuteAlternate)];
            assert.deepStrictEqual(substituteIn(contextLookup, [glyphC, glyphB], 0), contextualMatch(substitutions, 3));
            // ss24: lookupflag IgnoreMarks; sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B c;
            // -u 0063,0062,0063: [1=0+500|11=0+0|2=1+500|3=2+500]
            const chainingLookup = {
                lookupType: 6,
                lookupFlag: IGNORE_MARKS,
                subtables: [{
                    substFormat: 3,
                    backtrackCoverage: [],
                    inputCoverage: createCoverages([glyphC, glyphB]),
                    lookaheadCoverage: createCoverages([glyphC]),
                    lookupRecords: multipleThenSingleRecords
                }]
            };
            assert.deepStrictEqual(substituteIn(chainingLookup, [glyphC, glyphB, glyphC], 0), contextualMatch(substitutions, 3));
        });

        // the rule of ss23 (sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B;) with the given lookup records
        const ss23Lookup = lookupRecords => ({
            lookupType: 5,
            lookupFlag: 0,
            subtables: [{ substFormat: 3, coverages: createCoverages([glyphC, glyphB]), lookupRecords }]
        });

        it('counts the input glyphs after a nested multiple substitution from its last glyph', function() {
            // the rule of ss23 with the second record at the sequence index 2: c b, then a acute b, the glyph at the index 2 is b
            // --features=-kern,+ss23 LookupFlagsNestedSequenceIndex.ttf -u 0063,0062: [1=0+500|5=0+0|8=1+500]
            const substitutions = [multipleCSubstitution([glyphA, acute]), nestedSubstitution(2, 12, bAlternate)];
            const sequenceIndexRecords = [{ sequenceIndex: 0, lookupListIndex: 0 }, { sequenceIndex: 2, lookupListIndex: 1 }];
            assert.deepStrictEqual(substituteIn(ss23Lookup(sequenceIndexRecords), [glyphC, glyphB], 0), contextualMatch(substitutions, 3));
            // ss54 with the second record at the sequence index 2: sub c' lookup MULTIPLE_C_A_ACUTE_B lookup SUB_ACUTE_B; (sub c by
            // a acute b;), the glyph at the index 2 is the third glyph of c
            // --features=-kern,+ss54 LookupFlagsNestedMultipleThreeSequenceIndex.ttf -u 0063: [1=0+500|5=0+0|8=0+500]
            const threeGlyphsLookup = {
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{ substFormat: 3, coverages: createCoverages([glyphC]), lookupRecords: sequenceIndexRecords }]
            };
            const threeGlyphsSubstitutions = [multipleCSubstitution([glyphA, acute, glyphB]), nestedSubstitution(2, 12, bAlternate)];
            const threeGlyphsMatch = substituteIn(threeGlyphsLookup, [glyphC], 0, [glyphA, acute, glyphB]);
            assert.deepStrictEqual(threeGlyphsMatch, contextualMatch(threeGlyphsSubstitutions, 3));
            // a nested multiple substitution into no glyph removes it from the input: with sub c by NULL; the index 0 is b
            // --features=-kern,+ss23 LookupFlagsNestedDeletion.ttf -u 0063,0062: [8=0+500]
            const deletions = [multipleCSubstitution([]), nestedSubstitution(0, 12, bAlternate)];
            const deletionRecords = [{ sequenceIndex: 0, lookupListIndex: 0 }, { sequenceIndex: 0, lookupListIndex: 1 }];
            assert.deepStrictEqual(substituteIn(ss23Lookup(deletionRecords), [glyphC, glyphB], 0, []), contextualMatch(deletions, 1));
        });

        it('skips a lookup record whose sequence index is past the end of the input after a nested multiple substitution', function() {
            // the rule of ss23 with the second record at the sequence index 3: c b, then a acute b, there is no glyph at the index 3
            // --features=-kern,+ss23 LookupFlagsNestedSequenceIndexPastEnd.ttf -u 0063,0062: [1=0+500|5=0+0|2=1+500], b is kept
            const pastEndRecords = [{ sequenceIndex: 0, lookupListIndex: 0 }, { sequenceIndex: 3, lookupListIndex: 1 }];
            assert.deepStrictEqual(substituteIn(ss23Lookup(pastEndRecords), [glyphC, glyphB], 0), contextualMatch([multipleCSubstitution([glyphA, acute])], 3));
        });

        it('applies the lookup records after one whose sequence index is past the end of the input', function() {
            // the rule of ss23 with the records at the sequence indexes 0, 3 and 2: there is no glyph at the index 3, b is at the index 2
            // --features=-kern,+ss23 LookupFlagsNestedSequenceIndexPastEndThenValid.ttf -u 0063,0062: [1=0+500|5=0+0|8=1+500]
            const substitutions = [multipleCSubstitution([glyphA, acute]), nestedSubstitution(2, 12, bAlternate)];
            const pastEndThenValidRecords = [
                { sequenceIndex: 0, lookupListIndex: 0 },
                { sequenceIndex: 3, lookupListIndex: 1 },
                { sequenceIndex: 2, lookupListIndex: 1 }
            ];
            assert.deepStrictEqual(substituteIn(ss23Lookup(pastEndThenValidRecords), [glyphC, glyphB], 0), contextualMatch(substitutions, 3));
        });

        it('applies a later lookup record at the index of a deleted glyph to the next input glyph, not to a glyph the lookup skips', function() {
            // the rule of ss24 with sub c by NULL; and the second record at the sequence index 0: c acute b c, the acute skipped by
            // IgnoreMarks. Each record applies to the results of the previous ones (OpenType, Common Table Formats, sequence lookup
            // records): the deleted c leaves the input sequence, whose glyph at the index 0 is b. The specification prohibits a
            // multiple substitution into no glyph; HarfBuzz keeps the match position of the deleted c, now the acute, and drops the
            // one of b (apply_lookup, whose comment calls it an approximation of the deletion of the current match position):
            // --features=-kern,+ss24 LookupFlagsNestedDeletionSkippedMark.ttf -u 0063,0301,0062,0063: [11=0+0|2=2+500|3=3+500]
            const chainingLookup = {
                lookupType: 6,
                lookupFlag: IGNORE_MARKS,
                subtables: [{
                    substFormat: 3,
                    backtrackCoverage: [],
                    inputCoverage: createCoverages([glyphC, glyphB]),
                    lookaheadCoverage: createCoverages([glyphC]),
                    lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }, { sequenceIndex: 0, lookupListIndex: 1 }]
                }]
            };
            // b at the offset 1 after the deletion of c
            const deletions = [multipleCSubstitution([]), nestedSubstitution(1, 12, bAlternate)];
            assert.deepStrictEqual(substituteIn(chainingLookup, [glyphC, acute, glyphB, glyphC], 0, []), contextualMatch(deletions, 2));
        });

        it('applies a later lookup record at the index after the one of a deleted glyph to the input glyph after the next one', function() {
            // calt: lookupflag IgnoreMarks; sub c' lookup DELETE_C b' lookup SUB_ACUTE_B b'; (sub c by NULL;) on c acute b b, the
            // acute skipped: the deleted c leaves the input sequence, whose glyph at the index 1 is the second b. HarfBuzz drops the
            // match position of the first b, so its index 1 is the second b too:
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsNestedDeletionNextRecord.ttf -u 0063,0301,0062,0062
            // [5=0+0|2=2+500|8=3+500]
            const contextLookup = {
                lookupType: 5,
                lookupFlag: IGNORE_MARKS,
                subtables: [{
                    substFormat: 3,
                    coverages: createCoverages([glyphC, glyphB, glyphB]),
                    lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }, { sequenceIndex: 1, lookupListIndex: 1 }]
                }]
            };
            // the second b at the offset 2 after the deletion of c
            const deletions = [multipleCSubstitution([]), nestedSubstitution(2, 12, bAlternate)];
            assert.deepStrictEqual(substituteIn(contextLookup, [glyphC, acute, glyphB, glyphB], 0, []), contextualMatch(deletions, 3));
        });

        it('skips a later lookup record at the index of a deleted last input glyph, not applying it to the glyph after the input', function() {
            // calt: sub a' c' lookup DELETE_C lookup SUB_ACUTE_B; (sub c by NULL;) on a c b: the deleted c leaves the input
            // sequence, which has no glyph at the index 1 any more, so b, after the input, is kept. HarfBuzz keeps the match
            // position of the deleted last input glyph, now b, and substitutes it:
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsNestedDeletionLastInput.ttf -u 0061,0063,0062
            // [1=0+500|8=2+500]
            const contextLookup = {
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 3,
                    coverages: createCoverages([glyphA, glyphC]),
                    lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 0 }, { sequenceIndex: 1, lookupListIndex: 1 }]
                }]
            };
            assert.deepStrictEqual(substituteIn(contextLookup, [glyphA, glyphC, glyphB], 0, []), contextualMatch([nestedSubstitution(1, 21, [])], 1));
        });
    });

    describe('getSubstitutionGlyphEdits', function() {
        it('replaces the glyph of a single or multiple substitution, and the components of a ligature from the last one', function() {
            assert.deepStrictEqual(getSubstitutionGlyphEdits({ id: 12, substitution: 8 }), [{ offset: 0, glyphIndexes: [8] }]);
            assert.deepStrictEqual(getSubstitutionGlyphEdits({ id: 21, substitution: [] }), [{ offset: 0, glyphIndexes: [] }]);
            const ligature = { id: 41, substitution: { ligGlyph: 10, componentOffsets: [1, 3] } };
            const ligatureEdits = [{ offset: 3, glyphIndexes: [] }, { offset: 1, glyphIndexes: [] }, { offset: 0, glyphIndexes: [10] }];
            assert.deepStrictEqual(getSubstitutionGlyphEdits(ligature), ligatureEdits);
        });

        it('throws for a substitution type that does not replace glyphs', function() {
            assert.throws(() => getSubstitutionGlyphEdits({ id: 63, substitution: { substitutions: [], inputLength: 1 } }), /type 63/);
        });
    });

    // the font of test/lookup-flags-font.mjs; the rules of ss36 to ss49, ss52 and ss53 of LookupFlags.ttf (test/generate-lookup-flags-font.py),
    // contextual rules that feaLib builds as context or chaining context subtables, here as chaining context format 3
    // hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature of the rule> LookupFlags.ttf -u <code points>
    describe('nested ligature substitutions', function() {
        const { a: glyphA, b: glyphB, c: glyphC, acute } = glyphIndexes;
        const IGNORE_MARKS = 0x0008;
        // the lookups 0: LIGATURE_NO_FLAG, sub a b by a_b; 1: SUB_ACUTE_B, sub acute by acute.alt; sub b by b.alt;
        // 2: LIGATURE_AT_MULTIPLE_IGNORE_MARKS, lookupflag IgnoreMarks; sub a b by a_b; 3: LIGATURE_A_ACUTE, sub a acute by a.alt;
        // 4: LIGATURE_A_B_C, sub a b c by a_b_c; 5: LIGATURE_ACUTE_B_IGNORE_MARKS, lookupflag IgnoreMarks; sub acute b by acute.alt;
        // 6: MULTIPLE_C_A_B, sub c by a b; 7: LIGATURE_AT_MULTIPLE_IGNORE_MARKS in an extension lookup
        const LIGATURE_NO_FLAG = 0;
        const SUB_ACUTE_B = 1;
        const LIGATURE_IGNORE_MARKS = 2;
        const LIGATURE_A_ACUTE = 3;
        const LIGATURE_A_B_C = 4;
        const LIGATURE_ACUTE_B_IGNORE_MARKS = 5;
        const MULTIPLE_C_A_B = 6;
        const EXTENSION_LIGATURE_IGNORE_MARKS = 7;
        const nestedLookups = [
            createLigatureLookup(glyphA, [glyphB], glyphIndexes.a_b),
            subAcuteBLookup,
            createLigatureLookup(glyphA, [glyphB], glyphIndexes.a_b, IGNORE_MARKS),
            createLigatureLookup(glyphA, [acute], glyphIndexes['a.alt']),
            createLigatureLookup(glyphA, [glyphB, glyphC], glyphIndexes.a_b_c),
            createLigatureLookup(acute, [glyphB], glyphIndexes['acute.alt'], IGNORE_MARKS),
            createMultipleLookup([glyphC], [[glyphA, glyphB]]),
            {
                lookupType: 7,
                lookupFlag: IGNORE_MARKS,
                subtables: [{ substFormat: 1, lookupType: 4, extension: createLigatureLookup(glyphA, [glyphB], glyphIndexes.a_b).subtables[0] }]
            }
        ];
        // the ligature a_b of the components at the offsets 0 and 1 (a b), or at the given offsets
        const abLigature = (componentOffsets = [1]) => nestedSubstitution(0, 41, { ligGlyph: glyphIndexes.a_b, componentOffsets });
        // the ligature a_b_c of the components at the offsets 0, 1 and 2 (a b c)
        const abcLigature = nestedSubstitution(0, 41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [1, 2] });

        // the substitution of a contextual lookup at a position of a context (its first glyph by default), with the nested lookups
        function substituteIn(lookupTable, context, position = 0) {
            const lookups = nestedLookups.concat([lookupTable]);
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [lookups.length - 1], lookups) }));
            const action = query.lookupSubstitution(lookupTable, new ContextParams(context, position), 'calt');
            return action && action.substitution;
        }

        // a chaining context lookup of format 3 of the input and lookahead glyphs, with the lookupFlag
        const chainingLookup = (input, lookahead, lookupRecords, lookupFlag = 0) => ({
            lookupType: 6,
            lookupFlag,
            subtables: [chainingSubtables([], input, lookahead, lookupRecords)[2]]
        });

        it('applies a nested ligature to the input glyphs from its lookup record: context and chaining context formats 1, 2 and 3', function() {
            // ss36: sub a' lookup LIGATURE_NO_FLAG b' c; -u 0061,0062,0063: [9=0+500|3=2+500], the lookup goes on at c
            const lookupRecords = [{ sequenceIndex: 0, lookupListIndex: LIGATURE_NO_FLAG }];
            const contextSubtables = [
                { substFormat: 1, coverage: createCoverage([glyphA]), ruleSets: [[{ input: [glyphB], lookupRecords }]] },
                { substFormat: 2, coverage: createCoverage([glyphA]), classDef, classSets: [[], [{ classes: [1], lookupRecords }]] },
                { substFormat: 3, coverages: createCoverages([glyphA, glyphB]), lookupRecords }
            ];
            const lookupTables = [
                ...contextSubtables.map(subtable => ({ lookupType: 5, lookupFlag: 0, subtables: [subtable] })),
                ...chainingSubtables([], [glyphA, glyphB], [glyphC], lookupRecords).map(subtable => ({ lookupType: 6, lookupFlag: 0, subtables: [subtable] }))
            ];
            for (const lookupTable of lookupTables) {
                const message = `lookup type ${lookupTable.lookupType} format ${lookupTable.subtables[0].substFormat}`;
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphA, glyphB, glyphC]), contextualMatch([abLigature()], 1), message);
            }
        });

        it('matches the components of a nested ligature with its own lookupFlag, not the one of the rule', function() {
            // ss37: sub a' lookup LIGATURE_AT_MULTIPLE_IGNORE_MARKS acute' b'; -u 0061,0301,0062: [9=0+500|5=0+0], the ligature
            // skips the acute of the input, which stays after it
            const skippedMarkLookup = chainingLookup([glyphA, acute, glyphB], [], [{ sequenceIndex: 0, lookupListIndex: LIGATURE_IGNORE_MARKS }]);
            assert.deepStrictEqual(substituteIn(skippedMarkLookup, [glyphA, acute, glyphB]), contextualMatch([abLigature([2])], 2));
            // ss41: lookupflag IgnoreMarks; sub a' lookup LIGATURE_NO_FLAG b'; -u 0061,0301,0062: [1=0+500|5=1+0|2=2+500], the
            // ligature does not skip the acute that the rule skips; -u 0061,0062: [9=0+500]
            const ruleIgnoreMarksLookup = chainingLookup([glyphA, glyphB], [], [{ sequenceIndex: 0, lookupListIndex: LIGATURE_NO_FLAG }], IGNORE_MARKS);
            assert.deepStrictEqual(substituteIn(ruleIgnoreMarksLookup, [glyphA, acute, glyphB]), contextualMatch([], 3));
            assert.deepStrictEqual(substituteIn(ruleIgnoreMarksLookup, [glyphA, glyphB]), contextualMatch([abLigature()], 1));
        });

        it('applies a nested ligature to the glyphs after the input of the rule, and goes on at the ligature glyph', function() {
            // ss38: sub a' lookup LIGATURE_NO_FLAG b; -u 0061,0062: [9=0+500], the lookahead b is a component; like HarfBuzz the
            // input ends at the ligature glyph, not before it, so the lookup goes on at a_b
            const pastInputLookup = chainingLookup([glyphA], [glyphB], [{ sequenceIndex: 0, lookupListIndex: LIGATURE_NO_FLAG }]);
            assert.deepStrictEqual(substituteIn(pastInputLookup, [glyphA, glyphB]), contextualMatch([abLigature()], 0));
        });

        it('points the later lookup records into the input shortened by a nested ligature', function() {
            // ss39: sub a' lookup LIGATURE_NO_FLAG b' lookup SUB_ACUTE_B acute'; -u 0061,0062,0301: [9=0+500|11=2+0], the sequence
            // index 1 is the acute after a_b
            const laterRecordLookup = chainingLookup([glyphA, glyphB, acute], [], [
                { sequenceIndex: 0, lookupListIndex: LIGATURE_NO_FLAG },
                { sequenceIndex: 1, lookupListIndex: SUB_ACUTE_B }
            ]);
            const acuteSubstitution = nestedSubstitution(1, 12, glyphIndexes['acute.alt']);
            assert.deepStrictEqual(substituteIn(laterRecordLookup, [glyphA, glyphB, acute]), contextualMatch([abLigature(), acuteSubstitution], 2));
            // ss40: sub a' lookup LIGATURE_NO_FLAG b' acute' lookup SUB_ACUTE_B; -u 0061,0062,0301: [9=0+500|5=2+0], no glyph at the
            // sequence index 2 of the input of two glyphs
            const pastEndLookup = chainingLookup([glyphA, glyphB, acute], [], [
                { sequenceIndex: 0, lookupListIndex: LIGATURE_NO_FLAG },
                { sequenceIndex: 2, lookupListIndex: SUB_ACUTE_B }
            ]);
            assert.deepStrictEqual(substituteIn(pastEndLookup, [glyphA, glyphB, acute]), contextualMatch([abLigature()], 2));
        });

        it('points a later lookup record at the mark that a nested ligature skips, not at the component after it', function() {
            // ss53: sub a' lookup LIGATURE_AT_MULTIPLE_IGNORE_MARKS acute' lookup SUB_ACUTE_B b'; -u 0061,0301,0062: [9=0+500|11=0+0],
            // the sequence index 1 is the acute after a_b
            const skippedMarkLookup = chainingLookup([glyphA, acute, glyphB], [], [
                { sequenceIndex: 0, lookupListIndex: LIGATURE_IGNORE_MARKS },
                { sequenceIndex: 1, lookupListIndex: SUB_ACUTE_B }
            ]);
            const acuteSubstitution = nestedSubstitution(1, 12, glyphIndexes['acute.alt']);
            assert.deepStrictEqual(substituteIn(skippedMarkLookup, [glyphA, acute, glyphB]), contextualMatch([abLigature([2]), acuteSubstitution], 2));
        });

        it('removes the input glyphs after a nested ligature, as many as its other components, like HarfBuzz', function() {
            // ss42: lookupflag IgnoreMarks; sub a' lookup LIGATURE_A_ACUTE b' lookup SUB_ACUTE_B; -u 0061,0301,0062: [7=0+500|2=2+500]:
            // the ligature removes the acute, which the rule skips, and HarfBuzz (apply_lookup) removes the input glyph after a
            // instead, b, so the record at the sequence index 1 has no glyph and b is kept
            const skippedByRuleLookup = chainingLookup([glyphA, glyphB], [], [
                { sequenceIndex: 0, lookupListIndex: LIGATURE_A_ACUTE },
                { sequenceIndex: 1, lookupListIndex: SUB_ACUTE_B }
            ], IGNORE_MARKS);
            const aAcuteLigature = nestedSubstitution(0, 41, { ligGlyph: glyphIndexes['a.alt'], componentOffsets: [1] });
            assert.deepStrictEqual(substituteIn(skippedByRuleLookup, [glyphA, acute, glyphB]), contextualMatch([aAcuteLigature], 2));
        });

        it('removes the input glyphs of the other components of a nested ligature of three components, from the last one', function() {
            // ss45 with the second lookup record at the sequence index 1 (LookupFlagsNestedLigatureSequenceIndex.ttf):
            // sub a' lookup LIGATURE_A_B_C b' c' acute' lookup SUB_ACUTE_B; -u 0061,0062,0063,0301: [10=0+500|11=3+0], the
            // sequence index 1 is the acute after a_b_c
            const laterRecordLookup = chainingLookup([glyphA, glyphB, glyphC, acute], [], [
                { sequenceIndex: 0, lookupListIndex: LIGATURE_A_B_C },
                { sequenceIndex: 1, lookupListIndex: SUB_ACUTE_B }
            ]);
            const acuteSubstitution = nestedSubstitution(1, 12, glyphIndexes['acute.alt']);
            assert.deepStrictEqual(substituteIn(laterRecordLookup, [glyphA, glyphB, glyphC, acute]), contextualMatch([abcLigature, acuteSubstitution], 2));
            // ss45: the second lookup record at the sequence index 3, past the end of the input of two glyphs after the ligature
            // -u 0061,0062,0063,0301: [10=0+500|5=3+0]
            const pastEndLookup = chainingLookup([glyphA, glyphB, glyphC, acute], [], [
                { sequenceIndex: 0, lookupListIndex: LIGATURE_A_B_C },
                { sequenceIndex: 3, lookupListIndex: SUB_ACUTE_B }
            ]);
            assert.deepStrictEqual(substituteIn(pastEndLookup, [glyphA, glyphB, glyphC, acute]), contextualMatch([abcLigature], 2));
        });

        it('ends the input at the ligature glyph of a nested ligature of two components after the input, not before it', function() {
            // ss44: sub a' lookup LIGATURE_A_B_C b c; -u 0061,0062,0063: [10=0+500], like HarfBuzz the lookup goes on at a_b_c
            const pastInputLookup = chainingLookup([glyphA], [glyphB, glyphC], [{ sequenceIndex: 0, lookupListIndex: LIGATURE_A_B_C }]);
            assert.deepStrictEqual(substituteIn(pastInputLookup, [glyphA, glyphB, glyphC]), contextualMatch([abcLigature], 0));
        });

        it('ends the input at the ligature glyph of a nested ligature at a later sequence index, not at the current glyph', function() {
            // ss52: sub b' lookup SUB_B a_b_c; sub b' a' lookup LIGATURE_A_B_C b c; -u 0062,0061,0062,0063: [2=0+500|10=1+500], like
            // HarfBuzz the lookup goes on at a_b_c, so the first rule does not apply at the b before it
            const laterRecordLookup = chainingLookup([glyphB, glyphA], [glyphB, glyphC], [{ sequenceIndex: 1, lookupListIndex: LIGATURE_A_B_C }]);
            const laterLigature = nestedSubstitution(1, 41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [1, 2] });
            assert.deepStrictEqual(substituteIn(laterRecordLookup, [glyphB, glyphA, glyphB, glyphC]), contextualMatch([laterLigature], 1));
        });

        it('keeps the input glyph before a nested ligature for a later lookup record', function() {
            // ss46 with the lookup records in the reverse order (LookupFlagsNestedLigatureRecordOrder.ttf):
            // sub b' lookup SUB_ACUTE_B a' lookup LIGATURE_NO_FLAG b'; -u 0062,0061,0062: [8=0+500|9=1+500]
            const reversedRecordsLookup = chainingLookup([glyphB, glyphA, glyphB], [], [
                { sequenceIndex: 1, lookupListIndex: LIGATURE_NO_FLAG },
                { sequenceIndex: 0, lookupListIndex: SUB_ACUTE_B }
            ]);
            const substitutions = [nestedSubstitution(1, 41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [1] }), nestedSubstitution(0, 12, glyphIndexes['b.alt'])];
            assert.deepStrictEqual(substituteIn(reversedRecordsLookup, [glyphB, glyphA, glyphB]), contextualMatch(substitutions, 2));
        });

        it('applies a nested ligature to the glyphs of a nested multiple substitution', function() {
            // ss48: sub c' lookup MULTIPLE_C_A_B lookup LIGATURE_NO_FLAG; -u 0063: [9=0+500]
            const multipleThenLigatureLookup = {
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 3,
                    coverages: createCoverages([glyphC]),
                    lookupRecords: [{ sequenceIndex: 0, lookupListIndex: MULTIPLE_C_A_B }, { sequenceIndex: 0, lookupListIndex: LIGATURE_NO_FLAG }]
                }]
            };
            const substitutions = [nestedSubstitution(0, 21, [glyphA, glyphB]), abLigature()];
            assert.deepStrictEqual(substituteIn(multipleThenLigatureLookup, [glyphC]), contextualMatch(substitutions, 1));
        });

        it('applies the later lookup records to the glyphs that a nested substitution left, after the start of the context', function() {
            // the rules of ss39, ss48 and ss53 after a glyph that they do not match
            // ss39: sub a' lookup LIGATURE_NO_FLAG b' lookup SUB_ACUTE_B acute'; -u 0063,0061,0062,0301: [3=0+500|9=1+500|11=3+0]
            const ligatureThenSingleLookup = chainingLookup([glyphA, glyphB, acute], [], [
                { sequenceIndex: 0, lookupListIndex: LIGATURE_NO_FLAG },
                { sequenceIndex: 1, lookupListIndex: SUB_ACUTE_B }
            ]);
            const acuteSubstitution = nestedSubstitution(1, 12, glyphIndexes['acute.alt']);
            const ligatureThenSingleMatch = substituteIn(ligatureThenSingleLookup, [glyphC, glyphA, glyphB, acute], 1);
            assert.deepStrictEqual(ligatureThenSingleMatch, contextualMatch([abLigature(), acuteSubstitution], 2));
            // ss48: sub c' lookup MULTIPLE_C_A_B lookup LIGATURE_NO_FLAG; -u 0061,0063: [1=0+500|9=1+500]
            const multipleThenLigatureLookup = chainingLookup([glyphC], [], [
                { sequenceIndex: 0, lookupListIndex: MULTIPLE_C_A_B },
                { sequenceIndex: 0, lookupListIndex: LIGATURE_NO_FLAG }
            ]);
            const multipleThenLigatureMatch = substituteIn(multipleThenLigatureLookup, [glyphA, glyphC], 1);
            assert.deepStrictEqual(multipleThenLigatureMatch, contextualMatch([nestedSubstitution(0, 21, [glyphA, glyphB]), abLigature()], 1));
            // ss53: sub a' lookup LIGATURE_AT_MULTIPLE_IGNORE_MARKS acute' lookup SUB_ACUTE_B b'; -u 0062,0061,0301,0062:
            // [2=0+500|9=1+500|11=1+0]
            const skippedMarkLookup = chainingLookup([glyphA, acute, glyphB], [], [
                { sequenceIndex: 0, lookupListIndex: LIGATURE_IGNORE_MARKS },
                { sequenceIndex: 1, lookupListIndex: SUB_ACUTE_B }
            ]);
            const skippedMarkMatch = substituteIn(skippedMarkLookup, [glyphB, glyphA, acute, glyphB], 1);
            assert.deepStrictEqual(skippedMarkMatch, contextualMatch([abLigature([2]), acuteSubstitution], 2));
        });

        it('applies a nested ligature at a glyph its lookupFlag ignores, like HarfBuzz', function() {
            // ss49: sub acute' lookup LIGATURE_ACUTE_B_IGNORE_MARKS b; -u 0061,0301,0062: [1=0+500|11=1+0]
            const ignoredGlyphLookup = chainingLookup([acute], [glyphB], [{ sequenceIndex: 0, lookupListIndex: LIGATURE_ACUTE_B_IGNORE_MARKS }]);
            const acuteLigature = nestedSubstitution(0, 41, { ligGlyph: glyphIndexes['acute.alt'], componentOffsets: [1] });
            assert.deepStrictEqual(substituteIn(ignoredGlyphLookup, [acute, glyphB]), contextualMatch([acuteLigature], 0));
        });

        it('matches the components of a nested ligature of an extension lookup with the lookupFlag of the extension lookup', function() {
            // ss37 of LookupFlagsExtension.ttf, the rule and its nested ligature in extension lookups:
            // --features=-kern,+ss37 LookupFlagsExtension.ttf -u 0061,0301,0062: [9=0+500|5=0+0]
            const lookupRecords = [{ sequenceIndex: 0, lookupListIndex: EXTENSION_LIGATURE_IGNORE_MARKS }];
            const extensionRuleLookup = {
                lookupType: 7,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, lookupType: 6, extension: chainingSubtables([], [glyphA, acute, glyphB], [], lookupRecords)[2] }]
            };
            assert.deepStrictEqual(substituteIn(extensionRuleLookup, [glyphA, acute, glyphB]), contextualMatch([abLigature([2])], 2));
        });
    });

    // contextual rules that match and substitute nothing (exception rules), each one in the subtable before the one of the
    // rule after it: LookupFlagsExceptionRules.ttf of test/generate-lookup-flags-font.py
    // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsExceptionRules.ttf -u <code points>
    describe('exception rules', function() {
        const { a: glyphA, b: glyphB, reh, dal } = glyphIndexes;

        it('gives the match of a contextual rule that substitutes nothing in lookupSubstitution, so that the lookup goes on after its input', function() {
            // calt: ignore sub a' b'; sub b' lookup SUB_B; (two ContextSubst format 3)
            // -u 0061,0062: [1=0+500|2=1+500], the b of the input of the exception is kept
            const exceptionLookup = {
                lookupType: 5,
                lookupFlag: 0,
                subtables: [
                    { substFormat: 3, coverages: createCoverages([glyphA, glyphB]), lookupRecords: [] },
                    { substFormat: 3, coverages: createCoverages([glyphB]), lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }
                ]
            };
            const lookups = [createSingleLookup([glyphB], [glyphIndexes['b.alt']]), exceptionLookup];
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [1], lookups) }));
            const action = query.lookupSubstitution(exceptionLookup, new ContextParams([glyphA, glyphB], 0), 'calt');
            assert.deepStrictEqual(action.substitution, contextualMatch([], 2));
        });

        it('ends the lookup at a chaining rule that substitutes nothing, the exception rule of rlig of arab', function() {
            // rlig: ignore sub reh' dal; subtable; sub reh' lookup SUB_REH; (two ChainContextSubst format 3)
            const chainingSubtable = (lookaheadGlyphs, lookupRecords) => ({
                substFormat: 3,
                backtrackCoverage: [],
                inputCoverage: createCoverages([reh]),
                lookaheadCoverage: createCoverages(lookaheadGlyphs),
                lookupRecords
            });
            const exceptionLookup = {
                lookupType: 6,
                lookupFlag: 0,
                subtables: [chainingSubtable([dal], []), chainingSubtable([], [{ sequenceIndex: 0, lookupListIndex: 0 }])]
            };
            const lookups = [createSingleLookup([reh], [glyphIndexes['reh.alt']]), exceptionLookup];
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('arab', 'rlig', [1], lookups) }));
            const substituteAtFirstGlyph = context => query.lookupSubstitution(exceptionLookup, new ContextParams(context, 0), 'rlig').substitution;
            // -u 0631,062F: [15=1+500|13=0+500], reh is kept
            assert.deepStrictEqual(substituteAtFirstGlyph([reh, dal]), contextualMatch([], 1));
            // -u 0631,0631: [20=1+500|20=0+500]
            assert.deepStrictEqual(substituteAtFirstGlyph([reh, reh]), contextualMatch([nestedSubstitution(0, 12, glyphIndexes['reh.alt'])], 1));
        });
    });

    // the font of test/lookup-flags-font.mjs, which has no cmap (DefaultEncoding): a character it has not has no glyph index
    // (null), not the glyph 0 that the cmap of a parsed font and HarfBuzz give it
    describe('a coverage table from the glyph 0', function() {
        const { a: glyphA } = glyphIndexes;
        const aAlternate = glyphIndexes['a.alt'];

        // LookupFlagsNotdefBacktrack.ttf: calt sub .notdef a' by a.alt;, its backtrack coverage of format 2 here (a range from
        // the glyph 0), of format 1 in the font of feaLib
        function createNotdefBacktrackFont() {
            const chainingLookup = {
                lookupType: 6,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 3,
                    backtrackCoverage: [{ format: 2, ranges: [{ start: 0, end: 0, index: 0 }] }],
                    inputCoverage: [createCoverage([glyphA])],
                    lookaheadCoverage: [],
                    lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 1 }]
                }]
            };
            const lookups = [chainingLookup, createSingleLookup([glyphA], [aAlternate])];
            return createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [0], lookups) });
        }

        it('matches the glyph 0 in the backtrack of a rule, like HarfBuzz', function() {
            // Z has the glyph .notdef: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsNotdefBacktrack.ttf
            // -u 005A,0061 [0=0+500|7=1+500]
            const font = createNotdefBacktrackFont();
            font.glyphs.get(0).addUnicode(0x5A);
            assert.deepStrictEqual(font.stringToGlyphIndexes('Za'), [0, aAlternate]);
        });

        it('does not match a character with no glyph index in the backtrack of a rule', function() {
            // a coverage table lists glyph IDs (OpenType, Common Table Formats), and Z has none
            assert.deepStrictEqual(createNotdefBacktrackFont().stringToGlyphIndexes('Za'), [null, glyphA]);
        });
    });

    // TestVariationPrecision.ttf, generated by test/generate-variation-precision-font.py: rvrn substitutes
    // period with space from the normalized wght 8203/16384 up. wght 650.32 on 100..400..900 is 0.50064
    // (32809.94 / 65536), 32810 in 16.16, (32810 + 2) >> 2 = 8203, where fontTools varLib.instancer.normalize
    // rounds 8202.49 / 16384 to 8202; wght 650.31 is 32808.63 / 65536, 32809, 8202.
    describe('getFeatureVariationSubstitutions', function() {
        let variationFont;

        beforeEach(function() {
            variationFont = loadSync('./test/fonts/TestVariationPrecision.ttf');
        });

        it('compares the conditions with the F2Dot14 normalized coordinates of the OpenType algorithm', function() {
            variationFont.variation.set({ wght: 650.32 });
            assert.equal(new FeatureQuery(variationFont).getFeatureVariationSubstitutions().size, 1);
            // hb-shape --no-glyph-names --variations=wght=650.32 TestVariationPrecision.ttf -u 002E
            // [2=0+300]
            assert.deepStrictEqual(variationFont.stringToGlyphs('.', { features: { rvrn: true } }).map(glyph => glyph.index), [2]);
            variationFont.variation.set({ wght: 650.31 });
            assert.equal(new FeatureQuery(variationFont).getFeatureVariationSubstitutions().size, 0);
            // hb-shape --no-glyph-names --variations=wght=650.31 TestVariationPrecision.ttf -u 002E
            // [4=0+250]
            assert.deepStrictEqual(variationFont.stringToGlyphs('.', { features: { rvrn: true } }).map(glyph => glyph.index), [4]);
        });

        it('matches the conditions at the variation of the query, not at the variation of the font', function() {
            // the font left at its default instance, wght 400
            assert.equal(new FeatureQuery(variationFont).getFeatureVariationSubstitutions().size, 0);
            assert.equal(new FeatureQuery(variationFont, { wght: 650.32 }).getFeatureVariationSubstitutions().size, 1);
            assert.equal(new FeatureQuery(variationFont, { wght: 650.31 }).getFeatureVariationSubstitutions().size, 0);
            variationFont.variation.set({ wght: 650.32 });
            assert.equal(new FeatureQuery(variationFont, { wght: 400 }).getFeatureVariationSubstitutions().size, 0);
        });

        it('applies rvrn by default, at the variation of the options', function() {
            // hb-shape --no-glyph-names --variations=wght=650.32 TestVariationPrecision.ttf -u 002E
            // [2=0+300]
            const glyphsAt = options => variationFont.stringToGlyphs('.', options).map(glyph => glyph.index);
            assert.deepStrictEqual(glyphsAt({ variation: { wght: 650.32 } }), [2]);
            // hb-shape --no-glyph-names --variations=wght=650.32 --features=-rvrn TestVariationPrecision.ttf -u 002E
            // [4=0+250]
            assert.deepStrictEqual(glyphsAt({ variation: { wght: 650.32 }, features: { rvrn: false } }), [4]);
            // hb-shape --no-glyph-names TestVariationPrecision.ttf -u 002E
            // [4=0+250]
            assert.deepStrictEqual(glyphsAt(), [4]);
        });

        it('gives the required feature with the alternate feature table of the variation, like HarfBuzz', function() {
            // TestVariationRequired.ttf: TestVariationPrecision.ttf with rvrn (feature 0: no lookups, lookup 0 sub period by
            // space; from wght 650.32 up) as the required feature of the DefaultLangSys of DFLT (ReqFeatureIndex 0, set with
            // fontTools)
            variationFont.tables.gsub.scripts[0].script.defaultLangSys.reqFeatureIndex = 0;
            const requiredLookups = variation => new FeatureQuery(variationFont, variation).getRequiredFeature('DFLT').feature.lookupListIndexes;
            assert.deepStrictEqual(requiredLookups({ wght: 650.32 }), [0]);
            assert.deepStrictEqual(requiredLookups(), []);
            // the required feature applies whatever the features option: hb-shape --no-glyph-names --features=-rvrn
            // --variations=wght=650.32 TestVariationRequired.ttf -u 002E [2=0+300], without --variations [4=0+250]
            const glyphsAt = options => variationFont.stringToGlyphs('.', options).map(glyph => glyph.index);
            assert.deepStrictEqual(glyphsAt({ variation: { wght: 650.32 }, features: { rvrn: false } }), [2]);
            assert.deepStrictEqual(glyphsAt({ features: { rvrn: false } }), [4]);
        });

        it('substitutes the glyph .notdef of a character the font has not, like HarfBuzz', function() {
            // TestItalicSwitch.ttf: rvrn (feature 25) has the lookup 1 from ital 0.5 up (fontTools), which substitutes .notdef
            // too: hb-shape --shapers=ot --no-glyph-names --cluster-level=1 --variations=ital=1 TestItalicSwitch.ttf
            // -u 0041,4E00 [140=0+695|105=1+512], A.ital and .notdef.ital; without --variations [35=0+700|0=1+512]
            const italicSwitchFont = loadSync('./test/fonts/TestItalicSwitch.ttf');
            assert.deepStrictEqual(italicSwitchFont.stringToGlyphIndexes('A\u{4E00}', { variation: { ital: 1 } }), [140, 105]);
            assert.deepStrictEqual(italicSwitchFont.stringToGlyphIndexes('A\u{4E00}'), [35, 0]);
        });
    });

    // TestScriptLanguage.ttf, generated by test/generate-script-language-font.py: the features of its language systems
    // (feature indexes, from fontTools: font['GSUB'].table.ScriptList) are DFLT calt (0) clig (6) liga (13) rclt (24)
    // rvrn (27); arab URD calt (1) clig (6) fina (8) liga (16) locl (22) rlig (25) rvrn (27); cyrl calt (0) clig (6)
    // liga (17) rvrn (27) and the required feature (ReqFeatureIndex) ss06 (31, lookup 26), cyrl SRB calt (0) clig (6)
    // liga (13) locl (20) rvrn (27); latn calt (0) clig (6) liga (19) rvrn (27), latn TRK calt (0) clig (6) liga (15)
    // locl (21) rvrn (27) and the required feature ss05 (30, lookup 25)
    describe('the language systems of a script', function() {
        let scriptLanguageQuery;

        beforeEach(function() {
            scriptLanguageQuery = new FeatureQuery(loadSync('./test/fonts/TestScriptLanguage.ttf'));
        });

        it('gives the features of the language system of a language, with its tag of three or four letters', function() {
            assert.deepStrictEqual(scriptLanguageQuery.getScriptFeaturesIndexes('latn', 'TRK '), [0, 6, 15, 21, 27]);
            assert.deepStrictEqual(scriptLanguageQuery.getScriptFeaturesIndexes('latn', 'TRK'), [0, 6, 15, 21, 27]);
            assert.deepStrictEqual(scriptLanguageQuery.getScriptFeaturesIndexes('cyrl', 'SRB'), [0, 6, 13, 20, 27]);
            assert.deepStrictEqual(scriptLanguageQuery.getScriptFeaturesIndexes('arab', 'URD'), [1, 6, 8, 16, 22, 25, 27]);
        });

        it('falls back to the default language system of the script for a language the script has not, like HarfBuzz', function() {
            // hb_ot_layout_script_select_language: the language, then the dflt record, then the DefaultLangSys
            assert.deepStrictEqual(scriptLanguageQuery.getScriptFeaturesIndexes('latn'), [0, 6, 19, 27]);
            assert.deepStrictEqual(scriptLanguageQuery.getScriptFeaturesIndexes('latn', 'dflt'), [0, 6, 19, 27]);
            assert.deepStrictEqual(scriptLanguageQuery.getScriptFeaturesIndexes('latn', 'SRB'), [0, 6, 19, 27]);
            assert.deepStrictEqual(scriptLanguageQuery.getScriptFeaturesIndexes('cyrl', 'TRK'), [0, 6, 17, 27]);
        });

        it('falls back to DFLT for a script the font has not, like HarfBuzz', function() {
            // hb_ot_layout_table_select_script: the script, then DFLT, dflt and latn
            assert.deepStrictEqual(scriptLanguageQuery.getScriptFeaturesIndexes('armn'), [0, 6, 13, 24, 27]);
            assert.deepStrictEqual(scriptLanguageQuery.getScriptFeaturesIndexes(), [0, 6, 13, 24, 27]);
        });

        it('gives the feature of a tag in the language system of the script and of the language', function() {
            const lookupIndexes = query => scriptLanguageQuery.getFeature(query).lookupListIndexes;
            assert.deepStrictEqual(lookupIndexes({ tag: 'liga', script: 'cyrl' }), [0, 3, 16]);
            assert.deepStrictEqual(lookupIndexes({ tag: 'liga', script: 'cyrl', language: 'SRB' }), [0, 16]);
            assert.deepStrictEqual(lookupIndexes({ tag: 'locl', script: 'cyrl', language: 'SRB' }), [7]);
            assert.deepStrictEqual(lookupIndexes({ tag: 'locl', script: 'latn', language: 'TRK' }), [6]);
            assert.strictEqual(scriptLanguageQuery.getFeature({ tag: 'locl', script: 'cyrl' }), null);
            assert.strictEqual(scriptLanguageQuery.getFeature({ tag: 'locl', script: 'latn', language: 'SRB' }), null);
        });

        it('gives the required feature of a language system, of its language or its default one, like HarfBuzz', function() {
            assert.strictEqual(scriptLanguageQuery.getRequiredFeatureIndex('latn', 'TRK'), 30);
            assert.strictEqual(scriptLanguageQuery.getRequiredFeatureIndex('cyrl'), 31);
            // arab SND ss07 (32), arab KUR fina (7), which is not in the features of its language system
            assert.strictEqual(scriptLanguageQuery.getRequiredFeatureIndex('arab', 'SND'), 32);
            assert.strictEqual(scriptLanguageQuery.getRequiredFeatureIndex('arab', 'KUR'), 7);
            // the language systems with no required feature: hb_ot_layout_language_get_required_feature gives
            // HB_OT_LAYOUT_NO_FEATURE_INDEX
            assert.strictEqual(scriptLanguageQuery.getRequiredFeatureIndex('cyrl', 'SRB'), undefined);
            assert.strictEqual(scriptLanguageQuery.getRequiredFeatureIndex('latn'), undefined);
            const requiredFeature = scriptLanguageQuery.getRequiredFeature('latn', 'TRK');
            assert.deepStrictEqual([requiredFeature.tag, requiredFeature.feature.lookupListIndexes], ['ss05', [25]]);
            assert.strictEqual(scriptLanguageQuery.getRequiredFeature('cyrl', 'SRB'), null);
            // the required feature is not one of the features of the language system: its tag gives no feature
            assert.strictEqual(scriptLanguageQuery.getFeature({ tag: 'ss05', script: 'latn', language: 'TRK' }), null);
        });
    });

    describe('a script with no default language system', function() {
        // NotoSansThai-Medium-Testing-v1.ttf: its latn script has the language systems MOL and ROM only, no DefaultLangSys
        // and no dflt LangSysRecord (ttx), and DFLT has ccmp, whose lookups substitute j before a mark by dotless j
        let font;

        before(function() {
            font = loadSync('./test/fonts/NotoSansThai-Medium-Testing-v1.ttf');
        });

        it('gives no features for the default language and for a language the script has not, like HarfBuzz', function() {
            const featureQuery = new FeatureQuery(font);
            assert.deepStrictEqual(featureQuery.getScriptFeaturesIndexes('latn'), []);
            assert.deepStrictEqual(featureQuery.getScriptFeaturesIndexes('latn', 'TRK'), []);
            assert.deepStrictEqual(featureQuery.getScriptFeaturesIndexes('latn', 'ROM'), [0, 1, 4, 6, 7]);
            assert.strictEqual(featureQuery.getRequiredFeature('latn'), null);
            // not the features of DFLT: hb-shape --no-glyph-names --cluster-level=1 NotoSansThai-Medium-Testing-v1.ttf
            // -u 006A,0301 [79=0+272|302=1+0], --language=ro [289=0+272|302=1+0]
            assert.deepStrictEqual(font.stringToGlyphIndexes('j\u{301}'), [79, 302]);
            assert.deepStrictEqual(font.stringToGlyphIndexes('j\u{301}', { language: 'ROM' }), [289, 302]);
        });

        itFailsUntilFixed('composes a letter and its combining mark into the precomposed letter of the cmap, like HarfBuzz',
            'Font.prototype.stringToGlyphIndexes (src/font.mjs): the fork has no compose step of the normalizer of HarfBuzz ' +
            '(hb_ot_shape_normalize), and the latn script has no ccmp, so A U+0328 keeps the glyphs A and uni0328',
            function() {
                // the decomposed A ogonek (U+0104 is mapped by the cmap): hb-shape --shapers=ot --no-glyph-names --cluster-level=1
                // NotoSansThai-Medium-Testing-v1.ttf -u 0041,0328 [188=0+654], --features=-ccmp the same
                assert.deepStrictEqual(font.stringToGlyphIndexes('A\u{328}'), [188]);
            });
    });

    describe('a feature index past the FeatureList', function() {
        const { reh, dal } = glyphIndexes;
        const dalAlternate = glyphIndexes['dal.alt'];
        const rehAlternate = glyphIndexes['reh.alt'];

        it('ignores the index and keeps the other features of the language system, like HarfBuzz', function() {
            // LookupFlagsFeatureIndexPastList.ttf: in rlig sub dal by dal.alt; then sub dal.alt by reh.alt;, the feature index 7
            // after the rlig feature (0) in the language systems
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsFeatureIndexPastList.ttf -u 0631,062F
            // [20=1+500|13=0+500]
            const lookups = [createSingleLookup([dal], [dalAlternate]), createSingleLookup([dalAlternate], [rehAlternate])];
            const gsub = createLayoutTable('arab', 'rlig', [0, 1], lookups);
            gsub.scripts[0].script.defaultLangSys.featureIndexes.push(7);
            const font = createLookupFlagsFont({ gsub });
            const featureQuery = new FeatureQuery(font);
            assert.deepStrictEqual(featureQuery.getFeature({ tag: 'rlig', script: 'arab' }).lookupListIndexes, [0, 1]);
            assert.deepStrictEqual(featureQuery.getScriptFeatures('arab').map(({ tag }) => tag), ['rlig']);
            assert.deepStrictEqual(font.stringToGlyphIndexes('\u{631}\u{62F}'), [rehAlternate, reh]);
        });
    });

    describe('two features of one tag in a language system', function() {
        const { dal } = glyphIndexes;
        const dalAlternate = glyphIndexes['dal.alt'];
        const rehAlternate = glyphIndexes['reh.alt'];

        it('gives the first feature of the tag, like HarfBuzz', function() {
            // LookupFlagsDuplicateFeatureTag.ttf: in rlig (0) sub dal by dal.alt;, in a second rlig (1) sub dal by reh.alt;
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsDuplicateFeatureTag.ttf -u 062F [17=0+500];
            // --features=-kern,-rlig [15=0+500]
            const lookups = [createSingleLookup([dal], [dalAlternate]), createSingleLookup([dal], [rehAlternate])];
            const gsub = createLayoutTable('arab', 'rlig', [0], lookups);
            gsub.features.push({ tag: 'rlig', feature: { featureParams: 0, lookupListIndexes: [1] } });
            gsub.scripts[0].script.defaultLangSys.featureIndexes.push(1);
            const font = createLookupFlagsFont({ gsub });
            const featureQuery = new FeatureQuery(font);
            assert.deepStrictEqual(featureQuery.getFeature({ tag: 'rlig', script: 'arab' }).lookupListIndexes, [0]);
            assert.deepStrictEqual(font.stringToGlyphIndexes('\u{62F}'), [dalAlternate]);
            assert.deepStrictEqual(font.stringToGlyphIndexes('\u{62F}', { features: { rlig: false } }), [dal]);
        });
    });
});
