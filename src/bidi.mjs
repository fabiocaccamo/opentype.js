/**
 * Infer bidirectional properties for a given text and apply
 * the corresponding layout rules.
 */

import Tokenizer, { getTextCharacters } from './tokenizer.mjs';
import FeatureQuery from './features/featureQuery.mjs';
import {
    getTokenGlyphIndexes,
    getTokenLigatureProperties,
    getTokenLigatedGlyphs,
    getTokenDefaultIgnorableType,
    getFeaturesLookups,
    applyFeatureLookupsToTokens,
    getRequiredFeatureStage,
    REQUIRED_VARIATION_ALTERNATES_TAG
} from './features/applySubstitution.mjs';
import {
    RANDOM_FEATURE_TAG,
    ARABIC_FORM_TAGS,
    isDefaultFeatureEnabled,
    getDirectionFeatureTags
} from './features/featureValues.mjs';
import { getScriptRuns } from './char.mjs';
import {
    getOpenTypeScriptTags, getChosenScriptTag, getHarfBuzzShaper, HarfBuzzShaper, memoizeByScriptTags, selectScriptTag
} from './layout.mjs';
import arabicSentenceCheck from './features/arab/contextCheck/arabicSentence.mjs';
import arabicPresentationForms from './features/arab/arabicPresentationForms.mjs';
import getLatinFeatureStages from './features/latn/latinFeatures.mjs';
import getThaiFeatureStages from './features/thai/thaiFeatures.mjs';

/**
 * Create Bidi. features
 * @param {string} baseDir text base direction. value either 'ltr' or 'rtl'
 */
function Bidi(baseDir) {
    this.baseDir = baseDir || 'ltr';
    this.tokenizer = new Tokenizer();
    this.featuresTags = {};
    // the tokens of the runs laid out from right to left (see reverseArabicSentences)
    this.rightToLeftTokens = new Set();
    // the script runs of the text (see getTokenScriptRuns), and the run of each token
    this.scriptRuns = [];
    this.tokenScriptRuns = new Map();
    // the normalizer of the characters of the script runs (see registerNormalizer), and the characters of the text
    // it gives, the ones of the tokens
    this.normalizer = null;
    this.characters = [];
}

/**
 * Sets Bidi text
 * @param {string} text a text input
 */
Bidi.prototype.setText = function (text) {
    this.text = text;
};

/**
 * Store essential context checks:
 * arabic sentence check for adjusting arabic layout
 */
Bidi.prototype.contextChecks = ({
    arabicSentenceCheck
});

/**
 * Register a context check
 */
function registerContextChecker(checkId) {
    const check = this.contextChecks[`${checkId}Check`];
    return this.tokenizer.registerContextChecker(
        checkId, check.startCheck, check.endCheck
    );
}

/**
 * Perform pre tokenization procedure then
 * tokenize the characters of the text
 */
function tokenizeText() {
    registerContextChecker.call(this, 'arabicSentence');
    return this.tokenizer.tokenizeCharacters(this.characters);
}

/**
 * Reverse arabic sentence layout
 * TODO: check base dir before applying adjustments - priority low
 */
function reverseArabicSentences() {
    const ranges = this.tokenizer.getContextRanges('arabicSentence');
    this.rightToLeftTokens = new Set();
    for(let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        let rangeTokens = this.tokenizer.getRangeTokens(range);
        for (const token of rangeTokens) {
            this.rightToLeftTokens.add(token);
        }
        // silent: reversing a range in place moves no range, the context ranges need no update
        this.tokenizer.replaceRange(
            range.startIndex,
            range.endOffset,
            rangeTokens.reverse(),
            true
        );
    }
}

/**
 * Register the tags of the features of a shaper
 * @param {string} shaper the shaper of the features: arab for the arabic script runs, thai for the thai script runs,
 * indic for the runs of the Indic shaper of HarfBuzz, latn for the other ones (see getScriptRunShaper)
 * @param {Array} tags features tags list
 */
Bidi.prototype.registerFeatures = function (shaper, tags) {
    if (!Object.prototype.hasOwnProperty.call(this.featuresTags, shaper)) {
        this.featuresTags[shaper] = tags;
    } else {
        this.featuresTags[shaper] = this.featuresTags[shaper].concat(tags);
    }
};

