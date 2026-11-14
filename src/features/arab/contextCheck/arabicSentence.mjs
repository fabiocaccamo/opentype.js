/**
 * Arabic sentence context checkers
 */

import { isArabicChar, isWhiteSpace, isTashkeelArabicChar } from '../../../char.mjs';

function arabicSentenceStartCheck(contextParams) {
    const char = contextParams.current;
    const prevChar = contextParams.get(-1);
    return (
        // ? an arabic char preceded with a non arabic char
        (isArabicChar(char) || isTashkeelArabicChar(char)) &&
        !isArabicChar(prevChar)
    );
}

/**
 * Whether an arabic char or tashkeel follows the current char, read in the context without a copy of its lookahead
 * @param {ContextParams} contextParams
 * @returns {boolean}
 */
function hasArabicCharAhead(contextParams) {
    for (let i = contextParams.index + 1; i < contextParams.context.length; i++) {
        const char = contextParams.context[i];
        if (isArabicChar(char) || isTashkeelArabicChar(char)) {
            return true;
        }
    }
    return false;
}

function arabicSentenceEndCheck(contextParams) {
    const nextChar = contextParams.get(1);
    switch (true) {
        case nextChar === null:
            return true;
        case (!isArabicChar(nextChar) && !isTashkeelArabicChar(nextChar)): {
            if (!isWhiteSpace(nextChar)) {
                return true;
            }
            if (!hasArabicCharAhead(contextParams)) {
                return true;
            }
            break;
        }
        default:
            return false;
    }
}

export default {
    startCheck: arabicSentenceStartCheck,
    endCheck: arabicSentenceEndCheck
};
