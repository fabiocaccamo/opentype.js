/**
 * Clusters of texts with characters outside the BMP (surrogate pairs), variation selectors
 * and emoji sequences. No upstream issue or PR: the case comes from a fix of the opengraphica
 * fork (opengraphica/opentype.js 96127b0, "Handle utf-16 characters in getTextGlyphMapping"),
 * whose glyph mapping counted tokens instead of UTF-16 units.
 *
 * Mechanism: stringToGlyphClusters gives each glyph the UTF-16 range of its characters. A
 * surrogate pair counts for 2 units; a variation selector (1 or 2 units) and the components
 * of a ligature belong to the cluster of their glyph. The advances come from font.shape, whose
 * glyphs and clusters are the ones of stringToGlyphClusters.
 *
 * Upstream master (5d65b6d) has no stringToGlyphClusters: the regular tests are tests of an
 * API of the fork, but the one of the cmap, which passes there. Its stringToGlyphIndexes gives
 * the same glyphs as the fork (or throws the same TypeError) for every text of this file, so
 * the known failures are bugs of upstream too.
 *
 * Fixtures (the first one is a subset built for these tests, see
 * test/fonts/regression/README.md; the other three are fonts of the upstream tests):
 * - NotoSansJP-Regular-astral-subset.ttf: cmap format 12 (U+1F21A, U+2000B, U+242EE, U+29E3D),
 *   cmap format 14 (default sequences of U+E0100 with the three ideographs, non default
 *   sequences of U+FE00 and U+E0101 with U+242EE, glyph 10, and of U+E0101 with U+29E3D,
 *   glyph 23), GSUB liga lookup type 4 (f + f, f + i, f + f + i), GPOS kern lookup type 2
 *   format 2 (b + a: -19), GDEF mark class for U+0301. No U+FFFD, no U+200D, no U+180B, no
 *   language system.
 * - ../noto-emoji.ttf: cmap format 12 with glyphs without advance for U+200D (18) and U+FE0F
 *   (1852), no cmap format 14, GSUB ccmp of the DFLT script with ligatures of lookup type 4
 *   (ZWJ sequences, keycaps, flags, modifiers, tags), none with the glyph of U+FE0F as a component,
 *   and a contextual lookup (type 5) for the pairs of regional indicators that are no flag.
 * - ../TestCMAP14.otf: cmap format 14 with BMP bases, selectors of the BMP and of the
 *   supplementary planes. No GSUB, no GPOS.
 * - ../Roboto-Black.ttf: a font with a glyph for U+FFFD (its GSUB has language systems for
 *   the latin script: the command sets the language).
 *
 * The references are the outputs of hb-shape (HarfBuzz 11.3.2), pasted as they are printed
 * in the calls of parseHarfBuzzShape, under their commands. Every command has
 * --remove-default-ignorables: HarfBuzz consumes the selector of a sequence of the cmap
 * format 14, and keeps an invisible glyph without advance in the place of any other selector
 * (and of the other default ignorables) unless asked to remove it; the fork deletes a selector
 * after its base in both cases.
 * hb-shape prints the clusters as code point indexes: parseHarfBuzzShape turns them into
 * the UTF-16 offsets of stringToGlyphClusters, and the regular tests write these offsets out
 * (the same values as the clusters of a UTF-16 buffer of libharfbuzz, hb_buffer_add_utf16).
 */

import assert from 'assert';
import { loadFont, shapeText, assertShape, itFailsUntilFixed } from './helpers.mjs';

const notoSansJapaneseFixture = 'NotoSansJP-Regular-astral-subset.ttf';
const notoEmojiFixture = '../noto-emoji.ttf';
const testCmap14Fixture = '../TestCMAP14.otf';
const robotoBlackFixture = '../Roboto-Black.ttf';

/**
 * Turn the output of hb-shape ("[glyph=cluster+advance|...]", an empty string for no glyph)
 * into the result of shapeText for the same left to right text: the clusters, code point
 * indexes in the output, become UTF-16 offsets, and each cluster ends where the next one starts.
 * @param {string} text
 * @param {string} harfBuzzOutput
 * @returns {{glyphs: number[], clusters: number[], ends: number[], advances: number[]}}
 */
