// ╭─┄┄┄────────────────────────┄─────────────────────────────────────────────╮
// ┊ Character Class Assertions ┊ Checks if a char belongs to a certain class ┊
// ╰─╾──────────────────────────┄─────────────────────────────────────────────╯
// jscs:disable maximumLineLength
import { SCRIPT_CODES, SCRIPT_RANGES, SCRIPT_EXTENSION_RANGES } from './unicode-scripts.mjs';

/**
 * Check if a char is Arabic: of the Arabic block (not yet all of it) or of the Arabic Presentation Forms-A and -B
 * blocks, whose runs are laid out from right to left like HarfBuzz, but the chars of the Common script of these blocks
 * (U+FD3E ORNATE LEFT PARENTHESIS, U+FD3F ORNATE RIGHT PARENTHESIS and U+FEFF ZERO WIDTH NO-BREAK SPACE), so that a
 * stray one does not start an Arabic run
 * @param {string} c a single char
 */
export function isArabicChar(c) {
    return /[\u0600-\u065F\u066A-\u06D2\u06FA-\u06FF\uFB50-\uFD3D\uFD40-\uFDFF\uFE70-\uFEFE]/.test(c);
}

/**
 * The Unicode Joining_Type of a char, like the Arabic shaper of HarfBuzz, which joins the join causing chars (the
 * tatweel and the zero width joiner U+200D) as dual-joining letters: D for the dual-joining letters of the Arabic block
 * and the join causing chars, R for the right-joining letters of the Arabic block, T for the transparent chars, the
 * nonspacing and enclosing marks and the format chars (e.g. the harakat, U+0300, U+00AD SOFT HYPHEN, U+200F
 * RIGHT-TO-LEFT MARK, U+2060 WORD JOINER) but the ones ArabicShaping.txt lists as non-joining, U for the other chars,
 * the non-joining ones (e.g. the hamza, the digits, U+0600 ARABIC NUMBER SIGN, the zero width non-joiner U+200C). The
 * D, R and non-joining lists are the ones of ArabicShaping.txt, Unicode 16.0.0; the nonspacing and enclosing marks and
 * the format chars are the ones of the Unicode version of the JavaScript engine (its \p{Mn}, \p{Me} and \p{Cf}), so a
 * mark newer than that version is U there
 * @param {string} char a single char
 * @return {string}
 */
export function getArabicJoiningType(char) {
    if (/[\u0620\u0626\u0628\u062A-\u062E\u0633-\u0647\u0649\u064A\u066E\u066F\u0678-\u0687\u069A-\u06BF\u06C1\u06C2\u06CC\u06CE\u06D0\u06D1\u06FA-\u06FC\u06FF\u200D]/.test(char)) {
        return 'D';
    }
    if (/[\u0622-\u0625\u0627\u0629\u062F-\u0632\u0648\u0671-\u0673\u0675-\u0677\u0688-\u0699\u06C0\u06C3-\u06CB\u06CD\u06CF\u06D2\u06D3\u06D5\u06EE\u06EF]/.test(char)) {
        return 'R';
    }
    // the format chars that ArabicShaping.txt lists as non-joining
    if (/[\u0600-\u0605\u06DD\u0890\u0891\u08E2\u180E\u200C\u2066-\u2069\u{110BD}\u{110CD}]/u.test(char)) {
        return 'U';
    }
    return /[\p{Mn}\p{Me}\p{Cf}]/u.test(char) ? 'T' : 'U';
}

/**
 * Check if a char is an Arabic Tashkeel char
 * @param {string} c a single char
 */
