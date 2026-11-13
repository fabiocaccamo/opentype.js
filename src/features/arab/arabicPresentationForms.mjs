/**
 * Apply an Arabic presentation form to the letters of an Arabic script run that take it, from their Unicode Joining_Type
 */

import { getArabicJoiningType } from '../../char.mjs';
import { applyLookupToTokens, getFeaturesLookups, getLookupFeatureValue } from '../applySubstitution.mjs';
import { getMaskedFeatureValue, getUnmaskedFeatureValue } from '../featureValues.mjs';

/**
 * The form of a joining letter, by whether it joins the letter before it and the letter after it
 * @param {boolean} joinsPrevious
 * @param {boolean} joinsNext
 * @returns {string} the form feature tag
 */
function getJoiningForm(joinsPrevious, joinsNext) {
    if (joinsPrevious) {
        return joinsNext ? 'medi' : 'fina';
    }
    return joinsNext ? 'init' : 'isol';
}

/**
 * The presentation form of each char of an arabic script run, like the joining of the Arabic shaper of HarfBuzz
 * (arabic_joining): a dual-joining or right-joining letter (see getArabicJoiningType) joins the letter before it when
 * that one is dual-joining, and the letter after it when it is dual-joining itself and the next letter joins, the
 * transparent chars between them skipped; the transparent and the non-joining chars (e.g. the spaces) take no form,
 * and a non-joining char breaks the joining
 * @param {string[]} chars the chars of the run
 * @returns {Array<string|undefined>} the form feature tag of each char
 */
function getArabicJoiningForms(chars) {
    const joiningTypes = chars.map(getArabicJoiningType);
    const joiningIndexes = [];
    for (let i = 0; i < chars.length; i++) {
        if (joiningTypes[i] !== 'T') {
            joiningIndexes.push(i);
        }
    }
    const forms = new Array(chars.length);
    for (let i = 0; i < joiningIndexes.length; i++) {
        const joiningType = joiningTypes[joiningIndexes[i]];
        if (joiningType === 'U') {
            continue;
        }
        const previousType = i > 0 ? joiningTypes[joiningIndexes[i - 1]] : 'U';
        const nextType = i + 1 < joiningIndexes.length ? joiningTypes[joiningIndexes[i + 1]] : 'U';
        const joinsNext = joiningType === 'D' && (nextType === 'D' || nextType === 'R');
        forms[joiningIndexes[i]] = getJoiningForm(previousType === 'D', joinsNext);
    }
    return forms;
}

/**
 * The value of an arabic form at the glyphs of a token, like the mask HarfBuzz gives them: at a letter that takes the
 * form, the value of the mask of the form (see getMaskedFeatureValue), so the value 2 that the features option gives
 * to fina is 3 at a final letter; at the other glyphs, the value the features option gives the form, like a feature of
 * the option of HarfBuzz, which applies at every glyph (see getUnmaskedFeatureValue), none (null) without it or when
 * its 8 lowest bits are 0
 * @param {Object|Array|undefined} featuresOption the features option (see GlyphRenderOptions.features)
 * @param {string} tag the form feature tag: isol, fina, medi or init
 * @param {boolean} isFormToken whether the token takes the form
 * @returns {number|null}
 */
function getFormTokenFeatureValue(featuresOption, tag, isFormToken) {
    if (isFormToken) {
        return getMaskedFeatureValue(featuresOption, tag);
    }
    const featureValue = getUnmaskedFeatureValue(featuresOption, tag);
    return featureValue === 0 ? null : featureValue;
}

/**
 * Apply an arabic presentation form to the letters of an arabic script run that take it (see getArabicJoiningForms):
 * like HarfBuzz with the form mask, each lookup of the form feature applies in lookup list order over the glyphs of the
 * whole run (see applyLookupToTokens), its rules and ligatures starting at the glyphs of the tokens that take the form,
 * each glyph of a multiple substitution (e.g. of ccmp) included, the other glyphs in the context of its rules; when
 * the features option sets the form, at every glyph too, like a feature of the option of HarfBuzz (see
 * getFormTokenFeatureValue). Unlike HarfBuzz, whose form mask applies to every input glyph, the later input glyphs of a
 * rule and the components of a ligature are matched whatever their form. With the required feature of the language
 * system in the stage of the form, its lookups join the lookups of the form in lookup list order and apply at every
 * glyph, like the global mask that HarfBuzz gives them (see getFeaturesLookups and getLookupFeatureValue)
 * @param {Token[]} tokens the tokens of the run
 * @param {string} script the script tag of the run in the GSUB table
 * @param {string} tag the form feature tag: isol, fina, medi or init
 * @param {boolean} [withRequiredFeature=false] whether the required feature applies in the stage of the form
 */
function arabicPresentationForms(tokens, script, tag, withRequiredFeature = false) {
    const forms = getArabicJoiningForms(tokens.map(token => token.char));
    const formTokens = new Set(tokens.filter((token, index) => forms[index] === tag));
    const featuresOption = this.query.featuresOption;
    const getTokenFormValue = token => getFormTokenFeatureValue(featuresOption, tag, formTokens.has(token));
    const lookups = getFeaturesLookups(this.query, [tag], script, this.language, withRequiredFeature);
    for (const featureLookup of lookups) {
        const lookupTable = featureLookup.lookupTable;
        if (featureLookup.isRequiredFeatureLookup) {
            const requiredValue = getLookupFeatureValue(this.query, featureLookup);
            applyLookupToTokens(this.query, lookupTable, tag, tokens, () => requiredValue);
        } else {
            applyLookupToTokens(this.query, lookupTable, tag, tokens, getTokenFormValue);
        }
    }
}

export default arabicPresentationForms;
export { arabicPresentationForms, getFormTokenFeatureValue };
