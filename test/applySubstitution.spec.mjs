import assert from 'assert';
import Tokenizer from '../src/tokenizer.mjs';
import FeatureQuery, { SubstitutionAction } from '../src/features/featureQuery.mjs';
import applySubstitution, {
    getTokenGlyphIndexes,
    getGlyphSequence,
    applyLookupToTokens,
    getFeaturesLookups,
    applyFeaturesToTokens,
    getRequiredFeatureStage,
    applyFeatureStagesToTokens
} from '../src/features/applySubstitution.mjs';
import {
    glyphIndexes,
    createLookupFlagsFont,
    createLayoutTable,
    createScriptsLayoutTable,
    createCoverage,
    createCoverages,
    createSingleLookup,
    createMultipleLookup,
    createLigatureLookup,
    multipleCLookup,
    subAcuteBLookup
} from './lookup-flags-font.mjs';

/**
 * The substitutions applied to the tokens of a text and to their glyph sequence, with the glyphs of
 * test/lookup-flags-font.mjs: the characters a, b, c, U+0301, U+0627, U+062F, U+0631, U+0644, U+064E and U+FB00 map to the
 * glyphs a, b, c, acute, alef, dal, reh, lam, fatha and ff, the space, which the font has not, to the glyph 0 like
 * HarfBuzz. The glyphs
 * and the clusters of each case are the ones of HarfBuzz for the lookups quoted, from LookupFlags.ttf
 * (hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature> LookupFlags.ttf -u <code points>).
 */
