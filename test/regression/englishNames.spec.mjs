/**
 * Regression tests of the English names of a font whose Macintosh names are only the names of
 * its axes and instances (name IDs 256 and up), as fontTools varLib builds them.
 *
 * Found by the review of the tolerant loading of the fork (point 7 of the plan), no upstream
 * issue. Font.prototype.getEnglishName reads the first platform the font has names for
 * (Unicode, then Macintosh, then Windows), and the Macintosh names of these fonts have no
 * family, subfamily nor postScriptName: getEnglishName gives undefined for them, and
 * toArrayBuffer, which makes the name table from them, throws.
 *
 * Fixture: ../TestCVARGVAROne.ttf (test/fonts/LICENSE), Macintosh name IDs 256 to 270 only,
 * Windows name IDs 0 to 17 and 256 to 270:
 *   python -c "from fontTools.ttLib import TTFont; print(sorted({record.platformID for record in TTFont('../TestCVARGVAROne.ttf')['name'].names if record.nameID < 256}))"
 *   [3]
 * The reference is the name of fontTools getDebugName, which reads the Windows English name
 * first, then the Macintosh one:
 *   python -c "from fontTools.ttLib import TTFont; print([TTFont('../TestCVARGVAROne.ttf')['name'].getDebugName(nameID) for nameID in (1, 2, 6)])"
 *   ['Test CVAR GVAR One', 'Regular', 'TestCVARGVAR-One']
 */

import assert from 'assert';
import { parse } from '../../src/opentype.mjs';
import { loadFont, itFailsUntilFixed } from './helpers.mjs';

describe('regression: the English names of a font with Macintosh names of its axes only', function() {
    let font;

    before(function() {
        font = loadFont('../TestCVARGVAROne.ttf');
    });

    itFailsUntilFixed('gives the English postScriptName of the Windows names',
        'Font.prototype.getEnglishName (src/font.mjs): only the names of the first platform the font has are read, the Macintosh ones, which have no postScriptName',
        function() {
            assert.strictEqual(font.getEnglishName('postScriptName'), 'TestCVARGVAR-One');
        });

    itFailsUntilFixed('writes the font with its English postScriptName',
        'Font.prototype.getEnglishName (src/font.mjs): toArrayBuffer finds no English postScriptName, fontFamily nor fontSubfamily in the Macintosh names and throws',
        function() {
            assert.strictEqual(parse(font.toArrayBuffer()).getEnglishName('postScriptName'), 'TestCVARGVAR-One');
        },
        /^A font without the English postScriptName name/);
});
