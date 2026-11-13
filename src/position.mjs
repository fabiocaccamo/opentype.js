// The Position object provides utility methods to manipulate
// the GPOS position table, and the application of its lookups to the glyphs of a text (see Font.shape).

import Layout, { getLayoutGdefTable, isGlyphIgnoredByLookup, findNextNotIgnoredGlyphPosition, IGNORE_MARKS, getRequiredFeatureIndex } from './layout.mjs';
import { warnOncePerFont } from './util.mjs';

// the features of common_features and horizontal_features (hb-ot-shape.cc) that are not default GSUB features of a
// shaper of the fork (see Font.defaultRenderOptions.features): HarfBuzz looks each feature up in GSUB and in GPOS, so
// the GPOS features of a run are these and the GSUB features of its shaper, their lookups together in LookupList order
const DEFAULT_POSITIONING_FEATURES = ['abvm', 'blwm', 'curs', 'dist', 'kern', 'mark', 'mkmk'];

const PAIR_ADJUSTMENT_LOOKUP_TYPE = 2;
const EXTENSION_LOOKUP_TYPE = 9;

// the application of a subtable at a glyph of a run by lookup type (see applyPairAdjustment), the lookup types
// not listed are not implemented yet
const subtableApplications = {
    [PAIR_ADJUSTMENT_LOOKUP_TYPE]: applyPairAdjustment
};

// like hb_kern_machine_t of HarfBuzz, the kern table kerns a glyph with the next glyph that is not a GDEF mark
const KERN_TABLE_LOOKUP = { lookupFlag: IGNORE_MARKS };

// the field of the Device or VariationIndex table of each field of a value record that horizontal text applies (the
// y advance and its yAdvDevice are for vertical text)
const VALUE_RECORD_DEVICE_FIELDS = {
    xPlacement: 'xPlaDevice',
    yPlacement: 'yPlaDevice',
    xAdvance: 'xAdvDevice'
};

/**
 * @exports opentype.Position
 * @class
 * @extends opentype.Layout
 * @param {opentype.Font}
 * @constructor
 */
function Position(font) {
    Layout.call(this, font, 'gpos');
}

Position.prototype = Layout.prototype;

/**
 * Init some data for faster and easier access later.
 */
Position.prototype.init = function() {
    this.defaultKerningTables = this.getKerningTables();
};

/**
 * The value of a field of a value record, with the variation delta of its VariationIndex table when the font is
 * variable, like HarfBuzz (ValueFormat::apply_value): the hinting deltas of a Device table, which depend on the
 * size in pixels, do not apply to positions in font units.
 * @param {Position} position
 * @param {object|undefined} valueRecord
 * @param {string} field - xPlacement, yPlacement or xAdvance
 * @param {object} [variation] - variation coordinates, the current font variation if omitted
 * @returns {number}
 */
function getValueRecordValue(position, valueRecord, field, variation) {
    if (!valueRecord) {
        return 0;
    }
    const value = valueRecord[field] || 0;
    const device = valueRecord[VALUE_RECORD_DEVICE_FIELDS[field]];
    const gdef = getLayoutGdefTable(position.font);
    if (!device || device.deltaFormat !== 0x8000 || !position.font.variation || !gdef || !gdef.itemVarStore) {
        return value;
    }
    const delta = position.font.variation.process.getDelta(
        gdef.itemVarStore, device.deltaSetOuterIndex, device.deltaSetInnerIndex,
        variation || position.font.variation.get()
    );
    return Math.round(value + delta);
}

/**
 * Get the xAdvance of a value record, adding the variation delta of its VariationIndex table when the font is
 * variable.
 *
 * @param {object} valueRecord
 * @param {object} [variation] - variation coordinates, the current font variation if omitted
 * @returns {number}
 */
Position.prototype.getValueRecordXAdvance = function(valueRecord, variation) {
    return getValueRecordValue(this, valueRecord, 'xAdvance', variation);
};

/**
 * Add a value record to the position of a glyph of horizontal text, like HarfBuzz (ValueFormat::apply_value): its
 * placements to the offsets, its x advance to the advance. Its y advance is for vertical layout only (OpenType
 * ValueRecord), HarfBuzz does not apply it to horizontal text either.
 * @param {Position} position
 * @param {{xAdvance: number, xOffset: number, yOffset: number}} glyphPosition - updated
 * @param {object|undefined} valueRecord
 * @param {object} [variation]
 */
