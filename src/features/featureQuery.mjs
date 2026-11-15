/**
 * Query a feature by some of it's properties to lookup a glyph substitution.
 */

import {
    getCoverageIndex, getLayoutGdefTable, isGlyphIgnoredByLookup, matchGlyphSequence, matchesGlyphIndex,
    getRequiredFeatureIndex, matchSequenceContext, matchChainedSequenceContext, getCachedLayoutValue,
    createIgnorableMatching, NO_IGNORABLE_MATCHING, getLookupTableSubtables
} from '../layout.mjs';
import { DEFAULT_IGNORABLE_TYPES } from '../char.mjs';
import { warnOncePerFont } from '../util.mjs';
import { RANDOM_FEATURE_TAG, MAX_FEATURE_VALUE, getRunFeatureValue } from './featureValues.mjs';

// the random state of a buffer of HarfBuzz when it starts (hb_buffer_t::clear)
const INITIAL_RANDOM_STATE = 1;

// the most glyphs a buffer of HarfBuzz can grow to, per character and at least (HB_BUFFER_MAX_LEN_FACTOR and
// HB_BUFFER_MAX_LEN_MIN, the max_len of hb_buffer_t::enter)
const MAX_GLYPH_COUNT_FACTOR = 64;
const MIN_MAX_GLYPH_COUNT = 16384;

/**
 * Create feature query instance
 * @param {Font} font opentype font instance
 * @param {Object} [variation] variation coordinates of the GSUB feature variations, the current variation of the font if omitted
 * @param {Object|Array} [featuresOption] the features option (see GlyphRenderOptions.features), whose values are the
 * alternate indexes of the alternate substitutions of the features (see getFeatureValue in featureValues.mjs); the
 * defaults when absent (or a features list)
 */
function FeatureQuery(font, variation, featuresOption) {
    this.font = font;
    this.variation = variation;
    this.featuresOption = featuresOption;
    // the GSUB feature variation record of the variation (see getFeatureVariationIndex), once computed
    this.featureVariationIndex = undefined;
    // the random state, the direction features, the maximum number of glyphs and whether a lookup went past it, and the
    // shaper of the run being shaped (see startScriptRun)
    this.startScriptRun([], 0);
}

/**
 * The feature a lookup applies for, like the lookup mask of HarfBuzz
 * @typedef LookupFeature
 * @type Object
 * @property {string} tag the feature tag
 * @property {function(number): number} getValue the value of the feature (see getFeatureValue) at the glyph at a
 * position of the context of the lookup, like the mask HarfBuzz gives the glyph: the alternate index there of the
 * alternate substitutions of the lookup and of the lookups its contextual rules apply
 */

/**
 * @typedef SubstitutionAction
 * @type Object
 * @property {number} id substitution type
 * @property {string} tag feature tag
 * @property {any} substitution substitution value(s)
 */

/**
 * Create a substitution action instance
 * @param {SubstitutionAction} action
 */
function SubstitutionAction(action) {
    this.id = action.id;
    this.tag = action.tag;
    this.substitution = action.substitution;
}

/**
 * Lookup a coverage table with the binary search of the GSUB and GPOS lookups and of HarfBuzz (see getCoverageIndex in
 * layout.mjs): like HarfBuzz, the glyph 0 (.notdef) is covered like any other glyph
 * @param {number|null} glyphIndex glyph index, null for a character with no glyph in a font without cmap (see
 * DefaultEncoding.charToGlyphIndex), which no coverage table covers
 * @param {CoverageTable} coverage coverage table
 * @returns {number} -1 if not found
 */
function lookupCoverage(glyphIndex, coverage) {
    if (typeof glyphIndex !== 'number') {
        return -1;
    }
    return getCoverageIndex(coverage, glyphIndex);
}

/**
 * Handle a single substitution - format 1
 * @param {number} glyphIndex glyph index
 * @param {any} subtable subtable
 */
function singleSubstitutionFormat1(glyphIndex, subtable) {
    let substituteIndex = lookupCoverage(glyphIndex, subtable.coverage);
    if (substituteIndex === -1) return null;
    // the delta addition is modulo 65536
    return (glyphIndex + subtable.deltaGlyphId) & 0xFFFF;
}

/**
 * Handle a single substitution - format 2
 * @param {number} glyphIndex glyph index
 * @param {any} subtable subtable
 */
function singleSubstitutionFormat2(glyphIndex, subtable) {
    let substituteIndex = lookupCoverage(glyphIndex, subtable.coverage);
    if (substituteIndex === -1) return null;
    return subtable.substitute[substituteIndex];
}

/**
 * Handle alternate substitution - format 1
 * @param {number} glyphIndex glyph index
 * @param {any} subtable subtable
 * @returns {number[]|null|undefined} the alternates of the glyph, null if the subtable does not cover it, undefined for
 * a NULL AlternateSet offset, which has no alternate like the empty AlternateSet of HarfBuzz
 */
function alternateSubstitutionFormat1(glyphIndex, subtable) {
    const alternateSetIndex = lookupCoverage(glyphIndex, subtable.coverage);
    if (alternateSetIndex === -1) {
        return null;
    }
    return subtable.alternateSets[alternateSetIndex];
}

