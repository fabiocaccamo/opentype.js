// The Font object

import Path from './path.mjs';
import sfnt from './tables/sfnt.mjs';
import { DefaultEncoding } from './encoding.mjs';
import glyphset from './glyphset.mjs';
import Position from './position.mjs';
import Substitution from './substitution.mjs';
import { PaletteManager } from './palettes.mjs';
import { LayerManager } from './layers.mjs';
import { SVGImageManager } from './svgimages.mjs';
import { VariationManager } from './variation.mjs';
import HintingTrueType from './hintingtt.mjs';
import Bidi from './bidi.mjs';
import { getCharTextScript } from './char.mjs';
import { getOpenTypeScriptTags, selectScriptTag } from './layout.mjs';
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
    const overrides = options && !Array.isArray(options) ? options : {};
    return this.defaultRenderOptions.features.map(feature => {
        const tags = feature.tags.filter(tag => overrides[tag] !== false);
        for (const tag of Object.keys(overrides)) {
            if (overrides[tag] && !tags.includes(tag)) {
                tags.push(tag);
            }
        }
        return { script: feature.script, tags };
    });
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
 * @return {Array<{glyph: opentype.Glyph, start: number, end: number, rightToLeft: boolean, scriptRun: Object}>}
 * the glyphs in visual order, rightToLeft for the glyphs of a right-to-left run, scriptRun the script run of the glyph
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
        scriptRun: cluster.scriptRun
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
 * values of all its lookups. The script of a glyph is the Unicode script of its characters (see getCharTextScript),
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
 * The kern table is used when the GPOS table has no kern feature for that script, like HarfBuzz.
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
 * cluster before it when both are in the same script run and both are left-to-right or both right-to-left. Given in
 * visual order, the glyphs of a left-to-right run are in the order of the text, given in reverse visual order the
 * glyphs of a right-to-left run, so a GPOS kern lookup that skips the glyphs it ignores stops at the end of a run.
 * @param  {Array<{glyph: opentype.Glyph, rightToLeft: boolean, scriptRun: Object}>} glyphClusters - see
 * _stringToDirectionalGlyphClusters
 * @return {Array<{glyphIndexes: number[], position: number}>} for each cluster, the glyph indexes of its run and its
 * position in the run
 */
function getShapedGlyphRuns(glyphClusters) {
    const clusterRuns = [];
    let glyphIndexes = [];
    for (let i = 0; i < glyphClusters.length; i++) {
        const cluster = glyphClusters[i];
        const previousCluster = glyphClusters[i - 1];
        if (previousCluster && (cluster.rightToLeft !== previousCluster.rightToLeft || cluster.scriptRun !== previousCluster.scriptRun)) {
            glyphIndexes = [];
        }
        clusterRuns.push({ glyphIndexes, position: glyphIndexes.length });
        glyphIndexes.push(cluster.glyph.index);
    }
    return clusterRuns;
}

