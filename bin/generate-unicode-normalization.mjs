#!/usr/bin/env node
// Generate src/unicode-normalization.mjs, the data of the Unicode normalization of HarfBuzz (hb-ot-shape-normalize.cc)
// that String.prototype.normalize does not give, from the Unicode Character Database: UnicodeData.txt and
// DerivedNormalizationProps.txt, of the same version.
//
//     curl -O https://www.unicode.org/Public/16.0.0/ucd/UnicodeData.txt
//     curl -O https://www.unicode.org/Public/16.0.0/ucd/DerivedNormalizationProps.txt
//     node bin/generate-unicode-normalization.mjs UnicodeData.txt DerivedNormalizationProps.txt > src/unicode-normalization.mjs
//
// src/unicode-normalization.mjs comes from the files of Unicode 16.0.0, the version of HarfBuzz 11.3.2:
//     sha256 ff58e5823bd095166564a006e47d111130813dcf8bf234ef79fa51a870edb48f  UnicodeData.txt
//     sha256 4d4c03892dea9146d674b686e495df2d55a28d071ac474041d73518f887abddc  DerivedNormalizationProps.txt

import { readFileSync } from 'fs';
import process from 'process';

// the modified combining classes of HarfBuzz 11.3.2 that are not the Canonical_Combining_Class itself
// (_hb_modified_combining_class in hb-unicode.cc, HB_MODIFIED_COMBINING_CLASS_CCC* in hb-unicode.hh): the Hebrew
// points in their visual order, the Arabic shadda before the vowel marks, the Telugu, Thai, Lao and Tibetan vowel signs
const MODIFIED_COMBINING_CLASSES = new Map([
    [10, 22], [11, 15], [12, 16], [13, 17], [14, 23], [15, 18], [16, 19], [17, 20], [18, 21], [19, 14], [20, 24],
    [21, 12], [22, 25], [23, 13], [24, 10], [25, 11], [26, 26],
    [27, 28], [28, 29], [29, 30], [30, 31], [31, 32], [32, 33], [33, 27], [34, 34], [35, 35],
    [36, 36],
    [84, 4], [91, 5],
    [103, 3], [107, 107],
    [118, 118], [122, 122],
    [129, 129], [130, 132], [132, 131]
]);

// the code points whose modified combining class HarfBuzz sets on its own (hb_unicode_funcs_t::modified_combining_class
// in hb-unicode.hh): U+1A60 TAI THAM SIGN SAKOT after the tone marks, U+0FC6 TIBETAN SYMBOL PADMA GDAN after the vowel
// signs, U+0F39 TIBETAN MARK TSA -PHRU before U+0F74
const MODIFIED_COMBINING_CLASS_CODE_POINTS = new Map([[0x1A60, 254], [0x0FC6, 254], [0x0F39, 127]]);

/**
 * The data lines of a file of the Unicode Character Database, without their comment, split into their fields
 * @param {string} path
 * @returns {string[][]}
 */
