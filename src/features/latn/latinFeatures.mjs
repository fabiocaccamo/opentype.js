/**
 * Apply the enabled GSUB features like the default shaper of HarfBuzz, to every script run that is neither arabic nor
 * thai (see getScriptRunShaper) and to a text of no script: the lookups of rvrn first, then the lookups of all the other
 * features one after the other in lookup list order, each one to the whole script run of text, and not feature by
 * feature. The scripts of the default shaper of HarfBuzz (Latin, Cyrillic, Greek, Armenian, Georgian...) and Hebrew,
 * whose shaper of HarfBuzz adds no GSUB feature, take the GSUB features of HarfBuzz; not yet the features and the
 * stages of the other shapers of HarfBuzz (Indic, Khmer, Myanmar, the Universal Shaping Engine...).
 */

import { applyFeatureStagesToTokens } from '../applySubstitution.mjs';

/**
 * Apply the enabled latin features to a script run of the text
 * @param {Token[]} tokens the tokens of the run
 * @param {string} script the script tag of the run in the GSUB table
 * @param {string[]} tags the enabled feature tags of the run: the latin features and the direction features of the run
 */
function latinFeatures(tokens, script, tags) {
    applyFeatureStagesToTokens(this.query, tags, script, this.language, tokens);
}

export default latinFeatures;