// nested lookup types (lookupType + substFormat) a contextual rule can apply: single substitution format 1 and 2,
// multiple substitution format 1, alternate substitution format 1, ligature substitution format 1
const NESTED_SUBSTITUTION_TYPES = ['11', '12', '21', '31', '41'];
// the substitutions that replace a glyph with one glyph: the single substitutions, and the alternate substitution,
// whose substitution is the alternate it chose
const SINGLE_SUBSTITUTION_IDS = [11, 12, 31];
const MULTIPLE_SUBSTITUTION_ID = 21;
const LIGATURE_SUBSTITUTION_ID = 41;

/**
 * The substitution of a lookup at a glyph (see FeatureQuery.getLookupSubstitution)
 * @typedef LookupSubstitution
 * @type Object
 * @property {number} id substitution type (lookupType + substFormat), as the id of a SubstitutionAction
 * @property {any} substitution substitution value(s)
 */

/**
 * The substitution of a nested lookup of a matched contextual rule
 * @typedef NestedSubstitution
 * @type Object
 * @property {number} offset the offset from the current glyph of the glyph it applies at, in the glyph sequence that
 * the previous nested substitutions left
 * @property {number} id substitution type: single, multiple, alternate or ligature (see NESTED_SUBSTITUTION_TYPES)
 * @property {any} substitution substitution value(s)
 */

/**
 * The substitutions of a matched contextual rule
 * @typedef ContextualMatch
 * @type Object
 * @property {NestedSubstitution[]} substitutions the substitutions of its nested lookups, in the order they apply;
 * empty if nothing is substituted
 * @property {number} inputLength the number of glyphs, from the current one, that the lookup goes on after: up to the
 * last input glyph after the substitutions, the glyphs the lookup skips counted, but like HarfBuzz never ending before
 * the glyph a nested lookup applied at, so after a nested ligature that takes glyphs past the input it ends before the
 * ligature glyph (0 when it is the current glyph)
 */

/**
 * The replacement of a glyph by a substitution (see getSubstitutionGlyphEdits)
 * @typedef GlyphEdit
 * @type Object
 * @property {number} offset the offset of the glyph from the current glyph of the substitution
 * @property {number[]} glyphIndexes the glyphs that replace it, none deletes it
 */

/**
 * Get the glyph edits of a single, multiple, alternate or ligature substitution, in the order they apply: the glyph
 * becomes the glyph of a single substitution, the alternate of an alternate substitution or the glyphs of a multiple
 * substitution; the other components of a ligature are deleted from the last one, so that the offsets of the other
 * ones still point to their glyph, then its first component becomes the ligature glyph
 * @param {LookupSubstitution|SubstitutionAction} lookupSubstitution
 * @returns {GlyphEdit[]}
 */
function getSubstitutionGlyphEdits(lookupSubstitution) {
    const { id, substitution } = lookupSubstitution;
    if (SINGLE_SUBSTITUTION_IDS.includes(id)) {
        return [{ offset: 0, glyphIndexes: [substitution] }];
    }
    if (id === MULTIPLE_SUBSTITUTION_ID) {
        return [{ offset: 0, glyphIndexes: substitution }];
    }
    if (id === LIGATURE_SUBSTITUTION_ID) {
        const componentEdits = substitution.componentOffsets.map(offset => ({ offset, glyphIndexes: [] })).reverse();
        return componentEdits.concat([{ offset: 0, glyphIndexes: [substitution.ligGlyph] }]);
    }
    throw new Error(`The substitution type ${id} does not replace glyphs`);
}

/**
 * The change of the number of glyphs of a nested substitution (single, multiple, alternate or ligature)
 * @param {LookupSubstitution} nestedSubstitution
 * @returns {number}
 */
function getSubstitutionLengthChange(nestedSubstitution) {
    let lengthChange = 0;
    for (const glyphEdit of getSubstitutionGlyphEdits(nestedSubstitution)) {
        lengthChange += glyphEdit.glyphIndexes.length - 1;
    }
    return lengthChange;
}

/**
 * Substitute the values of the glyphs of a nested substitution in a list of values of glyphs, the glyphs the following
 * lookup records of the rule see, with the glyph edits that applySubstitution applies to the glyph sequence of the
 * tokens: the glyph indexes themselves; the context positions of the glyphs, the glyphs that replace a glyph coming
 * from its position in the context, like the glyphs of HarfBuzz, which keep its mask; the kinds of default ignorable of
 * the glyphs, a substituted glyph being none
 * @param {Array} glyphValues a value of each glyph
 * @param {number} position the position of the glyph the substitution applies at
 * @param {LookupSubstitution} nestedSubstitution
 * @param {function(number, any): any} getReplacementValue the value of a glyph that replaces a glyph, from its glyph
 * index and the value of the glyph it replaces
 */
function substituteGlyphValues(glyphValues, position, nestedSubstitution, getReplacementValue) {
    for (const glyphEdit of getSubstitutionGlyphEdits(nestedSubstitution)) {
        const replacedValue = glyphValues[position + glyphEdit.offset];
        const replacementValues = glyphEdit.glyphIndexes.map(glyphIndex => getReplacementValue(glyphIndex, replacedValue));
        glyphValues.splice(position + glyphEdit.offset, 1, ...replacementValues);
    }
}

