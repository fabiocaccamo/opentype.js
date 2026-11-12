// ╭─┄┄┄────────────────────────┄─────────────────────────────────────────────╮
// ┊ Character Class Assertions ┊ Checks if a char belongs to a certain class ┊
// ╰─╾──────────────────────────┄─────────────────────────────────────────────╯
// jscs:disable maximumLineLength
/**
 * Check if a char is Arabic
 * @param {string} c a single char
 */
export function isArabicChar(c) {
    return /[\u0600-\u065F\u066A-\u06D2\u06FA-\u06FF]/.test(c);
}

/**
 * Check if a char is an isolated arabic char
 * @param {string} c a single char
 */
export function isIsolatedArabicChar(char) {
    return /[\u0630\u0690\u0621\u0631\u0661\u0671\u0622\u0632\u0672\u0692\u06C2\u0623\u0673\u0693\u06C3\u0624\u0694\u06C4\u0625\u0675\u0695\u06C5\u06E5\u0676\u0696\u06C6\u0627\u0677\u0697\u06C7\u0648\u0688\u0698\u06C8\u0689\u0699\u06C9\u068A\u06CA\u066B\u068B\u06CB\u068C\u068D\u06CD\u06FD\u068E\u06EE\u06FE\u062F\u068F\u06CF\u06EF]/.test(char);
}

/**
 * Check if a char is an Arabic Tashkeel char
 * @param {string} c a single char
 */
export function isTashkeelArabicChar(char) {
    // eslint-disable-next-line no-misleading-character-class
    return /[\u0600-\u0605\u060C-\u060E\u0610-\u061B\u061E\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/.test(char);
}

/**
 * Check if a char is Thai
 * @param {string} c a single char
 */
export function isThaiChar(c) {
    return /[\u0E00-\u0E7F]/.test(c);
}

/**
 * The OpenType script tags of the kerning other than latn, in the order a pair of characters of several of
 * these scripts takes them (see getCharKerningScript)
 */
export const KERNING_SCRIPT_TAGS = ['thai', 'arab', 'hebr', 'cyrl', 'grek'];

// a capture group for each script of KERNING_SCRIPT_TAGS, in the same order, then one for the chars of no script,
// so that one test gives the script of a char
const KERNING_SCRIPT_PATTERN = /(\p{Script=Thai})|(\p{Script=Arabic})|(\p{Script=Hebrew})|(\p{Script=Cyrillic})|(\p{Script=Greek})|([\p{Script=Common}\p{Script=Inherited}\p{General_Category=Unassigned}\p{General_Category=Private_Use}\p{General_Category=Surrogate}])/u;

/**
 * The script of the kerning of a char, from its Unicode Script property: thai, arab, hebr, cyrl or grek for
 * Thai, Arabic, Hebrew, Cyrillic or Greek, undefined for a char of no script: Common (digits, punctuation,
 * symbols), Inherited (combining marks) or Unknown (the unassigned, private use and surrogate code points),
 * latn for the other scripts
 * @param {string} char a single char
 * @return {string|undefined}
 */
export function getCharKerningScript(char) {
    const match = KERNING_SCRIPT_PATTERN.exec(char);
    if (!match) {
        return 'latn';
    }
    // the group of the chars of no script comes after the groups of KERNING_SCRIPT_TAGS
    return KERNING_SCRIPT_TAGS.find((tag, index) => match[index + 1] !== undefined);
}

/**
 * Check if a char is Latin
 * @param {string} c a single char
 */
export function isLatinChar(c) {
    return /[A-z]/.test(c);
}

/**
 * Check if a char is whitespace char
 * @param {string} c a single char
 */
export function isWhiteSpace(c) {
    return /\s/.test(c);
}
