/**
 * Apply the enabled GSUB features of the latin script, like HarfBuzz does: the
 * lookups of all the features are applied one after the other in lookup list order,
 * each one to the whole run of text, and not feature by feature.
 */

import { applyFeaturesToTokens } from '../applySubstitution.mjs';
import { isArabicChar, isThaiChar } from '../../char.mjs';

/**
 * Check if a character belongs to the runs the latin features apply to
 * @param {string} char
 * @returns {boolean}
 */
function isLatinRunChar(char) {
    return !isArabicChar(char) && !isThaiChar(char);
}

/**
 * Split the tokens into the runs the latin features apply to: the maximal sequences
 * of characters that are not shaped by the arabic or thai features, so that
 * spaces, digits and punctuation (e.g. the code ligatures of "->") are included.
 * @param {Token[]} tokens
 * @returns {Token[][]}
 */
function getLatinRuns(tokens) {
    const runs = [];
    let run = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!isLatinRunChar(token.char)) {
            if (run.length) runs.push(run);
            run = [];
        } else {
            run.push(token);
        }
    }
    if (run.length) runs.push(run);
    return runs;
}

/**
 * Apply the enabled latin features to the text
 */
function latinFeatures() {
    const tags = this.featuresTags.latn || [];
    if (!tags.length) return;
    for (const run of getLatinRuns(this.tokenizer.tokens)) {
        applyFeaturesToTokens(this.query, tags, 'latn', run);
    }
}

export default latinFeatures;
export { isLatinRunChar };
