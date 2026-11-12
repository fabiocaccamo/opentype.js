import { ContextParams } from '../tokenizer.mjs';
import { SubstitutionAction } from './featureQuery.mjs';

/**
 * The glyph indexes of a token that is not deleted: its glyph, or the glyphs of the multiple substitutions that replaced it
 * @param {Token} token
 * @returns {number[]}
 */
function getTokenGlyphIndexes(token) {
    const value = token.activeState.value;
    return Array.isArray(value) ? value : [value];
}

/**
 * The glyphs of a list of tokens, like the glyph buffer of HarfBuzz: each glyph of a multiple substitution
 * is a glyph of its own, a deleted token has none. applySubstitution updates the sequence with its tokens.
 * @typedef GlyphSequence
 * @type Object
 * @property {number[]} glyphIndexes glyph indexes, in the order of the tokens
 * @property {Token[]} glyphTokens the token of each glyph
 */

/**
 * Get the glyph sequence of a list of tokens
 * @param {Token[]} tokens
 * @returns {GlyphSequence}
 */
function getGlyphSequence(tokens) {
    const glyphSequence = { glyphIndexes: [], glyphTokens: [] };
    for (const token of tokens) {
        if (token.state.deleted) {
            continue;
        }
        for (const glyphIndex of getTokenGlyphIndexes(token)) {
            glyphSequence.glyphIndexes.push(glyphIndex);
            glyphSequence.glyphTokens.push(token);
        }
    }
    return glyphSequence;
}

/**
 * Replace the glyph at a position of a glyph sequence with a sequence of glyphs, in the glyph sequence and in its token:
 * the token holds one glyph, several glyphs, or none and is deleted
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @param {number[]} glyphIndexes the glyphs that replace the glyph, none deletes it
 * @param {string} tag feature tag set as the state of the token
 */
function replaceGlyph(glyphSequence, position, glyphIndexes, tag) {
    const token = glyphSequence.glyphTokens[position];
    let tokenFirstPosition = position;
    while (tokenFirstPosition > 0 && glyphSequence.glyphTokens[tokenFirstPosition - 1] === token) {
        tokenFirstPosition--;
    }
    const tokenGlyphIndexes = getTokenGlyphIndexes(token).slice();
    tokenGlyphIndexes.splice(position - tokenFirstPosition, 1, ...glyphIndexes);
    if (!tokenGlyphIndexes.length) {
        token.setState('deleted', true);
    } else {
        token.setState(tag, tokenGlyphIndexes.length === 1 ? tokenGlyphIndexes[0] : tokenGlyphIndexes);
    }
    glyphSequence.glyphIndexes.splice(position, 1, ...glyphIndexes);
    glyphSequence.glyphTokens.splice(position, 1, ...glyphIndexes.map(() => token));
}

/**
 * Apply single substitution format 1 and 2
 * @param {SubstitutionAction} action
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs that replaced the glyph at the position
 */
function singleSubstitution(action, glyphSequence, position) {
    replaceGlyph(glyphSequence, position, [action.substitution], action.tag);
    return 1;
}

/**
 * Apply contextual substitutions (context and chaining context, all formats), whose substitutions are
 * indexed by the offset of the input glyphs from the current one, each one the glyph or the glyphs
 * (a multiple substitution, none deletes it) that replace the input glyph
 * @param {SubstitutionAction} action its substitution is a ContextualMatch (see FeatureQuery)
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs from the glyph at the position to the last input glyph, after the
 * substitutions: like HarfBuzz, the lookup goes on after the input of the rule
 */
function contextualSubstitution(action, glyphSequence, position) {
    const { substitutions, lastInputOffset } = action.substitution;
    let inputLength = lastInputOffset + 1;
    // from the last input glyph, so that the offsets of the other ones still point to their glyph
    for (let i = substitutions.length - 1; i >= 0; i--) {
        // a hole in the substitutions keeps the glyph at this offset
        if (substitutions[i] !== undefined) {
            const glyphIndexes = Array.isArray(substitutions[i]) ? substitutions[i] : [substitutions[i]];
            replaceGlyph(glyphSequence, position + i, glyphIndexes, action.tag);
            inputLength += glyphIndexes.length - 1;
        }
    }
    return inputLength;
}

