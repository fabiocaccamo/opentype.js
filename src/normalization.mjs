// The Unicode normalization of a text before GSUB, like _hb_ot_shape_normalize of HarfBuzz (hb-ot-shape-normalize.cc
// of HarfBuzz 11.3.2): the characters become the glyphs of the cmap, a character the font has not decomposed into the
// characters the font has, the marks put in order, a base and a mark composed into the precomposed character of the font

import {
    getCanonicalComposition, getCanonicalDecomposition, getDefaultIgnorableType, getModifiedCombiningClass,
    getSpaceFallbackType, isUnicodeMark, isVariationSelector, DEFAULT_IGNORABLE_TYPES, SPACE_TYPES
} from './char.mjs';
import { HarfBuzzShaper } from './layout.mjs';

// the longest sequence of marks HarfBuzz puts in order (HB_OT_SHAPE_MAX_COMBINING_MARKS, hb-ot-shaper.hh)
const MAX_COMBINING_MARKS = 32;

// the modifier combining marks of the Arabic shaper of HarfBuzz (modifier_combining_marks, hb-ot-shaper-arabic.cc),
// from Unicode Standard Annex #53
const ARABIC_MODIFIER_COMBINING_MARKS = new Set([
    0x0654, 0x0655, 0x0658, 0x06DC, 0x06E3, 0x06E7, 0x06E8, 0x08CA, 0x08CB, 0x08CD, 0x08CE, 0x08CF, 0x08D3, 0x08F3
]);

// the modified combining classes the Arabic shaper of HarfBuzz gives the modifier combining marks it moves before the
// other marks, below (220) and above (230): HB_MODIFIED_COMBINING_CLASS_CCC22 and HB_MODIFIED_COMBINING_CLASS_CCC26
const ARABIC_MOVED_MARK_COMBINING_CLASSES = new Map([[220, 25], [230, 26]]);

// the default ignorable that HarfBuzz no longer hides in a sequence of marks it did not keep from being reordered
const COMBINING_GRAPHEME_JOINER = '\u{34F}';

// the characters the Indic shaper of HarfBuzz does not decompose (decompose_indic, hb-ot-shaper-indic.cc): U+0931
// DEVANAGARI LETTER RRA, U+09DC BENGALI LETTER RRA, U+09DD BENGALI LETTER RHA, U+0B94 TAMIL LETTER AU
const INDIC_UNDECOMPOSED_CHARACTERS = ['\u{931}', '\u{9DC}', '\u{9DD}', '\u{B94}'];

// the Hebrew letters without a presentation form with dagesh: het, final mem, final nun, ayin, final tsadi
const HEBREW_LETTERS_WITHOUT_DAGESH_FORM = [0x05D7, 0x05DD, 0x05DF, 0x05E2, 0x05E5];

// the Hebrew presentation forms that the Hebrew shaper of HarfBuzz composes in a font without a mark feature, which
// Unicode excludes from composition (compose_hebrew, hb-ot-shaper-hebrew.cc), by their two chars
const HEBREW_PRESENTATION_FORMS = new Map([
    // the letters with dagesh (U+05BC), U+FB30 to U+FB4A
    ...Array.from({ length: 0x05EA - 0x05D0 + 1 }, (value, index) => [0x05D0 + index, 0x05BC, 0xFB30 + index])
        .filter(([letter]) => !HEBREW_LETTERS_WITHOUT_DAGESH_FORM.includes(letter)),
    [0xFB2A, 0x05BC, 0xFB2C], [0xFB2B, 0x05BC, 0xFB2D],
    // hiriq, patah, qamats, holam
    [0x05D9, 0x05B4, 0xFB1D], [0x05F2, 0x05B7, 0xFB1F], [0x05D0, 0x05B7, 0xFB2E], [0x05D0, 0x05B8, 0xFB2F],
    [0x05D5, 0x05B9, 0xFB4B],
    // rafe
    [0x05D1, 0x05BF, 0xFB4C], [0x05DB, 0x05BF, 0xFB4D], [0x05E4, 0x05BF, 0xFB4E],
    // shin dot and sin dot
    [0x05E9, 0x05C1, 0xFB2A], [0xFB49, 0x05C1, 0xFB2C], [0x05E9, 0x05C2, 0xFB2B], [0xFB49, 0x05C2, 0xFB2D]
].map(([firstCodePoint, secondCodePoint, composedCodePoint]) => [
    String.fromCodePoint(firstCodePoint, secondCodePoint), String.fromCodePoint(composedCodePoint)
]));