function addValueRecord(position, glyphPosition, valueRecord, variation) {
    if (!valueRecord) {
        return;
    }
    glyphPosition.xOffset += getValueRecordValue(position, valueRecord, 'xPlacement', variation);
    glyphPosition.yOffset += getValueRecordValue(position, valueRecord, 'yPlacement', variation);
    glyphPosition.xAdvance += getValueRecordValue(position, valueRecord, 'xAdvance', variation);
}

/**
 * Find the adjustment of a glyph pair in a pair adjustment subtable, if the subtable applies to the
 * pair: format 1 applies to the pairs it lists, format 2 to any right glyph once it covers the left
 * glyph (a class record of class 0 included), unless a class is out of the class counts (HarfBuzz).
 *
 * @param {opentype.Layout} layout - the GPOS layout, for its coverage and class definition lookups
 * @param {object} subtable - a pair adjustment subtable
 * @param {integer} leftIndex - left glyph index
 * @param {integer} rightIndex - right glyph index
 * @returns {{value1: object, value2: object}|undefined} the record with the value records of the two
 * glyphs (each one undefined when its value format is 0), undefined when the subtable does not apply
 */
function findPairAdjustment(layout, subtable, leftIndex, rightIndex) {
    const coverageIndex = layout.getCoverageIndex(subtable.coverage, leftIndex);
    if (coverageIndex < 0) {
        return;
    }
    switch (subtable.posFormat) {
        case 1: {
            const pairSet = subtable.pairSets[coverageIndex];
            return pairSet && pairSet.find(pairValueRecord => pairValueRecord.secondGlyph === rightIndex);
        }
        case 2: {
            const class1Record = subtable.classRecords[layout.getGlyphClass(subtable.classDef1, leftIndex)];
            return class1Record && class1Record[layout.getGlyphClass(subtable.classDef2, rightIndex)];
        }
    }
}

/**
 * Apply a pair adjustment subtable at a glyph of a run, like HarfBuzz (PairPosFormat1 and PairPosFormat2): the
 * second glyph of the pair is the next glyph of the run that the lookup does not ignore, the first value record
 * adjusts the first glyph and the second value record the second glyph. After a subtable with a second value
 * format the lookup goes on after the second glyph, otherwise at the second glyph, which can start a pair.
 * @param {Position} position
 * @param {object} lookupTable - the lookup of the subtable, for its lookupFlag
 * @param {object} subtable - a pair adjustment subtable
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the first glyph in the run
 * @returns {number} the position the lookup goes on at, -1 when the subtable does not apply
 */
function applyPairAdjustment(position, lookupTable, subtable, glyphRun, index) {
    const gdef = getLayoutGdefTable(position.font);
    const secondIndex = findNextNotIgnoredGlyphPosition(gdef, lookupTable, glyphRun.glyphIndexes, index, 1);
    if (secondIndex < 0) {
        return -1;
    }
    const pairAdjustment = findPairAdjustment(position, subtable, glyphRun.glyphIndexes[index], glyphRun.glyphIndexes[secondIndex]);
    if (!pairAdjustment) {
        return -1;
    }
    addValueRecord(position, glyphRun.glyphPositions[index], pairAdjustment.value1, glyphRun.variation);
    addValueRecord(position, glyphRun.glyphPositions[secondIndex], pairAdjustment.value2, glyphRun.variation);
    return subtable.valueFormat2 ? secondIndex + 1 : secondIndex;
}

/**
 * The subtables of a lookup with their lookup type, the subtables of an extension lookup (type 9) unwrapped,
 * each one with the lookup type of its extension subtable, like HarfBuzz; a malformed extension subtable
 * (without lookup type, see the GPOS parser) is skipped.
 * @param {object} lookupTable
 * @returns {Array<{lookupType: number, subtable: object}>}
 */
function getLookupSubtables(lookupTable) {
    if (lookupTable.lookupType !== EXTENSION_LOOKUP_TYPE) {
        return lookupTable.subtables.map(subtable => ({ lookupType: lookupTable.lookupType, subtable }));
    }
    return lookupTable.subtables
        .filter(subtable => subtable.lookupType !== undefined)
        .map(subtable => ({ lookupType: subtable.lookupType, subtable: subtable.extension }));
}

/**
 * Whether a GPOS lookup type is implemented (see subtableApplications).
 * @param {number} lookupType
 * @returns {boolean}
 */
function isLookupTypeSupported(lookupType) {
    return Boolean(subtableApplications[lookupType]);
}