/**
 * @typedef GlyphRenderOptions
 * @type Object
 * @property {string} [script] - OpenType script tag of the GSUB features and of the GPOS kern feature (and of the kern
 *                               table fallback) of the whole text, e.g. 'latn', 'cyrl' (see
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
 *                               HarfBuzz; 'hebr' without a hebr script in the GPOS table uses the kern table, like the
 *                               Hebrew shaper of HarfBuzz. Like HarfBuzz, the GPOS pairs of a right-to-left run are looked
 *                               up in the order of the text, the kern table pairs in visual order. The value of a GPOS
 *                               pair of a right-to-left run is added between its two glyphs: right for the usual records
 *                               whose x placement and x advance are the same, not yet for a record with an x advance only.
 * @property {string} [language='dflt'] - OpenType language system tag of the GSUB features (their locl included) and of
 *                                        the GPOS kern feature, e.g. 'TRK ' or 'TRK' for Turkish, 'SRB' for Serbian
 *                                        (a tag of three letters is the tag with its trailing space), not a BCP 47
 *                                        language tag (see
 *                                        https://learn.microsoft.com/en-us/typography/opentype/spec/languagetags).
 *                                        A language system the script has not falls back to the default language
 *                                        system of the script (see Layout.getLangSysTable), like HarfBuzz.
 * @property {boolean} [kerning=true] - whether to include kerning values: the values of all the lookups of the GPOS kern
 *                                      feature, each lookup kerning a glyph with the next glyph its lookupFlag does not
 *                                      ignore (e.g. across the marks with IgnoreMarks) in the same run, or the values of
 *                                      the kern table when GPOS has no kern feature for the script. Like HarfBuzz, which
 *                                      shapes each script run and each direction run on its own, two glyphs of two
 *                                      script runs, or of a left-to-right run and of a right-to-left run, are never
 *                                      kerned together
 * @property {object} [features] - OpenType Layout feature tags (e.g. `{ liga: false, ss01: true }`), enabling or disabling
 *                                 them over the default ones, in every script run: rvrn, ccmp, locl, rlig, rclt, calt,
 *                                 liga and clig for the latin and the thai features; rvrn, ccmp, locl, isol, init, medi,
 *                                 fina, rlig, rclt, calt, liga, clig and mset for the arabic features. Like HarfBuzz, the
 *                                 lookups of rvrn apply first, in a stage of their own, with the GSUB feature variations
 *                                 at the variation of the options; the arabic features then apply in the stages of the
 *                                 Arabic shaper of HarfBuzz: ccmp and locl, each form (isol, fina, medi, then init) to the
 *                                 letters of its form (each lookup of the form once over the whole run, in lookup list
 *                                 order), rlig, calt (with the other features when the language system has rclt), then
 *                                 the other features. Like HarfBuzz, the required feature of the language system (its
 *                                 ReqFeatureIndex) applies whatever the features option, at every glyph, with the lookups
 *                                 of the stage of its tag in lookup list order when the tag is enabled, otherwise with
 *                                 rvrn. The GPOS mark and mkmk features are not applied yet. Not yet the stch of
 *                                 the Arabic shaper of HarfBuzz, nor a form enabled by the features option at every glyph
 *                                 like a feature of HarfBuzz enabled by the user.
 *                                 See https://www.microsoft.com/typography/otspec/featuretags.htm
 * @property {Object} [variation] - variation coordinates of the advances, the kerning and the GSUB feature variations
 *                                  (e.g. `{ wght: 700 }`), the current variation of the font if omitted
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
    // automatic fractions (numr, dnom and frac around U+2044 FRACTION SLASH) and the stch of the Arabic shaper
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
 * Helper function that invokes the given callback for each glyph in the given text.
 * The callback gets `(glyph, x, y, fontSize, options)`.
 * @param {string} text - The text to apply.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {GlyphRenderOptions=} options
 * @param  {Function} callback
 */
Font.prototype.forEachGlyph = function(text, x, y, fontSize, options, callback) {
    x = x !== undefined ? x : 0;
    y = y !== undefined ? y : 0;
    fontSize = fontSize !== undefined ? fontSize : 72;
    options = Object.assign({}, this.defaultRenderOptions, options);
    const fontScale = 1 / this.unitsPerEm * fontSize;
    const glyphClusters = this._stringToDirectionalGlyphClusters(text, options);
    const kerningLookupsByScriptRun = new Map();
    // the kerning lookups of a script run, with its script tag that the GPOS table has (see selectScriptTag)
    const getKerningLookups = scriptRun => {
        if (!kerningLookupsByScriptRun.has(scriptRun)) {
            const script = selectScriptTag(this.position, scriptRun.scriptTags);
            kerningLookupsByScriptRun.set(scriptRun, this.position.getKerningTables(script, options.language));
        }
        return kerningLookupsByScriptRun.get(scriptRun);
    };
    // the runs of the glyphs in visual order, and in the order of the text for the pairs of right-to-left text
    const glyphRuns = getShapedGlyphRuns(glyphClusters);
    const reversedGlyphRuns = getShapedGlyphRuns(glyphClusters.slice().reverse());
    for (let i = 0; i < glyphClusters.length; i += 1) {
        const glyph = glyphClusters[i].glyph;
        callback.call(this, glyph, x, y, fontSize, options);
        const advanceWidth = glyph.getAdvanceWidth(this, options.variation);
        if (advanceWidth) {
            x += advanceWidth * fontScale;
        }

        if (options.kerning && i < glyphClusters.length - 1) {
            // We should apply position adjustment lookups in a more generic way.
            // Here we only use the xAdvance value.
            const kerningLookups = getKerningLookups(glyphClusters[i].scriptRun);
            // like HarfBuzz, which shapes each script run and each direction run on its own, a glyph is kerned with the
            // glyphs of its run only. The GPOS pairs are in the order of the text, where the first glyph of a right-to-left pair is its
            // right glyph, and each lookup kerns it with the next glyph of its run it does not ignore; the kern table
            // has no direction, HarfBuzz looks its pairs up in visual order
            const glyphRun = kerningLookups && glyphClusters[i].rightToLeft ?
                reversedGlyphRuns[glyphClusters.length - i - 2] :
                glyphRuns[i];
            const kerningValue = this.position.getGlyphRunKerningValue(kerningLookups, glyphRun.glyphIndexes, glyphRun.position, options.variation);
            x += kerningValue * fontScale;
        }

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
