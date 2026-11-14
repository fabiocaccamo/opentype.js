import assert from 'assert';
import {
    getFeatureValue,
    getUnmaskedFeatureValue,
    getMaskedFeatureValue,
    getRunFeatureValue,
    isDefaultFeatureInMap,
    isDefaultFeatureEnabled,
    getEnabledFeatureTags,
    getDirectionFeatureTags,
    getLookupJoinerFlags
} from '../src/features/featureValues.mjs';

// the values of the features of HarfBuzz 11.3.2: hb_feature_t values (hb-shape --features=aalt=2, +salt, -liga), the
// default value HB_OT_MAP_MAX_VALUE of rand, the 8 bits HB_OT_MAP_MAX_BITS of a value (hb_ot_map_builder_t::compile)
describe('featureValues.mjs', function() {
    describe('getFeatureValue', function() {
        it('gives the value of a feature of the features option: 1 for true, 0 for false, an integer', function() {
            const featuresOption = { aalt: 2, salt: true, liga: false, cv01: 0, ss01: 255 };
            assert.deepStrictEqual(['aalt', 'salt', 'liga', 'cv01', 'ss01'].map(tag => getFeatureValue(featuresOption, tag)), [2, 1, 0, 0, 255]);
        });

        it('keeps the 8 lowest bits of a value, like HarfBuzz', function() {
            assert.deepStrictEqual([256, 257, 511, 0x10002].map(value => getFeatureValue({ aalt: value }, 'aalt')), [0, 1, 255, 2]);
        });

        it('gives the default value of a feature the option does not set: 255 for rand, 1 for the others', function() {
            for (const featuresOption of [undefined, {}, { calt: undefined, rand: undefined }, [{ script: 'latn', tags: ['calt'] }]]) {
                assert.deepStrictEqual(['calt', 'rand'].map(tag => getFeatureValue(featuresOption, tag)), [1, 255], JSON.stringify(featuresOption));
            }
        });

        it('throws on a value that is neither a boolean nor an integer from 0', function() {
            for (const value of [-1, 0.5, NaN, Infinity, '2', null, {}]) {
                assert.throws(() => getFeatureValue({ cv01: value }, 'cv01'), TypeError, String(value));
            }
        });

        it('tells the type of the invalid value in the message of the error', function() {
            const expectedMessages = [
                ['2', 'not string 2'], [BigInt(2), 'not bigint 2'], [Symbol('on'), 'not symbol Symbol(on)'], [null, 'not object null']
            ];
            for (const [value, expectedMessage] of expectedMessages) {
                assert.throws(() => getFeatureValue({ cv01: value }, 'cv01'), {
                    name: 'TypeError',
                    message: `The value of the feature cv01 must be a boolean or an integer from 0, ${expectedMessage}`
                });
            }
        });
    });

    // the features of the Arabic shaper and rtlm, whose mask HarfBuzz sets at some glyphs (the mask_array of the forms,
    // rtlm_mask): TestAlternateSubstitution.ttf, hb-shape --features=fina=2 -u 062A,062A,0020,062A gives teh.fina3 at
    // the final teh and teh.fina2 at the other ones, --features=fina=256 teh.fina1 at the final teh only
    describe('getUnmaskedFeatureValue and getMaskedFeatureValue', function() {
        it('give the value of the option outside the mask, 0 without it, and the value 1 of the mask joined to it at the glyphs of the mask', function() {
            const featuresOptions = [undefined, { fina: 2 }, { fina: 3 }, { fina: true }, { fina: 256 }, { fina: 258 }];
            assert.deepStrictEqual(featuresOptions.map(featuresOption => getUnmaskedFeatureValue(featuresOption, 'fina')), [0, 2, 3, 1, 0, 2]);
            assert.deepStrictEqual(featuresOptions.map(featuresOption => getMaskedFeatureValue(featuresOption, 'fina')), [1, 3, 3, 1, 1, 3]);
        });
    });

    describe('getRunFeatureValue', function() {
        it('gives rtlm the value of its mask in a run whose direction features have it, its value otherwise', function() {
            // a font with rtlm sub alef from [alef.alt1 alef.alt2 alef.alt3]; sub a from [a.alt1 a.alt2 a.alt3];:
            // hb-shape --features=rtlm=2 -u 0627 gives alef.alt3, -u 0061 a.alt2; --features=rtlm=256 -u 0627 alef.alt1,
            // -u 0061 a
            const featuresOptions = [undefined, { rtlm: 2 }, { rtlm: 256 }];
            const rightToLeftTags = ['rtla', 'rtlm'];
            const leftToRightTags = ['ltra', 'ltrm'];
            assert.deepStrictEqual(featuresOptions.map(featuresOption => getRunFeatureValue(featuresOption, 'rtlm', rightToLeftTags)), [1, 3, 1]);
            assert.deepStrictEqual(featuresOptions.map(featuresOption => getRunFeatureValue(featuresOption, 'rtlm', leftToRightTags)), [1, 2, 0]);
        });

        it('gives the other features their value', function() {
            const featuresOption = { rtla: 2, rand: 256, salt: 3 };
            assert.deepStrictEqual(['rtla', 'rand', 'salt', 'calt'].map(tag => getRunFeatureValue(featuresOption, tag, ['rtla', 'rtlm'])), [2, 0, 3, 1]);
        });
    });

    describe('isDefaultFeatureInMap', function() {
        it('keeps a default feature in the feature map unless its value is 0 or false, like a max_value of 0 in HarfBuzz', function() {
            // the has_gpos_mark of HarfBuzz on a copy of TestNormalization.ttf with an empty GPOS mark feature (fontTools):
            // hb-shape --features=mark=256 -u FB2A,05B8 and --features=mark=512 keep the presentation form decomposed,
            // like the default, [53=1|54=0|55=0]; --features=mark=0: [53=1|56=0]
            const inMapValues = [undefined, true, 1, 2, 256, 512, false, 0].map(value => isDefaultFeatureInMap({ mark: value }, 'mark'));
            assert.deepStrictEqual(inMapValues, [true, true, true, true, true, true, false, false]);
            assert.strictEqual(isDefaultFeatureInMap(undefined, 'mark'), true);
            assert.strictEqual(isDefaultFeatureInMap([{ script: 'latn', tags: ['mark'] }], 'mark'), true);
        });

        it('throws on an invalid value', function() {
            assert.throws(() => isDefaultFeatureInMap({ mark: 'on' }, 'mark'), TypeError);
        });
    });

    describe('isDefaultFeatureEnabled', function() {
        it('turns a default feature with a mask off with 0 or false only, like a max_value of 0 in HarfBuzz', function() {
            for (const tag of ['isol', 'fina', 'medi', 'init', 'rtlm']) {
                const enabledValues = [undefined, true, 1, 2, 256, 512].map(value => isDefaultFeatureEnabled({ [tag]: value }, tag));
                assert.deepStrictEqual(enabledValues, [true, true, true, true, true, true], tag);
                assert.deepStrictEqual([false, 0].map(value => isDefaultFeatureEnabled({ [tag]: value }, tag)), [false, false], tag);
            }
        });

        it('turns any other default feature off when its value is 0, 256 included', function() {
            const enabledValues = [undefined, true, 2, 257, false, 0, 256].map(value => isDefaultFeatureEnabled({ liga: value }, 'liga'));
            assert.deepStrictEqual(enabledValues, [true, true, true, true, false, false, false]);
        });

        it('throws on an invalid value', function() {
            assert.throws(() => isDefaultFeatureEnabled({ fina: 'on' }, 'fina'), TypeError);
            assert.throws(() => isDefaultFeatureEnabled({ liga: -1 }, 'liga'), TypeError);
        });
    });

    describe('getEnabledFeatureTags', function() {
        it('gives the default tags the option does not turn off, then the tags it turns on', function() {
            const defaultTags = ['ccmp', 'liga', 'calt', 'rand'];
            assert.deepStrictEqual(getEnabledFeatureTags(defaultTags), defaultTags);
            assert.deepStrictEqual(getEnabledFeatureTags(defaultTags, [{ script: 'latn', tags: [] }]), defaultTags);
            assert.deepStrictEqual(
                getEnabledFeatureTags(defaultTags, { liga: false, calt: 0, rand: 1, ss01: true, cv01: 3, salt: 0, ss02: false, aalt: 256, ss03: undefined }),
                ['ccmp', 'rand', 'ss01', 'cv01']
            );
        });

        it('keeps a default form whose value is a multiple of 256, and leaves out a form that is not a default one', function() {
            // hb-shape --features=fina=256 -u 062A,062A,0020,062A gives teh.fina1 at the final teh, --script=latn
            // --features=fina=256 -u 062A,062A no teh.fina1
            const featuresOption = { fina: 256, init: 0, isol: false };
            assert.deepStrictEqual(getEnabledFeatureTags(['isol', 'fina', 'medi', 'init', 'rlig'], featuresOption), ['fina', 'medi', 'rlig']);
            assert.deepStrictEqual(getEnabledFeatureTags(['ccmp', 'liga'], featuresOption), ['ccmp', 'liga']);
        });

        it('throws on an invalid value of a tag that is not a default one', function() {
            assert.throws(() => getEnabledFeatureTags(['liga'], { ss01: 'on' }), TypeError);
        });
    });

    describe('getDirectionFeatureTags', function() {
        it('gives the direction features HarfBuzz enables in a run, from the direction of its script (hb_ot_shape_collect_features)', function() {
            for (const scriptTags of [['latn'], ['DFLT'], ['thai'], ['dev3', 'dev2', 'deva']]) {
                assert.deepStrictEqual(getDirectionFeatureTags(scriptTags), ['ltra', 'ltrm'], scriptTags.join());
            }
            for (const scriptTags of [['arab'], ['hebr'], ['syrc'], ['nko ']]) {
                assert.deepStrictEqual(getDirectionFeatureTags(scriptTags), ['rtla', 'rtlm'], scriptTags.join());
            }
        });
    });

    describe('getLookupJoinerFlags', function() {
        // the F_MANUAL_ZWNJ and F_MANUAL_ZWJ flags of the features of HarfBuzz 11.3.2: F_GLOBAL_MANUAL_JOINERS for mark and
        // mkmk (common_features, hb-ot-shape.cc) and the features of the Indic shaper (indic_features, hb-ot-shaper-indic.cc),
        // F_MANUAL_ZWJ for the features of the Arabic shaper (collect_features_arabic, hb-ot-shaper-arabic.cc)
        const autoJoiners = { autoZeroWidthNonJoiner: true, autoZeroWidthJoiner: true };
        const manualJoiners = { autoZeroWidthNonJoiner: false, autoZeroWidthJoiner: false };
        const manualZeroWidthJoiner = { autoZeroWidthNonJoiner: true, autoZeroWidthJoiner: false };

        it('skips both joiners in the lookups of most features and of the required feature only', function() {
            for (const tag of ['ccmp', 'liga', 'calt', 'kern', 'ss01']) {
                assert.deepStrictEqual(getLookupJoinerFlags('latn', [tag]), autoJoiners, tag);
            }
            assert.deepStrictEqual(getLookupJoinerFlags('latn', []), autoJoiners);
            assert.deepStrictEqual(getLookupJoinerFlags(undefined, ['liga']), autoJoiners);
        });

        it('skips no joiner in the lookups of mark and mkmk, nor of the features of the Indic shaper in its runs', function() {
            for (const shaper of ['latn', 'arab', 'thai', 'indic']) {
                assert.deepStrictEqual(getLookupJoinerFlags(shaper, ['mark']), manualJoiners, shaper);
                assert.deepStrictEqual(getLookupJoinerFlags(shaper, ['mkmk']), manualJoiners, shaper);
            }
            for (const tag of ['nukt', 'akhn', 'half', 'pres', 'blws', 'haln']) {
                assert.deepStrictEqual(getLookupJoinerFlags('indic', [tag]), manualJoiners, tag);
                assert.deepStrictEqual(getLookupJoinerFlags('latn', [tag]), autoJoiners, tag);
            }
        });

        it('skips no zero width joiner in the input of the lookups of the features of the Arabic shaper in its runs', function() {
            for (const tag of ['ccmp', 'locl', 'isol', 'fina', 'medi', 'init', 'rlig', 'calt', 'liga', 'clig', 'mset']) {
                assert.deepStrictEqual(getLookupJoinerFlags('arab', [tag]), manualZeroWidthJoiner, tag);
            }
            assert.deepStrictEqual(getLookupJoinerFlags('arab', ['kern']), autoJoiners);
        });

        it('skips the zero width joiner in the input of the other features of an Arabic run, like HarfBuzz', function() {
            // a font of one feature arab F { sub lam alef by lam_alef; } (fontTools feaLib), hb-shape --shapers=ot
            // --no-glyph-names --cluster-level=1 --features=+F F.ttf -u 0644,200D,0627: [1=0+0|4=0+500] for rclt, dlig and ss01,
            // the ligature across the joiner; [3=2+500|1=1+0|2=0+500] for liga, clig, calt, rlig, ccmp, locl and mset
            for (const tag of ['rclt', 'dlig', 'ss01']) {
                assert.deepStrictEqual(getLookupJoinerFlags('arab', [tag]), autoJoiners, tag);
            }
            for (const tag of ['liga', 'clig', 'calt', 'rlig', 'ccmp', 'locl', 'mset']) {
                assert.deepStrictEqual(getLookupJoinerFlags('arab', [tag]), manualZeroWidthJoiner, tag);
            }
            // the lookup in liga and in rclt: [3=2+500|1=1+0|2=0+500], and with --features=-liga [1=0+0|4=0+500]
            assert.deepStrictEqual(getLookupJoinerFlags('arab', ['liga', 'rclt']), manualZeroWidthJoiner);
        });

        it('skips a joiner in a lookup of several features only when each of them does, like the map of HarfBuzz', function() {
            // hb_ot_map_builder_t::compile: lookups[j].auto_zwnj &= lookups[i].auto_zwnj, the same for auto_zwj
            assert.deepStrictEqual(getLookupJoinerFlags('latn', ['kern', 'mark']), manualJoiners);
            assert.deepStrictEqual(getLookupJoinerFlags('arab', ['kern', 'liga']), manualZeroWidthJoiner);
        });
    });
});