/**
 * The subtables of a lookup (see getLookupSubtables) of the lookup types that are implemented, with a warning (once
 * per font and lookup type) for the other ones: they are skipped, so that the other lookups of their features still
 * apply.
 * @param {opentype.Font} font
 * @param {object} lookupTable
 * @returns {Array<{lookupType: number, subtable: object}>}
 */
function getAppliedLookupSubtables(font, lookupTable) {
    const appliedLookupSubtables = [];
    for (const lookupSubtable of getLookupSubtables(lookupTable)) {
        if (isLookupTypeSupported(lookupSubtable.lookupType)) {
            appliedLookupSubtables.push(lookupSubtable);
        } else {
            warnOncePerFont(font, 'GPOS lookupType', lookupSubtable.lookupType,
                () => `[opentype.js] GPOS lookupType: ${lookupSubtable.lookupType} is not yet supported, lookup skipped`);
        }
    }
    return appliedLookupSubtables;
}

/**
 * A run of glyphs that the GPOS lookups position.
 * @typedef GlyphRun
 * @type Object
 * @property {number[]} glyphIndexes - the glyph indexes, in the order of the text
 * @property {Array<{xAdvance: number, yAdvance: number, xOffset: number, yOffset: number}>} glyphPositions - the
 * positions of the glyphs, in font units, which the lookups adjust
 * @property {object} [variation] - variation coordinates, the current font variation if omitted
 */

/**
 * Apply a GPOS lookup to a run of glyphs, like HarfBuzz (apply_forward): at each glyph that the lookup does not
 * ignore, from the first one, the first subtable that applies to it; the lookup goes on at the glyph that this
 * subtable gives, otherwise at the next glyph. The subtables of the lookup types not implemented yet are skipped.
 * @param {Position} position
 * @param {object} lookupTable
 * @param {GlyphRun} glyphRun - updated
 * @param {number} lastIndex - the position in the run of the last glyph the lookup applies at
 */
function applyPositioningLookup(position, lookupTable, glyphRun, lastIndex) {
    const lookupSubtables = getAppliedLookupSubtables(position.font, lookupTable);
    if (!lookupSubtables.length) {
        return;
    }
    const gdef = getLayoutGdefTable(position.font);
    let index = 0;
    while (index <= lastIndex) {
        let nextIndex = -1;
        if (!isGlyphIgnoredByLookup(gdef, lookupTable, glyphRun.glyphIndexes[index])) {
            for (const { lookupType, subtable } of lookupSubtables) {
                nextIndex = subtableApplications[lookupType](position, lookupTable, subtable, glyphRun, index);
                if (nextIndex >= 0) {
                    break;
                }
            }
        }
        index = nextIndex >= 0 ? nextIndex : index + 1;
    }
}

/**
 * Apply GPOS lookups to a run of glyphs, one lookup after the other.
 * @param {Position} position
 * @param {object[]} lookupTables - in the order they apply in
 * @param {GlyphRun} glyphRun - updated
 * @param {number} lastIndex - the position in the run of the last glyph the lookups apply at (see
 * applyPositioningLookup)
 */
function applyPositioningLookups(position, lookupTables, glyphRun, lastIndex) {
    for (const lookupTable of lookupTables) {
        applyPositioningLookup(position, lookupTable, glyphRun, lastIndex);
    }
}

/**
 * Whether the GPOS table applies to a script: like the Hebrew shaper of HarfBuzz (its gpos_tag), a GPOS table
 * without the hebr script does not apply to hebr.
 * @param {Position} position
 * @param {string} script
 * @returns {boolean}
 */
function isGposAppliedToScript(position, script) {
    return script !== 'hebr' || position.getScriptNames().includes(script);
}

/**
 * The lookup tables of feature tables, each one once, in LookupList order, the order they apply in, like the GPOS
 * map of HarfBuzz.
 * @param {Position} position
 * @param {object[]} featureTables
 * @returns {object[]}
 */
function getLookupTablesOfFeatureTables(position, featureTables) {
    const lookupListIndexes = new Set();
    for (const featureTable of featureTables) {
        for (const lookupListIndex of featureTable.lookupListIndexes) {
            lookupListIndexes.add(lookupListIndex);
        }
    }
    const allLookups = position.font.tables.gpos.lookups;
    return Array.from(lookupListIndexes)
        .sort((indexA, indexB) => indexA - indexB)
        .map(lookupListIndex => allLookups[lookupListIndex])
        .filter(lookupTable => lookupTable);
}

