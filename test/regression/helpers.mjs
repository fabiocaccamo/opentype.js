/**
 * Helpers of the regression tests: real fonts (subsets, see test/fonts/LICENSE and
 * test/fonts/regression/README.md for how each one was built) of the upstream issues,
 * compared with reference values that never come from opentype.js itself.
 *
 * Conventions of the specs of this folder:
 * - References: HarfBuzz for glyphs, clusters, advances and offsets (hb-shape 11.3.2), fontTools
 *   for the outlines and the metrics of variable fonts (varLib.instancer) and for the tables.
 *   The exception: the fork normalizes the coordinates with the OpenType algorithm in 16.16,
 *   varLib.instancer in floats rounded once to F2Dot14, so where the two locations differ by
 *   1/16384 the outlines come from HarfBuzz (hb-subset --variations) or the spec. HarfBuzz
 *   normalizes in 16.16 too, from the user value read as a 32-bit float: the user values of
 *   these specs give the same location in the fork and in HarfBuzz.
 * - Each expected value comes with the command that produced it, run from
 *   test/fonts/regression/, one command and its output per value:
 *     // hb-shape --no-glyph-names --cluster-level=1 <fixture> -u 0041,0056
 *     // [1=0+552|5=1+672]
 *   For a font with a Silf table, hb-shape takes --shapers=ot: its first shaper is graphite2.
 * - Clusters: one cluster per character that has a glyph of its own, as stringToGlyphClusters
 *   documents (hb-shape --cluster-level=1: a combining mark keeps its cluster), expressed as
 *   UTF-16 offsets (hb-shape prints code point indexes, the same values without surrogate pairs).
 * - A known bug is one itFailsUntilFixed with one assertion, the reference behaviour. Its
 *   reason says what is wrong and where: 'functionName (src/file.mjs): what happens'.
 * - Fixture fonts are loaded in before or beforeEach hooks, never in the body of a describe
 *   (an exception there stops the whole run) nor in the body of a known failure; a known
 *   failure whose bug is in the writer may parse the font written by toArrayBuffer() in its body.
 */

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { parse } from '../../src/opentype.mjs';

const fontsUrl = new URL('../fonts/regression/', import.meta.url);

/**
 * Load a font of test/fonts/regression/ (or of test/fonts/ with a '../' prefix).
 * A new font is parsed at every call, so a test never sees the variation set by another one.
 * @param {string} fileName
 * @param {Object} [variation] - variation coordinates set on the font, e.g. { wght: 700 }
 * @param {Object} [options] - options of parse()
 * @returns {opentype.Font}
 */
function loadFont(fileName, variation, options) {
    const font = parse(readFileSync(fileURLToPath(new URL(fileName, fontsUrl))), options);
    if (variation) {
        const axes = font.tables.fvar ? font.tables.fvar.axes : [];
        const axisTags = axes.map(axis => axis.tag);
        for (const tag of Object.keys(variation)) {
            if (!axisTags.includes(tag)) {
                throw new Error(`${fileName} has no ${tag} axis`);
            }
        }
        font.variation.set(variation);
    }
    return font;
}

/**
 * Lay out a text with the text layout of the font (forEachGlyph, the one behind getPath,
 * draw and getAdvanceWidth), at a font size of one em so that the positions are in font units.
 * @param {opentype.Font} font
 * @param {string} text
 * @param {Object} [options] - GlyphRenderOptions: features, kerning, script, language...
 * @returns {{origins: Array<number[]>, end: number}} the [glyph index, x, y] of each glyph
 * and the x of the pen after the last one. The y axis goes down, like the canvas of
 * forEachGlyph and unlike getPathOutline: an hb-shape y offset of -41 is +41 here.
 */
function getGlyphOrigins(font, text, options) {
    const origins = [];
    const end = font.forEachGlyph(text, 0, 0, font.unitsPerEm, options, (glyph, originX, originY) => {
        origins.push([glyph.index, originX, originY]);
    });
    return { origins, end };
}

/**
 * Shape a text like `hb-shape --no-glyph-names --cluster-level=1` prints it, with font.shape: the
 * glyph ids, the cluster of each glyph, its x advance and its x and y offsets in font units,
 * kerning included. The y offset goes up, like the y offsets of hb-shape (the y of forEachGlyph
 * goes down, see getGlyphOrigins). font.shape gives no advance to a glyph whose advance is not a
 * number, so a glyph whose advance is not a finite number throws here instead of reading as a
 * glyph without advance.
 * @param {opentype.Font} font
 * @param {string} text
 * @param {Object} [options] - GlyphRenderOptions: features, kerning, script, language...
 * @returns {{glyphs: number[], clusters: number[], ends: number[], advances: number[], offsets: Array<number[]>}}
 * clusters and ends are the UTF-16 offsets of the first character of each glyph and of
 * the character after its last one, offsets the [x, y] offset of each glyph
 */
function shapeText(font, text, options) {
    const glyphPositions = font.shape(text, options);
    const variation = options ? options.variation : undefined;
    for (const { glyph } of glyphPositions) {
        const advanceWidth = glyph.getAdvanceWidth(font, variation);
        if (!Number.isFinite(advanceWidth)) {
            throw new Error(`glyph ${glyph.index} has the advance ${advanceWidth}`);
        }
    }
    return {
        glyphs: glyphPositions.map(glyphPosition => glyphPosition.glyph.index),
        clusters: glyphPositions.map(glyphPosition => glyphPosition.start),
        ends: glyphPositions.map(glyphPosition => glyphPosition.end),
        advances: glyphPositions.map(glyphPosition => glyphPosition.xAdvance),
        offsets: glyphPositions.map(glyphPosition => [glyphPosition.xOffset, glyphPosition.yOffset])
    };
}

