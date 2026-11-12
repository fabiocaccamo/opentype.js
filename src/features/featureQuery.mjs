/**
 * Query a feature by some of it's properties to lookup a glyph substitution.
 */

import { ContextParams } from '../tokenizer.mjs';
import { getLayoutGdefTable, isGlyphIgnoredByLookup, getNotIgnoredGlyphPositions } from '../layout.mjs';

// font -> substitution types already warned as unsupported (warn once per font)
const warnedUnsupportedSubstitutionTypes = new WeakMap();

/**
 * Create feature query instance
 * @param {Font} font opentype font instance
 */
function FeatureQuery(font) {
    this.font = font;
    this.features = {};
}

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
 * Lookup a coverage table
 * @param {number} glyphIndex glyph index
 * @param {CoverageTable} coverage coverage table
 */
function lookupCoverage(glyphIndex, coverage) {
    if (!glyphIndex) return -1;
    switch (coverage.format) {
        case 1:
            return coverage.glyphs.indexOf(glyphIndex);

        case 2: {
            let ranges = coverage.ranges;
            for (let i = 0; i < ranges.length; i++) {
                const range = ranges[i];
                if (glyphIndex >= range.start && glyphIndex <= range.end) {
                    let offset = glyphIndex - range.start;
                    return range.index + offset;
                }
            }
            break;
        }
        default:
            return -1; // not found
    }
    return -1;
}

/**
 * Handle a single substitution - format 1
 * @param {ContextParams} contextParams context params to lookup
 */
function singleSubstitutionFormat1(glyphIndex, subtable) {
    let substituteIndex = lookupCoverage(glyphIndex, subtable.coverage);
    if (substituteIndex === -1) return null;
    // the delta addition is modulo 65536
    return (glyphIndex + subtable.deltaGlyphId) & 0xFFFF;
}

/**
 * Handle a single substitution - format 2
 * @param {ContextParams} contextParams context params to lookup
 */
function singleSubstitutionFormat2(glyphIndex, subtable) {
    let substituteIndex = lookupCoverage(glyphIndex, subtable.coverage);
    if (substituteIndex === -1) return null;
    return subtable.substitute[substituteIndex];
}

/**
 * A sequence of a contextual rule (its backtrack, its input or its lookahead)
 * @typedef RuleSequence
 * @type Object
 * @property {Array} items glyph indexes, glyph classes or coverage tables, in the order they are matched
 * @property {function(number, any): boolean} matchesItem whether a glyph index matches an item
 */

const matchesGlyphIndex = (glyphIndex, expectedGlyphIndex) => glyphIndex === expectedGlyphIndex;
const matchesCoverage = (glyphIndex, coverage) => lookupCoverage(glyphIndex, coverage) !== -1;
const EMPTY_SEQUENCE = { items: [], matchesItem: matchesGlyphIndex };

/**
 * The matchesItem function of a sequence of glyph classes (see RuleSequence)
 * @param {Font} font opentype font instance
 * @param {any} classDef class definition table
 * @returns {function(number, number): boolean}
 */
function getGlyphClassMatcher(font, classDef) {
    return (glyphIndex, glyphClass) => getGlyphClass(font, classDef, glyphIndex) === glyphClass;
}

/**
 * Match a sequence of a contextual rule on the glyphs of a context that a lookup does not ignore,
 * from the glyph after a position (the glyph before it with a step of -1)
 * @param {any} gdef the GDEF table of the font
 * @param {ContextParams} contextParams context params to lookup
 * @param {any} lookupTable the lookup of the rule, its lookupFlag tells the glyphs to skip
 * @param {number} position the position the sequence starts after
 * @param {number} step 1 for an input or a lookahead, -1 for a backtrack
 * @param {RuleSequence} sequence
 * @returns {number[]|null} the positions of the matched glyphs in the context, null if the sequence does not match
 */
function matchRuleSequence(gdef, contextParams, lookupTable, position, step, sequence) {
    const items = sequence.items;
    const positions = getNotIgnoredGlyphPositions(gdef, lookupTable, contextParams.context, position, step, items.length);
    if (positions.length < items.length) {
        return null;
    }
    for (let i = 0; i < items.length; i++) {
        if (!sequence.matchesItem(contextParams.context[positions[i]], items[i])) {
            return null;
        }
    }
    return positions;
}