/**
 * The normalization modes of the shapers of HarfBuzz (hb_ot_shape_normalization_mode_t, hb-ot-shape-normalize.hh)
 * @readonly
 * @enum {string}
 */
const NormalizationMode = Object.freeze({
    // the characters the font has kept as they are, no composition (the Hangul shaper)
    NONE: 'none',
    // the characters the font has kept as they are, but before a mark, then composed (the default shaper)
    COMPOSED_DIACRITICS: 'composedDiacritics',
    // the characters decomposed even when the font has them, then composed (the Indic, Khmer, Myanmar and USE shapers)
    COMPOSED_DIACRITICS_NO_SHORT_CIRCUIT: 'composedDiacriticsNoShortCircuit'
});

/**
 * The normalization of a shaper of HarfBuzz (see getShaperNormalization)
 * @typedef ShaperNormalization
 * @type Object
 * @property {NormalizationMode} mode
 * @property {function(string): string[]|null} decompose its decompose hook: the one or two chars a char decomposes
 * into, null for none (see getCanonicalDecomposition in char.mjs)
 * @property {function(string, string): string|null} compose its compose hook: the char two chars compose into, null
 * for none (see getCanonicalComposition in char.mjs)
 * @property {function|null} reorderMarks its reorder_marks hook (see reorderMarks)
 */

/**
 * A character of a text before the normalization
 * @typedef TextCharacter
 * @type Object
 * @property {string} char a single character (a code point)
 * @property {number} cluster the UTF-16 offset of the character in the text
 */

/**
 * A character of a text after the normalization, with its glyph
 * @typedef NormalizedCharacter
 * @type Object
 * @property {string} char a single character (a code point)
 * @property {number} cluster the UTF-16 offset of the first character of its cluster in the text, like the clusters of
 * HarfBuzz: the characters of a decomposition have the cluster of the decomposed character, a composed character the
 * clusters of its characters merged
 * @property {number|null} glyphIndex its glyph: the glyph of the cmap (see Font.charToGlyphIndex), the glyph of U+0020
 * SPACE for a space the font has not, of U+2010 HYPHEN for U+2011 NON-BREAKING HYPHEN the font has not (see
 * decomposeCharacter), otherwise the glyph index of the cmap of the character, .notdef
 * @property {number} spaceFallbackType the space type of the glyph of U+0020 that draws a space the font has not (see
 * getSpaceFallbackType in char.mjs), NOT_SPACE for the other glyphs
 * @property {number} combiningClass the modified combining class of the character (see getModifiedCombiningClass in
 * char.mjs), the one the Arabic shaper gives a mark it moves
 * @property {number} defaultIgnorableType the kind of default ignorable of the character (see getDefaultIgnorableType
 * in char.mjs), which tells the lookups that skip its glyph; a U+034F COMBINING GRAPHEME JOINER that HarfBuzz unhides is
 * IGNORABLE (see unhideCombiningGraphemeJoiners)
 */

/**
 * A normalized character of a text
 * @param {string} char
 * @param {number} cluster
 * @param {number|null} glyphIndex
 * @param {number} spaceFallbackType
 * @returns {NormalizedCharacter}
 */
function createNormalizedCharacter(char, cluster, glyphIndex, spaceFallbackType) {
    return {
        char,
        cluster,
        glyphIndex,
        spaceFallbackType,
        combiningClass: getModifiedCombiningClass(char),
        defaultIgnorableType: getDefaultIgnorableType(char)
    };
}

/**
 * Whether a glyph index of the cmap is a glyph of the font, like the get_nominal_glyph of HarfBuzz
 * @param {number|null} glyphIndex
 * @returns {boolean}
 */
function isFontGlyph(glyphIndex) {
    return glyphIndex > 0;
}

/**
 * The decomposition of a char with the Indic shaper of HarfBuzz (decompose_indic): its canonical decomposition, but
 * for the chars it keeps (see INDIC_UNDECOMPOSED_CHARACTERS)
 * @param {string} char
 * @returns {string[]|null}
 */
function getIndicDecomposition(char) {
    return INDIC_UNDECOMPOSED_CHARACTERS.includes(char) ? null : getCanonicalDecomposition(char);
}

