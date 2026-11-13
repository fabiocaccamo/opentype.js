// The Font object

import Path from './path.mjs';
import sfnt from './tables/sfnt.mjs';
import { DefaultEncoding } from './encoding.mjs';
import glyphset from './glyphset.mjs';
import Position, { DEFAULT_POSITIONING_FEATURES, getMarkAdvanceZeroing, positionGlyphRun } from './position.mjs';
import Substitution from './substitution.mjs';
import { PaletteManager } from './palettes.mjs';
import { LayerManager } from './layers.mjs';
import { SVGImageManager } from './svgimages.mjs';
import { VariationManager } from './variation.mjs';
import HintingTrueType from './hintingtt.mjs';
import Bidi, { ARABIC_FORM_TAGS, getScriptRunShaper } from './bidi.mjs';
import { getCharTextScript } from './char.mjs';
import { getOpenTypeScriptTags, getChosenScriptTag, selectScriptTag } from './layout.mjs';
import { applyPaintType } from './tables/cff.mjs';

function createDefaultNamesInfo(options) {
    return {
        fontFamily: {en: options.familyName || ' '},
        fontSubfamily: {en: options.styleName || ' '},
        fullName: {en: options.fullName || options.familyName + ' ' + options.styleName},
        // postScriptName may not contain any whitespace
        postScriptName: {en: options.postScriptName || (options.familyName + options.styleName).replace(/\s/g, '')},
        designer: {en: options.designer || ' '},
        designerURL: {en: options.designerURL || ' '},
        manufacturer: {en: options.manufacturer || ' '},
        manufacturerURL: {en: options.manufacturerURL || ' '},
        license: {en: options.license || ' '},
        licenseURL: {en: options.licenseURL || ' '},
        version: {en: options.version || 'Version 0.1'},
        description: {en: options.description || ' '},
        copyright: {en: options.copyright || ' '},
        trademark: {en: options.trademark || ' '}
    };
}

/**
 * @typedef FontOptions
 * @type Object
 * @property {Boolean} empty - whether to create a new empty font
 * @property {string} familyName
 * @property {string} styleName
 * @property {string=} fullName
 * @property {string=} postScriptName
 * @property {string=} designer
 * @property {string=} designerURL
 * @property {string=} manufacturer
 * @property {string=} manufacturerURL
 * @property {string=} license
 * @property {string=} licenseURL
 * @property {string=} version
 * @property {string=} description
 * @property {string=} copyright
 * @property {string=} trademark
 * @property {Number} unitsPerEm
 * @property {Number} ascender
 * @property {Number} descender
 * @property {Number} createdTimestamp
 * @property {Number} weightClass
 * @property {Number} italicAngle
 * @property {string=} widthClass
 * @property {string=} fsSelection
 */

/**
 * A Font represents a loaded OpenType font file.
 * It contains a set of glyphs and methods to draw text on a drawing context,
 * or to get a path representing the text.
 * @exports opentype.Font
 * @class
 * @param {FontOptions}
 * @constructor
 */
function Font(options) {
    options = options || {};
    options.tables = options.tables || {};

    if (!options.empty) {
        // Check that we've provided the minimum set of names.
        if (!options.familyName) throw new Error('When creating a new Font object, familyName is required.');
        if (!options.styleName) throw new Error('When creating a new Font object, styleName is required.');
        if (!options.unitsPerEm) throw new Error('When creating a new Font object, unitsPerEm is required.');
        if (!options.ascender) throw new Error('When creating a new Font object, ascender is required.');
        if (options.descender > 0) throw new Error('When creating a new Font object, negative descender value is required.');

        // OS X will complain if the names are empty, so we put a single space everywhere by default.
        this.names = {};
        this.names.unicode = createDefaultNamesInfo(options);
        this.names.macintosh = createDefaultNamesInfo(options);
        this.names.windows = createDefaultNamesInfo(options);
        this.unitsPerEm = options.unitsPerEm || 1000;
        this.ascender = options.ascender;
        this.descender = options.descender;
        this.createdTimestamp = options.createdTimestamp;
        this.italicAngle = options.italicAngle || 0;
        this.weightClass = options.weightClass || 0;

        let selection = 0;
        if (options.fsSelection) {
            selection = options.fsSelection;
        } else {
            if (this.italicAngle < 0) {
                selection |= this.fsSelectionValues.ITALIC;
            } else if (this.italicAngle > 0) {
                selection |= this.fsSelectionValues.OBLIQUE;
            }
            if (this.weightClass >= 600) {
                selection |= this.fsSelectionValues.BOLD;
            }
            if (selection === 0) {
                selection = this.fsSelectionValues.REGULAR;
            }
        }

        if (!options.panose || !Array.isArray(options.panose)) {
            options.panose = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        }

        this.tables = Object.assign(options.tables, {
            os2: Object.assign({
                usWeightClass: options.weightClass || this.usWeightClasses.MEDIUM,
                usWidthClass: options.widthClass || this.usWidthClasses.MEDIUM,
                bFamilyType: options.panose[0] || 0,
                bSerifStyle: options.panose[1] || 0,
                bWeight: options.panose[2] || 0,
                bProportion: options.panose[3] || 0,
                bContrast: options.panose[4] || 0,
                bStrokeVariation: options.panose[5] || 0,
                bArmStyle: options.panose[6] || 0,
                bLetterform: options.panose[7] || 0,
                bMidline: options.panose[8] || 0,
                bXHeight: options.panose[9] || 0,
                fsSelection: selection,
            }, options.tables.os2)
        });
    }

    this.supported = true; // Deprecated: parseBuffer will throw an error if font is not supported.
    this.glyphs = new glyphset.GlyphSet(this, options.glyphs || []);
    this.encoding = new DefaultEncoding(this);
    this.position = new Position(this);
    this.substitution = new Substitution(this);
    // the pairs of the kern table, set by parse
    this.kerningPairs = {};
    // whether the layout ignores the GDEF table, one of the broken GDEF tables HarfBuzz ignores, set by parse
    this.isGdefIgnoredByLayout = false;
    this.tables = this.tables || {};

    this.tables = new Proxy(this.tables, {
        set: (tables, tableName, tableData) => {
            tables[tableName] = tableData;
            if (tables.fvar && (tables.gvar || tables.cff2) && !this.variation) {
                this.variation = new VariationManager(this);
            }
            return true;
        }
    });

    this.palettes = new PaletteManager(this);
    this.layers = new LayerManager(this);
    this.svgImages = new SVGImageManager(this);

    // needed for low memory mode only.
    this._push = null;
    this._hmtxTableData = {};

    Object.defineProperty(this, 'hinting', {
        get: function() {
            if (this._hinting) return this._hinting;
            if (this.outlinesFormat === 'truetype') {
                return (this._hinting = new HintingTrueType(this));
            }
            return null;
        }
    });
}