/**
 * Match a contextual rule at the current glyph of a context, on the glyphs that the lookup does not ignore,
 * like HarfBuzz: the input glyphs from the glyph after the current one, the lookahead from the glyph after
 * the last input glyph, the backtrack from the glyph before the current one. The current glyph, the first
 * glyph of the input, is matched by the caller.
 * @param {any} gdef the GDEF table of the font
 * @param {ContextParams} contextParams context params to lookup
 * @param {any} lookupTable the lookup of the rule, its lookupFlag tells the glyphs to skip
 * @param {{backtrack: RuleSequence, input: RuleSequence, lookahead: RuleSequence}} rule the input without its first glyph
 * @returns {number[]|null} the positions of the input glyphs in the context, the current one first, null if the rule does not match
 */
function matchContextRule(gdef, contextParams, lookupTable, rule) {
    const inputPositions = matchRuleSequence(gdef, contextParams, lookupTable, contextParams.index, 1, rule.input);
    if (!inputPositions) {
        return null;
    }
    inputPositions.unshift(contextParams.index);
    const lastInputPosition = inputPositions[inputPositions.length - 1];
    if (!matchRuleSequence(gdef, contextParams, lookupTable, lastInputPosition, 1, rule.lookahead)) {
        return null;
    }
    if (!matchRuleSequence(gdef, contextParams, lookupTable, contextParams.index, -1, rule.backtrack)) {
        return null;
    }
    return inputPositions;
}

// nested lookup types (lookupType + substFormat) a contextual rule can apply:
// single substitution format 1 and 2, multiple substitution format 1
const NESTED_SUBSTITUTION_TYPES = ['11', '12', '21'];

/**
 * Find the glyph at a sequence index of the input of a contextual rule, whose input glyphs may have been replaced
 * by several glyphs (or none) by the nested lookups of the previous lookup records
 * @param {number[][]} inputGlyphs the glyphs each input glyph became, in the order of the input
 * @param {number} sequenceIndex the index of the glyph in the input, each glyph of a multiple substitution counted
 * @returns {{inputIndex: number, glyphOffset: number}|null} the input glyph the glyph comes from and the offset of
 * the glyph in its glyphs, null past the end of the input
 */
function findInputSequenceGlyph(inputGlyphs, sequenceIndex) {
    let glyphOffset = sequenceIndex;
    for (let inputIndex = 0; inputIndex < inputGlyphs.length; inputIndex++) {
        if (glyphOffset < inputGlyphs[inputIndex].length) {
            return { inputIndex, glyphOffset };
        }
        glyphOffset -= inputGlyphs[inputIndex].length;
    }
    return null;
}

/**
 * The substitutions of a matched contextual rule
 * @typedef ContextualMatch
 * @type Object
 * @property {Array} substitutions by offset from the current glyph (sparse, a hole keeps the glyph): the glyph index
 * that replaces the input glyph at the offset, or the glyph indexes (several or none) when a multiple substitution
 * replaced it; empty if nothing is substituted
 * @property {number} lastInputOffset the offset of the last input glyph from the current one, the glyphs the lookup
 * skips between the input glyphs counted
 */

/**
 * Apply the nested lookups of a matched contextual rule to its input sequence.
 * Each lookup record substitutes the glyph at its sequence index, the index of the glyph
 * in the matched input (the glyphs the lookup skips are not counted), in record order,
 * so a record sees the substitutions of the previous ones: like HarfBuzz, the glyphs of
 * a nested multiple substitution are glyphs of their own in the input sequence of the
 * following records. A glyph it deletes (a sequence of no glyph, which the OpenType
 * specification prohibits) leaves the input sequence, and the sequence index of the
 * following records counts on the updated sequence, the results of the previous records
 * of the specification. HarfBuzz instead keeps the match position of the deleted glyph, which
 * then points at the next glyph of the buffer, and drops the match position of the next input
 * glyph, none when the deleted glyph is the last input glyph (its source calls it an approximation),
 * so a following record at that index substitutes the glyph after the deleted one, and a record at
 * a later index the same input glyph as in the fork. The two differ when the lookup skips glyphs
 * between the input glyphs (the fork substitutes the next input glyph) and when the deleted glyph
 * is the last input glyph (HarfBuzz substitutes the glyph after the input, the fork skips the record). The first subtable of a lookup that substitutes the glyph wins.
 * Nested lookups of other types are skipped.
 * @param {Array} context glyphs of the context
 * @param {number[]} inputPositions positions of the matched input glyphs in the context, the current one first
 * @param {any[]} lookupRecords lookup records of the matched rule
 * @returns {ContextualMatch}
 */
