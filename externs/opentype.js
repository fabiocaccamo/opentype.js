/**
 * @fileoverview Closure Compiler externs for opentype.js version.
 * @see http://opentype.js.org/
 * @externs
 */

/** @const */
var opentype = {};
/**
 * A Font represents a loaded OpenType font file.
 * It contains a set of glyphs and methods to draw text on a drawing context,
 * or to get a path representing the text.
 * @param {FontOptions}
 * @constructor
 */
opentype.Font = function(options) {};

/**
 * Check if the font has a glyph for the given character.
 * @param  {string}
 * @return {Boolean}
 */
opentype.Font.prototype.hasChar = function(c) {};

/**
 * Convert the given character to a single glyph index.
 * Note that this function assumes that there is a one-to-one mapping between
 * the given character and a glyph; for complex scripts this might not be the case.
 * @param  {string}
 * @return {Number}
 */
opentype.Font.prototype.charToGlyphIndex = function(s) {};

/**
 * Convert the given character to a single Glyph object.
 * Note that this function assumes that there is a one-to-one mapping between
 * the given character and a glyph; for complex scripts this might not be the case.
 * @param  {string} c
 * @return {opentype.Glyph}
 */
opentype.Font.prototype.charToGlyph = function(c) {};

/**
 * Convert the given text to a list of Glyph objects.
 * Note that there is no strict one-to-one mapping between characters and
 * glyphs, so the list of returned glyphs can be larger or smaller than the
 * length of the given string.
 * The glyphs are in visual order, like HarfBuzz: the glyphs of an Arabic text in reverse order, the glyphs of a
 * multiple substitution included (e.g. a letter and the mark that ccmp decomposed it into, the mark first).
 * options.features maps feature tags to a boolean or an integer from 0 (e.g. { liga: false, cv01: 2 }), like
 * font-feature-settings and the feature values of HarfBuzz: 0 or false turns a feature off, any other value turns it
 * on (true is 1) and is the alternate index of its alternate substitutions (GSUB lookup type 3), 1 for the first
 * alternate, an index past the alternates of a glyph leaving it unchanged, the 8 lowest bits of the value kept (an
 * Arabic form that the option sets applies at every glyph of an Arabic run, and sets the bit 1 of its form mask in
 * its value (a bitwise OR) at the letters of the form, rtlm the bit 1 of its mask in its value in a run of a
 * right-to-left script, like the masks of HarfBuzz: fina 2 is 3 at a final teh, fina 3 stays 3, fina 256 is 1, and
 * rtlm 2 is 3, rtlm 3 stays 3, rtlm 256 is 1, so 256 turns them off only outside their mask); any other value throws
 * a TypeError. Not yet like HarfBuzz for a lookup of
 * several features (two enabled features, or the required feature and an enabled feature), which takes the value of
 * the first enabled one, where HarfBuzz joins the masks of the features. Like HarfBuzz, rand is on by default with
 * the value 255 (a random alternate, from the random numbers of HarfBuzz from the start of each script run), and the
 * direction features of the script of each run (rtla and rtlm in a run of a right-to-left script such as Arabic or
 * Hebrew, ltra and ltrm in the other runs). Like the Indic shaper of HarfBuzz, nukt is on by default in a run of
 * that shaper (an Indic script whose GSUB script is not DFLT, latn or dev3...), in a stage after ccmp and locl; not
 * yet the reordering and the other features of that shaper.
 * Before the GSUB features, the characters of each script run are normalized like HarfBuzz and mapped to the glyphs
 * of the cmap: a character the font has no glyph for, or a precomposed character followed by marks, is decomposed
 * into the characters of its canonical decomposition the font has (e.g. U+00C0 into A and U+0300, U+2001 into
 * U+2003); the marks are put in the order of the modified combining classes of HarfBuzz (the Arabic shadda before the
 * other harakat, the Arabic modifier combining marks first in an Arabic run); a mark is composed with the base before
 * it into their precomposed character when the font has its glyph and no mark of the same or a higher combining class
 * is between them (e.g. e and U+0301 into U+00E9). Like HarfBuzz, the normalization is the one of the shaper of the
 * run, from its script and the script of GSUB: the Indic, Khmer, Myanmar and USE shapers decompose every character,
 * also when the font has it (e.g. U+09CB into U+09C7 and U+09BE, U+0958 into U+0915 and U+093C, which the nukt of the
 * font composes again with the Indic shaper, U+2001 into U+2003 in a Khmer run), and do not compose the parts of a
 * split vowel sign (U+0BC6 U+0BBE stay apart), the Indic one composes U+09AF U+09BC into U+09DF; the Hangul shaper
 * keeps a syllable the font has before a mark and composes nothing; the Hebrew shaper composes the Hebrew
 * presentation forms (e.g. U+05E9 U+05C1 into U+FB2A) in a font without a mark feature for the run (or with mark 0 or
 * false, not mark 256). The decompositions, compositions and marks are the ones of the Unicode version of the
 * JavaScript engine (String.prototype.normalize, \p{M}), the combining classes the ones of Unicode 16.0.0, the
 * version of HarfBuzz 11.3.2. A character the font has no glyph for nor a decomposition into glyphs of: a space
 * (U+00A0, U+2000 to U+200A, U+202F, U+205F, U+3000, not U+1680) takes the glyph of U+0020, with the advance of its
 * kind of space in opentype.Font.prototype.shape, and U+2011 the glyph of U+2010; the GSUB features then apply to
 * these glyphs. The characters of a base and its marks with a variation selector (U+FE00 to U+FE0F, U+E0100 to
 * U+E01EF) take the glyphs of the cmap, without decompositions nor these fallbacks, but they can still be composed
 * (e.g. e U+0301 U+FE00 into U+00E9), like HarfBuzz: a space or U+2011 the font has not is drawn with .notdef (e.g.
 * U+00A0 U+0301 U+FE00), and a character followed directly by the selector takes the glyph of its variation sequence
 * in cmap 14 before GSUB, the selector consumed in its cluster; a Mongolian free variation selector (U+180B to
 * U+180D) keeps the fallbacks and is never looked up in cmap 14, like HarfBuzz. A lone surrogate is U+FFFD. Like
 * HarfBuzz, the default ignorables (e.g. U+00AD, U+034F, U+200B to U+200F, U+2060, U+FEFF, the variation selectors
 * without a sequence, the tags) keep the glyph of the cmap (.notdef without one) through GSUB, whose lookups skip
 * them when they match the other glyphs of a rule or of a ligature (but U+200C in the input of a rule and in a
 * ligature, and also in the backtrack and the lookahead of the features of the Indic shaper, nukt, akhn, rphf, rkrf,
 * pref, blwf, abvf, half, pstf, vatu, cjct, init, pres, abvs, blws, psts and haln; U+200D in the input of these
 * features, and of ccmp, locl, the Arabic forms, rlig, calt, liga, clig and mset with the Arabic shaper; the hidden
 * ones, U+034F, the Mongolian free variation selectors and the tags, are skipped nowhere by GSUB, but a U+034F that
 * keeps no mark from being reordered), then the ones GSUB did not substitute are hidden with the glyph of U+0020,
 * with an advance of 0 in opentype.Font.prototype.shape, in their own clusters, or removed, their clusters merged
 * within their script run like HarfBuzz, in a font without that glyph or with options.removeDefaultIgnorables. Not
 * yet the decomposition of the Thai sara am, the jamo and syllables of the Hangul shaper of HarfBuzz composed and
 * decomposed by the glyphs of the font, the reorder hook of its Hebrew shaper, the reordering of its Indic, Khmer,
 * Myanmar and USE shapers, the U+25CC DOTTED CIRCLE its Indic and USE shapers insert between an independent vowel and
 * a vowel sign that must not follow it (preprocess_text_vowel_constraints), nor the decomposition of the Khmer split
 * vowel signs into U+17C1 and themselves of its Khmer shaper.
 * @param  {string} s
 * @param  {Object=} options
 * @return {opentype.Glyph[]}
 */