/**
 * The context params of a nested lookup at a glyph, with what a single, multiple, alternate or ligature
 * substitution reads (the context, the index and the current glyph), without the backtrack and the lookahead
 * copies of a ContextParams
 * @param {number[]} glyphIndexes
 * @param {number} index the index of the glyph the nested lookup applies at
 * @returns {{context: number[], index: number, current: number}}
 */
function createNestedContextParams(glyphIndexes, index) {
    return { context: glyphIndexes, index, current: glyphIndexes[index] };
}

/**
 * Update the positions of the input glyphs of a contextual rule after a nested substitution at the input glyph of a
 * sequence index, like HarfBuzz (apply_lookup) when the number of glyphs grows or a ligature shortens it: the glyphs
 * a multiple substitution adds are input glyphs after it, and a ligature removes as many input glyphs after it as
 * the components it removed (the input glyphs left, if fewer), whichever glyphs these components were, then the
 * positions of the following input glyphs move by the change of the number of glyphs. A multiple substitution into
 * no glyph removes the input glyph itself (see applyNestedLookupRecords).
 * @param {number[]} inputPositions positions of the input glyphs, updated
 * @param {number} sequenceIndex the index of the input glyph the substitution applied at
 * @param {number} lengthChange the change of the number of glyphs (see getSubstitutionLengthChange)
 * @param {boolean} isDeletion whether the substitution deleted the glyph
 */
function updateInputPositions(inputPositions, sequenceIndex, lengthChange, isDeletion) {
    let firstMovedIndex = sequenceIndex + 1;
    if (isDeletion) {
        inputPositions.splice(sequenceIndex, 1);
        firstMovedIndex = sequenceIndex;
    } else if (lengthChange > 0) {
        const addedPositions = [];
        for (let i = 1; i <= lengthChange; i++) {
            addedPositions.push(inputPositions[sequenceIndex] + i);
        }
        inputPositions.splice(sequenceIndex + 1, 0, ...addedPositions);
        firstMovedIndex = sequenceIndex + 1 + lengthChange;
    } else {
        inputPositions.splice(sequenceIndex + 1, -lengthChange);
    }
    for (let i = firstMovedIndex; i < inputPositions.length; i++) {
        inputPositions[i] += lengthChange;
    }
}

/**
 * Apply the nested lookups of a matched contextual rule to its input sequence, like HarfBuzz (apply_lookup).
 * Each lookup record applies its lookup at the glyph at its sequence index, the index of the glyph
 * in the matched input (the glyphs the lookup skips are not counted), in record order,
 * so a record sees the substitutions of the previous ones; the first subtable of the lookup that
 * substitutes the glyph wins, nested lookups of other types are skipped. Like HarfBuzz, the glyphs of
 * a nested multiple substitution are glyphs of their own in the input sequence of the
 * following records. A nested ligature matches its components from the glyph with its own lookupFlag,
 * among all the glyphs after it (the input glyphs, the glyphs the rule skips, the glyphs after the
 * input), and the following records see the input sequence of HarfBuzz (see updateInputPositions).
 * A glyph a multiple substitution deletes (a sequence of no glyph, which the OpenType
 * specification prohibits) leaves the input sequence, and the sequence index of the
 * following records counts on the updated sequence, the results of the previous records
 * of the specification. HarfBuzz instead keeps the match position of the deleted glyph, which
 * then points at the next glyph of the buffer, and drops the match position of the next input
 * glyph, none when the deleted glyph is the last input glyph (its source calls it an approximation),
 * so a following record at that index substitutes the glyph after the deleted one, and a record at
 * a later index the same input glyph as in the fork. The two differ when the lookup skips glyphs
 * between the input glyphs (the fork substitutes the next input glyph) and when the deleted glyph
 * is the last input glyph (HarfBuzz substitutes the glyph after the input, the fork skips the record).
 * Like HarfBuzz, whose nested lookups keep the lookup mask of the contextual lookup and read the mask of the glyph they
 * apply at, a nested alternate substitution takes the alternate of the value of the feature of the contextual lookup
 * at that glyph (see getAlternate), the value at the glyph it comes from for a glyph of a previous record; and like
 * HarfBuzz, whose nested lookups keep the joiner flags of the contextual lookup, a nested ligature skips the default
 * ignorables like it (see IgnorableMatching in layout.mjs), but the glyphs a previous record substituted.
 * @param {ContextParams} contextParams context params of the rule, its current glyph is the first input glyph
 * @param {number[]} inputPositions positions of the matched input glyphs in the context, the current one first
 * @param {any[]} lookupRecords lookup records of the matched rule
 * @param {LookupFeature} lookupFeature the feature of the contextual lookup
 * @param {IgnorableMatching} ignorableMatching the default ignorables of the context and how the lookup skips them
 * @returns {ContextualMatch}
 */