function readDataLines(path) {
    return readFileSync(path, 'utf8').split('\n')
        .map(line => line.replace(/#.*/, '').trim())
        .filter(line => line.length)
        .map(line => line.split(';').map(field => field.trim()));
}

/**
 * The code points of UnicodeData.txt, each one with its General_Category, its Canonical_Combining_Class and its
 * canonical decomposition mapping (none for a compatibility one)
 * @param {string} path
 * @returns {Array<{codePoint: number, generalCategory: string, combiningClass: number, decomposition: number[]|null}>}
 */
function readCharacters(path) {
    return readDataLines(path).map(fields => ({
        codePoint: parseInt(fields[0], 16),
        generalCategory: fields[2],
        combiningClass: parseInt(fields[3], 10),
        decomposition: fields[5] && !fields[5].startsWith('<') ? fields[5].split(' ').map(value => parseInt(value, 16)) : null
    }));
}

/**
 * The code points of the Full_Composition_Exclusion property of DerivedNormalizationProps.txt
 * @param {string} path
 * @returns {Set<number>}
 */
function readCompositionExclusions(path) {
    const exclusions = new Set();
    for (const [codePoints, property] of readDataLines(path)) {
        if (property === 'Full_Composition_Exclusion') {
            const [start, end] = codePoints.split('..').map(codePoint => parseInt(codePoint, 16));
            for (let codePoint = start; codePoint <= (end === undefined ? start : end); codePoint++) {
                exclusions.add(codePoint);
            }
        }
    }
    return exclusions;
}

/**
 * The modified combining class of HarfBuzz of a character (hb_unicode_funcs_t::modified_combining_class), which
 * HarfBuzz keeps for the marks only (_hb_glyph_info_set_unicode_props): 0 for a character that is not a mark
 * @param {{codePoint: number, generalCategory: string, combiningClass: number}} character
 * @returns {number}
 */
function getModifiedCombiningClass({ codePoint, generalCategory, combiningClass }) {
    if (!generalCategory.startsWith('M')) {
        return 0;
    }
    if (MODIFIED_COMBINING_CLASS_CODE_POINTS.has(codePoint)) {
        return MODIFIED_COMBINING_CLASS_CODE_POINTS.get(codePoint);
    }
    return MODIFIED_COMBINING_CLASSES.has(combiningClass) ? MODIFIED_COMBINING_CLASSES.get(combiningClass) : combiningClass;
}

/**
 * The ranges of consecutive code points of the same modified combining class other than 0, each one as the distance
 * in code points from the start of the range before it, its number of code points minus one, then its class, in base 36
 * @param {Array<{codePoint: number, generalCategory: string, combiningClass: number}>} characters
 * @returns {string}
 */
function encodeModifiedCombiningClassRanges(characters) {
    const ranges = [];
    for (const character of characters) {
        const combiningClass = getModifiedCombiningClass(character);
        if (combiningClass === 0) {
            continue;
        }
        const lastRange = ranges[ranges.length - 1];
        if (lastRange && lastRange.end + 1 === character.codePoint && lastRange.combiningClass === combiningClass) {
            lastRange.end = character.codePoint;
        } else {
            ranges.push({ start: character.codePoint, end: character.codePoint, combiningClass });
        }
    }
    let previousStart = 0;
    return ranges.map(({ start, end, combiningClass }) => {
        const encodedRange = [start - previousStart, end - start, combiningClass].map(value => value.toString(36)).join(':');
        previousStart = start;
        return encodedRange;
    }).join(',');
}

/**
 * The canonical decompositions of two characters whose first character is itself decomposed and excluded from
 * composition (e.g. U+FB2C HEBREW LETTER SHIN WITH DAGESH AND SHIN DOT to U+FB49 U+05C1), the decompositions whose
 * first character String.prototype.normalize cannot give: each one as the code point and the code point of its first
 * character, in hexadecimal
 * @param {Array<{codePoint: number, decomposition: number[]|null}>} characters
 * @param {Set<number>} exclusions
 * @returns {string}
 */
function encodeDecompositionFirstCharacters(characters, exclusions) {
    const decomposedCodePoints = new Set(characters.filter(({ decomposition }) => decomposition).map(({ codePoint }) => codePoint));
    return characters
        .filter(({ decomposition }) => decomposition && decomposition.length === 2 &&
            decomposedCodePoints.has(decomposition[0]) && exclusions.has(decomposition[0]))
        .map(({ codePoint, decomposition }) => `${codePoint.toString(16)}:${decomposition[0].toString(16)}`)
        .join(',');
}

function main() {
    const [unicodeDataPath, normalizationPropsPath] = process.argv.slice(2);
    const versionLine = readFileSync(normalizationPropsPath, 'utf8').split('\n')[0].replace(/^#\s*/, '');
    const characters = readCharacters(unicodeDataPath);
    const exclusions = readCompositionExclusions(normalizationPropsPath);
    process.stdout.write([
        '// The data of the Unicode normalization of HarfBuzz 11.3.2 that String.prototype.normalize does not give, from',
        `// UnicodeData.txt and ${versionLine} (Unicode Character Database).`,
        '// Generated by bin/generate-unicode-normalization.mjs, do not edit.',
        '',
        '// the ranges of code points of a modified combining class of HarfBuzz other than 0 (the Canonical_Combining_Class',
        '// of the marks, with the classes HarfBuzz modifies), each one as the distance in code points from the start of the',
        '// range before it, its number of code points minus one, then its class, all in base 36',
        `export const MODIFIED_COMBINING_CLASS_RANGES = '${encodeModifiedCombiningClassRanges(characters)}';`,
        '',
        '// the canonical decompositions of two characters whose first character is decomposed and excluded from',
        '// composition, which String.prototype.normalize cannot give: each one as the code point, then the code point of',
        '// its first character, in hexadecimal',
        `export const DECOMPOSITION_FIRST_CHARACTERS = '${encodeDecompositionFirstCharacters(characters, exclusions)}';`,
        ''
    ].join('\n'));
}

main();
