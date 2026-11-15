import assert from 'assert';
import { readFileSync } from 'fs';
import { parse } from '../src/opentype.mjs';
import Tokenizer from '../src/tokenizer.mjs';
import { formatShape, getLookupOffsetField, getLookupSubtableOffsets } from './testutil.mjs';
import FeatureQuery, { SubstitutionAction } from '../src/features/featureQuery.mjs';
import applySubstitution, {
    getTokenGlyphIndexes,
    getTokenLigatureProperties,
    getTokenLigatedGlyphs,
    getTokenDefaultIgnorableType,
    getGlyphSequence,
    applyLookupToTokens,
    getFeaturesLookups,
    getLookupFeatureValue,
    applyFeatureLookupsToTokens,
    getRequiredFeatureStage,
    getDefaultShaperFeatureStages
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
import { AUTO_JOINER_FLAGS, getCoveragesGlyphDigest, mayGlyphDigestHave } from '../src/layout.mjs';
import { DEFAULT_IGNORABLE_TYPES } from '../src/char.mjs';
import { itFailsUntilFixed } from './regression/helpers.mjs';

/**
 * The substitutions applied to the tokens of a text and to their glyph sequence, with the glyphs of
 * test/lookup-flags-font.mjs: the characters a, b, c, U+0301, U+0627, U+062F, U+0631, U+0644, U+064E and U+FB00 map to the
 * glyphs a, b, c, acute, alef, dal, reh, lam, fatha and ff, the space, which the font has not, to the glyph 0 like
 * HarfBuzz. The glyphs
 * and the clusters of each case are the ones of HarfBuzz for the lookups quoted, from LookupFlags.ttf
 * (hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature> LookupFlags.ttf -u <code points>).
 */
// the first glyph filter of a lookup of single or multiple substitutions, the digest of the coverage tables of its
// subtables, the glyphs they substitute (see getLookupFirstGlyphDigest)
function getCoverageFilter(lookupTable) {
    return {
        glyphDigest: getCoveragesGlyphDigest(lookupTable.subtables.map(subtable => subtable.coverage)),
        subtables: lookupTable.subtables.slice()
    };
}

// apply the stages of features of the default shaper (see getDefaultShaperFeatureStages) to tokens, stage after stage
function applyDefaultShaperFeatureStages(query, tags, script, tokens) {
    for (const stage of getDefaultShaperFeatureStages(query, tags, script, undefined)) {
        applyFeatureLookupsToTokens(query, stage.lookups, tokens);
    }
}

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

    const IGNORE_BASE_GLYPHS = 0x0002;
    const IGNORE_LIGATURES = 0x0004;
    const IGNORE_MARKS = 0x0008;

    // the glyphs of each token, a deleted token has none, and its cluster
    const describeTokens = tokens => tokens.map(token => [token.state.deleted ? [] : getTokenGlyphIndexes(token), token.cluster]);

    describe('getGlyphSequence', function() {
        it('gives each glyph of a multiple substitution a position of its own, and none to a deleted token', function() {
            const tokens = tokenize('abc');
            tokens[0].setState('calt', [glyphA, acute]);
            tokens[1].setState('deleted', true);
            assert.deepStrictEqual(getGlyphSequence(tokens), {
                glyphIndexes: [glyphA, acute, glyphC], glyphTokens: [tokens[0], tokens[0], tokens[2]], ignorableTypes: [0, 0, 0],
                gdef: undefined, savedTokenStates: new Map()
            });
        });

        it('gives each glyph the kind of default ignorable of its token, until a substitution replaces its glyph', function() {
            // like _hb_glyph_info_is_default_ignorable of HarfBuzz, false for a glyph of HB_OT_LAYOUT_GLYPH_PROPS_SUBSTITUTED
            const { NOT_IGNORABLE, ZERO_WIDTH_JOINER } = DEFAULT_IGNORABLE_TYPES;
            const tokens = tokenize('abc');
            tokens[1].defaultIgnorableType = ZERO_WIDTH_JOINER;
            assert.strictEqual(getTokenDefaultIgnorableType(tokens[0]), NOT_IGNORABLE);
            assert.strictEqual(getTokenDefaultIgnorableType(tokens[1]), ZERO_WIDTH_JOINER);
            const glyphSequence = getGlyphSequence(tokens);
            assert.deepStrictEqual(glyphSequence.ignorableTypes, [NOT_IGNORABLE, ZERO_WIDTH_JOINER, NOT_IGNORABLE]);
            applySubstitution(action(21, [glyphA, acute]), glyphSequence, 1);
            assert.deepStrictEqual(glyphSequence.ignorableTypes, [NOT_IGNORABLE, NOT_IGNORABLE, NOT_IGNORABLE, NOT_IGNORABLE]);
            assert.strictEqual(getTokenDefaultIgnorableType(tokens[1]), NOT_IGNORABLE);
        });

        it('keeps the GDEF table of the layout, for the glyph classes of the ligature substitutions', function() {
            const gdef = createLookupFlagsFont().tables.gdef;
            assert.strictEqual(getGlyphSequence(tokenize('ab'), gdef).gdef, gdef);
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

    // the lig_props of HarfBuzz that ligate_input sets (hb-ot-layout-gsubgpos.hh), which the mark attachments of GPOS
    // read: their effect on the positions is tested with hb-shape references in position.spec.mjs
    describe('the ligature properties of the ligature substitutions', function() {
        const gdef = createLookupFlagsFont().tables.gdef;

        // the ligature properties of each glyph of the tokens that are not deleted, each ligatureId replaced by its number
        // from 1 in the order of the glyphs, null for a glyph without ligature properties
        function describeLigatureProperties(tokens) {
            const ligatureIds = [];
            return tokens.filter(token => !token.state.deleted).flatMap(token => {
                const tokenLigatureProperties = getTokenLigatureProperties(token);
                return getTokenGlyphIndexes(token).map((glyphIndex, index) => {
                    const ligatureProperties = tokenLigatureProperties[index];
                    if (!ligatureProperties) {
                        return null;
                    }
                    if (ligatureProperties.ligatureId && !ligatureIds.includes(ligatureProperties.ligatureId)) {
                        ligatureIds.push(ligatureProperties.ligatureId);
                    }
                    return Object.assign({}, ligatureProperties, { ligatureId: ligatureIds.indexOf(ligatureProperties.ligatureId) + 1 });
                });
            });
        }

        it('gives a ligature its number of components and each mark it skipped the component it follows', function() {
            // lookupflag IgnoreMarks; sub a b c by a_b_c; on a acute b acute c
            const tokens = tokenize('a\u{301}b\u{301}c');
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [2, 4] }), getGlyphSequence(tokens, gdef), 0);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [
                { ligatureId: 1, ligatureComponentCount: 3 }, { ligatureId: 1, ligatureComponent: 1 }, { ligatureId: 1, ligatureComponent: 2 }
            ]);
        });

        it('counts the components of a component that is a ligature, and gives the marks after it their component of the new ligature', function() {
            // ss31: lookupflag IgnoreMarks; sub a b by a_b; then sub c a_b by a_b_c; on c a acute b: the acute follows the first
            // component of a_b, the second one of a_b_c
            const tokens = tokenize('ca\u{301}b');
            const glyphSequence = getGlyphSequence(tokens, gdef);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [2] }), glyphSequence, 1);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [
                null, { ligatureId: 1, ligatureComponentCount: 2 }, { ligatureId: 1, ligatureComponent: 1 }
            ]);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [1] }), glyphSequence, 0);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [
                { ligatureId: 1, ligatureComponentCount: 3 }, { ligatureId: 1, ligatureComponent: 2 }
            ]);
        });

        it('gives no ligature properties to a ligature of a base glyph and marks, nor of marks only', function() {
            // sub a acute by a.alt; and sub acute acute by acute.alt; (GDEF classes), not ligatures for HarfBuzz
            const baseTokens = tokenize('a\u{301}');
            applySubstitution(action(41, { ligGlyph: glyphIndexes['a.alt'], componentOffsets: [1] }), getGlyphSequence(baseTokens, gdef), 0);
            assert.deepStrictEqual(describeLigatureProperties(baseTokens), [null]);
            const markTokens = tokenize('\u{301}\u{301}');
            applySubstitution(action(41, { ligGlyph: glyphIndexes['acute.alt'], componentOffsets: [1] }), getGlyphSequence(markTokens, gdef), 0);
            assert.deepStrictEqual(describeLigatureProperties(markTokens), [null]);
            // without the glyph classes of GDEF a acute is a ligature
            const tokens = tokenize('a\u{301}');
            applySubstitution(action(41, { ligGlyph: glyphIndexes['a.alt'], componentOffsets: [1] }), getGlyphSequence(tokens), 0);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [{ ligatureId: 1, ligatureComponentCount: 2 }]);
        });

        it('counts one component for a ligature that GDEF classes as a base glyph, like HarfBuzz', function() {
            // _hb_glyph_info_get_lig_num_comps: the components of a ligature for a glyph of the ligature class only, 1
            // otherwise; ligate_input gives a mark after the last component the component components_so_far -
            // last_num_components + min(this_comp, last_num_components) of the new ligature. With a_b_c in the base class
            // of GDEF, on c a acute b acute c: sub a b c by a_b_c; then sub c a_b_c by a_b_c; the acutes, of the components
            // 1 and 2 of the first a_b_c, both on the component 2 of the second one
            const baseLigatureGdef = Object.assign({}, gdef, {
                classDef: {
                    format: 2,
                    ranges: gdef.classDef.ranges.map(range => range.start === glyphIndexes.a_b_c ? Object.assign({}, range, { classId: 1 }) : range)
                }
            });
            const tokens = tokenize('ca\u{301}b\u{301}c');
            const glyphSequence = getGlyphSequence(tokens, baseLigatureGdef);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [2, 4] }), glyphSequence, 1);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [1] }), glyphSequence, 0);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [
                { ligatureId: 1, ligatureComponentCount: 2 }, { ligatureId: 1, ligatureComponent: 2 }, { ligatureId: 1, ligatureComponent: 2 }
            ]);
        });

        it('leaves the marks after a ligature of marks with the component they follow, like HarfBuzz', function() {
            // ligate_input gives the marks after the last component their component of the new ligature only when it is not
            // a ligature of marks: on acute a acute b, sub a b by acute.alt; (a ligature that GDEF classes as a mark), then
            // sub acute acute.alt by acute.alt; (marks only), the acute keeps its component of the first ligature
            const tokens = tokenize('\u{301}a\u{301}b');
            const glyphSequence = getGlyphSequence(tokens, gdef);
            applySubstitution(action(41, { ligGlyph: glyphIndexes['acute.alt'], componentOffsets: [2] }), glyphSequence, 1);
            applySubstitution(action(41, { ligGlyph: glyphIndexes['acute.alt'], componentOffsets: [1] }), glyphSequence, 0);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphIndexes['acute.alt'], acute]);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [null, { ligatureId: 1, ligatureComponent: 1 }]);
        });

        it('keeps the ligature properties of a glyph of a ligature that a single or a multiple substitution replaces', function() {
            // Sequence::apply does not number the glyphs of a glyph with a lig_id (https://github.com/harfbuzz/harfbuzz/issues/3069):
            // lookupflag IgnoreMarks; sub a b by a_b; on a acute b, then sub acute by acute.alt dotbelow; and sub a_b by a.alt;
            const tokens = tokenize('a\u{301}b');
            const glyphSequence = getGlyphSequence(tokens, gdef);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [2] }), glyphSequence, 0);
            applySubstitution(action(21, [glyphIndexes['acute.alt'], glyphIndexes.dotbelow]), glyphSequence, 1);
            applySubstitution(action(12, glyphIndexes['a.alt']), glyphSequence, 0);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphIndexes['a.alt'], glyphIndexes['acute.alt'], glyphIndexes.dotbelow]);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [
                { ligatureId: 1, ligatureComponentCount: 2 }, { ligatureId: 1, ligatureComponent: 1 }, { ligatureId: 1, ligatureComponent: 1 }
            ]);
        });

        it('numbers the glyphs of a multiple substitution of a glyph of no ligature as the components of no ligature, like HarfBuzz', function() {
            // Sequence::apply gives the glyph i of a substitution of two or more glyphs the lig_comp i and no lig_id
            // (_hb_glyph_info_set_lig_props_for_component) when the glyph it replaces has no lig_id; a substitution of one
            // glyph keeps the lig_props: on c acute, sub c by a acute dotbelow; then sub dotbelow by a; (one glyph) and sub
            // acute by acute.alt dotbelow; (the acute of no ligature, its glyphs numbered again)
            const tokens = tokenize('c\u{301}');
            const glyphSequence = getGlyphSequence(tokens, gdef);
            applySubstitution(action(21, [glyphA, acute, glyphIndexes.dotbelow]), glyphSequence, 0);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [
                null, { ligatureId: 0, ligatureComponent: 1 }, { ligatureId: 0, ligatureComponent: 2 }, null
            ]);
            applySubstitution(action(21, [glyphA]), glyphSequence, 2);
            applySubstitution(action(21, [glyphIndexes['acute.alt'], glyphIndexes.dotbelow]), glyphSequence, 3);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphA, acute, glyphA, glyphIndexes['acute.alt'], glyphIndexes.dotbelow]);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [
                null, { ligatureId: 0, ligatureComponent: 1 }, { ligatureId: 0, ligatureComponent: 2 }, null,
                { ligatureId: 0, ligatureComponent: 1 }
            ]);
        });

        it('gives a mark of a multiple substitution that a ligature skipped the component its index in the substitution gives it, like HarfBuzz', function() {
            // ligate_input takes the lig_comp of a skipped glyph, last_num_components only when it is 0: lookupflag
            // IgnoreMarks; sub a b by a_b; on a b acute c, then sub acute by dotbelow acute; then sub a_b c by a_b_c; the dot
            // below (lig_comp 0) on the component 2 of a_b_c, the acute (lig_comp 1) on the component 1, like the acute of
            // sub z by dotbelowcomb acutecomb; in TestMarkAttachment.ttf (see position.spec.mjs)
            const tokens = tokenize('ab\u{301}c');
            const glyphSequence = getGlyphSequence(tokens, gdef);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [1] }), glyphSequence, 0);
            applySubstitution(action(21, [glyphIndexes.dotbelow, acute]), glyphSequence, 1);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [3] }), glyphSequence, 0);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphIndexes.a_b_c, glyphIndexes.dotbelow, acute]);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [
                { ligatureId: 1, ligatureComponentCount: 3 }, { ligatureId: 1, ligatureComponent: 2 }, { ligatureId: 1, ligatureComponent: 1 }
            ]);
        });

        it('gives a mark after a component that is a ligature, of none of its components, the last component of that ligature', function() {
            // ligate_input takes last_num_components for a skipped glyph without lig_comp: lookupflag IgnoreMarks; sub a b by
            // a_b; then sub a_b c by a_b_c; on a b acute c, the acute on the component 2 of a_b_c (the b of a_b), like the
            // acute after f_i of sub f_i a by a_f_i; in TestMarkAttachment.ttf (see position.spec.mjs)
            const tokens = tokenize('ab\u{301}c');
            const glyphSequence = getGlyphSequence(tokens, gdef);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [1] }), glyphSequence, 0);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [2] }), glyphSequence, 0);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [
                { ligatureId: 1, ligatureComponentCount: 3 }, { ligatureId: 1, ligatureComponent: 2 }
            ]);
        });

        it('counts the components of a component that is a ligature without the glyph classes of GDEF, like HarfBuzz', function() {
            // without the GlyphClassDef of GDEF, HarfBuzz gives the glyph of a ligature substitution the ligature class, so
            // _hb_glyph_info_get_lig_num_comps counts its components: the same substitutions as above, the acute on the
            // component 2 of a_b_c, which has 3 components
            const tokens = tokenize('ab\u{301}c');
            const glyphSequence = getGlyphSequence(tokens);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [1] }), glyphSequence, 0);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [2] }), glyphSequence, 0);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [
                { ligatureId: 1, ligatureComponentCount: 3 }, { ligatureId: 1, ligatureComponent: 2 }
            ]);
        });

        it('stops giving the glyphs after the last component their component of the new ligature at a glyph of no component, like HarfBuzz', function() {
            // ligate_input stops at a glyph of the ligature of the last component whose lig_comp is 0, like the glyphs of a
            // multiple substitution of that ligature: sub a b by a_b; on c a b, then sub a_b by a_b dotbelow; (both glyphs
            // keep the ligature properties of a_b), then sub c a_b by a_b_c; the dot below keeps its properties
            const tokens = tokenize('cab');
            const glyphSequence = getGlyphSequence(tokens, gdef);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [1] }), glyphSequence, 1);
            applySubstitution(action(21, [glyphIndexes.a_b, glyphIndexes.dotbelow]), glyphSequence, 1);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [1] }), glyphSequence, 0);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphIndexes.a_b_c, glyphIndexes.dotbelow]);
            assert.deepStrictEqual(describeLigatureProperties(tokens), [
                { ligatureId: 1, ligatureComponentCount: 3 }, { ligatureId: 2, ligatureComponentCount: 2 }
            ]);
        });
    });

    describe('the ligated glyphs of the ligature substitutions', function() {
        const gdef = createLookupFlagsFont().tables.gdef;

        // whether each glyph of the tokens that are not deleted is ligated
        const describeLigatedGlyphs = tokens => tokens.filter(token => !token.state.deleted).flatMap(
            token => getTokenGlyphIndexes(token).map((glyphIndex, index) => getTokenLigatedGlyphs(token)[index] === true)
        );

        it('sets the glyph of a ligature substitution as ligated, not the marks it skipped', function() {
            // lookupflag IgnoreMarks; sub a b c by a_b_c; on a acute b acute c: ligate_input replaces the first component
            // with replace_glyph_with_ligature, which sets the LIGATED glyph property
            const tokens = tokenize('a\u{301}b\u{301}c');
            assert.deepStrictEqual(describeLigatedGlyphs(tokens), [false, false, false, false, false]);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b_c, componentOffsets: [2, 4] }), getGlyphSequence(tokens, gdef), 0);
            assert.deepStrictEqual(describeLigatedGlyphs(tokens), [true, false, false]);
        });

        it('sets a ligature of a base glyph and a mark as ligated, which has no ligature properties', function() {
            // sub a acute by a.alt; (GDEF classes): not a ligature for the ligature properties, ligated for HarfBuzz
            const tokens = tokenize('a\u{301}');
            applySubstitution(action(41, { ligGlyph: glyphIndexes['a.alt'], componentOffsets: [1] }), getGlyphSequence(tokens, gdef), 0);
            assert.deepStrictEqual(getTokenLigatureProperties(tokens[0]), []);
            assert.deepStrictEqual(describeLigatedGlyphs(tokens), [true]);
        });

        it('does not set a ligature of one component as ligated, like HarfBuzz', function() {
            // Ligature::apply replaces a ligature of one component with replace_glyph, like a single substitution
            const tokens = tokenize('a');
            applySubstitution(action(41, { ligGlyph: glyphIndexes['a.alt'], componentOffsets: [] }), getGlyphSequence(tokens, gdef), 0);
            assert.deepStrictEqual(describeLigatedGlyphs(tokens), [false]);
        });

        it('keeps a glyph ligated through the single and multiple substitutions that replace it, like HarfBuzz', function() {
            // the glyphs of a substitution keep the glyph properties of the glyph they replace: sub a b by a_b; on c a b,
            // then sub a_b by a_b dotbelow; then sub dotbelow by acute;
            const tokens = tokenize('cab');
            const glyphSequence = getGlyphSequence(tokens, gdef);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [1] }), glyphSequence, 1);
            applySubstitution(action(21, [glyphIndexes.a_b, glyphIndexes.dotbelow]), glyphSequence, 1);
            applySubstitution(action(11, acute), glyphSequence, 2);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphC, glyphIndexes.a_b, acute]);
            assert.deepStrictEqual(describeLigatedGlyphs(tokens), [false, true, true]);
        });

        it('sets as ligated the glyph of a ligature at its position in a token of several glyphs', function() {
            // sub c by c a; then sub a b by a_b; on c b: the ligature starts at the second glyph of the token of c
            const tokens = tokenize('cb');
            const glyphSequence = getGlyphSequence(tokens, gdef);
            applySubstitution(action(21, [glyphC, glyphA]), glyphSequence, 0);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [1] }), glyphSequence, 1);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphC, glyphIndexes.a_b]);
            assert.deepStrictEqual(describeLigatedGlyphs(tokens), [false, true]);
        });

        it('keeps whether each glyph of a token is ligated when a substitution replaces its second glyph, like HarfBuzz', function() {
            // sub c by c a; then sub a b by a_b; then sub a_b by acute; on c b: replace_glyph keeps the glyph properties
            // of each glyph info, so only the glyph that replaces a_b is ligated
            const tokens = tokenize('cb');
            const glyphSequence = getGlyphSequence(tokens, gdef);
            applySubstitution(action(21, [glyphC, glyphA]), glyphSequence, 0);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [1] }), glyphSequence, 1);
            applySubstitution(action(11, acute), glyphSequence, 1);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphC, acute]);
            assert.deepStrictEqual(describeLigatedGlyphs(tokens), [false, true]);
        });

        it('keeps the ligated glyph of a token when a substitution deletes the glyph before it, like HarfBuzz', function() {
            // sub c by c a; then sub a b by a_b; then sub c by NULL; on c b: delete_glyph removes only the glyph info of
            // c, the glyph a_b stays ligated
            const tokens = tokenize('cb');
            const glyphSequence = getGlyphSequence(tokens, gdef);
            applySubstitution(action(21, [glyphC, glyphA]), glyphSequence, 0);
            applySubstitution(action(41, { ligGlyph: glyphIndexes.a_b, componentOffsets: [1] }), glyphSequence, 1);
            applySubstitution(action(21, []), glyphSequence, 0);
            assert.deepStrictEqual(glyphSequence.glyphIndexes, [glyphIndexes.a_b]);
            assert.deepStrictEqual(describeLigatedGlyphs(tokens), [true]);
        });
    });

    describe('applyLookupToTokens', function() {
        it('applies a lookup at the glyphs its first glyph filter may have only, the glyphs the digest of its coverage has', function() {
            // sub a by a.alt; sub b by b.alt; at every glyph of 'ab' with the digest of its coverage or without a filter, at
            // none with a digest of no glyph
            const lookup = createSingleLookup([glyphA, glyphB], [glyphIndexes['a.alt'], glyphIndexes['b.alt']]);
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('latn', 'liga', [0], [lookup]) }));
            const applyWithFilter = firstGlyphFilter => {
                const tokens = tokenize('ab');
                applyLookupToTokens(query, lookup, 'liga', tokens, () => 1, AUTO_JOINER_FLAGS, firstGlyphFilter);
                return getGlyphSequence(tokens).glyphIndexes;
            };
            const noGlyphFilter = { glyphDigest: getCoveragesGlyphDigest([]), subtables: lookup.subtables.slice() };
            assert.deepStrictEqual(applyWithFilter(getCoverageFilter(lookup)), [glyphIndexes['a.alt'], glyphIndexes['b.alt']]);
            assert.deepStrictEqual(applyWithFilter(noGlyphFilter), [glyphA, glyphB]);
            assert.deepStrictEqual(applyWithFilter(null), [glyphIndexes['a.alt'], glyphIndexes['b.alt']]);
        });

        it('applies a lookup at every glyph when it has more subtables than its first glyph filter was read from', function() {
            // a subtable added to the lookup after its filter (sub a by a.alt; sub b by b.alt;) may start at glyphs the
            // digest has not
            const lookup = createSingleLookup([glyphA, glyphB], [glyphIndexes['a.alt'], glyphIndexes['b.alt']]);
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('latn', 'liga', [0], [lookup]) }));
            const tokens = tokenize('ab');
            const filterOfNoSubtable = { glyphDigest: getCoveragesGlyphDigest([]), subtables: [] };
            applyLookupToTokens(query, lookup, 'liga', tokens, () => 1, AUTO_JOINER_FLAGS, filterOfNoSubtable);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphIndexes['a.alt'], glyphIndexes['b.alt']]);
        });

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
            applyLookupToTokens(query, initLookup, 'init', tokens, token => (token === tokens[0] ? 1 : null));
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [lamInitial, lam]);
        });

        it('substitutes at each glyph the alternate of the value of its token, like the feature mask of HarfBuzz', function() {
            // AlternateSet::apply of HarfBuzz 11.3.2: the alternate of the index of the value of the mask of the glyph, 1 for
            // the first one, none for 0 or past the alternates (aalt sub a from [a.alt b c];)
            const alternates = [aAlternate, glyphB, glyphC];
            const alternateLookup = {
                lookupType: 3,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, coverage: createCoverage([glyphA]), alternateSets: [alternates] }]
            };
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('latn', 'aalt', [0], [alternateLookup]) }));
            const tokens = tokenize('aaaaa');
            const tokenValues = new Map(tokens.map((token, index) => [token, [1, 3, 0, 4, null][index]]));
            applyLookupToTokens(query, alternateLookup, 'aalt', tokens, token => tokenValues.get(token));
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [aAlternate, glyphC, glyphA, glyphA, glyphA]);
        });

        it('substitutes in a nested alternate substitution the alternate of the value of the token of its glyph, like HarfBuzz', function() {
            // AlternateSet::apply of HarfBuzz 11.3.2 in a nested lookup: the lookup mask of the contextual lookup and the mask
            // of the glyph the nested lookup applies at (cur()), which has no value of the feature where the lookup cannot
            // start; sub b' a' lookup 1;, lookup 1 sub a from [a.alt b c];
            const alternateLookup = {
                lookupType: 3,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, coverage: createCoverage([glyphA]), alternateSets: [[aAlternate, glyphB, glyphC]] }]
            };
            const ruleLookup = {
                lookupType: 6,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 3,
                    backtrackCoverage: [],
                    inputCoverage: createCoverages([glyphB, glyphA]),
                    lookaheadCoverage: [],
                    lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 1 }]
                }]
            };
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [0], [ruleLookup, alternateLookup]) }));
            const substituteWithValues = tokenValues => {
                const tokens = tokenize('ba');
                applyLookupToTokens(query, ruleLookup, 'calt', tokens, token => tokenValues[tokens.indexOf(token)]);
                return getGlyphSequence(tokens).glyphIndexes;
            };
            assert.deepStrictEqual(substituteWithValues([1, 3]), [glyphB, glyphC]);
            assert.deepStrictEqual(substituteWithValues([3, 1]), [glyphB, aAlternate]);
            assert.deepStrictEqual(substituteWithValues([2, null]), [glyphB, glyphA]);
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
            applyLookupToTokens(finaQuery, lookaheadLookup, 'fina', lookaheadTokens, token => (token === lookaheadTokens[1] ? 1 : null));
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
            applyLookupToTokens(formsQuery, dalLookup, 'fina', backtrackTokens, token => (token.char === '\u{62F}' ? 1 : null));
            applyLookupToTokens(formsQuery, backtrackLookup, 'init', backtrackTokens, token => (token.char === '\u{644}' ? 1 : null));
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
            applyLookupToTokens(query, finaLookup, 'fina', tokens, token => (token === tokens[1] ? 1 : null));
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [lam, dalAlternate, glyphIndexes['acute.alt']]);
        });
    });

    // the max_len of a buffer of HarfBuzz: 64 glyphs per character, at least 16384. The reference font, built with
    // fontBuilder and feaLib: the glyphs .notdef a b, lookup DOUBLE0 { sub a by a a; } DOUBLE0; to DOUBLE15, lookup
    // SINGLE_B { sub a by b; } SINGLE_B;, all of them in liga
    describe('the maximum number of glyphs of a script run', function() {
        // the reference font takes about half a second, a glyph sequence of 16384 glyphs in one token
        this.timeout(20000);

        const createDoublingLookups = count => Array.from({ length: count }, () => createMultipleLookup([glyphA], [[glyphA, glyphA]]));
        const getLookupIndexes = (start, end) => Array.from({ length: end - start }, (unused, index) => start + index);

        function createDoublingFont() {
            const lookups = createDoublingLookups(16).concat([createSingleLookup([glyphA], [glyphB])]);
            return createLookupFlagsFont({ gsub: createLayoutTable('latn', 'liga', getLookupIndexes(0, lookups.length), lookups) });
        }

        it('leaves the glyphs as they were before a lookup that grows them past 16384, and applies no lookup after it, like HarfBuzz', function() {
            // hb-shape --shapers=ot --no-glyph-names --cluster-level=1 doubling.ttf -u 0061: 16384 glyphs 1=0+500, the 15th
            // doubling would give 32768
            const glyphs = createDoublingFont().stringToGlyphIndexes('a');
            assert.strictEqual(glyphs.length, 16384);
            assert.ok(glyphs.every(glyph => glyph === glyphA));
        });

        it('leaves every token as it was before the lookup that grows the glyphs past the maximum, like HarfBuzz', function() {
            // -u 0061,0061,0061: 12288 glyphs 1, 4096 in each cluster (the 13th doubling would give 24576);
            // -u 0061,0061,0061,0061,0061: 10240 glyphs 1, 2048 in each cluster
            const font = createDoublingFont();
            for (const [text, glyphsPerCharacter] of [['aaa', 4096], ['aaaaa', 2048]]) {
                const clusters = font.stringToGlyphClusters(text);
                assert.strictEqual(clusters.length, text.length * glyphsPerCharacter, text);
                assert.ok(clusters.every(cluster => cluster.glyph.index === glyphA), text);
                for (let i = 0; i < text.length; i++) {
                    assert.strictEqual(clusters.filter(cluster => cluster.start === i).length, glyphsPerCharacter, text);
                }
            }
        });

        it('lets the glyphs grow to 64 times the characters of the run, like HarfBuzz', function() {
            // --text of 300 a: 19200 glyphs 1, 64 in each cluster (the 7th doubling would give 38400)
            const text = 'a'.repeat(300);
            const clusters = createDoublingFont().stringToGlyphClusters(text);
            assert.strictEqual(clusters.length, 19200);
            assert.ok(clusters.every(cluster => cluster.glyph.index === glyphA));
            for (let i = 0; i < text.length; i++) {
                assert.strictEqual(clusters.filter(cluster => cluster.start === i).length, 64);
            }
        });

        it('gives each script run a maximum of its own, like the buffer of each run of a browser', function() {
            // the reference font: lookup SINGLE_B { sub b by b.alt; } SINGLE_B; after DOUBLE15 in the liga of latn, lookup
            // KOKAI { sub kokai by khokhai; } KOKAI; in the liga of thai; each run shaped with its script:
            // hb-shape --shapers=ot --cluster-level=1 runs.ttf --script=latn -u 0061: 16384 glyphs a=0+500;
            // --script=thai -u 0E01: [khokhai=0+500]; --script=latn -u 0062: [b.alt=0+500]
            const lookups = createDoublingLookups(16).concat([
                createSingleLookup([glyphB], [glyphIndexes['b.alt']]),
                createSingleLookup([glyphIndexes.kokai], [glyphIndexes.khokhai])
            ]);
            const gsub = createScriptsLayoutTable({ latn: [['liga', getLookupIndexes(0, 17)]], thai: [['liga', [17]]] }, lookups);
            const glyphs = createLookupFlagsFont({ gsub }).stringToGlyphIndexes('a\u{E01}b');
            assert.strictEqual(glyphs.length, 16386);
            assert.ok(glyphs.slice(0, 16384).every(glyph => glyph === glyphA));
            assert.deepStrictEqual(glyphs.slice(16384), [glyphIndexes.khokhai, glyphIndexes['b.alt']]);
        });

        it('gives the tokens back the clusters and the ligature properties they had before the lookup', function() {
            // a contextual rule applies a ligature across a mark, then a multiple substitution past the maximum: lookup
            // DOUBLE0 { sub a by a a; } DOUBLE0; to DOUBLE12, then lookup CONTEXT { lookupflag IgnoreMarks; sub b' lookup
            // LIGATURE c'; sub a' lookup QUADRUPLE; } CONTEXT;, with lookup LIGATURE { lookupflag IgnoreMarks; sub b c by
            // ff; } LIGATURE; and lookup QUADRUPLE { sub a by a a a a; } QUADRUPLE;. The glyphs, the clusters and the
            // ligature properties of the text as they were before CONTEXT are the contract of the fork, not the output of
            // HarfBuzz, which keeps the ligature it made in place: hb-shape --shapers=ot --cluster-level=1 restore.ttf
            // -u 0062,0301,0063,0061 gives ff=0, acute=0 and 8193 a=3
            const lookups = createDoublingLookups(13).concat([
                createLigatureLookup(glyphB, [glyphC], ff, IGNORE_MARKS),
                createMultipleLookup([glyphA], [[glyphA, glyphA, glyphA, glyphA]])
            ]);
            const contextLookup = {
                lookupType: 6,
                lookupFlag: IGNORE_MARKS,
                subtables: [
                    { substFormat: 3, backtrackCoverage: [], inputCoverage: createCoverages([glyphB, glyphC]), lookaheadCoverage: [], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 13 }] },
                    { substFormat: 3, backtrackCoverage: [], inputCoverage: createCoverages([glyphA]), lookaheadCoverage: [], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 14 }] }
                ]
            };
            lookups.push(contextLookup);
            const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'liga', getLookupIndexes(0, 13).concat([15]), lookups) });
            // the tokens of the text, one script run, after the lookups
            const applyLookups = appliedLookups => {
                const query = new FeatureQuery(font);
                const tokens = tokenize('b\u{301}ca');
                query.startScriptRun(['ltra', 'ltrm'], tokens.length);
                for (const lookupTable of appliedLookups) {
                    applyLookupToTokens(query, lookupTable, 'liga', tokens);
                }
                return { query, tokens };
            };
            const { query, tokens } = applyLookups(lookups.slice(0, 13).concat([contextLookup]));
            const { tokens: tokensBeforeContext } = applyLookups(lookups.slice(0, 13));
            assert.ok(query.isMaxGlyphCountExceeded);
            assert.deepStrictEqual(describeTokens(tokens.slice(0, 3)), [[[glyphB], 0], [[acute], 1], [[glyphC], 2]]);
            assert.strictEqual(getTokenGlyphIndexes(tokens[3]).length, 8192);
            assert.deepStrictEqual(describeTokens(tokens), describeTokens(tokensBeforeContext));
            assert.deepStrictEqual(tokens.map(getTokenLigatureProperties), tokensBeforeContext.map(getTokenLigatureProperties));
            assert.deepStrictEqual(tokens.slice(0, 3).map(getTokenLigatureProperties), [[], [], []]);
            assert.deepStrictEqual(tokens.slice(0, 3).map(getTokenLigatedGlyphs), [[], [], []]);
        });

        it('gives a default ignorable that the lookup substituted back its kind of default ignorable', function() {
            // the glyph c mapped to U+00AD: DOUBLE0 to DOUBLE12 as above, then lookup LAST { sub a by a a a a; sub c by b; }
            // LAST;, which substitutes the soft hyphen before it grows the glyphs past the maximum. The soft hyphen as it
            // was before LAST, a default ignorable that the font without a space glyph removes, is the contract of the fork,
            // not the output of HarfBuzz, which keeps the glyph it replaced in place: hb-shape --shapers=ot
            // --no-glyph-names --cluster-level=1 overflow.ttf -u 00AD,0061 gives 2=0 and 8192 1=1
            const { IGNORABLE } = DEFAULT_IGNORABLE_TYPES;
            const lookups = createDoublingLookups(13).concat([createMultipleLookup([glyphA, glyphC], [[glyphA, glyphA, glyphA, glyphA], [glyphB]])]);
            const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'liga', getLookupIndexes(0, lookups.length), lookups) });
            const query = new FeatureQuery(font);
            const tokens = tokenize('ca');
            tokens[0].defaultIgnorableType = IGNORABLE;
            query.startScriptRun(['ltra', 'ltrm'], tokens.length);
            for (const lookupTable of lookups) {
                applyLookupToTokens(query, lookupTable, 'liga', tokens);
            }
            assert.ok(query.isMaxGlyphCountExceeded);
            assert.deepStrictEqual(describeTokens(tokens.slice(0, 1)), [[[glyphC], 0]]);
            assert.strictEqual(getTokenDefaultIgnorableType(tokens[0]), IGNORABLE);
            font.glyphs.get(glyphC).addUnicode(0xAD);
            const glyphs = font.stringToGlyphIndexes('\u{AD}a');
            assert.strictEqual(glyphs.length, 8192);
            assert.ok(glyphs.every(glyph => glyph === glyphA));
        });

        it('gives a token back the ligature properties it had before a ligature of one component of the lookup', function() {
            // a contextual rule applies a ligature of ff alone (a GDEF ligature glyph, given a ligature id, with no cluster
            // to merge), then a multiple substitution past the maximum: DOUBLE0 to DOUBLE12 as above, then lookup CONTEXT {
            // sub ff' lookup LIGATURE; sub a' lookup QUADRUPLE; } CONTEXT;, with lookup LIGATURE { sub ff by a_b; }
            // LIGATURE;. The ligature properties as they were before CONTEXT are the contract of the fork, not HarfBuzz
            const lookups = createDoublingLookups(13).concat([
                createLigatureLookup(ff, [], glyphIndexes.a_b),
                createMultipleLookup([glyphA], [[glyphA, glyphA, glyphA, glyphA]])
            ]);
            const contextLookup = {
                lookupType: 6,
                lookupFlag: 0,
                subtables: [
                    { substFormat: 3, backtrackCoverage: [], inputCoverage: createCoverages([ff]), lookaheadCoverage: [], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 13 }] },
                    { substFormat: 3, backtrackCoverage: [], inputCoverage: createCoverages([glyphA]), lookaheadCoverage: [], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 14 }] }
                ]
            };
            lookups.push(contextLookup);
            const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'liga', getLookupIndexes(0, 13).concat([15]), lookups) });
            const query = new FeatureQuery(font);
            const tokens = tokenize('\u{FB00}a');
            query.startScriptRun(['ltra', 'ltrm'], tokens.length);
            for (const lookupTable of lookups.slice(0, 13).concat([contextLookup])) {
                applyLookupToTokens(query, lookupTable, 'liga', tokens);
            }
            assert.ok(query.isMaxGlyphCountExceeded);
            assert.deepStrictEqual(getTokenGlyphIndexes(tokens[0]), [ff]);
            assert.deepStrictEqual(getTokenLigatureProperties(tokens[0]), []);
        });

        it('gives a token back the ligated glyphs it had before a multiple substitution of the lookup', function() {
            // lookup LIGATURE { sub b c by ff; } LIGATURE; then DOUBLE0 to DOUBLE12 as above, then lookup CONTEXT { sub ff'
            // lookup MULTIPLE; sub a' lookup QUADRUPLE; } CONTEXT;, with lookup MULTIPLE { sub ff by ff dotbelow; }
            // MULTIPLE;. The ligated glyphs as they were before CONTEXT are the contract of the fork, not HarfBuzz
            const lookups = createDoublingLookups(13).concat([
                createLigatureLookup(glyphB, [glyphC], ff),
                createMultipleLookup([ff], [[ff, glyphIndexes.dotbelow]]),
                createMultipleLookup([glyphA], [[glyphA, glyphA, glyphA, glyphA]])
            ]);
            const contextLookup = {
                lookupType: 6,
                lookupFlag: 0,
                subtables: [
                    { substFormat: 3, backtrackCoverage: [], inputCoverage: createCoverages([ff]), lookaheadCoverage: [], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 14 }] },
                    { substFormat: 3, backtrackCoverage: [], inputCoverage: createCoverages([glyphA]), lookaheadCoverage: [], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 15 }] }
                ]
            };
            lookups.push(contextLookup);
            const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'liga', [13].concat(getLookupIndexes(0, 13), [16]), lookups) });
            // the tokens of the text, one script run, after the lookups
            const applyLookups = appliedLookups => {
                const query = new FeatureQuery(font);
                const tokens = tokenize('bca');
                query.startScriptRun(['ltra', 'ltrm'], tokens.length);
                for (const lookupTable of appliedLookups) {
                    applyLookupToTokens(query, lookupTable, 'liga', tokens);
                }
                return { query, tokens };
            };
            const lookupsBeforeContext = [lookups[13]].concat(lookups.slice(0, 13));
            const { query, tokens } = applyLookups(lookupsBeforeContext.concat([contextLookup]));
            const { tokens: tokensBeforeContext } = applyLookups(lookupsBeforeContext);
            assert.ok(query.isMaxGlyphCountExceeded);
            assert.deepStrictEqual(getTokenGlyphIndexes(tokens[0]), [ff]);
            assert.deepStrictEqual(tokens.map(getTokenLigatedGlyphs), tokensBeforeContext.map(getTokenLigatedGlyphs));
            assert.deepStrictEqual(getTokenLigatedGlyphs(tokens[0]), [true]);
        });
    });

    describe('applyFeatureLookupsToTokens', function() {
        // the lookups in arab rlig, applied like the arabic required ligatures; the feature has the lookups of the last indexes
        // given, the other lookups are the nested ones
        function applyLookups(lookups, text, featureLookupIndexes = lookups.map((lookup, index) => index)) {
            const query = new FeatureQuery(createLookupFlagsFont({ gsub: createLayoutTable('arab', 'rlig', featureLookupIndexes, lookups) }));
            const tokens = tokenize(text);
            applyFeatureLookupsToTokens(query, getFeaturesLookups(query, ['rlig'], 'arab'), tokens);
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
            applyFeatureLookupsToTokens(query, getFeaturesLookups(query, ['ccmp', 'rlig'], 'arab'), tokens);
            assert.deepStrictEqual(tokens[0].state, { glyphIndex: dal, rlig: glyphIndexes['dal.alt'], ccmp: glyphIndexes['reh.alt'] });
        });
    });

    describe('getDefaultShaperFeatureStages', function() {
        // rvrn sub a by b; (lookup 1) and liga sub a by a.alt; (lookup 0), the lookups of the rvrn and the liga of
        // TestScriptLanguage.ttf (test/generate-script-language-font.py) with x, x.rvrn and x.liga:
        // hb-shape --no-glyph-names --cluster-level=1 TestScriptLanguage.ttf -u 0078: [22=0+500], x.rvrn
        const lookups = [createSingleLookup([glyphA], [glyphIndexes['a.alt']]), createSingleLookup([glyphA], [glyphB])];
        const gsub = createScriptsLayoutTable({ latn: [['liga', [0]], ['rvrn', [1]]] }, lookups);

        it('applies the lookups of rvrn before the lookups of the other features, like HarfBuzz', function() {
            const tokens = tokenize('a');
            applyDefaultShaperFeatureStages(new FeatureQuery(createLookupFlagsFont({ gsub })), ['liga', 'rvrn'], 'latn', tokens);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphB]);
        });

        it('applies the lookups of the other features without rvrn', function() {
            // --features=-rvrn -u 0078: [21=0+500], x.liga
            const tokens = tokenize('a');
            applyDefaultShaperFeatureStages(new FeatureQuery(createLookupFlagsFont({ gsub })), ['liga'], 'latn', tokens);
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
                {
                    lookupTable: lookups[0], tag: 'liga', isEnabledFeatureLookup: true, isRequiredFeatureLookup: false, joinerFlags: AUTO_JOINER_FLAGS,
                    firstGlyphFilter: getCoverageFilter(lookups[0])
                },
                {
                    lookupTable: lookups[1], tag: 'ss05', isEnabledFeatureLookup: false, isRequiredFeatureLookup: true, joinerFlags: AUTO_JOINER_FLAGS,
                    firstGlyphFilter: getCoverageFilter(lookups[1])
                }
            ]);
            assert.deepStrictEqual(getFeaturesLookups(query, ['liga'], 'latn'), [
                {
                    lookupTable: lookups[0], tag: 'liga', isEnabledFeatureLookup: true, isRequiredFeatureLookup: false, joinerFlags: AUTO_JOINER_FLAGS,
                    firstGlyphFilter: getCoverageFilter(lookups[0])
                }
            ]);
        });

        it('gives a lookup of both a feature and the required feature once, as a lookup of the required feature', function() {
            // HarfBuzz (hb_ot_map_builder_t::compile) merges a lookup that two features of a stage have, with the OR of their
            // masks: the global mask of the required feature
            const gsub = createScriptsLayoutTable({ latn: [['liga', [0, 1]]] }, lookups);
            gsub.features.push({ tag: 'ss05', feature: { featureParams: 0, lookupListIndexes: [1] } });
            gsub.scripts[0].script.defaultLangSys.reqFeatureIndex = 1;
            const query = new FeatureQuery(createLookupFlagsFont({ gsub }));
            assert.deepStrictEqual(getFeaturesLookups(query, ['liga'], 'latn', undefined, true), [
                {
                    lookupTable: lookups[0], tag: 'liga', isEnabledFeatureLookup: true, isRequiredFeatureLookup: false, joinerFlags: AUTO_JOINER_FLAGS,
                    firstGlyphFilter: getCoverageFilter(lookups[0])
                },
                {
                    lookupTable: lookups[1], tag: 'liga', isEnabledFeatureLookup: true, isRequiredFeatureLookup: true, joinerFlags: AUTO_JOINER_FLAGS,
                    firstGlyphFilter: getCoverageFilter(lookups[1])
                }
            ]);
        });

        it('skips the joiners in the lookups of the required feature whatever its tag, not in the ones of an enabled feature, like HarfBuzz', function() {
            // TestDefaultIgnorables.ttf with its liga tagged rlig and made the ReqFeatureIndex of each language system
            // (fontTools): hb-shape --shapers=ot --no-glyph-names --cluster-level=1 -u 062F,200D,0627, out of the FeatureIndex
            // [1=0+0|14=0+650], the dal_alef ligature across the zero width joiner (hb_ot_map_builder_t::compile adds the
            // lookups of the required feature with auto_zwnj and auto_zwj); also in the FeatureIndex [10=2+300|1=1+0|11=0+400],
            // no ligature: the rlig of the Arabic shaper does not skip it (F_MANUAL_ZWJ)
            const gsub = createScriptsLayoutTable({ arab: [['rlig', [1]]] }, lookups);
            gsub.features.push({ tag: 'rlig', feature: { featureParams: 0, lookupListIndexes: [1] } });
            gsub.scripts[0].script.defaultLangSys.reqFeatureIndex = 1;
            const query = new FeatureQuery(createLookupFlagsFont({ gsub }));
            query.startScriptRun(['rtla', 'rtlm'], 3, 'arab');
            assert.deepStrictEqual(getFeaturesLookups(query, [], 'arab', undefined, true), [
                {
                    lookupTable: lookups[1], tag: 'rlig', isEnabledFeatureLookup: false, isRequiredFeatureLookup: true, joinerFlags: AUTO_JOINER_FLAGS,
                    firstGlyphFilter: getCoverageFilter(lookups[1])
                }
            ]);
            assert.deepStrictEqual(getFeaturesLookups(query, ['rlig'], 'arab', undefined, true), [{
                lookupTable: lookups[1],
                tag: 'rlig',
                isEnabledFeatureLookup: true,
                isRequiredFeatureLookup: true,
                joinerFlags: { autoZeroWidthNonJoiner: true, autoZeroWidthJoiner: false },
                firstGlyphFilter: getCoverageFilter(lookups[1])
            }]);
        });

        it('applies the lookups of the required feature with rvrn when its tag is not enabled, like HarfBuzz', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr TestScriptLanguage.ttf -u 006F: [71=0+500], o.req
            const tokens = tokenize('a');
            applyDefaultShaperFeatureStages(createRequiredFeatureQuery(), ['liga', 'rvrn'], 'latn', tokens);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphB]);
        });

        it('applies the lookups of the required feature with the other features when its tag is enabled, like HarfBuzz', function() {
            // --language=tr --features=+ss05 -u 006F: [70=0+500], o.liga
            const tokens = tokenize('a');
            applyDefaultShaperFeatureStages(createRequiredFeatureQuery(), ['liga', 'ss05'], 'latn', tokens);
            assert.deepStrictEqual(getGlyphSequence(tokens).glyphIndexes, [glyphIndexes['a.alt']]);
        });
    });

    describe('getFeaturesLookups', function() {
        it('gives the lookups of features in lookup list order, each one once with the tag of the first feature that lists it', function() {
            const lookups = [subAcuteBLookup, multipleCLookup, createSingleLookup([glyphA], [glyphIndexes['a.alt']])];
            const gsub = createScriptsLayoutTable({ latn: [['ccmp', [2, 1]], ['liga', [1, 0, 1, 9]]] }, lookups);
            const query = new FeatureQuery(createLookupFlagsFont({ gsub }));
            assert.deepStrictEqual(getFeaturesLookups(query, ['ccmp', 'liga', 'calt'], 'latn'), [
                {
                    lookupTable: lookups[0], tag: 'liga', isEnabledFeatureLookup: true, isRequiredFeatureLookup: false, joinerFlags: AUTO_JOINER_FLAGS,
                    firstGlyphFilter: getCoverageFilter(lookups[0])
                },
                {
                    lookupTable: lookups[1], tag: 'ccmp', isEnabledFeatureLookup: true, isRequiredFeatureLookup: false, joinerFlags: AUTO_JOINER_FLAGS,
                    firstGlyphFilter: getCoverageFilter(lookups[1])
                },
                {
                    lookupTable: lookups[2], tag: 'ccmp', isEnabledFeatureLookup: true, isRequiredFeatureLookup: false, joinerFlags: AUTO_JOINER_FLAGS,
                    firstGlyphFilter: getCoverageFilter(lookups[2])
                }
            ]);
        });

        it('computes the lookups of a set of features once for the GSUB table, again after a lookup is added', function() {
            // TestAlternateSubstitution.ttf: aalt has 2 lookups, swsh none until addAlternate creates it with its lookup
            const cachedFont = parse(readFileSync('./test/fonts/TestAlternateSubstitution.ttf'));
            const getLookups = () => getFeaturesLookups(new FeatureQuery(cachedFont), ['aalt', 'swsh'], 'latn');
            const lookups = getLookups();
            assert.strictEqual(lookups.length, 2);
            assert.strictEqual(getLookups(), lookups);
            cachedFont.substitution.addAlternate('swsh', { sub: 2, by: [3, 4] }, 'latn');
            const addedLookups = getLookups();
            assert.notStrictEqual(addedLookups, lookups);
            assert.strictEqual(addedLookups.length, 3);
            assert.strictEqual(getLookups(), addedLookups);
        });

        it('computes the lookups of a set of features at every call with layoutCache false, after a direct change too', function() {
            // TestAlternateSubstitution.ttf with aalt reduced to its lookup 1 (sub a from [...]), without its lookup 0
            // (sub g by g.alt), with fontTools as aalt-edited.ttf: hb-shape --no-glyph-names --cluster-level=1
            // --features=aalt -u 0067 [24=0+500], edited [23=0+500]
            const uncachedFont = parse(readFileSync('./test/fonts/TestAlternateSubstitution.ttf'), { layoutCache: false });
            const gsub = uncachedFont.tables.gsub;
            const getLookups = () => getFeaturesLookups(new FeatureQuery(uncachedFont), ['aalt'], 'latn');
            const getLookupTables = () => getLookups().map(({ lookupTable }) => lookupTable);
            assert.notStrictEqual(getLookups(), getLookups());
            assert.deepStrictEqual(getLookupTables(), [gsub.lookups[0], gsub.lookups[1]]);
            assert.deepStrictEqual(uncachedFont.stringToGlyphIndexes('g', { features: { aalt: true } }), [24]);
            gsub.features.find(featureRecord => featureRecord.tag === 'aalt').feature.lookupListIndexes = [1];
            assert.deepStrictEqual(getLookupTables(), [gsub.lookups[1]]);
            assert.deepStrictEqual(uncachedFont.stringToGlyphIndexes('g', { features: { aalt: true } }), [23]);
        });

        it('gives no first glyph filter to the lookups with layoutCache false, which computes them for one call', function() {
            const uncachedFont = parse(readFileSync('./test/fonts/TestAlternateSubstitution.ttf'), { layoutCache: false });
            const lookups = getFeaturesLookups(new FeatureQuery(uncachedFont), ['aalt'], 'latn');
            assert.deepStrictEqual(lookups.map(lookup => lookup.firstGlyphFilter), [null, null]);
        });

        it('gives an extension lookup the first glyph filter of the subtables its extension subtables wrap', function() {
            // the cv01 of TestAlternateSubstitution.ttf is its lookup 4, of type 7, whose extension subtable wraps an
            // alternate substitution of the coverage [c] (fontTools ttx: <AlternateSet glyph="c">, c is the glyph 9)
            const font = parse(readFileSync('./test/fonts/TestAlternateSubstitution.ttf'));
            const [{ lookupTable, firstGlyphFilter }] = getFeaturesLookups(new FeatureQuery(font), ['cv01'], 'latn');
            assert.strictEqual(lookupTable, font.tables.gsub.lookups[4]);
            assert.strictEqual(lookupTable.lookupType, 7);
            const extensionSubtables = lookupTable.subtables.map(subtable => subtable.extension);
            assert.deepStrictEqual(extensionSubtables.map(subtable => subtable.coverage), [{ format: 1, glyphs: [9] }]);
            assert.deepStrictEqual(firstGlyphFilter, {
                glyphDigest: getCoveragesGlyphDigest(extensionSubtables.map(subtable => subtable.coverage)),
                subtables: extensionSubtables
            });
            assert.strictEqual(mayGlyphDigestHave(firstGlyphFilter.glyphDigest, font.nameToGlyphIndex('c')), true);
            assert.strictEqual(mayGlyphDigestHave(firstGlyphFilter.glyphDigest, font.nameToGlyphIndex('a')), false);
        });

        it('applies a subtable added directly to a lookup of a feature after a text was laid out', function() {
            // the glyphs each lookup can start at are cached with the lookups, read from the subtables the lookup has then:
            // TestScriptLanguage.ttf (test/generate-script-language-font.py) with sub V A by a_b added to the first
            // ligature lookup of the liga of latn (fontTools), saved as pushed-gsub.ttf: hb-shape --no-glyph-names
            // --cluster-level=1 -u 0056,0041 TestScriptLanguage.ttf [5=0+500|4=1+500], pushed-gsub.ttf [19=0+500]
            const editedFont = parse(readFileSync('./test/fonts/TestScriptLanguage.ttf'));
            const [glyphCapitalA, glyphCapitalV, ligatureGlyph] = ['A', 'V', 'a_b'].map(name => editedFont.nameToGlyphIndex(name));
            assert.deepStrictEqual(editedFont.stringToGlyphIndexes('VA'), [glyphCapitalV, glyphCapitalA]);
            editedFont.substitution.getLookupTables('latn', undefined, 'liga', 4)[0].subtables.push({
                substFormat: 1,
                coverage: { format: 1, glyphs: [glyphCapitalV] },
                ligatureSets: [[{ ligGlyph: ligatureGlyph, components: [glyphCapitalA] }]]
            });
            assert.deepStrictEqual(editedFont.stringToGlyphIndexes('VA'), [ligatureGlyph]);
        });

        it('applies a subtable replaced directly in a lookup of a feature after a text was laid out', function() {
            // TestScriptLanguage.ttf with the one subtable of the first ligature lookup of the liga of latn (sub a b by a_b...)
            // replaced by sub V A by a_b (fontTools), saved as replaced-gsub.ttf: hb-shape --no-glyph-names
            // --cluster-level=1 replaced-gsub.ttf -u 0056,0041 [19=0+500], -u 0061,0062 [6=0+500|7=1+500]
            const editedFont = parse(readFileSync('./test/fonts/TestScriptLanguage.ttf'));
            const [glyphCapitalA, glyphCapitalV, ligatureGlyph] = ['A', 'V', 'a_b'].map(name => editedFont.nameToGlyphIndex(name));
            assert.deepStrictEqual(editedFont.stringToGlyphIndexes('VA'), [glyphCapitalV, glyphCapitalA]);
            const lookupTable = editedFont.substitution.getLookupTables('latn', undefined, 'liga', 4)[0];
            assert.strictEqual(lookupTable.subtables.length, 1);
            lookupTable.subtables[0] = {
                substFormat: 1,
                coverage: { format: 1, glyphs: [glyphCapitalV] },
                ligatureSets: [[{ ligGlyph: ligatureGlyph, components: [glyphCapitalA] }]]
            };
            assert.deepStrictEqual(editedFont.stringToGlyphIndexes('VA'), [ligatureGlyph]);
            assert.deepStrictEqual(editedFont.stringToGlyphIndexes('ab'), ['a', 'b'].map(name => editedFont.nameToGlyphIndex(name)));
        });

        it('applies a subtable replaced directly in an extension subtable of a lookup after a text was laid out', function() {
            // TestAlternateSubstitution.ttf with the alternate substitution of c that the extension subtable of its lookup 4
            // (cv01, type 7) wraps replaced by sub b from [b.alt1 b.alt2] (fontTools), saved as replaced-extension-gsub.ttf:
            // hb-shape --no-glyph-names --cluster-level=1 --features=cv01 TestAlternateSubstitution.ttf -u 0062 [6=0+500],
            // -u 0063 [10=0+500]; replaced-extension-gsub.ttf -u 0062 [7=0+500], -u 0063 [9=0+500]
            const editedFont = parse(readFileSync('./test/fonts/TestAlternateSubstitution.ttf'));
            const getGlyphIndexes = text => editedFont.stringToGlyphIndexes(text, { features: { cv01: true } });
            assert.deepStrictEqual([getGlyphIndexes('b'), getGlyphIndexes('c')], [[6], [10]]);
            const glyphB = editedFont.nameToGlyphIndex('b');
            editedFont.tables.gsub.lookups[4].subtables[0].extension = {
                substFormat: 1,
                coverage: { format: 1, glyphs: [glyphB] },
                alternateSets: [['b.alt1', 'b.alt2'].map(name => editedFont.nameToGlyphIndex(name))]
            };
            assert.deepStrictEqual([getGlyphIndexes('b'), getGlyphIndexes('c')], [[7], [9]]);
        });
    });

    describe('getLookupFeatureValue', function() {
        // the lookup mask of HarfBuzz (hb_ot_map_builder_t::compile): the value of the feature of the lookup, the global
        // mask (the value 1) for a lookup of the required feature only
        const query = new FeatureQuery(createLookupFlagsFont(), undefined, { salt: 2, liga: false });
        const createFeatureLookup = (tag, isEnabledFeatureLookup, isRequiredFeatureLookup) => (
            { lookupTable: subAcuteBLookup, tag, isEnabledFeatureLookup, isRequiredFeatureLookup }
        );

        it('gives the value of the feature of the lookup', function() {
            assert.strictEqual(getLookupFeatureValue(query, createFeatureLookup('salt', true, false)), 2);
            assert.strictEqual(getLookupFeatureValue(query, createFeatureLookup('calt', true, false)), 1);
            assert.strictEqual(getLookupFeatureValue(query, createFeatureLookup('rand', true, false)), 255);
        });

        it('gives the value 1 to a lookup of the required feature only, whatever the features option', function() {
            assert.strictEqual(getLookupFeatureValue(query, createFeatureLookup('salt', false, true)), 1);
            assert.strictEqual(getLookupFeatureValue(query, createFeatureLookup('liga', false, true)), 1);
        });
    });

    describe('an alternate substitution of the required feature', function() {
        // TestAlternateSubstitution.ttf (test/generate-alternate-substitution-font.py) with salt sub b from [b.alt1 b.alt2];
        // as the ReqFeatureIndex of every DefaultLangSys and out of its FeatureIndex (fontTools), saved as required.ttf:
        // hb-shape --no-glyph-names --cluster-level=1 [--features=<features>] required.ttf -u 0062
        let requiredFont;

        // the GSUB table is edited before the font shapes a text: the lookups of its features are cached for the table
        beforeEach(function() {
            requiredFont = parse(readFileSync('./test/fonts/TestAlternateSubstitution.ttf'));
            const gsub = requiredFont.tables.gsub;
            const saltFeatureIndex = gsub.features.findIndex(featureRecord => featureRecord.tag === 'salt');
            for (const scriptRecord of gsub.scripts) {
                const defaultLangSys = scriptRecord.script.defaultLangSys;
                defaultLangSys.reqFeatureIndex = saltFeatureIndex;
                defaultLangSys.featureIndexes = defaultLangSys.featureIndexes.filter(featureIndex => featureIndex !== saltFeatureIndex);
            }
        });

        it('substitutes the first alternate whatever the value of the feature of its tag, like the global mask of HarfBuzz', function() {
            // [7=0+500], b.alt1, the same with --features=-salt, --features=salt=2 and --features=salt=0
            for (const features of [undefined, { salt: false }, { salt: 2 }, { salt: 0 }]) {
                assert.deepStrictEqual(requiredFont.stringToGlyphIndexes('b', { features }), [7], JSON.stringify(features));
            }
        });

        describe('when the feature of its tag has it too', function() {
            // the same font with salt in every FeatureIndex too, saved as required-shared.ttf:
            // hb-shape --no-glyph-names --cluster-level=1 [--features=<features>] required-shared.ttf -u 0062
            beforeEach(function() {
                const gsub = requiredFont.tables.gsub;
                const saltFeatureIndex = gsub.features.findIndex(featureRecord => featureRecord.tag === 'salt');
                for (const scriptRecord of gsub.scripts) {
                    scriptRecord.script.defaultLangSys.featureIndexes.push(saltFeatureIndex);
                }
            });

            it('substitutes the first alternate with the value 1 of the feature, like the global mask of HarfBuzz', function() {
                // [7=0+500], b.alt1, the same with --features=+salt and --features=-salt
                for (const features of [undefined, { salt: true }, { salt: false }]) {
                    assert.deepStrictEqual(requiredFont.stringToGlyphIndexes('b', { features }), [7], JSON.stringify(features));
                }
            });

            itFailsUntilFixed('substitutes no alternate with a value other than 1 of the feature, like the joined masks of HarfBuzz',
                'getLookupFeatureValue (src/features/applySubstitution.mjs): a lookup that the required feature shares with an ' +
                'enabled feature takes the value of the enabled feature, where HarfBuzz joins the global mask of the required ' +
                'feature to the mask of the feature, an alternate index past the alternates',
                function() {
                    // --features=salt=2 [6=0+500], b unchanged (the same with --features=salt=3)
                    assert.deepStrictEqual(requiredFont.stringToGlyphIndexes('b', { features: { salt: 2 } }), [6]);
                });
        });
    });

    describe('an extension lookup with an undefined subtable', function() {
        it('applies none of its subtables, like HarfBuzz', function() {
            // TestAlternateSubstitution-Malformed.ttf (see test/generate-malformed-layout-fonts.py), the extension
            // subtable of C_ALTERNATES with the extensionLookupType 9, skipped:
            // hb-shape --no-glyph-names --cluster-level=1 TestAlternateSubstitution-Malformed.ttf -u 0063 --features=cv01
            // [9=0+500] (TestAlternateSubstitution.ttf: [10=0+500])
            const font = parse(readFileSync('./test/fonts/TestAlternateSubstitution-Malformed.ttf'));
            assert.deepStrictEqual(font.tables.gsub.lookups[4].subtables, [undefined]);
            assert.deepStrictEqual(font.stringToGlyphIndexes('c', { features: { cv01: true } }), [9]);
        });
    });

    it('applies no lookup for a NULL lookup offset of the LookupList, like the Null lookup of HarfBuzz', function() {
        // TestExtensionLookups.ttf (see test/generate-extension-lookups-font.py) with the offset of the GSUB lookup 0
        // (liga, sub a by c, then sub b by d) in the LookupList set to 0, so that a takes the pos a 50 of kern:
        // hb-shape --no-glyph-names --cluster-level=1 <font> -u 0061,0062 [1=0+650|2=1+700], -u 0064,0063 [4=0+700|3=1+800]
        const bytes = new Uint8Array(readFileSync('./test/fonts/TestExtensionLookups.ttf'));
        new DataView(bytes.buffer).setUint16(getLookupOffsetField(bytes, 'GSUB', 0).offsetField, 0);
        const font = parse(bytes.buffer);
        assert.deepStrictEqual(font.warnings, []);
        assert.strictEqual(font.tables.gsub.lookups[0], undefined);
        assert.strictEqual(formatShape(font, [0x61, 0x62]), '[1=0+650|2=1+700]');
        assert.strictEqual(formatShape(font, [0x64, 0x63]), '[4=0+700|3=1+800]');
    });

    describe('an extension lookup whose subtables have different extension lookup types', function() {
        // TestExtensionLookups.ttf (see test/generate-extension-lookups-font.py), the GSUB lookup 0 (liga, sub a by c,
        // then sub b by d) with its subtable 1 patched: HarfBuzz drops an extension lookup whose subtables have not all
        // the same extensionLookupType (Lookup::sanitize), the type of a NULL subtable and of a subtable of another
        // format being 0 (Extension::get_type), so a is not substituted and takes the pos a 50 of kern:
        // hb-shape --no-glyph-names --cluster-level=1 <font> -u 0061,0062 [1=0+650|2=1+700] for each patch below,
        // [3=0+700|4=1+900] for TestExtensionLookups.ttf. For a subtable offset past the end of the table, HarfBuzz
        // rejects the whole GSUB table where the fork gives the subtable the type 0 and skips only the lookup: the only
        // lookup of this GSUB table gives the same output (see position.spec.mjs for a GPOS table that tells them apart)
        const parsePatchedFont = patchSubtable => {
            const bytes = new Uint8Array(readFileSync('./test/fonts/TestExtensionLookups.ttf'));
            const view = new DataView(bytes.buffer);
            const { offsetField, subtableStart } = getLookupSubtableOffsets(bytes, 'GSUB', 0, 1);
            assert.deepStrictEqual([view.getUint16(subtableStart), view.getUint16(subtableStart + 2)], [1, 1]);
            patchSubtable(view, offsetField, subtableStart);
            return parse(bytes.buffer);
        };
        const patches = [
            { name: 'the extensionLookupType 9', patch: (view, offsetField, subtableStart) => view.setUint16(subtableStart + 2, 9), types: '1, 9' },
            { name: 'the extensionLookupType 2', patch: (view, offsetField, subtableStart) => view.setUint16(subtableStart + 2, 2), types: '1, 2' },
            { name: 'a NULL subtable offset', patch: (view, offsetField) => view.setUint16(offsetField, 0), types: '1, 0' },
            { name: 'the format 2', patch: (view, offsetField, subtableStart) => view.setUint16(subtableStart, 2), types: '1, 0' },
            { name: 'a subtable offset past the end of the table', patch: (view, offsetField) => view.setUint16(offsetField, 65000), types: '1, 0' }
        ];

        it('substitutes a and b in TestExtensionLookups.ttf', function() {
            const font = parse(readFileSync('./test/fonts/TestExtensionLookups.ttf'));
            assert.strictEqual(formatShape(font, [0x61, 0x62]), '[3=0+700|4=1+900]');
            assert.deepStrictEqual(font.warnings, []);
        });

        for (const { name, patch, types } of patches) {
            it('applies none of its subtables, like HarfBuzz, with ' + name, function() {
                const font = parsePatchedFont(patch);
                assert.strictEqual(formatShape(font, [0x61, 0x62]), '[1=0+650|2=1+700]');
                assert.deepStrictEqual(font.tables.gsub.lookups[0].subtables, [undefined, undefined]);
                assert.deepStrictEqual(font.warnings.map(({ table, message }) => ({ table, message })), [{
                    table: 'GSUB',
                    message: 'The lookup 0 is skipped: The subtables of an extension lookup must have the same extension lookup type, not ' + types
                }]);
            });
        }
    });
});