/**
 * Apply multiple substitution format 1: the glyph becomes a sequence of glyphs, each one a glyph of its own
 * for the following lookups, an empty sequence deletes it
 * @param {SubstitutionAction} action
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs that replaced the glyph at the position
 */
function multipleSubstitutionFormat1(action, glyphSequence, position) {
    replaceGlyph(glyphSequence, position, action.substitution, action.tag);
    return action.substitution.length;
}

/**
 * Merge the clusters of the glyphs of a range of a glyph sequence, like HarfBuzz (merge_clusters): every token
 * of the sequence in one of their clusters takes the smallest one, so that the whole clusters are merged
 * @param {GlyphSequence} glyphSequence
 * @param {number} startPosition
 * @param {number} endPosition the position after the last glyph of the range
 */
function mergeClusters(glyphSequence, startPosition, endPosition) {
    const clusters = new Set(glyphSequence.glyphTokens.slice(startPosition, endPosition).map(token => token.cluster));
    const mergedCluster = Math.min(...clusters);
    for (const token of glyphSequence.glyphTokens) {
        if (clusters.has(token.cluster)) {
            token.cluster = mergedCluster;
        }
    }
}

/**
 * Apply ligature substitution format 1: the first component becomes the ligature glyph and the
 * other components are deleted, the glyphs the lookup skipped between them stay after the ligature,
 * in one cluster with it
 * @param {SubstitutionAction} action
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs that replaced the glyph at the position
 */
function ligatureSubstitutionFormat1(action, glyphSequence, position) {
    const componentOffsets = action.substitution.componentOffsets;
    if (componentOffsets.length) {
        mergeClusters(glyphSequence, position, position + componentOffsets[componentOffsets.length - 1] + 1);
    }
    // from the last component, so that the offsets of the other ones still point to their glyph
    for (let i = componentOffsets.length - 1; i >= 0; i--) {
        replaceGlyph(glyphSequence, position + componentOffsets[i], [], action.tag);
    }
    replaceGlyph(glyphSequence, position, [action.substitution.ligGlyph], action.tag);
    return 1;
}

/**
 * Supported substitutions
 */
const SUBSTITUTIONS = {
    11: singleSubstitution,
    12: singleSubstitution,
    21: multipleSubstitutionFormat1,
    41: ligatureSubstitutionFormat1,
    51: contextualSubstitution,
    52: contextualSubstitution,
    53: contextualSubstitution,
    61: contextualSubstitution,
    62: contextualSubstitution,
    63: contextualSubstitution
};

/**
 * Apply a substitution at a glyph of a glyph sequence, to the sequence and to its tokens
 * @param {SubstitutionAction|any} action the substitution, anything else substitutes nothing
 * @param {GlyphSequence} glyphSequence
 * @param {number} position the position of the current glyph of the substitution
 * @returns {number} the number of glyphs a lookup goes on after, from the current one: the glyphs that replaced
 * it (0 when deleted, 1 when nothing is substituted), or for a contextual rule the glyphs to its last input glyph
 */
function applySubstitution(action, glyphSequence, position) {
    if (action instanceof SubstitutionAction && SUBSTITUTIONS[action.id]) {
        return SUBSTITUTIONS[action.id](action, glyphSequence, position);
    }
    return 1;
}

/**
 * Get the coverage tables of the first glyph of the subtables of a lookup, or null
 * when a subtable has none (the lookup is then tried at every glyph)
 * @param {any} lookupTable
 * @returns {any[]|null}
 */
function getLookupFirstGlyphCoverages(lookupTable) {
    const coverages = [];
    for (let i = 0; i < lookupTable.subtables.length; i++) {
        const subtable = lookupTable.lookupType === 7 ? lookupTable.subtables[i].extension : lookupTable.subtables[i];
        const coverage = subtable && (subtable.coverage ||
            (subtable.inputCoverage && subtable.inputCoverage[0]) ||
            (subtable.coverages && subtable.coverages[0]));
        if (!coverage) {
            return null;
        }
        coverages.push(coverage);
    }
    return coverages;
}