function applyNestedLookupRecords(context, inputPositions, lookupRecords) {
    const inputGlyphs = inputPositions.map(position => [context[position]]);
    const substitutedInputIndexes = new Set();
    for (let i = 0; i < lookupRecords.length; i++) {
        const lookupRecord = lookupRecords[i];
        const sequenceGlyph = findInputSequenceGlyph(inputGlyphs, lookupRecord.sequenceIndex);
        if (!sequenceGlyph) {
            continue;
        }
        const lookupTable = this.getLookupByIndex(lookupRecord.lookupListIndex);
        if (!lookupTable) continue;
        for (let s = 0; s < lookupTable.subtables.length; s++) {
            let subtableOwner = lookupTable;
            let subtable = lookupTable.subtables[s];
            let substitutionType = this.getSubstitutionType(lookupTable, subtable);
            if (substitutionType === '71') {
                // This is an extension subtable, so lookup the target subtable
                subtableOwner = subtable;
                subtable = subtable.extension;
                substitutionType = this.getSubstitutionType(subtableOwner, subtable);
            }
            if (!NESTED_SUBSTITUTION_TYPES.includes(substitutionType)) continue;
            const glyphs = inputGlyphs[sequenceGlyph.inputIndex];
            const substitution = this.getLookupMethod(subtableOwner, subtable)(glyphs[sequenceGlyph.glyphOffset]);
            if (substitution !== null && substitution !== undefined) {
                glyphs.splice(sequenceGlyph.glyphOffset, 1, ...(Array.isArray(substitution) ? substitution : [substitution]));
                substitutedInputIndexes.add(sequenceGlyph.inputIndex);
                break;
            }
        }
    }
    const substitutions = [];
    for (const inputIndex of substitutedInputIndexes) {
        const glyphs = inputGlyphs[inputIndex];
        substitutions[inputPositions[inputIndex] - inputPositions[0]] = glyphs.length === 1 ? glyphs[0] : glyphs;
    }
    return { substitutions, lastInputOffset: inputPositions[inputPositions.length - 1] - inputPositions[0] };
}

/**
 * Handle chaining context substitution - format 3
 * @param {ContextParams} contextParams context params to lookup
 * @param {any} subtable subtable
 * @param {any} lookupTable the lookup of the subtable, its lookupFlag tells the glyphs to skip
 * @returns {ContextualMatch|null} the substitutions of the rule if it matches (none if it substitutes nothing), null otherwise
 */
function chainingSubstitutionFormat3(contextParams, subtable, lookupTable) {
    // a rule without input glyphs matches nothing, like HarfBuzz
    if (!subtable.inputCoverage.length) {
        return null;
    }
    if (!matchesCoverage(contextParams.current, subtable.inputCoverage[0])) {
        return null;
    }
    const inputPositions = matchContextRule(getLayoutGdefTable(this.font), contextParams, lookupTable, {
        backtrack: { items: subtable.backtrackCoverage, matchesItem: matchesCoverage },
        input: { items: subtable.inputCoverage.slice(1), matchesItem: matchesCoverage },
        lookahead: { items: subtable.lookaheadCoverage, matchesItem: matchesCoverage }
    });
    if (!inputPositions) {
        return null;
    }
    return applyNestedLookupRecords.call(this, contextParams.context, inputPositions, subtable.lookupRecords);
}

/**
 * Handle ligature substitution - format 1: the components are the glyphs after the current one
 * that the lookup does not ignore, the glyphs it skips between them stay after the ligature glyph
 * @param {ContextParams} contextParams context params to lookup
 * @param {any} subtable subtable
 * @param {any} lookupTable the lookup of the subtable, its lookupFlag tells the glyphs to skip
 * @returns {{ligGlyph: number, componentOffsets: number[]}|null} the ligature glyph and the offsets of
 * its other components from the current glyph, null if no ligature matches
 */
function ligatureSubstitutionFormat1(contextParams, subtable, lookupTable) {
    const ligatureSetIndex = lookupCoverage(contextParams.current, subtable.coverage);
    if (ligatureSetIndex === -1) {
        return null;
    }
    const gdef = getLayoutGdefTable(this.font);
    // the components are in the order of the text
    for (const ligature of subtable.ligatureSets[ligatureSetIndex]) {
        const components = ligature.components;
        const componentPositions = getNotIgnoredGlyphPositions(
            gdef, lookupTable, contextParams.context, contextParams.index, 1, components.length
        );
        if (componentPositions.length !== components.length) {
            continue;
        }
        if (components.every((component, componentIndex) => contextParams.context[componentPositions[componentIndex]] === component)) {
            return {
                ligGlyph: ligature.ligGlyph,
                componentOffsets: componentPositions.map(position => position - contextParams.index)
            };
        }
    }
    return null;
}

