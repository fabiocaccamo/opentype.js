/**
 * Query a feature by some of it's properties to lookup a glyph substitution.
 */

import { getLayoutGdefTable, isGlyphIgnoredByLookup, getNotIgnoredGlyphPositions, getRequiredFeatureIndex } from '../layout.mjs';
import { warnOncePerFont } from '../util.mjs';

/**
 * Create feature query instance
 * @param {Font} font opentype font instance
 * @param {Object} [variation] variation coordinates of the GSUB feature variations, the current variation of the font if omitted
 */
function FeatureQuery(font, variation) {
    this.font = font;
    this.variation = variation;
    // the features of each language system, by script and language (see getLanguageSystemKey)
    this.features = {};
}

/**
 * The key of the features of a language system in FeatureQuery.features
 * @param {string} [scriptTag] script tag, DFLT if omitted
 * @param {string} [languageTag] language tag, the default language system of the script if omitted
 * @returns {string}
 */
function getLanguageSystemKey(scriptTag, languageTag) {
    return (scriptTag || 'DFLT') + '|' + (languageTag || 'dflt');
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
 * Lookup a coverage table: like HarfBuzz, the glyph 0 (.notdef) is covered like any other glyph
 * @param {number|null} glyphIndex glyph index, null for a character with no glyph in a font without cmap (see
 * DefaultEncoding.charToGlyphIndex), which no coverage table covers
 * @param {CoverageTable} coverage coverage table
 */
function lookupCoverage(glyphIndex, coverage) {
    if (typeof glyphIndex !== 'number') {
        return -1;
    }
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
// single substitution format 1 and 2, multiple substitution format 1, ligature substitution format 1
const NESTED_SUBSTITUTION_TYPES = ['11', '12', '21', '41'];
const SINGLE_SUBSTITUTION_IDS = [11, 12];
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
 * @property {number} id substitution type: single, multiple or ligature (see NESTED_SUBSTITUTION_TYPES)
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
 * Get the glyph edits of a single, multiple or ligature substitution, in the order they apply: the glyph becomes the
 * glyph of a single substitution or the glyphs of a multiple substitution; the other components of a ligature are
 * deleted from the last one, so that the offsets of the other ones still point to their glyph, then its first
 * component becomes the ligature glyph
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
 * The change of the number of glyphs of a nested substitution (single, multiple or ligature)
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
 * Substitute the glyphs of a nested substitution in a list of glyph indexes, the glyphs the following lookup records
 * of the rule see, with the glyph edits that applySubstitution applies to the glyph sequence of the tokens
 * @param {number[]} glyphIndexes
 * @param {number} position the position of the glyph the substitution applies at
 * @param {LookupSubstitution} nestedSubstitution
 */
function substituteGlyphIndexes(glyphIndexes, position, nestedSubstitution) {
    for (const glyphEdit of getSubstitutionGlyphEdits(nestedSubstitution)) {
        glyphIndexes.splice(position + glyphEdit.offset, 1, ...glyphEdit.glyphIndexes);
    }
}

/**
 * The context params of a nested lookup at a glyph, with what a single, multiple or ligature substitution reads (the
 * context, the index and the current glyph), without the backtrack and the lookahead copies of a ContextParams
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
 * @param {ContextParams} contextParams context params of the rule, its current glyph is the first input glyph
 * @param {number[]} inputPositions positions of the matched input glyphs in the context, the current one first
 * @param {any[]} lookupRecords lookup records of the matched rule
 * @returns {ContextualMatch}
 */
function applyNestedLookupRecords(contextParams, inputPositions, lookupRecords) {
    const context = contextParams.context;
    const currentPosition = contextParams.index;
    // the glyphs after the substitutions of the previous records, from the position glyphIndexesStart: the context until
    // a substitution that a following record sees, then a copy of its glyphs from the current one, the only ones a
    // nested lookup reads
    let glyphIndexes = context;
    let glyphIndexesStart = 0;
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
        const nestedSubstitution = this.getLookupSubstitution(lookupTable, glyphContextParams, NESTED_SUBSTITUTION_TYPES);
        if (!nestedSubstitution) {
            continue;
        }
        substitutions.push({ offset: position - currentPosition, ...nestedSubstitution });
        if (i < lookupRecords.length - 1) {
            if (glyphIndexes === context) {
                glyphIndexes = context.slice(currentPosition);
                glyphIndexesStart = currentPosition;
            }
            substituteGlyphIndexes(glyphIndexes, position - glyphIndexesStart, nestedSubstitution);
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
    return applyNestedLookupRecords.call(this, contextParams, inputPositions, subtable.lookupRecords);
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
            return applyNestedLookupRecords.call(this, contextParams, inputPositions, rule.lookupRecords);
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
            return applyNestedLookupRecords.call(this, contextParams, inputPositions, rule.lookupRecords);
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
            return applyNestedLookupRecords.call(this, contextParams, inputPositions, rule.lookupRecords);
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
            return applyNestedLookupRecords.call(this, contextParams, inputPositions, rule.lookupRecords);
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
    return applyNestedLookupRecords.call(this, contextParams, inputPositions, subtable.lookupRecords);
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
 * ignored.
 * @param {string} [scriptTag] script tag
 * @param {string} [languageTag] language tag
 * @returns {Array<{tag: string, feature: any}>} the features, with a tags property that maps each tag to its feature
 * (the first one of the tag), and a required property, the required feature of the language system (see getRequiredFeature)
 */
FeatureQuery.prototype.getScriptFeatures = function (scriptTag, languageTag) {
    const key = getLanguageSystemKey(scriptTag, languageTag);
    if (Object.prototype.hasOwnProperty.call(this.features, key)) {
        return this.features[key];
    }
    const gsub = this.font.tables.gsub;
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
    this.features[key] = features;
    return features;
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
 * Get the alternate feature tables of the GSUB feature variations at the variation coordinates of the
 * query (the current variation of the font if it has none): the first feature variation record whose
 * conditions are all met applies.
 * @returns {Map<number, any>} alternate feature tables by feature index
 */
FeatureQuery.prototype.getFeatureVariationSubstitutions = function () {
    const substitutions = new Map();
    const featureVariations = this.font.tables.gsub && this.font.tables.gsub.variations;
    if (!featureVariations || !featureVariations.length || !this.font.variation) return substitutions;
    // normalized coordinates, in the F2DOT14 precision of the condition values
    const coordinates = this.font.variation.process.getNormalizedCoords(this.variation);
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
const APPLIED_SUBSTITUTION_TYPES = ['11', '12', '21', '41', '51', '52', '53', '61', '62', '63'];

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
 * @returns {LookupSubstitution|null}
 */
FeatureQuery.prototype.getLookupSubstitution = function (lookupTable, contextParams, substitutionTypes) {
    for (let subtable of this.getLookupSubtables(lookupTable) || []) {
        let subtableOwner = lookupTable;
        let substitutionType = this.getSubstitutionType(lookupTable, subtable);
        if (substitutionType === '71') {
            // This is an extension subtable, so lookup the target subtable
            subtableOwner = subtable;
            subtable = subtable.extension;
            substitutionType = this.getSubstitutionType(subtableOwner, subtable);
        }
        // getLookupMethod handles the lookups of unsupported types (it throws, or reports and skips them)
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
        } else {
            const substitution = lookup(contextParams, lookupTable);
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
 * @returns {SubstitutionAction|null} the substitution to apply at the current glyph, if any: a contextual rule that
 * matches gives its ContextualMatch even when it substitutes nothing (e.g. an exception rule), the lookup goes on after
 * its input; like HarfBuzz, the input never ends before the glyph a nested lookup applied at, so after a nested
 * ligature that takes glyphs past the input the lookup goes on at the ligature glyph
 */
FeatureQuery.prototype.lookupSubstitution = function (lookupTable, contextParams, tag) {
    if (isGlyphIgnoredByLookup(getLayoutGdefTable(this.font), lookupTable, contextParams.current)) {
        return null;
    }
    const lookupSubstitution = this.getLookupSubstitution(lookupTable, contextParams, APPLIED_SUBSTITUTION_TYPES);
    return lookupSubstitution && new SubstitutionAction({ ...lookupSubstitution, tag });
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
