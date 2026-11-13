/**
 * Regression: GPOS pair adjustments whose second value record has an x placement and an x
 * advance, positioned by Font.shape.
 *
 * No upstream issue or PR. Upstream master, and the fork before Font.shape, lay out a text with
 * the x advance of the first value record of each pair only: the second value record of the pairs
 * of a consonant and a vowel sign of Noto Sans Modi is lost, the vowel sign keeps its own advance
 * and is drawn at the pen position.
 *
 * Fixture (how it was built: test/fonts/regression/README.md):
 * - NotoSansModi-Regular-kern-subset.ttf: the kern feature of every script has the lookup 0, a
 *   pair adjustment (type 2, format 1) with ValueFormat1 0 and ValueFormat2 5 (x placement and x
 *   advance): Ja with I_dv and II_dv <70 0 70 0>, Na with I_dv and II_dv <25 0 25 0>.
 *   Glyphs: 1 Ja (U+11615), 2 Na (U+11621), 3 I_dv (U+11631), 4 II_dv (U+11632).
 *
 * The reference values come from hb-shape (HarfBuzz 11.3.2), run in test/fonts/regression/.
 * hb-shape prints the clusters as code point indexes: each character of these texts is a surrogate
 * pair, so the UTF-16 offsets of the fork are twice these indexes.
 */

import { loadFont, shapeText, assertShape } from './helpers.mjs';

const modiFixture = 'NotoSansModi-Regular-kern-subset.ttf';

describe('regression: GPOS pair adjustments with a second value record (Noto Sans Modi)', function() {
    let font;

    before(function() {
        font = loadFont(modiFixture);
    });

    it('adds the x placement of the second value record to the offset of the vowel sign, its x advance to the advance', function() {
        // hb-shape --no-glyph-names --cluster-level=1 NotoSansModi-Regular-kern-subset.ttf -u 11615,11631
        // [1=0+618|3=1@70,0+310]
        assertShape(shapeText(font, '\u{11615}\u{11631}'), { glyphs: [1, 3], clusters: [0, 2], advances: [618, 310], offsets: [[0, 0], [70, 0]] });
        // hb-shape --no-glyph-names --cluster-level=1 NotoSansModi-Regular-kern-subset.ttf -u 11621,11632
        // [2=0+658|4=1@25,0+351]
        assertShape(shapeText(font, '\u{11621}\u{11632}'), { glyphs: [2, 4], clusters: [0, 2], advances: [658, 351], offsets: [[0, 0], [25, 0]] });
    });

    it('positions each pair of a text', function() {
        // hb-shape --no-glyph-names --cluster-level=1 NotoSansModi-Regular-kern-subset.ttf -u 11615,11631,11621,11632
        // [1=0+618|3=1@70,0+310|2=2+658|4=3@25,0+351]
        assertShape(shapeText(font, '\u{11615}\u{11631}\u{11621}\u{11632}'), {
            glyphs: [1, 3, 2, 4],
            clusters: [0, 2, 4, 6],
            advances: [618, 310, 658, 351],
            offsets: [[0, 0], [70, 0], [0, 0], [25, 0]]
        });
        // hb-shape --no-glyph-names --cluster-level=1 NotoSansModi-Regular-kern-subset.ttf -u 11621,11632,11615,11631
        // [2=0+658|4=1@25,0+351|1=2+618|3=3@70,0+310]
        assertShape(shapeText(font, '\u{11621}\u{11632}\u{11615}\u{11631}'), {
            glyphs: [2, 4, 1, 3],
            clusters: [0, 2, 4, 6],
            advances: [658, 351, 618, 310],
            offsets: [[0, 0], [25, 0], [0, 0], [70, 0]]
        });
    });

    it('applies no value record without kerning', function() {
        // hb-shape --no-glyph-names --cluster-level=1 --features=-kern NotoSansModi-Regular-kern-subset.ttf -u 11615,11631,11621,11632
        // [1=0+618|3=1+240|2=2+658|4=3+326]
        assertShape(shapeText(font, '\u{11615}\u{11631}\u{11621}\u{11632}', { kerning: false }), {
            glyphs: [1, 3, 2, 4],
            clusters: [0, 2, 4, 6],
            advances: [618, 240, 658, 326],
            offsets: [[0, 0], [0, 0], [0, 0], [0, 0]]
        });
    });
});