/**
 * The composition of two chars with the USE and Khmer shapers of HarfBuzz (compose_use, compose_khmer): their canonical
 * composition, none when the first char is a mark, so that the parts of a split vowel sign stay apart (e.g. U+0BC6 and
 * U+0BBE, not U+0BCA)
 * @param {string} firstChar
 * @param {string} secondChar
 * @returns {string|null}
 */
function getBaseComposition(firstChar, secondChar) {
    return isUnicodeMark(firstChar) ? null : getCanonicalComposition(firstChar, secondChar);
}

/**
 * The composition of two chars with the Indic shaper of HarfBuzz (compose_indic): the one of getBaseComposition, and
 * U+09AF BENGALI LETTER YA and U+09BC BENGALI SIGN NUKTA into U+09DF BENGALI LETTER YYA, which Unicode excludes from
 * composition
 * @param {string} firstChar
 * @param {string} secondChar
 * @returns {string|null}
 */
function getIndicComposition(firstChar, secondChar) {
    if (firstChar === '\u{9AF}' && secondChar === '\u{9BC}') {
        return '\u{9DF}';
    }
    return getBaseComposition(firstChar, secondChar);
}

/**
 * The composition of two chars with the Hebrew shaper of HarfBuzz in a run without the mark feature in its feature map
 * (compose_hebrew):
 * their canonical composition, otherwise their Hebrew presentation form (see HEBREW_PRESENTATION_FORMS)
 * @param {string} firstChar
 * @param {string} secondChar
 * @returns {string|null}
 */
function getHebrewPresentationFormComposition(firstChar, secondChar) {
    return getCanonicalComposition(firstChar, secondChar) || HEBREW_PRESENTATION_FORMS.get(firstChar + secondChar) || null;
}

/**
 * The normalization of a shaper of HarfBuzz: its mode (normalization_preference) and its decompose, compose and
 * reorder_marks hooks, the Unicode ones when it has none. The Khmer shaper is without its decompose_khmer, which
 * decomposes a split vowel sign into U+17C1 and itself that only its reordering and its pref, abvf and pstf features
 * merge again, and the fork has neither of them
 * @param {HarfBuzzShaper} shaper see getHarfBuzzShaper in layout.mjs
 * @param {boolean} hasMarkFeature whether the mark feature is in the feature map of the run (the has_gpos_mark of
 * HarfBuzz, see hasMarkFeature in font.mjs: mark 256 keeps it), which turns the Hebrew presentation forms off
 * @returns {ShaperNormalization}
 */
function getShaperNormalization(shaper, hasMarkFeature) {
    const defaultNormalization = {
        mode: NormalizationMode.COMPOSED_DIACRITICS,
        decompose: getCanonicalDecomposition,
        compose: getCanonicalComposition,
        reorderMarks: null
    };
    const noShortCircuitNormalization = { ...defaultNormalization, mode: NormalizationMode.COMPOSED_DIACRITICS_NO_SHORT_CIRCUIT };
    switch (shaper) {
        case HarfBuzzShaper.DEFAULT:
        case HarfBuzzShaper.THAI:
            return defaultNormalization;
        case HarfBuzzShaper.ARABIC:
            return { ...defaultNormalization, reorderMarks: reorderArabicMarks };
        case HarfBuzzShaper.HEBREW:
            return { ...defaultNormalization, compose: hasMarkFeature ? getCanonicalComposition : getHebrewPresentationFormComposition };
        case HarfBuzzShaper.HANGUL:
            return { ...defaultNormalization, mode: NormalizationMode.NONE };
        case HarfBuzzShaper.INDIC:
            return { ...noShortCircuitNormalization, decompose: getIndicDecomposition, compose: getIndicComposition };
        case HarfBuzzShaper.MYANMAR:
            return noShortCircuitNormalization;
        case HarfBuzzShaper.KHMER:
        case HarfBuzzShaper.USE:
            return { ...noShortCircuitNormalization, compose: getBaseComposition };
        default:
            throw new Error(`Unknown shaper ${shaper}`);
    }
}

/**
 * The characters a character decomposes into, with their glyphs, like decompose of HarfBuzz: the decomposition of the
 * character when the font has the glyph of its second character; its first character decomposed again (unless shortest
 * and the font has its glyph), or as it is when the font has its glyph
 * @param {Font} font
 * @param {string} char
 * @param {boolean} shortest whether to keep the first character the font has rather than decompose it again
 * @param {function(string): string[]|null} decompose the decompose hook of the shaper (see ShaperNormalization)
 * @returns {Array<{char: string, glyphIndex: number}>|null} null when the character does not decompose into
 * characters the font has
 */