/**
 * Handle context substitution - format 1
 * @param {ContextParams} contextParams context params to lookup
 * @param {any} subtable subtable
 * @param {any} lookupTable the lookup of the subtable, its lookupFlag tells the glyphs to skip
 * @returns {ContextualMatch|null} the substitutions of the first rule that matches (none if it substitutes nothing), null if none matches
 */
function contextSubstitutionFormat1(contextParams, subtable, lookupTable) {
    const coverageIndex = lookupCoverage(contextParams.current, subtable.coverage);
    if (coverageIndex === -1) return null;
    // only the rules of the rule set of the current glyph apply
    const ruleSet = subtable.ruleSets[coverageIndex];
    if (!ruleSet) return null;
    for (const rule of ruleSet) {
        const inputPositions = matchContextRule(getLayoutGdefTable(this.font), contextParams, lookupTable, {
            backtrack: EMPTY_SEQUENCE,
            input: { items: rule.input, matchesItem: matchesGlyphIndex },
            lookahead: EMPTY_SEQUENCE
        });
        if (inputPositions) {
            // the first matching rule applies, even when its lookups substitute nothing
            return applyNestedLookupRecords.call(this, contextParams.context, inputPositions, rule.lookupRecords);
        }
    }
    return null;
}

/**
 * Get the class of a glyph in a class definition table, 0 when the table is missing
 * @param {Font} font opentype font instance
 * @param {any} classDef class definition table
 * @param {number} glyphIndex glyph index
 * @returns {number}
 */
function getGlyphClass(font, classDef, glyphIndex) {
    if (!classDef) return 0;
    return font.substitution.getGlyphClass(classDef, glyphIndex) || 0;
}

/**
 * Handle context substitution - format 2 (class-based rules)
 * @param {ContextParams} contextParams context params to lookup
 * @param {any} subtable subtable
 * @param {any} lookupTable the lookup of the subtable, its lookupFlag tells the glyphs to skip
 * @returns {ContextualMatch|null} the substitutions of the first rule that matches (none if it substitutes nothing), null if none matches
 */
function contextSubstitutionFormat2(contextParams, subtable, lookupTable) {
    const glyphIndex = contextParams.current;
    if (lookupCoverage(glyphIndex, subtable.coverage) === -1) {
        return null;
    }
    const classSet = subtable.classSets[getGlyphClass(this.font, subtable.classDef, glyphIndex)];
    if (!classSet) return null;
    const matchesClass = getGlyphClassMatcher(this.font, subtable.classDef);
    for (let i = 0; i < classSet.length; i++) {
        const rule = classSet[i];
        const inputPositions = matchContextRule(getLayoutGdefTable(this.font), contextParams, lookupTable, {
            backtrack: EMPTY_SEQUENCE,
            input: { items: rule.classes, matchesItem: matchesClass },
            lookahead: EMPTY_SEQUENCE
        });
        if (inputPositions) {
            // the first matching rule applies, even when its lookups substitute nothing
            return applyNestedLookupRecords.call(this, contextParams.context, inputPositions, rule.lookupRecords);
        }
    }
    return null;
}

/**
 * Handle chaining context substitution - format 1 (glyph-based rules)
 * @param {ContextParams} contextParams context params to lookup
 * @param {any} subtable subtable
 * @param {any} lookupTable the lookup of the subtable, its lookupFlag tells the glyphs to skip
 * @returns {ContextualMatch|null} the substitutions of the first rule that matches (none if it substitutes nothing), null if none matches
 */
function chainingSubstitutionFormat1(contextParams, subtable, lookupTable) {
    const coverageIndex = lookupCoverage(contextParams.current, subtable.coverage);
    if (coverageIndex === -1) return null;
    const chainRuleSet = subtable.chainRuleSets[coverageIndex];
    if (!chainRuleSet) return null;
    for (let i = 0; i < chainRuleSet.length; i++) {
        const rule = chainRuleSet[i];
        // the backtrack sequence is matched from the glyph before the current one, backwards
        const inputPositions = matchContextRule(getLayoutGdefTable(this.font), contextParams, lookupTable, {
            backtrack: { items: rule.backtrack, matchesItem: matchesGlyphIndex },
            input: { items: rule.input, matchesItem: matchesGlyphIndex },
            lookahead: { items: rule.lookahead, matchesItem: matchesGlyphIndex }
        });
        if (inputPositions) {
            // the first matching rule applies, even when its lookups substitute nothing
            return applyNestedLookupRecords.call(this, contextParams.context, inputPositions, rule.lookupRecords);
        }
    }
    return null;
}

