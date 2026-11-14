// The Position object provides utility methods to manipulate
// the GPOS position table, and the application of its lookups to the glyphs of a text (see Font.shape).

import Layout, {
    getLayoutGdefTable, isGlyphIgnoredByLookup, findNextNotIgnoredGlyphPosition, isMarkGlyph, getLigatureId,
    getLigatureComponent, isMarkIgnoredWithoutGlyphClasses, IGNORE_BASE_GLYPHS, IGNORE_LIGATURES, IGNORE_MARKS, RIGHT_TO_LEFT, getRequiredFeatureIndex,
    matchSequenceContext, matchChainedSequenceContext, getCachedLayoutValue, HarfBuzzShaper, getHarfBuzzShaper,
    createIgnorableMatching, AUTO_JOINER_FLAGS, areJoinerFlagsEqual, NO_IGNORABLE_MATCHING, getSubtablesFirstGlyphDigest,
    mayGlyphDigestHave, createLookupFirstGlyphFilter, getLookupFilterGlyphDigest
} from './layout.mjs';
import { DEFAULT_IGNORABLE_TYPES, SPACE_TYPES } from './char.mjs';
import { getLookupJoinerFlags } from './features/featureValues.mjs';

// the features of common_features and horizontal_features (hb-ot-shape.cc) that are not default GSUB features of a
// shaper of the fork (see Font.defaultRenderOptions.features): HarfBuzz looks each feature up in GSUB and in GPOS, so
// the GPOS features of a run are these and the GSUB features of its shaper, their lookups together in LookupList order
const DEFAULT_POSITIONING_FEATURES = ['abvm', 'blwm', 'curs', 'dist', 'kern', 'mark', 'mkmk'];

const SINGLE_ADJUSTMENT_LOOKUP_TYPE = 1;
const PAIR_ADJUSTMENT_LOOKUP_TYPE = 2;
const CURSIVE_ATTACHMENT_LOOKUP_TYPE = 3;
const MARK_TO_BASE_ATTACHMENT_LOOKUP_TYPE = 4;
const MARK_TO_LIGATURE_ATTACHMENT_LOOKUP_TYPE = 5;
const MARK_TO_MARK_ATTACHMENT_LOOKUP_TYPE = 6;
const CONTEXTUAL_POSITIONING_LOOKUP_TYPE = 7;
const CHAINED_CONTEXTUAL_POSITIONING_LOOKUP_TYPE = 8;
const EXTENSION_LOOKUP_TYPE = 9;

// the application of a subtable at a glyph of a run by lookup type (see applySingleAdjustment, applyPairAdjustment,
// applyCursiveAttachment, applyMarkToBaseAttachment, applyMarkToLigatureAttachment, applyMarkToMarkAttachment,
// applyContextualPositioning and applyChainedContextualPositioning)
const subtableApplications = {
    [SINGLE_ADJUSTMENT_LOOKUP_TYPE]: applySingleAdjustment,
    [PAIR_ADJUSTMENT_LOOKUP_TYPE]: applyPairAdjustment,
    [CURSIVE_ATTACHMENT_LOOKUP_TYPE]: applyCursiveAttachment,
    [MARK_TO_BASE_ATTACHMENT_LOOKUP_TYPE]: applyMarkToBaseAttachment,
    [MARK_TO_LIGATURE_ATTACHMENT_LOOKUP_TYPE]: applyMarkToLigatureAttachment,
    [MARK_TO_MARK_ATTACHMENT_LOOKUP_TYPE]: applyMarkToMarkAttachment,
    [CONTEXTUAL_POSITIONING_LOOKUP_TYPE]: applyContextualPositioning,
    [CHAINED_CONTEXTUAL_POSITIONING_LOOKUP_TYPE]: applyChainedContextualPositioning
};

// like hb_kern_machine_t of HarfBuzz, the kern table kerns a glyph with the next glyph that is not a GDEF mark
const KERN_TABLE_LOOKUP = { lookupFlag: IGNORE_MARKS };

// how a glyph is attached to another one, the attach_type of HarfBuzz: by the anchors of a mark attachment (lookup
// types 4, 5 and 6) or of a cursive attachment (lookup type 3)
const MARK_ATTACHMENT = 'mark';
const CURSIVE_ATTACHMENT = 'cursive';

// HB_MAX_NESTING_LEVEL of HarfBuzz: the depth up to which the offsets of a chain of attached glyphs add up
// (propagate_attachment_offsets), and the lookups of contextual lookups nest (recurse)
const MAX_NESTING_LEVEL = 64;

// HB_BUFFER_MAX_OPS_FACTOR and HB_BUFFER_MAX_OPS_MIN of HarfBuzz: the lookup records of contextual rules apply at most
// this many nested lookups by glyph of a run, and at most this minimum to a shorter run (max_ops)
const MAX_OPERATIONS_BY_GLYPH = 1024;
const MIN_MAX_OPERATIONS = 16384;

/**
 * When the shaper of a run sets the advance of the GDEF marks to 0, like the zero_width_marks of the shapers of
 * HarfBuzz (HB_OT_SHAPE_ZERO_WIDTH_MARKS_NONE, BY_GDEF_EARLY and BY_GDEF_LATE): never, before the GPOS lookups (which
 * can then give a mark an advance) or after them.
 * @enum {string}
 */
const MarkAdvanceZeroing = Object.freeze({
    NONE: 'none',
    BEFORE_POSITIONING: 'beforePositioning',
    AFTER_POSITIONING: 'afterPositioning'
});

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
    return getVariedValue(position, valueRecord[field] || 0, valueRecord[VALUE_RECORD_DEVICE_FIELDS[field]], variation);
}

/**
 * A value of a value record or an anchor with the variation delta of its VariationIndex table when the font is
 * variable, like HarfBuzz (VariationDevice::get_x_delta): the hinting deltas of a Device table, which depend on the
 * size in pixels, do not apply to positions in font units.
 * @param {Position} position
 * @param {number} value
 * @param {object|undefined} device - the Device or VariationIndex table of the value
 * @param {object} [variation] - variation coordinates, the current font variation if omitted
 * @returns {number}
 */
function getVariedValue(position, value, device, variation) {
    if (!device || device.deltaFormat !== 0x8000) {
        return value;
    }
    const gdef = getLayoutGdefTable(position.font);
    if (!position.font.variation || !gdef || !gdef.itemVarStore) {
        return value;
    }
    const delta = position.font.variation.process.getDelta(
        gdef.itemVarStore, device.deltaSetOuterIndex, device.deltaSetInnerIndex,
        variation || position.font.variation.get()
    );
    return Math.round(value + delta);
}

/**
 * The coordinates of an anchor in font units, like HarfBuzz without hinting (Anchor::get_anchor): its x and y
 * coordinates with the variation deltas of the VariationIndex tables of format 3; the contour point of format 2 is
 * not used.
 * @param {Position} position
 * @param {{xCoordinate: number, yCoordinate: number, xDevice: object, yDevice: object}} anchor
 * @param {object} [variation] - variation coordinates, the current font variation if omitted
 * @returns {{x: number, y: number}}
 */