function getGlyphDecomposition(font, char, shortest, decompose) {
    const decomposition = decompose(char);
    if (!decomposition) {
        return null;
    }
    const [firstChar, secondChar] = decomposition;
    const secondCharacters = [];
    if (secondChar !== undefined) {
        const secondGlyphIndex = font.charToGlyphIndex(secondChar);
        if (!isFontGlyph(secondGlyphIndex)) {
            return null;
        }
        secondCharacters.push({ char: secondChar, glyphIndex: secondGlyphIndex });
    }
    const firstGlyphIndex = font.charToGlyphIndex(firstChar);
    const firstCharacters = [{ char: firstChar, glyphIndex: firstGlyphIndex }];
    if (shortest && isFontGlyph(firstGlyphIndex)) {
        return firstCharacters.concat(secondCharacters);
    }
    const firstDecomposition = getGlyphDecomposition(font, firstChar, shortest, decompose);
    if (firstDecomposition) {
        return firstDecomposition.concat(secondCharacters);
    }
    return isFontGlyph(firstGlyphIndex) ? firstCharacters.concat(secondCharacters) : null;
}

/**
 * Map a character to its glyph, or to the glyphs of its decomposition, like decompose_current_character of HarfBuzz:
 * the glyph of the cmap (when shortest, before its decomposition); the decomposition into characters the font has (see
 * getGlyphDecomposition); the glyph of the cmap; for a space the font has not that can use the glyph of U+0020 SPACE
 * (see getSpaceFallbackType in char.mjs), the glyph of U+0020, whose advance is then the one of the space type (see
 * getDefaultGlyphAdvance in position.mjs); for U+2011 NON-BREAKING HYPHEN the font has not, the glyph of U+2010 HYPHEN;
 * otherwise the glyph index of the cmap, .notdef
 * @param {Font} font
 * @param {TextCharacter} character
 * @param {boolean} shortest whether to keep a character the font has as it is, and the first character of a
 * decomposition the font has (see getGlyphDecomposition)
 * @param {function(string): string[]|null} decompose the decompose hook of the shaper (see ShaperNormalization)
 * @param {NormalizedCharacter[]} normalizedCharacters the characters the character is added to
 */
function decomposeCharacter(font, character, shortest, decompose, normalizedCharacters) {
    const { char, cluster } = character;
    const glyphIndex = font.charToGlyphIndex(char);
    const addCharacter = (outputChar, outputGlyphIndex, spaceFallbackType = SPACE_TYPES.NOT_SPACE) => {
        normalizedCharacters.push(createNormalizedCharacter(outputChar, cluster, outputGlyphIndex, spaceFallbackType));
    };
    if (shortest && isFontGlyph(glyphIndex)) {
        addCharacter(char, glyphIndex);
        return;
    }
    const decomposition = getGlyphDecomposition(font, char, shortest, decompose);
    if (decomposition) {
        for (const decomposedCharacter of decomposition) {
            addCharacter(decomposedCharacter.char, decomposedCharacter.glyphIndex);
        }
        return;
    }
    if (isFontGlyph(glyphIndex)) {
        addCharacter(char, glyphIndex);
        return;
    }
    const spaceFallbackType = getSpaceFallbackType(char);
    if (spaceFallbackType !== SPACE_TYPES.NOT_SPACE) {
        const spaceGlyphIndex = font.charToGlyphIndex(' ');
        if (isFontGlyph(spaceGlyphIndex)) {
            addCharacter(char, spaceGlyphIndex, spaceFallbackType);
            return;
        }
    }
    if (char === '\u{2011}') {
        const hyphenGlyphIndex = font.charToGlyphIndex('\u{2010}');
        if (isFontGlyph(hyphenGlyphIndex)) {
            addCharacter(char, hyphenGlyphIndex);
            return;
        }
    }
    addCharacter(char, glyphIndex);
}

/**
 * Check if a code point is in the ranges of a default UVS table of the cmap format 14, sorted by their first code
 * point, with a binary search like HarfBuzz (DefaultUVS bfind)
 * @param {Array<{startUnicodeValue: number, additionalCount: number}>} ranges
 * @param {number} codePoint
 * @returns {boolean}
 */