opentype.Font.prototype.stringToGlyphs = function(s, options) {};

/**
 * Convert the given text to the list of glyphs of stringToGlyphs, each one with
 * the UTF-16 range [start, end) of the characters of the text it represents:
 * the glyphs of a ligature and the glyphs between its components share a range,
 * each glyph of a multiple substitution has the range of the glyph it replaces;
 * the characters a character is decomposed into have its range, a base and the
 * mark composed with it share a range, and so does a mark put before other marks
 * with them (see stringToGlyphs); a hidden default ignorable has its own range,
 * a removed one merges its range with a neighbouring glyph of its script run,
 * like HarfBuzz (see stringToGlyphs). The glyphs and the ranges are the ones of
 * opentype.Font.prototype.shape.
 * @param  {string} s
 * @param  {Object=} options
 * @return {Array<{glyph: opentype.Glyph, start: number, end: number}>}
 */
opentype.Font.prototype.stringToGlyphClusters = function(s, options) {};

/**
 * @param  {string}
 * @return {Number}
 */
opentype.Font.prototype.nameToGlyphIndex = function(name) {};

/**
 * @param  {string}
 * @return {opentype.Glyph}
 */
opentype.Font.prototype.nameToGlyph = function(name) {};

/**
 * @param  {Number}
 * @return {String}
 */
opentype.Font.prototype.glyphIndexToName = function(gid) {};

/**
 * Retrieve the value of the kerning pair between the left glyph (or its index)
 * and the right glyph (or its index). If no kerning pair is found, return 0.
 * The kerning value gets added to the advance width when calculating the spacing
 * between glyphs.
 * For GPOS kerning, the values of all the pair adjustment lookups (lookup type 2) of the kern feature of
 * the default language are added up, for the script of the characters the cmap maps to the two glyphs (with
 * the fallbacks of opentype.Position.prototype.getKerningTables); its single adjustments (lookup type 1) and its
 * contextual positionings (lookup types 7 and 8, e.g. a contextual kerning and its exceptions) are in the positions
 * of opentype.Font.prototype.shape only (and so of getAdvanceWidth and forEachGlyph). The script of a glyph is
 * the Unicode script of its characters, none for characters of no script (Common, Inherited or Unknown), and Latin
 * for a glyph shared by characters of several scripts, a character of no script counting as one. The pair takes
 * the first of Thai, Arabic, Hebrew, Cyrillic and Greek that one of its glyphs has, otherwise its first
 * script that is not Latin, otherwise Latin, with the OpenType tag of that script (e.g. thai, cham), or
 * DFLT when neither glyph has a script. The pair is the left glyph then the right glyph:
 * for a GPOS pair of right-to-left text, pass the glyphs in the order of the text. A GPOS lookup whose
 * lookupFlag ignores one of the two glyphs adds nothing (see opentype.Position.prototype.getGlyphRunKerningValue).
 * The kern table is used when the GPOS table has no kern feature for that script, like HarfBuzz, which kerns a
 * glyph with the next glyph that is not a GDEF mark there: a pair whose right glyph is a GDEF mark adds nothing.
 * @param  {opentype.Glyph|number} leftGlyph
 * @param  {opentype.Glyph|number} rightGlyph
 * @param  {Object=} variation - variation coordinates for GPOS kerning, the current font variation if omitted
 * @return {Number}
 */