/**
 * Apply GSUB features
 * @param {Font} font opentype font instance
 * @param {Array<{script: string, tags: string[]}>} features the feature tags of each shaper (see registerFeatures)
 * @param {Object} [layoutOptions]
 * @param {string} [layoutOptions.script] the OpenType script tag of the whole text, shaped as one script run, the
 * script runs of the Unicode script of the text if omitted (see getCharacterScriptRuns)
 * @param {string} [layoutOptions.language] the OpenType language tag of the features, the default language system
 * of the script if omitted
 * @param {Object} [layoutOptions.variation] the variation coordinates of the GSUB feature variations, the current
 * variation of the font if omitted
 * @param {Object|Array} [layoutOptions.features] the features option (see GlyphRenderOptions.features): the values
 * of the features, the alternate indexes of their alternate substitutions, and the direction features it turns off
 * (see getScriptRunFeatureTags); the defaults when absent (or a features list)
 */
Bidi.prototype.applyFeatures = function (font, features, layoutOptions) {
    if (!font) throw new Error(
        'No valid font was provided to apply features'
    );
    const { script, language, variation } = layoutOptions || {};
    if (!this.query) {
        this.query = new FeatureQuery(font, variation, layoutOptions && layoutOptions.features);
    }
    this.script = script;
    this.language = language;
    for (const feature of features) {
        this.registerFeatures(feature.script, feature.tags);
    }
};

/**
 * Register a state modifier
 * @param {string} modifierId state modifier id
 * @param {function} condition a predicate function that returns true or false
 * @param {function} modifier a modifier function to set token state
 */
Bidi.prototype.registerModifier = function (modifierId, condition, modifier) {
    this.tokenizer.registerModifier(modifierId, condition, modifier);
};

/**
 * Register the normalizer of the text, which maps its characters to their glyphs: the characters of each script run
 * become the characters it gives, each one with its glyph, its spaceFallbackType, its defaultIgnorableType and its
 * cluster, the ones of its token (the glyphIndex state modifier)
 * @param {function} normalizer a function of the characters of a script run, each one with its cluster (see
 * getTextCharacters in tokenizer.mjs), and of the OpenType script tags of the run (see getCharacterScriptRuns), that
 * returns its characters with their glyphs (see normalizeCharacters in normalization.mjs)
 */
Bidi.prototype.registerNormalizer = function (normalizer) {
    this.normalizer = normalizer;
    this.registerModifier('glyphIndex', null, (token, contextParams) => {
        const character = this.characters[contextParams.index];
        token.spaceFallbackType = character.spaceFallbackType;
        token.defaultIgnorableType = character.defaultIgnorableType;
        return character.glyphIndex;
    });
};

/**
 * Check if 'glyphIndex' is registered
 */
function checkGlyphIndexStatus() {
    if (this.tokenizer.registeredModifiers.indexOf('glyphIndex') === -1) {
        throw new Error(
            'glyphIndex modifier is required to apply ' +
            'arabic presentation features.'
        );
    }
}

/**
 * Split the characters of the text into its script runs, each one with its OpenType script tags: like HarfBuzz with the
 * script of a buffer, the whole text is one run with the script option if given, otherwise the runs of its Unicode
 * scripts (see getScriptRuns) take the tags of their script (see getOpenTypeScriptTags)
 * @param {Array<{char: string, cluster: number}>} characters the characters of the text (see getTextCharacters)
 * @returns {Array<{characters: Array<{char: string, cluster: number}>, scriptTags: string[]}>}
 */
function getCharacterScriptRuns(characters) {
    if (this.script) {
        return [{ characters, scriptTags: [this.script] }];
    }
    return getScriptRuns(characters.map(character => character.char)).map(({ start, end, script }) => ({
        characters: characters.slice(start, end),
        scriptTags: getOpenTypeScriptTags(script)
    }));
}

/**
 * Normalize the characters of each script run of the text with the normalizer (see registerNormalizer), like HarfBuzz
 * normalizes the characters of a buffer with its shaper, each run as it is without a normalizer
 * @param {Array<{characters: Array<{char: string, cluster: number}>, scriptTags: string[]}>} runs see
 * getCharacterScriptRuns
 * @returns {Array<{characters: Array<{char: string, cluster: number}>, scriptTags: string[]}>}
 */
function normalizeScriptRuns(runs) {
    if (!this.normalizer) {
        return runs;
    }
    return runs.map(({ characters, scriptTags }) => ({
        characters: this.normalizer(characters, scriptTags),
        scriptTags
    }));
}

/**
 * The tokens of each script run of the text, the tokens of its characters
 * @param {Token[]} tokens the tokens of the characters of the runs, in the order of the runs
 * @param {Array<{characters: Array<{char: string, cluster: number}>, scriptTags: string[]}>} runs see
 * normalizeScriptRuns
 * @returns {Array<{tokens: Token[], scriptTags: string[]}>}
 */