/**
 * The feature table of the required feature (ReqFeatureIndex) of a GPOS language system, undefined when it has none;
 * like HarfBuzz, a feature index past the FeatureList is ignored.
 * @param {Position} position
 * @param {object} langSysTable
 * @returns {object|undefined}
 */
function getRequiredFeatureTable(position, langSysTable) {
    const requiredFeatureIndex = getRequiredFeatureIndex(langSysTable);
    const featureRecord = requiredFeatureIndex === undefined ? undefined : position.font.tables.gpos.features[requiredFeatureIndex];
    return featureRecord && featureRecord.feature;
}

/**
 * The feature tables of the features of a GPOS language system whose tag is one of the feature tags, for each tag
 * its first feature in FeatureIndex order, like Layout.getFeatureTable for each tag, in one pass over the
 * FeatureIndex; like HarfBuzz, a feature index past the FeatureList is ignored.
 * @param {Position} position
 * @param {object} langSysTable
 * @param {string[]} featureTags
 * @returns {object[]}
 */
function getTaggedFeatureTables(position, langSysTable, featureTags) {
    const featureRecords = position.font.tables.gpos.features;
    const remainingFeatureTags = new Set(featureTags);
    const featureTables = [];
    for (const featureIndex of langSysTable.featureIndexes) {
        const featureRecord = featureRecords[featureIndex];
        if (featureRecord && remainingFeatureTags.delete(featureRecord.tag)) {
            featureTables.push(featureRecord.feature);
        }
    }
    return featureTables;
}

/**
 * The lookup tables of the GPOS features of a script and language that the language system has (with the
 * fallbacks of getLangSysTable) and of its required feature, whatever the feature tags, like HarfBuzz
 * (hb_ot_map_builder_t), in the order they apply in (see getLookupTablesOfFeatureTables); none without a GPOS
 * table or a language system, or when GPOS does not apply to the script (see isGposAppliedToScript).
 * @param {Position} position
 * @param {string} script
 * @param {string} [language]
 * @param {string[]} featureTags
 * @returns {object[]}
 */
function getPositioningLookupTables(position, script, language, featureTags) {
    if (!position.getTable() || !isGposAppliedToScript(position, script)) {
        return [];
    }
    const langSysTable = position.getLangSysTable(script, language);
    if (!langSysTable) {
        return [];
    }
    const featureTables = [getRequiredFeatureTable(position, langSysTable)]
        .filter(featureTable => featureTable)
        .concat(getTaggedFeatureTables(position, langSysTable, featureTags));
    return getLookupTablesOfFeatureTables(position, featureTables);
}

/**
 * The feature table of the GPOS kern feature of a script and language, undefined when GPOS has none or does not
 * apply to the script (see isGposAppliedToScript): the kern table applies then, like in HarfBuzz.
 * @param {Position} position
 * @param {string} script
 * @param {string} [language]
 * @returns {object|undefined}
 */
function getKernFeatureTable(position, script, language) {
    if (isGposAppliedToScript(position, script)) {
        return position.getFeatureTable(script, language, 'kern');
    }
}

/**
 * The pair of the kern table that starts at a glyph of a run, like hb_kern_machine_t of HarfBuzz: from the first
 * glyph, each glyph is kerned with the next glyph that is not a GDEF mark, and the next pair starts at that glyph,
 * so a pair starts at the first glyph of the run and at each glyph that is not a GDEF mark.
 * @param {opentype.Font} font
 * @param {number[]} glyphIndexes - the glyph indexes of the run, in visual order
 * @param {number} first - the position of the glyph in the run
 * @returns {{first: number, second: number, value: number}|undefined} the positions in the run of the two glyphs of
 * the pair, with its value; undefined when no pair of the kern table starts at the glyph
 */
function getKernTablePair(font, glyphIndexes, first) {
    const gdef = getLayoutGdefTable(font);
    if (first > 0 && isGlyphIgnoredByLookup(gdef, KERN_TABLE_LOOKUP, glyphIndexes[first])) {
        return;
    }
    const second = findNextNotIgnoredGlyphPosition(gdef, KERN_TABLE_LOOKUP, glyphIndexes, first, 1);
    const value = second < 0 ? 0 : font.kerningPairs[glyphIndexes[first] + ',' + glyphIndexes[second]];
    if (value) {
        return { first, second, value };
    }
}

/**
 * The pairs of the kern table in a run of glyphs (see getKernTablePair).
 * @param {opentype.Font} font
 * @param {number[]} glyphIndexes - the glyph indexes of the run, in visual order
 * @returns {Array<{first: number, second: number, value: number}>}
 */