opentype.Font.prototype.getKerningValue = function(leftGlyph, rightGlyph, variation) {};

/**
 * Shape a text like hb-shape: its glyphs after the GSUB features, in visual order, each one with the UTF-16 range
 * [start, end) of its cluster (see stringToGlyphClusters) and its position in font units after the GPOS features,
 * at the variation of options.variation or of the font: xAdvance, yAdvance (0 in horizontal text), xOffset and
 * yOffset (the y axis going up, like the offsets of hb-shape; a glyph attached by GPOS, e.g. a mark on its base, is
 * drawn from its own pen position at the offset that puts it on its anchor).
 * The text is shaped by script runs (the Unicode Script of its characters, the characters of no script in
 * the run around them, not yet a closing bracket in the run of its opening bracket), each run with the GSUB
 * and GPOS features of its OpenType script, or as one run with the OpenType script options.script (the
 * tag taken literally, e.g. 'deva' or 'dev2'), and with the language system options.language (an OpenType tag
 * such as 'TRK ' or 'TRK'). Like HarfBuzz, which looks each feature up in GSUB and in GPOS, the GPOS features of a
 * run are the default GSUB features of its shaper (rand included) but the Arabic forms, the direction features of
 * the script of the run, the same ones as in GSUB (see stringToGlyphs), and abvm, blwm, curs, dist, kern (with
 * options.kerning), mark and mkmk, with options.features, and the required feature of the GPOS language system (its
 * ReqFeatureIndex) whatever options.features; their lookups apply in lookup list order, to each run in the order of
 * the text, extension lookups included. Like HarfBuzz, the glyph of U+0020 that draws a space the font has not (see
 * stringToGlyphs), and the glyphs the GSUB features replace it with but a ligature, take the advance of its kind of
 * space before GPOS: 1/n em (rounded like HarfBuzz) for U+2000 to U+2006, U+2009, U+200A and U+3000, 4/18 em for
 * U+205F, the advance of the first digit for U+2007, of the period or else of the comma for U+2008, half the advance
 * of the glyph for U+202F, the advance of the glyph for U+00A0. The single adjustments (lookup type 1) are applied
 * with their value record, the pair adjustments (lookup type 2) with their two value records, the cursive
 * attachments (lookup type 3) and the mark attachments (lookup types 4, 5 and 6) with their anchors (with the
 * VariationIndex deltas of a variable font): a mark is drawn on the glyph before it that is not a mark (at the anchor
 * of the ligature component it follows), or on the mark before it of the same glyph, and the offsets of an attached
 * glyph follow the glyph it is attached to; the contextual positionings (lookup types 7 and 8, formats 1, 2 and 3,
 * e.g. the contextual kerning of kern) apply, like HarfBuzz, the lookups of the first rule that matches at a glyph,
 * at its input glyphs, nested up to 64 levels and at most 1024 nested lookups by glyph of a run (16384 at least). Not
 * yet like HarfBuzz: a mark after the second glyph of a multiple substitution attaches to that glyph when the subtable
 * covers it, otherwise to nothing, where HarfBuzz attaches it to the first glyph of the substitution.
 * Without a GPOS kern feature for the script and language, the kern table applies like in HarfBuzz, in visual order,
 * the value of a pair split between its two glyphs, each glyph kerned with the next glyph that is not a GDEF mark;
 * unlike HarfBuzz, which splits the value of a pair in each kern subtable on its own, the values of a pair in
 * several subtables are added up before the split: the positions and the pen are the same, the advances can differ
 * by a few units (up to half the number of subtables with an odd value for the pair). The marks are the ones of the
 * GlyphClassDef of GDEF: without it no glyph is a mark, for the GPOS lookups (but the mark-to-base and
 * mark-to-ligature attachments) and the kern table, unlike HarfBuzz, which then takes the nonspacing marks of
 * Unicode (Mn) as marks, of no mark attachment class. Without it, a mark-to-base or mark-to-ligature lookup with
 * IgnoreMarks, a MarkAttachmentType, or UseMarkFilteringSet and a mark glyph set that does not cover the mark, takes
 * every glyph its subtable covers as a mark and does not apply at it, like HarfBuzz for the glyphs of the nonspacing
 * marks (a contextual rule that applies the lookup at the mark attaches it); not yet like HarfBuzz for the glyph of a spacing character that the subtable covers as a mark (e.g. U+00B4
 * mapped to the glyph of U+0301), a base glyph that HarfBuzz attaches. Like HarfBuzz, the advance of a GDEF mark is
 * set to 0 as the shaper HarfBuzz picks for the run from its script and from the GSUB script it chose for it: after
 * GPOS with its default, Arabic, Hebrew and Thai shapers, before GPOS with its USE and Myanmar shapers, never with
 * its Indic, Khmer and Hangul shapers (an Indic, USE or Myanmar run takes the default shaper when that GSUB script
 * is DFLT or latn, or mymr for Myanmar); without a GPOS table the x offset of a mark of a left-to-right run moves
 * back by the advance it loses. Not yet like HarfBuzz: in a font without a GPOS table (e.g. a font with the kern
 * table only, with or without GDEF), its default, Arabic and Hebrew shapers place each mark over or under its base
 * (its fallback mark positioning), where the mark is drawn at the pen position; the GPOS lookups of the Arabic
 * forms, which HarfBuzz applies at the glyphs of each form only, apply only when options.features enables them, at
 * every glyph; the GPOS feature variations (the FeatureVariations of the GPOS table) are not applied yet, the lookups
 * of a GPOS feature are the ones of its FeatureList record at every variation; nor the GSUB lookups of abvm, blwm,
 * curs, dist, kern (with options.kerning), mark and mkmk, which HarfBuzz looks up in GSUB too.
 * Like HarfBuzz, the default ignorables (see stringToGlyphs) are skipped in the GPOS and kern table pairs, the
 * cursive attachments, the input, the backtrack and the lookahead of the contextual positionings, and when a mark
 * looks for its base or the mark before it, but U+200D in the lookups of mark and mkmk; then their advances and
 * offsets are set to 0 and they are drawn with the glyph of U+0020 in their own clusters, removed without that glyph.
 * With options.removeDefaultIgnorables they are removed and keep their positions until then, like hb-shape
 * --remove-default-ignorables (the offset of a mark attached across one still has its advance).
 * @param  {string} text
 * @param  {Object=} options
 * @return {Array<{glyph: opentype.Glyph, start: number, end: number, xAdvance: number, yAdvance: number, xOffset: number, yOffset: number}>}
 */