function applyNestedLookupRecords(contextParams, inputPositions, lookupRecords, lookupFeature, ignorableMatching) {
    const context = contextParams.context;
    const currentPosition = contextParams.index;
    // the glyphs after the substitutions of the previous records, from the position glyphIndexesStart: the context until
    // a substitution that a following record sees, then a copy of its glyphs from the current one, the only ones a
    // nested lookup reads, with the position in the context of the glyph each one comes from and their default
    // ignorables
    let glyphIndexes = context;
    let glyphIndexesStart = 0;
    let glyphSourcePositions = null;
    let glyphIgnorableMatching = ignorableMatching;
    // the positions of the input glyphs in the context after the substitutions of the previous records
    const sequencePositions = inputPositions.slice();
    let inputEnd = inputPositions[inputPositions.length - 1] + 1;
    const substitutions = [];
    for (let i = 0; i < lookupRecords.length; i++) {
        const sequenceIndex = lookupRecords[i].sequenceIndex;
        if (sequenceIndex >= sequencePositions.length) {
            continue;
        }
        const lookupTable = this.getLookupByIndex(lookupRecords[i].lookupListIndex);
        if (!lookupTable) {
            continue;
        }
        const position = sequencePositions[sequenceIndex];
        const glyphContextParams = glyphIndexes === context && position === currentPosition ?
            contextParams : createNestedContextParams(glyphIndexes, position - glyphIndexesStart);
        const sourcePosition = glyphSourcePositions ? glyphSourcePositions[position - glyphIndexesStart] : position;
        const nestedSubstitution = this.getLookupSubstitution(
            lookupTable, glyphContextParams, NESTED_SUBSTITUTION_TYPES, lookupFeature, sourcePosition, glyphIgnorableMatching
        );
        if (!nestedSubstitution) {
            continue;
        }
        substitutions.push({ offset: position - currentPosition, ...nestedSubstitution });
        if (i < lookupRecords.length - 1) {
            if (glyphIndexes === context) {
                glyphIndexes = context.slice(currentPosition);
                glyphIndexesStart = currentPosition;
                glyphSourcePositions = glyphIndexes.map((glyphIndex, index) => currentPosition + index);
                glyphIgnorableMatching = createIgnorableMatching(
                    ignorableMatching.ignorableTypes.slice(currentPosition), ignorableMatching.isPositioning, ignorableMatching.joinerFlags
                );
            }
            const substitutedPosition = position - glyphIndexesStart;
            substituteGlyphValues(glyphSourcePositions, substitutedPosition, nestedSubstitution, (glyphIndex, sourcePosition) => sourcePosition);
            substituteGlyphValues(glyphIgnorableMatching.ignorableTypes, substitutedPosition, nestedSubstitution, () => DEFAULT_IGNORABLE_TYPES.NOT_IGNORABLE);
            substituteGlyphValues(glyphIndexes, substitutedPosition, nestedSubstitution, glyphIndex => glyphIndex);
        }
        const lengthChange = getSubstitutionLengthChange(nestedSubstitution);
        // like HarfBuzz, the end of the input does not move before the glyph the substitution applied at
        inputEnd = Math.max(inputEnd + lengthChange, position);
        const isDeletion = nestedSubstitution.id === MULTIPLE_SUBSTITUTION_ID && !nestedSubstitution.substitution.length;
        updateInputPositions(sequencePositions, sequenceIndex, lengthChange, isDeletion);
    }
    return { substitutions, inputLength: inputEnd - currentPosition };
}

/**
 * Handle a contextual substitution (lookup types 5 and 6, formats 1, 2 and 3): the nested lookups of the contextual
 * rule that matches at the current glyph of a context
 * @param {ContextParams} contextParams context params to lookup
 * @param {any} subtable subtable
 * @param {any} lookupTable the lookup of the subtable, its lookupFlag tells the glyphs to skip
 * @param {function} matchSubtable matchSequenceContext (lookup type 5) or matchChainedSequenceContext (lookup type 6)
 * @param {LookupFeature} lookupFeature the feature of the lookup
 * @param {IgnorableMatching} ignorableMatching the default ignorables of the context and how the lookup skips them
 * @returns {ContextualMatch|null} the substitutions of the rule that matches (none if it substitutes nothing), null if
 * none matches
 */
function contextualSubstitution(contextParams, subtable, lookupTable, matchSubtable, lookupFeature, ignorableMatching) {
    const gdef = getLayoutGdefTable(this.font);
    const contextRuleMatch = matchSubtable(
        gdef, lookupTable, subtable, subtable.substFormat, contextParams.context, contextParams.index, ignorableMatching
    );
    if (!contextRuleMatch) {
        return null;
    }
    const { inputPositions, lookupRecords } = contextRuleMatch;
    return applyNestedLookupRecords.call(this, contextParams, inputPositions, lookupRecords, lookupFeature, ignorableMatching);
}

/**
 * Handle ligature substitution - format 1: the components are the glyphs after the current one that the lookup
 * matches, like the input of a contextual rule (see matchGlyphSequence in layout.mjs): it skips the glyphs it ignores
 * and the default ignorables of the input that are not the component there (e.g. a zero width joiner, but a zero
 * width non-joiner ends the ligature), which stay after the ligature glyph
 * @param {ContextParams} contextParams context params to lookup
 * @param {any} subtable subtable
 * @param {any} lookupTable the lookup of the subtable, its lookupFlag tells the glyphs to skip
 * @param {IgnorableMatching} ignorableMatching the default ignorables of the context and how the lookup skips them
 * @returns {{ligGlyph: number, componentOffsets: number[]}|null} the ligature glyph and the offsets of
 * its other components from the current glyph, null if no ligature matches
 */