function parseHarfBuzzShape(text, harfBuzzOutput) {
    const utf16Offsets = [0];
    for (const character of text) {
        utf16Offsets.push(utf16Offsets[utf16Offsets.length - 1] + character.length);
    }
    const codePointsCount = utf16Offsets.length - 1;
    const items = harfBuzzOutput === '' ? [] : harfBuzzOutput.slice(1, -1).split('|');
    const glyphs = [];
    const clusters = [];
    const advances = [];
    for (const item of items) {
        const match = /^(\d+)=(\d+)\+(\d+)$/.exec(item);
        if (!match) {
            throw new Error(`Unexpected hb-shape item: ${item}`);
        }
        const codePointIndex = Number(match[2]);
        if (codePointIndex >= codePointsCount) {
            throw new Error(`The cluster ${codePointIndex} of ${harfBuzzOutput} is outside the text`);
        }
        const cluster = utf16Offsets[codePointIndex];
        if (clusters.length && cluster <= clusters[clusters.length - 1]) {
            throw new Error(`The clusters of ${harfBuzzOutput} are not in increasing order`);
        }
        glyphs.push(Number(match[1]));
        clusters.push(cluster);
        advances.push(Number(match[3]));
    }
    const ends = clusters.slice(1).concat(clusters.length ? [text.length] : []);
    return { glyphs, clusters, ends, advances };
}