opentype.Font.prototype.shape = function(text, options) {};

/**
 * Helper function that invokes the given callback for each glyph in the given text.
 * The callback gets `(glyph, x, y, fontSize, options)`.
 * The glyphs and their positions are the ones of opentype.Font.prototype.shape: x is the pen position plus the
 * x offset of the glyph, y the baseline minus its y offset (the y axis of the callback goes down), both scaled
 * to the font size; the pen moves by the x advance of the glyph and by options.letterSpacing or options.tracking,
 * but after a glyph that hides a default ignorable (see opentype.Font.prototype.stringToGlyphs).
 * @param  {string} text
 * @param  {number} x - Horizontal position of the beginning of the text.
 * @param  {number} y - Vertical position of the *baseline* of the text.
 * @param  {number} fontSize - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {Object} options
 * @param  {Function} callback
 * @return {number} the x of the pen after the last glyph
 */
opentype.Font.prototype.forEachGlyph = function(text, x, y, fontSize, options, callback) {};

/**
 * Create a Path object that represents the given text.
 * @param  {string} text - The text to create.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {Object=} options
 * @return {opentype.Path}
 */
opentype.Font.prototype.getPath = function(text, x, y, fontSize, options) {};

/**
 * Create an array of Path objects that represent the glyps of a given text.
 * @param  {string} text - The text to create.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {Object=} options
 * @return {opentype.Path[]}
 */
opentype.Font.prototype.getPaths = function(text, x, y, fontSize, options) {};

/**
 * Draw the text on the given drawing context.
 * @param  {CanvasRenderingContext2D} ctx - A 2D drawing context, like Canvas.
 * @param  {string} text - The text to create.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {Object=} options
 */
opentype.Font.prototype.draw = function(ctx, text, x, y, fontSize, options) {};

/**
 * Draw the points of all glyphs in the text.
 * On-curve points will be drawn in blue, off-curve points will be drawn in red.
 * @param {CanvasRenderingContext2D} ctx - A 2D drawing context, like Canvas.
 * @param {string} text - The text to create.
 * @param {number} [x=0] - Horizontal position of the beginning of the text.
 * @param {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param {Object=} options
 */
opentype.Font.prototype.drawPoints = function(ctx, text, x, y, fontSize, options) {};

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
 * @param {Object=} options
 */
opentype.Font.prototype.drawMetrics = function(ctx, text, x, y, fontSize, options) {};

/**
 * @param  {string}
 * @return {string}
 */
opentype.Font.prototype.getEnglishName = function(name) {};

/**
 * @typedef {{
        fontFamily: Object<string,string>,
        fontSubfamily: Object<string,string>,
        fullName: Object<string,string>,
        // postScriptName may not contain any whitespace
        postScriptName: Object<string,string>,
        designer: Object<string,string>,
        designerURL: Object<string,string>,
        manufacturer: Object<string,string>,
        manufacturerURL: Object<string,string>,
        license: Object<string,string>,
        licenseURL: Object<string,string>,
        version: Object<string,string>,
        description: Object<string,string>,
        copyright: Object<string,string>,
        trademark: Object<string,string>
    };}
 */