function ligatureSubstitutionFormat1(contextParams, subtable, lookupTable, ignorableMatching) {
    const ligatureSetIndex = lookupCoverage(contextParams.current, subtable.coverage);
    const ligatureSet = ligatureSetIndex === -1 ? undefined : subtable.ligatureSets[ligatureSetIndex];
    // like HarfBuzz, a NULL LigatureSet offset (undefined) is an empty ligature set
    if (!ligatureSet) {
        return null;
    }
    const gdef = getLayoutGdefTable(this.font);
    // the components are in the order of the text
    for (const ligature of ligatureSet) {
        // like HarfBuzz, a NULL Ligature offset (undefined) is a ligature without components, which matches nothing
        if (!ligature) {
            continue;
        }
        const componentPositions = matchGlyphSequence(
            gdef, lookupTable, contextParams.context, contextParams.index, 1,
            { items: ligature.components, matchesItem: matchesGlyphIndex }, ignorableMatching.isSkippedInInput
        );
        if (componentPositions) {
            return {
                ligGlyph: ligature.ligGlyph,
                componentOffsets: componentPositions.map(position => position - contextParams.index)
            };
        }
    }
    return null;
}

/**
 * Handle decomposition substitution - format 1
 * @param {number} glyphIndex glyph index
 * @param {any} subtable subtable
 * @returns {number[]|null} the sequence that replaces the glyph, null if the subtable does not cover it; like
 * HarfBuzz, a NULL Sequence offset (undefined) is an empty sequence, which deletes the glyph
 */
function decompositionSubstitutionFormat1(glyphIndex, subtable) {
    let substituteIndex = lookupCoverage(glyphIndex, subtable.coverage);
    if (substituteIndex === -1) return null;
    return subtable.sequences[substituteIndex] || [];
}

/**
 * Get the feature indexes of a language system, like HarfBuzz: a script the GSUB table has not falls back to
 * DFLT, dflt, then latn, and a language the script has not to the default language system of the script
 * (see Layout.getScriptTable and Layout.getLangSysTable)
 * @param {string} [scriptTag] script tag, DFLT if omitted
 * @param {string} [languageTag] language tag ('TRK ' or 'TRK'), the default language system of the script if omitted
 * @returns {number[]}
 */
FeatureQuery.prototype.getScriptFeaturesIndexes = function(scriptTag, languageTag) {
    const langSysTable = this.font.substitution.getLangSysTable(scriptTag, languageTag);
    return langSysTable ? langSysTable.featureIndexes : [];
};

/**
 * Get the index of the required feature (ReqFeatureIndex) of a language system, with the fallbacks of
 * getScriptFeaturesIndexes
 * @param {string} [scriptTag] script tag, DFLT if omitted
 * @param {string} [languageTag] language tag, the default language system of the script if omitted
 * @returns {number|undefined} undefined when the language system has no required feature
 */
FeatureQuery.prototype.getRequiredFeatureIndex = function(scriptTag, languageTag) {
    return getRequiredFeatureIndex(this.font.substitution.getLangSysTable(scriptTag, languageTag));
};

/**
 * Get the features of a language system (see getScriptFeaturesIndexes), with the alternate feature tables of the
 * GSUB feature variations at the variation of the query. Like HarfBuzz, a feature index past the FeatureList is
 * ignored. They are computed once for the GSUB table, the language system and the feature variation record of the
 * variation (see getCachedLayoutValue in layout.mjs).
 * @param {string} [scriptTag] script tag
 * @param {string} [languageTag] language tag
 * @returns {Array<{tag: string, feature: any}>} the features, with a tags property that maps each tag to its feature
 * (the first one of the tag), and a required property, the required feature of the language system (see getRequiredFeature)
 */
FeatureQuery.prototype.getScriptFeatures = function (scriptTag, languageTag) {
    const gsub = this.font.tables.gsub;
    const key = JSON.stringify(['features', scriptTag, languageTag, this.getFeatureVariationIndex()]);
    return getCachedLayoutValue(this.font, 'gsub', key, () => {
        const featureVariations = this.getFeatureVariationSubstitutions();
        const getFeatureOfIndex = index => {
            const feature = gsub.features[index];
            const alternateFeature = feature && featureVariations.get(index);
            return alternateFeature ? { tag: feature.tag, feature: alternateFeature } : feature;
        };
        const features = this.getScriptFeaturesIndexes(scriptTag, languageTag).map(getFeatureOfIndex).filter(Boolean);
        features.tags = {};
        // the first feature of a tag, like HarfBuzz (hb_ot_layout_language_find_feature)
        for (const feature of features) {
            if (!Object.prototype.hasOwnProperty.call(features.tags, feature.tag)) {
                features.tags[feature.tag] = feature.feature;
            }
        }
        const requiredFeatureIndex = this.getRequiredFeatureIndex(scriptTag, languageTag);
        features.required = requiredFeatureIndex === undefined ? null : getFeatureOfIndex(requiredFeatureIndex) || null;
        return features;
    });
};