function getKernTablePairs(font, glyphIndexes) {
    return glyphIndexes
        .map((glyphIndex, first) => getKernTablePair(font, glyphIndexes, first))
        .filter(pair => pair);
}

/**
 * Apply the kern table to a run of glyphs in visual order, like HarfBuzz (hb_kern_machine_t): the value of a
 * pair is split between its two glyphs, half of it (rounded down) added to the advance of the first glyph, the
 * rest to the advance and to the x offset of the second glyph, which moves by the whole value.
 * @param {opentype.Font} font
 * @param {{glyphIndexes: number[], glyphPositions: object[]}} glyphRun - in visual order, its glyph positions
 * updated (see GlyphRun)
 */
function applyKernTable(font, glyphRun) {
    for (const { first, second, value } of getKernTablePairs(font, glyphRun.glyphIndexes)) {
        const firstValue = Math.floor(value / 2);
        const secondValue = value - firstValue;
        glyphRun.glyphPositions[first].xAdvance += firstValue;
        glyphRun.glyphPositions[second].xAdvance += secondValue;
        glyphRun.glyphPositions[second].xOffset += secondValue;
    }
}

/**
 * Position the glyphs of a run of one script and one direction, like hb_ot_position of HarfBuzz: the lookups of
 * the GPOS features of the script and language and of its required feature (see getPositioningLookupTables) apply
 * to the glyphs in the order of the text (the reverse of the visual order in a right-to-left run), in LookupList
 * order; then, when kern is one of the features and GPOS has no kern feature for the script and language, the kern
 * table applies, in visual order.
 * @param {Position} position
 * @param {number[]} glyphIndexes - the glyph indexes of the run, in visual order
 * @param {Array<{xAdvance: number, yAdvance: number, xOffset: number, yOffset: number}>} glyphPositions - the
 * positions of the glyphs, in visual order, in font units, updated
 * @param {{rightToLeft: boolean, script: string, language: string|undefined, featureTags: string[],
 * variation: object|undefined}} runOptions - the direction of the run, its OpenType script and language tags, the
 * GPOS features to apply, the variation coordinates
 */
function positionGlyphRun(position, glyphIndexes, glyphPositions, runOptions) {
    const { rightToLeft, script, language, featureTags, variation } = runOptions;
    const lookupTables = getPositioningLookupTables(position, script, language, featureTags);
    applyPositioningLookups(position, lookupTables, {
        glyphIndexes: rightToLeft ? glyphIndexes.slice().reverse() : glyphIndexes,
        glyphPositions: rightToLeft ? glyphPositions.slice().reverse() : glyphPositions,
        variation
    }, glyphIndexes.length - 1);
    if (featureTags.includes('kern') && !getKernFeatureTable(position, script, language)) {
        applyKernTable(position.font, { glyphIndexes, glyphPositions });
    }
}

/**
 * Get the xAdvance kerning value of a glyph pair in a list of lookup tables of type 2, like HarfBuzz:
 * in each lookup the first subtable that applies to the pair gives the value of the lookup, and the
 * values of the lookups add up. A lookup whose lookupFlag ignores one of the two glyphs (e.g. a mark of
 * GDEF with IgnoreMarks) adds nothing: to kern a glyph with the next glyph that each lookup does not
 * ignore, across the marks, use getGlyphRunKerningValue.
 *
 * Without lookup tables (undefined, as getKerningTables gives it when the GPOS table has no kern feature
 * for the script), the value is the one of the kern table, except for a right glyph that is a GDEF mark:
 * like HarfBuzz (hb_kern_machine_t), the kern table kerns a glyph with the next glyph that is not a GDEF
 * mark, so the pair adds nothing.
 *
 * @param {object[]|undefined} kerningLookups - lookup tables of type 2, in the order they apply, or undefined
 * for the kern table (see getKerningTables)
 * @param {integer} leftIndex - left glyph index
 * @param {integer} rightIndex - right glyph index
 * @param {object} [variation] - variation coordinates, the current font variation if omitted
 * @returns {integer}
 */
Position.prototype.getKerningValue = function(kerningLookups, leftIndex, rightIndex, variation) {
    return this.getGlyphRunKerningValue(kerningLookups, [leftIndex, rightIndex], 0, variation);
};