var NamePlatform;

/**
 * @type {{unicode: ?NamePlatform, macintosh: ?NamePlatform, windows: ?NamePlatform}}
 */
opentype.Font.prototype.names = {};

/**
 * Validate
 */
opentype.Font.prototype.validate = function() {};

/**
 * Convert the font object to a SFNT data structure.
 * This structure contains all the necessary tables and metadata to create a binary OTF file.
 * @return {opentype.Table}
 */
opentype.Font.prototype.toTables = function() {};
/**
 * @deprecated Font.toBuffer is deprecated. Use Font.toArrayBuffer instead.
 */
opentype.Font.prototype.toBuffer = function() {};
/**
 * Converts a `opentype.Font` into an `ArrayBuffer`
 * @return {ArrayBuffer}
 */
opentype.Font.prototype.toArrayBuffer = function() {};

/**
 * Initiate a download of the OpenType font.
 * @param {string=} fileName
 */
opentype.Font.prototype.download = function(fileName) {};

// A Glyph is an individual mark that often corresponds to a character.
// Some glyphs, such as ligatures, are a combination of many characters.
// Glyphs are the basic building blocks of a font.
//
// The `Glyph` class contains utility methods for drawing the path and its points.
/**
 * @param {GlyphOptions}
 * @constructor
 */
opentype.Glyph = function(options) {};

/**
 * @param {number}
 */
opentype.Glyph.prototype.addUnicode = function(unicode) {};

/**
 * Calculate the minimum bounding box for this glyph.
 * @return {opentype.BoundingBox}
 */
opentype.Glyph.prototype.getBoundingBox = function() {};

/**
 * Convert the glyph to a Path we can draw on a drawing context.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {Object=} options - xScale, yScale to strech the glyph.
 * @return {opentype.Path}
 */
opentype.Glyph.prototype.getPath = function(x, y, fontSize, options) {};

/**
 * Split the glyph into contours.
 * This function is here for backwards compatibility, and to
 * provide raw access to the TrueType glyph outlines.
 * @return {Array}
 */
opentype.Glyph.prototype.getContours = function() {};

/**
 * Calculate the xMin/yMin/xMax/yMax/lsb/rsb for a Glyph.
 * @return {Object}
 */
opentype.Glyph.prototype.getMetrics = function() {};

/**
 * Draw the glyph on the given context.
 * @param  {CanvasRenderingContext2D} ctx - A 2D drawing context, like Canvas.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 * @param  {Object=} options - xScale, yScale to strech the glyph.
 */
opentype.Glyph.prototype.draw = function(ctx, x, y, fontSize, options) {};

/**
 * Draw the points of the glyph.
 * On-curve points will be drawn in blue, off-curve points will be drawn in red.
 * @param  {CanvasRenderingContext2D} ctx - A 2D drawing context, like Canvas.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 */
opentype.Glyph.prototype.drawPoints = function(ctx, x, y, fontSize) {};

/**
 * Draw lines indicating important font measurements.
 * Black lines indicate the origin of the coordinate system (point 0,0).
 * Blue lines indicate the glyph bounding box.
 * Green line indicates the advance width of the glyph.
 * @param  {CanvasRenderingContext2D} ctx - A 2D drawing context, like Canvas.
 * @param  {number} [x=0] - Horizontal position of the beginning of the text.
 * @param  {number} [y=0] - Vertical position of the *baseline* of the text.
 * @param  {number} [fontSize=72] - Font size in pixels. We scale the glyph units by `1 / unitsPerEm * fontSize`.
 */
opentype.Glyph.prototype.drawMetrics = function(ctx, x, y, fontSize) {};

/**
 * A bézier path containing a set of path commands similar to a SVG path.
 * Paths can be drawn on a context using `draw`.
 * @constructor
 */
opentype.Path = function() {};

/**
 * @param  {number} x
 * @param  {number} y
 */
opentype.Path.prototype.moveTo = function(x, y) {};

/**
 * @param  {number} x
 * @param  {number} y
 */
opentype.Path.prototype.lineTo = function(x, y) {};

/**
 * Draws cubic curve
 * @param  {number} x1 - x of control 1
 * @param  {number} y1 - y of control 1
 * @param  {number} x2 - x of control 2
 * @param  {number} y2 - y of control 2
 * @param  {number} x - x of path point
 * @param  {number} y - y of path point
 */
opentype.Path.prototype.curveTo = function(x1, y1, x2, y2, x, y) {};

/**
 * Draws cubic curve
 * @param  {number} x1 - x of control 1
 * @param  {number} y1 - y of control 1
 * @param  {number} x2 - x of control 2
 * @param  {number} y2 - y of control 2
 * @param  {number} x - x of path point
 * @param  {number} y - y of path point
 */
opentype.Path.prototype.bezierCurveTo = function(x1, y1, x2, y2, x, y) {};

/**
 * Draws quadratic curve
 * @param  {number} x1 - x of control
 * @param  {number} y1 - y of control
 * @param  {number} x - x of path point
 * @param  {number} y - y of path point
 */