function isInDefaultVariationRanges(ranges, codePoint) {
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        const range = ranges[middle];
        if (codePoint < range.startUnicodeValue) {
            high = middle - 1;
        } else if (codePoint > range.startUnicodeValue + range.additionalCount) {
            low = middle + 1;
        } else {
            return true;
        }
    }
    return false;
}

/**
 * The glyph of a variation sequence in the cmap format 14, like get_variation_glyph of HarfBuzz: the glyph of the
 * character (see Font.charToGlyphIndex) for a default variation sequence (in the default UVS table of the selector),
 * the glyph of a non default variation sequence, otherwise none
 * @param {Font} font
 * @param {string} char
 * @param {string} selector the variation selector after the character (see isVariationSelector in char.mjs)
 * @returns {number} 0 when the cmap has no such variation sequence, or the font no glyph for its default one
 */
function getVariationGlyphIndex(font, char, selector) {
    const cmap = font.tables.cmap;
    const selectorRecord = cmap && cmap.varSelectorList && cmap.varSelectorList[selector.codePointAt(0)];
    if (!selectorRecord) {
        return 0;
    }
    const codePoint = char.codePointAt(0);
    if (selectorRecord.defaultUVS && isInDefaultVariationRanges(selectorRecord.defaultUVS.ranges, codePoint)) {
        const glyphIndex = font.charToGlyphIndex(char);
        return isFontGlyph(glyphIndex) ? glyphIndex : 0;
    }
    const mapping = selectorRecord.nonDefaultUVS && selectorRecord.nonDefaultUVS.uvsMappings[codePoint];
    return mapping ? mapping.glyphID : 0;
}

/**
 * Map the characters of a cluster with a variation selector (see isVariationSelector in char.mjs) to their glyphs,
 * like handle_variation_selector_cluster of HarfBuzz, without decomposition nor the fallbacks of the spaces: a
 * character followed by a selector takes the glyph of their variation sequence (see getVariationGlyphIndex) and the
 * selector is consumed, in the cluster of the character; otherwise the character and the selector keep the glyphs of
 * the cmap, the selector a glyph of its own (a default ignorable, which Font.shape hides), and so do the selectors after
 * them
 * @param {Font} font
 * @param {TextCharacter[]} clusterCharacters
 * @param {NormalizedCharacter[]} normalizedCharacters the characters the cluster is added to
 */
function mapVariationSelectorCluster(font, clusterCharacters, normalizedCharacters) {
    const addCmapCharacter = ({ char, cluster }) => {
        normalizedCharacters.push(createNormalizedCharacter(char, cluster, font.charToGlyphIndex(char), SPACE_TYPES.NOT_SPACE));
    };
    let index = 0;
    while (index < clusterCharacters.length) {
        const character = clusterCharacters[index];
        const selector = clusterCharacters[index + 1];
        if (!selector || !isVariationSelector(selector.char)) {
            addCmapCharacter(character);
            index++;
            continue;
        }
        const variationGlyphIndex = getVariationGlyphIndex(font, character.char, selector.char);
        if (variationGlyphIndex) {
            normalizedCharacters.push(createNormalizedCharacter(character.char, character.cluster, variationGlyphIndex, SPACE_TYPES.NOT_SPACE));
        } else {
            addCmapCharacter(character);
            addCmapCharacter(selector);
        }
        index += 2;
        while (index < clusterCharacters.length && isVariationSelector(clusterCharacters[index].char)) {
            addCmapCharacter(clusterCharacters[index]);
            index++;
        }
    }
}

/**
 * Map the characters of a cluster of a base and its marks to their glyphs, like decompose_multi_char_cluster of
 * HarfBuzz: each character decomposed (see decomposeCharacter), not the shortest way but in the NONE mode, so that the
 * marks of the precomposed characters can be put in order with the marks after them; a cluster with a variation
 * selector with the glyphs of the cmap and of its variation sequences (see mapVariationSelectorCluster)
 * @param {Font} font
 * @param {TextCharacter[]} clusterCharacters
 * @param {boolean} shortest whether to decompose the characters the shortest way, the always_short_circuit of HarfBuzz
 * @param {function(string): string[]|null} decompose the decompose hook of the shaper (see ShaperNormalization)
 * @param {NormalizedCharacter[]} normalizedCharacters the characters the cluster is added to
 */
