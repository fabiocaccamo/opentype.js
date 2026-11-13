/**
 * Regression: the GPOS dist feature of a script whose language system has no kern feature,
 * positioned by Font.shape.
 *
 * No upstream issue or PR. Upstream master, and the fork before Font.shape, apply the lookups of
 * the GPOS kern feature only: the gonm script of Noto Sans Masaram Gondi has dist and no kern
 * feature, so its pairs are lost. HarfBuzz enables dist by default, like kern.
 *
 * Fixture (how it was built: test/fonts/regression/README.md):
 * - NotoSansMasaramGondi-Regular-dist-subset.ttf: the GPOS lookup 0, a pair adjustment (type 2,
 *   formats 1 and 2, IgnoreMarks), is the dist feature of gonm and the kern feature of DFLT and
 *   latn: Nga.MGondi Ca.MGondi -40.
 *   Glyphs: 1 Nga.MGondi (U+11D10, advance 897), 2 Ca.MGondi (U+11D11, advance 818).
 *
 * The reference values come from hb-shape (HarfBuzz 11.3.2), run in test/fonts/regression/.
 * hb-shape prints the clusters as code point indexes: each character of these texts is a surrogate
 * pair, so the UTF-16 offsets of the fork are twice these indexes.
 */

import assert from 'assert';
import { loadFont, shapeText, assertShape } from './helpers.mjs';

const masaramGondiFixture = 'NotoSansMasaramGondi-Regular-dist-subset.ttf';
const ngaCa = '\u{11D10}\u{11D11}';

describe('regression: the GPOS dist feature of a script without a kern feature (Noto Sans Masaram Gondi)', function() {
    let font;

    before(function() {
        font = loadFont(masaramGondiFixture);
    });

    it('applies the pairs of dist by default', function() {
        // hb-shape --no-glyph-names --cluster-level=1 NotoSansMasaramGondi-Regular-dist-subset.ttf -u 11D10,11D11
        // [1=0+857|2=1+818]
        assertShape(shapeText(font, ngaCa), { glyphs: [1, 2], clusters: [0, 2], advances: [857, 818] });
        assert.strictEqual(font.getAdvanceWidth(ngaCa, font.unitsPerEm), 857 + 818);
    });

    it('applies the pairs of dist without kerning', function() {
        // hb-shape --no-glyph-names --cluster-level=1 --features=-kern NotoSansMasaramGondi-Regular-dist-subset.ttf -u 11D10,11D11
        // [1=0+857|2=1+818]
        assertShape(shapeText(font, ngaCa, { kerning: false }), { glyphs: [1, 2], clusters: [0, 2], advances: [857, 818] });
    });

    it('applies no pair with dist turned off', function() {
        // hb-shape --no-glyph-names --cluster-level=1 --features=-dist NotoSansMasaramGondi-Regular-dist-subset.ttf -u 11D10,11D11
        // [1=0+897|2=1+818]
        assertShape(shapeText(font, ngaCa, { features: { dist: false } }), { glyphs: [1, 2], clusters: [0, 2], advances: [897, 818] });
    });
});