function getTokenScriptRuns(tokens, runs) {
    let start = 0;
    return runs.map(({ characters, scriptTags }) => {
        const end = start + characters.length;
        const run = { tokens: tokens.slice(start, end), scriptTags };
        start = end;
        return run;
    });
}

// the feature of the Indic shaper of HarfBuzz that composes a consonant and a nukta into their glyph, in a stage of its
// own after ccmp and locl (collect_features_indic)
const INDIC_NUKTA_FORMS_TAG = 'nukt';

/**
 * The stages of the features before the features of the Arabic and Indic shapers of HarfBuzz
 * (hb_ot_shape_collect_features, collect_features_arabic and collect_features_indic): rvrn, then the direction
 * features of the run (see getDirectionFeatureTags) and rand (the stage of the stch of the Arabic shaper), then ccmp
 * and locl
 * @param {string[]} directionTags the direction features of the run (see getDirectionFeatureTags)
 * @returns {string[][]}
 */
function getStagesBeforeShaperFeatures(directionTags) {
    return [
        [REQUIRED_VARIATION_ALTERNATES_TAG],
        directionTags.concat([RANDOM_FEATURE_TAG]),
        ['ccmp', 'locl']
    ];
}

/**
 * The enabled features of a run in the stages of its shaper: the enabled features of each stage, then the other
 * enabled features in a last stage
 * @param {string[]} tags the enabled feature tags of the run (see getScriptRunFeatureTags)
 * @param {string[][]} shaperStages the feature tags of each stage of the shaper
 * @returns {string[][]}
 */
function getFeatureStages(tags, shaperStages) {
    const stagedTags = shaperStages.flat();
    return shaperStages
        .map(stageTags => tags.filter(tag => stageTags.includes(tag)))
        .concat([tags.filter(tag => !stagedTags.includes(tag))]);
}

/**
 * The stages of the arabic features after the forms, like collect_features_arabic of HarfBuzz: rlig, then calt in a
 * stage of its own, unless the language system of the run has rclt: calt then applies with the other features
 * (https://github.com/harfbuzz/harfbuzz/issues/1573). HarfBuzz also looks rclt up in GPOS, which has no such feature
 * @param {FeatureQuery} query
 * @param {string} script the script tag of the run in the GSUB table
 * @param {string|undefined} language the language tag of the features
 * @returns {string[][]}
 */
function getArabicStagesAfterForms(query, script, language) {
    if (query.getFeature({ tag: 'rclt', script, language })) {
        return [['rlig']];
    }
    return [['rlig'], ['calt']];
}

/**
 * The stages of the enabled arabic features of the arabic script runs, the stages of the Arabic shaper of HarfBuzz:
 * rvrn, then the direction features and rand, then ccmp and locl, then each presentation form of the letters of a run,
 * then rlig, then calt, then the other features (see getStagesBeforeShaperFeatures and getArabicStagesAfterForms), the
 * lookups of the required feature of the language system in its stage (see getRequiredFeatureStage), at every glyph
 * of a run, merged with the lookups of the stage in lookup list order
 * @param {string} script the script tag of the runs in the GSUB table
 * @param {string[]} tags the enabled feature tags of the runs (see getScriptRunFeatureTags)
 * @param {string[]} directionTags the direction features of the runs (see getDirectionFeatureTags)
 * @returns {FeatureStage[]}
 */
function getArabicFeatureStages(script, tags, directionTags) {
    const stagesBeforeForms = getStagesBeforeShaperFeatures(directionTags);
    const formStages = ARABIC_FORM_TAGS.map(tag => [tag]);
    const shaperStages = stagesBeforeForms.concat(formStages, getArabicStagesAfterForms(this.query, script, this.language));
    const stages = getFeatureStages(tags, shaperStages);
    const firstFormStage = stagesBeforeForms.length;
    const requiredFeatureStage = getRequiredFeatureStage(stages, this.query.getRequiredFeature(script, this.language));
    const featureStages = [];
    for (let i = 0; i < stages.length; i++) {
        const isFormStage = i >= firstFormStage && i < firstFormStage + formStages.length;
        const withRequiredFeature = i === requiredFeatureStage;
        if (!isFormStage) {
            featureStages.push({ lookups: getFeaturesLookups(this.query, stages[i], script, this.language, withRequiredFeature) });
        } else if (stages[i].length) {
            // the required feature is in the stage of a form only when the form is enabled (see getRequiredFeatureStage)
            const formTag = stages[i][0];
            featureStages.push({
                lookups: getFeaturesLookups(this.query, [formTag], script, this.language, withRequiredFeature),
                formTag
            });
        }
    }
    return featureStages;
}