/**
 * Check if the font has a glyph for the given character.
 * @param  {string}
 * @return {Boolean}
 */
Font.prototype.hasChar = function(c) {
    return this.encoding.charToGlyphIndex(c) > 0;
};

/**
 * Convert the given character to a single glyph index.
 * Note that this function assumes that there is a one-to-one mapping between
 * the given character and a glyph; for complex scripts this might not be the case.
 * @param  {string}
 * @return {Number}
 */
Font.prototype.charToGlyphIndex = function(s) {
    return this.encoding.charToGlyphIndex(s);
};

/**
 * Convert the given character to a single Glyph object.
 * Note that this function assumes that there is a one-to-one mapping between
 * the given character and a glyph; for complex scripts this might not be the case.
 * @param  {string}
 * @return {opentype.Glyph}
 */
Font.prototype.charToGlyph = function(c) {
    const glyphIndex = this.charToGlyphIndex(c);
    let glyph = this.glyphs.get(glyphIndex);
    if (!glyph) {
        // .notdef
        glyph = this.glyphs.get(0);
    }

    return glyph;
};

/**
 * Update features: the default features of every shaper (see defaultRenderOptions.features) with the features option
 * @param {any} options features options: an object of feature tags enabling (true) or disabling (false) features
 * over the default ones of every shaper (e.g. { liga: false, ss01: true }); the defaults when absent (or a features list)
 * @return {Array<{script: string, tags: string[]}>}
 */
Font.prototype.updateFeatures = function (options) {
    return this.defaultRenderOptions.features.map(feature => ({
        script: feature.script,
        tags: getEnabledFeatureTags(feature.tags, options)
    }));
};

/**
 * Convert the given text to a list of Glyph indexes.
 * Note that there is no strict one-to-one mapping between characters and
 * glyphs, so the list of returned glyph indexes can be larger or smaller than the
 * length of the given string.
 * @param  {string}
 * @param  {GlyphRenderOptions} [options]
 * @return {number[]}
 */
Font.prototype.stringToGlyphIndexes = function(s, options) {
    return this._createBidi(options).getTextGlyphs(s);
};

/**
 * Create a Bidi instance mapping the characters to glyph indexes, with the features, the script, the language and
 * the variation of the given options.
 * @param  {GlyphRenderOptions} [options]
 * @return {Bidi}
 * @private
 */
Font.prototype._createBidi = function(options) {
    options = options || {};
    const bidi = new Bidi();

    // Create and register 'glyphIndex' state modifier
    const charToGlyphIndexMod = token => this.charToGlyphIndex(token.char);
    bidi.registerModifier('glyphIndex', null, charToGlyphIndexMod);

    bidi.applyFeatures(this, this.updateFeatures(options.features), {
        script: options.script,
        language: options.language,
        variation: options.variation
    });

    return bidi;
};

/**
 * Convert the given text to a list of glyphs, each one with the characters of the text it represents
 * (its cluster), like the clusters of HarfBuzz (cluster level 1): a ligature represents all its component
 * characters, and the glyphs between its components (e.g. the marks its lookup skips) are in its cluster; each
 * glyph of a multiple substitution represents the characters of the glyph it replaces; a character represented
 * by no glyph of its own (e.g. a variation selector) belongs to the cluster of the glyph before it.
 * The glyphs are the ones (and in the same order) returned by stringToGlyphs().
 * @param  {string} s
 * @param  {GlyphRenderOptions} [options]
 * @return {Array<{glyph: opentype.Glyph, start: number, end: number}>} the glyphs, with the UTF-16 range
 * [start, end) of their characters in the text (text.slice(start, end) are the characters of the glyph)
 */
Font.prototype.stringToGlyphClusters = function(s, options) {
    return this._stringToDirectionalGlyphClusters(s, options).map(({ glyph, start, end }) => ({ glyph, start, end }));
};

/**
 * Convert the given text to a list of glyph clusters (see stringToGlyphClusters), each one with the direction of
 * its run.
 * @param  {string} text
 * @param  {GlyphRenderOptions} [options]
 * @return {Array<{glyph: opentype.Glyph, start: number, end: number, rightToLeft: boolean, scriptRun: Object,
 * ligatureProperties: Object|undefined}>} the glyphs in visual order, rightToLeft for the glyphs of a right-to-left run,
 * scriptRun the script run of the glyph, ligatureProperties what the ligature substitutions recorded about the glyph
 * (see Bidi.getTextGlyphClusters)
 * @private
 */
Font.prototype._stringToDirectionalGlyphClusters = function(text, options) {
    const clusters = this._createBidi(options).getTextGlyphClusters(text);
    const notdef = this.glyphs.get(0);
    return clusters.map(cluster => ({
        glyph: this.glyphs.get(cluster.index) || notdef,
        start: cluster.start,
        end: cluster.end,
        rightToLeft: cluster.rightToLeft,
        scriptRun: cluster.scriptRun,
        ligatureProperties: cluster.ligatureProperties
    }));
};

/**
 * Convert the given text to a list of Glyph objects.
 * Note that there is no strict one-to-one mapping between characters and
 * glyphs, so the list of returned glyphs can be larger or smaller than the
 * length of the given string.
 * The glyphs are in visual order, like HarfBuzz: the glyphs of an Arabic text in reverse order, the glyphs of a
 * multiple substitution included (e.g. a letter and the mark that ccmp decomposed it into, the mark first).
 * @param  {string}
 * @param  {GlyphRenderOptions} [options]
 * @return {opentype.Glyph[]}
 */
Font.prototype.stringToGlyphs = function(s, options) {
    const indexes = this.stringToGlyphIndexes(s, options);

    let length = indexes.length;

    // convert glyph indexes to glyph objects
    const glyphs = new Array(length);
    const notdef = this.glyphs.get(0);
    for (let i = 0; i < length; i += 1) {
        glyphs[i] = this.glyphs.get(indexes[i]) || notdef;
    }
    return glyphs;
};