/**
 * Assert that a shaped text (see shapeText) is a line of hb-shape: its glyphs, clusters
 * and advances, and its ends and its offsets when the expected shape has them (hb-shape
 * prints the offsets of a glyph, @x,y, when one of them is not 0: [0, 0] for the others).
 * @param {{glyphs: number[], clusters: number[], ends: number[], advances: number[], offsets: Array<number[]>}} actual
 * @param {{glyphs: number[], clusters: number[], advances: number[], ends?: number[], offsets?: Array<number[]>}} expected
 * @param {string} [message]
 */
function assertShape(actual, expected, message = 'shape') {
    assert.deepStrictEqual(actual.glyphs, expected.glyphs, `${message}: glyphs`);
    assert.deepStrictEqual(actual.clusters, expected.clusters, `${message}: clusters`);
    assert.deepStrictEqual(actual.advances, expected.advances, `${message}: advances`);
    if (expected.ends) {
        assert.deepStrictEqual(actual.ends, expected.ends, `${message}: ends`);
    }
    if (expected.offsets) {
        assert.deepStrictEqual(actual.offsets, expected.offsets, `${message}: offsets`);
    }
}

/**
 * Outline of a path drawn at a font size of one em, in font units with the y axis going
 * up like the pens of fontTools: its commands as [type, ...coordinates]
 * (M and L: x, y; Q: x1, y1, x, y; C: x1, y1, x2, y2, x, y; Z).
 * @param {opentype.Path} path
 * @returns {Array<Array<string|number>>}
 */
function getPathOutline(path) {
    // + 0 turns the negative zero of a negated zero into zero, deepStrictEqual tells them apart
    return path.commands.map((command) => {
        switch (command.type) {
            case 'M':
            case 'L':
                return [command.type, command.x, -command.y + 0];
            case 'Q':
                return [command.type, command.x1, -command.y1 + 0, command.x, -command.y + 0];
            case 'C':
                return [command.type, command.x1, -command.y1 + 0, command.x2, -command.y2 + 0, command.x, -command.y + 0];
            case 'Z':
                return [command.type];
            default:
                throw new Error(`Unknown path command: ${command.type}`);
        }
    });
}

/**
 * Outline of a glyph at the current variation of the font (see getPathOutline).
 * @param {opentype.Font} font
 * @param {number} glyphIndex
 * @returns {Array<Array<string|number>>}
 */
function getOutline(font, glyphIndex) {
    return getPathOutline(font.glyphs.get(glyphIndex).getPath(0, 0, font.unitsPerEm, {}, font));
}

/**
 * Assert that two outlines (see getPathOutline) have the same commands, with coordinates
 * that differ by at most `tolerance` font units.
 * @param {Array<Array<string|number>>} actual
 * @param {Array<Array<string|number>>} expected
 * @param {number} [tolerance=0]
 * @param {string} [message]
 */
function assertOutlineClose(actual, expected, tolerance = 0, message = 'outline') {
    assert.deepStrictEqual(actual.map(command => command[0]), expected.map(command => command[0]), `${message}: command types`);
    for (let i = 0; i < expected.length; i++) {
        const commandName = `${message}: command ${i} (${expected[i][0]})`;
        assert.strictEqual(actual[i].length, expected[i].length, `${commandName}: number of values`);
        for (let valueIndex = 1; valueIndex < expected[i].length; valueIndex++) {
            const actualValue = actual[i][valueIndex];
            const expectedValue = expected[i][valueIndex];
            assert.ok(
                Number.isFinite(actualValue) && Math.abs(actualValue - expectedValue) <= tolerance,
                `${commandName}, value ${valueIndex}: ${actualValue} instead of ${expectedValue} (tolerance ${tolerance})`
            );
        }
    }
}

/**
 * Assert that the body of a known failure still fails, and that it fails with the expected
 * error: any other error (a typo, a missing font, a crash) is thrown as it is.
 * @param {Function} body - synchronous
 * @param {Function|RegExp} [expectedError=assert.AssertionError] - error class, or pattern of the message
 */
function assertKnownFailure(body, expectedError = assert.AssertionError) {
    let failure = null;
    let result;
    try {
        result = body();
    } catch (error) {
        failure = error;
    }
    if (result && typeof result.then === 'function') {
        throw new TypeError('the body of a known failure must be synchronous');
    }
    assert.ok(failure, 'this known failure passes now: turn itFailsUntilFixed into it');
    const isExpected = expectedError instanceof RegExp ? expectedError.test(failure.message) : failure instanceof expectedError;
    if (!isExpected) {
        throw failure;
    }
}

/**
 * Declare the test of a known bug: it passes as long as its body fails with the expected
 * error, and fails as soon as the bug is fixed, so that the fix has to turn it into a
 * regular `it`. The body holds one assertion, the reference behaviour; a bug that is an
 * exception of the library names that exception as its expected error.
 * @param {string} title
 * @param {string} reason - what is wrong today and where
 * @param {Function} body - synchronous
 * @param {Function|RegExp} [expectedError=assert.AssertionError] - error class, or pattern of the message
 */
function itFailsUntilFixed(title, reason, body, expectedError) {
    it(`${title} [known failure: ${reason}]`, function() {
        assertKnownFailure(() => body.call(this), expectedError);
    });
}

export {
    loadFont,
    getGlyphOrigins,
    shapeText,
    assertShape,
    getPathOutline,
    getOutline,
    assertOutlineClose,
    assertKnownFailure,
    itFailsUntilFixed
};