opentype.Path.prototype.quadTo = function(x1, y1, x, y) {};

/**
 * Draws quadratic curve
 * @param  {number} x1 - x of control
 * @param  {number} y1 - y of control
 * @param  {number} x - x of path point
 * @param  {number} y - y of path point
 */
opentype.Path.prototype.quadraticCurveTo = function(x1, y1, x, y) {};

/**
 * Close the path
 */
opentype.Path.prototype.close = function() {};

/**
 * Closes the path
 */
opentype.Path.prototype.closePath = function() {};

/**
 * Add the given path or list of commands to the commands of this path.
 * @param  {Array} pathOrCommands - another opentype.Path, an opentype.BoundingBox, or an array of commands.
 */
opentype.Path.prototype.extend = function(pathOrCommands) {};

/**
 * Calculate the bounding box of the path.
 * @returns {opentype.BoundingBox}
 */
opentype.Path.prototype.getBoundingBox = function() {};

/**
 * @param {CanvasRenderingContext2D} ctx - A 2D drawing context.
 */
opentype.Path.prototype.draw = function(ctx) {};

/**
 * @param  {number} [decimalPlaces=2] - The amount of decimal places for floating-point values
 * @return {string}
 */
opentype.Path.prototype.toPathData = function(decimalPlaces) {};

/**
 * @param  {number} [decimalPlaces=2] - The amount of decimal places for floating-point values
 * @return {string}
 */
opentype.Path.prototype.toSVG = function(decimalPlaces) {};

/**
 * Convert the path to a DOM element.
 * @param  {number} [decimalPlaces=2] - The amount of decimal places for floating-point values
 * @return {SVGPathElement}
 */
opentype.Path.prototype.toDOMElement = function(decimalPlaces) {};

/**
 * @constructor
 */
opentype.Layout = function(font, tableName) {};

/**
 * Binary search an object by "tag" property
 * @param  {Array} arr
 * @param  {string} tag
 * @return {number}
 */
opentype.Layout.prototype.searchTag = function(arr, tag) {};

/**
 * Binary search in a list of numbers
 * @param  {Array} arr
 * @param  {number} value
 * @return {number}
 */
opentype.Layout.prototype.binSearch = function (arr, value) {};

/**
 * Get or create the Layout table (GSUB, GPOS etc).
 * @param  {boolean} create - Whether to create a new one.
 * @return {Object} The GSUB or GPOS table.
 */
opentype.Layout.prototype.getTable = function(create) {};

/**
 * Returns all scripts in the substitution table.
 * @instance
 * @return {Array}
 */
opentype.Layout.prototype.getScriptNames = function() {};

/**
 * Returns all LangSysRecords in the given script.
 * A script the table has not falls back, like HarfBuzz, to the first of DFLT, dflt and latn that
 * the table has, unless the script table is created.
 * @instance
 * @param {string} script - Use 'DFLT' for default script
 * @param {boolean} create - forces the creation of this script table if it doesn't exist.
 * @return {Array} Array on names
 */
opentype.Layout.prototype.getScriptTable = function(script, create) {};

/**
 * Returns a language system table.
 * A language the script has not falls back to the default language system of the script
 * (see getScriptTable for a script the table has not), unless the language system is created.
 * Like HarfBuzz, the default language system is the LangSysRecord tagged dflt if the script has one,
 * otherwise the DefaultLangSys, also with create (the writers add to the language system the readers use).
 * A language tag of three letters is the tag with its trailing space ('TRK' is 'TRK ').
 * @instance
 * @param {string} script - Use 'DFLT' for default script
 * @param {string} language - Use 'dlft' for default language
 * @param {boolean} create - forces the creation of this langSysTable if it doesn't exist.
 * @return {Object} An object with tag and script properties.
 */
opentype.Layout.prototype.getLangSysTable = function(script, language, create) {};

/**
 * Get a specific feature table.
 * A script or a language the table has not falls back like in getScriptTable and getLangSysTable,
 * unless the feature table is created.
 * @instance
 * @param {string} script - Use 'DFLT' for default script
 * @param {string} language - Use 'dlft' for default language
 * @param {string} feature - One of the codes listed at https://www.microsoft.com/typography/OTSPEC/featurelist.htm
 * @param {boolean} create - forces the creation of the feature table if it doesn't exist.
 * @return {Object}
 */
opentype.Layout.prototype.getFeatureTable = function(script, language, feature, create) {};

/**
 * Get the lookup tables of a given type for a script/language/feature.
 * A script or a language the table has not falls back like in getScriptTable and getLangSysTable,
 * unless the lookup table is created.
 * @instance
 * @param {string} [script='DFLT']
 * @param {string} [language='dlft']
 * @param {string} feature - 4-letter feature code
 * @param {number} lookupType - 1 to 8
 * @param {boolean} create - forces the creation of the lookup table if it doesn't exist, with no subtables.
 * @return {Object[]}
 */
opentype.Layout.prototype.getLookupTables = function(script, language, feature, lookupType, create) {};

/**
 * Returns the list of glyph indexes of a coverage table.
 * Format 1: the list is stored raw
 * Format 2: compact list as range records.
 * @instance
 * @param  {Object} coverageTable
 * @return {Array}
 */