/**
 * @param  {string}
 * @return {Number}
 */
Font.prototype.nameToGlyphIndex = function(name) {
    return this.glyphNames.nameToGlyphIndex(name);
};

/**
 * @param  {string}
 * @return {opentype.Glyph}
 */
Font.prototype.nameToGlyph = function(name) {
    const glyphIndex = this.nameToGlyphIndex(name);
    let glyph = this.glyphs.get(glyphIndex);
    if (!glyph) {
        // .notdef
        glyph = this.glyphs.get(0);
    }

    return glyph;
};

/**
 * @param  {Number}
 * @return {String}
 */
Font.prototype.glyphIndexToName = function(gid) {
    if (!this.glyphNames.glyphIndexToName) {
        return '';
    }

    return this.glyphNames.glyphIndexToName(gid);
};

/**
 * Retrieve the value of the kerning pair between the left glyph (or its index)
 * and the right glyph (or its index). If no kerning pair is found, return 0.
 * The kerning value gets added to the advance width when calculating the spacing
 * between glyphs.
 * For GPOS kerning, this method uses the kern feature of the default language of the script of the
 * characters the cmap maps to the two glyphs, with the fallbacks of font.position.getKerningTables, adding the
 * values of all its pair adjustment lookups (lookup type 2): its single adjustments (lookup type 1) are in the
 * positions of Font.shape. The script of a glyph is the Unicode script of its characters (see getCharTextScript),
 * none for characters of no script (Common, Inherited or Unknown, like digits and punctuation), and Latin for a glyph
 * shared by characters of several scripts, a character of no script counting as one (like a micro sign that is also
 * the Greek mu). The pair takes the first of Thai, Arabic, Hebrew, Cyrillic and Greek that one of its glyphs has,
 * otherwise its first script that is not Latin, otherwise Latin, or none when neither glyph has a script (e.g. digits,
 * or glyphs no character maps to, like alternates), and the OpenType script tag of that script that the GPOS table
 * has (DFLT for none, see getOpenTypeScriptTags and selectScriptTag).
 * The pair is the left glyph then the right glyph: for a GPOS pair of right-to-left text, pass the glyphs in
 * the order of the text. For another script or language, use
 * font.position.getKerningValue(font.position.getKerningTables(script, language), leftIndex, rightIndex),
 * or lay out the text (getAdvanceWidth, forEachGlyph), which takes the script of each script run of the text.
 * A GPOS lookup whose lookupFlag ignores one of the two glyphs (e.g. a mark with IgnoreMarks) adds nothing:
 * the text layout, or font.position.getGlyphRunKerningValue, kerns the glyphs across the ignored ones.
 * The value of a GPOS pair is what it adds to the advance of the left glyph, the x advance of its first value
 * record: its placements and its second value record are in the positions of Font.shape.
 * The kern table is used when the GPOS table has no kern feature for that script, like HarfBuzz, which kerns a
 * glyph with the next glyph that is not a GDEF mark there: a pair whose right glyph is a GDEF mark adds nothing.
 * @param  {opentype.Glyph|number} leftGlyph
 * @param  {opentype.Glyph|number} rightGlyph
 * @param  {Object} [variation] - variation coordinates for GPOS kerning, the current font variation if omitted
 * @return {Number}
 */
Font.prototype.getKerningValue = function(leftGlyph, rightGlyph, variation) {
    // glyph objects or indexes (index 0 is valid, so no `glyph.index || glyph`)
    leftGlyph = typeof leftGlyph === 'object' ? leftGlyph : getGlyphOfIndex(this, leftGlyph);
    rightGlyph = typeof rightGlyph === 'object' ? rightGlyph : getGlyphOfIndex(this, rightGlyph);
    if (!leftGlyph || !rightGlyph) {
        return 0;
    }
    const script = getKerningPairScript(getGlyphScript(leftGlyph), getGlyphScript(rightGlyph));
    const scriptTag = selectScriptTag(this.position, getOpenTypeScriptTags(script));
    return this.position.getKerningValue(this.position.getKerningTables(scriptTag), leftGlyph.index, rightGlyph.index, variation);
};

/**
 * The glyph of an index of the font, undefined for an index the font has not.
 * @param  {opentype.Font} font
 * @param  {number} index
 * @return {opentype.Glyph|undefined}
 */
function getGlyphOfIndex(font, index) {
    // a font parsed with lowMemory loads its glyphs on request, its GlyphSet counts the glyphs loaded so far
    const glyphCount = font.numGlyphs !== undefined ? font.numGlyphs : font.glyphs.length;
    return index >= 0 && index < glyphCount ? font.glyphs.get(index) : undefined;
}

// the scripts a kerning pair of glyphs of two scripts takes first, in this order (see getKerningPairScript)
const KERNING_PAIR_SCRIPTS = ['Thai', 'Arab', 'Hebr', 'Cyrl', 'Grek'];

/**
 * The script of a kerning pair of glyphs (see getKerningValue): the first of Thai, Arabic, Hebrew, Cyrillic and
 * Greek that the pair has, otherwise its first script that is not Latin, otherwise Latin, undefined when neither
 * glyph has a script.
 * @param  {string|undefined} leftScript - the ISO 15924 code of the script of the left glyph (see getGlyphScript)
 * @param  {string|undefined} rightScript - the ISO 15924 code of the script of the right glyph
 * @return {string|undefined}
 */
function getKerningPairScript(leftScript, rightScript) {
    const scripts = [leftScript, rightScript].filter(script => script !== undefined);
    return KERNING_PAIR_SCRIPTS.find(script => scripts.includes(script)) ||
        scripts.find(script => script !== 'Latn') ||
        scripts[0];
}

/**
 * The script of a glyph, from the characters the cmap maps to it (see getCharTextScript): their script when they
 * all have the same one, undefined when none has a script, Latin otherwise (a glyph shared by characters of several
 * scripts, a character of no script counting as one, like a micro sign that is also the Greek mu), so that the other
 * glyph of a pair chooses the script.
 * @param  {number[]} unicodes - the code points of the glyph
 * @return {string|undefined} the ISO 15924 code of the script
 */
function getUnicodesScript(unicodes) {
    const scripts = new Set(unicodes.map(unicode => getCharTextScript(String.fromCodePoint(unicode))));
    const hasCharacterOfNoScript = scripts.delete(undefined);
    if (scripts.size === 1 && !hasCharacterOfNoScript) {
        return scripts.values().next().value;
    }
    return scripts.size ? 'Latn' : undefined;
}