function getAnchorCoordinates(position, anchor, variation) {
    return {
        x: getVariedValue(position, anchor.xCoordinate, anchor.xDevice, variation),
        y: getVariedValue(position, anchor.yCoordinate, anchor.yDevice, variation)
    };
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
 * Find the adjustment of a glyph in a single adjustment subtable, if the subtable applies to the glyph, like
 * HarfBuzz (SinglePosFormat1 and SinglePosFormat2): format 1 has one value record for the glyphs it covers, format 2
 * the value record of the coverage index of the glyph, and does not apply when the index is out of its value records.
 * @param {opentype.Layout} layout - the GPOS layout, for its coverage lookups
 * @param {object} subtable - a single adjustment subtable
 * @param {integer} glyphIndex
 * @returns {{valueRecord: object}|undefined} the adjustment with the value record of the glyph (undefined when the
 * value format is 0), undefined when the subtable does not apply
 */
function findSingleAdjustment(layout, subtable, glyphIndex) {
    const coverageIndex = layout.getCoverageIndex(subtable.coverage, glyphIndex);
    if (coverageIndex < 0) {
        return;
    }
    switch (subtable.posFormat) {
        case 1:
            return { valueRecord: subtable.value };
        case 2:
            if (coverageIndex < subtable.values.length) {
                return { valueRecord: subtable.values[coverageIndex] };
            }
    }
}

/**
 * Apply a single adjustment subtable at a glyph of a run, like HarfBuzz (SinglePosFormat1 and SinglePosFormat2): its
 * value record adjusts the glyph, and the lookup goes on at the next glyph.
 * @param {Position} position
 * @param {object} lookupTable - the lookup of the subtable
 * @param {object} subtable - a single adjustment subtable
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the glyph in the run
 * @returns {number} the position the lookup goes on at, -1 when the subtable does not apply
 */
function applySingleAdjustment(position, lookupTable, subtable, glyphRun, index) {
    const singleAdjustment = findSingleAdjustment(position, subtable, glyphRun.glyphIndexes[index]);
    if (!singleAdjustment) {
        return -1;
    }
    addValueRecord(position, glyphRun.glyphPositions[index], singleAdjustment.valueRecord, glyphRun.variation);
    return index + 1;
}

/**
 * Find the adjustment of a glyph pair in a pair adjustment subtable that covers the left glyph, if the subtable
 * applies to the pair: format 1 applies to the pairs it lists, format 2 to any right glyph (a class record of class 0
 * included), unless a class is out of the class counts (HarfBuzz).
 *
 * @param {opentype.Layout} layout - the GPOS layout, for its class definition lookups
 * @param {object} subtable - a pair adjustment subtable
 * @param {integer} coverageIndex - the coverage index of the left glyph in the subtable
 * @param {integer} leftIndex - left glyph index
 * @param {integer} rightIndex - right glyph index
 * @returns {{value1: object, value2: object}|undefined} the record with the value records of the two
 * glyphs (each one undefined when its value format is 0), undefined when the subtable does not apply
 */
function findPairAdjustment(layout, subtable, coverageIndex, leftIndex, rightIndex) {
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
 * Apply a pair adjustment subtable at a glyph of a run, like HarfBuzz (PairPosFormat1 and PairPosFormat2): when the
 * subtable covers the glyph (checked first, so that a run of glyphs it does not cover is not searched for the second
 * glyph at each of them), the second glyph of the pair is the next glyph of the run that the lookup does not ignore
 * nor skip as a default ignorable (see GlyphRun.ignorableMatching), the first value record
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
    const coverageIndex = position.getCoverageIndex(subtable.coverage, glyphRun.glyphIndexes[index]);
    if (coverageIndex < 0) {
        return -1;
    }
    const secondIndex = findNextNotIgnoredGlyphPosition(
        glyphRun.gdef, lookupTable, glyphRun.glyphIndexes, index, 1, glyphRun.ignorableMatching.isSkippedInInput
    );
    if (secondIndex < 0) {
        return -1;
    }
    const pairAdjustment = findPairAdjustment(
        position, subtable, coverageIndex, glyphRun.glyphIndexes[index], glyphRun.glyphIndexes[secondIndex]
    );
    if (!pairAdjustment) {
        return -1;
    }
    addValueRecord(position, glyphRun.glyphPositions[index], pairAdjustment.value1, glyphRun.variation);
    addValueRecord(position, glyphRun.glyphPositions[secondIndex], pairAdjustment.value2, glyphRun.variation);
    return subtable.valueFormat2 ? secondIndex + 1 : secondIndex;
}

/**
 * The entry or the exit anchor of a glyph in a cursive attachment subtable, undefined when the subtable does not
 * cover the glyph or the glyph has no such anchor.
 * @param {Position} position
 * @param {object} subtable - a cursive attachment subtable
 * @param {number} glyphIndex
 * @param {string} anchorField - entryAnchor or exitAnchor
 * @returns {object|undefined}
 */
function getCursiveAnchor(position, subtable, glyphIndex, anchorField) {
    const entryExitRecord = subtable.entryExitRecords[position.getCoverageIndex(subtable.coverage, glyphIndex)];
    return entryExitRecord && entryExitRecord[anchorField];
}

/**
 * Turn the cursive attachments of a chain the other way round from a glyph, like HarfBuzz
 * (reverse_cursive_minor_offset): when a glyph already attached to another one gets a new parent, the glyphs it was
 * attached to, up to the new parent, attach to it in turn, with the opposite y offset. The chain is walked in a loop,
 * not recursively like HarfBuzz, so that a chain of any length fits in the call stack: its links are turned from the
 * far end back, each parent taking the y offset of its child before that child takes the one of its own child.
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the glyph in the run
 * @param {number} newParentIndex - the position of its new parent
 */
function reverseCursiveAttachments(glyphRun, index, newParentIndex) {
    const links = [];
    let childIndex = index;
    let attachment = glyphRun.attachments[childIndex];
    while (attachment && attachment.type === CURSIVE_ATTACHMENT) {
        glyphRun.attachments[childIndex] = undefined;
        if (attachment.parentIndex === newParentIndex) {
            break;
        }
        links.push({ childIndex, parentIndex: attachment.parentIndex });
        childIndex = attachment.parentIndex;
        attachment = glyphRun.attachments[childIndex];
    }
    for (let i = links.length - 1; i >= 0; i--) {
        const link = links[i];
        glyphRun.glyphPositions[link.parentIndex].yOffset = -glyphRun.glyphPositions[link.childIndex].yOffset;
        glyphRun.attachments[link.parentIndex] = { type: CURSIVE_ATTACHMENT, parentIndex: link.childIndex };
    }
}

/**
 * Join the advances of two glyphs of a cursive attachment along the direction of the run, like HarfBuzz
 * (CursivePosFormat1): left-to-right, the advance of the glyph before ends at its exit anchor and the glyph after
 * moves back to start at its entry anchor; right-to-left, the advance of the glyph after ends at its entry anchor and
 * the glyph before moves to start at its exit anchor.
 * @param {GlyphRun} glyphRun - updated
 * @param {number} exitIndex - the position of the glyph before, whose exit anchor joins
 * @param {number} entryIndex - the position of the glyph after, whose entry anchor joins
 * @param {number} exitX - the x of the exit anchor
 * @param {number} entryX - the x of the entry anchor
 */
function joinCursiveAdvances(glyphRun, exitIndex, entryIndex, exitX, entryX) {
    const exitPosition = glyphRun.glyphPositions[exitIndex];
    const entryPosition = glyphRun.glyphPositions[entryIndex];
    if (glyphRun.rightToLeft) {
        const exitDistance = exitX + exitPosition.xOffset;
        exitPosition.xAdvance -= exitDistance;
        exitPosition.xOffset -= exitDistance;
        entryPosition.xAdvance = entryX + entryPosition.xOffset;
    } else {
        exitPosition.xAdvance = exitX + exitPosition.xOffset;
        const entryDistance = entryX + entryPosition.xOffset;
        entryPosition.xAdvance -= entryDistance;
        entryPosition.xOffset -= entryDistance;
    }
}

/**
 * Attach a glyph of a cursive attachment to the other one across the direction of the run, like HarfBuzz
 * (CursivePosFormat1): its y offset follows the other glyph (see propagateAttachmentOffsets); a chain it was attached
 * to is turned the other way round (see reverseCursiveAttachments), and a parent attached to the glyph is detached
 * from it (https://github.com/harfbuzz/harfbuzz/issues/2469).
 * @param {GlyphRun} glyphRun - updated
 * @param {number} childIndex - the position of the glyph to attach
 * @param {number} parentIndex - the position of the glyph it attaches to
 * @param {number} yOffset - the y offset of the glyph from the other one
 */
function attachCursiveGlyph(glyphRun, childIndex, parentIndex, yOffset) {
    reverseCursiveAttachments(glyphRun, childIndex, parentIndex);
    glyphRun.attachments[childIndex] = { type: CURSIVE_ATTACHMENT, parentIndex };
    glyphRun.glyphPositions[childIndex].yOffset = yOffset;
    const parentAttachment = glyphRun.attachments[parentIndex];
    if (parentAttachment && parentAttachment.parentIndex === childIndex) {
        glyphRun.attachments[parentIndex] = undefined;
        glyphRun.glyphPositions[parentIndex].yOffset = 0;
    }
}

/**
 * Apply a cursive attachment subtable at a glyph of a run, like HarfBuzz (CursivePosFormat1): the entry anchor of the
 * glyph joins the exit anchor of the glyph before it that the lookup does not ignore nor skip as a default ignorable
 * (see GlyphRun.ignorableMatching), along the direction of the run
 * (see joinCursiveAdvances), and across it the glyph before is attached to the glyph after with the RightToLeft flag
 * of the lookupFlag (the last glyph of the text stays on the baseline), otherwise the glyph after to the glyph before
 * (see attachCursiveGlyph).
 * @param {Position} position
 * @param {object} lookupTable - the lookup of the subtable, for its lookupFlag
 * @param {object} subtable - a cursive attachment subtable
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the glyph in the run
 * @returns {number} the position the lookup goes on at, -1 when the subtable does not apply
 */
function applyCursiveAttachment(position, lookupTable, subtable, glyphRun, index) {
    const entryAnchor = getCursiveAnchor(position, subtable, glyphRun.glyphIndexes[index], 'entryAnchor');
    if (!entryAnchor) {
        return -1;
    }
    const previousIndex = findNextNotIgnoredGlyphPosition(
        glyphRun.gdef, lookupTable, glyphRun.glyphIndexes, index, -1, glyphRun.ignorableMatching.isSkippedInInput
    );
    const exitAnchor = previousIndex < 0 ? undefined : getCursiveAnchor(position, subtable, glyphRun.glyphIndexes[previousIndex], 'exitAnchor');
    if (!exitAnchor) {
        return -1;
    }
    const entry = getAnchorCoordinates(position, entryAnchor, glyphRun.variation);
    const exit = getAnchorCoordinates(position, exitAnchor, glyphRun.variation);
    joinCursiveAdvances(glyphRun, previousIndex, index, exit.x, entry.x);
    if (lookupTable.lookupFlag & RIGHT_TO_LEFT) {
        attachCursiveGlyph(glyphRun, previousIndex, index, entry.y - exit.y);
    } else {
        attachCursiveGlyph(glyphRun, index, previousIndex, exit.y - entry.y);
    }
    return index + 1;
}

/**
 * Attach a mark to a glyph before it in a run, like HarfBuzz (MarkArray::apply): the mark is moved so that its anchor
 * of its mark record is on the anchor of the glyph for its mark class, its offsets then follow the glyph (see
 * propagateAttachmentOffsets). The attachment does not apply when the glyph has no anchor for the mark class, nor when
 * the mark has no mark record (a malformed subtable); like HarfBuzz, a mark record without anchor (a NULL offset, which
 * the specification does not allow) has its anchor at 0 0.
 * @param {Position} position
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the mark in the run
 * @param {{markClass: number, markAnchor: object|undefined}|undefined} markRecord - the mark record of the mark
 * @param {Array<object|undefined>|undefined} parentAnchors - the anchors of the glyph, by mark class
 * @param {number} parentIndex - the position of the glyph in the run
 * @returns {number} the position the lookup goes on at, -1 when the attachment does not apply
 */
function attachMark(position, glyphRun, index, markRecord, parentAnchors, parentIndex) {
    const parentAnchor = markRecord && parentAnchors && parentAnchors[markRecord.markClass];
    if (!parentAnchor) {
        return -1;
    }
    const markCoordinates = markRecord.markAnchor ? getAnchorCoordinates(position, markRecord.markAnchor, glyphRun.variation) : { x: 0, y: 0 };
    const parentCoordinates = getAnchorCoordinates(position, parentAnchor, glyphRun.variation);
    const glyphPosition = glyphRun.glyphPositions[index];
    glyphPosition.xOffset = parentCoordinates.x - markCoordinates.x;
    glyphPosition.yOffset = parentCoordinates.y - markCoordinates.y;
    glyphRun.attachments[index] = { type: MARK_ATTACHMENT, parentIndex };
    return index + 1;
}

/**
 * The position of the glyph before each glyph of a run that is not a GDEF mark nor a default ignorable the lookup
 * skips, the base or the ligature a mark attaches to, like MarkBasePos and MarkLigPos of HarfBuzz: whatever the
 * lookupFlag of the lookup. One pass over the run, as GPOS changes no glyph, like HarfBuzz caches the base of the marks
 * after it (last_base).
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {number[]} glyphIndexes - the glyph indexes of the run
 * @param {function(number): boolean} isSkippedIgnorable - whether the glyph at a position of the run is a default
 * ignorable the lookup skips (see IgnorableMatching in layout.mjs)
 * @returns {number[]} -1 for a glyph without one
 */
function getMarkBaseIndexes(gdef, glyphIndexes, isSkippedIgnorable) {
    const markBaseIndexes = [];
    let baseIndex = -1;
    for (let i = 0; i < glyphIndexes.length; i++) {
        markBaseIndexes.push(baseIndex);
        if (!isMarkGlyph(gdef, glyphIndexes[i]) && !isSkippedIgnorable(i)) {
            baseIndex = i;
        }
    }
    return markBaseIndexes;
}

/**
 * The position of the base or the ligature of each glyph of a run for the lookup that applies to it (see
 * getMarkBaseIndexes): like HarfBuzz, a lookup skips a zero width joiner before a mark only with the
 * autoZeroWidthJoiner flag (not the lookups of mark and mkmk), so the positions are computed once for each flag
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {GlyphRun} glyphRun - its markBaseIndexes updated
 * @returns {number[]}
 */
function getRunMarkBaseIndexes(gdef, glyphRun) {
    const ignorableMatching = glyphRun.ignorableMatching;
    const autoZeroWidthJoiner = ignorableMatching.joinerFlags.autoZeroWidthJoiner;
    if (!glyphRun.markBaseIndexes.has(autoZeroWidthJoiner)) {
        glyphRun.markBaseIndexes.set(autoZeroWidthJoiner, getMarkBaseIndexes(gdef, glyphRun.glyphIndexes, ignorableMatching.isSkippedInInput));
    }
    return glyphRun.markBaseIndexes.get(autoZeroWidthJoiner);
}

/**
 * Apply a mark-to-base attachment subtable at a mark of a run, like HarfBuzz (MarkBasePosFormat1): the mark attaches
 * to the glyph before it that is not a GDEF mark nor a default ignorable the lookup skips (see getRunMarkBaseIndexes)
 * when the subtable covers both, whatever the
 * lookupFlag of the lookup. Not yet like HarfBuzz: a mark after the second glyph of a multiple substitution attaches to
 * that glyph when the subtable covers it, otherwise to nothing, where HarfBuzz attaches it to the first glyph of the
 * substitution (https://github.com/harfbuzz/harfbuzz/issues/740).
 * @param {Position} position
 * @param {object} lookupTable - the lookup of the subtable
 * @param {object} subtable - a mark-to-base attachment subtable
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the mark in the run
 * @returns {number} the position the lookup goes on at, -1 when the subtable does not apply
 */
function applyMarkToBaseAttachment(position, lookupTable, subtable, glyphRun, index) {
    const glyphIndex = glyphRun.glyphIndexes[index];
    const markCoverageIndex = position.getCoverageIndex(subtable.markCoverage, glyphIndex);
    if (markCoverageIndex < 0) {
        return -1;
    }
    const baseIndex = getRunMarkBaseIndexes(glyphRun.gdef, glyphRun)[index];
    const baseCoverageIndex = baseIndex < 0 ? -1 : position.getCoverageIndex(subtable.baseCoverage, glyphRun.glyphIndexes[baseIndex]);
    if (baseCoverageIndex < 0) {
        return -1;
    }
    return attachMark(position, glyphRun, index, subtable.markArray[markCoverageIndex], subtable.baseArray[baseCoverageIndex], baseIndex);
}

/**
 * The index of the component of a ligature that a mark after it attaches to, like HarfBuzz (MarkLigPosFormat1): the
 * component the ligature substitution recorded for the mark (see LigatureProperties) when the mark belongs to this
 * ligature, otherwise the last component.
 * @param {LigatureProperties|undefined} markProperties
 * @param {LigatureProperties|undefined} ligatureProperties
 * @param {number} componentCount - the number of components of the ligature in the subtable
 * @returns {number} 0 for the first component
 */
function getMarkLigatureComponentIndex(markProperties, ligatureProperties, componentCount) {
    const ligatureId = getLigatureId(ligatureProperties);
    const markComponent = getLigatureComponent(markProperties);
    if (ligatureId && ligatureId === getLigatureId(markProperties) && markComponent > 0) {
        return Math.min(componentCount, markComponent) - 1;
    }
    return componentCount - 1;
}

/**
 * Apply a mark-to-ligature attachment subtable at a mark of a run, like HarfBuzz (MarkLigPosFormat1): the mark
 * attaches to the glyph before it that is not a GDEF mark (see getMarkBaseIndexes), when the subtable covers both, at
 * the anchor of the ligature component of the mark (see getMarkLigatureComponentIndex), whatever the lookupFlag of the
 * lookup.
 * @param {Position} position
 * @param {object} lookupTable - the lookup of the subtable
 * @param {object} subtable - a mark-to-ligature attachment subtable
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the mark in the run
 * @returns {number} the position the lookup goes on at, -1 when the subtable does not apply
 */
function applyMarkToLigatureAttachment(position, lookupTable, subtable, glyphRun, index) {
    const glyphIndex = glyphRun.glyphIndexes[index];
    const markCoverageIndex = position.getCoverageIndex(subtable.markCoverage, glyphIndex);
    if (markCoverageIndex < 0) {
        return -1;
    }
    const ligatureIndex = getRunMarkBaseIndexes(glyphRun.gdef, glyphRun)[index];
    const ligatureCoverageIndex = ligatureIndex < 0 ? -1 : position.getCoverageIndex(subtable.ligatureCoverage, glyphRun.glyphIndexes[ligatureIndex]);
    const componentAnchors = ligatureCoverageIndex < 0 ? undefined : subtable.ligatureArray[ligatureCoverageIndex];
    if (!componentAnchors || !componentAnchors.length) {
        return -1;
    }
    const componentIndex = getMarkLigatureComponentIndex(
        glyphRun.ligatureProperties[index], glyphRun.ligatureProperties[ligatureIndex], componentAnchors.length
    );
    return attachMark(position, glyphRun, index, subtable.markArray[markCoverageIndex], componentAnchors[componentIndex], ligatureIndex);
}

/**
 * Whether a mark can attach to a mark before it, like HarfBuzz (MarkMarkPosFormat1): when both follow the same
 * glyph, or the same component of a ligature (see LigatureProperties), or when one of them is itself a ligature (a
 * glyph with its own ligatureId and no ligatureComponent; a ligature of marks only keeps the ligature properties of
 * its first mark).
 * @param {LigatureProperties|undefined} markProperties
 * @param {LigatureProperties|undefined} previousMarkProperties
 * @returns {boolean}
 */
function areMarksOfSameGlyph(markProperties, previousMarkProperties) {
    const ligatureId = getLigatureId(markProperties);
    const previousLigatureId = getLigatureId(previousMarkProperties);
    const component = getLigatureComponent(markProperties);
    const previousComponent = getLigatureComponent(previousMarkProperties);
    if (ligatureId === previousLigatureId) {
        return !ligatureId || component === previousComponent;
    }
    return Boolean((ligatureId && !component) || (previousLigatureId && !previousComponent));
}

/**
 * Apply a mark-to-mark attachment subtable at a mark of a run, like HarfBuzz (MarkMarkPosFormat1): the mark attaches
 * to the glyph before it that the mark filtering set and the mark attachment type of the lookup do not skip (its
 * IgnoreBaseGlyphs, IgnoreLigatures and IgnoreMarks do not apply), nor a default ignorable the lookup skips (see
 * GlyphRun.ignorableMatching), when that glyph is a GDEF mark of the same glyph
 * (see areMarksOfSameGlyph) and the subtable covers both.
 * @param {Position} position
 * @param {object} lookupTable - the lookup of the subtable, for its lookupFlag
 * @param {object} subtable - a mark-to-mark attachment subtable
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the mark in the run
 * @returns {number} the position the lookup goes on at, -1 when the subtable does not apply
 */
function applyMarkToMarkAttachment(position, lookupTable, subtable, glyphRun, index) {
    const mark1CoverageIndex = position.getCoverageIndex(subtable.mark1Coverage, glyphRun.glyphIndexes[index]);
    if (mark1CoverageIndex < 0) {
        return -1;
    }
    const gdef = glyphRun.gdef;
    const markFilterLookup = {
        lookupFlag: lookupTable.lookupFlag & ~(IGNORE_BASE_GLYPHS | IGNORE_LIGATURES | IGNORE_MARKS),
        markFilteringSet: lookupTable.markFilteringSet
    };
    const previousIndex = findNextNotIgnoredGlyphPosition(
        gdef, markFilterLookup, glyphRun.glyphIndexes, index, -1, glyphRun.ignorableMatching.isSkippedInInput
    );
    if (previousIndex < 0 || !isMarkGlyph(gdef, glyphRun.glyphIndexes[previousIndex]) ||
        !areMarksOfSameGlyph(glyphRun.ligatureProperties[index], glyphRun.ligatureProperties[previousIndex])) {
        return -1;
    }
    const mark2CoverageIndex = position.getCoverageIndex(subtable.mark2Coverage, glyphRun.glyphIndexes[previousIndex]);
    if (mark2CoverageIndex < 0) {
        return -1;
    }
    return attachMark(position, glyphRun, index, subtable.mark1Array[mark1CoverageIndex], subtable.mark2Array[mark2CoverageIndex], previousIndex);
}

/**
 * Apply a lookup of the LookupList at a glyph of a run from a lookup record of a contextual rule, like HarfBuzz
 * (hb_ot_apply_context_t::recurse): the first subtable of the lookup that applies at the glyph, with the lookupFlag of
 * the lookup, even at a glyph it skips (see isGlyphSkippedByLookup); nothing past MAX_NESTING_LEVEL nested lookups,
 * nor for a lookup index past the LookupList. Each application below that level takes one operation of the run (see
 * operationsLeft), a lookup index past the LookupList too.
 * @param {Position} position
 * @param {number} lookupListIndex
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the glyph in the run
 */
function applyNestedPositioningLookup(position, lookupListIndex, glyphRun, index) {
    if (!glyphRun.nestingLevelLeft) {
        return;
    }
    glyphRun.operationsLeft--;
    const lookupTable = position.font.tables.gpos.lookups[lookupListIndex];
    if (!lookupTable) {
        return;
    }
    glyphRun.nestingLevelLeft--;
    applyLookupSubtables(position, lookupTable, getLookupSubtables(lookupTable), glyphRun, index);
    glyphRun.nestingLevelLeft++;
}

/**
 * Apply the lookup records of a contextual rule that matches at a glyph, like HarfBuzz (apply_lookup): in record order,
 * each one applies its lookup (see applyNestedPositioningLookup) at the input glyph of its sequence index, the index of
 * the glyph in the matched input (the glyphs the rule skips are not counted), a sequence index past the input does
 * not apply, and none applies once the run has no operation left; GPOS changes no glyph, so the input stays the same.
 * The lookup goes on after the last input glyph.
 * @param {Position} position
 * @param {ContextRuleMatch|null} contextRuleMatch - the rule that matches, null if none
 * @param {GlyphRun} glyphRun - updated
 * @returns {number} the position the lookup goes on at, -1 when no rule matches
 */
function applyContextRuleMatch(position, contextRuleMatch, glyphRun) {
    if (!contextRuleMatch) {
        return -1;
    }
    const { inputPositions, lookupRecords } = contextRuleMatch;
    for (const { sequenceIndex, lookupListIndex } of lookupRecords) {
        if (sequenceIndex >= inputPositions.length) {
            continue;
        }
        if (glyphRun.operationsLeft <= 0) {
            break;
        }
        applyNestedPositioningLookup(position, lookupListIndex, glyphRun, inputPositions[sequenceIndex]);
    }
    return inputPositions[inputPositions.length - 1] + 1;
}

/**
 * Apply a contextual positioning subtable (formats 1, 2 and 3) at a glyph of a run, like HarfBuzz (ContextFormat1,
 * ContextFormat2 and ContextFormat3): the lookup records of the rule that matches at the glyph (see
 * matchSequenceContext and applyContextRuleMatch).
 * @param {Position} position
 * @param {object} lookupTable - the lookup of the subtable, for its lookupFlag
 * @param {object} subtable - a contextual positioning subtable
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the glyph in the run
 * @returns {number} the position the lookup goes on at, -1 when the subtable does not apply
 */
function applyContextualPositioning(position, lookupTable, subtable, glyphRun, index) {
    const contextRuleMatch = matchSequenceContext(
        glyphRun.gdef, lookupTable, subtable, subtable.posFormat, glyphRun.glyphIndexes, index,
        glyphRun.ignorableMatching
    );
    return applyContextRuleMatch(position, contextRuleMatch, glyphRun);
}

/**
 * Apply a chained contextual positioning subtable (formats 1, 2 and 3) at a glyph of a run, like HarfBuzz
 * (ChainContextFormat1, ChainContextFormat2 and ChainContextFormat3): the lookup records of the rule that matches at
 * the glyph (see matchChainedSequenceContext and applyContextRuleMatch).
 * @param {Position} position
 * @param {object} lookupTable - the lookup of the subtable, for its lookupFlag
 * @param {object} subtable - a chained contextual positioning subtable
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the glyph in the run
 * @returns {number} the position the lookup goes on at, -1 when the subtable does not apply
 */
function applyChainedContextualPositioning(position, lookupTable, subtable, glyphRun, index) {
    const contextRuleMatch = matchChainedSequenceContext(
        glyphRun.gdef, lookupTable, subtable, subtable.posFormat, glyphRun.glyphIndexes, index,
        glyphRun.ignorableMatching
    );
    return applyContextRuleMatch(position, contextRuleMatch, glyphRun);
}

/**
 * Add to the offsets of an attached glyph the offsets of the glyph it is attached to, like HarfBuzz
 * (propagate_attachment_offsets), that glyph first, up to a chain of MAX_NESTING_LEVEL glyphs: the y offset
 * of a cursive attachment, the x and y offsets of a mark attachment, whose mark also moves back over the advances
 * from its glyph to it (forward over them in a right-to-left run), so that it stays on its anchor.
 * @param {GlyphRun} glyphRun - its attachments are consumed, its glyph positions updated
 * @param {number} index - the position of the glyph in the run
 * @param {number} nestingLevel - how many more glyphs of the chain can add their offsets
 */
function propagateAttachmentOffsets(glyphRun, index, nestingLevel) {
    const attachment = glyphRun.attachments[index];
    if (!attachment) {
        return;
    }
    glyphRun.attachments[index] = undefined;
    if (!nestingLevel) {
        return;
    }
    const parentIndex = attachment.parentIndex;
    propagateAttachmentOffsets(glyphRun, parentIndex, nestingLevel - 1);
    const glyphPosition = glyphRun.glyphPositions[index];
    const parentPosition = glyphRun.glyphPositions[parentIndex];
    switch (attachment.type) {
        case CURSIVE_ATTACHMENT:
            glyphPosition.yOffset += parentPosition.yOffset;
            break;
        case MARK_ATTACHMENT:
            glyphPosition.xOffset += parentPosition.xOffset;
            glyphPosition.yOffset += parentPosition.yOffset;
            if (glyphRun.rightToLeft) {
                for (let i = parentIndex + 1; i <= index; i++) {
                    glyphPosition.xOffset += glyphRun.glyphPositions[i].xAdvance;
                }
            } else {
                for (let i = parentIndex; i < index; i++) {
                    glyphPosition.xOffset -= glyphRun.glyphPositions[i].xAdvance;
                }
            }
            break;
        default:
            throw new Error(`Unknown attachment type: ${attachment.type}`);
    }
}

/**
 * Set the x advance of the GDEF marks of a run to 0, like HarfBuzz (zero_mark_widths_by_gdef), moving their x offset
 * back by the advance they lose when asked (adjust_mark_offsets).
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {GlyphRun} glyphRun - updated
 * @param {boolean} isOffsetMovedBack
 */
function zeroMarkAdvances(gdef, glyphRun, isOffsetMovedBack) {
    for (let i = 0; i < glyphRun.glyphIndexes.length; i++) {
        if (isMarkGlyph(gdef, glyphRun.glyphIndexes[i])) {
            const glyphPosition = glyphRun.glyphPositions[i];
            if (isOffsetMovedBack) {
                glyphPosition.xOffset -= glyphPosition.xAdvance;
            }
            glyphPosition.xAdvance = 0;
        }
    }
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
 * The subtables of a lookup the coverage tables of their first glyph are read from (see getSubtablesFirstGlyphDigest
 * in layout.mjs): the ones of getLookupSubtables, which unwraps the extension subtables
 * @param {object} lookupTable
 * @returns {object[]}
 */
function getLookupFirstGlyphSubtables(lookupTable) {
    return getLookupSubtables(lookupTable).map(({ subtable }) => subtable);
}

/**
 * Apply the first subtable of a lookup that applies at a glyph of a run (see subtableApplications).
 * @param {Position} position
 * @param {object} lookupTable - the lookup of the subtables, for its lookupFlag
 * @param {Array<{lookupType: number, subtable: object}>} lookupSubtables - see getLookupSubtables
 * @param {GlyphRun} glyphRun - updated
 * @param {number} index - the position of the glyph in the run
 * @returns {number} the position the lookup goes on at, -1 when no subtable applies
 */
function applyLookupSubtables(position, lookupTable, lookupSubtables, glyphRun, index) {
    for (const { lookupType, subtable } of lookupSubtables) {
        const applySubtable = subtableApplications[lookupType];
        if (!applySubtable) {
            throw new Error(`Unknown GPOS lookup type: ${lookupType}`);
        }
        const nextIndex = applySubtable(position, lookupTable, subtable, glyphRun, index);
        if (nextIndex >= 0) {
            return nextIndex;
        }
    }
    return -1;
}

/**
 * A run of glyphs that the GPOS lookups position (see createGlyphRun).
 * @typedef GlyphRun
 * @type Object
 * @property {number[]} glyphIndexes - the glyph indexes, in the order of the text
 * @property {object|undefined} gdef - the GDEF table of the layout (see getLayoutGdefTable in layout.mjs), read once
 * for the run
 * @property {Array<{xAdvance: number, yAdvance: number, xOffset: number, yOffset: number}>} glyphPositions - the
 * positions of the glyphs, in font units, which the lookups adjust
 * @property {Array<LigatureProperties|undefined>} ligatureProperties - the ligature properties of the glyphs, which
 * the mark-to-ligature and mark-to-mark attachments read
 * @property {number[]} ignorableTypes - the kind of default ignorable of each glyph (see DEFAULT_IGNORABLE_TYPES in
 * char.mjs)
 * @property {IgnorableMatching} ignorableMatching - how the lookup that applies skips the default ignorables, like
 * HarfBuzz (see createIgnorableMatching in layout.mjs): with the joiner flags of the top-level lookup, which the
 * lookups of its contextual rules keep (see applyPositioningLookups)
 * @property {Map<boolean, number[]>} markBaseIndexes - the position of the base or of the ligature of each mark, by
 * autoZeroWidthJoiner flag (see getRunMarkBaseIndexes)
 * @property {Array<{type: string, parentIndex: number}|undefined>} attachments - the glyph each glyph is attached to
 * by the lookups, with the type of the attachment (see MARK_ATTACHMENT and CURSIVE_ATTACHMENT), like the
 * attach_chain and attach_type of HarfBuzz
 * @property {boolean} rightToLeft - whether the run is laid out from right to left
 * @property {object} [variation] - variation coordinates, the current font variation if omitted
 * @property {number} nestingLevelLeft - how many more lookups the lookup records of contextual rules can nest, like the
 * nesting_level_left of HarfBuzz (see applyNestedPositioningLookup)
 * @property {number} operationsLeft - how many more nested lookups the lookup records of contextual rules can apply to
 * the run, like the max_ops of HarfBuzz, so that a font whose lookups nest themselves several times ends: its glyphs
 * times MAX_OPERATIONS_BY_GLYPH, at least MIN_MAX_OPERATIONS
 */

/**
 * Create a run of glyphs for the GPOS lookups, without attachments.
 * @param {number[]} glyphIndexes - in the order of the text
 * @param {object[]} glyphPositions - in the order of the text
 * @param {{gdef: object|undefined, ligatureProperties: Array<LigatureProperties|undefined>, ignorableTypes: number[],
 * rightToLeft: boolean, variation: object|undefined}} runProperties
 * @returns {GlyphRun}
 */
function createGlyphRun(glyphIndexes, glyphPositions, runProperties) {
    return {
        glyphIndexes,
        gdef: runProperties.gdef,
        glyphPositions,
        ligatureProperties: runProperties.ligatureProperties,
        ignorableTypes: runProperties.ignorableTypes,
        ignorableMatching: createIgnorableMatching(runProperties.ignorableTypes, true, AUTO_JOINER_FLAGS),
        markBaseIndexes: new Map(),
        attachments: [],
        rightToLeft: runProperties.rightToLeft,
        variation: runProperties.variation,
        nestingLevelLeft: MAX_NESTING_LEVEL,
        operationsLeft: Math.max(glyphIndexes.length * MAX_OPERATIONS_BY_GLYPH, MIN_MAX_OPERATIONS)
    };
}

/**
 * Whether a GPOS lookup skips a glyph of a run when it applies from the first glyph, like HarfBuzz
 * (check_glyph_property in apply_forward): a glyph it ignores (see isGlyphIgnoredByLookup) and, for a mark-to-base or
 * mark-to-ligature lookup in a font without glyph classes, a glyph it ignores as a mark (see
 * isMarkIgnoredWithoutGlyphClasses). The lookups that a contextual rule applies skip no glyph (see
 * applyNestedPositioningLookup).
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {object} lookupTable
 * @param {number} lookupType - the lookup type of its subtables (see getLookupSubtables)
 * @param {number} glyphIndex
 * @returns {boolean}
 */
function isGlyphSkippedByLookup(gdef, lookupTable, lookupType, glyphIndex) {
    if (isGlyphIgnoredByLookup(gdef, lookupTable, glyphIndex)) {
        return true;
    }
    const isMarkToBaseOrLigature = lookupType === MARK_TO_BASE_ATTACHMENT_LOOKUP_TYPE ||
        lookupType === MARK_TO_LIGATURE_ATTACHMENT_LOOKUP_TYPE;
    return isMarkToBaseOrLigature && isMarkIgnoredWithoutGlyphClasses(gdef, lookupTable, glyphIndex);
}

/**
 * Apply a GPOS lookup to a run of glyphs, like HarfBuzz (apply_forward): at each glyph that the lookup does not
 * skip (see isGlyphSkippedByLookup), from the first one, the first subtable that applies to it; the lookup goes on at
 * the glyph that this subtable gives, otherwise at the next glyph. A glyph that the glyph digest of the first glyph
 * filter of the lookup does not have is skipped too: no subtable covers it (see getLookupFilterGlyphDigest in
 * layout.mjs).
 * @param {Position} position
 * @param {PositioningLookup} lookup
 * @param {GlyphRun} glyphRun - updated
 * @param {number} lastIndex - the position in the run of the last glyph the lookup applies at
 */
function applyPositioningLookup(position, lookup, glyphRun, lastIndex) {
    const { lookupTable, firstGlyphFilter } = lookup;
    const lookupSubtables = getLookupSubtables(lookupTable);
    if (!lookupSubtables.length) {
        return;
    }
    const firstGlyphDigest = getLookupFilterGlyphDigest(firstGlyphFilter, getLookupFirstGlyphSubtables(lookupTable));
    const lookupType = lookupSubtables[0].lookupType;
    let index = 0;
    while (index <= lastIndex) {
        const glyphIndex = glyphRun.glyphIndexes[index];
        let nextIndex = -1;
        if ((!firstGlyphDigest || mayGlyphDigestHave(firstGlyphDigest, glyphIndex)) &&
            !isGlyphSkippedByLookup(glyphRun.gdef, lookupTable, lookupType, glyphIndex)) {
            nextIndex = applyLookupSubtables(position, lookupTable, lookupSubtables, glyphRun, index);
        }
        index = nextIndex >= 0 ? nextIndex : index + 1;
    }
}

/**
 * A lookup of the GPOS features of a run, with its joiner flags (see getLookupJoinerFlags in featureValues.mjs) and the
 * glyphs it can apply at
 * @typedef PositioningLookup
 * @type Object
 * @property {object} lookupTable
 * @property {JoinerFlags} joinerFlags
 * @property {LookupFirstGlyphFilter|null} firstGlyphFilter - the glyphs its subtables cover as their first glyph (see
 * getLookupFirstGlyphDigest, and createLookupFirstGlyphFilter in layout.mjs), null for no filter
 */

/**
 * The glyph digest of the glyphs the subtables of a GPOS lookup cover as their first glyph (see
 * getSubtablesFirstGlyphDigest in layout.mjs): it reads the coverage tables of all its subtables, so it is computed for
 * the lookups the layout caches (see getPositioningLookups)
 * @param {object} lookupTable
 * @returns {GlyphDigest|null} null for a lookup with a subtable of an unknown type, so that applyLookupSubtables reports
 * it, or with a subtable without a coverage of its first glyph
 */
function getLookupFirstGlyphDigest(lookupTable) {
    if (!getLookupSubtables(lookupTable).every(({ lookupType }) => subtableApplications[lookupType])) {
        return null;
    }
    return getSubtablesFirstGlyphDigest(getLookupFirstGlyphSubtables(lookupTable));
}

/**
 * Apply GPOS lookups to a run of glyphs, one lookup after the other, each one skipping the default ignorables with its
 * joiner flags (see GlyphRun.ignorableMatching), which a lookup keeps from the lookup before it when their joiner flags
 * are equal.
 * @param {Position} position
 * @param {PositioningLookup[]} lookups - in the order they apply in
 * @param {GlyphRun} glyphRun - updated
 * @param {number} lastIndex - the position in the run of the last glyph the lookups apply at (see
 * applyPositioningLookup)
 */
function applyPositioningLookups(position, lookups, glyphRun, lastIndex) {
    for (const lookup of lookups) {
        if (!areJoinerFlagsEqual(glyphRun.ignorableMatching.joinerFlags, lookup.joinerFlags)) {
            glyphRun.ignorableMatching = createIgnorableMatching(glyphRun.ignorableTypes, true, lookup.joinerFlags);
        }
        applyPositioningLookup(position, lookup, glyphRun, lastIndex);
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
 * The lookups of features, each one once, in LookupList order, the order they apply in, like the GPOS map of
 * HarfBuzz, with the joiner flags of the features that have it in the shaper of the run (see getLookupJoinerFlags in
 * featureValues.mjs).
 * @param {Position} position
 * @param {Array<{tag: string|undefined, feature: object}>} features - the feature tables with their tags, none for the
 * required feature
 * @param {string|undefined} shaper - the shaper of the run (see getScriptRunShaper in bidi.mjs)
 * @returns {Array<{lookupTable: object, joinerFlags: JoinerFlags}>}
 */
function getFeatureLookups(position, features, shaper) {
    const lookupFeatureTags = new Map();
    for (const { tag, feature } of features) {
        for (const lookupListIndex of feature.lookupListIndexes) {
            const featureTags = lookupFeatureTags.get(lookupListIndex) || [];
            if (tag !== undefined) {
                featureTags.push(tag);
            }
            lookupFeatureTags.set(lookupListIndex, featureTags);
        }
    }
    const allLookups = position.font.tables.gpos.lookups;
    return Array.from(lookupFeatureTags.keys())
        .sort((indexA, indexB) => indexA - indexB)
        .filter(lookupListIndex => allLookups[lookupListIndex])
        .map(lookupListIndex => ({
            lookupTable: allLookups[lookupListIndex],
            joinerFlags: getLookupJoinerFlags(shaper, lookupFeatureTags.get(lookupListIndex))
        }));
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
 * The feature records of the features of a GPOS language system whose tag is one of the feature tags, for each tag
 * its first feature in FeatureIndex order, like Layout.getFeatureTable for each tag, in one pass over the
 * FeatureIndex; like HarfBuzz, a feature index past the FeatureList is ignored.
 * @param {Position} position
 * @param {object} langSysTable
 * @param {string[]} featureTags
 * @returns {Array<{tag: string, feature: object}>}
 */
function getTaggedFeatureRecords(position, langSysTable, featureTags) {
    const featureRecords = position.font.tables.gpos.features;
    const remainingFeatureTags = new Set(featureTags);
    const taggedFeatureRecords = [];
    for (const featureIndex of langSysTable.featureIndexes) {
        const featureRecord = featureRecords[featureIndex];
        if (featureRecord && remainingFeatureTags.delete(featureRecord.tag)) {
            taggedFeatureRecords.push(featureRecord);
        }
    }
    return taggedFeatureRecords;
}

/**
 * The lookups of the GPOS features of a script and language that the language system has (with the
 * fallbacks of getLangSysTable) and of its required feature, whatever the feature tags, like HarfBuzz
 * (hb_ot_map_builder_t), in the order they apply in, with their joiner flags in the shaper of the run (see
 * getFeatureLookups); none without a GPOS table or a language system, or when GPOS does not apply to the script (see
 * isGposAppliedToScript). They are computed once for the GPOS table, the script, the language, the feature tags and
 * the shaper (see getCachedLayoutValue in layout.mjs).
 * @param {Position} position
 * @param {string} script
 * @param {string} [language]
 * @param {string[]} featureTags
 * @param {string} [shaper] - the shaper of the run (see getScriptRunShaper in bidi.mjs), the default shaper if omitted
 * @returns {PositioningLookup[]}
 */
function getPositioningLookups(position, script, language, featureTags, shaper) {
    const table = position.getTable();
    if (!table) {
        return [];
    }
    return getCachedLayoutValue(position.font, 'gpos', JSON.stringify(['lookups', script, language, featureTags, shaper]), isCached => {
        const langSysTable = isGposAppliedToScript(position, script) && position.getLangSysTable(script, language);
        if (!langSysTable) {
            return [];
        }
        const requiredFeature = getRequiredFeatureTable(position, langSysTable);
        const features = (requiredFeature ? [{ tag: undefined, feature: requiredFeature }] : [])
            .concat(getTaggedFeatureRecords(position, langSysTable, featureTags));
        return getFeatureLookups(position, features, shaper).map(({ lookupTable, joinerFlags }) => ({
            lookupTable,
            joinerFlags,
            firstGlyphFilter: createLookupFirstGlyphFilter(
                lookupTable, isCached, getLookupFirstGlyphSubtables, getLookupFirstGlyphDigest
            )
        }));
    });
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
 * glyph, each glyph is kerned with the next glyph that is not a GDEF mark nor a default ignorable, and the next pair
 * starts at that glyph, so a pair starts at the first glyph of the run and at each glyph that is neither.
 * @param {opentype.Font} font
 * @param {number[]} glyphIndexes - the glyph indexes of the run, in visual order
 * @param {number} first - the position of the glyph in the run
 * @param {function(number): boolean} isSkippedIgnorable - whether the glyph at a position of the run is a default
 * ignorable the pairs skip (see IgnorableMatching in layout.mjs)
 * @returns {{first: number, second: number, value: number}|undefined} the positions in the run of the two glyphs of
 * the pair, with its value; undefined when no pair of the kern table starts at the glyph
 */
function getKernTablePair(font, glyphIndexes, first, isSkippedIgnorable) {
    const gdef = getLayoutGdefTable(font);
    if (first > 0 && (isGlyphIgnoredByLookup(gdef, KERN_TABLE_LOOKUP, glyphIndexes[first]) || isSkippedIgnorable(first))) {
        return;
    }
    const second = findNextNotIgnoredGlyphPosition(gdef, KERN_TABLE_LOOKUP, glyphIndexes, first, 1, isSkippedIgnorable);
    const value = second < 0 ? 0 : font.kerningPairs[glyphIndexes[first] + ',' + glyphIndexes[second]];
    if (value) {
        return { first, second, value };
    }
}

/**
 * The pairs of the kern table in a run of glyphs (see getKernTablePair).
 * @param {opentype.Font} font
 * @param {number[]} glyphIndexes - the glyph indexes of the run, in visual order
 * @param {number[]} ignorableTypes - the kind of default ignorable of each glyph of the run
 * @returns {Array<{first: number, second: number, value: number}>}
 */
function getKernTablePairs(font, glyphIndexes, ignorableTypes) {
    const isSkippedIgnorable = createIgnorableMatching(ignorableTypes, true, AUTO_JOINER_FLAGS).isSkippedInInput;
    return glyphIndexes
        .map((glyphIndex, first) => getKernTablePair(font, glyphIndexes, first, isSkippedIgnorable))
        .filter(pair => pair);
}

/**
 * Apply the kern table to a run of glyphs in visual order, like HarfBuzz (hb_kern_machine_t): the value of a
 * pair is split between its two glyphs, half of it (rounded down) added to the advance of the first glyph, the
 * rest to the advance and to the x offset of the second glyph, which moves by the whole value.
 * @param {opentype.Font} font
 * @param {{glyphIndexes: number[], glyphPositions: object[], ignorableTypes: number[]}} glyphRun - in visual order,
 * its glyph positions updated (see GlyphRun)
 */
function applyKernTable(font, glyphRun) {
    for (const { first, second, value } of getKernTablePairs(font, glyphRun.glyphIndexes, glyphRun.ignorableTypes)) {
        const firstValue = Math.floor(value / 2);
        const secondValue = value - firstValue;
        glyphRun.glyphPositions[first].xAdvance += firstValue;
        glyphRun.glyphPositions[second].xAdvance += secondValue;
        glyphRun.glyphPositions[second].xOffset += secondValue;
    }
}

/**
 * When the HarfBuzz shaper of a run sets the advance of the GDEF marks to 0 (see MarkAdvanceZeroing), from the
 * OpenType script tags of the run and the script HarfBuzz chose for them in GSUB (see getHarfBuzzShaper in
 * layout.mjs): never with the Hangul, Khmer and Indic shapers, before GPOS with the USE and Myanmar shapers, after
 * GPOS with the default, Arabic, Hebrew and Thai shapers.
 * @param {string[]} scriptTags - the OpenType script tags of the run (see getOpenTypeScriptTags)
 * @param {string|undefined} gsubScriptTag - the script HarfBuzz chose in GSUB, undefined for none
 * @returns {MarkAdvanceZeroing}
 */
function getMarkAdvanceZeroing(scriptTags, gsubScriptTag) {
    const shaper = getHarfBuzzShaper(scriptTags, gsubScriptTag);
    switch (shaper) {
        case HarfBuzzShaper.HANGUL:
        case HarfBuzzShaper.INDIC:
        case HarfBuzzShaper.KHMER:
            return MarkAdvanceZeroing.NONE;
        case HarfBuzzShaper.MYANMAR:
        case HarfBuzzShaper.USE:
            return MarkAdvanceZeroing.BEFORE_POSITIONING;
        case HarfBuzzShaper.DEFAULT:
        case HarfBuzzShaper.ARABIC:
        case HarfBuzzShaper.HEBREW:
        case HarfBuzzShaper.THAI:
            return MarkAdvanceZeroing.AFTER_POSITIONING;
        default:
            throw new Error(`Unknown shaper ${shaper}`);
    }
}

/**
 * Set the advances and the offsets of the default ignorables of a run to 0, like hb_ot_zero_width_default_ignorables
 * of HarfBuzz, before the offsets of the attached glyphs follow the glyphs they are attached to
 * @param {Array<{xAdvance: number, yAdvance: number, xOffset: number, yOffset: number}>} glyphPositions - updated
 * @param {number[]} ignorableTypes - the kind of default ignorable of each glyph (see DEFAULT_IGNORABLE_TYPES in
 * char.mjs), in the order of glyphPositions
 */
function zeroDefaultIgnorablePositions(glyphPositions, ignorableTypes) {
    for (let i = 0; i < glyphPositions.length; i++) {
        if (ignorableTypes[i] !== undefined && ignorableTypes[i] !== DEFAULT_IGNORABLE_TYPES.NOT_IGNORABLE) {
            Object.assign(glyphPositions[i], { xAdvance: 0, yAdvance: 0, xOffset: 0, yOffset: 0 });
        }
    }
}

/**
 * The positioning plan of the runs of a script, a language, a set of GPOS features and a shaper, like the GPOS part of
 * the shape plan of HarfBuzz (hb_ot_shape_plan_t), the same for all the runs of a text of the same script
 * @typedef PositioningPlan
 * @type Object
 * @property {PositioningLookup[]} lookups - the lookups of the GPOS features of the script and language and of its
 * required feature (see getPositioningLookups)
 * @property {boolean} isKernTableApplied - whether the kern table applies: kern is one of the features and GPOS has no
 * kern feature for the script and language (see getKernFeatureTable), like HarfBuzz
 */

/**
 * The positioning plan of the runs of a script (see PositioningPlan)
 * @param {Position} position
 * @param {string} script - the OpenType script tag of the runs
 * @param {string|undefined} language - their OpenType language tag
 * @param {string[]} featureTags - the GPOS features to apply
 * @param {string} [shaper] - the shaper of the runs (see getScriptRunShaper in bidi.mjs), the default shaper if omitted
 * @returns {PositioningPlan}
 */
function getPositioningPlan(position, script, language, featureTags, shaper) {
    return {
        lookups: getPositioningLookups(position, script, language, featureTags, shaper),
        isKernTableApplied: featureTags.includes('kern') && !getKernFeatureTable(position, script, language)
    };
}

/**
 * Position the glyphs of a run of one script and one direction, like hb_ot_position_complex of HarfBuzz: the lookups
 * of the positioning plan of the run (see PositioningPlan) apply to the glyphs in the order of the text (the reverse of
 * the visual order in a right-to-left run), in LookupList order, each one skipping the default ignorables like
 * HarfBuzz (see createIgnorableMatching in layout.mjs); then, when the plan applies the kern table, the kern table
 * applies, in visual order. The advances of the GDEF marks are set to 0 before or after these adjustments (see
 * getMarkAdvanceZeroing; like HarfBuzz, without a GPOS table the x offset of a mark of a left-to-right run moves back
 * by the advance it loses), the advances and the offsets of the default ignorables to 0 unless they are removed (see
 * zeroDefaultIgnorablePositions), then the offsets of the attached glyphs follow the glyphs they are attached to (see
 * propagateAttachmentOffsets).
 * @param {Position} position
 * @param {number[]} glyphIndexes - the glyph indexes of the run, in visual order
 * @param {Array<{xAdvance: number, yAdvance: number, xOffset: number, yOffset: number}>} glyphPositions - the
 * positions of the glyphs, in visual order, in font units, updated
 * @param {{rightToLeft: boolean, plan: PositioningPlan, variation: object|undefined,
 * markAdvanceZeroing: MarkAdvanceZeroing, ligatureProperties: Array<LigatureProperties|undefined>|undefined,
 * defaultIgnorableTypes: number[]|undefined, removesDefaultIgnorables: boolean|undefined}} runOptions - the direction
 * of the run, its positioning plan (see getPositioningPlan), the variation coordinates, when the advances of the marks
 * are set to 0 (see getMarkAdvanceZeroing), the ligature properties of the glyphs in visual order (see
 * LigatureProperties), none if omitted, the kind of default ignorable of each glyph in visual order (see
 * DEFAULT_IGNORABLE_TYPES in char.mjs), none if omitted, and whether the default ignorables are removed after the
 * positioning (see GlyphRenderOptions.removeDefaultIgnorables), which keep their positions then
 */
function positionGlyphRun(position, glyphIndexes, glyphPositions, runOptions) {
    const { rightToLeft, plan, variation, markAdvanceZeroing } = runOptions;
    if (!Object.values(MarkAdvanceZeroing).includes(markAdvanceZeroing)) {
        throw new Error(`Unknown mark advance zeroing: ${markAdvanceZeroing}`);
    }
    const ligatureProperties = runOptions.ligatureProperties || [];
    const ignorableTypes = runOptions.defaultIgnorableTypes || [];
    // one entry per glyph, so that the reversal of a right-to-left run keeps them with their glyphs
    const toTextOrder = glyphs => rightToLeft ? glyphs.slice().reverse() : glyphs;
    const toGlyphEntries = values => glyphIndexes.map((glyphIndex, runPosition) => values[runPosition]);
    const gdef = getLayoutGdefTable(position.font);
    const glyphRun = createGlyphRun(toTextOrder(glyphIndexes), toTextOrder(glyphPositions), {
        gdef,
        ligatureProperties: toTextOrder(toGlyphEntries(ligatureProperties)),
        ignorableTypes: toTextOrder(toGlyphEntries(ignorableTypes)),
        rightToLeft,
        variation
    });
    const isMarkOffsetMovedBack = !position.getTable() && !rightToLeft;
    if (markAdvanceZeroing === MarkAdvanceZeroing.BEFORE_POSITIONING) {
        zeroMarkAdvances(gdef, glyphRun, isMarkOffsetMovedBack);
    }
    applyPositioningLookups(position, plan.lookups, glyphRun, glyphIndexes.length - 1);
    if (plan.isKernTableApplied) {
        applyKernTable(position.font, { glyphIndexes, glyphPositions, ignorableTypes });
    }
    if (markAdvanceZeroing === MarkAdvanceZeroing.AFTER_POSITIONING) {
        zeroMarkAdvances(gdef, glyphRun, isMarkOffsetMovedBack);
    }
    if (!runOptions.removesDefaultIgnorables) {
        zeroDefaultIgnorablePositions(glyphPositions, ignorableTypes);
    }
    for (let i = 0; i < glyphIndexes.length; i++) {
        propagateAttachmentOffsets(glyphRun, i, MAX_NESTING_LEVEL);
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
 * Font.shape positions all the glyphs of a text at once, with the contextual positionings of the kern feature,
 * which are not kerning lookups (see getKerningTables).
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
        const kernTablePair = getKernTablePair(this.font, glyphIndexes, position, NO_IGNORABLE_MATCHING.isSkippedInInput);
        return kernTablePair ? kernTablePair.value : 0;
    }
    const glyphPositions = glyphIndexes.map(() => ({ xAdvance: 0, yAdvance: 0, xOffset: 0, yOffset: 0 }));
    const glyphRun = createGlyphRun(glyphIndexes, glyphPositions, {
        gdef: getLayoutGdefTable(this.font), ligatureProperties: [], ignorableTypes: [], rightToLeft: false, variation
    });
    const lookups = kerningLookups.map(lookupTable => ({ lookupTable, joinerFlags: AUTO_JOINER_FLAGS, firstGlyphFilter: null }));
    // a pair that starts after the glyph does not adjust it
    applyPositioningLookups(this, lookups, glyphRun, position);
    return glyphRun.glyphPositions[position].xAdvance;
};

/**
 * List the kerning lookup tables (the pair adjustment lookups of the kern feature) of a script and
 * language in LookupList order, the order they apply in, including the pair adjustment subtables
 * wrapped in extension lookups. The contextual positionings of the kern feature (lookup types 7 and 8,
 * e.g. a contextual kerning and its exceptions) are not listed: they are in the positions of Font.shape only.
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
    const kernLookupTables = getKernLookupTables(this, script, language);
    if (!kernLookupTables) {
        return;
    }
    return getPairAdjustmentLookupTables(kernLookupTables);
};

/**
 * The lookups of the GPOS kern feature of a script and language that can hold pair adjustments (lookup types 2 and
 * 9), the lookups of the GPOS table themselves in LookupList order, with the fallbacks of getKerningTables
 * @param {Position} position
 * @param {string} [script='latn']
 * @param {string} [language='dflt']
 * @returns {object[]|undefined} undefined if the GPOS table has no kern feature for the script and language
 */
function getKernLookupTables(position, script, language) {
    const featureTable = getKernFeatureTable(position, script || 'latn', language);
    if (!featureTable) {
        return;
    }
    return getFeatureLookups(position, [{ tag: 'kern', feature: featureTable }])
        .map(({ lookupTable }) => lookupTable)
        .filter(({ lookupType }) => lookupType === PAIR_ADJUSTMENT_LOOKUP_TYPE || lookupType === EXTENSION_LOOKUP_TYPE);
}

/**
 * The kerning lookup tables of kern lookups (see getKernLookupTables): a pair adjustment lookup as it is, an
 * extension lookup as a lookup of type 2 of its pair adjustment subtables at the time of the call
 * @param {object[]} kernLookupTables
 * @returns {object[]}
 */
function getPairAdjustmentLookupTables(kernLookupTables) {
    const kerningTables = [];
    for (const lookupTable of kernLookupTables) {
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
}

// the chars of the advance of a figure space and of a punctuation space, in the order HarfBuzz looks them up
const FIGURE_SPACE_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const PUNCTUATION_SPACE_CHARS = ['.', ','];

/**
 * The x advance of a glyph at a variation, in font units: 0 for a glyph without advance width (e.g. a glyph of a
 * crafted font), which does not move the pen
 * @param {Font} font
 * @param {Glyph} glyph
 * @param {Object} [variation] - the current variation of the font if omitted
 * @returns {number}
 */
function getGlyphAdvance(font, glyph, variation) {
    return glyph.getAdvanceWidth(font, variation) || 0;
}

/**
 * The x advance of the glyph of the first char of a list that the font has a glyph for
 * @param {Font} font
 * @param {string[]} chars
 * @param {Object} [variation]
 * @returns {number|undefined} undefined when the font has a glyph for none of them
 */
function getFirstCharAdvance(font, chars, variation) {
    for (const char of chars) {
        const glyphIndex = font.charToGlyphIndex(char);
        if (glyphIndex > 0) {
            return getGlyphAdvance(font, font.glyphs.get(glyphIndex), variation);
        }
    }
    return undefined;
}

/**
 * The x advance of a glyph before GPOS, like hb_ot_position_default of HarfBuzz: the advance of the glyph at the
 * variation (see getGlyphAdvance), or for a space that the font has not, drawn with the glyph of U+0020 SPACE (see
 * normalizeCharacters in normalization.mjs), the advance of its space type, like _hb_ot_shape_fallback_spaces
 * (hb-ot-shape-fallback.cc of HarfBuzz 11.3.2): 1/n em for EM_n, rounded like HarfBuzz ((em + n / 2) / n in integers),
 * 4/18 em truncated, the advance of the first digit the font has for FIGURE, of the period or else of the comma for
 * PUNCTUATION (the advance of the glyph when the font has none), half the advance of the glyph truncated for NARROW,
 * the advance of the glyph for SPACE. The GPOS adjustments and the kern table apply after it.
 * @param {Font} font
 * @param {Glyph} glyph
 * @param {number} spaceType the space type of the space (see SPACE_TYPES in char.mjs), NOT_SPACE for the other glyphs
 * @param {Object} [variation] - the current variation of the font if omitted
 * @returns {number}
 */
function getDefaultGlyphAdvance(font, glyph, spaceType, variation) {
    const advance = getGlyphAdvance(font, glyph, variation);
    switch (spaceType) {
        case SPACE_TYPES.NOT_SPACE:
        case SPACE_TYPES.SPACE:
            return advance;
        case SPACE_TYPES.EM:
        case SPACE_TYPES.EM_2:
        case SPACE_TYPES.EM_3:
        case SPACE_TYPES.EM_4:
        case SPACE_TYPES.EM_5:
        case SPACE_TYPES.EM_6:
        case SPACE_TYPES.EM_16:
            return Math.trunc((font.unitsPerEm + Math.trunc(spaceType / 2)) / spaceType);
        case SPACE_TYPES.FOUR_EM_18:
            return Math.trunc(font.unitsPerEm * 4 / 18);
        case SPACE_TYPES.FIGURE: {
            const figureAdvance = getFirstCharAdvance(font, FIGURE_SPACE_CHARS, variation);
            return figureAdvance === undefined ? advance : figureAdvance;
        }
        case SPACE_TYPES.PUNCTUATION: {
            const punctuationAdvance = getFirstCharAdvance(font, PUNCTUATION_SPACE_CHARS, variation);
            return punctuationAdvance === undefined ? advance : punctuationAdvance;
        }
        case SPACE_TYPES.NARROW:
            return Math.trunc(advance / 2);
        default:
            throw new Error(`Unknown space type: ${spaceType}`);
    }
}

export default Position;
export {
    DEFAULT_POSITIONING_FEATURES,
    getDefaultGlyphAdvance,
    MarkAdvanceZeroing,
    getMarkAdvanceZeroing,
    getPositioningPlan,
    getKernLookupTables,
    getPairAdjustmentLookupTables,
    getMarkLigatureComponentIndex,
    areMarksOfSameGlyph,
    positionGlyphRun
};