/**
 * The stages of the enabled indic features of the script runs of the Indic shaper of HarfBuzz, its stages: rvrn, then
 * the direction features and rand, then ccmp and locl (see getStagesBeforeShaperFeatures), then nukt, then the other
 * features, the lookups of the required feature of the language system in its stage (see getRequiredFeatureStage).
 * Not yet the reordering and the other features of the Indic shaper.
 * @param {string} script the script tag of the runs in the GSUB table
 * @param {string[]} tags the enabled feature tags of the runs (see getScriptRunFeatureTags)
 * @param {string[]} directionTags the direction features of the runs (see getDirectionFeatureTags)
 * @returns {FeatureStage[]}
 */
function getIndicFeatureStages(script, tags, directionTags) {
    const shaperStages = getStagesBeforeShaperFeatures(directionTags).concat([[INDIC_NUKTA_FORMS_TAG]]);
    const stages = getFeatureStages(tags, shaperStages);
    const requiredFeatureStage = getRequiredFeatureStage(stages, this.query.getRequiredFeature(script, this.language));
    return stages.map((stageTags, stageIndex) => ({
        lookups: getFeaturesLookups(this.query, stageTags, script, this.language, stageIndex === requiredFeatureStage)
    }));
}

/**
 * The shaper of the features of a script run, the key of its features in featuresTags, like HarfBuzz chooses its
 * shaper from the script of a buffer and the script it chose in GSUB: arab for the arab script tag, thai for the thai
 * script tag, indic for a run of the Indic shaper of HarfBuzz (see getHarfBuzzShaper in layout.mjs), latn for the
 * other script tags and for a text of no script
 * @param {string[]} scriptTags the OpenType script tags of the run (see getTokenScriptRuns)
 * @param {string|undefined} gsubScriptTag the script HarfBuzz chose in GSUB (see getChosenScriptTag in layout.mjs)
 * @returns {string}
 */
function getScriptRunShaper(scriptTags, gsubScriptTag) {
    if (scriptTags.includes('arab')) {
        return 'arab';
    }
    if (scriptTags.includes('thai')) {
        return 'thai';
    }
    if (getHarfBuzzShaper(scriptTags, gsubScriptTag) === HarfBuzzShaper.INDIC) {
        return 'indic';
    }
    return 'latn';
}

/**
 * The enabled features of a script run: the features of its shaper, then the direction features of the run that
 * HarfBuzz enables by default, unless the features option turns them off (see isDefaultFeatureEnabled)
 * @param {string} shaper see getScriptRunShaper
 * @param {string[]} directionTags the direction features of the run (see getDirectionFeatureTags)
 * @returns {string[]}
 */
function getScriptRunFeatureTags(shaper, directionTags) {
    const tags = this.featuresTags[shaper];
    const enabledDirectionTags = directionTags.filter(
        tag => !tags.includes(tag) && isDefaultFeatureEnabled(this.query.featuresOption, tag)
    );
    return tags.concat(enabledDirectionTags);
}

/**
 * The features of the script runs of the same script tags: the shaper of their features (see getScriptRunShaper), the
 * script tag of the runs that the GSUB table has (see selectScriptTag), and their direction features, the ones of the
 * direction of their script like the direction of a buffer of HarfBuzz (see getDirectionFeatureTags)
 * @param {string[]} scriptTags the OpenType script tags of the runs
 * @returns {{shaper: string, script: string, directionTags: string[]}}
 */
function getScriptRunFeatures(scriptTags) {
    return {
        shaper: getScriptRunShaper(scriptTags, getChosenScriptTag(this.query.font.substitution, scriptTags)),
        script: selectScriptTag(this.query.font.substitution, scriptTags),
        directionTags: getDirectionFeatureTags(scriptTags)
    };
}

/**
 * The stages of the enabled features of the script runs of a shaper (see getScriptRunFeatureTags), the stages of the
 * shaper of HarfBuzz (see FeatureStage in applySubstitution.mjs), computed while the query shapes one of these runs
 * (see FeatureQuery.startScriptRun)
 * @param {{shaper: string, script: string, directionTags: string[]}} runFeatures see getScriptRunFeatures
 * @returns {FeatureStage[]}
 */