/**
 * Handle chaining context substitution - format 2 (class-based rules)
 * @param {ContextParams} contextParams context params to lookup
 * @param {any} subtable subtable
 * @param {any} lookupTable the lookup of the subtable, its lookupFlag tells the glyphs to skip
 * @returns {ContextualMatch|null} the substitutions of the first rule that matches (none if it substitutes nothing), null if none matches
 */
function chainingSubstitutionFormat2(contextParams, subtable, lookupTable) {
    const glyphIndex = contextParams.current;
    if (lookupCoverage(glyphIndex, subtable.coverage) === -1) {
        return null;
    }
    const chainClassSet = subtable.chainClassSet[getGlyphClass(this.font, subtable.inputClassDef, glyphIndex)];
    if (!chainClassSet) return null;
    const matchesBacktrackClass = getGlyphClassMatcher(this.font, subtable.backtrackClassDef);
    const matchesInputClass = getGlyphClassMatcher(this.font, subtable.inputClassDef);
    const matchesLookaheadClass = getGlyphClassMatcher(this.font, subtable.lookaheadClassDef);
    for (let i = 0; i < chainClassSet.length; i++) {
        const rule = chainClassSet[i];
        // the backtrack sequence is matched from the glyph before the current one, backwards
        const inputPositions = matchContextRule(getLayoutGdefTable(this.font), contextParams, lookupTable, {
            backtrack: { items: rule.backtrack, matchesItem: matchesBacktrackClass },
            input: { items: rule.input, matchesItem: matchesInputClass },
            lookahead: { items: rule.lookahead, matchesItem: matchesLookaheadClass }
        });
        if (inputPositions) {
            // the first matching rule applies, even when its lookups substitute nothing
            return applyNestedLookupRecords.call(this, contextParams.context, inputPositions, rule.lookupRecords);
        }
    }
    return null;
}

/**
 * Handle context substitution - format 3
 * @param {ContextParams} contextParams context params to lookup
 * @param {any} subtable subtable
 * @param {any} lookupTable the lookup of the subtable, its lookupFlag tells the glyphs to skip
 * @returns {ContextualMatch|null} the substitutions of the rule if it matches (none if it substitutes nothing), null otherwise
 */
function contextSubstitutionFormat3(contextParams, subtable, lookupTable) {
    // a rule without input glyphs matches nothing, like HarfBuzz
    if (!subtable.coverages.length) {
        return null;
    }
    if (!matchesCoverage(contextParams.current, subtable.coverages[0])) {
        return null;
    }
    const inputPositions = matchContextRule(getLayoutGdefTable(this.font), contextParams, lookupTable, {
        backtrack: EMPTY_SEQUENCE,
        input: { items: subtable.coverages.slice(1), matchesItem: matchesCoverage },
        lookahead: EMPTY_SEQUENCE
    });
    if (!inputPositions) {
        return null;
    }
    return applyNestedLookupRecords.call(this, contextParams.context, inputPositions, subtable.lookupRecords);
}

/**
 * Handle decomposition substitution - format 1
 * @param {number} glyphIndex glyph index
 * @param {any} subtable subtable
 */
function decompositionSubstitutionFormat1(glyphIndex, subtable) {
    let substituteIndex = lookupCoverage(glyphIndex, subtable.coverage);
    if (substituteIndex === -1) return null;
    return subtable.sequences[substituteIndex];
}

/**
 * Get default script features indexes
 */
FeatureQuery.prototype.getDefaultScriptFeaturesIndexes = function () {
    const scripts = this.font.tables.gsub.scripts;
    for (let s = 0; s < scripts.length; s++) {
        const script = scripts[s];
        if (script.tag === 'DFLT') return (
            script.script.defaultLangSys.featureIndexes
        );
    }
    return [];
};

/**
 * Get feature indexes of a specific script
 * @param {string} scriptTag script tag
 */
