import assert from 'assert';
import { parse } from '../src/opentype.mjs';
import FeatureQuery from '../src/features/featureQuery.mjs';
import { ContextParams } from '../src/tokenizer.mjs';
import { glyphIndexes, createLookupFlagsFont, createLayoutTable } from './lookup-flags-font.mjs';
import { readFileSync } from 'fs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

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
            const initFeatureLookups = query.arabic.getFeatureLookups(initFeature);
            assert.deepEqual(initFeatureLookups[0], arabicFont.tables.gsub.lookups[7]);
            /** latin */
            const ligaFeature = query.latin.getFeature({tag: 'liga', script: 'latn'});
            assert.deepEqual(ligaFeature.lookupListIndexes, [35]);
            const ligaFeatureLookups = query.latin.getFeatureLookups(ligaFeature);
            assert.deepEqual(ligaFeatureLookups[0], latinFont.tables.gsub.lookups[35]);
        });
        it('should return lookup subtables', function () {
            /** arab */
            const initFeature = query.arabic.getFeature({tag: 'init', script: 'arab'});
            const initFeatureLookups = query.arabic.getFeatureLookups(initFeature);
            const initLookupSubtables = query.arabic.getLookupSubtables(initFeatureLookups[0]);
            assert.deepEqual(initLookupSubtables.length, arabicFont.tables.gsub.lookups[7].subtables.length);
            /** latin */
            const ligaFeature = query.latin.getFeature({tag: 'liga', script: 'latn'});
            const ligaFeatureLookups = query.latin.getFeatureLookups(ligaFeature);
            const ligaLookupSubtables = query.latin.getLookupSubtables(ligaFeatureLookups[0]);
            assert.deepEqual(ligaLookupSubtables.length, latinFont.tables.gsub.lookups[35].subtables.length);
        });
        it('should return subtable lookup method', function () {
            /** arab */
            const initFeature = query.arabic.getFeature({tag: 'init', script: 'arab'});
            const initFeatureLookups = query.arabic.getFeatureLookups(initFeature);
            const initLookupTable = initFeatureLookups[0];
            const initLookupSubtables = query.arabic.getLookupSubtables(initLookupTable);
            const initSubtable = initLookupSubtables[0];
            const initSubsType = query.arabic.getSubstitutionType(initLookupTable, initSubtable);
            const initLookupFn = query.arabic.getLookupMethod(initLookupTable, initSubtable);
            assert.deepEqual(initSubsType, '12'); // supported: single substitution '12'
            assert.deepEqual(typeof initLookupFn, 'function');
            /** latin */
            const ligaFeature = query.latin.getFeature({tag: 'liga', script: 'latn'});
            const ligaFeatureLookups = query.latin.getFeatureLookups(ligaFeature);
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
            const featureLookups = query.arabicChanga.getFeatureLookups(feature);
            const lookupSubtables = query.arabicChanga.getLookupSubtables(featureLookups[0]);
            const substitutionType = query.arabicChanga.getSubstitutionType(featureLookups[0], lookupSubtables[0]);
            assert.equal(substitutionType, 11);
            const lookup = query.arabicChanga.getLookupMethod(featureLookups[0], lookupSubtables[0]);
            const substitution = lookup(291);
            assert.equal(substitution, 294);
        });
        it('should find a substitute - single substitution format 2 (12)', function () {
            const feature = query.arabic.getFeature({tag: 'init', script: 'arab'});
            const featureLookups = query.arabic.getFeatureLookups(feature);
            const lookupSubtables = query.arabic.getLookupSubtables(featureLookups[0]);
            const substitutionType = query.arabic.getSubstitutionType(featureLookups[0], lookupSubtables[0]);
            assert.equal(substitutionType, 12);
            const lookup = query.arabic.getLookupMethod(featureLookups[0], lookupSubtables[0]);
            const substitution = lookup(351);
            assert.equal(substitution, 910);
        });
        it('should find a substitute - chaining context substitution format 3 (63)', function () {
            const feature = query.arabic.getFeature({tag: 'rlig', script: 'arab'});
            const featureLookups = query.arabic.getFeatureLookups(feature);
            const lookupSubtables = query.arabic.getLookupSubtables(featureLookups[0]);
            const substitutionType = query.arabic.getSubstitutionType(featureLookups[0], lookupSubtables[0]);
            assert.equal(substitutionType, 63);
            const lookup = query.arabic.getLookupMethod(featureLookups[0], lookupSubtables[0]);
            let contextParams = new ContextParams([882, 520], 0);
            const substitutions = lookup(contextParams, featureLookups[0]);
            assert.deepEqual(substitutions, [1348]);
        });
        it('should find a substitute - required ligature substitution format 1 (41)', function () {
            /** arab */
            const initFeature = query.arabic.getFeature({tag: 'rlig', script: 'arab'});
            const initFeatureLookups = query.arabic.getFeatureLookups(initFeature);
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
            const ligaFeatureLookups = query.latin.getFeatureLookups(ligaFeature);
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
            const featureLookups = query.sub5.getFeatureLookups(feature);
            const lookupSubtables = query.sub5.getLookupSubtables(featureLookups[0]);
            const substitutionType = query.sub5.getSubstitutionType(featureLookups[0], lookupSubtables[0]);
            assert.equal(substitutionType, 51);
            const lookup = query.sub5.getLookupMethod(featureLookups[0], lookupSubtables[0]);
            // space endash space: both spaces become uni2009 (86), like HarfBuzz does;
            // the endash (88) is not substituted, so it is a hole in the substitutions
            let contextParams = new ContextParams([1, 88, 1], 0);
            const substitutions = lookup(contextParams, featureLookups[0]);
            assert.equal(substitutions.length, 3);
            assert.equal(substitutions[0], 86);
            assert.equal(1 in substitutions, false);
            assert.equal(substitutions[2], 86);
        });
        it('should parse multiple glyphs -ligature substitution format 3 (53)', function () {
            const feature = query.sub5.getFeature({tag: 'ccmp', script: 'DFLT'});
            const featureLookups = query.sub5.getFeatureLookups(feature);
            const lookupSubtables = query.sub5.getLookupSubtables(featureLookups[1]);
            const substitutionType = query.sub5.getSubstitutionType(featureLookups[1], lookupSubtables[0]);
            assert.equal(substitutionType, 53);
            const lookup = query.sub5.getLookupMethod(featureLookups[0], lookupSubtables[0]);
            let contextParams = new ContextParams([2, 3], 0);
            const substitutions = lookup(contextParams, featureLookups[1]);
            assert.deepEqual(substitutions, [54, 54]);
        });
        it('should decompose a glyph - multiple substitution format 1 (21)', function () {
            const feature = query.arabic.getFeature({tag: 'ccmp', script: 'arab'});
            const featureLookups = query.arabic.getFeatureLookups(feature);
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
        // a b in class 1, the other glyphs in class 0
        const classDef = { format: 2, ranges: [{ start: glyphA, end: glyphB, classId: 1 }] };
        // a b in class 1, c in class 2, the other glyphs in class 0
        const classDefWithC = { format: 2, ranges: [{ start: glyphA, end: glyphB, classId: 1 }, { start: glyphC, end: glyphC, classId: 2 }] };

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

        // the substitutions of a contextual rule are by offset from the current glyph, holes for the glyphs it keeps
        function sparse(entries) {
            const substitutions = [];
            for (const [offset, glyphIndex] of entries) {
                substitutions[offset] = glyphIndex;
            }
            return substitutions;
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
                assert.deepStrictEqual(substituteAt(lookupTable, 0), sparse([[2, bAlternate]]), `format ${subtable.substFormat}`);
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
                assert.deepStrictEqual(substituteAt(lookupTable, 2), [bAlternate], `format ${subtable.substFormat}`);
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
                assert.deepStrictEqual(substituteAt(lookupTable, 0), [aAlternate], `format ${subtable.substFormat}`);
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

        it('ignores the glyph classes of a GDEF table HarfBuzz ignores: ligature, single substitution and lookupFeature', function() {
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
            const createBlocklistedQuery = (lookupTable, scriptTag, featureTag) => {
                const query = createQuery(lookupTable, scriptTag, featureTag);
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
            const ccmpAtFf = { tag: 'ccmp', script: 'thai', contextParams: new ContextParams([ff], 0) };
            const substitutions = createBlocklistedQuery(singleLookup, 'thai', 'ccmp').lookupFeature(ccmpAtFf);
            assert.equal(substitutions[0].substitution, glyphIndexes.a_b_c);
            assert.deepStrictEqual(createQuery(singleLookup, 'thai', 'ccmp').lookupFeature(ccmpAtFf), [ff]);
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
                assert.deepStrictEqual(substitutions, sparse([[4, aAlternate]]), `format ${subtable.substFormat}`);
            }
        });

        // the chaining context subtables of formats 1, 2 and 3 of a rule of glyphs
        function chainingSubtables(backtrack, input, lookahead, lookupRecords) {
            const glyphClasses = glyphs => glyphs.map(glyph => glyph === glyphC ? 2 : 1);
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

        it('matches the lookahead after the last input glyph: chaining context formats 1, 2 and 3', function() {
            // ss12: lookupflag IgnoreMarks; sub a' lookup SUB_A b' c;
            // -u 0061,0062,0301,0063: [7=0+500|2=1+500|5=2+0|3=3+500]
            for (const subtable of chainingSubtables([], [glyphA, glyphB], [glyphC], [{ sequenceIndex: 0, lookupListIndex: 0 }])) {
                const lookupTable = { lookupType: 6, lookupFlag: IGNORE_MARKS, subtables: [subtable] };
                const message = `format ${subtable.substFormat}`;
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphA, glyphB, acute, glyphC], 0), [aAlternate], message);
                // -u 0061,0301,0062,0063: [7=0+500|5=1+0|2=2+500|3=3+500], the mark inside the input
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphA, acute, glyphB, glyphC], 0), [aAlternate], `inside ${message}`);
                // -u 0061,0062,0063: [7=0+500|2=1+500|3=2+500]
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphA, glyphB, glyphC], 0), [aAlternate], message);
            }
        });

        it('matches the backtrack before the current glyph, a nested lookup after a mark: chaining context formats 1, 2 and 3', function() {
            // ss13: lookupflag IgnoreMarks; sub c a' b' lookup SUB_B;
            for (const subtable of chainingSubtables([glyphC], [glyphA, glyphB], [], [{ sequenceIndex: 1, lookupListIndex: 1 }])) {
                const lookupTable = { lookupType: 6, lookupFlag: IGNORE_MARKS, subtables: [subtable] };
                // -u 0063,0301,0061,0062: [3=0+500|5=1+0|1=2+500|8=3+500]
                const message = `format ${subtable.substFormat}`;
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphC, acute, glyphA, glyphB], 2), sparse([[1, bAlternate]]), message);
                // -u 0063,0061,0301,0062: [3=0+500|1=1+500|5=2+0|8=3+500]
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphC, glyphA, acute, glyphB], 1), sparse([[2, bAlternate]]), message);
            }
        });

        it('matches the first glyph of the glyphs of a multiple substitution: chaining context formats 1, 2 and 3', function() {
            // ss14: sub c by a acute; then lookupflag IgnoreMarks; sub b' a by b.alt;
            // -u 0062,0063: [8=0+500|1=1+500|5=1+0], the lookahead a is the first glyph of the glyphs of c
            for (const subtable of chainingSubtables([], [glyphB], [glyphA], [{ sequenceIndex: 0, lookupListIndex: 1 }])) {
                const lookupTable = { lookupType: 6, lookupFlag: IGNORE_MARKS, subtables: [subtable] };
                assert.deepStrictEqual(substituteIn(lookupTable, [glyphB, [glyphA, acute]], 0), [bAlternate], `format ${subtable.substFormat}`);
                assert.equal(substituteIn(lookupTable, [glyphB, [acute, glyphC]], 0), null, `format ${subtable.substFormat}`);
            }
        });

        it('matches the first glyph of the glyphs of a multiple substitution as the current glyph: context and chaining context formats 1, 2 and 3', function() {
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
                assert.deepStrictEqual(substituteIn(lookupTable, [[glyphA, acute], glyphB], 0), sparse([[1, bAlternate]]), message);
            }
        });

        it('does not apply a lookup at the glyphs of a multiple substitution whose first glyph it ignores', function() {
            // ss19: sub c by a acute; then lookupflag IgnoreBaseGlyphs; sub a' lookup SUB_A;
            // --features=-kern,+ss19 -u 0063,0062: [1=0+500|5=0+0|2=1+500], a stays a
            const lookupTable = {
                lookupType: 6,
                lookupFlag: IGNORE_BASE_GLYPHS,
                subtables: [chainingSubtables([], [glyphA], [], [{ sequenceIndex: 0, lookupListIndex: 0 }])[2]]
            };
            const context = [[glyphA, acute], glyphB];
            assert.equal(substituteIn(lookupTable, context, 0), null);
            // ss20, the same rule without the flag: [7=0+500|5=0+0|2=1+500]
            assert.deepStrictEqual(substituteIn({ ...lookupTable, lookupFlag: 0 }, context, 0), [aAlternate]);
            const thaiQuery = createQuery(lookupTable, 'thai', 'ccmp');
            assert.deepStrictEqual(thaiQuery.lookupFeature({ tag: 'ccmp', script: 'thai', contextParams: new ContextParams(context, 0) }), context);
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
            assert.deepStrictEqual(substituteIn(contextLookup, [glyphA, ff], 0), [aAlternate]);
            // ss02, the lookahead class 0: -u 0061: [1=0+500], -u 0061,FB00: [7=0+500|4=1+500]
            const lookaheadLookup = { lookupType: 6, lookupFlag: 0, subtables: [chainingSubtable([], [0])] };
            assert.equal(substituteIn(lookaheadLookup, [glyphA], 0), null);
            assert.deepStrictEqual(substituteIn(lookaheadLookup, [glyphA, ff], 0), [aAlternate]);
            // ss03, the backtrack class 0: -u 0061: [1=0+500], -u FB00,0061: [4=0+500|7=1+500]
            const backtrackLookup = { lookupType: 6, lookupFlag: 0, subtables: [chainingSubtable([0], [])] };
            assert.equal(substituteIn(backtrackLookup, [glyphA], 0), null);
            assert.deepStrictEqual(substituteIn(backtrackLookup, [ff, glyphA], 1), [aAlternate]);
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
                assert.deepStrictEqual(substituteAt(extensionLookup, 0), [aAlternate]);
            });

            it('skips the glyphs its lookupFlag ignores in a contextual rule in lookupFeature', function() {
                const extensionQuery = createQuery(extensionLookup, 'thai', 'ccmp');
                const contextParams = new ContextParams([glyphA, acute, glyphB], 0);
                const substitutions = extensionQuery.lookupFeature({ tag: 'ccmp', script: 'thai', contextParams });
                assert.deepStrictEqual(substitutions[0].substitution, [aAlternate]);
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

        it('applies the lookupFlag in lookupFeature, the path of the arabic and thai features', function() {
            const contextAt = position => new ContextParams([glyphA, acute, glyphB], position);
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
            const lookaheadQuery = createQuery(lookaheadLookup, 'thai', 'ccmp');
            const substitutions = lookaheadQuery.lookupFeature({ tag: 'ccmp', script: 'thai', contextParams: contextAt(0) });
            assert.deepStrictEqual(substitutions[0].substitution, [aAlternate]);
            const acuteQuery = createQuery(acuteLookup, 'thai', 'ccmp');
            assert.deepStrictEqual(acuteQuery.lookupFeature({ tag: 'ccmp', script: 'thai', contextParams: contextAt(1) }), [glyphA, acute, glyphB]);
        });

        it('matches the components of a ligature across the marks in lookupFeature, the path of the arabic required ligatures', function() {
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
            const contextParams = new ContextParams([lam, fatha, alef], 0);
            const substitutions = ligatureQuery.lookupFeature({ tag: 'rlig', script: 'arab', contextParams });
            assert.deepStrictEqual(substitutions[0].substitution, { ligGlyph: glyphIndexes.lam_alef, componentOffsets: [2] });
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
    });
});
