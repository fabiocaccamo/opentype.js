import assert from 'assert';
import { getFormTokenFeatureValue } from '../src/features/arab/arabicPresentationForms.mjs';

// the masks of the forms of HarfBuzz 11.3.2 (hb_ot_map_builder_t::compile and the mask_array of its Arabic shaper): a
// form of the features option is a global feature, its value at every glyph, and the value 1 of the mask of the form
// joins it at the letters of the form (TestAlternateSubstitution.ttf, fina sub teh from [teh.fina1 teh.fina2 teh.fina3];:
// hb-shape --features=fina=2 -u 062A,062A,0020,062A gives teh.fina2 at the initial and the isolated teh, teh.fina3 at
// the final one)
describe('arabicPresentationForms.mjs', function() {
    describe('getFormTokenFeatureValue', function() {
        it('gives the value 1 of the mask at the letters of the form only without the features option', function() {
            for (const featuresOption of [undefined, {}, { init: 2 }]) {
                assert.strictEqual(getFormTokenFeatureValue(featuresOption, 'fina', true), 1, JSON.stringify(featuresOption));
                assert.strictEqual(getFormTokenFeatureValue(featuresOption, 'fina', false), null, JSON.stringify(featuresOption));
            }
        });

        it('gives the value of the features option at every glyph, with the value 1 of the mask at the letters of the form', function() {
            assert.deepStrictEqual([true, false].map(isFormToken => getFormTokenFeatureValue({ fina: 2 }, 'fina', isFormToken)), [3, 2]);
            assert.deepStrictEqual([true, false].map(isFormToken => getFormTokenFeatureValue({ fina: 3 }, 'fina', isFormToken)), [3, 3]);
            assert.deepStrictEqual([true, false].map(isFormToken => getFormTokenFeatureValue({ fina: true }, 'fina', isFormToken)), [1, 1]);
        });

        it('keeps the mask of the form when the 8 lowest bits of the value are 0', function() {
            assert.deepStrictEqual([true, false].map(isFormToken => getFormTokenFeatureValue({ fina: 256 }, 'fina', isFormToken)), [1, null]);
            assert.deepStrictEqual([true, false].map(isFormToken => getFormTokenFeatureValue({ fina: 258 }, 'fina', isFormToken)), [3, 2]);
        });
    });
});