function getScriptRunFeatureStages(runFeatures) {
    const { shaper, script, directionTags } = runFeatures;
    const tags = getScriptRunFeatureTags.call(this, shaper, directionTags);
    switch (shaper) {
        case 'arab':
            return getArabicFeatureStages.call(this, script, tags, directionTags);
        case 'thai':
            return getThaiFeatureStages.call(this, script, tags);
        case 'indic':
            return getIndicFeatureStages.call(this, script, tags, directionTags);
        default:
            return getLatinFeatureStages.call(this, script, tags);
    }
}

/**
 * Apply the enabled features of its shaper and of its direction to a script run (see getScriptRunFeatures), stage
 * after stage (see getScriptRunFeatureStages), the lookups of an arabic form starting at the letters of the form (see
 * arabicPresentationForms). Like a buffer of HarfBuzz, the run starts with the initial random state and has a maximum
 * number of glyphs of its own (see FeatureQuery.startScriptRun).
 * @param {{tokens: Token[], scriptTags: string[]}} run
 * @param {function(string[]): Object} getRunFeatures the features of the script tags of a run (see
 * getScriptRunFeatures)
 * @param {function(string[]): FeatureStage[]} getRunFeatureStages the stages of the features of the script tags of a
 * run (see getScriptRunFeatureStages)
 */
function applyScriptRunFeatures(run, getRunFeatures, getRunFeatureStages) {
    // a text without registered features is not shaped, and a font without a GSUB table has no lookup to apply (the
    // Layout methods create the table when a lookup is added)
    if (!Object.keys(this.featuresTags).length || !this.query.font.tables.gsub) {
        return;
    }
    const runFeatures = getRunFeatures(run.scriptTags);
    // a shaper with no registered features is skipped, an empty list of features still applies the required feature
    if (!this.featuresTags[runFeatures.shaper]) {
        return;
    }
    checkGlyphIndexStatus.call(this);
    this.query.startScriptRun(runFeatures.directionTags, run.tokens.length, runFeatures.shaper);
    for (const stage of getRunFeatureStages(run.scriptTags)) {
        if (stage.formTag) {
            arabicPresentationForms(this.query, run.tokens, stage.formTag, stage.lookups);
        } else {
            applyFeatureLookupsToTokens(this.query, stage.lookups, run.tokens);
        }
    }
}

/**
 * Check if a context is registered
 * @param {string} contextId context id
 */
Bidi.prototype.checkContextReady = function (contextId) {
    return !!this.tokenizer.getContext(contextId);
};

/**
 * Apply the features to the script runs of the text, each run on its own like HarfBuzz, then lay the arabic sentences
 * out from right to left. The features of the runs of the same script tags and their stages are computed once, like
 * the shape plan of HarfBuzz.
 */
Bidi.prototype.applyFeaturesToContexts = function () {
    const getRunFeatures = memoizeByScriptTags(scriptTags => getScriptRunFeatures.call(this, scriptTags));
    const getRunFeatureStages = memoizeByScriptTags(scriptTags =>
        getScriptRunFeatureStages.call(this, getRunFeatures(scriptTags))
    );
    for (const run of this.scriptRuns) {
        applyScriptRunFeatures.call(this, run, getRunFeatures, getRunFeatureStages);
    }
    if (this.checkContextReady('arabicSentence')) {
        reverseArabicSentences.call(this);
    }
};

/**
 * process text input: split it into its script runs, normalize their characters (see registerNormalizer), then
 * tokenize them and apply the features
 * @param {string} text an input text
 */
Bidi.prototype.processText = function(text) {
    if (!this.text || this.text !== text) {
        this.setText(text);
        const runs = normalizeScriptRuns.call(this, getCharacterScriptRuns.call(this, getTextCharacters(text)));
        this.characters = runs.flatMap(run => run.characters);
        tokenizeText.call(this);
        this.scriptRuns = getTokenScriptRuns(this.tokenizer.tokens, runs);
        this.tokenScriptRuns = new Map();
        for (const run of this.scriptRuns) {
            for (const token of run.tokens) {
                this.tokenScriptRuns.set(token, run);
            }
        }
        this.applyFeaturesToContexts();
    }
};

/**
 * Process a string of text to identify and adjust
 * bidirectional text entities.
 * @param {string} text input text
 */
Bidi.prototype.getBidiText = function (text) {
    this.processText(text);
    return this.tokenizer.getText();
};

