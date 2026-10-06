import { ContextParams } from '../../tokenizer.mjs';
import applySubstitution from '../applySubstitution.mjs';
import { isLatinRunChar } from '../latn/latinFeatures.mjs';

// @TODO: use commonFeatureUtils.js for reduction of code duplication
// once #564 has been merged.

/**
 * Update context params
 * @param {any} tokens a list of tokens
 * @param {number} index current item index
 */
function getContextParams(tokens, index) {
    const context = tokens.map(token => token.activeState.value);
    return new ContextParams(context, index || 0);
}

/**
 * Apply ccmp replacement ligatures to a context range
 * @param {ContextRange} range a range of tokens
 */
function ccmpReplacementLigatures(range) {
    const script = 'delf';
    const tag = 'ccmp';
    let tokens = this.tokenizer.getRangeTokens(range);
    let contextParams = getContextParams(tokens);
    // the latin features apply ccmp to the latin runs, in lookup order with the other features
    const latinCcmp = (this.featuresTags.latn || []).includes(tag);
    for(let index = 0; index < contextParams.context.length; index++) {
        if (!this.query.getFeature({tag, script, contextParams})){
            continue;
        }
        if (latinCcmp && isLatinRunChar(tokens[index].char)) {
            continue;
        }
        contextParams.setCurrentIndex(index);
        let substitutions = this.query.lookupFeature({
            tag, script, contextParams
        });
        if (substitutions.length) {
            for(let i = 0; i < substitutions.length; i++) {
                const action = substitutions[i];
                applySubstitution(action, tokens, index);
            }
            contextParams = getContextParams(tokens);
        }
    }
}

export default ccmpReplacementLigatures;



