/**
 * The stages of the enabled GSUB features of the default shaper of HarfBuzz, applied by applyScriptRunFeatures in
 * bidi.mjs to every script run that is neither arabic, thai nor of the Indic shaper of HarfBuzz (see
 * getScriptRunShaper) and to a text of no script: the lookups of rvrn first, then the lookups of all the other
 * features one after the other in lookup list order, each one to the whole script run of text, and not feature by
 * feature. The scripts of the default shaper of HarfBuzz (Latin, Cyrillic, Greek, Armenian, Georgian...) and Hebrew,
 * whose shaper of HarfBuzz adds no GSUB feature, take the GSUB features of HarfBuzz; not yet the features and the
 * stages of the other shapers of HarfBuzz (Khmer, Myanmar, the Universal Shaping Engine...).
 */

import { getDefaultShaperFeatureStages } from '../applySubstitution.mjs';

/**
 * The stages of the enabled latin features of the script runs of a script (see FeatureStage in applySubstitution.mjs)
 * @param {string} script the script tag of the runs in the GSUB table
 * @param {string[]} tags the enabled feature tags of the runs: the latin features and the direction features of the runs
 * @returns {FeatureStage[]}
 */
function getLatinFeatureStages(script, tags) {
    return getDefaultShaperFeatureStages(this.query, tags, script, this.language);
}

export default getLatinFeatureStages;
