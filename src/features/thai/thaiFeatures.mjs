/**
 * Apply the enabled GSUB features of the thai script (liga, rlig and ccmp by default) like HarfBuzz does: the lookups
 * of all the features are applied one after the other in lookup list order, each one to the whole thai word, and
 * not feature by feature.
 */

import { applyFeaturesToTokens } from '../applySubstitution.mjs';

/**
 * Apply the enabled thai features to the thai words
 */
function thaiFeatures() {
    const tags = this.featuresTags.thai || [];
    for (const range of this.tokenizer.getContextRanges('thaiWord')) {
        applyFeaturesToTokens(this.query, tags, 'thai', this.tokenizer.getRangeTokens(range));
    }
}

export default thaiFeatures;