// the script of each glyph, with the array of code points and the number of code points it was computed from
// (Glyph.addUnicode adds to the array, glyph.unicodes can be replaced): a glyph can have thousands of code points
// (cmap format 13)
const glyphScripts = new WeakMap();

/**
 * The script of a glyph (see getUnicodesScript), computed once for its code points.
 * @param  {opentype.Glyph} glyph
 * @return {string|undefined} the ISO 15924 code of the script
 */
function getGlyphScript(glyph) {
    const unicodes = glyph.unicodes;
    const cachedScript = glyphScripts.get(glyph);
    if (cachedScript && cachedScript.unicodes === unicodes && cachedScript.unicodeCount === unicodes.length) {
        return cachedScript.script;
    }
    const script = getUnicodesScript(unicodes);
    glyphScripts.set(glyph, { unicodes, unicodeCount: unicodes.length, script });
    return script;
}

/**
 * Split a sequence of glyph clusters into the runs HarfBuzz shapes on their own: a cluster continues the run of the
 * cluster before it when both are in the same script run and both are left-to-right or both right-to-left, so that
 * a GPOS lookup that skips the glyphs it ignores stops at the end of a run.
 * @param  {Array<{rightToLeft: boolean, scriptRun: Object}>} glyphClusters - see _stringToDirectionalGlyphClusters
 * @return {number[][]} the positions of the clusters of each run, in visual order
 */
function getGlyphRuns(glyphClusters) {
    const glyphRuns = [];
    for (let i = 0; i < glyphClusters.length; i++) {
        const cluster = glyphClusters[i];
        const previousCluster = glyphClusters[i - 1];
        if (!previousCluster || cluster.rightToLeft !== previousCluster.rightToLeft || cluster.scriptRun !== previousCluster.scriptRun) {
            glyphRuns.push([]);
        }
        glyphRuns[glyphRuns.length - 1].push(i);
    }
    return glyphRuns;
}

/**
 * The feature tags of a features option (see GlyphRenderOptions.features): the default ones it does not turn off,
 * then the ones it turns on.
 * @param  {string[]} defaultTags
 * @param  {Object|Array|undefined} featuresOption - feature tags enabled (true) or disabled (false); the defaults
 * when absent (or a features list)
 * @return {string[]}
 */
function getEnabledFeatureTags(defaultTags, featuresOption) {
    const overrides = featuresOption && !Array.isArray(featuresOption) ? featuresOption : {};
    const tags = defaultTags.filter(tag => overrides[tag] !== false);
    for (const tag of Object.keys(overrides)) {
        if (overrides[tag] && !tags.includes(tag)) {
            tags.push(tag);
        }
    }
    return tags;
}

/**
 * The GPOS features of a run, like HarfBuzz, which looks each feature of its map up in GSUB and in GPOS: the default
 * GSUB features of the shaper of the run (see defaultRenderOptions.features) and the GPOS features HarfBuzz enables
 * by default (see DEFAULT_POSITIONING_FEATURES), with the features option, without kern when the kerning option is
 * off. Not the Arabic forms by default: HarfBuzz applies their GPOS lookups at the glyphs of each form only, which
 * is not supported yet.
 * @param  {Font} font
 * @param  {GlyphRenderOptions} options
 * @param  {string[]} scriptTags - the OpenType script tags of the run (see getScriptRunShaper)
 * @return {string[]}
 */
function getPositioningFeatureTags(font, options, scriptTags) {
    const shaper = getScriptRunShaper(scriptTags);
    const shaperFeature = font.defaultRenderOptions.features.find(feature => feature.script === shaper);
    const shaperTags = shaperFeature ? shaperFeature.tags.filter(tag => !ARABIC_FORM_TAGS.includes(tag)) : [];
    const featureTags = getEnabledFeatureTags(shaperTags.concat(DEFAULT_POSITIONING_FEATURES), options.features);
    return options.kerning ? featureTags : featureTags.filter(tag => tag !== 'kern');
}