/**
 * Apply a lookup (see FeatureQuery.lookupSubstitution) at each glyph of a list of tokens, from the first one: the glyphs
 * deleted by a ligature are not part of the context any more, each glyph of a multiple substitution is a glyph of its
 * own, and like HarfBuzz the lookup goes on after the glyphs that replaced a glyph, or after the input glyphs of a
 * contextual rule that matched (see applySubstitution)
 * @param {FeatureQuery} query
 * @param {any} lookupTable
 * @param {string} tag feature tag set as the state of the substituted tokens
 * @param {Token[]} tokens
 * @param {function(Token): boolean} [isTokenSkipped] whether the lookup does not apply at the glyphs of a token
 */
function applyLookupToTokens(query, lookupTable, tag, tokens, isTokenSkipped) {
    const layout = query.font.substitution;
    const coverages = getLookupFirstGlyphCoverages(lookupTable);
    // a glyph no subtable covers cannot start a substitution: skip it without building its context
    const isCovered = glyphIndex => {
        if (!coverages) {
            return true;
        }
        return coverages.some(coverage => layout.getCoverageIndex(coverage, glyphIndex) >= 0);
    };
    // applySubstitution updates the glyphs of the sequence, the context of the lookup
    const glyphSequence = getGlyphSequence(tokens);
    const contextParams = new ContextParams(glyphSequence.glyphIndexes, 0);
    for (let position = 0; position < glyphSequence.glyphIndexes.length; position++) {
        if (!isCovered(glyphSequence.glyphIndexes[position])) {
            continue;
        }
        if (isTokenSkipped && isTokenSkipped(glyphSequence.glyphTokens[position])) {
            continue;
        }
        contextParams.setCurrentIndex(position);
        const action = query.lookupSubstitution(lookupTable, contextParams, tag);
        if (action) {
            position += applySubstitution(action, glyphSequence, position) - 1;
        }
    }
}

/**
 * Get the lookups of features in lookup list order, like HarfBuzz: each lookup once, with the tag of the (first)
 * feature it belongs to, without the indexes past the lookup list
 * @param {FeatureQuery} query
 * @param {string[]} tags feature tags
 * @param {string} script script tag
 * @returns {Array<{lookupTable: any, tag: string}>}
 */
function getFeaturesLookups(query, tags, script) {
    const lookupTags = new Map();
    for (const tag of tags) {
        const feature = query.getFeature({ tag, script });
        if (!feature || !feature.lookupListIndexes) {
            continue;
        }
        for (const lookupIndex of feature.lookupListIndexes) {
            if (!lookupTags.has(lookupIndex)) {
                lookupTags.set(lookupIndex, tag);
            }
        }
    }
    const lookupIndexes = Array.from(lookupTags.keys()).sort((indexA, indexB) => indexA - indexB);
    const lookups = [];
    for (const lookupIndex of lookupIndexes) {
        const lookupTable = query.getLookupByIndex(lookupIndex);
        if (lookupTable) {
            lookups.push({ lookupTable, tag: lookupTags.get(lookupIndex) });
        }
    }
    return lookups;
}

/**
 * Apply the lookups of features to a list of tokens like HarfBuzz: in lookup list order, each one once and at every
 * glyph (see applyLookupToTokens), with the tag of its first feature, so that a lookup sees the glyphs the previous ones
 * substituted, and not feature by feature
 * @param {FeatureQuery} query
 * @param {string[]} tags feature tags
 * @param {string} script script tag
 * @param {Token[]} tokens
 * @param {function(Token): boolean} [isTokenSkipped] whether the features do not apply at the glyphs of a token
 */
function applyFeaturesToTokens(query, tags, script, tokens, isTokenSkipped) {
    for (const { lookupTable, tag } of getFeaturesLookups(query, tags, script)) {
        applyLookupToTokens(query, lookupTable, tag, tokens, isTokenSkipped);
    }
}

export default applySubstitution;
export { getTokenGlyphIndexes, getGlyphSequence, applyLookupToTokens, getFeaturesLookups, applyFeaturesToTokens };