describe('regression: UTF-16 clusters of surrogate pairs, variation selectors and emoji sequences (opengraphica 96127b0)', function() {
    const selectorInsideLigatureReason = 'Bidi.prototype.applyFeaturesToContexts (src/bidi.mjs): the variation selectors are deleted after the GSUB lookups, a selector between two components is still in their context and the ligature is not formed';

    describe('Noto Sans JP subset: astral characters', function() {
        let font;

        beforeEach(function() {
            font = loadFont(notoSansJapaneseFixture);
        });

        it('maps the characters outside the BMP to their glyphs of the cmap format 12', function() {
            // python -c "from fontTools.ttLib import TTFont; font = TTFont('NotoSansJP-Regular-astral-subset.ttf'); print({hex(code): font.getGlyphID(name) for code, name in font.getBestCmap().items() if code > 0xFFFF})"
            // {'0x1f21a': 19, '0x2000b': 20, '0x242ee': 21, '0x29e3d': 22}
            // (the selector U+E0101 and the lone surrogate U+D83C are not in the cmap)
            const glyphIndexes = { '\u{1F21A}': 19, '\u{2000B}': 20, '\u{242EE}': 21, '\u{29E3D}': 22, '\u{E0101}': 0, '\u{D83C}': 0 };
            for (const [character, glyphIndex] of Object.entries(glyphIndexes)) {
                const message = `U+${character.codePointAt(0).toString(16).toUpperCase()}`;
                assert.strictEqual(font.charToGlyphIndex(character), glyphIndex, message);
                assert.strictEqual(font.hasChar(character), glyphIndex > 0, message);
            }
        });

        it('gives UTF-16 ranges to the glyphs around surrogate pairs: variation sequence, ligature, emoji, ideograph', function() {
            // a, U+29E3D with the selector U+E0101 (4 UTF-16 units, the glyph of the cmap format 14),
            // fi (ligature), U+1F21A (emoji), fi, U+2000B (CJK Extension B)
            const text = 'a\u{29E3D}\u{E0101}fi\u{1F21A}fi\u{2000B}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 0061,29E3D,E0101,0066,0069,1F21A,0066,0069,2000B
            const expected = parseHarfBuzzShape(text, '[3=0+563|23=1+1000|12=3+600|19=5+1000|12=6+600|20=8+1000]');
            // the code point indexes 0, 1, 3, 5, 6, 8 of HarfBuzz as UTF-16 offsets
            assert.deepStrictEqual(expected.clusters, [0, 1, 5, 7, 9, 11]);
            assert.deepStrictEqual(expected.ends, [1, 5, 7, 9, 11, 13]);
            assertShape(shapeText(font, text), expected);
            assert.deepStrictEqual(font.stringToGlyphIndexes(text), expected.glyphs);
        });

        it('gives UTF-16 ranges to f and i after a surrogate pair with the liga feature turned off', function() {
            // a, U+29E3D with the selector U+E0101, f, i, U+1F21A
            const text = 'a\u{29E3D}\u{E0101}fi\u{1F21A}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables --features=-liga NotoSansJP-Regular-astral-subset.ttf -u 0061,29E3D,E0101,0066,0069,1F21A
            const expected = parseHarfBuzzShape(text, '[3=0+563|23=1+1000|5=3+325|6=4+275|19=5+1000]');
            assert.deepStrictEqual(expected.clusters, [0, 1, 5, 6, 7]);
            assert.deepStrictEqual(expected.ends, [1, 5, 6, 7, 9]);
            assertShape(shapeText(font, text, { features: { liga: false } }), expected);
        });

        it('keeps the variation selectors in the clusters of their astral bases, with and without a sequence in the cmap format 14', function() {
            // U+2000B U+E0100 and U+242EE U+E0100 (default sequences, the glyphs of the cmap),
            // U+242EE U+E0101 and U+242EE U+FE00 (non default sequences, glyph 10), U+242EE alone
            const sequencesText = '\u{2000B}\u{E0100}\u{242EE}\u{E0100}\u{242EE}\u{E0101}\u{242EE}\u{FE00}\u{242EE}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 2000B,E0100,242EE,E0100,242EE,E0101,242EE,FE00,242EE
            const sequencesExpected = parseHarfBuzzShape(sequencesText, '[20=0+1000|21=2+1000|10=4+1000|10=6+1000|21=8+1000]');
            assert.deepStrictEqual(sequencesExpected.clusters, [0, 4, 8, 12, 15]);
            assert.deepStrictEqual(sequencesExpected.ends, [4, 8, 12, 15, 17]);
            assertShape(shapeText(font, sequencesText), sequencesExpected);
            // U+29E3D U+E0100 (default sequence), U+2000B U+E0101 and U+2000B U+FE00 (selectors that
            // have sequences with other bases only: the glyph of the cmap, not the glyph 10 or 23
            // of the other bases), U+242EE U+E0102 (a selector the font has not), a
            const otherBasesText = '\u{29E3D}\u{E0100}\u{2000B}\u{E0101}\u{2000B}\u{FE00}\u{242EE}\u{E0102}a';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 29E3D,E0100,2000B,E0101,2000B,FE00,242EE,E0102,0061
            const otherBasesExpected = parseHarfBuzzShape(otherBasesText, '[22=0+1000|20=2+1000|20=4+1000|21=6+1000|3=8+563]');
            assert.deepStrictEqual(otherBasesExpected.clusters, [0, 4, 8, 11, 15]);
            assert.deepStrictEqual(otherBasesExpected.ends, [4, 8, 11, 15, 16]);
            assertShape(shapeText(font, otherBasesText), otherBasesExpected);
        });

        it('ends the last cluster after a variation selector at the end of the text', function() {
            // U+242EE U+FE00 (3 UTF-16 units)
            const shortSelectorText = '\u{242EE}\u{FE00}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 242EE,FE00
            const shortSelectorExpected = parseHarfBuzzShape(shortSelectorText, '[10=0+1000]');
            assert.deepStrictEqual(shortSelectorExpected.ends, [3]);
            assertShape(shapeText(font, shortSelectorText), shortSelectorExpected);
            // U+2000B U+E0100 (4 UTF-16 units)
            const astralSelectorText = '\u{2000B}\u{E0100}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 2000B,E0100
            const astralSelectorExpected = parseHarfBuzzShape(astralSelectorText, '[20=0+1000]');
            assert.deepStrictEqual(astralSelectorExpected.ends, [4]);
            assertShape(shapeText(font, astralSelectorText), astralSelectorExpected);
        });

        it('keeps a combining mark after a surrogate pair in a cluster of its own, after the two units of the pair', function() {
            // U+2000B, U+0301 (combining acute accent), a
            const text = '\u{2000B}\u{0301}a';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 2000B,0301,0061
            const expected = parseHarfBuzzShape(text, '[20=0+1000|8=1+0|3=2+563]');
            assert.deepStrictEqual(expected.clusters, [0, 2, 3]);
            assert.deepStrictEqual(expected.ends, [2, 3, 4]);
            assertShape(shapeText(font, text), expected);
        });

        it('gives .notdef the UTF-16 units of its character: 2 for an astral character without glyph, 1 for a lone surrogate', function() {
            // a, U+1F600 (not in the font), b
            const missingText = 'a\u{1F600}b';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 0061,1F600,0062
            const missingExpected = parseHarfBuzzShape(missingText, '[3=0+563|0=1+1000|4=2+618]');
            assert.deepStrictEqual(missingExpected.clusters, [0, 1, 3]);
            assert.deepStrictEqual(missingExpected.ends, [1, 3, 4]);
            assertShape(shapeText(font, missingText), missingExpected);
            // HarfBuzz turns a lone surrogate into U+FFFD (hb_buffer_add_utf16), which this font
            // has not: hb-shape takes code points only, so U+FFFD stands for each lone surrogate.
            // a, lone high surrogate, b, U+1F21A, lone high surrogate
            const text = 'a\u{D83C}b\u{1F21A}\u{D83C}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 0061,FFFD,0062,1F21A,FFFD
            const expected = parseHarfBuzzShape(text, '[3=0+563|0=1+1000|4=2+618|19=3+1000|0=4+1000]');
            assert.deepStrictEqual(expected.clusters, [0, 1, 2, 3, 5]);
            assert.deepStrictEqual(expected.ends, [1, 2, 3, 5, 6]);
            assertShape(shapeText(font, text), expected);
            // lone low surrogate, U+1F21A, lone low surrogate, lone high surrogate, a
            const reversedPairText = '\u{DC0B}\u{1F21A}\u{DE1A}\u{D83C}a';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u FFFD,1F21A,FFFD,FFFD,0061
            const reversedPairExpected = parseHarfBuzzShape(reversedPairText, '[0=0+1000|19=1+1000|0=2+1000|0=3+1000|3=4+563]');
            assert.deepStrictEqual(reversedPairExpected.clusters, [0, 1, 3, 4, 5]);
            assert.deepStrictEqual(reversedPairExpected.ends, [1, 3, 4, 5, 6]);
            assertShape(shapeText(font, reversedPairText), reversedPairExpected);
        });

        it('kerns the glyphs next to a surrogate pair and across a deleted variation selector', function() {
            // U+2000B, b, a (kerning pair of the GPOS: -19 on the advance of b, 618), U+2000B
            const text = '\u{2000B}ba\u{2000B}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 2000B,0062,0061,2000B
            const expected = parseHarfBuzzShape(text, '[20=0+1000|4=1+599|3=2+563|20=3+1000]');
            assert.deepStrictEqual(expected.clusters, [0, 2, 3, 4]);
            assert.deepStrictEqual(expected.ends, [2, 3, 4, 6]);
            assertShape(shapeText(font, text), expected);
            // b, U+E0100 (a selector without a sequence for b: deleted), a, U+2000B
            const selectorText = 'b\u{E0100}a\u{2000B}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 0062,E0100,0061,2000B
            const selectorExpected = parseHarfBuzzShape(selectorText, '[4=0+599|3=2+563|20=3+1000]');
            assert.deepStrictEqual(selectorExpected.clusters, [0, 3, 4]);
            assert.deepStrictEqual(selectorExpected.ends, [3, 4, 6]);
            assertShape(shapeText(font, selectorText), selectorExpected);
            // U+2000B, b, U+180B (Mongolian free variation selector one, the third range of the
            // variation selectors with U+FE00..U+FE0F and U+E0100..U+E01EF: deleted), a
            const mongolianSelectorText = '\u{2000B}b\u{180B}a';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 2000B,0062,180B,0061
            const mongolianSelectorExpected = parseHarfBuzzShape(mongolianSelectorText, '[20=0+1000|4=1+599|3=3+563]');
            assert.deepStrictEqual(mongolianSelectorExpected.clusters, [0, 2, 4]);
            assert.deepStrictEqual(mongolianSelectorExpected.ends, [2, 4, 5]);
            assertShape(shapeText(font, mongolianSelectorText), mongolianSelectorExpected);
        });

        itFailsUntilFixed(
            'forms the fi ligature over a variation selector between f and i',
            selectorInsideLigatureReason,
            function() {
                // U+1F21A, f, U+FE00 (variation selector 1), i, U+1F21A
                const text = '\u{1F21A}f\u{FE00}i\u{1F21A}';
                const shape = shapeText(font, text);
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 1F21A,0066,FE00,0069,1F21A
                assertShape(shape, parseHarfBuzzShape(text, '[19=0+1000|12=1+600|19=4+1000]'));
            }
        );

        it('keeps a variation selector after a ligature in the cluster of the ligature', function() {
            // f, i (ligature, glyph 12), U+FE00 (its base is i, a component of the ligature), U+2000B
            const text = 'fi\u{FE00}\u{2000B}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 0066,0069,FE00,2000B
            const expected = parseHarfBuzzShape(text, '[12=0+600|20=3+1000]');
            assert.deepStrictEqual(expected.clusters, [0, 3]);
            assert.deepStrictEqual(expected.ends, [3, 5]);
            assertShape(shapeText(font, text), expected);
        });

        it('composes a base and its combining mark into the precomposed glyph of the font', function() {
            // U+1F21A, U+0301 (no precomposed character: the mark stays), a, U+0301 (U+00E1, glyph 7), U+1F21A
            const text = '\u{1F21A}\u{0301}a\u{0301}\u{1F21A}';
            const shape = shapeText(font, text);
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 1F21A,0301,0061,0301,1F21A
            assertShape(shape, parseHarfBuzzShape(text, '[19=0+1000|8=1+0|7=2+563|19=4+1000]'));
        });
    });

    describe('Noto Sans JP subset and Noto Emoji: variation selectors without a base, default ignorables', function() {
        const loneSelectorReason = 'unicodeVariationSequence (src/features/unicode/variationSequences.mjs): TypeError, the range of a text made of one variation selector has one token and tokens[1] is undefined';
        const loneSelectorError = /setState/;
        let japaneseFont;
        let emojiFont;

        beforeEach(function() {
            japaneseFont = loadFont(notoSansJapaneseFixture);
            emojiFont = loadFont(notoEmojiFixture);
        });

        // without --remove-default-ignorables hb-shape prints an invisible glyph without advance
        // for the three lone selectors below: [1=0+0], [3=0+0] and [1=0+0]
        itFailsUntilFixed(
            'shapes a text made of one variation selector the font has not to no glyph',
            loneSelectorReason,
            function() {
                // U+E0100 (2 UTF-16 units, not in the cmap of the font)
                const text = '\u{E0100}';
                const shape = shapeText(japaneseFont, text);
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u E0100
                // prints an empty line
                assertShape(shape, parseHarfBuzzShape(text, ''));
            },
            loneSelectorError
        );

        itFailsUntilFixed(
            'shapes a text made of one variation selector the font has a glyph for to no glyph',
            loneSelectorReason,
            function() {
                // U+FE0F (glyph 1852 of the cmap of Noto Emoji)
                const text = '\u{FE0F}';
                const shape = shapeText(emojiFont, text);
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables ../noto-emoji.ttf -u FE0F
                // prints an empty line
                assertShape(shape, parseHarfBuzzShape(text, ''));
            },
            loneSelectorError
        );

        itFailsUntilFixed(
            'gives no width to a text made of one variation selector',
            loneSelectorReason,
            function() {
                // U+FE00 (not in the cmap of the font, whose .notdef has an advance of 1000)
                const width = japaneseFont.getAdvanceWidth('\u{FE00}', japaneseFont.unitsPerEm);
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u FE00
                // prints an empty line: no glyph, no advance
                assert.strictEqual(width, 0);
            },
            loneSelectorError
        );

        itFailsUntilFixed(
            'hides a variation selector at the start of the text',
            'unicodeVariationSequenceStartCheck (src/features/unicode/contextCheck/variationSequenceCheck.mjs): a selector at the start of a longer text opens no variation sequence, nothing deletes it and it is drawn (as .notdef in this font)',
            function() {
                // U+E0101, a
                const text = '\u{E0101}a';
                const shape = shapeText(japaneseFont, text);
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u E0101,0061
                assertShape(shape, parseHarfBuzzShape(text, '[3=0+563]'));
            }
        );

        itFailsUntilFixed(
            'hides a second variation selector after a variation sequence',
            'unicodeVariationSequence (src/features/unicode/variationSequences.mjs): only the first selector after a base (tokens[1]) is deleted, a second one is drawn (as .notdef in this font)',
            function() {
                // U+29E3D, U+E0101 twice, a
                const text = '\u{29E3D}\u{E0101}\u{E0101}a';
                const shape = shapeText(japaneseFont, text);
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 29E3D,E0101,E0101,0061
                assertShape(shape, parseHarfBuzzShape(text, '[23=0+1000|3=3+563]'));
            }
        );

        itFailsUntilFixed(
            'hides a default ignorable character the font has no glyph for: zero width joiner',
            'Font.shape (src/font.mjs): no step like hb_ot_hide_default_ignorables, a default ignorable character the font has not (U+200D) is drawn as .notdef',
            function() {
                // a, U+200D (zero width joiner, not in the cmap), b
                const text = 'a\u{200D}b';
                const shape = shapeText(japaneseFont, text);
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 0061,200D,0062
                assertShape(shape, parseHarfBuzzShape(text, '[3=0+563|4=2+618]'));
            }
        );

        itFailsUntilFixed(
            'hides a default ignorable character the font has a glyph for: soft hyphen',
            'Font.shape (src/font.mjs): no step like hb_ot_hide_default_ignorables, a default ignorable character the font has (U+00AD) is drawn with its glyph and its advance',
            function() {
                // U+1F21A, U+00AD (soft hyphen, glyph 2 of the cmap with an advance of 347), U+1F21A
                const text = '\u{1F21A}\u{00AD}\u{1F21A}';
                const shape = shapeText(japaneseFont, text);
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables NotoSansJP-Regular-astral-subset.ttf -u 1F21A,00AD,1F21A
                assertShape(shape, parseHarfBuzzShape(text, '[19=0+1000|19=2+1000]'));
            }
        );
    });

    describe('Noto Emoji: emoji sequences', function() {
        let font;

        beforeEach(function() {
            font = loadFont(notoEmojiFixture);
        });

        it('gives one glyph and one UTF-16 range to an emoji, a ZWJ sequence and a heart with U+FE0F', function() {
            // U+1F600 (grinning face), U+1F468 U+200D U+1F469 U+200D U+1F467 (family, 8 UTF-16 units),
            // U+2764 U+FE0F (heart with the emoji selector), U+1F600
            const text = '\u{1F600}\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{2764}\u{FE0F}\u{1F600}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables ../noto-emoji.ttf -u 1F600,1F468,200D,1F469,200D,1F467,2764,FE0F,1F600
            const expected = parseHarfBuzzShape(text, '[882=0+2600|1462=1+2600|168=6+2600|882=8+2600]');
            assert.deepStrictEqual(expected.clusters, [0, 2, 10, 12]);
            assert.deepStrictEqual(expected.ends, [2, 10, 12, 14]);
            assertShape(shapeText(font, text), expected);
        });

        it('gives one glyph and one UTF-16 range to the ligatures of astral components: flag, skin tone, tag sequence', function() {
            // U+1F1EF U+1F1F5 (regional indicators J and P, flag of Japan), U+1F44B U+1F3FD (waving hand
            // with a skin tone modifier), U+1F3F4 U+E0067 U+E0062 U+E0065 U+E006E U+E0067 U+E007F
            // (flag of England, a tag sequence of 14 UTF-16 units), U+1F600
            const text = '\u{1F1EF}\u{1F1F5}\u{1F44B}\u{1F3FD}\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}\u{1F600}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables ../noto-emoji.ttf -u 1F1EF,1F1F5,1F44B,1F3FD,1F3F4,E0067,E0062,E0065,E006E,E0067,E007F,1F600
            const expected = parseHarfBuzzShape(text, '[1711=0+2600|567=2+2600|1664=4+2600|882=11+2600]');
            assert.deepStrictEqual(expected.clusters, [0, 4, 8, 22]);
            assert.deepStrictEqual(expected.ends, [4, 8, 22, 24]);
            assertShape(shapeText(font, text), expected);
        });

        it('joins the deleted second regional indicator of an unknown flag to the cluster of the first one', function() {
            // U+1F600, U+1F1E6 U+1F1E6 (regional indicators A and A, no flag: the ccmp lookup 5,
            // contextual substitution format 3, turns the first one into unknownFlag, glyph 1850, with the
            // single substitution of lookup 2 and deletes the second one with the empty sequence
            // of the multiple substitution of lookup 1), U+1F600
            const text = '\u{1F600}\u{1F1E6}\u{1F1E6}\u{1F600}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables ../noto-emoji.ttf -u 1F600,1F1E6,1F1E6,1F600
            const expected = parseHarfBuzzShape(text, '[882=0+2600|1850=1+2600|882=3+2600]');
            assert.deepStrictEqual(expected.clusters, [0, 2, 6]);
            assert.deepStrictEqual(expected.ends, [2, 6, 8]);
            assertShape(shapeText(font, text), expected);
        });

        // the same sequences as the known failure below, without their selectors
        it('ligates the sequences of a flag and of a keycap written without U+FE0F', function() {
            // U+1F600, U+1F3F3 U+200D U+1F308 (rainbow flag), 1 U+20E3 (keycap)
            const text = '\u{1F600}\u{1F3F3}\u{200D}\u{1F308}1\u{20E3}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables ../noto-emoji.ttf -u 1F600,1F3F3,200D,1F308,0031,20E3
            const expected = parseHarfBuzzShape(text, '[882=0+2600|1847=1+2600|1527=4+2600]');
            assert.deepStrictEqual(expected.clusters, [0, 2, 7]);
            assert.deepStrictEqual(expected.ends, [2, 7, 9]);
            assertShape(shapeText(font, text), expected);
        });

        itFailsUntilFixed(
            'ligates the fully qualified sequences of a flag and of a keycap, with U+FE0F inside',
            selectorInsideLigatureReason,
            function() {
                // U+1F600, U+1F3F3 U+FE0F U+200D U+1F308 (rainbow flag), 1 U+FE0F U+20E3 (keycap)
                const text = '\u{1F600}\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}1\u{FE0F}\u{20E3}';
                const shape = shapeText(font, text);
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables ../noto-emoji.ttf -u 1F600,1F3F3,FE0F,200D,1F308,0031,FE0F,20E3
                assertShape(shape, parseHarfBuzzShape(text, '[882=0+2600|1847=1+2600|1527=5+2600]'));
            }
        );
    });

    describe('TestCMAP14: BMP bases with astral selectors', function() {
        let font;

        beforeEach(function() {
            font = loadFont(testCmap14Fixture);
        });

        it('gives 3 UTF-16 units to a BMP ideograph with a selector of the supplementary planes', function() {
            // U+82A6 U+E0101 (non default sequence, glyph 2), U+82A6 U+E0100 (default sequence, glyph 1)
            const ideographsText = '\u{82A6}\u{E0101}\u{82A6}\u{E0100}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables ../TestCMAP14.otf -u 82A6,E0101,82A6,E0100
            const ideographsExpected = parseHarfBuzzShape(ideographsText, '[2=0+1000|1=2+1000]');
            assert.deepStrictEqual(ideographsExpected.clusters, [0, 3]);
            assert.deepStrictEqual(ideographsExpected.ends, [3, 6]);
            assertShape(shapeText(font, ideographsText), ideographsExpected);
            // U+82A6 U+E0100, U+2269 U+FE00 (greater than but not equal to, non default sequence, glyph 3)
            const mixedText = '\u{82A6}\u{E0100}\u{2269}\u{FE00}';
            // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables ../TestCMAP14.otf -u 82A6,E0100,2269,FE00
            const mixedExpected = parseHarfBuzzShape(mixedText, '[1=0+1000|3=2+723]');
            assert.deepStrictEqual(mixedExpected.clusters, [0, 3]);
            assert.deepStrictEqual(mixedExpected.ends, [3, 5]);
            assertShape(shapeText(font, mixedText), mixedExpected);
        });
    });

    describe('Roboto Black: a font with U+FFFD', function() {
        let font;

        beforeEach(function() {
            font = loadFont(robotoBlackFixture);
        });

        itFailsUntilFixed(
            'draws a lone surrogate with the glyph of U+FFFD',
            'getTextCharacters (src/tokenizer.mjs): a lone surrogate is a character as it is, mapped to .notdef, not U+FFFD',
            function() {
                // a, lone high surrogate, b: HarfBuzz (hb_buffer_add_utf16) and the browsers turn it into U+FFFD
                const text = 'a\u{D83C}b';
                const shape = shapeText(font, text);
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables --language=en ../Roboto-Black.ttf -u 0061,FFFD,0062
                assertShape(shape, parseHarfBuzzShape(text, '[69=0+1087|452=1+2101|70=2+1153]'));
            }
        );
    });
});