/**
 * The glyphs of a token that is not deleted in visual order, each one with its ligature properties (see
 * getTokenLigatureProperties) and whether it is ligated (see getTokenLigatedGlyphs): the order of its multiple
 * substitution, reversed for a token of a right-to-left run, whose tokens reverseArabicSentences reverses, like
 * HarfBuzz reverses the glyphs of a right-to-left run
 * @param {Token} token
 * @returns {Array<{index: number, ligatureProperties: LigatureProperties|undefined, isLigated: boolean}>}
 */
function getTokenVisualGlyphs(token) {
    const ligatureProperties = getTokenLigatureProperties(token);
    const ligatedGlyphs = getTokenLigatedGlyphs(token);
    const glyphs = getTokenGlyphIndexes(token).map((index, positionInToken) => ({
        index,
        ligatureProperties: ligatureProperties[positionInToken],
        isLigated: ligatedGlyphs[positionInToken] === true
    }));
    return this.rightToLeftTokens.has(token) ? glyphs.reverse() : glyphs;
}

/**
 * The UTF-16 range of the characters of each cluster of a text, like the monotone clusters of HarfBuzz: a cluster
 * starts at its value, the UTF-16 offset of its first character, and ends where the next cluster of the text starts,
 * so the characters of no glyph (e.g. ligature components) belong to the cluster before them in the text, and the
 * characters before the first cluster to the first cluster
 * @param {number[]} clusters the clusters of the glyphs of the text, in any order
 * @param {number} textLength
 * @returns {Map<number, {start: number, end: number}>} the range of each cluster
 */
function getClusterRanges(clusters, textLength) {
    const clusterStarts = Array.from(new Set(clusters)).sort((startA, startB) => startA - startB);
    return new Map(clusterStarts.map((start, index) => [start, {
        start: index === 0 ? 0 : start,
        end: index + 1 < clusterStarts.length ? clusterStarts[index + 1] : textLength
    }]));
}

/**
 * Get each glyph of the text, with the range of the characters it represents (its cluster), like the
 * monotone clusters of HarfBuzz (see getClusterRanges): the characters of the deleted tokens (e.g. ligature
 * components, variation selectors of a variation sequence of the cmap) belong to the cluster before them in the text
 * (the first cluster for the ones before it). The glyphs of a multiple substitution have the cluster of their token, a
 * ligature merges the clusters of its components and of the glyphs between them.
 * @param {string} text an input text
 * @returns {Array<{index: number, cluster: number, start: number, end: number, rightToLeft: boolean, scriptRun: Object,
 * ligatureProperties: LigatureProperties|undefined, isLigated: boolean, spaceFallbackType: number|undefined,
 * defaultIgnorableType: number}>} glyph indexes in visual order, each glyph of a multiple substitution its own and none
 * for a deleted token (see getTokenVisualGlyphs), with the cluster of their token
 * and the UTF-16 range [start, end) of its characters in the text, whether their run is laid out from right to left
 * (the arabic sentences, in reverse order of the text), the script run of their token, with its OpenType script tags
 * (scriptRun.scriptTags, see getTokenScriptRuns), the ligature properties of the glyph (see
 * getTokenLigatureProperties), whether it is ligated (see getTokenLigatedGlyphs), the spaceFallbackType of its token,
 * which the glyphIndex modifier sets (see registerNormalizer), and whether it is the glyph of a default ignorable (see
 * getTokenDefaultIgnorableType), which Font.shape hides
 */
Bidi.prototype.getTextGlyphClusters = function (text) {
    this.processText(text);
    const glyphTokens = this.tokenizer.tokens.filter(token => !token.state.deleted);
    const clusterRanges = getClusterRanges(glyphTokens.map(token => token.cluster), text.length);
    const clusters = [];
    for (const token of glyphTokens) {
        const cluster = token.cluster;
        const { start, end } = clusterRanges.get(cluster);
        const rightToLeft = this.rightToLeftTokens.has(token);
        const scriptRun = this.tokenScriptRuns.get(token);
        const defaultIgnorableType = getTokenDefaultIgnorableType(token);
        for (const { index, ligatureProperties, isLigated } of getTokenVisualGlyphs.call(this, token)) {
            clusters.push({
                index,
                cluster,
                start,
                end,
                rightToLeft,
                scriptRun,
                ligatureProperties,
                isLigated,
                spaceFallbackType: token.spaceFallbackType,
                defaultIgnorableType
            });
        }
    }
    return clusters;
};

export default Bidi;
export { getScriptRunShaper, getClusterRanges };