describe('applySubstitution.mjs', function() {
    const { a: glyphA, b: glyphB, c: glyphC, acute, alef, dal, reh, lam, fatha, ff } = glyphIndexes;
    const characterGlyphIndexes = {
        a: glyphA,
        b: glyphB,
        c: glyphC,
        ' ': 0,
        '\u{301}': acute,
        '\u{627}': alef,
        '\u{62F}': dal,
        '\u{631}': reh,
        '\u{644}': lam,
        '\u{64E}': fatha,
        '\u{FB00}': ff
    };

    // the tokens of a text, each one with the glyph of its character
    function tokenize(text) {
        const tokenizer = new Tokenizer();
        tokenizer.registerModifier('glyphIndex', null, token => characterGlyphIndexes[token.char]);
        return tokenizer.tokenize(text);
    }

    const action = (id, substitution) => new SubstitutionAction({ id, tag: 'calt', substitution });
    // a substitution of a nested lookup of a contextual rule (see ContextualMatch in featureQuery.mjs)
    const nestedSubstitution = (offset, id, substitution) => ({ offset, id, substitution });

    // the glyphs of each token, a deleted token has none, and its cluster
    const describeTokens = tokens => tokens.map(token => [token.state.deleted ? [] : getTokenGlyphIndexes(token), token.cluster]);

    describe('getGlyphSequence', function() {
        it('gives each glyph of a multiple substitution a position of its own, and none to a deleted token', function() {
            const tokens = tokenize('abc');
            tokens[0].setState('calt', [glyphA, acute]);
            tokens[1].setState('deleted', true);
            assert.deepStrictEqual(getGlyphSequence(tokens), { glyphIndexes: [glyphA, acute, glyphC], glyphTokens: [tokens[0], tokens[0], tokens[2]] });
        });
    });

    describe('applySubstitution', function() {
        it('replaces a glyph with the glyphs of a multiple substitution, each one a glyph of its own', function() {
            // ss30: sub c by a acute; then sub acute by acute.alt; sub b by b.alt; -u 0063,0062: [1=0+500|11=0+0|8=1+500]
            const tokens = tokenize('cb');
            const glyphSequence = getGlyphSequence(tokens);
            assert.equal(applySubstitution(action(21, [glyphA, acute]), glyphSequence, 0), 2);
            assert.equal(applySubstitution(action(12, glyphIndexes['acute.alt']), glyphSequence, 1), 1);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphA, glyphIndexes['acute.alt'], glyphB]);
            assert.deepStrictEqual(describeTokens(tokens), [[[glyphA, glyphIndexes['acute.alt']], 0], [[glyphB], 1]]);
        });

        it('deletes a token whose glyphs a multiple substitution replaces with none', function() {
            const tokens = tokenize('cb');
            const glyphSequence = getGlyphSequence(tokens);
            assert.equal(applySubstitution(action(21, []), glyphSequence, 0), 0);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphB]);
            assert.deepStrictEqual(describeTokens(tokens), [[[], 0], [[glyphB], 1]]);
        });

        it('applies the nested substitutions of a contextual rule in order, each one at its offset after the previous ones, and goes on after the input', function() {
            // ss23: sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B; with the second record at the sequence index 2
            // (LookupFlagsNestedSequenceIndex.ttf) -u 0063,0062: [1=0+500|5=0+0|8=1+500]
            const tokens = tokenize('cb');
            const glyphSequence = getGlyphSequence(tokens);
            const substitutions = [nestedSubstitution(0, 21, [glyphA, acute]), nestedSubstitution(2, 12, glyphIndexes['b.alt'])];
            assert.equal(applySubstitution(action(53, { substitutions, inputLength: 3 }), glyphSequence, 0), 3);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphA, acute, glyphIndexes['b.alt']]);
            assert.deepStrictEqual(describeTokens(tokens), [[[glyphA, acute], 0], [[glyphIndexes['b.alt']], 1]]);
            // with the feature tag of the contextual lookup as the state key
            assert.deepStrictEqual(tokens[0].getState('calt'), [glyphA, acute]);
            assert.equal(tokens[1].getState('calt'), glyphIndexes['b.alt']);
        });

        it('goes on after the glyphs of a nested multiple substitution of the last input glyph', function() {
            // ss34: sub a' b' lookup MULTIPLE_B_A_B; (sub b by a b;), the lookup goes on after the b of the glyphs of b
            // -u 0061,0062: [1=0+500|1=1+500|2=1+500]
            const tokens = tokenize('ab');
            const glyphSequence = getGlyphSequence(tokens);
            const substitutions = [nestedSubstitution(1, 21, [glyphA, glyphB])];
            assert.equal(applySubstitution(action(53, { substitutions, inputLength: 3 }), glyphSequence, 0), 3);
            assert.deepStrictEqual(describeTokens(tokens), [[[glyphA], 0], [[glyphA, glyphB], 1]]);
        });

        it('goes on after the last input glyph of a contextual rule, past the glyphs its lookup skips', function() {
            // ss01: lookupflag IgnoreMarks; sub a' b' lookup SUB_B; -u 0061,0301,0062: [1=0+500|5=1+0|8=2+500]
            const tokens = tokenize('a\u{301}b');
            const glyphSequence = getGlyphSequence(tokens);
            const substitutions = [nestedSubstitution(2, 12, glyphIndexes['b.alt'])];
            assert.equal(applySubstitution(action(53, { substitutions, inputLength: 3 }), glyphSequence, 0), 3);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphA, acute, glyphIndexes['b.alt']]);
        });

        it('merges the clusters of the glyphs of a ligature, from its first component to its last one', function() {
            // ss26: sub c by b a; then sub a b by a_b; -u 0063,0062: [2=0+500|9=0+500]
            const tokens = tokenize('cb');
            const glyphSequence = getGlyphSequence(tokens);
            applySubstitution(action(21, [glyphB, glyphA]), glyphSequence, 0);
            assert.equal(applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [1] }), glyphSequence, 1), 1);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphB, glyphIndexes.a_b]);
            assert.deepStrictEqual(describeTokens(tokens), [[[glyphB, glyphIndexes.a_b], 0], [[], 0]]);
        });

        it('merges the clusters of a ligature of three components to its last one, past the glyphs between its components', function() {
            // ss04: lookupflag IgnoreMarks; sub a b c by a_b_c; -u 0061,0062,0301,0063: [10=0+500|5=0+0]
            const tokens = tokenize('ab\u{301}c');
            const glyphSequence = getGlyphSequence(tokens);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [1, 3] }), glyphSequence, 0);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphIndexes.a_b_c, acute]);
            // the tokens of the glyphs, the clusters of the deleted ones are not used
            assert.deepStrictEqual(describeTokens(tokens.filter(token => !token.state.deleted)), [[[glyphIndexes.a_b_c], 0], [[acute], 0]]);
        });

        it('merges the whole clusters of the glyphs of a ligature, with the glyphs out of its range that share them', function() {
            // ss31: lookupflag IgnoreMarks; sub a b by a_b; then sub c a_b by a_b_c; the acute that the first ligature skipped
            // is in the cluster of a_b, out of the range of the second ligature: -u 0063,0061,0301,0062: [10=0+500|5=0+0]
            const tokens = tokenize('ca\u{301}b');
            const glyphSequence = getGlyphSequence(tokens);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [2] }), glyphSequence, 1);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [1] }), glyphSequence, 0);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphIndexes.a_b_c, acute]);
            // the tokens of the glyphs, the clusters of the deleted ones are not used
            assert.deepStrictEqual(describeTokens(tokens.filter(token => !token.state.deleted)), [[[glyphIndexes.a_b_c], 0], [[acute], 0]]);
        });

        it('substitutes nothing without a substitution action', function() {
            const tokens = tokenize('cb');
            const glyphSequence = getGlyphSequence(tokens);
            assert.equal(applySubstitution(glyphC, glyphSequence, 0), 1);
            assert.equal(applySubstitution(undefined, glyphSequence, 0), 1);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphC, glyphB]);
        });
    });

    describe('applyLookupToTokens', function() {
        it('goes on after the input glyphs of a contextual rule that substitutes nothing', function() {
            // calt: ignore sub a' b'; sub b' lookup SUB_B; (two ContextSubst format 3)
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsExceptionRules.ttf -u 0061,0062,0062
            // [1=0+500|2=1+500|8=2+500]
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
            const tokens = tokenize('abb');
            applyLookupToTokens(query, exceptionLookup, 'calt', tokens);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphA, glyphB, glyphIndexes['b.alt']]);
        });

        it('goes on at the glyph after a deleted one, which the same lookup substitutes', function() {
            // calt: sub c by NULL; sub b by a b; (one lookup of type 2)
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsDeletionThenMultiple.ttf -u 0063,0062
            // [1=0+500|2=0+500]
            const lookup = createMultipleLookup([glyphB, glyphC], [[glyphA, glyphB], []]);
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [0], [lookup]) }));
            const tokens = tokenize('cb');
            applyLookupToTokens(query, lookup, 'calt', tokens);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphA, glyphB]);
        });

        const IGNORE_BASE_GLYPHS = 0x0002;
        const IGNORE_LIGATURES = 0x0004;
        const IGNORE_MARKS = 0x0008;
        const aAlternate = glyphIndexes['a.alt'];
        const dalAlternate = glyphIndexes['dal.alt'];
        const lamInitial = glyphIndexes['lam.init'];

        // the glyphs of the tokens of a text after a lookup, in the calt of latn of the font, with the nested lookup sub a by a.alt;
        function applyCaltLookup(lookupTable, text) {
            const lookups = [createSingleLookup([glyphA], [aAlternate]), lookupTable];
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [1], lookups) }));
            const tokens = tokenize(text);
            applyLookupToTokens(query, lookupTable, 'calt', tokens);
            return getGlyphSequence(tokens).glyphIndexes;
        }

        it('skips the glyphs its lookupFlag ignores in the context of a rule, in an extension lookup too', function() {
            // ss03: lookupflag IgnoreMarks; sub a' b by a.alt;
            // --features=-kern,+ss03 LookupFlags.ttf -u 0061,0301,0062: [7=0+500|5=1+0|2=2+500], the same with
            // LookupFlagsExtension.ttf, where the lookup is an extension lookup
            const chainingSubtable = {
                substFormat: 3,
                backtrackCoverage: [],
                inputCoverage: createCoverages([glyphA]),
                lookaheadCoverage: createCoverages([glyphB]),
                lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }]
            };
            const chainingLookup = { lookupType: 6, lookupFlag: IGNORE_MARKS, subtables: [chainingSubtable] };
            const extensionLookup = { lookupType: 7, lookupFlag: IGNORE_MARKS, subtables: [{ substFormat: 1, lookupType: 6, extension: chainingSubtable }] };
            assert.deepStrictEqual(applyCaltLookup(chainingLookup, 'a\u{301}b'), [aAlternate, acute, glyphB]);
            assert.deepStrictEqual(applyCaltLookup(extensionLookup, 'a\u{301}b'), [aAlternate, acute, glyphB]);
        });

        it('does not apply a lookup at the first glyph of a multiple substitution that it ignores', function() {
            // ss19: sub c by a acute; then lookupflag IgnoreBaseGlyphs; sub a' lookup SUB_A;
            // --features=-kern,+ss19 LookupFlags.ttf -u 0063,0062: [1=0+500|5=0+0|2=1+500], a stays a
            const chainingLookup = {
                lookupType: 6,
                lookupFlag: IGNORE_BASE_GLYPHS,
                subtables: [{
                    substFormat: 3,
                    backtrackCoverage: [],
                    inputCoverage: createCoverages([glyphA]),
                    lookaheadCoverage: [],
                    lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }]
                }]
            };
            const lookups = [createSingleLookup([glyphA], [aAlternate]), multipleCLookup, chainingLookup];
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [1, 2], lookups) }));
            const tokens = tokenize('cb');
            applyLookupToTokens(query, multipleCLookup, 'calt', tokens);
            applyLookupToTokens(query, chainingLookup, 'calt', tokens);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphA, acute, glyphB]);
        });

        it('matches the components of a ligature across the marks its lookupFlag ignores', function() {
            // rlig: lookupflag IgnoreMarks; sub lam alef by lam_alef;
            // --features=-kern LookupFlags.ttf -u 0644,064E,0627 (rlig is on by default): [14=0+0|19=0+500], in visual order
            const ligatureLookup = {
                lookupType: 4,
                lookupFlag: IGNORE_MARKS,
                subtables: [{ substFormat: 1, coverage: createCoverage([lam]), ligatureSets: [[{ ligGlyph: glyphIndexes.lam_alef, components: [alef] }]] }]
            };
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('arab', 'rlig', [0], [ligatureLookup]) }));
            const tokens = tokenize('\u{644}\u{64E}\u{627}');
            applyLookupToTokens(query, ligatureLookup, 'rlig', tokens);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphIndexes.lam_alef, fatha]);
        });

        it('applies none of the other subtables of the lookup at a contextual rule that matches and substitutes nothing', function() {
            // rlig: ignore sub reh' dal; subtable; sub reh' lookup SUB_REH; (two ChainContextSubst format 3, sub reh by reh.alt;)
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
            const applyExceptionLookup = text => {
                const tokens = tokenize(text);
                applyLookupToTokens(query, exceptionLookup, 'rlig', tokens);
                return getGlyphSequence(tokens).glyphIndexes;
            };
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsExceptionRules.ttf -u 0631,062F
            // [15=1+500|13=0+500], reh is kept
            assert.deepStrictEqual(applyExceptionLookup('\u{631}\u{62F}'), [reh, dal]);
            // -u 0631,0631: [20=1+500|20=0+500]
            assert.deepStrictEqual(applyExceptionLookup('\u{631}\u{631}'), [glyphIndexes['reh.alt'], glyphIndexes['reh.alt']]);
        });

        it('ignores the glyph classes of a GDEF table HarfBuzz ignores', function() {
            // ss02: lookupflag IgnoreLigatures; sub ff by a_b_c;
            // --features=-kern,+ss02 LookupFlagsBlocklistedGDEF.ttf -u FB00: [10=0+500], HarfBuzz drops its GDEF table and ff
            // (U+FB00, Ll) is a base glyph; the same lookup with the GDEF table of LookupFlags.ttf, where ff is a ligature: [4=0+500]
            const singleLookup = createSingleLookup([ff], [glyphIndexes.a_b_c], IGNORE_LIGATURES);
            const applySingleLookup = isGdefIgnoredByLayout => {
                const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [0], [singleLookup]) });
                font.isGdefIgnoredByLayout = isGdefIgnoredByLayout;
                const tokens = tokenize('\u{FB00}');
                applyLookupToTokens(new FeatureQuery(font), singleLookup, 'calt', tokens);
                return getGlyphSequence(tokens).glyphIndexes;
            };
            assert.deepStrictEqual(applySingleLookup(true), [glyphIndexes.a_b_c]);
            assert.deepStrictEqual(applySingleLookup(false), [ff]);
        });

        it('applies a lookup at the glyphs of the enabled tokens only, like the feature mask of HarfBuzz', function() {
            // LookupFlagsArabicJoining.ttf: init sub lam by lam.init;, at the first of two lams only
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicJoining.ttf -u 0644,0644 [18=1+500|25=0+500]
            const initLookup = createSingleLookup([lam], [lamInitial]);
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('arab', 'init', [0], [initLookup]) }));
            const tokens = tokenize('\u{644}\u{644}');
            applyLookupToTokens(query, initLookup, 'init', tokens, token => token === tokens[0]);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [lamInitial, lam]);
        });

        it('matches the glyphs of the disabled tokens in the lookahead and the backtrack of a rule', function() {
            // LookupFlagsFinaAcrossSpace.ttf: fina sub dal' lookup DAL_ALT .notdef lam; (sub dal by dal.alt;), at the final dal
            // only, its lookahead the space and the lam that take no final form
            // lam, dal, space, lam: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsFinaAcrossSpace.ttf
            // -u 0644,062F,0020,0644 [18=3+500|0=2+500|17=1+500|18=0+500]
            const lookaheadLookup = {
                lookupType: 6,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 1,
                    coverage: createCoverage([dal]),
                    chainRuleSets: [[{ backtrack: [], input: [], lookahead: [0, lam], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }]]
                }]
            };
            const dalLookup = createSingleLookup([dal], [dalAlternate]);
            const finaQuery = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('arab', 'fina', [1], [dalLookup, lookaheadLookup]) }));
            const lookaheadTokens = tokenize('\u{644}\u{62F} \u{644}');
            applyLookupToTokens(finaQuery, lookaheadLookup, 'fina', lookaheadTokens, token => token === lookaheadTokens[1]);
            assert.deepStrictEqual(getGlyphSequence(lookaheadTokens).glyphIndexes, [lam, dalAlternate, 0, lam]);
            // LookupFlagsArabicFormsChaining.ttf: fina sub dal by dal.alt; (with sub reh by reh.alt fatha;), then init
            // lookupflag IgnoreMarks; sub [dal.alt reh.alt] lam' by lam.init;, at the initial lams only, whose backtrack is a
            // final dal.alt: lam, dal, lam, dal: hb-shape --no-glyph-names --cluster-level=1 --features=-kern
            // LookupFlagsArabicFormsChaining.ttf -u 0644,062F,0644,062F [17=3+500|25=2+500|17=1+500|18=0+500]
            const backtrackLookup = {
                lookupType: 6,
                lookupFlag: IGNORE_MARKS,
                subtables: [{
                    substFormat: 3,
                    backtrackCoverage: [createCoverage([dalAlternate, glyphIndexes['reh.alt']])],
                    inputCoverage: createCoverages([lam]),
                    lookaheadCoverage: [],
                    lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 2 }]
                }]
            };
            const lookups = [dalLookup, backtrackLookup, createSingleLookup([lam], [lamInitial])];
            const formsQuery = new FeatureQuery(createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['fina', [0]], ['init', [1]]] }, lookups) }));
            const backtrackTokens = tokenize('\u{644}\u{62F}\u{644}\u{62F}');
            applyLookupToTokens(formsQuery, dalLookup, 'fina', backtrackTokens, token => token.char === '\u{62F}');
            applyLookupToTokens(formsQuery, backtrackLookup, 'init', backtrackTokens, token => token.char === '\u{644}');
            assert.deepStrictEqual(getGlyphSequence(backtrackTokens).glyphIndexes, [lam, dalAlternate, lamInitial, dalAlternate]);
        });

        describe('a nested ligature substitution', function() {
            // the contextual rules of ss37, ss38, ss39, ss43, ss44, ss45, ss47 and ss52 of LookupFlags.ttf (test/generate-lookup-flags-font.py),
            // here as chaining context format 3, with the nested lookups 0: LIGATURE_NO_FLAG, sub a b by a_b; 1: SUB_ACUTE_B;
            // 2: LIGATURE_AT_MULTIPLE_IGNORE_MARKS, lookupflag IgnoreMarks; sub a b by a_b; 3: LIGATURE_A_B_TO_A, sub a b by a;
            // 4: LIGATURE_A_B_C, sub a b c by a_b_c; 5: SUB_B, sub b by b.alt;
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature> LookupFlags.ttf -u <code points>
            const nestedLookups = [
                createLigatureLookup(glyphA, [glyphB], glyphIndexes.a_b),
                subAcuteBLookup,
                createLigatureLookup(glyphA, [glyphB], glyphIndexes.a_b, IGNORE_MARKS),
                createLigatureLookup(glyphA, [glyphB], glyphA),
                createLigatureLookup(glyphA, [glyphB, glyphC], glyphIndexes.a_b_c),
                createSingleLookup([glyphB], [glyphIndexes['b.alt']])
            ];

            // a chaining context lookup of a subtable of format 3 for each rule, its input, lookahead and lookup records
            const chainingLookup = rules => ({
                lookupType: 6,
                lookupFlag: 0,
                subtables: rules.map(([input, lookahead, lookupRecords]) => ({
                    substFormat: 3,
                    backtrackCoverage: [],
                    inputCoverage: createCoverages(input),
                    lookaheadCoverage: createCoverages(lookahead),
                    lookupRecords
                }))
            });

            // the glyphs and the cluster of each token of a text that is not deleted, after the lookups in order
            function applyLookups(appliedLookups, text) {
                const lookups = nestedLookups.concat(appliedLookups);
                const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [lookups.length - 1], lookups) }));
                const tokens = tokenize(text);
                for (const lookupTable of appliedLookups) {
                    applyLookupToTokens(query, lookupTable, 'calt', tokens);
                }
                return describeTokens(tokens.filter(token => !token.state.deleted));
            }

            // the glyphs and the cluster of each token of a text that is not deleted, after a chaining rule of format 3
            function applyChainingRule(input, lookahead, lookupRecords, text) {
                return applyLookups([chainingLookup([[input, lookahead, lookupRecords]])], text);
            }

            it('merges the clusters of its components, with the mark it skips after the ligature glyph', function() {
                // ss37: sub a' lookup LIGATURE_AT_MULTIPLE_IGNORE_MARKS acute' b'; -u 0061,0301,0062: [9=0+500|5=0+0]
                const tokens = applyChainingRule([glyphA, acute, glyphB], [], [{ sequenceIndex: 0, lookupListIndex: 2 }], 'a\u{301}b');
                assert.deepStrictEqual(tokens, [[[glyphIndexes.a_b], 0], [[acute], 0]]);
            });

            it('merges the clusters of a component after the input of the rule', function() {
                // ss38: sub a' lookup LIGATURE_NO_FLAG b; -u 0061,0062,0061,0062: [9=0+500|9=2+500]
                const tokens = applyChainingRule([glyphA], [glyphB], [{ sequenceIndex: 0, lookupListIndex: 0 }], 'abab');
                assert.deepStrictEqual(tokens, [[[glyphIndexes.a_b], 0], [[glyphIndexes.a_b], 2]]);
            });

            it('goes on at the glyph of a ligature with a component after the input of the rule, which the rule matches again', function() {
                // ss43: sub a' lookup LIGATURE_A_B_TO_A b; -u 0061,0062,0062: [1=0+500], -u 0061,0062,0062,0062: [1=0+500]
                const lookupRecords = [{ sequenceIndex: 0, lookupListIndex: 3 }];
                assert.deepStrictEqual(applyChainingRule([glyphA], [glyphB], lookupRecords, 'abb'), [[[glyphA], 0]]);
                assert.deepStrictEqual(applyChainingRule([glyphA], [glyphB], lookupRecords, 'abbb'), [[[glyphA], 0]]);
            });

            it('goes on at the glyph of a ligature with two components after the input of the rule, not at a glyph before it', function() {
                // ss44: sub b' lookup SUB_B a_b_c; sub a' lookup LIGATURE_A_B_C b c; -u 0062,0061,0062,0063: [2=0+500|10=1+500],
                // the b before a_b_c is kept
                const stepBackLookup = chainingLookup([
                    [[glyphB], [glyphIndexes.a_b_c], [{ sequenceIndex: 0, lookupListIndex: 5 }]],
                    [[glyphA], [glyphB, glyphC], [{ sequenceIndex: 0, lookupListIndex: 4 }]]
                ]);
                assert.deepStrictEqual(applyLookups([stepBackLookup], 'babc'), [[[glyphB], 0], [[glyphIndexes.a_b_c], 1]]);
            });

            it('goes on at the glyph of a ligature at a later sequence index with components after the input, not at the current glyph', function() {
                // ss52: sub b' lookup SUB_B a_b_c; sub b' a' lookup LIGATURE_A_B_C b c; -u 0062,0061,0062,0063: [2=0+500|10=1+500],
                // -u 0062,0062,0061,0062,0063: [2=0+500|2=1+500|10=2+500], the b before a_b_c is kept
                const laterRecordLookup = chainingLookup([
                    [[glyphB], [glyphIndexes.a_b_c], [{ sequenceIndex: 0, lookupListIndex: 5 }]],
                    [[glyphB, glyphA], [glyphB, glyphC], [{ sequenceIndex: 1, lookupListIndex: 4 }]]
                ]);
                assert.deepStrictEqual(applyLookups([laterRecordLookup], 'babc'), [[[glyphB], 0], [[glyphIndexes.a_b_c], 1]]);
                assert.deepStrictEqual(applyLookups([laterRecordLookup], 'bbabc'), [[[glyphB], 0], [[glyphB], 1], [[glyphIndexes.a_b_c], 2]]);
            });

            it('forms a ligature of a glyph of a multiple substitution and the glyph of the next token, with one cluster', function() {
                // ss47: MULTIPLE_C_B_A (sub c by b a;), then sub a' lookup LIGATURE_NO_FLAG b; -u 0063,0062: [2=0+500|9=0+500]
                const multipleLookup = createMultipleLookup([glyphC], [[glyphB, glyphA]]);
                const pastInputLookup = chainingLookup([[[glyphA], [glyphB], [{ sequenceIndex: 0, lookupListIndex: 0 }]]]);
                assert.deepStrictEqual(applyLookups([multipleLookup, pastInputLookup], 'cb'), [[[glyphB, glyphIndexes.a_b], 0]]);
            });

            it('applies a later lookup record to the glyph after the ligature, which keeps its cluster', function() {
                // ss39: sub a' lookup LIGATURE_NO_FLAG b' lookup SUB_ACUTE_B acute'; -u 0061,0062,0301: [9=0+500|11=2+0]
                const lookupRecords = [{ sequenceIndex: 0, lookupListIndex: 0 }, { sequenceIndex: 1, lookupListIndex: 1 }];
                const tokens = applyChainingRule([glyphA, glyphB, acute], [], lookupRecords, 'ab\u{301}');
                assert.deepStrictEqual(tokens, [[[glyphIndexes.a_b], 0], [[glyphIndexes['acute.alt']], 2]]);
            });

            it('applies a later lookup record to the glyph after a ligature of three components', function() {
                // ss45 with the second lookup record at the sequence index 1 (LookupFlagsNestedLigatureSequenceIndex.ttf):
                // sub a' lookup LIGATURE_A_B_C b' c' acute' lookup SUB_ACUTE_B; -u 0061,0062,0063,0301: [10=0+500|11=3+0]
                const lookupRecords = [{ sequenceIndex: 0, lookupListIndex: 4 }, { sequenceIndex: 1, lookupListIndex: 1 }];
                const tokens = applyChainingRule([glyphA, glyphB, glyphC, acute], [], lookupRecords, 'abc\u{301}');
                assert.deepStrictEqual(tokens, [[[glyphIndexes.a_b_c], 0], [[glyphIndexes['acute.alt']], 3]]);
            });
        });

        it('applies a lookup at each glyph of a multiple substitution of an enabled token', function() {
            // LookupFlagsArabicFormsNested.ttf: ccmp sub dal by dal fatha; (nested), then fina sub dal by dal.alt; sub fatha by
            // acute.alt;, at the glyphs of the final dal only
            // lam, dal: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicFormsNested.ttf -u 0644,062F
            // [11=1+0|17=1+500|18=0+500]
            const multipleLookup = createMultipleLookup([dal], [[dal, fatha]]);
            const finaLookup = createSingleLookup([fatha, dal], [glyphIndexes['acute.alt'], dalAlternate]);
            const gsub = createScriptsLayoutTable({ arab: [['ccmp', [0]], ['fina', [1]]] }, [multipleLookup, finaLookup]);
            const query = new FeatureQuery(createLookupFlagsFont({ gsub }));
            const tokens = tokenize('\u{644}\u{62F}');
            applyLookupToTokens(query, multipleLookup, 'ccmp', tokens);
            applyLookupToTokens(query, finaLookup, 'fina', tokens, token => token === tokens[1]);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [lam, dalAlternate, glyphIndexes['acute.alt']]);
        });
    });

    describe('applyFeaturesToTokens', function() {
        // the lookups in arab rlig, applied like the arabic required ligatures; the feature has the lookups of the last indexes
        // given, the other lookups are the nested ones
        function applyLookups(lookups, text, featureLookupIndexes = lookups.map((lookup, index) => index)) {
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('arab', 'rlig', featureLookupIndexes, lookups) }));
            const tokens = tokenize(text);
            applyFeaturesToTokens(query, ['rlig'], 'arab', undefined, tokens);
            return getGlyphSequence(tokens).glyphIndexes;
        }

        it('applies a later lookup at the glyph after a deleted one', function() {
            // ss30: sub c by NULL; then sub acute by acute.alt; sub b by b.alt;
            // --features=-kern,+ss30 LookupFlagsNestedDeletion.ttf -u 0063,0062: [8=0+500]
            assert.deepStrictEqual(applyLookups([createMultipleLookup([glyphC], [[]]), subAcuteBLookup], 'cb'), [glyphIndexes['b.alt']]);
        });

        it('goes on after the glyphs of a multiple substitution, which its lookup does not substitute again', function() {
            // ss32: sub c by a acute; sub acute by acute.alt; -u 0063,0062: [1=0+500|5=0+0|2=1+500]
            const lookup = createMultipleLookup([glyphC, acute], [[glyphA, acute], [glyphIndexes['acute.alt']]]);
            assert.deepStrictEqual(applyLookups([lookup], 'cb'), [glyphA, acute, glyphB]);
        });

        it('goes on after the input of a contextual rule, the glyphs of its nested multiple substitutions included', function() {
            // ss34: sub a' b' lookup MULTIPLE_B_A_B; (sub b by a b;), whose glyphs of b match the rule again
            // -u 0061,0062: [1=0+500|1=1+500|2=1+500]
            const contextLookup = {
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{ substFormat: 3, coverages: createCoverages([glyphA, glyphB]), lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 0 }] }]
            };
            const lookups = [createMultipleLookup([glyphB], [[glyphA, glyphB]]), contextLookup];
            assert.deepStrictEqual(applyLookups(lookups, 'ab', [1]), [glyphA, glyphA, glyphB]);
        });

        it('applies each lookup of the feature at every glyph, the other input glyphs of a contextual rule of an earlier one included', function() {
            // rlig: sub dal' lookup DAL_ALT lam'; (sub dal by dal.alt;) then sub lam alef by lam_alef;
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsRligContextThenLigature.ttf -u 062F,0644,0627
            // [19=1+500|17=0+500], in visual order
            const contextLookup = {
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{ substFormat: 3, coverages: createCoverages([dal, lam]), lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }]
            };
            const ligatureLookup = {
                lookupType: 4,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, coverage: createCoverage([lam]), ligatureSets: [[{ ligGlyph: glyphIndexes.lam_alef, components: [alef] }]] }]
            };
            const lookups = [createSingleLookup([dal], [glyphIndexes['dal.alt']]), contextLookup, ligatureLookup];
            assert.deepStrictEqual(applyLookups(lookups, '\u{62F}\u{644}\u{627}', [1, 2]), [glyphIndexes['dal.alt'], glyphIndexes.lam_alef]);
        });

        it('applies the lookups of a feature in lookup list order, not in the order of the feature', function() {
            // LookupFlagsRligUnsorted.ttf: rlig lists lookup 1 (sub dal by dal.alt;) then lookup 0 (sub dal.alt by reh.alt;)
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsRligUnsorted.ttf -u 062F,0631: [13=1+500|17=0+500]
            const lookups = [createSingleLookup([glyphIndexes['dal.alt']], [glyphIndexes['reh.alt']]), createSingleLookup([dal], [glyphIndexes['dal.alt']])];
            assert.deepStrictEqual(applyLookups(lookups, '\u{62F}\u{631}', [1, 0]), [glyphIndexes['dal.alt'], reh]);
        });

        it('applies a lookup that a feature lists twice once', function() {
            // LookupFlagsCcmpDuplicate.ttf: ccmp lists lookup 0 (sub lam alef by lam_alef;) then lookup 1 (sub lam by lam fatha;
            // sub dal by dal fatha;) twice
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsCcmpDuplicate.ttf -u 0631,062F: [14=1+0|15=1+500|13=0+500]
            const ligatureLookup = {
                lookupType: 4,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, coverage: createCoverage([lam]), ligatureSets: [[{ ligGlyph: glyphIndexes.lam_alef, components: [alef] }]] }]
            };
            const lookups = [ligatureLookup, createMultipleLookup([dal, lam], [[dal, fatha], [lam, fatha]])];
            assert.deepStrictEqual(applyLookups(lookups, '\u{631}\u{62F}', [0, 1, 1]), [reh, dal, fatha]);
        });

        it('applies the other lookups of a feature that lists an index past the lookup list', function() {
            // an index of the LookupList out of the list is invalid, HarfBuzz ignores it: LookupFlagsRligIndexPastList.ttf, the
            // lookups of LookupFlagsRligChain.ttf with the rlig lookup indexes 0 (sub dal by dal.alt;) and 7
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsRligIndexPastList.ttf -u 0631,062F
            // [17=1+500|13=0+500]
            const lookups = [createSingleLookup([dal], [glyphIndexes['dal.alt']]), createSingleLookup([glyphIndexes['dal.alt']], [glyphIndexes['reh.alt']])];
            assert.deepStrictEqual(applyLookups(lookups, '\u{631}\u{62F}', [0, 7]), [reh, glyphIndexes['dal.alt']]);
        });

        it('applies the lookups of several features in lookup list order, each one with the tag of its feature', function() {
            // rlig lists sub dal by dal.alt; (lookup 0), ccmp sub dal.alt by reh.alt; (lookup 1): HarfBuzz applies the lookups of
            // the features of a stage in lookup list order (LookupFlagsThaiFeatures.ttf, see bidi.spec.mjs), so feature by feature
            // in the order ccmp, rlig would give dal.alt
            const lookups = [createSingleLookup([dal], [glyphIndexes['dal.alt']]), createSingleLookup([glyphIndexes['dal.alt']], [glyphIndexes['reh.alt']])];
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['rlig', [0]], ['ccmp', [1]]] }, lookups) }));
            const tokens = tokenize('\u{62F}');
            applyFeaturesToTokens(query, ['ccmp', 'rlig'], 'arab', undefined, tokens);
            assert.deepStrictEqual(tokens[0].state, { glyphIndex: dal, rlig: glyphIndexes['dal.alt'], ccmp: glyphIndexes['reh.alt'] });
        });
    });

    describe('applyFeatureStagesToTokens', function() {
        // rvrn sub a by b; (lookup 1) and liga sub a by a.alt; (lookup 0), the lookups of the rvrn and the liga of
        // TestScriptLanguage.ttf (test/generate-script-language-font.py) with x, x.rvrn and x.liga:
        // hb-shape --no-glyph-names --cluster-level=1 TestScriptLanguage.ttf -u 0078: [22=0+500], x.rvrn
        const lookups = [createSingleLookup([glyphA], [glyphIndexes['a.alt']]), createSingleLookup([glyphA], [glyphB])];
        const gsub = createScriptsLayoutTable({ latn: [['liga', [0]], ['rvrn', [1]]] }, lookups);

        it('applies the lookups of rvrn before the lookups of the other features, like HarfBuzz', function() {
            const tokens = tokenize('a');
            applyFeatureStagesToTokens(new FeatureQuery(createLookupFlagsFont({ gsub })), ['liga', 'rvrn'], 'latn', undefined, tokens);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphB]);
        });

        it('applies the lookups of the other features without rvrn', function() {
            // --features=-rvrn -u 0078: [21=0+500], x.liga
            const tokens = tokenize('a');
            applyFeatureStagesToTokens(new FeatureQuery(createLookupFlagsFont({ gsub })), ['liga'], 'latn', undefined, tokens);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphIndexes['a.alt']]);
        });
    });

    describe('the required feature of a language system', function() {
        // liga sub a by a.alt; (lookup 0) and the required feature (ReqFeatureIndex) ss05 sub a by b; (lookup 1), the
        // lookups of the liga sub o by o.liga; and of the required feature ss05 sub o by o.req; of latn TRK of
        // TestScriptLanguage.ttf (test/generate-script-language-font.py)
        const lookups = [createSingleLookup([glyphA], [glyphIndexes['a.alt']]), createSingleLookup([glyphA], [glyphB])];

        function createRequiredFeatureQuery() {
            const gsub = createScriptsLayoutTable({ latn: [['liga', [0]]] }, lookups);
            gsub.features.push({ tag: 'ss05', feature: { featureParams: 0, lookupListIndexes: [1] } });
            gsub.scripts[0].script.defaultLangSys.reqFeatureIndex = 1;
            return new FeatureQuery(createLookupFlagsFont({ gsub }));
        }

        it('gives the stage of the tag of the required feature, otherwise the first stage, like HarfBuzz', function() {
            // hb_ot_map_builder_t::compile of HarfBuzz 11.3.2: required_feature_stage is 0 unless an enabled feature has its tag
            const stages = [['rvrn'], ['ccmp', 'liga']];
            assert.strictEqual(getRequiredFeatureStage(stages, { tag: 'liga' }), 1);
            assert.strictEqual(getRequiredFeatureStage(stages, { tag: 'ss05' }), 0);
            assert.strictEqual(getRequiredFeatureStage([[], ['ss05']], { tag: 'ss05' }), 1);
            assert.strictEqual(getRequiredFeatureStage(stages, null), -1);
        });

        it('adds the lookups of the required feature to the lookups of the features, with its tag', function() {
            const query = createRequiredFeatureQuery();
            assert.deepStrictEqual(getFeaturesLookups(query, ['liga'], 'latn', undefined, true), [
                { lookupTable: lookups[0], tag: 'liga', isRequiredFeatureLookup: false },
                { lookupTable: lookups[1], tag: 'ss05', isRequiredFeatureLookup: true }
            ]);
            assert.deepStrictEqual(getFeaturesLookups(query, ['liga'], 'latn'), [{ lookupTable: lookups[0], tag: 'liga', isRequiredFeatureLookup: false }]);
        });

        it('gives a lookup of both a feature and the required feature once, as a lookup of the required feature', function() {
            // HarfBuzz (hb_ot_map_builder_t::compile) merges a lookup that two features of a stage have, with the OR of their
            // masks: the global mask of the required feature
            const gsub = createScriptsLayoutTable({ latn: [['liga', [0, 1]]] }, lookups);
            gsub.features.push({ tag: 'ss05', feature: { featureParams: 0, lookupListIndexes: [1] } });
            gsub.scripts[0].script.defaultLangSys.reqFeatureIndex = 1;
            const query = new FeatureQuery(createLookupFlagsFont({ gsub }));
            assert.deepStrictEqual(getFeaturesLookups(query, ['liga'], 'latn', undefined, true), [
                { lookupTable: lookups[0], tag: 'liga', isRequiredFeatureLookup: false },
                { lookupTable: lookups[1], tag: 'liga', isRequiredFeatureLookup: true }
            ]);
        });

        it('applies the lookups of the required feature with rvrn when its tag is not enabled, like HarfBuzz', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr TestScriptLanguage.ttf -u 006F: [71=0+500], o.req
            const tokens = tokenize('a');
            applyFeatureStagesToTokens(createRequiredFeatureQuery(), ['liga', 'rvrn'], 'latn', undefined, tokens);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphB]);
        });

        it('applies the lookups of the required feature with the other features when its tag is enabled, like HarfBuzz', function() {
            // --language=tr --features=+ss05 -u 006F: [70=0+500], o.liga
            const tokens = tokenize('a');
            applyFeatureStagesToTokens(createRequiredFeatureQuery(), ['liga', 'ss05'], 'latn', undefined, tokens);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphIndexes['a.alt']]);
        });
    });

    describe('getFeaturesLookups', function() {
        it('gives the lookups of features in lookup list order, each one once with the tag of the first feature that lists it', function() {
            const lookups = [subAcuteBLookup, multipleCLookup, createSingleLookup([glyphA], [glyphIndexes['a.alt']])];
            const gsub = createScriptsLayoutTable({ latn: [['ccmp', [2, 1]], ['liga', [1, 0, 1, 9]]] }, lookups);
            const query = new FeatureQuery(createLookupFlagsFont({ gsub }));
            assert.deepStrictEqual(getFeaturesLookups(query, ['ccmp', 'liga', 'calt'], 'latn'), [
                { lookupTable: lookups[0], tag: 'liga', isRequiredFeatureLookup: false },
                { lookupTable: lookups[1], tag: 'ccmp', isRequiredFeatureLookup: false },
                { lookupTable: lookups[2], tag: 'ccmp', isRequiredFeatureLookup: false }
            ]);
        });
    });
});