/**
 * @typedef GlyphRenderOptions
 * @type Object
 * @property {string} [script] - OpenType script tag of the GSUB and GPOS features (and of the kern table fallback) of
 *                               the whole text, e.g. 'latn', 'cyrl' (see
 *                               https://learn.microsoft.com/en-us/typography/opentype/spec/scripttags), taken literally:
 *                               'deva' selects the language systems of the first version of the Indic tags, 'dev2' those
 *                               of the second one. Like HarfBuzz with the script of a buffer, the text is one script run,
 *                               which takes the arabic features for 'arab', the thai features for 'thai' and the latin
 *                               features otherwise. Without it, like
 *                               HarfBuzz after the itemization of a browser, the text is split into script runs by the
 *                               Unicode Script property of its characters, the characters of no script (Common,
 *                               Inherited, Unknown: digits, punctuation, spaces, most combining marks) and the variation
 *                               selectors in the run of the character before them (of the first character of a script at
 *                               the start of the text), or in the run after them when their Unicode Script_Extensions have
 *                               its script and not the one of the run before them (e.g. a tatweel or an Arabic haraka
 *                               between a Latin word and an Arabic letter), not yet the paired brackets of the browsers
 *                               (a closing bracket is in the run of the character before it), and each run takes the
 *                               OpenType tag of its script: latn, cyrl, grek, armn, cham... (kana for Hiragana and Katakana; dev3, dev2, then
 *                               deva for Devanagari and the other Indic scripts; DFLT for a text of no script). Each
 *                               script run is shaped on
 *                               its own: its GSUB lookups and its kerning pairs never cross the run. The arabic runs take
 *                               the arabic features, the thai runs the thai features, the other runs the latin features
 *                               (see features). A script the font has not falls back to 'DFLT', 'dflt', then 'latn', like
 *                               HarfBuzz; with 'hebr' and no hebr script in the GPOS table, no GPOS lookup applies and
 *                               the kern table does, like the Hebrew shaper of HarfBuzz. Like HarfBuzz, the GPOS lookups
 *                               apply to a right-to-left run in the order of the text (the value records of a pair to its
 *                               glyphs in the order of the text), the kern table in visual order (see Font.shape).
 * @property {string} [language='dflt'] - OpenType language system tag of the GSUB features (their locl included) and of
 *                                        the GPOS features, e.g. 'TRK ' or 'TRK' for Turkish, 'SRB' for Serbian
 *                                        (a tag of three letters is the tag with its trailing space), not a BCP 47
 *                                        language tag (see
 *                                        https://learn.microsoft.com/en-us/typography/opentype/spec/languagetags).
 *                                        A language system the script has not falls back to the default language
 *                                        system of the script (see Layout.getLangSysTable), like HarfBuzz.
 * @property {boolean} [kerning=true] - whether to include kerning values: the lookups of the GPOS kern feature
 *                                      (the single adjustments of each lookup to a glyph, its pair adjustments
 *                                      between a glyph and the next glyph its lookupFlag does not ignore, e.g.
 *                                      across the marks with IgnoreMarks, in the same run), or the kern table
 *                                      when GPOS has no kern feature for the script and language (each glyph
 *                                      kerned with the next glyph that is not a GDEF mark), see Font.shape. The
 *                                      marks are the ones of the GlyphClassDef of GDEF: without it no glyph is
 *                                      a mark, for the GPOS lookups (but the mark-to-base and mark-to-ligature
 *                                      attachments, see Font.shape) and the kern table, unlike HarfBuzz, which
 *                                      then takes the nonspacing marks of Unicode as marks. Like HarfBuzz, which shapes
 *                                      each script run and each direction run on its own, two glyphs of two script
 *                                      runs, or of a left-to-right run and of a right-to-left run, are never kerned
 *                                      together. Not yet the composition of HarfBuzz: a letter and a combining mark
 *                                      (e.g. A and U+0300) are not composed into the precomposed glyph of the font
 *                                      (Agrave), so the kern table and the GPOS lookups with IgnoreMarks kern the
 *                                      letter across the mark. The other GPOS features apply without kerning too
 * @property {object} [features] - OpenType Layout feature tags (e.g. `{ liga: false, ss01: true }`), enabling or disabling
 *                                 them over the default ones, in every script run, for GSUB and for GPOS. GSUB: rvrn,
 *                                 ccmp, locl, rlig, rclt, calt, liga and clig for the latin and the thai features; rvrn,
 *                                 ccmp, locl, isol, init, medi, fina, rlig, rclt, calt, liga, clig and mset for the arabic
 *                                 features. Like HarfBuzz, the lookups of rvrn apply first, in a stage of their own, with
 *                                 the GSUB feature variations at the variation of the options; the arabic features then
 *                                 apply in the stages of the Arabic shaper of HarfBuzz: ccmp and locl, each form (isol,
 *                                 fina, medi, then init) to the letters of its form (each lookup of the form once over the
 *                                 whole run, in lookup list order), rlig, calt (with the other features when the language
 *                                 system has rclt), then the other features. Like HarfBuzz, the required feature of the
 *                                 language system (its ReqFeatureIndex) applies whatever the features option, at every
 *                                 glyph, with the lookups of the stage of its tag in lookup list order when the tag is
 *                                 enabled, otherwise with rvrn. Not yet the stch of the Arabic shaper of HarfBuzz, nor a
 *                                 form enabled by the features option at every glyph like a feature of HarfBuzz enabled by
 *                                 the user, nor the GSUB lookups of abvm, blwm, curs, dist, kern (with the kerning
 *                                 option), mark and mkmk, which HarfBuzz looks up in GSUB too. GPOS: like HarfBuzz,
 *                                 which looks each feature up in GSUB and in GPOS, the GSUB features of the run but the
 *                                 Arabic forms, and abvm, blwm, curs, dist, kern (with the kerning option), mark and
 *                                 mkmk, and the required feature of the GPOS language system (its ReqFeatureIndex)
 *                                 whatever the features option, their lookups together in lookup list order: the
 *                                 single adjustments (lookup type 1, e.g. of case, cpsp, palt, halt or vpal, which
 *                                 the features option enables, or of kern), the pair adjustments (lookup type 2), the
 *                                 cursive attachments (lookup type 3, e.g. of curs) and the mark attachments (lookup
 *                                 types 4, 5 and 6, e.g. of mark and mkmk), so a mark, of the text or substituted by
 *                                 GSUB, is drawn on its base at their anchors, and like HarfBuzz the advance of a GDEF
 *                                 mark is set to 0 in the runs of its default, Arabic, Hebrew, Thai, USE and Myanmar
 *                                 shapers (see Font.shape); the contextual positionings (lookup types 7 and 8) are
 *                                 skipped with a warning (see Font.shape). Not yet the GPOS lookups of the Arabic
 *                                 forms, which HarfBuzz applies at the glyphs of each form only: a form that the
 *                                 features option enables applies at every glyph, like a feature of HarfBuzz enabled by
 *                                 the user. Not yet the GPOS lookups of the direction features (ltra, ltrm, rtla, rtlm)
 *                                 and of rand, nor the GPOS feature variations (see Font.shape).
 *                                 See https://www.microsoft.com/typography/otspec/featuretags.htm
 * @property {Object} [variation] - variation coordinates of the advances, the GPOS values and the GSUB feature variations
 *                                  (not yet the GPOS feature variations, see Font.shape) (e.g. `{ wght: 700 }`), the
 *                                  current variation of the font if omitted
 * @property {boolean} [hinting=false] - whether to apply font hinting to the outlines
 * @property {integer} [usePalette=0] For COLR/CPAL fonts, the zero-based index of the color palette to use. (Use `Font.palettes.get()` to get the available palettes)
 * @property {boolean} [drawLayers=true] For COLR/CPAL fonts, this can be turned to false in order to draw the fallback glyphs instead
 * @property {boolean} [drawSVG=true] For SVG fonts, this can be turned to false in order to draw the fallback glyphs instead
 */
Font.prototype.defaultRenderOptions = {
    kerning: true,
    // the GSUB features of each shaper: arab for the arabic script runs, thai for the thai script runs, latn for the
    // other ones. Like HarfBuzz, rvrn is on by default in a stage of its own, the substitution features browsers enable
    // by default apply to every script, and the arabic features add the forms and mset (collect_features_arabic). Not
    // yet the other features HarfBuzz enables by default: the direction features (ltra, ltrm, rtla), rand, the
    // automatic fractions (numr, dnom and frac around U+2044 FRACTION SLASH), the stch of the Arabic shaper, and the
    // GSUB lookups of abvm, blwm, curs, dist, kern (with the kerning option), mark and mkmk, which HarfBuzz looks up
    // in GSUB too
    features: [
        { script: 'arab', tags: ['rvrn', 'ccmp', 'locl', 'isol', 'init', 'medi', 'fina', 'rlig', 'rclt', 'calt', 'liga', 'clig', 'mset'] },
        { script: 'latn', tags: ['rvrn', 'ccmp', 'locl', 'rlig', 'rclt', 'calt', 'liga', 'clig'] },
        { script: 'thai', tags: ['rvrn', 'ccmp', 'locl', 'rlig', 'rclt', 'calt', 'liga', 'clig'] },
    ],
    hinting: false,
    usePalette: 0,
    drawLayers: true,
    drawSVG: true,
};

