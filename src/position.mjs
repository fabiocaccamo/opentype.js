// The Position object provides utility methods to manipulate
// the GPOS position table.

import Layout, { getLayoutGdefTable, isGlyphIgnoredByLookup, findNextNotIgnoredGlyphPosition } from './layout.mjs';

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
 * Get the xAdvance of a value record, adding the variation delta of its
 * VariationIndex table when the font is variable.
 *
 * @param {object} valueRecord
 * @param {object} [variation] - variation coordinates, the current font variation if omitted
 * @returns {number}
 */
Position.prototype.getValueRecordXAdvance = function(valueRecord, variation) {
    if (!valueRecord) {
        return 0;
    }
    const xAdvance = valueRecord.xAdvance || 0;
    const device = valueRecord.xAdvDevice;
    const gdef = getLayoutGdefTable(this.font);
    if (!device || device.deltaFormat !== 0x8000 || !this.font.variation || !gdef || !gdef.itemVarStore) {
        return xAdvance;
    }
    const delta = this.font.variation.process.getDelta(
        gdef.itemVarStore, device.deltaSetOuterIndex, device.deltaSetInnerIndex,
        variation || this.font.variation.get()
    );
    return Math.round(xAdvance + delta);
};

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
        case 1:
            return subtable.pairSets[coverageIndex].find(pairValueRecord => pairValueRecord.secondGlyph === rightIndex);
        case 2: {
            const class1Record = subtable.classRecords[layout.getGlyphClass(subtable.classDef1, leftIndex)];
            return class1Record && class1Record[layout.getGlyphClass(subtable.classDef2, rightIndex)];
        }
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
 * for the script), the value is the one of the kern table.
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
 * HarfBuzz: each lookup that does not ignore the glyph kerns it with the next glyph of the run that the lookup
 * does not ignore (the lookupFlag and the GDEF classes, see getKerningValue for the values of a pair), so that
 * a pair is kerned across the marks of a lookup with IgnoreMarks. The kern table (kerningLookups undefined)
 * kerns the glyph with the glyph right after it, unlike HarfBuzz, which skips the GDEF marks there too.
 *
 * @param {object[]|undefined} kerningLookups - lookup tables of type 2, in the order they apply, or undefined
 * for the kern table (see getKerningTables)
 * @param {integer[]} glyphIndexes - the glyph indexes of the run, in the order of the pairs: the order of the
 * text for the GPOS lookups
 * @param {integer} position - the position of the glyph in the run
 * @param {object} [variation] - variation coordinates, the current font variation if omitted
 * @returns {integer} the value added to the advance of the glyph
 */
Position.prototype.getGlyphRunKerningValue = function(kerningLookups, glyphIndexes, position, variation) {
    const leftIndex = glyphIndexes[position];
    if (!kerningLookups) {
        if (position + 1 >= glyphIndexes.length) {
            return 0;
        }
        return this.font.kerningPairs[leftIndex + ',' + glyphIndexes[position + 1]] || 0;
    }
    const gdef = getLayoutGdefTable(this.font);
    let kerningValue = 0;
    for (const lookupTable of kerningLookups) {
        if (isGlyphIgnoredByLookup(gdef, lookupTable, leftIndex)) {
            continue;
        }
        const rightPosition = findNextNotIgnoredGlyphPosition(gdef, lookupTable, glyphIndexes, position, 1);
        if (rightPosition < 0) {
            continue;
        }
        for (const subtable of lookupTable.subtables) {
            const pairAdjustment = findPairAdjustment(this, subtable, leftIndex, glyphIndexes[rightPosition]);
            if (pairAdjustment) {
                kerningValue += this.getValueRecordXAdvance(pairAdjustment.value1, variation);
                break;
            }
        }
    }
    return kerningValue;
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
    script = script || 'latn';
    if (script === 'hebr' && !this.getScriptNames().includes(script)) {
        return;
    }
    const featureTable = this.getFeatureTable(script, language, 'kern');
    if (!featureTable) {
        return;
    }
    const allLookups = this.font.tables.gpos.lookups;
    const lookupListIndexes = Array.from(new Set(featureTable.lookupListIndexes)).sort((indexA, indexB) => indexA - indexB);
    const kerningTables = [];
    for (const lookupListIndex of lookupListIndexes) {
        const lookupTable = allLookups[lookupListIndex];
        if (!lookupTable) {
            continue;
        }
        if (lookupTable.lookupType === 2) {
            kerningTables.push(lookupTable);
        } else if (lookupTable.lookupType === 9) {
            // Extension Positioning lookup (used by fonts whose kerning data exceeds the 16-bit offsets):
            // expose its wrapped pair adjustment subtables as a lookup of type 2, keeping the lookup order.
            const subtables = [];
            for (const subtable of lookupTable.subtables) {
                if (subtable.lookupType === 2) {
                    subtables.push(subtable.extension);
                }
            }
            if (subtables.length) {
                kerningTables.push({
                    lookupType: 2,
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
