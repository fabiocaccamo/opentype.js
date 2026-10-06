/**
 * Apply the enabled GSUB features of the latin script, like HarfBuzz does: the
 * lookups of all the features are applied one after the other in lookup list order,
 * each one to the whole run of text, and not feature by feature.
 */

import { ContextParams } from '../../tokenizer.mjs';
import applySubstitution from '../applySubstitution.mjs';
import { isArabicChar, isThaiChar } from '../../char.mjs';

/**
 * Check if a character belongs to the runs the latin features apply to
 * @param {string} char
 * @returns {boolean}
 */
function isLatinRunChar(char) {
    return !isArabicChar(char) && !isThaiChar(char);
}

/**
 * Split the tokens into the runs the latin features apply to: the maximal sequences
 * of characters that are not shaped by the arabic or thai features, so that
 * spaces, digits and punctuation (e.g. the code ligatures of "->") are included.
 * @param {Token[]} tokens
 * @returns {Token[][]}
 */
function getLatinRuns(tokens) {
    const runs = [];
    let run = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!isLatinRunChar(token.char)) {
            if (run.length) runs.push(run);
            run = [];
        } else {
            run.push(token);
        }
    }
    if (run.length) runs.push(run);
    return runs;
}

/**
 * Get the lookups of the enabled features in lookup list order, each one with the
 * tag of the (first) feature it belongs to.
 * @param {string[]} tags enabled feature tags
 * @returns {Array<{lookupTable: any, tag: string}>}
 */
function getFeaturesLookups(tags) {
    const script = 'latn';
    const lookupTags = new Map();
    for (let i = 0; i < tags.length; i++) {
        const feature = this.query.getFeature({ tag: tags[i], script });
        if (!feature || !feature.lookupListIndexes) continue;
        for (let j = 0; j < feature.lookupListIndexes.length; j++) {
            const lookupIndex = feature.lookupListIndexes[j];
            if (!lookupTags.has(lookupIndex)) {
                lookupTags.set(lookupIndex, tags[i]);
            }
        }
    }
    const lookupIndexes = Array.from(lookupTags.keys()).sort((indexA, indexB) => indexA - indexB);
    const lookups = [];
    for (let i = 0; i < lookupIndexes.length; i++) {
        const lookupTable = this.query.getLookupByIndex(lookupIndexes[i]);
        if (lookupTable) {
            lookups.push({ lookupTable, tag: lookupTags.get(lookupIndexes[i]) });
        }
    }
    return lookups;
}

/**
 * Get the coverage tables of the first glyph of the subtables of a lookup, or null
 * when a subtable has none (the lookup is then tried at every glyph)
 * @param {any} lookupTable
 * @returns {any[]|null}
 */
function getLookupFirstGlyphCoverages(lookupTable) {
    const coverages = [];
    for (let i = 0; i < lookupTable.subtables.length; i++) {
        const subtable = lookupTable.lookupType === 7 ? lookupTable.subtables[i].extension : lookupTable.subtables[i];
        const coverage = subtable && (subtable.coverage ||
            (subtable.inputCoverage && subtable.inputCoverage[0]) ||
            (subtable.coverages && subtable.coverages[0]));
        if (!coverage) return null;
        coverages.push(coverage);
    }
    return coverages;
}

/**
 * Apply a lookup to every glyph of a run, from the first one: the glyphs deleted by
 * a ligature are not part of the context any more.
 * @param {any} lookupTable
 * @param {string} tag
 * @param {Token[]} runTokens
 */
function applyLookup(lookupTable, tag, runTokens) {
    const layout = this.query.font.substitution;
    const coverages = getLookupFirstGlyphCoverages(lookupTable);
    // a glyph no subtable covers cannot start a substitution: skip it without building its context
    const isCovered = value => {
        if (!coverages) return true;
        const glyphIndex = Array.isArray(value) ? value[0] : value;
        return coverages.some(coverage => layout.getCoverageIndex(coverage, glyphIndex) >= 0);
    };
    let activeTokens = runTokens.filter(token => !token.state.deleted);
    let contextParams = new ContextParams(activeTokens.map(token => token.activeState.value), 0);
    for (let index = 0; index < activeTokens.length; index++) {
        if (!isCovered(contextParams.context[index])) continue;
        contextParams.setCurrentIndex(index);
        const action = this.query.lookupSubstitution(lookupTable, contextParams, tag);
        if (action) {
            applySubstitution(action, activeTokens, index);
            activeTokens = runTokens.filter(token => !token.state.deleted);
            contextParams = new ContextParams(activeTokens.map(token => token.activeState.value), index);
        }
    }
}

/**
 * Apply the enabled latin features to the text
 */
function latinFeatures() {
    const tags = this.featuresTags.latn || [];
    if (!tags.length) return;
    const lookups = getFeaturesLookups.call(this, tags);
    if (!lookups.length) return;
    const runs = getLatinRuns(this.tokenizer.tokens);
    for (let i = 0; i < lookups.length; i++) {
        for (let j = 0; j < runs.length; j++) {
            applyLookup.call(this, lookups[i].lookupTable, lookups[i].tag, runs[j]);
        }
    }
}

export default latinFeatures;
export { isLatinRunChar };