/**
 * Get the required feature of a language system (see getRequiredFeatureIndex), at the variation of the query: like
 * HarfBuzz, its lookups apply whatever the enabled features (see getRequiredFeatureStage)
 * @param {string} [scriptTag] script tag
 * @param {string} [languageTag] language tag
 * @returns {{tag: string, feature: any}|null} null when the language system has no required feature
 */
FeatureQuery.prototype.getRequiredFeature = function (scriptTag, languageTag) {
    return this.getScriptFeatures(scriptTag, languageTag).required;
};

/**
 * Get the index of the GSUB feature variation record that applies at the variation coordinates of the query (the
 * current variation of the font if it has none): the first one whose conditions are all met. It is computed once for
 * the query.
 * @returns {number} -1 when none applies
 */
FeatureQuery.prototype.getFeatureVariationIndex = function () {
    if (this.featureVariationIndex !== undefined) {
        return this.featureVariationIndex;
    }
    this.featureVariationIndex = -1;
    const featureVariations = this.font.tables.gsub && this.font.tables.gsub.variations;
    if (!featureVariations || !featureVariations.length || !this.font.variation) {
        return this.featureVariationIndex;
    }
    // normalized coordinates, in the F2DOT14 precision of the condition values
    const coordinates = this.font.variation.process.getNormalizedCoords(this.variation);
    this.featureVariationIndex = featureVariations.findIndex(record => (record.conditions || []).every(condition => {
        if (condition.format !== 1) {
            return false;
        }
        const coordinate = coordinates[condition.axisIndex] || 0;
        return coordinate >= condition.filterRangeMinValue && coordinate <= condition.filterRangeMaxValue;
    }));
    return this.featureVariationIndex;
};

/**
 * Get the alternate feature tables of the GSUB feature variation record that applies (see getFeatureVariationIndex)
 * @returns {Map<number, any>} alternate feature tables by feature index
 */
FeatureQuery.prototype.getFeatureVariationSubstitutions = function () {
    const substitutions = new Map();
    const featureVariationIndex = this.getFeatureVariationIndex();
    if (featureVariationIndex === -1) {
        return substitutions;
    }
    for (const substitution of this.font.tables.gsub.variations[featureVariationIndex].substitutions || []) {
        substitutions.set(substitution.featureIndex, substitution.feature);
    }
    return substitutions;
};

/**
 * The value of a feature at every glyph of the run being shaped, with the features option of the query (see
 * getRunFeatureValue in featureValues.mjs)
 * @param {string} tag
 * @returns {number}
 */
FeatureQuery.prototype.getFeatureValue = function (tag) {
    return getRunFeatureValue(this.featuresOption, tag, this.directionTags);
};

/**
 * Start a script run, like a new buffer of HarfBuzz: the initial random state (see getRandomNumber), the direction
 * features of the run, which give rtlm the value of its mask in a run of a right-to-left script (see getFeatureValue),
 * and like the max_len of the buffer, the maximum number of its glyphs: 64 times its number of characters, at least
 * 16384; a GSUB lookup that would grow them past it leaves them as they were and stops the GSUB lookups of the run (see
 * applyLookupToTokens in applySubstitution.mjs); and the shaper of the run, whose features skip the zero width joiners
 * and non-joiners or not (see getLookupJoinerFlags in featureValues.mjs)
 * @param {string[]} directionTags the direction features of the run (see getDirectionFeatureTags in featureValues.mjs)
 * @param {number} charCount the number of characters of the run, which gives the maximum number of its glyphs
 * @param {string} [shaper] the shaper of the run (see getScriptRunShaper in bidi.mjs), the default shaper if omitted
 */
FeatureQuery.prototype.startScriptRun = function (directionTags, charCount, shaper) {
    this.randomState = INITIAL_RANDOM_STATE;
    this.directionTags = directionTags;
    this.shaper = shaper;
    this.maxGlyphCount = Math.max(charCount * MAX_GLYPH_COUNT_FACTOR, MIN_MAX_GLYPH_COUNT);
    this.isMaxGlyphCountExceeded = false;
};

/**
 * The next random number of the run, like HarfBuzz (hb_ot_apply_context_t::random_number): the minimal standard
 * generator, its product wrapping around 32 bits like the unsigned integers of HarfBuzz
 * @returns {number}
 */
FeatureQuery.prototype.getRandomNumber = function () {
    this.randomState = (Math.imul(this.randomState, 48271) >>> 0) % 2147483647;
    return this.randomState;
};

/**
 * The alternate that an alternate substitution (lookup type 3) substitutes for a glyph, like HarfBuzz
 * (AlternateSet::apply): the alternate of the index of the value of the feature of the lookup, 1 for the first one;
 * none for the value 0 or an index past the alternates of the glyph. At the value 255, the default value of rand, a
 * lookup of rand takes a random alternate (see getRandomNumber).
 * @param {number[]} alternates the alternates of the glyph, in the order of its AlternateSet
 * @param {string} tag the tag of the feature of the lookup
 * @param {number} featureValue the value of the feature at the glyph (see LookupFeature)
 * @returns {number|null}
 */