opentype.Layout.prototype.expandCoverage = function(coverageTable) {};

/**
 * @extends opentype.Layout
 * @constructor
 * @param {opentype.Font}
 */
opentype.Position = function(font) {};

/**
 * List the kerning lookup tables (the pair adjustment lookups of the kern feature) of a script and language in
 * LookupList order, the order they apply in, including the pair adjustment subtables wrapped in extension lookups.
 * The contextual positionings of the kern feature (lookup types 7 and 8, e.g. a contextual kerning and its
 * exceptions) are not listed: they are in the positions of opentype.Font.prototype.shape only.
 * A script the GPOS table has not falls back to DFLT, dflt, then latn, and a language the script has not
 * to the default language system of the script (see getScriptTable and getLangSysTable), except hebr:
 * like the Hebrew shaper of HarfBuzz, a GPOS table without the hebr script does not apply to it.
 * @param {string=} script - 'latn' if omitted
 * @param {string=} language - 'dflt' if omitted
 * @return {Array<Object>|undefined} the lookup tables (may be empty), or undefined when the GPOS table has no
 * kern feature for the script and language, or when there is no GPOS table: the kern table applies then
 */
opentype.Position.prototype.getKerningTables = function(script, language) {};

/**
 * Get the xAdvance kerning value of a glyph pair, in the order of the text, in a list of kerning lookup tables:
 * in each lookup the first subtable that applies to the pair gives the value of the lookup, and the values of
 * the lookups add up. A lookup whose lookupFlag ignores one of the two glyphs adds nothing (see
 * getGlyphRunKerningValue). Without lookup tables (undefined, see getKerningTables), the value of the kern table,
 * nothing for a right glyph that is a GDEF mark: like HarfBuzz, the kern table kerns a glyph with the next glyph
 * that is not a GDEF mark.
 * @param {Array<Object>|undefined} kerningLookups - the result of getKerningTables
 * @param {number} leftIndex
 * @param {number} rightIndex
 * @param {Object=} variation - variation coordinates, the current font variation if omitted
 * @return {number}
 */
opentype.Position.prototype.getKerningValue = function(kerningLookups, leftIndex, rightIndex, variation) {};

/**
 * Get the xAdvance kerning value of a glyph of a run of glyphs, in a list of kerning lookup tables: each lookup
 * applies to the run from its first glyph, at each glyph it does not ignore (its lookupFlag and the GDEF classes)
 * kerning it with the next glyph of the run that the lookup does not ignore, e.g. across the marks of a lookup
 * with IgnoreMarks, and the values of the lookups add up: the x advances of the first value record of the pairs
 * of the glyph and of the second value record of the pair it ends (after a pair with a second value record the
 * lookup goes on after its second glyph, like HarfBuzz). Without lookup tables (undefined, see getKerningTables),
 * the value of the kern table pair of the glyph and the next glyph that is not a GDEF mark, like HarfBuzz; a pair of
 * the kern table starts only at the first glyph of the run and at a glyph that is not a GDEF mark, so a GDEF mark
 * after the first glyph gets 0, like HarfBuzz. A position outside the run gets 0.
 * Each call applies the lookups to the run up to the glyph, so its cost grows with the position of the glyph:
 * opentype.Font.prototype.shape positions all the glyphs of a text at once, with the contextual positionings of
 * the kern feature, which are not kerning lookups (see getKerningTables).
 * @param {Array<Object>|undefined} kerningLookups - the result of getKerningTables
 * @param {Array<number>} glyphIndexes - the glyph indexes of the run, in the order of the text
 * @param {number} position - the position of the glyph in the run
 * @param {Object=} variation - variation coordinates, the current font variation if omitted
 * @return {number}
 */
opentype.Position.prototype.getGlyphRunKerningValue = function(kerningLookups, glyphIndexes, position, variation) {};

/**
 * @extends opentype.Layout
 * @constructor
 * @param {opentype.Font}
 */
opentype.Substitution = function(font) {};

/**
 * Create a default GSUB table.
 * @return {Object} gsub - The GSUB table.
 */
opentype.Substitution.prototype.createDefaultTable = function() {};

/**
 * List all single substitutions (lookup type 1) for a given script, language, and feature.
 * A script or a language the table has not falls back like in getScriptTable and getLangSysTable.
 * @param {string} script
 * @param {string} language
 * @param {string} feature - 4-character feature name ('aalt', 'salt', 'ss01'...)
 * @return {Array} substitutions - The list of substitutions.
 */
opentype.Substitution.prototype.getSingle = function(feature, script, language) {};

/**
 * List all alternates (lookup type 3) for a given script, language, and feature.
 * A script or a language the table has not falls back like in getScriptTable and getLangSysTable.
 * @param {string} feature - 4-character feature name ('aalt', 'salt'...)
 * @param {string} script
 * @param {string} language
 * @return {Array} alternates - The list of alternates
 */
opentype.Substitution.prototype.getAlternates = function(feature, script, language) {};

/**
 * List all ligatures (lookup type 4) for a given script, language, and feature.
 * A script or a language the table has not falls back like in getScriptTable and getLangSysTable.
 * The result is an array of ligature objects like { sub: [ids], by: id }
 * @param {string} feature - 4-letter feature name ('liga', 'rlig', 'dlig'...)
 * @param {string} script
 * @param {string} language
 * @return {Array} ligatures - The list of ligatures.
 */