FeatureQuery.prototype.getScriptFeaturesIndexes = function(scriptTag) {
    const tables = this.font.tables;
    if (!tables.gsub) return [];
    if (!scriptTag) return this.getDefaultScriptFeaturesIndexes();
    const scripts = this.font.tables.gsub.scripts;
    for (let i = 0; i < scripts.length; i++) {
        const script = scripts[i];
        if (script.tag === scriptTag && script.script.defaultLangSys) {
            return script.script.defaultLangSys.featureIndexes;
        } else {
            let langSysRecords = script.langSysRecords;
            if (langSysRecords) {
                for (let j = 0; j < langSysRecords.length; j++) {
                    const langSysRecord = langSysRecords[j];
                    if (langSysRecord.tag === scriptTag) {
                        let langSys = langSysRecord.langSys;
                        return langSys.featureIndexes;
                    }
                }
            }
        }
    }
    return this.getDefaultScriptFeaturesIndexes();
};

/**
 * Map a feature tag to a gsub feature
 * @param {any} features gsub features
 * @param {string} scriptTag script tag
 */
FeatureQuery.prototype.mapTagsToFeatures = function (features, scriptTag) {
    let tags = {};
    for (let i = 0; i < features.length; i++) {
        const tag = features[i].tag;
        const feature = features[i].feature;
        tags[tag] = feature;
    }
    this.features[scriptTag].tags = tags;
};

/**
 * Get features of a specific script
 * @param {string} scriptTag script tag
 */
FeatureQuery.prototype.getScriptFeatures = function (scriptTag) {
    let features = this.features[scriptTag];
    if (Object.prototype.hasOwnProperty.call(this.features, scriptTag)) return features;
    const featuresIndexes = this.getScriptFeaturesIndexes(scriptTag);
    if (!featuresIndexes) return null;
    const gsub = this.font.tables.gsub;
    const featureVariations = this.getFeatureVariationSubstitutions();
    features = featuresIndexes.map(index => {
        const feature = gsub.features[index];
        const alternateFeature = feature && featureVariations.get(index);
        return alternateFeature ? { tag: feature.tag, feature: alternateFeature } : feature;
    });
    this.features[scriptTag] = features;
    this.mapTagsToFeatures(features, scriptTag);
    return features;
};

/**
 * Get the alternate feature tables of the GSUB feature variations for the current
 * variation coordinates of the font: the first feature variation record whose
 * conditions are all met applies.
 * @returns {Map<number, any>} alternate feature tables by feature index
 */
