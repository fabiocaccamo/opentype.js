/**
 * Apply Arabic presentation forms to a range of tokens
 */

import { ContextParams } from '../../tokenizer.mjs';
import { isIsolatedArabicChar, isTashkeelArabicChar } from '../../char.mjs';
import applySubstitution, { getGlyphSequence } from '../applySubstitution.mjs';

/**
 * Check if a char can be connected to it's preceding char
 * @param {ContextParams} charContextParams context params of a char
 */
function willConnectPrev(charContextParams) {
    let backtrack = [].concat(charContextParams.backtrack);
    for (let i = backtrack.length - 1; i >= 0; i--) {
        const prevChar = backtrack[i];
        const isolated = isIsolatedArabicChar(prevChar);
        const tashkeel = isTashkeelArabicChar(prevChar);
        if (!isolated && !tashkeel) return true;
        if (isolated) return false;
    }
    return false;
}

/**
 * Check if a char can be connected to it's proceeding char
 * @param {ContextParams} charContextParams context params of a char
 */
function willConnectNext(charContextParams) {
    if (isIsolatedArabicChar(charContextParams.current)) return false;
    for (let i = 0; i < charContextParams.lookahead.length; i++) {
        const nextChar = charContextParams.lookahead[i];
        const tashkeel = isTashkeelArabicChar(nextChar);
        if (!tashkeel) return true;
    }
    return false;
}

/**
 * Apply the lookups of a form feature at each glyph of a token (none for a deleted token), from its first one, going on
 * after the glyphs of the substitution at each glyph (see applySubstitution)
 * @param {FeatureQuery} query
 * @param {string} tag the form feature tag
 * @param {Token} token
 * @param {GlyphSequence} glyphSequence the glyphs of the tokens, which applySubstitution updates
 * @param {ContextParams} contextParams the context of the lookups, the glyph indexes of the sequence
 */
function applyFormToToken(query, tag, token, glyphSequence, contextParams) {
    let position = glyphSequence.glyphTokens.indexOf(token);
    while (position >= 0 && glyphSequence.glyphTokens[position] === token) {
        contextParams.setCurrentIndex(position);
        const substitutions = query.lookupFeature({ tag, script: 'arab', contextParams });
        // the substitution of the current glyph, if any
        position += applySubstitution(substitutions[position], glyphSequence, position);
    }
}

/**
 * Apply arabic presentation forms to a list of tokens, in the context of the glyphs of the tokens, where each glyph
 * of a multiple substitution (e.g. of ccmp) is a glyph of its own: like the form mask that HarfBuzz copies to each
 * glyph of a multiple substitution, the form of a token applies at each of its glyphs
 * @param {ContextRange} range a range of tokens
 */
function arabicPresentationForms(range) {
    const script = 'arab';
    const tags = this.featuresTags[script];
    const tokens = this.tokenizer.getRangeTokens(range);
    if (tokens.length === 1) return;
    // applySubstitution updates the glyphs of the sequence, the context of the lookups
    const glyphSequence = getGlyphSequence(tokens);
    const contextParams = new ContextParams(glyphSequence.glyphIndexes, 0);
    const charContextParams = new ContextParams(
        tokens.map(token => token.char
        ), 0);
    for(let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (isTashkeelArabicChar(token.char)) continue;
        charContextParams.setCurrentIndex(i);
        let CONNECT = 0; // 2 bits 00 (10: can connect next) (01: can connect prev)
        if (willConnectPrev(charContextParams)) CONNECT |= 1;
        if (willConnectNext(charContextParams)) CONNECT |= 2;
        let tag;
        switch (CONNECT) {
            case 1: (tag = 'fina'); break;
            case 2: (tag = 'init'); break;
            case 3: (tag = 'medi'); break;
        }
        if (tags.indexOf(tag) === -1) continue;
        applyFormToToken(this.query, tag, token, glyphSequence, contextParams);
    }
}

export default arabicPresentationForms;
export { arabicPresentationForms };