FeatureQuery.prototype.getAlternate = function (alternates, tag, featureValue) {
    if (!alternates.length) {
        return null;
    }
    let alternateIndex = featureValue;
    if (alternateIndex === MAX_FEATURE_VALUE && tag === RANDOM_FEATURE_TAG) {
        alternateIndex = this.getRandomNumber() % alternates.length + 1;
    }
    if (alternateIndex === 0 || alternateIndex > alternates.length) {
        return null;
    }
    return alternates[alternateIndex - 1];
};

/**
 * Get substitution type
 * @param {any} lookupTable lookup table
 * @param {any} subtable subtable
 */
FeatureQuery.prototype.getSubstitutionType = function(lookupTable, subtable) {
    const lookupType = lookupTable.lookupType.toString();
    const substFormat = subtable.substFormat.toString();
    return lookupType + substFormat;
};

/**
 * Get lookup method
 * @param {any} lookupTable lookup table
 * @param {any} subtable subtable
 */
FeatureQuery.prototype.getLookupMethod = function(lookupTable, subtable) {
    let substitutionType = this.getSubstitutionType(lookupTable, subtable);
    switch (substitutionType) {
        case '11':
            return glyphIndex => singleSubstitutionFormat1.apply(
                this, [glyphIndex, subtable]
            );
        case '12':
            return glyphIndex => singleSubstitutionFormat2.apply(
                this, [glyphIndex, subtable]
            );
        case '31':
            return glyphIndex => alternateSubstitutionFormat1(glyphIndex, subtable);
        // the methods that match several glyphs take the lookup whose lookupFlag tells the glyphs to skip
        // (the lookup of an extension subtable, not the extension subtable) and the default ignorables of the context
        // (none if omitted), and the contextual ones the feature of the lookup, for their nested alternate substitutions
        case '61':
        case '62':
        case '63':
            return (contextParams, flagsLookupTable, lookupFeature, ignorableMatching = NO_IGNORABLE_MATCHING) => contextualSubstitution.call(
                this, contextParams, subtable, flagsLookupTable, matchChainedSequenceContext, lookupFeature, ignorableMatching
            );
        case '41':
            return (contextParams, flagsLookupTable, lookupFeature, ignorableMatching = NO_IGNORABLE_MATCHING) => ligatureSubstitutionFormat1.apply(
                this, [contextParams, subtable, flagsLookupTable, ignorableMatching]
            );
        case '21':
            return glyphIndex => decompositionSubstitutionFormat1.apply(
                this, [glyphIndex, subtable]
            );
        case '51':
        case '52':
        case '53':
            return (contextParams, flagsLookupTable, lookupFeature, ignorableMatching = NO_IGNORABLE_MATCHING) => contextualSubstitution.call(
                this, contextParams, subtable, flagsLookupTable, matchSequenceContext, lookupFeature, ignorableMatching
            );
        default:
            // unsupported lookups are skipped (warned once per type), so the
            // supported lookups of the same feature still apply
            warnOncePerFont(this.font, 'GSUB substitutionType', substitutionType, () =>
                `[opentype.js] substitutionType: ${substitutionType} ` +
                `lookupType: ${lookupTable.lookupType} - ` +
                `substFormat: ${subtable.substFormat} ` +
                'is not yet supported, lookup skipped'
            );
            return null;
    }
};

/**
 * [ LOOKUP TYPES ]
 * -------------------------------
 * Single                        1;
 * Multiple                      2;
 * Alternate                     3;
 * Ligature                      4;
 * Context                       5;
 * ChainingContext               6;
 * ExtensionSubstitution         7;
 * ReverseChainingContext        8;
 * -------------------------------
 *
 */

// top-level lookup types (lookupType + substFormat) applied by lookupSubstitution
const APPLIED_SUBSTITUTION_TYPES = ['11', '12', '21', '31', '41', '51', '52', '53', '61', '62', '63'];

/**
 * Get the substitution of a lookup at the current glyph of a context: the first subtable of the lookup, of the given
 * types, that applies wins (a matching contextual rule ends the lookup even when it substitutes nothing). Lookups of
 * unsupported types are handled by getLookupMethod. The lookup skips the glyphs its lookupFlag ignores when it matches
 * the other glyphs of a rule or of a ligature; like HarfBuzz for a lookup that a lookup record applies, it applies at
 * the current glyph even when its lookupFlag ignores it (lookupSubstitution checks that).
 * @param {any} lookupTable lookup table
 * @param {ContextParams|{context: number[], index: number, current: number}} contextParams context params, its current
 * glyph is the one to substitute; the nested lookups of a contextual rule get its context, index and current glyph only
 * (see createNestedContextParams)
 * @param {string[]} substitutionTypes the types of the subtables that can apply (lookupType + substFormat)
 * @param {LookupFeature} lookupFeature the feature of the lookup, or of the contextual lookup whose rule applies it,
 * whose value chooses the alternate of an alternate substitution (see getAlternate)
 * @param {number} featurePosition the position of the glyph to substitute in the context of lookupFeature, where its
 * value applies: the current glyph of the context of the lookup, or the glyph that the glyph a nested lookup applies
 * at comes from (see applyNestedLookupRecords)
 * @param {IgnorableMatching} [ignorableMatching] the default ignorables of the context and how the lookup skips them
 * when it matches the other glyphs of a rule or of a ligature (see createIgnorableMatching in layout.mjs), none if
 * omitted
 * @returns {LookupSubstitution|null}
 */