FeatureQuery.prototype.getFeatureVariationSubstitutions = function () {
    const substitutions = new Map();
    const featureVariations = this.font.tables.gsub && this.font.tables.gsub.variations;
    if (!featureVariations || !featureVariations.length || !this.font.variation) return substitutions;
    // normalized coordinates, in the F2DOT14 precision of the condition values
    const coordinates = this.font.variation.process.getNormalizedCoords();
    for (let i = 0; i < featureVariations.length; i++) {
        const record = featureVariations[i];
        const conditionsMet = (record.conditions || []).every(condition => {
            if (condition.format !== 1) return false;
            const coordinate = coordinates[condition.axisIndex] || 0;
            return coordinate >= condition.filterRangeMinValue && coordinate <= condition.filterRangeMaxValue;
        });
        if (conditionsMet) {
            for (const substitution of record.substitutions || []) {
                substitutions.set(substitution.featureIndex, substitution.feature);
            }
            break;
        }
    }
    return substitutions;
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
        // the methods that match several glyphs take the lookup whose lookupFlag tells the glyphs to skip
        // (the lookup of an extension subtable, not the extension subtable)
        case '61':
            return (contextParams, flagsLookupTable) => chainingSubstitutionFormat1.apply(
                this, [contextParams, subtable, flagsLookupTable]
            );
        case '62':
            return (contextParams, flagsLookupTable) => chainingSubstitutionFormat2.apply(
                this, [contextParams, subtable, flagsLookupTable]
            );
        case '63':
            return (contextParams, flagsLookupTable) => chainingSubstitutionFormat3.apply(
                this, [contextParams, subtable, flagsLookupTable]
            );
        case '41':
            return (contextParams, flagsLookupTable) => ligatureSubstitutionFormat1.apply(
                this, [contextParams, subtable, flagsLookupTable]
            );
        case '21':
            return glyphIndex => decompositionSubstitutionFormat1.apply(
                this, [glyphIndex, subtable]
            );
        case '51':
            return (contextParams, flagsLookupTable) => contextSubstitutionFormat1.apply(
                this, [contextParams, subtable, flagsLookupTable]
            );
        case '52':
            return (contextParams, flagsLookupTable) => contextSubstitutionFormat2.apply(
                this, [contextParams, subtable, flagsLookupTable]
            );
        case '53':
            return (contextParams, flagsLookupTable) => contextSubstitutionFormat3.apply(
                this, [contextParams, subtable, flagsLookupTable]
            );
        default:
            // unsupported lookups are skipped (warned once per type), so the
            // supported lookups of the same feature still apply
            if (!warnedUnsupportedSubstitutionTypes.has(this.font)) {
                warnedUnsupportedSubstitutionTypes.set(this.font, new Set());
            }
            if (!warnedUnsupportedSubstitutionTypes.get(this.font).has(substitutionType)) {
                warnedUnsupportedSubstitutionTypes.get(this.font).add(substitutionType);
                console.warn(
                    `[opentype.js] substitutionType: ${substitutionType} ` +
                    `lookupType: ${lookupTable.lookupType} - ` +
                    `substFormat: ${subtable.substFormat} ` +
                    'is not yet supported, lookup skipped'
                );
            }
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

/**
 * @typedef FQuery
 * @type Object
 * @param {string} tag feature tag
 * @param {string} script feature script
 * @param {ContextParams} contextParams context params
 */

/**
 * Lookup a feature using a query parameters
 * @param {FQuery} query feature query
 */
FeatureQuery.prototype.lookupFeature = function (query) {
    let contextParams = query.contextParams;
    let currentIndex = contextParams.index;
    const feature = this.getFeature({
        tag: query.tag, script: query.script
    });
    if (!feature) return new Error(
        `font '${(this.font.names.unicode || this.font.names.windows || this.font.names.macintosh).fullName.en}' ` +
        `doesn't support feature '${query.tag}' ` +
        `for script '${query.script}'.`
    );
    const lookups = this.getFeatureLookups(feature);
    const substitutions = [].concat(contextParams.context);
    for (let l = 0; l < lookups.length; l++) {
        const lookupTable = lookups[l];
        // a lookup does not apply at a glyph it ignores
        if (isGlyphIgnoredByLookup(getLayoutGdefTable(this.font), lookupTable, contextParams.current)) {
            continue;
        }
        const subtables = this.getLookupSubtables(lookupTable);
        for (let s = 0; s < subtables.length; s++) {
            let subtable = subtables[s];
            let substType = this.getSubstitutionType(lookupTable, subtable);
            let lookup;

            if (substType === '71') {
                // This is an extension subtable, so lookup the target subtable
                substType = this.getSubstitutionType(subtable, subtable.extension);
                lookup = this.getLookupMethod(subtable, subtable.extension);
                subtable = subtable.extension;
            } else {
                lookup = this.getLookupMethod(lookupTable, subtable);
            }
            if (!lookup) {
                continue;
            }

            let substitution;
            let contextualRuleMatched = false;
            switch (substType) {
                case '11':
                    substitution = lookup(contextParams.current);
                    if (substitution) {
                        substitutions.splice(currentIndex, 1, new SubstitutionAction({
                            id: 11, tag: query.tag, substitution
                        }));
                    }
                    break;
                case '12':
                    substitution = lookup(contextParams.current);
                    if (substitution) {
                        substitutions.splice(currentIndex, 1, new SubstitutionAction({
                            id: 12, tag: query.tag, substitution
                        }));
                    }
                    break;
                case '41':
                    substitution = lookup(contextParams, lookupTable);
                    if (substitution) {
                        substitutions.splice(currentIndex, 1, new SubstitutionAction({
                            id: 41, tag: query.tag, substitution
                        }));
                    }
                    break;
                case '21':
                    substitution = lookup(contextParams.current);
                    if (substitution) {
                        substitutions.splice(currentIndex, 1, new SubstitutionAction({
                            id: 21, tag: query.tag, substitution
                        }));
                    }
                    break;
                case '51':
                case '52':
                case '53':
                case '61':
                case '62':
                case '63':
                    substitution = lookup(contextParams, lookupTable);
                    // a matching contextual rule ends the lookup, even when it substitutes nothing (e.g. an exception rule)
                    contextualRuleMatched = substitution !== null;
                    if (contextualRuleMatched && substitution.substitutions.length) {
                        substitutions.splice(currentIndex, 1, new SubstitutionAction({
                            id: parseInt(substType),
                            tag: query.tag,
                            substitution
                        }));
                    }
                    break;
            }
            contextParams = new ContextParams(substitutions, currentIndex);
            if (contextualRuleMatched) break;
            if (Array.isArray(substitution) && !substitution.length) continue;
            substitution = null;
        }
    }
    return substitutions.length ? substitutions : null;
};

// top-level lookup types (lookupType + substFormat) applied by lookupSubstitution
const APPLIED_SUBSTITUTION_TYPES = ['11', '12', '21', '41', '51', '52', '53', '61', '62', '63'];

/**
 * Apply one lookup at the current glyph of a context: the first subtable of the
 * lookup that applies wins (a matching contextual rule ends the lookup even when it
 * substitutes nothing). Lookups of unsupported types are handled by getLookupMethod.
 * The lookup does not apply at a glyph its lookupFlag ignores, and skips the glyphs
 * it ignores when it matches the other glyphs of a rule or of a ligature.
 * @param {any} lookupTable lookup table
 * @param {ContextParams} contextParams context params, its current glyph is the one to substitute
 * @param {string} tag feature tag set as the state of the substituted tokens
 * @returns {SubstitutionAction|null} the substitution to apply at the current glyph, if any: a contextual rule that
 * matches gives its ContextualMatch even when it substitutes nothing (e.g. an exception rule), the lookup goes on after
 * its input
 */
FeatureQuery.prototype.lookupSubstitution = function (lookupTable, contextParams, tag) {
    if (isGlyphIgnoredByLookup(getLayoutGdefTable(this.font), lookupTable, contextParams.current)) {
        return null;
    }
    const subtables = this.getLookupSubtables(lookupTable) || [];
    for (let s = 0; s < subtables.length; s++) {
        let subtableOwner = lookupTable;
        let subtable = subtables[s];
        let substitutionType = this.getSubstitutionType(lookupTable, subtable);
        if (substitutionType === '71') {
            // This is an extension subtable, so lookup the target subtable
            subtableOwner = subtable;
            subtable = subtable.extension;
            substitutionType = this.getSubstitutionType(subtableOwner, subtable);
        }
        // getLookupMethod handles the lookups of unsupported types (it throws, or reports and skips them)
        const lookup = this.getLookupMethod(subtableOwner, subtable);
        if (!lookup || !APPLIED_SUBSTITUTION_TYPES.includes(substitutionType)) continue;
        const id = parseInt(substitutionType);
        if (substitutionType === '11' || substitutionType === '12') {
            const substitution = lookup(contextParams.current);
            if (substitution !== null && substitution !== undefined) {
                return new SubstitutionAction({ id, tag, substitution });
            }
        } else if (substitutionType === '21') {
            // multiple substitution: the glyph becomes a sequence of glyphs (none deletes it)
            const substitution = lookup(contextParams.current);
            if (Array.isArray(substitution)) {
                return new SubstitutionAction({ id, tag, substitution });
            }
        } else if (substitutionType === '41') {
            const substitution = lookup(contextParams, lookupTable);
            if (substitution) {
                return new SubstitutionAction({ id, tag, substitution });
            }
        } else {
            const substitution = lookup(contextParams, lookupTable);
            if (substitution) {
                return new SubstitutionAction({ id, tag, substitution });
            }
        }
    }
    return null;
};

/**
 * Checks if a font supports a specific features
 * @param {FQuery} query feature query object
 */
FeatureQuery.prototype.supports = function (query) {
    if (!query.script) return false;
    this.getScriptFeatures(query.script);
    const supportedScript = Object.prototype.hasOwnProperty.call(this.features, query.script);
    if (!query.tag) return supportedScript;
    const supportedFeature = (
        this.features[query.script].some(feature => feature.tag === query.tag)
    );
    return supportedScript && supportedFeature;
};

/**
 * Get lookup table subtables
 * @param {any} lookupTable lookup table
 */
FeatureQuery.prototype.getLookupSubtables = function (lookupTable) {
    return lookupTable.subtables || null;
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
 * Get lookup tables for a feature
 * @param {string} feature
 */
FeatureQuery.prototype.getFeatureLookups = function (feature) {
    // TODO: memoize
    return feature.lookupListIndexes.map(this.getLookupByIndex.bind(this));
};

/**
 * Query a feature by it's properties
 * @param {any} query an object that describes the properties of a query
 */
FeatureQuery.prototype.getFeature = function getFeature(query) {
    if (!this.font) return { FAIL: 'No font was found'};
    if (!Object.prototype.hasOwnProperty.call(this.features, query.script)) {
        this.getScriptFeatures(query.script);
    }
    const scriptFeatures = this.features[query.script];
    if (!scriptFeatures) return (
        { FAIL: `No feature for script ${query.script}`}
    );
    if (!scriptFeatures.tags[query.tag]) return null;
    return this.features[query.script].tags[query.tag];
};

export default FeatureQuery;
export { FeatureQuery, SubstitutionAction };