function decomposeMarkCluster(font, clusterCharacters, shortest, decompose, normalizedCharacters) {
    if (clusterCharacters.some(character => isVariationSelector(character.char))) {
        mapVariationSelectorCluster(font, clusterCharacters, normalizedCharacters);
        return;
    }
    for (const character of clusterCharacters) {
        decomposeCharacter(font, character, shortest, decompose, normalizedCharacters);
    }
}

/**
 * The first round of the normalization of HarfBuzz, decompose: the characters not followed by a mark (the simple
 * clusters of HarfBuzz) the shortest way, but in the COMPOSED_DIACRITICS_NO_SHORT_CIRCUIT mode (see
 * decomposeCharacter), and each base with the marks after it with decomposeMarkCluster
 * @param {Font} font
 * @param {TextCharacter[]} characters
 * @param {ShaperNormalization} normalization
 * @returns {{normalizedCharacters: NormalizedCharacter[], hasMarks: boolean}} hasMarks false when no character is
 * a mark (but the first one), the all_simple of HarfBuzz, which then skips the other rounds
 */
function decomposeCharacters(font, characters, normalization) {
    const { mode, decompose } = normalization;
    const alwaysShortest = mode === NormalizationMode.NONE;
    const mightBeShortest = mode !== NormalizationMode.COMPOSED_DIACRITICS_NO_SHORT_CIRCUIT;
    const normalizedCharacters = [];
    let hasMarks = false;
    let index = 0;
    while (index < characters.length) {
        let end = index + 1;
        while (end < characters.length && !isUnicodeMark(characters[end].char)) {
            end++;
        }
        // the base of the marks goes with them
        if (end < characters.length) {
            end--;
        }
        for (; index < end; index++) {
            decomposeCharacter(font, characters[index], mightBeShortest, decompose, normalizedCharacters);
        }
        if (index === characters.length) {
            break;
        }
        hasMarks = true;
        end = index + 1;
        while (end < characters.length && isUnicodeMark(characters[end].char)) {
            end++;
        }
        decomposeMarkCluster(font, characters.slice(index, end), alwaysShortest, decompose, normalizedCharacters);
        index = end;
    }
    return { normalizedCharacters, hasMarks };
}

/**
 * Merge the clusters of a range of characters, like merge_clusters of HarfBuzz: the characters of the range, and the
 * characters after it in the cluster of its last character, take the cluster of its first character. The clusters of
 * the characters of a run never decrease, so the first character of a range has its smallest cluster.
 * @param {NormalizedCharacter[]} characters
 * @param {number} start
 * @param {number} end the index after the last character of the range
 */
function mergeClusters(characters, start, end) {
    if (end - start < 2) {
        return;
    }
    const { cluster } = characters[start];
    const lastCluster = characters[end - 1].cluster;
    while (end < characters.length && characters[end].cluster === lastCluster) {
        end++;
    }
    for (let i = start; i < end; i++) {
        characters[i].cluster = cluster;
    }
}

/**
 * Move a range of characters before the characters from a position before it, in place, like the memmove of HarfBuzz:
 * the cost is the length of the range and of the characters it moves before, not the length of the text
 * @param {NormalizedCharacter[]} characters
 * @param {number} start the index of the first character to move
 * @param {number} end the index after the last character to move
 * @param {number} position the index the first character moves to, not after start
 * @returns {NormalizedCharacter[]} the moved characters
 */
function moveCharactersBefore(characters, start, end, position) {
    const movedCharacters = characters.slice(start, end);
    characters.copyWithin(position + movedCharacters.length, position, start);
    for (let i = 0; i < movedCharacters.length; i++) {
        characters[position + i] = movedCharacters[i];
    }
    return movedCharacters;
}

/**
 * Sort a sequence of marks by their modified combining class, stable, like hb_buffer_t::sort of HarfBuzz: a mark moved
 * before other marks merges their clusters
 * @param {NormalizedCharacter[]} characters
 * @param {number} start
 * @param {number} end the index after the last mark
 */
function sortMarks(characters, start, end) {
    for (let i = start + 1; i < end; i++) {
        let position = i;
        while (position > start && characters[position - 1].combiningClass > characters[i].combiningClass) {
            position--;
        }
        if (position === i) {
            continue;
        }
        mergeClusters(characters, position, i + 1);
        moveCharactersBefore(characters, i, i + 1, position);
    }
}