FeatureQuery.prototype.getLookupSubstitution = function (
    lookupTable, contextParams, substitutionTypes, lookupFeature, featurePosition, ignorableMatching = NO_IGNORABLE_MATCHING
) {
    for (let subtable of this.getLookupSubtables(lookupTable) || []) {
        let subtableOwner = lookupTable;
        let substitutionType = this.getSubstitutionType(lookupTable, subtable);
        if (substitutionType === '71') {
            // This is an extension subtable, so lookup the target subtable
            subtableOwner = subtable;
            subtable = subtable.extension;
            substitutionType = this.getSubstitutionType(subtableOwner, subtable);
        }
        // getLookupMethod reports the lookups of unsupported types once per font and skips them
        const lookup = this.getLookupMethod(subtableOwner, subtable);
        if (!lookup || !substitutionTypes.includes(substitutionType)) {
            continue;
        }
        const id = parseInt(substitutionType);
        if (substitutionType === '11' || substitutionType === '12') {
            const substitution = lookup(contextParams.current);
            if (substitution !== null && substitution !== undefined) {
                return { id, substitution };
            }
        } else if (substitutionType === '21') {
            // multiple substitution: the glyph becomes a sequence of glyphs (none deletes it)
            const substitution = lookup(contextParams.current);
            if (Array.isArray(substitution)) {
                return { id, substitution };
            }
        } else if (substitutionType === '31') {
            // alternate substitution: like HarfBuzz, a subtable whose alternate the value of the feature does not
            // choose leaves the glyph to the next subtable
            const alternates = lookup(contextParams.current);
            const substitution = alternates &&
                this.getAlternate(alternates, lookupFeature.tag, lookupFeature.getValue(featurePosition));
            if (substitution !== null && substitution !== undefined) {
                return { id, substitution };
            }
        } else {
            const substitution = lookup(contextParams, lookupTable, lookupFeature, ignorableMatching);
            if (substitution) {
                return { id, substitution };
            }
        }
    }
    return null;
};

/**
 * Apply one lookup at the current glyph of a context (see getLookupSubstitution). The lookup does not apply at a
 * glyph its lookupFlag ignores.
 * @param {any} lookupTable lookup table
 * @param {ContextParams} contextParams context params, its current glyph is the one to substitute
 * @param {string} tag feature tag set as the state of the substituted tokens
 * @param {function(number): number} [getFeatureValue] the value of the feature of the lookup at the glyph at a position
 * of the context (see LookupFeature), the alternate index there of its alternate substitutions and of the ones its
 * contextual rules apply; 1 at every glyph if omitted
 * @param {IgnorableMatching} [ignorableMatching] the default ignorables of the context and how the lookup skips them
 * (see createIgnorableMatching in layout.mjs), none if omitted; like HarfBuzz, the lookup applies at the current glyph
 * even when it is a default ignorable
 * @returns {SubstitutionAction|null} the substitution to apply at the current glyph, if any: a contextual rule that
 * matches gives its ContextualMatch even when it substitutes nothing (e.g. an exception rule), the lookup goes on after
 * its input; like HarfBuzz, the input never ends before the glyph a nested lookup applied at, so after a nested
 * ligature that takes glyphs past the input the lookup goes on at the ligature glyph
 */
FeatureQuery.prototype.lookupSubstitution = function (
    lookupTable, contextParams, tag, getFeatureValue = () => 1, ignorableMatching = NO_IGNORABLE_MATCHING
) {
    if (isGlyphIgnoredByLookup(getLayoutGdefTable(this.font), lookupTable, contextParams.current)) {
        return null;
    }
    const lookupFeature = { tag, getValue: getFeatureValue };
    const lookupSubstitution = this.getLookupSubstitution(
        lookupTable, contextParams, APPLIED_SUBSTITUTION_TYPES, lookupFeature, contextParams.index, ignorableMatching
    );
    return lookupSubstitution && new SubstitutionAction({ ...lookupSubstitution, tag });
};

/**
 * Get lookup table subtables, without the undefined ones (see getLookupTableSubtables in layout.mjs)
 * @param {any} lookupTable lookup table
 */
FeatureQuery.prototype.getLookupSubtables = function (lookupTable) {
    return lookupTable.subtables ? getLookupTableSubtables(lookupTable) : null;
};

/**
 * Get lookup table by index
 * @param {number} index lookup table index
 */
FeatureQuery.prototype.getLookupByIndex = function (index) {
    const lookups = this.font.tables.gsub.lookups;
    return lookups[index] || null;
};

/**
 * Query a feature by it's properties: its tag in the features of a language system (see getScriptFeatures)
 * @param {{tag: string, script: string, language?: string}} query
 * @returns {any|null} the feature table, null if the language system has no feature of the tag
 */
FeatureQuery.prototype.getFeature = function getFeature(query) {
    if (!this.font) return { FAIL: 'No font was found'};
    return this.getScriptFeatures(query.script, query.language).tags[query.tag] || null;
};

export default FeatureQuery;
export { FeatureQuery, SubstitutionAction, getSubstitutionGlyphEdits };
