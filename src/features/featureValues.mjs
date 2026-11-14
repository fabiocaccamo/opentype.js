/**
 * The values of the features of a features option (see GlyphRenderOptions.features), like the values of the features
 * of HarfBuzz: a feature is on with a value other than 0, and its value is the alternate index of its alternate
 * substitutions (GSUB lookup type 3), like font-feature-settings
 */

import { isRightToLeftScript } from '../layout.mjs';

// the feature whose alternate substitutions take a random alternate at its default value, like HarfBuzz (F_RANDOM)
const RANDOM_FEATURE_TAG = 'rand';
// like HarfBuzz (HB_OT_MAP_MAX_BITS and HB_OT_MAP_MAX_VALUE), a feature value keeps its 8 lowest bits, and the
// highest one is the default value of rand
const MAX_FEATURE_VALUE = 0xFF;

// the direction features HarfBuzz enables by default in the runs of each direction (hb_ot_shape_collect_features)
const LEFT_TO_RIGHT_FEATURE_TAGS = ['ltra', 'ltrm'];
const RIGHT_TO_LEFT_FEATURE_TAGS = ['rtla', 'rtlm'];

// the arabic presentation forms, in the order of the Arabic shaper of HarfBuzz (collect_features_arabic)
const ARABIC_FORM_TAGS = ['isol', 'fina', 'medi', 'init'];
// the default features that HarfBuzz gives a mask of their own at some glyphs of a run, with the value 1: the arabic
// forms at the letters of each form (the mask_array of its Arabic shaper), rtlm at the glyphs it does not mirror
// (rtlm_mask), every glyph of a run of a right-to-left script (no character is mirrored yet)
const GLYPH_MASK_FEATURE_TAGS = ARABIC_FORM_TAGS.concat(['rtlm']);

/**
 * The feature values that a features option sets
 * @param {Object|Array|undefined} featuresOption feature tags with their value; the defaults when absent (or a
 * features list)
 * @returns {Object}
 */
function getFeatureOverrides(featuresOption) {
    return featuresOption && !Array.isArray(featuresOption) ? featuresOption : {};
}

/**
 * The number a features option gives a feature, like the max_value of a feature of HarfBuzz: 1 for true, 0 for false
 * @param {string} tag
 * @param {boolean|number} optionValue a boolean or an integer from 0
 * @returns {number}
 */
function getFeatureOptionNumber(tag, optionValue) {
    if (typeof optionValue === 'boolean') {
        return optionValue ? 1 : 0;
    }
    if (Number.isInteger(optionValue) && optionValue >= 0) {
        return optionValue;
    }
    throw new TypeError(
        `The value of the feature ${tag} must be a boolean or an integer from 0, not ${typeof optionValue} ${String(optionValue)}`
    );
}

/**
 * The value of a feature in a features option, like the value of a feature of HarfBuzz: the 8 lowest bits of its
 * number (see getFeatureOptionNumber), so 256 is 0, like HarfBuzz
 * @param {string} tag
 * @param {boolean|number} optionValue a boolean or an integer from 0
 * @returns {number} from 0 to 255
 */
function getFeatureOptionValue(tag, optionValue) {
    return getFeatureOptionNumber(tag, optionValue) & MAX_FEATURE_VALUE;
}

/**
 * The value of a feature with a features option: the value the option sets (see getFeatureOptionValue), otherwise
 * its default value, like HarfBuzz: 255 for rand (its alternate substitutions take a random alternate), 1 otherwise
 * @param {Object|Array|undefined} featuresOption
 * @param {string} tag
 * @returns {number}
 */
function getFeatureValue(featuresOption, tag) {
    const optionValue = getFeatureOverrides(featuresOption)[tag];
    if (optionValue !== undefined) {
        return getFeatureOptionValue(tag, optionValue);
    }
    return tag === RANDOM_FEATURE_TAG ? MAX_FEATURE_VALUE : 1;
}

/**
 * The value of a feature with a glyph mask (see GLYPH_MASK_FEATURE_TAGS) at the glyphs outside its mask, like
 * HarfBuzz, which gives a feature of the features option to every glyph: the value the option sets (see
 * getFeatureOptionValue), 0 without it
 * @param {Object|Array|undefined} featuresOption
 * @param {string} tag
 * @returns {number}
 */
function getUnmaskedFeatureValue(featuresOption, tag) {
    const optionValue = getFeatureOverrides(featuresOption)[tag];
    return optionValue === undefined ? 0 : getFeatureOptionValue(tag, optionValue);
}