/**
 * Move the modifier combining marks of a sequence of Arabic marks (sorted by sortMarks) before the other marks, like
 * reorder_marks_arabic of HarfBuzz (Unicode Standard Annex #53): the ones below (220), then the ones above (230), each
 * moved sequence merging the clusters of the marks before it and taking the modified combining class 25 or 26
 * @param {NormalizedCharacter[]} characters
 * @param {number} start
 * @param {number} end the index after the last mark
 */
function reorderArabicMarks(characters, start, end) {
    let index = start;
    for (const [combiningClass, movedCombiningClass] of ARABIC_MOVED_MARK_COMBINING_CLASSES) {
        while (index < end && characters[index].combiningClass < combiningClass) {
            index++;
        }
        if (index === end) {
            break;
        }
        if (characters[index].combiningClass > combiningClass) {
            continue;
        }
        let modifierEnd = index;
        while (modifierEnd < end && characters[modifierEnd].combiningClass === combiningClass &&
            ARABIC_MODIFIER_COMBINING_MARKS.has(characters[modifierEnd].char.codePointAt(0))) {
            modifierEnd++;
        }
        if (modifierEnd === index) {
            continue;
        }
        mergeClusters(characters, start, modifierEnd);
        const modifierMarks = moveCharactersBefore(characters, index, modifierEnd, start);
        for (const modifierMark of modifierMarks) {
            modifierMark.combiningClass = movedCombiningClass;
        }
        start += modifierMarks.length;
        index = modifierEnd;
    }
}

/**
 * The second round of the normalization of HarfBuzz, reorder: each sequence of marks of a modified combining class
 * other than 0 sorted by class (see sortMarks), unless it is longer than 32 marks, then reordered by the shaper
 * @param {NormalizedCharacter[]} characters
 * @param {function|null} reorderShaperMarks the reorder_marks hook of the shaper (see ShaperNormalization)
 */
function reorderMarks(characters, reorderShaperMarks) {
    for (let i = 0; i < characters.length; i++) {
        if (characters[i].combiningClass === 0) {
            continue;
        }
        let end = i + 1;
        while (end < characters.length && characters[end].combiningClass !== 0) {
            end++;
        }
        if (end - i <= MAX_COMBINING_MARKS) {
            sortMarks(characters, i, end);
            if (reorderShaperMarks) {
                reorderShaperMarks(characters, i, end);
            }
        }
        i = end;
    }
}

/**
 * Unhide each U+034F COMBINING GRAPHEME JOINER that kept no mark from being reordered, like HarfBuzz after its reorder
 * round (https://github.com/harfbuzz/harfbuzz/issues/554): one between two characters, the one after it of the modified
 * combining class 0 or of a class not lower than the one before it, becomes a default ignorable that the GSUB lookups
 * skip (IGNORABLE, see DEFAULT_IGNORABLE_TYPES in char.mjs)
 * @param {NormalizedCharacter[]} characters
 */
function unhideCombiningGraphemeJoiners(characters) {
    for (let i = 1; i + 1 < characters.length; i++) {
        const nextCombiningClass = characters[i + 1].combiningClass;
        if (characters[i].char === COMBINING_GRAPHEME_JOINER &&
            (nextCombiningClass === 0 || characters[i - 1].combiningClass <= nextCombiningClass)) {
            characters[i].defaultIgnorableType = DEFAULT_IGNORABLE_TYPES.IGNORABLE;
        }
    }
}

/**
 * Merge the clusters of a composed character and the mark composed with it, like merge_out_clusters of HarfBuzz
 * (from the composed character to the mark, which is the last of the composed characters): the characters of the
 * range, and the characters still to compose in the cluster of the mark, take the cluster of the composed character,
 * the smallest one (see mergeClusters)
 * @param {NormalizedCharacter[]} composedCharacters the characters composed so far, the mark last
 * @param {number} start the index of the composed character
 * @param {NormalizedCharacter[]} characters the characters to compose
 * @param {number} nextIndex the index of the character after the mark in characters
 */
function mergeComposedClusters(composedCharacters, start, characters, nextIndex) {
    const { cluster } = composedCharacters[start];
    const markCluster = composedCharacters[composedCharacters.length - 1].cluster;
    for (let i = nextIndex; i < characters.length && characters[i].cluster === markCluster; i++) {
        characters[i].cluster = cluster;
    }
    for (let i = start; i < composedCharacters.length; i++) {
        composedCharacters[i].cluster = cluster;
    }
}

