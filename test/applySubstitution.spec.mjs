import assert from 'assert';
import Tokenizer from '../src/tokenizer.mjs';
import FeatureQuery, { SubstitutionAction } from '../src/features/featureQuery.mjs';
import applySubstitution, {
    getTokenGlyphIndexes,
    getGlyphSequence,
    applyLookupToTokens,
    getFeaturesLookups,
    applyFeaturesToTokens
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
    multipleCLookup,
    subAcuteBLookup
} from './lookup-flags-font.mjs';

/**
 * The substitutions applied to the tokens of a text and to their glyph sequence, with the glyphs of
 * test/lookup-flags-font.mjs: the characters a, b, c, U+0301, U+0627, U+062F, U+0631 and U+0644 map to the glyphs a, b, c,
 * acute, alef, dal, reh and lam. The glyphs
 * and the clusters of each case are the ones of HarfBuzz for the lookups quoted, from LookupFlags.ttf
 * (hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature> LookupFlags.ttf -u <code points>).
 */
describe('applySubstitution.mjs', function() {
    const { a: glyphA, b: glyphB, c: glyphC, acute, alef, dal, reh, lam, fatha } = glyphIndexes;
    const characterGlyphIndexes = { a: glyphA, b: glyphB, c: glyphC, '\u{301}': acute, '\u{627}': alef, '\u{62F}': dal, '\u{631}': reh, '\u{644}': lam };

    // the tokens of a text, each one with the glyph of its character
    function tokenize(text) {
        const tokenizer = new Tokenizer();
        tokenizer.registerModifier('glyphIndex', null, token => characterGlyphIndexes[token.char]);
        return tokenizer.tokenize(text);
    }

    const action = (id, substitution) => new SubstitutionAction({ id, tag: 'calt', substitution });

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

        it('applies the substitutions of a contextual rule from the last input glyph, and goes on after the input', function() {
            // ss23: sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B; with the second record at the sequence index 2
            // (LookupFlagsNestedSequenceIndex.ttf) -u 0063,0062: [1=0+500|5=0+0|8=1+500]
            const tokens = tokenize('cb');
            const glyphSequence = getGlyphSequence(tokens);
            const substitutions = [[glyphA, acute], glyphIndexes['b.alt']];
            assert.equal(applySubstitution(action(53, { substitutions, lastInputOffset: 1 }), glyphSequence, 0), 3);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphA, acute, glyphIndexes['b.alt']]);
            assert.deepStrictEqual(describeTokens(tokens), [[[glyphA, acute], 0], [[glyphIndexes['b.alt']], 1]]);
        });

        it('goes on after the glyphs of a nested multiple substitution of the last input glyph', function() {
            // ss34: sub a' b' lookup MULTIPLE_B_A_B; (sub b by a b;), the lookup goes on after the b of the glyphs of b
            // -u 0061,0062: [1=0+500|1=1+500|2=1+500]
            const tokens = tokenize('ab');
            const glyphSequence = getGlyphSequence(tokens);
            const substitutions = [];
            substitutions[1] = [glyphA, glyphB];
            assert.equal(applySubstitution(action(53, { substitutions, lastInputOffset: 1 }), glyphSequence, 0), 3);
            assert.deepStrictEqual(describeTokens(tokens), [[[glyphA], 0], [[glyphA, glyphB], 1]]);
        });

        it('goes on after the last input glyph of a contextual rule, past the glyphs its lookup skips', function() {
            // ss01: lookupflag IgnoreMarks; sub a' b' lookup SUB_B; -u 0061,0301,0062: [1=0+500|5=1+0|8=2+500]
            const tokens = tokenize('a\u{301}b');
            const glyphSequence = getGlyphSequence(tokens);
            const substitutions = [];
            substitutions[2] = glyphIndexes['b.alt'];
            assert.equal(applySubstitution(action(53, { substitutions, lastInputOffset: 2 }), glyphSequence, 0), 3);
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
    });

    describe('applyFeaturesToTokens', function() {
        // the lookups in arab rlig, applied like the arabic required ligatures; the feature has the lookups of the last indexes
        // given, the other lookups are the nested ones
        function applyLookups(lookups, text, isTokenSkipped, featureLookupIndexes = lookups.map((lookup, index) => index)) {
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('arab', 'rlig', featureLookupIndexes, lookups) }));
            const tokens = tokenize(text);
            applyFeaturesToTokens(query, ['rlig'], 'arab', tokens, isTokenSkipped);
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
            assert.deepStrictEqual(applyLookups(lookups, 'ab', undefined, [1]), [glyphA, glyphA, glyphB]);
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
            assert.deepStrictEqual(applyLookups(lookups, '\u{62F}\u{644}\u{627}', undefined, [1, 2]), [glyphIndexes['dal.alt'], glyphIndexes.lam_alef]);
        });

        it('does not apply the lookups at the glyphs of the skipped tokens', function() {
            const tokenIsC = token => token.char === 'c';
            assert.deepStrictEqual(applyLookups([multipleCLookup, subAcuteBLookup], 'cb', tokenIsC), [glyphC, glyphIndexes['b.alt']]);
        });

        it('applies the lookups of a feature in lookup list order, not in the order of the feature', function() {
            // LookupFlagsRligUnsorted.ttf: rlig lists lookup 1 (sub dal by dal.alt;) then lookup 0 (sub dal.alt by reh.alt;)
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsRligUnsorted.ttf -u 062F,0631: [13=1+500|17=0+500]
            const lookups = [createSingleLookup([glyphIndexes['dal.alt']], [glyphIndexes['reh.alt']]), createSingleLookup([dal], [glyphIndexes['dal.alt']])];
            assert.deepStrictEqual(applyLookups(lookups, '\u{62F}\u{631}', undefined, [1, 0]), [glyphIndexes['dal.alt'], reh]);
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
            assert.deepStrictEqual(applyLookups(lookups, '\u{631}\u{62F}', undefined, [0, 1, 1]), [reh, dal, fatha]);
        });

        it('applies the other lookups of a feature that lists an index past the lookup list', function() {
            // an index of the LookupList out of the list is invalid, HarfBuzz ignores it: LookupFlagsRligIndexPastList.ttf, the
            // lookups of LookupFlagsRligChain.ttf with the rlig lookup indexes 0 (sub dal by dal.alt;) and 7
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsRligIndexPastList.ttf -u 0631,062F
            // [17=1+500|13=0+500]
            const lookups = [createSingleLookup([dal], [glyphIndexes['dal.alt']]), createSingleLookup([glyphIndexes['dal.alt']], [glyphIndexes['reh.alt']])];
            assert.deepStrictEqual(applyLookups(lookups, '\u{631}\u{62F}', undefined, [0, 7]), [reh, glyphIndexes['dal.alt']]);
        });

        it('applies the lookups of several features in lookup list order, each one with the tag of its feature', function() {
            // rlig lists sub dal by dal.alt; (lookup 0), ccmp sub dal.alt by reh.alt; (lookup 1): HarfBuzz applies the lookups of
            // the features of a stage in lookup list order (LookupFlagsThaiFeatures.ttf, see bidi.spec.mjs), so feature by feature
            // in the order ccmp, rlig would give dal.alt
            const lookups = [createSingleLookup([dal], [glyphIndexes['dal.alt']]), createSingleLookup([glyphIndexes['dal.alt']], [glyphIndexes['reh.alt']])];
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['rlig', [0]], ['ccmp', [1]]] }, lookups) }));
            const tokens = tokenize('\u{62F}');
            applyFeaturesToTokens(query, ['ccmp', 'rlig'], 'arab', tokens);
            assert.deepStrictEqual(tokens[0].state, { glyphIndex: dal, rlig: glyphIndexes['dal.alt'], ccmp: glyphIndexes['reh.alt'] });
        });
    });

    describe('getFeaturesLookups', function() {
        it('gives the lookups of features in lookup list order, each one once with the tag of the first feature that lists it', function() {
            const lookups = [subAcuteBLookup, multipleCLookup, createSingleLookup([glyphA], [glyphIndexes['a.alt']])];
            const gsub = createScriptsLayoutTable({ latn: [['ccmp', [2, 1]], ['liga', [1, 0, 1, 9]]] }, lookups);
            const query = new FeatureQuery(createLookupFlagsFont({ gsub }));
            assert.deepStrictEqual(getFeaturesLookups(query, ['ccmp', 'liga', 'calt'], 'latn'), [
                { lookupTable: lookups[0], tag: 'liga' },
                { lookupTable: lookups[1], tag: 'ccmp' },
                { lookupTable: lookups[2], tag: 'ccmp' }
            ]);
        });
    });
});