/**
 * Get the xAdvance kerning value of a glyph of a run of glyphs, in a list of lookup tables of type 2, like
 * HarfBuzz: each lookup applies to the run from its first glyph, at each glyph it does not ignore kerning that
 * glyph with the next glyph of the run that the lookup does not ignore (the lookupFlag and the GDEF classes, see
 * getKerningValue for the values of a pair), so that a pair is kerned across the marks of a lookup with
 * IgnoreMarks; the value of the glyph is what the lookups add to its advance: the x advance of the first value
 * record of its pairs and of the second value record of the pairs it ends (after a pair with a second value
 * record the lookup goes on after its second glyph, like HarfBuzz).
 * The kern table (kerningLookups undefined) kerns the glyph with the next glyph that is not a GDEF mark, like
 * HarfBuzz, and the value is the value of the pair (that Font.shape splits between the two glyphs, like HarfBuzz);
 * like HarfBuzz (hb_kern_machine_t), a pair of the kern table starts only at the first glyph of the run and at a
 * glyph that is not a GDEF mark, so a GDEF mark after the first glyph gets 0.
 * Each call applies the lookups to the run up to the glyph, so its cost grows with the position of the glyph:
 * Font.shape positions all the glyphs of a text at once.
 *
 * @param {object[]|undefined} kerningLookups - lookup tables of type 2, in the order they apply, or undefined
 * for the kern table (see getKerningTables)
 * @param {integer[]} glyphIndexes - the glyph indexes of the run, in the order of the pairs: the order of the
 * text for the GPOS lookups
 * @param {integer} position - the position of the glyph in the run
 * @param {object} [variation] - variation coordinates, the current font variation if omitted
 * @returns {integer} the value added to the advance of the glyph, 0 for a position outside the run
 */
Position.prototype.getGlyphRunKerningValue = function(kerningLookups, glyphIndexes, position, variation) {
    if (position < 0 || position >= glyphIndexes.length) {
        return 0;
    }
    if (!kerningLookups) {
        const kernTablePair = getKernTablePair(this.font, glyphIndexes, position);
        return kernTablePair ? kernTablePair.value : 0;
    }
    const glyphRun = {
        glyphIndexes,
        glyphPositions: glyphIndexes.map(() => ({ xAdvance: 0, yAdvance: 0, xOffset: 0, yOffset: 0 })),
        variation
    };
    // a pair that starts after the glyph does not adjust it
    applyPositioningLookups(this, kerningLookups, glyphRun, position);
    return glyphRun.glyphPositions[position].xAdvance;
};

/**
 * List the kerning lookup tables of a script and language in LookupList order, the order they
 * apply in, including the pair adjustment subtables wrapped in extension lookups.
 * A script the font has not falls back to DFLT, dflt, then latn, and a language the script has
 * not to the default language system of the script (see Layout.getScriptTable and getLangSysTable),
 * except hebr: like the Hebrew shaper of HarfBuzz (its gpos_tag), a GPOS table without the hebr
 * script does not apply to it.
 *
 * @param {string} [script='latn']
 * @param {string} [language='dflt']
 * @return {object[]|undefined} The list of kerning lookup tables (may be empty), or undefined if the GPOS
 * table has no kern feature for the script and language, or if there is no GPOS table: the kern table
 * applies then, like in HarfBuzz (see getKerningValue)
 */
Position.prototype.getKerningTables = function(script, language) {
    const featureTable = getKernFeatureTable(this, script || 'latn', language);
    if (!featureTable) {
        return;
    }
    const kerningTables = [];
    for (const lookupTable of getLookupTablesOfFeatureTables(this, [featureTable])) {
        if (lookupTable.lookupType === PAIR_ADJUSTMENT_LOOKUP_TYPE) {
            kerningTables.push(lookupTable);
        } else if (lookupTable.lookupType === EXTENSION_LOOKUP_TYPE) {
            // Extension Positioning lookup (used by fonts whose kerning data exceeds the 16-bit offsets):
            // expose its wrapped pair adjustment subtables as a lookup of type 2, keeping the lookup order.
            const subtables = getLookupSubtables(lookupTable)
                .filter(({ lookupType }) => lookupType === PAIR_ADJUSTMENT_LOOKUP_TYPE)
                .map(({ subtable }) => subtable);
            if (subtables.length) {
                kerningTables.push({
                    lookupType: PAIR_ADJUSTMENT_LOOKUP_TYPE,
                    lookupFlag: lookupTable.lookupFlag,
                    subtables: subtables,
                    markFilteringSet: lookupTable.markFilteringSet
                });
            }
        }
    }
    return kerningTables;
};

export default Position;
export { DEFAULT_POSITIONING_FEATURES, positionGlyphRun };
