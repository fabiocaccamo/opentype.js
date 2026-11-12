/**
 * Apply Arabic required ligatures feature to a range of tokens
 */

import { applyFeaturesToTokens } from '../applySubstitution.mjs';

/**
 * Apply Arabic required ligatures to a context range: the glyphs deleted by a ligature
 * are not part of the context any more
 * @param {ContextRange} range a range of tokens
 */
function arabicRequiredLigatures(range) {
    applyFeaturesToTokens(this.query, ['rlig'], 'arab', this.tokenizer.getRangeTokens(range));
}

export default arabicRequiredLigatures;
export { arabicRequiredLigatures };