export function isTashkeelArabicChar(char) {
    // eslint-disable-next-line no-misleading-character-class
    return /[\u0600-\u0605\u060C-\u060E\u0610-\u061B\u061E\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/.test(char);
}

// the start code point of each range of code points of one script (see unicode-scripts.mjs), and its script
const { scriptRangeStarts, scriptRangeCodes } = decodeScriptRanges(SCRIPT_RANGES);
// the ranges of code points whose Script_Extensions are not their script alone (see unicode-scripts.mjs)
const { extensionRangeStarts, extensionRangeEnds, extensionRangeScripts } = decodeScriptExtensionRanges(SCRIPT_EXTENSION_RANGES);

/**
 * Decode the ranges of code points of one script of unicode-scripts.mjs
 * @param {string} encodedRanges - SCRIPT_RANGES
 * @return {{scriptRangeStarts: number[], scriptRangeCodes: string[]}} the start code point of each range, in
 * ascending order, and the ISO 15924 code of its script
 */
function decodeScriptRanges(encodedRanges) {
    const starts = [];
    const codes = [];
    let start = 0;
    for (const encodedRange of encodedRanges.split(',')) {
        const [distance, scriptIndex] = encodedRange.split(':');
        start += parseInt(distance, 36);
        starts.push(start);
        codes.push(SCRIPT_CODES[parseInt(scriptIndex, 36)]);
    }
    return { scriptRangeStarts: starts, scriptRangeCodes: codes };
}

/**
 * Decode the ranges of code points of the Script_Extensions of unicode-scripts.mjs
 * @param {string} encodedRanges - SCRIPT_EXTENSION_RANGES
 * @return {{extensionRangeStarts: number[], extensionRangeEnds: number[], extensionRangeScripts: string[][]}} the first
 * and the last code point of each range, in ascending order, and the ISO 15924 codes of its scripts
 */
function decodeScriptExtensionRanges(encodedRanges) {
    const starts = [];
    const ends = [];
    const scripts = [];
    let start = 0;
    for (const encodedRange of encodedRanges.split(',')) {
        const [distance, length, ...scriptIndexes] = encodedRange.split(':').map(value => parseInt(value, 36));
        start += distance;
        starts.push(start);
        ends.push(start + length);
        scripts.push(scriptIndexes.map(scriptIndex => SCRIPT_CODES[scriptIndex]));
    }
    return { extensionRangeStarts: starts, extensionRangeEnds: ends, extensionRangeScripts: scripts };
}

/**
 * The index of the last range that starts at or before a code point
 * @param {number[]} rangeStarts - the start code point of each range, in ascending order
 * @param {number} codePoint
 * @return {number} -1 when every range starts after the code point
 */
function findRangeIndex(rangeStarts, codePoint) {
    let low = -1;
    let high = rangeStarts.length - 1;
    while (low < high) {
        const middle = (low + high + 1) >>> 1;
        if (rangeStarts[middle] <= codePoint) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    return low;
}

/**
 * The Unicode Script property of a char (Unicode 16.0.0, see unicode-scripts.mjs), as its ISO 15924 code: e.g.
 * Latn, Cyrl, Arab, Zyyy for Common (digits, punctuation, symbols), Zinh for Inherited (most combining marks),
 * Zzzz for Unknown (the unassigned, private use and surrogate code points)
 * @param {string} char - a single char (a code point)
 * @return {string}
 */
export function getCharScript(char) {
    return scriptRangeCodes[findRangeIndex(scriptRangeStarts, char.codePointAt(0))];
}

/**
 * The Unicode Script_Extensions property of a char (Unicode 16.0.0, see unicode-scripts.mjs), the scripts of the text
 * the char is used with, as their ISO 15924 codes: e.g. Adlm, Arab, Mand... for the Arabic tatweel, Arab and Syrc for
 * the Arabic harakat, the script of the char alone for most chars (Zyyy for most of the chars of the Common script)
 * @param {string} char - a single char (a code point)
 * @return {string[]}
 */
export function getCharScriptExtensions(char) {
    const codePoint = char.codePointAt(0);
    const index = findRangeIndex(extensionRangeStarts, codePoint);
    return index >= 0 && codePoint <= extensionRangeEnds[index] ? extensionRangeScripts[index] : [getCharScript(char)];
}

/**
 * Check if a char is a variation selector of a variation sequence: a Mongolian free variation selector, one of the
 * variation selectors 1 to 16 or of the supplement
 * @param {string|null} char a single char
 * @return {boolean}
 */
export function isVariationSequenceSelector(char) {
    if (isVariationSelector(char)) {
        return true;
    }
    if (char === null) {
        return false;
    }
    const charCode = char.codePointAt(0);
    // Mongolian free variation selectors
    return charCode >= 0x180B && charCode <= 0x180D;
}

/**
 * Check if a char is a variation selector for the normalization of HarfBuzz (hb_unicode_funcs_t::is_variation_selector,
 * hb-unicode.hh of HarfBuzz 11.3.2): one of the variation selectors 1 to 16 or of the supplement, not the Mongolian
 * free variation selectors, which HarfBuzz leaves to the Arabic shaper
 * @param {string|null} char a single char
 * @return {boolean}
 */
export function isVariationSelector(char) {
    if (char === null) {
        return false;
    }
    const charCode = char.codePointAt(0);
    return (charCode >= 0xFE00 && charCode <= 0xFE0F) || (charCode >= 0xE0100 && charCode <= 0xE01EF);
}

/**
 * The space types of HarfBuzz (hb_unicode_funcs_t::space_t, hb-unicode.hh of HarfBuzz 11.3.2), with its values: the
 * advance that a space a font has not takes with the glyph of U+0020 SPACE (see getDefaultGlyphAdvance in
 * position.mjs). The value of EM_n is n: 1/n em.
 */
export const SPACE_TYPES = Object.freeze({
    NOT_SPACE: 0,
    EM: 1,
    EM_2: 2,
    EM_3: 3,
    EM_4: 4,
    EM_5: 5,
    EM_6: 6,
    EM_16: 16,
    FOUR_EM_18: 17,
    SPACE: 18,
    FIGURE: 19,
    PUNCTUATION: 20,
    NARROW: 21
});

// the spaces of the Zs general category that can use the glyph of U+0020, and their space type, like
// hb_unicode_funcs_t::space_fallback_type of HarfBuzz 11.3.2 (U+1680 OGHAM SPACE MARK cannot)
const SPACE_FALLBACK_TYPES = new Map([
    [0x0020, SPACE_TYPES.SPACE],
    [0x00A0, SPACE_TYPES.SPACE],
    [0x2000, SPACE_TYPES.EM_2],
    [0x2001, SPACE_TYPES.EM],
    [0x2002, SPACE_TYPES.EM_2],
    [0x2003, SPACE_TYPES.EM],
    [0x2004, SPACE_TYPES.EM_3],
    [0x2005, SPACE_TYPES.EM_4],
    [0x2006, SPACE_TYPES.EM_6],
    [0x2007, SPACE_TYPES.FIGURE],
    [0x2008, SPACE_TYPES.PUNCTUATION],
    [0x2009, SPACE_TYPES.EM_5],
    [0x200A, SPACE_TYPES.EM_16],
    [0x202F, SPACE_TYPES.NARROW],
    [0x205F, SPACE_TYPES.FOUR_EM_18],
    [0x3000, SPACE_TYPES.EM]
]);

/**
 * The space type of a char that a font without its glyph can draw with the glyph of U+0020 SPACE, like
 * hb_unicode_funcs_t::space_fallback_type of HarfBuzz (see SPACE_TYPES)
 * @param {string} char a single char
 * @return {number} SPACE_TYPES.NOT_SPACE for the other chars
 */
export function getSpaceFallbackType(char) {
    return SPACE_FALLBACK_TYPES.get(char.codePointAt(0)) || SPACE_TYPES.NOT_SPACE;
}

// the scripts of the chars that take the script of the text around them: Common, Inherited and Unknown
const SCRIPTLESS_SCRIPTS = ['Zyyy', 'Zinh', 'Zzzz'];

/**
 * The script a char gives the text around it: its Unicode Script (see getCharScript), none for the chars of no
 * script, Common (digits, punctuation, symbols), Inherited (most combining marks) and Unknown, which take the script
 * of the text around them (see getScriptRuns), and none for a variation selector, which selects a variant of the char
 * before it (the Mongolian free variation selectors are of the Mongolian script)
 * @param {string} char - a single char (a code point)
 * @return {string|undefined} the ISO 15924 code of the script
 */
export function getCharTextScript(char) {
    const script = getCharScript(char);
    return SCRIPTLESS_SCRIPTS.includes(script) || isVariationSequenceSelector(char) ? undefined : script;
}

/**
 * The script of the first char of a script after each char of a text
 * @param {Array<string|undefined>} scripts - the script of each char of the text (see getCharTextScript)
 * @return {Array<string|undefined>} undefined after the last char of a script
 */
function getNextScripts(scripts) {
    const nextScripts = new Array(scripts.length);
    let nextScript;
    for (let i = scripts.length - 1; i >= 0; i--) {
        nextScripts[i] = nextScript;
        if (scripts[i] !== undefined) {
            nextScript = scripts[i];
        }
    }
    return nextScripts;
}

/**
 * Check if a char of no script starts the run of the text after it rather than continuing the run before it, like the
 * ScriptRunIterator of Chromium: when its Script_Extensions (see getCharScriptExtensions) have the script of the next
 * char of a script and not the script of the run before it (e.g. a tatweel or an Arabic comma after a Latin word,
 * before an Arabic letter). A char of the Inherited script (a combining mark) never does: it stays with the char
 * before it, its base, like the browsers
 * @param {string} char - a char of no script (see getCharTextScript)
 * @param {string|undefined} runScript - the script of the run before the char, undefined at the start of the text
 * @param {string|undefined} nextScript - the script of the first char of a script after the char
 * @return {boolean}
 */
function startsNextScriptRun(char, runScript, nextScript) {
    if (runScript === undefined || nextScript === undefined || getCharScript(char) === 'Zinh') {
        return false;
    }
    const extensions = getCharScriptExtensions(char);
    return extensions.includes(nextScript) && !extensions.includes(runScript);
}

/**
 * Split a text into its script runs, the runs of chars that HarfBuzz shapes with one script: the chars of a run have
 * the same script (see getCharTextScript), the chars of no script are in the run of the char before them, unless the
 * Script_Extensions of a char of the Common script take it to the run after it (see startsNextScriptRun), or at the
 * start of the text in the run of the first char of a script after them (the script that
 * hb_buffer_guess_segment_properties gives a text), like the itemization of the browsers. Not yet the paired brackets
 * of the browsers (Unicode Standard Annex #24): a closing bracket is in the run of the char before it, not in the run
 * of its opening bracket
 * @param {string[]} chars - the chars of the text, a code point each
 * @return {Array<{start: number, end: number, script: string|undefined}>} the [start, end) indexes of the chars of
 * each run in the text, and the ISO 15924 code of its script, undefined for a text of chars of no script only
 */
export function getScriptRuns(chars) {
    const scripts = chars.map(getCharTextScript);
    const nextScripts = getNextScripts(scripts);
    const runs = [];
    let run = { start: 0, end: 0, script: undefined };
    for (let i = 0; i < chars.length; i++) {
        let script = scripts[i];
        if (script === undefined && startsNextScriptRun(chars[i], run.script, nextScripts[i])) {
            script = nextScripts[i];
        }
        if (script !== undefined && script !== run.script) {
            if (run.script === undefined) {
                run.script = script;
            } else {
                runs.push(run);
                run = { start: i, end: i, script };
            }
        }
        run.end = i + 1;
    }
    if (run.end > run.start) {
        runs.push(run);
    }
    return runs;
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
