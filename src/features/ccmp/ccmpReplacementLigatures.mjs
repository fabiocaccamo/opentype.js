import { applyFeaturesToTokens } from '../applySubstitution.mjs';
import { isLatinRunChar } from '../latn/latinFeatures.mjs';
import { isThaiChar } from '../../char.mjs';

/**
 * Apply ccmp replacement ligatures to a context range
 * @param {ContextRange} range a range of tokens
 */
function ccmpReplacementLigatures(range) {
    const script = 'delf';
    const tag = 'ccmp';
    // the latin and the thai features apply ccmp to their runs, in lookup order with the other features
    const latinCcmp = this.hasFeatureEnabled('latn', tag);
    const thaiCcmp = this.hasFeatureEnabled('thai', tag);
    const isTokenSkipped = token => (latinCcmp && isLatinRunChar(token.char)) || (thaiCcmp && isThaiChar(token.char));
    applyFeaturesToTokens(this.query, [tag], script, this.tokenizer.getRangeTokens(range), isTokenSkipped);
}

export default ccmpReplacementLigatures;