/**
 * The value of a feature with a glyph mask (see GLYPH_MASK_FEATURE_TAGS) at the glyphs of its mask, like HarfBuzz:
 * the value 1 of the mask joins the value at the other glyphs (see getUnmaskedFeatureValue), so fina 2 is 3 at a
 * final letter, and fina 256 is 1 there
 * @param {Object|Array|undefined} featuresOption
 * @param {string} tag
 * @returns {number}
 */
function getMaskedFeatureValue(featuresOption, tag) {
    return getUnmaskedFeatureValue(featuresOption, tag) | 1;
}

/**
 * The value of a feature at every glyph of a run (all the features but the arabic forms, see
 * arabicPresentationForms): the value of the mask of rtlm in a run whose direction features have it (see
 * getMaskedFeatureValue and GLYPH_MASK_FEATURE_TAGS), the value of the feature otherwise (see getFeatureValue)
 * @param {Object|Array|undefined} featuresOption
 * @param {string} tag
 * @param {string[]} directionTags the direction features of the run (see getDirectionFeatureTags)
 * @returns {number}
 */
function getRunFeatureValue(featuresOption, tag, directionTags) {
    if (directionTags.includes(tag) && GLYPH_MASK_FEATURE_TAGS.includes(tag)) {
        return getMaskedFeatureValue(featuresOption, tag);
    }
    return getFeatureValue(featuresOption, tag);
}

/**
 * Whether a default feature is in the feature map of HarfBuzz with a features option, like a feature whose max_value
 * is not 0: unless the option turns it off with 0 or false, whatever the 8 lowest bits of the option (see
 * getFeatureOptionNumber), so 256 keeps it in the map, with the value 0
 * @param {Object|Array|undefined} featuresOption
 * @param {string} tag
 * @returns {boolean}
 */
function isDefaultFeatureInMap(featuresOption, tag) {
    const optionValue = getFeatureOverrides(featuresOption)[tag];
    return optionValue === undefined || getFeatureOptionNumber(tag, optionValue) > 0;
}

/**
 * Whether a default feature of a run is on with a features option, like a feature of HarfBuzz whose max_value is not
 * 0 and that has a value at some glyphs: a feature with a glyph mask (see GLYPH_MASK_FEATURE_TAGS) when it is in the
 * feature map (see isDefaultFeatureInMap), its mask giving it a value at its glyphs whatever the 8 lowest bits of the
 * option (see getMaskedFeatureValue), any other feature when its value is not 0 (see getFeatureValue), so 256 turns
 * it off
 * @param {Object|Array|undefined} featuresOption
 * @param {string} tag
 * @returns {boolean}
 */
function isDefaultFeatureEnabled(featuresOption, tag) {
    if (!GLYPH_MASK_FEATURE_TAGS.includes(tag)) {
        return getFeatureValue(featuresOption, tag) > 0;
    }
    return isDefaultFeatureInMap(featuresOption, tag);
}

/**
 * The feature tags of a features option: the default ones it does not turn off (see isDefaultFeatureEnabled), then
 * the other ones it turns on (a value other than 0, see getFeatureOptionValue)
 * @param {string[]} defaultTags
 * @param {Object|Array|undefined} featuresOption feature tags with their value (a boolean or an integer); the
 * defaults when absent (or a features list)
 * @returns {string[]}
 */
function getEnabledFeatureTags(defaultTags, featuresOption) {
    const overrides = getFeatureOverrides(featuresOption);
    const tags = defaultTags.filter(tag => isDefaultFeatureEnabled(overrides, tag));
    for (const tag of Object.keys(overrides)) {
        if (overrides[tag] !== undefined && getFeatureValue(overrides, tag) > 0 && !tags.includes(tag)) {
            tags.push(tag);
        }
    }
    return tags;
}

/**
 * The direction features HarfBuzz enables by default in a script run, from the horizontal direction of its script
 * (see isRightToLeftScript), whatever the order its glyphs are laid out in: rtla and rtlm in a run of a right-to-left
 * script (Arabic, Hebrew, Syriac...), ltra and ltrm otherwise
 * @param {string[]} scriptTags the OpenType script tags of the run (see getOpenTypeScriptTags)
 * @returns {string[]}
 */
function getDirectionFeatureTags(scriptTags) {
    return isRightToLeftScript(scriptTags) ? RIGHT_TO_LEFT_FEATURE_TAGS : LEFT_TO_RIGHT_FEATURE_TAGS;
}

export {
    RANDOM_FEATURE_TAG,
    MAX_FEATURE_VALUE,
    ARABIC_FORM_TAGS,
    getFeatureValue,
    getUnmaskedFeatureValue,
    getMaskedFeatureValue,
    getRunFeatureValue,
    isDefaultFeatureInMap,
    isDefaultFeatureEnabled,
    getEnabledFeatureTags,
    getDirectionFeatureTags
};
