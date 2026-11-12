/**
 * Apply the enabled GSUB features of the thai script (rvrn, ccmp, locl, rlig, rclt, calt, liga and clig by default) like
 * the Thai shaper of HarfBuzz, which adds no stage of its own: the lookups of rvrn first, then the lookups of all the
 * other features one after the other in lookup list order, each one to the whole thai script run of text, and not
 * feature by feature.
 */

import { applyFeatureStagesToTokens } from '../applySubstitution.mjs';

/**
 * Apply the enabled thai features to a thai script run of the text
 * @param {Token[]} tokens the tokens of the run
 * @param {string} script the script tag of the run in the GSUB table
 */
function thaiFeatures(tokens, script) {
    applyFeatureStagesToTokens(this.query, this.featuresTags.thai, script, this.language, tokens);
}

export default thaiFeatures;
