/**
 * Unicode Variation Sequence context checkers
 */

import { isVariationSequenceSelector } from '../../../char.mjs';

function unicodeVariationSequenceStartCheck(contextParams) {
    const char = contextParams.current;
    const nextChar = contextParams.get(1);
    return (
        (nextChar === null && isVariationSequenceSelector(char)) ||
        (isVariationSequenceSelector(nextChar))
    );
}

function unicodeVariationSequenceEndCheck(contextParams) {
    const nextChar = contextParams.get(1);
    return (
        (nextChar === null) ||
        (!isVariationSequenceSelector(nextChar))
    );
}

export default {
    startCheck: unicodeVariationSequenceStartCheck,
    endCheck: unicodeVariationSequenceEndCheck
};