opentype.Substitution.prototype.getLigatures = function(feature, script, language) {};

/**
 * Add or modify a single substitution (lookup type 1)
 * Format 2, more flexible, is always used.
 * @param {string} feature - 4-letter feature name ('liga', 'rlig', 'dlig'...)
 * @param {Object} substitution - { sub: id, delta: number } for format 1 or { sub: id, by: id } for format 2.
 * @param {string} [script='DFLT']
 * @param {string} [language='dflt']
 */
opentype.Substitution.prototype.addSingle = function(feature, substitution, script, language) {};

/**
 * Add or modify an alternate substitution (lookup type 1)
 * @param {string} feature - 4-letter feature name ('liga', 'rlig', 'dlig'...)
 * @param {Object} substitution - { sub: id, by: [ids] }
 * @param {string} [script='DFLT']
 * @param {string} [language='dflt']
 */
opentype.Substitution.prototype.addAlternate = function(feature, substitution, script, language) {};

/**
 * Add a ligature (lookup type 4)
 * Ligatures with more components must be stored ahead of those with fewer components in order to be found
 * @param {string} feature - 4-letter feature name ('liga', 'rlig', 'dlig'...)
 * @param {Object} ligature - { sub: [ids], by: id }
 * @param {string} [script='DFLT']
 * @param {string} [language='dflt']
 */
opentype.Substitution.prototype.addLigature = function(feature, ligature, script, language) {};

/**
 * List all feature data for a given script and language.
 * A script or a language the table has not falls back like in getScriptTable and getLangSysTable.
 * @param {string} feature - 4-letter feature name
 * @param {string} [script='DFLT']
 * @param {string} [language='dflt']
 * @return {[type]} [description]
 * @return {Array} substitutions - The list of substitutions.
 */
opentype.Substitution.prototype.getFeature = function(feature, script, language) {};

/**
 * Add a substitution to a feature for a given script and language.
 * @param {string} feature - 4-letter feature name
 * @param {Object} sub - the substitution to add (an Object like { sub: id or [ids], by: id or [ids] })
 * @param {string} [script='DFLT']
 * @param {string} [language='dflt']
 */
opentype.Substitution.prototype.add = function(feature, sub, script, language) {};

/**
 * @param {string} tableName
 * @param {Array} fields
 * @param {Object} options
 * @constructor
 */
opentype.Table = function(tableName, fields, options) {};

/**
 * Encodes the table and returns an array of bytes
 * @return {Array}
 */
opentype.Table.prototype.encode = function() {};

/**
 * Get the size of the table.
 * @return {number}
 */
opentype.Table.prototype.sizeOf = function() {};

/**
 * @type {string}
 */
opentype.Table.prototype.tableName;

/**
 * @type {Array}
 */
opentype.Table.prototype.fields;

/**
 * @extends {opentype.Table}
 * @param {opentype.Table} coverageTable
 * @constructor
 */
opentype.Coverage = function(coverageTable) {};

/**
 * @extends {opentype.Table}
 * @param {opentype.Table} scriptListTable
 * @constructor
 */
opentype.ScriptList = function(scriptListTable) {};

/**
 * @extends {opentype.Table}
 * @param {opentype.Table} featureListTable
 * @constructor
 */
opentype.FeatureList = function(featureListTable) {};

/**
 * @extends {opentype.Table}
 * @param {opentype.Table} lookupListTable
 * @param {Object} subtableMakers
 * @constructor
 */
opentype.LookupList = function(lookupListTable, subtableMakers) {};

/**
 * @constructor
 */
opentype.BoundingBox = function() {};

/**
 * @param  {string} url - The URL of the font to load.
 * @param  {Function} callback - The callback.
 */
opentype.load = function(url, callback) {};

/**
 * @param  {string} url - The URL of the font to load.
 * @return {opentype.Font}
 */
opentype.loadSync = function(url) {};

/**
 * opt.layoutCache (default true): with false the layout does not cache the lookups of the GSUB and GPOS tables of
 * the font, nor the kerning lookups of Font.getKerningValue, so a change made directly to the objects of these tables
 * applies at the next layout; any value other than a boolean or undefined throws a TypeError. The charstrings of a CFF
 * font and the glyph variations of a gvar table are read from the font data when they are first used.
 * @param  {ArrayBuffer} buffer
 * @param  {Object=} opt
 * @return {opentype.Font}
 */
opentype.parse = function(buffer, opt) {};

/**
 * The bytes of a TrueType or CFF sfnt, WOFF or WOFF2 font file without the tables of tableTags, as a plain sfnt file
 * with every other table byte for byte (decompressed), but DSIG; a font collection, an unknown signature, a truncated
 * file, two tables with the same tag or a WOFF table whose lengths do not match its data throws an Error, a tag that is
 * not a string of 4 printable ASCII characters a TypeError.
 * @param  {ArrayBuffer} buffer
 * @param  {Array<string>} tableTags
 * @return {ArrayBuffer}
 */
opentype.removeTables = function(buffer, tableTags) {};