/**
 * A glyph of a shaped text (see Font.shape), like a glyph of hb-shape.
 * @typedef GlyphPosition
 * @type Object
 * @property {opentype.Glyph} glyph
 * @property {number} start - the UTF-16 offset of the first character of the cluster of the glyph (see
 *                            stringToGlyphClusters)
 * @property {number} end - the UTF-16 offset after the last character of the cluster of the glyph
 * @property {number} xAdvance - how far the pen moves after the glyph, in font units
 * @property {number} yAdvance - how far the pen moves up after the glyph, in font units: 0 in horizontal text
 * @property {number} xOffset - how far right of the pen the glyph is drawn, in font units: a glyph attached to
 *                              another one by GPOS (a mark on its base) is drawn from its own pen position, after the
 *                              advances of the glyphs before it, at the offset that puts it on its anchor
 * @property {number} yOffset - how far above the pen the glyph is drawn, in font units (the y axis goes up, like
 *                              the y offsets of hb-shape)
 */

/**
 * Shape a text like hb-shape: its glyphs after the GSUB features (see stringToGlyphClusters), in visual order, each
 * one with its cluster and its position in font units at the variation of the options (or of the font) after GPOS.
 * Like HarfBuzz, each run of one script and one direction (see GlyphRenderOptions.script) is positioned on its own:
 * the lookups of the GPOS features of its script and language apply to its glyphs in the order of the text (the
 * reverse of the visual order in a right-to-left run), together in LookupList order (extension lookups included),
 * each lookup at every glyph its lookupFlag does not ignore. Like HarfBuzz, which looks each feature up in GSUB and
 * in GPOS, the GPOS features of a run are the default GSUB features of its shaper (see GlyphRenderOptions.features)
 * but the Arabic forms, and abvm, blwm, curs, dist, kern, mark and mkmk, with the features option, kern only with the
 * kerning option, and the required feature of the GPOS language system (its ReqFeatureIndex) whatever the features
 * option. The single adjustments (lookup type 1, formats 1 and 2) apply their value record to a glyph, the pair
 * adjustments (lookup type 2) the two value records of a pair (x and y placement, x advance, with the variation
 * deltas of a variable font; the y advance of a value record is for vertical text); the mark attachments (lookup
 * types 4, 5 and 6) move a mark onto the glyph before it at their anchors (with the variation deltas of the anchors
 * of a variable font): mark-to-base and mark-to-ligature onto the glyph before it that is not a GDEF mark, at the
 * anchor of the ligature component the mark follows (see LigatureProperties in layout.mjs), mark-to-mark onto the
 * mark before it of the same glyph; the cursive attachments (lookup type 3) join the exit anchor of a glyph to the
 * entry anchor of the next one; after the lookups, the offsets of an attached glyph follow the glyph it is attached
 * to, over the advances between them, like HarfBuzz (see positionGlyphRun in position.mjs); the contextual
 * positionings (lookup types 7 and 8) are not implemented yet and are skipped with a warning (once per font and
 * lookup type). When kern is on and GPOS has no kern feature for the script and language, the kern table applies
 * like in HarfBuzz: in visual order, each glyph kerned with the next glyph that is not a GDEF mark, half of the value
 * added to the advance of the first glyph and the rest to the advance and the x offset of the second one; unlike
 * HarfBuzz, which splits the value of a pair in each kern subtable on its own, the values of a pair in several
 * subtables are added up before the split: the positions and the pen are the same, the advances can differ by a few
 * units (up to half the number of subtables with an odd value for the pair). The marks are the ones of the
 * GlyphClassDef of GDEF: without it no glyph is a mark (see GlyphRenderOptions.kerning), but a mark-to-base or
 * mark-to-ligature lookup with IgnoreMarks, a MarkAttachmentType, or UseMarkFilteringSet and a mark glyph set that
 * does not cover the mark, takes every glyph its subtable covers as a mark and does not attach it (see
 * isMarkIgnoredWithoutGlyphClasses in layout.mjs), like HarfBuzz for the glyphs of the nonspacing marks of Unicode
 * (Mn), which it then takes as marks of no mark attachment class; not yet like HarfBuzz for the glyph of a spacing
 * character that the subtable covers as a mark (e.g. U+00B4 mapped to the glyph of U+0301), a base glyph that
 * HarfBuzz attaches. Like HarfBuzz (zero_mark_widths_by_gdef), the advance of a GDEF mark is set to 0 as the shaper
 * HarfBuzz picks for the run from its script and from the GSUB script it chose for it (hb_ot_shaper_categorize, see
 * getMarkAdvanceZeroing in position.mjs): after GPOS with its default, Arabic, Hebrew and Thai shapers, before GPOS
 * with its USE and Myanmar shapers, keeping the GPOS adjustments, never with its Indic, Khmer and Hangul shapers;
 * without a GPOS table, the x offset of a mark of a left-to-right run moves back by the advance it loses. Not yet
 * like HarfBuzz: a mark after the second glyph of a multiple substitution attaches to that glyph when the subtable
 * covers it, otherwise to nothing, where HarfBuzz attaches it to the first glyph of the substitution; in a font
 * without a GPOS table (e.g. a font with the kern table only, with or without GDEF), its default, Arabic and Hebrew
 * shapers place each mark over or under its base (its fallback mark positioning), where the mark is drawn at the
 * pen position; the default ignorables (e.g. U+200D ZERO WIDTH JOINER, U+00AD SOFT HYPHEN), which HarfBuzz skips in
 * the GPOS and kern table pairs and when it looks for the base of a mark, and hides with an advance of 0, are drawn
 * with their glyph (.notdef without one) and their advance, no pair crosses them, and a mark after one of them but
 * U+200D (e.g. U+00AD, U+200C, U+034F) is not attached to the base before it; a letter and a combining mark are not composed into the precomposed glyph
 * of the font (e.g. A and U+0300 into Agrave), so the kern table and the GPOS lookups with IgnoreMarks kern the
 * letter across the mark; the GPOS lookups of the Arabic forms (isol, init, medi, fina), which HarfBuzz applies at
 * the glyphs of each form only, apply only when the features option enables them, then at every glyph like a feature
 * that the user of HarfBuzz enables; the GPOS feature variations (the FeatureVariations of the GPOS table), which
 * HarfBuzz applies like the GSUB ones, are not applied yet: the lookups of a GPOS feature are the ones of its
 * FeatureList record at every variation; nor the GPOS lookups of the other features HarfBuzz enables by default, the
 * direction features (ltra, ltrm, rtla, rtlm) and rand, nor the GSUB lookups of abvm, blwm, curs, dist, kern (with
 * the kerning option), mark and mkmk, which HarfBuzz looks up in GSUB too.
 * @param  {string} text
 * @param  {GlyphRenderOptions} [options] - features, kerning, script, language and variation
 * @return {GlyphPosition[]}
 */
