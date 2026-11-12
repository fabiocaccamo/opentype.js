import { SubstitutionAction } from './featureQuery.mjs';

/**
 * Apply single substitution format 1
 * @param {Array} substitutions substitutions
 * @param {any} tokens a list of tokens
 * @param {number} index token index
 */
function singleSubstitutionFormat1(action, tokens, index) {
    tokens[index].setState(action.tag, action.substitution);
}

/**
 * Apply single substitution format 2
 * @param {Array} substitutions substitutions
 * @param {any} tokens a list of tokens
 * @param {number} index token index
 */
function singleSubstitutionFormat2(action, tokens, index) {
    tokens[index].setState(action.tag, action.substitution);
}

/**
 * Apply contextual substitutions (context and chaining context, all formats),
 * whose substitutions are indexed by the offset of the input glyphs from the current one
 * @param {Array} substitutions substitutions
 * @param {any} tokens a list of tokens
 * @param {number} index token index
 */
function chainingSubstitutionFormat3(action, tokens, index) {
    for(let i = 0; i < action.substitution.length; i++) {
        const subst = action.substitution[i];
        // a hole in the substitutions keeps the glyph at this sequence index
        if (subst === undefined) continue;
        const token = tokens[index + i];
        if (Array.isArray(subst)) {
            if (subst.length){
                // TODO: replace one glyph with multiple glyphs
                token.setState(action.tag, subst[0]);
            } else {
                token.setState('deleted', true);
            }
            continue;
        }
        token.setState(action.tag, subst);
    }
}

/**
 * Apply multiple substitution format 1: the token holds the sequence of glyphs
 * replacing its glyph (expanded in the glyphs of the text), an empty sequence deletes it
 * @param {Array} substitutions substitutions
 * @param {any} tokens a list of tokens
 * @param {number} index token index
 */
function multipleSubstitutionFormat1(action, tokens, index) {
    const glyphs = action.substitution;
    if (!glyphs.length) {
        tokens[index].setState('deleted', true);
        return;
    }
    tokens[index].setState(action.tag, glyphs.length === 1 ? glyphs[0] : glyphs.slice());
}

/**
 * Apply ligature substitution format 1: the first component becomes the ligature glyph and the
 * other components are deleted, the glyphs the lookup skipped between them stay after the ligature
 * @param {Array} substitutions substitutions
 * @param {any} tokens a list of tokens
 * @param {number} index token index
 */
function ligatureSubstitutionFormat1(action, tokens, index) {
    tokens[index].setState(action.tag, action.substitution.ligGlyph);
    for (const componentOffset of action.substitution.componentOffsets) {
        tokens[index + componentOffset].setState('deleted', true);
    }
}

/**
 * Supported substitutions
 */
const SUBSTITUTIONS = {
    11: singleSubstitutionFormat1,
    12: singleSubstitutionFormat2,
    21: multipleSubstitutionFormat1,
    63: chainingSubstitutionFormat3,
    41: ligatureSubstitutionFormat1,
    51: chainingSubstitutionFormat3,
    52: chainingSubstitutionFormat3,
    53: chainingSubstitutionFormat3,
    61: chainingSubstitutionFormat3,
    62: chainingSubstitutionFormat3
};

/**
 * Apply substitutions to a list of tokens
 * @param {Array} substitutions substitutions
 * @param {any} tokens a list of tokens
 * @param {number} index token index
 */
function applySubstitution(action, tokens, index) {
    if (action instanceof SubstitutionAction && SUBSTITUTIONS[action.id]) {
        SUBSTITUTIONS[action.id](action, tokens, index);
    }
}

export default applySubstitution;
