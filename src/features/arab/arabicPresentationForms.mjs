/**
 * Apply an Arabic presentation form to the letters of an Arabic script run that take it, from their Unicode Joining_Type
 */

import { getArabicJoiningType } from '../../char.mjs';
import { applyLookupToTokens, getFeaturesLookups } from '../applySubstitution.mjs';

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
 * Apply an arabic presentation form to the letters of an arabic script run that take it (see getArabicJoiningForms):
 * like HarfBuzz with the form mask, each lookup of the form feature applies in lookup list order over the glyphs of the
 * whole run (see applyLookupToTokens), its rules and ligatures starting at the glyphs of the tokens that take the form
 * only, each glyph of a multiple substitution (e.g. of ccmp) included, the other glyphs in the context of its rules.
 * Unlike HarfBuzz, whose form mask applies to every input glyph, the later input glyphs of a rule and the components of
 * a ligature are matched whatever their form. With the required feature of the language system in the stage of the
 * form, its lookups join the lookups of the form in lookup list order and apply at every glyph, like the global mask
 * that HarfBuzz gives them (see getFeaturesLookups)
 * @param {Token[]} tokens the tokens of the run
 * @param {string} script the script tag of the run in the GSUB table
 * @param {string} tag the form feature tag: isol, fina, medi or init
 * @param {boolean} [withRequiredFeature=false] whether the required feature applies in the stage of the form
 */
function arabicPresentationForms(tokens, script, tag, withRequiredFeature = false) {
    const forms = getArabicJoiningForms(tokens.map(token => token.char));
    const formTokens = new Set(tokens.filter((token, index) => forms[index] === tag));
    const isFormToken = token => formTokens.has(token);
    const isAnyToken = () => true;
    const lookups = getFeaturesLookups(this.query, [tag], script, this.language, withRequiredFeature);
    for (const { lookupTable, isRequiredFeatureLookup } of lookups) {
        applyLookupToTokens(this.query, lookupTable, tag, tokens, isRequiredFeatureLookup ? isAnyToken : isFormToken);
    }
}

export default arabicPresentationForms;
export { arabicPresentationForms };