Font.prototype.shape = function(text, options) {
    options = Object.assign({}, this.defaultRenderOptions, options);
    const glyphClusters = this._stringToDirectionalGlyphClusters(text, options);
    const glyphPositions = glyphClusters.map(({ glyph, start, end }) => ({
        glyph,
        start,
        end,
        // a glyph without advance width (e.g. a glyph of a crafted font) does not move the pen
        xAdvance: glyph.getAdvanceWidth(this, options.variation) || 0,
        yAdvance: 0,
        xOffset: 0,
        yOffset: 0
    }));
    for (const clusterIndexes of getGlyphRuns(glyphClusters)) {
        const firstCluster = glyphClusters[clusterIndexes[0]];
        const scriptTags = firstCluster.scriptRun.scriptTags;
        positionGlyphRun(
            this.position,
            clusterIndexes.map(clusterIndex => glyphClusters[clusterIndex].glyph.index),
            clusterIndexes.map(clusterIndex => glyphPositions[clusterIndex]),
            {
                rightToLeft: firstCluster.rightToLeft,
                script: selectScriptTag(this.position, scriptTags),
                language: options.language,
                featureTags: getPositioningFeatureTags(this, options, scriptTags),
                variation: options.variation,
                markAdvanceZeroing: getMarkAdvanceZeroing(scriptTags, getChosenScriptTag(this.substitution, scriptTags)),
                ligatureProperties: clusterIndexes.map(clusterIndex => glyphClusters[clusterIndex].ligatureProperties)
            }
        );
    }
    return glyphPositions;
};

/**
 * Helper function that invokes the given callback for each glyph in the given text.
 * The callback gets `(glyph, x, y, fontSize, options)`.
 * The glyphs and their positions are the ones of Font.shape: x is the pen position plus the x offset of the glyph,
 * y the baseline minus its y offset (the y axis of the callback goes down, like a canvas), each one scaled to the
 * font size, and the pen moves by the x advance of the glyph and by the letterSpacing or the tracking option.
 * @param {string} text - The text to apply.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {GlyphRenderOptions=} options
 * @param  {Function} callback
 * @return {number} the x of the pen after the last glyph
 */
Font.prototype.forEachGlyph = function(text, x, y, fontSize, options, callback) {
    x = x !== undefined ? x : 0;
    y = y !== undefined ? y : 0;
    fontSize = fontSize !== undefined ? fontSize : 72;
    options = Object.assign({}, this.defaultRenderOptions, options);
    const fontScale = 1 / this.unitsPerEm * fontSize;
    for (const glyphPosition of this.shape(text, options)) {
        callback.call(this, glyphPosition.glyph, x + glyphPosition.xOffset * fontScale, y - glyphPosition.yOffset * fontScale, fontSize, options);
        x += glyphPosition.xAdvance * fontScale;

        if (options.letterSpacing) {
            x += options.letterSpacing * fontSize;
        } else if (options.tracking) {
            x += (options.tracking / 1000) * fontSize;
        }
    }
    return x;
};

/**
 * Create a Path object that represents the given text.
 * @param  {string} text - The text to create.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {GlyphRenderOptions=} options
 * @return {opentype.Path}
 */
Font.prototype.getPath = function(text, x, y, fontSize, options) {
    options = Object.assign({}, this.defaultRenderOptions, options);
    const fullPath = new Path();
    fullPath._layers = [];
    applyPaintType(this, fullPath, fontSize);
    if (fullPath.stroke) {
        const scale = 1 / (fullPath.unitsPerEm || 1000) * fontSize;
        fullPath.strokeWidth *= scale;
    }
    this.forEachGlyph(text, x, y, fontSize, options, (glyph, gX, gY, gFontSize) => {
        const glyphPath = glyph.getPath(gX, gY, gFontSize, options, this);
        if ( options.drawSVG || options.drawLayers ) {
            const layers = glyphPath._layers;
            if ( layers && layers.length ) {
                for(let l = 0; l < layers.length; l++) {
                    const layer = layers[l];
                    fullPath._layers.push(layer);
                }
                return;
            }
        }
        fullPath.extend(glyphPath);
    });
    return fullPath;
};

/**
 * Create an array of Path objects that represent the glyphs of a given text.
 * @param  {string} text - The text to create.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {GlyphRenderOptions=} options
 * @return {opentype.Path[]}
 */
Font.prototype.getPaths = function(text, x, y, fontSize, options) {
    options = Object.assign({}, this.defaultRenderOptions, options);
    const glyphPaths = [];
    this.forEachGlyph(text, x, y, fontSize, options, function(glyph, gX, gY, gFontSize) {
        const glyphPath = glyph.getPath(gX, gY, gFontSize, options, this);
        glyphPaths.push(glyphPath);
    });

    return glyphPaths;
};

/**
 * Returns the advance width of a text.
 *
 * This is something different than Path.getBoundingBox() as for example a
 * suffixed whitespace increases the advanceWidth but not the bounding box
 * or an overhanging letter like a calligraphic 'f' might have a quite larger
 * bounding box than its advance width.
 *
 * This corresponds to canvas2dContext.measureText(text).width
 *
 * @param  {string} text - The text to create.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {GlyphRenderOptions=} options
 * @return advance width
 */
Font.prototype.getAdvanceWidth = function(text, fontSize, options) {
    options = Object.assign({}, this.defaultRenderOptions, options);
    return this.forEachGlyph(text, 0, 0, fontSize, options, function() {});
};

