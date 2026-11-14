/**
 * The stages of the enabled GSUB features of the thai script (rvrn, ccmp, locl, rlig, rclt, calt, liga, clig, rand and
 * the direction features of the run by default), applied by applyScriptRunFeatures in bidi.mjs like the Thai shaper of
 * HarfBuzz, which adds no stage of its own: the lookups of rvrn first, then the lookups of all the other features one
 * after the other in lookup list order, each one to the whole thai script run of text, and not feature by feature.
 */

import { getDefaultShaperFeatureStages } from '../applySubstitution.mjs';

/**
 * The stages of the enabled thai features of the thai script runs (see FeatureStage in applySubstitution.mjs)
 * @param {string} script the script tag of the runs in the GSUB table
 * @param {string[]} tags the enabled feature tags of the runs: the thai features and the direction features of the runs
 * @returns {FeatureStage[]}
 */
function getThaiFeatureStages(script, tags) {
    return getDefaultShaperFeatureStages(this.query, tags, script, this.language);
}

export default getThaiFeatureStages;