/**
 * The third round of the normalization of HarfBuzz, recompose: a mark composes with the last starter before it (a
 * character of modified combining class 0) into the character the compose hook of the shaper gives (e.g. their
 * primary composite, see getCanonicalComposition in char.mjs) when the font has its glyph, unless a character between
 * them has a modified combining class not lower than the mark (it is blocked); a character that is not a mark never
 * composes with the starter before it
 * @param {Font} font
 * @param {NormalizedCharacter[]} characters
 * @param {function(string, string): string|null} compose the compose hook of the shaper (see ShaperNormalization)
 * @returns {NormalizedCharacter[]}
 */
function composeCharacters(font, characters, compose) {
    const composedCharacters = characters.slice(0, 1);
    let starter = 0;
    for (let index = 1; index < characters.length; index++) {
        const character = characters[index];
        if (isUnicodeMark(character.char)) {
            const previousCharacter = composedCharacters[composedCharacters.length - 1];
            const isBlocked = starter !== composedCharacters.length - 1 && previousCharacter.combiningClass >= character.combiningClass;
            const composedChar = isBlocked ? null : compose(composedCharacters[starter].char, character.char);
            const glyphIndex = composedChar === null ? 0 : font.charToGlyphIndex(composedChar);
            if (isFontGlyph(glyphIndex)) {
                composedCharacters.push(character);
                mergeComposedClusters(composedCharacters, starter, characters, index + 1);
                composedCharacters.pop();
                const { cluster } = composedCharacters[starter];
                composedCharacters[starter] = createNormalizedCharacter(composedChar, cluster, glyphIndex, SPACE_TYPES.NOT_SPACE);
                continue;
            }
        }
        composedCharacters.push(character);
        if (character.combiningClass === 0) {
            starter = composedCharacters.length - 1;
        }
    }
    return composedCharacters;
}

/**
 * Normalize the characters of a script run and map them to their glyphs, like _hb_ot_shape_normalize of HarfBuzz with
 * the shaper of the run (see getShaperNormalization): decompose (see decomposeCharacters), then, when the text has
 * marks, put the marks in order (see reorderMarks), unhide the combining grapheme joiners that kept no mark from being
 * reordered (see unhideCombiningGraphemeJoiners) and compose (see composeCharacters), but in the NONE mode of the
 * Hangul shaper. A text without marks only takes the glyphs of the cmap (but in the COMPOSED_DIACRITICS_NO_SHORT_CIRCUIT
 * mode), the decompositions of the characters the font has not and the fallbacks of the spaces and of U+2011.
 * Not yet the preprocessing of the Thai shaper of HarfBuzz (the decomposition of sara am, preprocess_text_thai) nor of
 * its Hangul shaper (the jamo and the syllables composed and decomposed by the glyphs of the font, the tone marks,
 * preprocess_text_hangul), the U+25CC DOTTED CIRCLE its Indic and USE shapers insert between an independent vowel and
 * a vowel sign that must not follow it (preprocess_text_vowel_constraints), the reorder_marks hook of its Hebrew shaper
 * (a meteg or a mark below after a patah or a qamats), the decomposition of the Khmer split vowel signs of its Khmer
 * shaper (see getShaperNormalization).
 * @param {Font} font
 * @param {TextCharacter[]} characters the characters of the run, in the order of the text
 * @param {HarfBuzzShaper} shaper the shaper of HarfBuzz of the run (see getHarfBuzzShaper in layout.mjs)
 * @param {boolean} hasMarkFeature whether the mark feature is in the feature map of the run (see
 * getShaperNormalization)
 * @returns {NormalizedCharacter[]} the characters of the run after the normalization, with their glyphs and clusters
 */
function normalizeCharacters(font, characters, shaper, hasMarkFeature) {
    const normalization = getShaperNormalization(shaper, hasMarkFeature);
    const { normalizedCharacters, hasMarks } = decomposeCharacters(font, characters, normalization);
    if (!hasMarks) {
        return normalizedCharacters;
    }
    reorderMarks(normalizedCharacters, normalization.reorderMarks);
    unhideCombiningGraphemeJoiners(normalizedCharacters);
    if (normalization.mode === NormalizationMode.NONE) {
        return normalizedCharacters;
    }
    return composeCharacters(font, normalizedCharacters, normalization.compose);
}

export { normalizeCharacters };