/**
 * Draw the text on the given drawing context.
 * @param  {CanvasRenderingContext2D} ctx - A 2D drawing context, like Canvas.
 * @param  {string} text - The text to create.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {GlyphRenderOptions=} options
 */
Font.prototype.draw = function(ctx, text, x, y, fontSize, options) {
    const path = this.getPath(text, x, y, fontSize, options);
    path.draw(ctx);
};

/**
 * Draw the points of all glyphs in the text.
 * On-curve points will be drawn in blue, off-curve points will be drawn in red.
 * @param {CanvasRenderingContext2D} ctx - A 2D drawing context, like Canvas.
 * @param {string} text - The text to create.
 * @param {number} [x=0] - Horizontal position of the beginning of the text.
 * @param {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param {GlyphRenderOptions=} options
 */
Font.prototype.drawPoints = function(ctx, text, x, y, fontSize, options) {
    options = Object.assign({}, this.defaultRenderOptions, options);
    this.forEachGlyph(text, x, y, fontSize, options, function(glyph, gX, gY, gFontSize) {
        glyph.drawPoints(ctx, gX, gY, gFontSize, options, this);
    });
};

/**
 * Draw lines indicating important font measurements for all glyphs in the text.
 * Black lines indicate the origin of the coordinate system (point 0,0).
 * Blue lines indicate the glyph bounding box.
 * Green line indicates the advance width of the glyph.
 * @param {CanvasRenderingContext2D} ctx - A 2D drawing context, like Canvas.
 * @param {string} text - The text to create.
 * @param {number} [x=0] - Horizontal position of the beginning of the text.
 * @param {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param {GlyphRenderOptions=} options
 */
Font.prototype.drawMetrics = function(ctx, text, x, y, fontSize, options) {
    options = Object.assign({}, this.defaultRenderOptions, options);
    this.forEachGlyph(text, x, y, fontSize, options, function(glyph, gX, gY, gFontSize) {
        glyph.drawMetrics(ctx, gX, gY, gFontSize);
    });
};

/**
 * @param  {string}
 * @return {string}
 */
Font.prototype.getEnglishName = function(name) {
    const translations = (this.names.unicode || this.names.macintosh || this.names.windows)[name];
    if (translations) {
        return translations.en;
    }
};

/**
 * Validate
 */
Font.prototype.validate = function() {
    const warnings = [];
    const _this = this;

    function assert(predicate, message) {
        if (!predicate) {
            console.warn(`[opentype.js] ${message}`);
            warnings.push(message);
        }
    }

    function assertNamePresent(name) {
        const englishName = _this.getEnglishName(name);
        assert(englishName && englishName.trim().length > 0,
            'No English ' + name + ' specified.');
    }

    // Identification information
    assertNamePresent('fontFamily');
    assertNamePresent('weightName');
    assertNamePresent('manufacturer');
    assertNamePresent('copyright');
    assertNamePresent('version');

    // Dimension information
    assert(this.unitsPerEm > 0, 'No unitsPerEm specified.');

    if (this.tables.colr) {
        const baseGlyphs = this.tables.colr.baseGlyphRecords;
        let previousID = -1;
        for(let b = 0; b < baseGlyphs.length; b++) {
            const currentGlyphID = baseGlyphs[b].glyphID;
            assert(previousID < baseGlyphs[b].glyphID, `baseGlyphs must be sorted by GlyphID in ascending order, but glyphID ${currentGlyphID} comes after ${previousID}`);
            if (previousID > baseGlyphs[b].glyphID) {
                break;
            }
            previousID = currentGlyphID;
        }
    }

    return warnings;
};

/**
 * Convert the font object to a SFNT data structure.
 * This structure contains all the necessary tables and metadata to create a binary OTF file.
 * @return {opentype.Table}
 */
Font.prototype.toTables = function() {
    return sfnt.fontToTable(this);
};
/**
 * @deprecated Font.toBuffer is deprecated. Use Font.toArrayBuffer instead.
 */
Font.prototype.toBuffer = function() {
    console.warn('Font.toBuffer is deprecated. Use Font.toArrayBuffer instead.');
    return this.toArrayBuffer();
};
/**
 * Converts a `opentype.Font` into an `ArrayBuffer`
 * @return {ArrayBuffer}
 */
Font.prototype.toArrayBuffer = function() {
    const sfntTable = this.toTables();
    const bytes = sfntTable.encode();
    const buffer = new ArrayBuffer(bytes.length);
    const intArray = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
        intArray[i] = bytes[i];
    }

    return buffer;
};

/**
 * Initiate a download of the OpenType font.
 * @deprecated
 */
Font.prototype.download = function() {
    console.error('DEPRECATED: platform-specific actions are to be implemented on user-side');
};

/**
 * @private
 */
Font.prototype.fsSelectionValues = {
    ITALIC:              0x001, //1
    UNDERSCORE:          0x002, //2
    NEGATIVE:            0x004, //4
    OUTLINED:            0x008, //8
    STRIKEOUT:           0x010, //16
    BOLD:                0x020, //32
    REGULAR:             0x040, //64
    USER_TYPO_METRICS:   0x080, //128
    WWS:                 0x100, //256
    OBLIQUE:             0x200  //512
};

/**
 * @private
 */
Font.prototype.macStyleValues = {
    BOLD:       0x001, //1
    ITALIC:     0x002, //2
    UNDERLINE:  0x004, //4
    OUTLINED:   0x008, //8
    SHADOW:     0x010, //16
    CONDENSED:  0x020, //32
    EXTENDED:   0x040, //64
};

/**
 * @private
 */
Font.prototype.usWidthClasses = {
    ULTRA_CONDENSED: 1,
    EXTRA_CONDENSED: 2,
    CONDENSED: 3,
    SEMI_CONDENSED: 4,
    MEDIUM: 5,
    SEMI_EXPANDED: 6,
    EXPANDED: 7,
    EXTRA_EXPANDED: 8,
    ULTRA_EXPANDED: 9
};

/**
 * @private
 */
Font.prototype.usWeightClasses = {
    THIN: 100,
    EXTRA_LIGHT: 200,
    LIGHT: 300,
    NORMAL: 400,
    MEDIUM: 500,
    SEMI_BOLD: 600,
    BOLD: 700,
    EXTRA_BOLD: 800,
    BLACK:    900
};

export default Font;
