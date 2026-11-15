import { ContextParams } from '../tokenizer.mjs';
import { DEFAULT_IGNORABLE_TYPES } from '../char.mjs';
import { SubstitutionAction, getSubstitutionGlyphEdits } from './featureQuery.mjs';
import { getLookupJoinerFlags } from './featureValues.mjs';
import {
    getLayoutGdefTable, getGdefGlyphClass, getLigatureId, getLigatureComponent, BASE_GLYPH_CLASS, LIGATURE_GLYPH_CLASS,
    MARK_GLYPH_CLASS, getCachedLayoutValue, createIgnorableMatching, AUTO_JOINER_FLAGS, getSubtablesFirstGlyphCoverages,
    getSubtablesFirstGlyphDigest, mayGlyphDigestHave, createLookupFirstGlyphFilter, getLookupFilterGlyphDigest,
    getLookupTableSubtables
} from '../layout.mjs';

/**
 * The glyph indexes of a token that is not deleted: its glyph, or the glyphs of the multiple substitutions that replaced it
 * @param {Token} token
 * @returns {number[]}
 */
function getTokenGlyphIndexes(token) {
    const value = token.activeState.value;
    return Array.isArray(value) ? value : [value];
}

/**
 * The ligature properties of each glyph of a token (see LigatureProperties in layout.mjs), in the order of its glyphs
 * (see getTokenGlyphIndexes), which the ligature substitutions set and replaceGlyph keeps with the glyphs
 * @param {Token} token
 * @returns {Array<LigatureProperties|undefined>}
 */
function getTokenLigatureProperties(token) {
    return token.ligatureProperties || [];
}

/**
 * Whether each glyph of a token is ligated, in the order of its glyphs (see getTokenGlyphIndexes), like the LIGATED
 * glyph property of HarfBuzz (_hb_glyph_info_ligated): the glyph of a ligature substitution of two components or more,
 * whatever their glyph classes, and the glyphs that later substitutions replace it with, which ligatureSubstitutionFormat1
 * sets and replaceGlyph keeps with the glyphs
 * @param {Token} token
 * @returns {boolean[]} empty when no glyph of the token is ligated
 */
function getTokenLigatedGlyphs(token) {
    return token.ligatedGlyphs || [];
}

/**
 * The kind of default ignorable of the glyph of a token (see DEFAULT_IGNORABLE_TYPES in char.mjs), like
 * _hb_glyph_info_is_default_ignorable of HarfBuzz: the one of its character (see Bidi.registerNormalizer), until a
 * substitution replaces its glyph
 * @param {Token} token
 * @returns {number}
 */
function getTokenDefaultIgnorableType(token) {
    if (token.isSubstituted || !token.defaultIgnorableType) {
        return DEFAULT_IGNORABLE_TYPES.NOT_IGNORABLE;
    }
    return token.defaultIgnorableType;
}

/**
 * The glyphs of a list of tokens, like the glyph buffer of HarfBuzz: each glyph of a multiple substitution
 * is a glyph of its own, a deleted token has none. applySubstitution updates the sequence with its tokens.
 * @typedef GlyphSequence
 * @type Object
 * @property {number[]} glyphIndexes glyph indexes, in the order of the tokens
 * @property {Token[]} glyphTokens the token of each glyph
 * @property {number[]} ignorableTypes the kind of default ignorable of each glyph (see getTokenDefaultIgnorableType)
 * @property {Object|undefined} gdef the GDEF table of the layout, whose glyph classes the ligature substitutions read
 * @property {Map<Token, Object>} savedTokenStates the state of each token the substitutions changed, as it was before
 * the first change (see saveTokenState and restoreTokenStates)
 */

/**
 * Get the glyph sequence of a list of tokens
 * @param {Token[]} tokens
 * @param {Object} [gdef] the GDEF table of the layout (see getLayoutGdefTable)
 * @returns {GlyphSequence}
 */
function getGlyphSequence(tokens, gdef) {
    const glyphSequence = { glyphIndexes: [], glyphTokens: [], ignorableTypes: [], gdef, savedTokenStates: new Map() };
    for (const token of tokens) {
        if (token.state.deleted) {
            continue;
        }
        const ignorableType = getTokenDefaultIgnorableType(token);
        for (const glyphIndex of getTokenGlyphIndexes(token)) {
            glyphSequence.glyphIndexes.push(glyphIndex);
            glyphSequence.glyphTokens.push(token);
            glyphSequence.ignorableTypes.push(ignorableType);
        }
    }
    return glyphSequence;
}

/**
 * Save the state of a token of a glyph sequence before a substitution changes it, once: its glyphs (see
 * getTokenGlyphIndexes), its ligature properties, its ligated glyphs, its cluster and whether it is substituted
 * @param {GlyphSequence} glyphSequence
 * @param {Token} token
 */
function saveTokenState(glyphSequence, token) {
    if (glyphSequence.savedTokenStates.has(token)) {
        return;
    }
    glyphSequence.savedTokenStates.set(token, {
        state: Object.assign({}, token.state),
        activeState: token.activeState,
        ligatureProperties: token.ligatureProperties && token.ligatureProperties.slice(),
        ligatedGlyphs: token.ligatedGlyphs && token.ligatedGlyphs.slice(),
        cluster: token.cluster,
        isSubstituted: token.isSubstituted
    });
}

/**
 * Give the tokens of a glyph sequence back the state they had before the substitutions (see saveTokenState)
 * @param {GlyphSequence} glyphSequence
 */
function restoreTokenStates(glyphSequence) {
    for (const [token, savedState] of glyphSequence.savedTokenStates) {
        Object.assign(token, savedState);
    }
}

/**
 * The position of a glyph of a glyph sequence among the glyphs of its token
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number}
 */
function getPositionInToken(glyphSequence, position) {
    const token = glyphSequence.glyphTokens[position];
    let tokenFirstPosition = position;
    while (tokenFirstPosition > 0 && glyphSequence.glyphTokens[tokenFirstPosition - 1] === token) {
        tokenFirstPosition--;
    }
    return position - tokenFirstPosition;
}

/**
 * The ligature properties of a glyph of a glyph sequence (see getTokenLigatureProperties)
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {LigatureProperties|undefined}
 */
function getGlyphLigatureProperties(glyphSequence, position) {
    return getTokenLigatureProperties(glyphSequence.glyphTokens[position])[getPositionInToken(glyphSequence, position)];
}

/**
 * Set the ligature properties of a glyph of a glyph sequence in its token (see getTokenLigatureProperties)
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @param {LigatureProperties} ligatureProperties
 */
function setGlyphLigatureProperties(glyphSequence, position, ligatureProperties) {
    const token = glyphSequence.glyphTokens[position];
    saveTokenState(glyphSequence, token);
    if (!token.ligatureProperties) {
        token.ligatureProperties = getTokenGlyphIndexes(token).map(() => undefined);
    }
    token.ligatureProperties[getPositionInToken(glyphSequence, position)] = ligatureProperties;
}

/**
 * The ligature properties of the glyphs that replace a glyph, like the lig_props of HarfBuzz: each one keeps the
 * properties of the glyph, but the glyphs of a multiple substitution (two or more glyphs) of a glyph of no ligature
 * are numbered as the components of no ligature (Sequence::apply, _hb_glyph_info_set_lig_props_for_component), the
 * component a later ligature that skips one of them gives it (see getFollowingGlyphLigatureProperties)
 * @param {LigatureProperties|undefined} ligatureProperties the ligature properties of the glyph
 * @param {number} glyphCount the number of glyphs that replace it
 * @returns {Array<LigatureProperties|undefined>}
 */
function getReplacementLigatureProperties(ligatureProperties, glyphCount) {
    if (glyphCount < 2 || getLigatureId(ligatureProperties)) {
        return Array(glyphCount).fill(ligatureProperties);
    }
    const componentProperties = [undefined];
    for (let i = 1; i < glyphCount; i++) {
        componentProperties.push({ ligatureId: undefined, ligatureComponent: i });
    }
    return componentProperties;
}

/**
 * Replace the glyph at a position of a glyph sequence with a sequence of glyphs, in the glyph sequence and in its token:
 * the token holds one glyph, several glyphs, or none and is deleted. The glyphs that replace it take their ligature
 * properties from it (see getReplacementLigatureProperties) and whether it is ligated (see getTokenLigatedGlyphs); like
 * the glyphs HarfBuzz substitutes, they are not default ignorables (see getTokenDefaultIgnorableType).
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @param {number[]} glyphIndexes the glyphs that replace the glyph, none deletes it
 * @param {string} tag feature tag set as the state of the token
 */
function replaceGlyph(glyphSequence, position, glyphIndexes, tag) {
    const token = glyphSequence.glyphTokens[position];
    saveTokenState(glyphSequence, token);
    const positionInToken = getPositionInToken(glyphSequence, position);
    const tokenGlyphIndexes = getTokenGlyphIndexes(token).slice();
    tokenGlyphIndexes.splice(positionInToken, 1, ...glyphIndexes);
    const replacementProperties = getReplacementLigatureProperties(
        getGlyphLigatureProperties(glyphSequence, position), glyphIndexes.length
    );
    if (token.ligatureProperties || replacementProperties.some(Boolean)) {
        token.ligatureProperties = token.ligatureProperties || getTokenGlyphIndexes(token).map(() => undefined);
        token.ligatureProperties.splice(positionInToken, 1, ...replacementProperties);
    }
    if (token.ligatedGlyphs) {
        const isLigated = token.ligatedGlyphs[positionInToken];
        token.ligatedGlyphs.splice(positionInToken, 1, ...glyphIndexes.map(() => isLigated));
    }
    if (!tokenGlyphIndexes.length) {
        token.setState('deleted', true);
    } else {
        token.setState(tag, tokenGlyphIndexes.length === 1 ? tokenGlyphIndexes[0] : tokenGlyphIndexes);
    }
    token.isSubstituted = true;
    glyphSequence.glyphIndexes.splice(position, 1, ...glyphIndexes);
    glyphSequence.glyphTokens.splice(position, 1, ...glyphIndexes.map(() => token));
    glyphSequence.ignorableTypes.splice(position, 1, ...glyphIndexes.map(() => DEFAULT_IGNORABLE_TYPES.NOT_IGNORABLE));
}

/**
 * Replace the glyphs of a single, multiple or ligature substitution (see getSubstitutionGlyphEdits)
 * @param {SubstitutionAction} action
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 */
function replaceSubstitutedGlyphs(action, glyphSequence, position) {
    for (const glyphEdit of getSubstitutionGlyphEdits(action)) {
        replaceGlyph(glyphSequence, position + glyphEdit.offset, glyphEdit.glyphIndexes, action.tag);
    }
}

/**
 * Apply single substitution format 1 and 2, and alternate substitution format 1 (its substitution is the alternate the
 * value of its feature chose, see FeatureQuery.getAlternate)
 * @param {SubstitutionAction} action
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs that replaced the glyph at the position
 */
function singleSubstitution(action, glyphSequence, position) {
    replaceSubstitutedGlyphs(action, glyphSequence, position);
    return 1;
}

/**
 * Apply contextual substitutions (context and chaining context, all formats): the substitutions of their nested
 * lookups (single, multiple, alternate, ligature), in order, each one at its glyph and like the substitution of its
 * type at the top level, with the feature tag of the contextual lookup
 * @param {SubstitutionAction} action its substitution is a ContextualMatch (see FeatureQuery)
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs from the glyph at the position to the last input glyph, after the
 * substitutions: like HarfBuzz, the lookup goes on after the input of the rule, which never ends before the glyph a
 * nested lookup applied at, so after a nested ligature that takes glyphs past the input it goes on at the ligature glyph
 */
function contextualSubstitution(action, glyphSequence, position) {
    for (const { offset, id, substitution } of action.substitution.substitutions) {
        applySubstitution(new SubstitutionAction({ id, tag: action.tag, substitution }), glyphSequence, position + offset);
    }
    return action.substitution.inputLength;
}

/**
 * Apply multiple substitution format 1: the glyph becomes a sequence of glyphs, each one a glyph of its own
 * for the following lookups, an empty sequence deletes it
 * @param {SubstitutionAction} action
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs that replaced the glyph at the position
 */
function multipleSubstitutionFormat1(action, glyphSequence, position) {
    replaceSubstitutedGlyphs(action, glyphSequence, position);
    return action.substitution.length;
}

/**
 * Merge the clusters of the glyphs of a range of a glyph sequence, like HarfBuzz (merge_clusters): every token
 * of the sequence in one of their clusters takes the smallest one, so that the whole clusters are merged. The clusters
 * are monotone while GSUB applies (in the logical order of the text, before the right-to-left runs are reversed), so the
 * smallest cluster is the one of the first glyph of the range, and the range only extends forward, to the glyphs after
 * it that share its last cluster (e.g. the other glyphs of a multiple substitution)
 * @param {GlyphSequence} glyphSequence
 * @param {number} startPosition
 * @param {number} endPosition the position after the last glyph of the range
 */
function mergeClusters(glyphSequence, startPosition, endPosition) {
    const glyphTokens = glyphSequence.glyphTokens;
    const clusters = new Set(glyphTokens.slice(startPosition, endPosition).map(token => token.cluster));
    const mergedCluster = Math.min(...clusters);
    let lastPosition = endPosition;
    while (lastPosition < glyphTokens.length && clusters.has(glyphTokens[lastPosition].cluster)) {
        lastPosition++;
    }
    for (let position = startPosition; position < lastPosition; position++) {
        saveTokenState(glyphSequence, glyphTokens[position]);
        glyphTokens[position].cluster = mergedCluster;
    }
}

/**
 * The number of components that a glyph brings to a ligature, like _hb_glyph_info_get_lig_num_comps of HarfBuzz: the
 * components of a ligature that a ligature substitution formed (see LigatureProperties) when GDEF has it in the
 * ligature class (a font without the GlyphClassDef of GDEF has the class of the substitution, a ligature), 1 otherwise
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number}
 */
function getLigatureComponentCount(glyphSequence, position) {
    const ligatureProperties = getGlyphLigatureProperties(glyphSequence, position);
    const componentCount = ligatureProperties && ligatureProperties.ligatureComponentCount;
    const gdef = glyphSequence.gdef;
    const isLigatureGlyph = !gdef || !gdef.classDef ||
        getGdefGlyphClass(gdef, glyphSequence.glyphIndexes[position]) === LIGATURE_GLYPH_CLASS;
    return componentCount && isLigatureGlyph ? componentCount : 1;
}

/**
 * The ligature properties of a glyph after a component of a ligature, like ligate_input of HarfBuzz: the component of
 * the ligature that the glyph follows, among the components counted so far, the last component counted its own
 * components when it is a ligature; the glyph takes the component it followed in that ligature (the last one when it
 * followed none)
 * @param {symbol|undefined} ligatureId the ligatureId of the ligature
 * @param {LigatureProperties|undefined} glyphProperties the ligature properties of the glyph
 * @param {number} componentsSoFar the number of components of the ligature up to the one the glyph follows
 * @param {number} lastComponentCount the number of components of the component the glyph follows
 * @returns {LigatureProperties}
 */
function getFollowingGlyphLigatureProperties(ligatureId, glyphProperties, componentsSoFar, lastComponentCount) {
    const component = getLigatureComponent(glyphProperties) || lastComponentCount;
    return { ligatureId, ligatureComponent: componentsSoFar - lastComponentCount + Math.min(component, lastComponentCount) };
}

/**
 * Set the ligature properties of the glyphs of a ligature substitution before it replaces its components, like
 * ligate_input of HarfBuzz: unless the components are a base glyph and marks or marks only (GDEF classes), the
 * ligature (its first component) gets a new ligatureId and its number of components, each component that is a
 * ligature counting its own components (see getLigatureComponentCount), and each glyph the substitution skipped the
 * component it follows (see getFollowingGlyphLigatureProperties); unless the components are marks only, the glyphs
 * after the last component that follow one of its components, when it is a ligature, take their component of the new
 * ligature
 * @param {GlyphSequence} glyphSequence
 * @param {number[]} componentPositions the positions of the components in the glyph sequence, the first one first
 */
function setLigatureSubstitutionProperties(glyphSequence, componentPositions) {
    const componentClasses = componentPositions.map(position => getGdefGlyphClass(glyphSequence.gdef, glyphSequence.glyphIndexes[position]));
    const areOtherComponentsMarks = componentClasses.slice(1).every(glyphClass => glyphClass === MARK_GLYPH_CLASS);
    const isMarkLigature = areOtherComponentsMarks && componentClasses[0] === MARK_GLYPH_CLASS;
    const isLigature = !isMarkLigature && !(areOtherComponentsMarks && componentClasses[0] === BASE_GLYPH_CLASS);
    const componentCounts = componentPositions.map(position => getLigatureComponentCount(glyphSequence, position));
    const lastIndex = componentPositions.length - 1;
    const lastComponentLigatureId = getLigatureId(getGlyphLigatureProperties(glyphSequence, componentPositions[lastIndex]));
    const ligatureId = isLigature ? Symbol('ligature') : undefined;
    if (isLigature) {
        const ligatureComponentCount = componentCounts.reduce((count, componentCount) => count + componentCount, 0);
        setGlyphLigatureProperties(glyphSequence, componentPositions[0], { ligatureId, ligatureComponentCount });
    }
    let componentsSoFar = componentCounts[0];
    for (let i = 1; i <= lastIndex; i++) {
        if (isLigature) {
            for (let position = componentPositions[i - 1] + 1; position < componentPositions[i]; position++) {
                setGlyphLigatureProperties(glyphSequence, position, getFollowingGlyphLigatureProperties(
                    ligatureId, getGlyphLigatureProperties(glyphSequence, position), componentsSoFar, componentCounts[i - 1]
                ));
            }
        }
        componentsSoFar += componentCounts[i];
    }
    if (isMarkLigature || !lastComponentLigatureId) {
        return;
    }
    for (let position = componentPositions[lastIndex] + 1; position < glyphSequence.glyphIndexes.length; position++) {
        const glyphProperties = getGlyphLigatureProperties(glyphSequence, position);
        if (getLigatureId(glyphProperties) !== lastComponentLigatureId || !getLigatureComponent(glyphProperties)) {
            break;
        }
        setGlyphLigatureProperties(glyphSequence, position, getFollowingGlyphLigatureProperties(
            ligatureId, glyphProperties, componentsSoFar, componentCounts[lastIndex]
        ));
    }
}

/**
 * Set a glyph of a glyph sequence as ligated in its token (see getTokenLigatedGlyphs)
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 */
function setGlyphLigated(glyphSequence, position) {
    const token = glyphSequence.glyphTokens[position];
    saveTokenState(glyphSequence, token);
    if (!token.ligatedGlyphs) {
        token.ligatedGlyphs = getTokenGlyphIndexes(token).map(() => false);
    }
    token.ligatedGlyphs[getPositionInToken(glyphSequence, position)] = true;
}

/**
 * Apply ligature substitution format 1: the first component becomes the ligature glyph and the
 * other components are deleted, the glyphs the lookup skipped between them stay after the ligature,
 * in one cluster with it, with the component of the ligature they follow (see setLigatureSubstitutionProperties);
 * the ligature of two components or more is ligated (see getTokenLigatedGlyphs), like HarfBuzz, which replaces a
 * ligature of one component like a single substitution
 * @param {SubstitutionAction} action
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs that replaced the glyph at the position
 */
function ligatureSubstitutionFormat1(action, glyphSequence, position) {
    const componentOffsets = action.substitution.componentOffsets;
    if (componentOffsets.length) {
        mergeClusters(glyphSequence, position, position + componentOffsets[componentOffsets.length - 1] + 1);
    }
    setLigatureSubstitutionProperties(glyphSequence, [position].concat(componentOffsets.map(offset => position + offset)));
    replaceSubstitutedGlyphs(action, glyphSequence, position);
    if (componentOffsets.length) {
        setGlyphLigated(glyphSequence, position);
    }
    return 1;
}

/**
 * Supported substitutions
 */
const SUBSTITUTIONS = {
    11: singleSubstitution,
    12: singleSubstitution,
    21: multipleSubstitutionFormat1,
    31: singleSubstitution,
    41: ligatureSubstitutionFormat1,
    51: contextualSubstitution,
    52: contextualSubstitution,
    53: contextualSubstitution,
    61: contextualSubstitution,
    62: contextualSubstitution,
    63: contextualSubstitution
};

/**
 * Apply a substitution at a glyph of a glyph sequence, to the sequence and to its tokens
 * @param {SubstitutionAction|any} action the substitution, anything else substitutes nothing
 * @param {GlyphSequence} glyphSequence
 * @param {number} position the position of the current glyph of the substitution
 * @returns {number} the number of glyphs a lookup goes on after, from the current one: the glyphs that replaced
 * it (0 when deleted, 1 when nothing is substituted), or for a contextual rule its inputLength (see ContextualMatch
 * in featureQuery.mjs)
 */
function applySubstitution(action, glyphSequence, position) {
    if (action instanceof SubstitutionAction && SUBSTITUTIONS[action.id]) {
        return SUBSTITUTIONS[action.id](action, glyphSequence, position);
    }
    return 1;
}

/**
 * Get the subtables of a lookup the coverage tables of their first glyph are read from (see
 * getSubtablesFirstGlyphCoverages in layout.mjs): the subtables its extension subtables wrap for an extension lookup,
 * without the undefined subtables (see getLookupTableSubtables in layout.mjs)
 * @param {any} lookupTable
 * @returns {Array<any>}
 */
function getLookupFirstGlyphSubtables(lookupTable) {
    const subtables = getLookupTableSubtables(lookupTable);
    return lookupTable.lookupType === 7 ? subtables.map(subtable => subtable.extension) : subtables;
}

/**
 * Apply a lookup (see FeatureQuery.lookupSubstitution) at each glyph of the tokens of a script run, from the first one:
 * the glyphs deleted by a ligature are not part of the context any more, each glyph of a multiple substitution is a
 * glyph of its own, and like HarfBuzz the lookup goes on after the glyphs that replaced a glyph, or after the input
 * glyphs of a contextual rule that matched (see applySubstitution). Like a buffer of HarfBuzz that cannot grow past its
 * max_len, a lookup that grows the glyphs of the script run past their maximum (see FeatureQuery.startScriptRun) stops
 * there, the tokens get back the glyphs, the ligature properties and the clusters they had before it, and no lookup
 * applies to the run after it
 * @param {FeatureQuery} query
 * @param {any} lookupTable
 * @param {string} tag the tag of the feature of the lookup, set as the state of the substituted tokens
 * @param {Token[]} tokens the tokens of the whole script run, whose glyphs count for its maximum
 * @param {function(Token): (number|null)} [getTokenFeatureValue] the value of the feature of the lookup at the glyphs of
 * a token, like the mask HarfBuzz gives a glyph (see getLookupFeatureValue): the alternate index there of its alternate
 * substitutions and of the ones that its contextual rules apply at the glyph, null where a rule or a ligature of the
 * lookup cannot start (e.g. the arabic form of the lookup outside the letters of the form), where a nested alternate
 * substitution has the value 0, like the mask of HarfBuzz there; 1 at every glyph if omitted. Unlike the feature mask
 * of HarfBuzz, the later input glyphs of a rule and the components of a ligature are matched whatever their token
 * @param {JoinerFlags} [joinerFlags] whether the lookup skips the zero width joiners and non-joiners where HarfBuzz
 * skips them by default (see getLookupJoinerFlags in featureValues.mjs), the default if omitted: like HarfBuzz, the
 * lookup skips the default ignorables when it matches the other glyphs of a rule or of a ligature (see
 * createIgnorableMatching in layout.mjs)
 * @param {LookupFirstGlyphFilter|null} [firstGlyphFilter] the glyphs the subtables of the lookup cover as their first
 * glyph (see FeatureLookup.firstGlyphFilter), whose digest tells most glyphs they do not cover faster than their
 * coverage tables (see getLookupFilterGlyphDigest in layout.mjs); none if omitted
 */
function applyLookupToTokens(
    query, lookupTable, tag, tokens, getTokenFeatureValue = () => 1, joinerFlags = AUTO_JOINER_FLAGS, firstGlyphFilter = null
) {
    if (query.isMaxGlyphCountExceeded) {
        return;
    }
    const layout = query.font.substitution;
    const firstGlyphSubtables = getLookupFirstGlyphSubtables(lookupTable);
    // null when a subtable has no coverage of its first glyph: the lookup is then tried at every glyph
    const coverages = getSubtablesFirstGlyphCoverages(firstGlyphSubtables);
    const firstGlyphDigest = getLookupFilterGlyphDigest(firstGlyphFilter, firstGlyphSubtables);
    // a glyph no subtable covers cannot start a substitution: skip it without building its context
    const isCovered = glyphIndex => {
        if (!coverages) {
            return true;
        }
        if (firstGlyphDigest && !mayGlyphDigestHave(firstGlyphDigest, glyphIndex)) {
            return false;
        }
        return coverages.some(coverage => layout.getCoverageIndex(coverage, glyphIndex) >= 0);
    };
    // applySubstitution updates the glyphs of the sequence, the context of the lookup
    const glyphSequence = getGlyphSequence(tokens, getLayoutGdefTable(query.font));
    const ignorableMatching = createIgnorableMatching(glyphSequence.ignorableTypes, false, joinerFlags);
    const contextParams = new ContextParams(glyphSequence.glyphIndexes, 0);
    const getGlyphFeatureValue = glyphPosition => getTokenFeatureValue(glyphSequence.glyphTokens[glyphPosition]) || 0;
    for (let position = 0; position < glyphSequence.glyphIndexes.length; position++) {
        const canStart = getTokenFeatureValue(glyphSequence.glyphTokens[position]) !== null;
        if (!canStart || !isCovered(glyphSequence.glyphIndexes[position])) {
            continue;
        }
        contextParams.setCurrentIndex(position);
        const action = query.lookupSubstitution(lookupTable, contextParams, tag, getGlyphFeatureValue, ignorableMatching);
        if (!action) {
            continue;
        }
        position += applySubstitution(action, glyphSequence, position) - 1;
        if (glyphSequence.glyphIndexes.length > query.maxGlyphCount) {
            restoreTokenStates(glyphSequence);
            query.isMaxGlyphCountExceeded = true;
            return;
        }
    }
}

/**
 * A lookup of features (see getFeaturesLookups)
 * @typedef FeatureLookup
 * @type Object
 * @property {any} lookupTable
 * @property {string} tag the tag of the first feature that has the lookup
 * @property {boolean} isEnabledFeatureLookup whether an enabled feature has the lookup, not only the required feature
 * @property {boolean} isRequiredFeatureLookup whether the required feature has the lookup, which then applies at every
 * glyph like the global mask that HarfBuzz gives it
 * @property {JoinerFlags} joinerFlags how the lookup skips the zero width joiners and non-joiners, from the features
 * that have it (see getLookupJoinerFlags in featureValues.mjs)
 * @property {LookupFirstGlyphFilter|null} firstGlyphFilter the glyphs the subtables of the lookup cover as their first
 * glyph (see getLookupFirstGlyphDigest, and createLookupFirstGlyphFilter in layout.mjs), null when a subtable has no
 * coverage of its first glyph or when the layout does not cache the lookups
 */

/**
 * The glyph digest of the glyphs the subtables of a GSUB lookup cover as their first glyph (see GlyphDigest in
 * layout.mjs): it reads the coverage tables of all its subtables, so it is computed with the lookups the layout caches
 * (see getFeaturesLookups)
 * @param {any} lookupTable
 * @returns {GlyphDigest|null} null when a subtable has no coverage of its first glyph
 */
function getLookupFirstGlyphDigest(lookupTable) {
    return getSubtablesFirstGlyphDigest(getLookupFirstGlyphSubtables(lookupTable));
}

/**
 * Get the lookups of features in lookup list order, like HarfBuzz: each lookup once, with the tag of the (first)
 * feature it belongs to and the joiner flags of all the features it belongs to in the shaper of the run of the query
 * (see FeatureQuery.startScriptRun), without the indexes past the lookup list. They are computed once for the GSUB
 * table, the features, the language system, the shaper and the feature variation record of the variation of the query
 * (see getCachedLayoutValue in layout.mjs).
 * @param {FeatureQuery} query
 * @param {string[]} tags feature tags
 * @param {string} script script tag
 * @param {string} [language] language tag, the default language system of the script if omitted
 * @param {boolean} [withRequiredFeature=false] whether to add the lookups of the required feature of the language system
 * (see FeatureQuery.getRequiredFeature), whatever its tag
 * @returns {FeatureLookup[]}
 */
function getFeaturesLookups(query, tags, script, language, withRequiredFeature = false) {
    const key = JSON.stringify(['lookups', tags, script, language, withRequiredFeature, query.shaper, query.getFeatureVariationIndex()]);
    return getCachedLayoutValue(query.font, 'gsub', key, isCached => {
        const features = tags.map(tag => ({ tag, feature: query.getFeature({ tag, script, language }), isRequired: false }));
        const requiredFeature = withRequiredFeature && query.getRequiredFeature(script, language);
        if (requiredFeature) {
            features.push({ tag: requiredFeature.tag, feature: requiredFeature.feature, isRequired: true });
        }
        // the tag of the first feature of each lookup, whether an enabled feature and the required feature have it, and the
        // tags of the enabled features that have it
        const lookupOrigins = new Map();
        for (const { tag, feature, isRequired } of features) {
            if (!feature || !feature.lookupListIndexes) {
                continue;
            }
            for (const lookupIndex of feature.lookupListIndexes) {
                const lookupOrigin = lookupOrigins.get(lookupIndex) ||
                    { tag, isEnabledFeatureLookup: false, isRequiredFeatureLookup: false, featureTags: [] };
                lookupOrigin.isEnabledFeatureLookup = lookupOrigin.isEnabledFeatureLookup || !isRequired;
                lookupOrigin.isRequiredFeatureLookup = lookupOrigin.isRequiredFeatureLookup || isRequired;
                if (!isRequired) {
                    lookupOrigin.featureTags.push(tag);
                }
                lookupOrigins.set(lookupIndex, lookupOrigin);
            }
        }
        const lookupIndexes = Array.from(lookupOrigins.keys()).sort((indexA, indexB) => indexA - indexB);
        const lookups = [];
        for (const lookupIndex of lookupIndexes) {
            const lookupTable = query.getLookupByIndex(lookupIndex);
            if (lookupTable) {
                const { featureTags, ...lookupOrigin } = lookupOrigins.get(lookupIndex);
                lookups.push({
                    lookupTable,
                    ...lookupOrigin,
                    joinerFlags: getLookupJoinerFlags(query.shaper, featureTags),
                    firstGlyphFilter: createLookupFirstGlyphFilter(
                        lookupTable, isCached, getLookupFirstGlyphSubtables, getLookupFirstGlyphDigest
                    )
                });
            }
        }
        return lookups;
    });
}

/**
 * The value of the feature of a lookup of features at every glyph, like the lookup mask of HarfBuzz: the value of its
 * first feature (see FeatureQuery.getFeatureValue), or 1 for a lookup of the required feature only (the global mask
 * of HarfBuzz). Not yet like HarfBuzz for a lookup of several features, which joins their masks: a lookup that the
 * required feature shares with an enabled feature takes the value of the enabled feature, where HarfBuzz joins the
 * global mask to the mask of the feature (an alternate index past the alternates, unless the feature has the global
 * mask, the value 1 of a feature that is not an arabic form)
 * @param {FeatureQuery} query
 * @param {FeatureLookup} featureLookup
 * @returns {number}
 */
function getLookupFeatureValue(query, featureLookup) {
    return featureLookup.isEnabledFeatureLookup ? query.getFeatureValue(featureLookup.tag) : 1;
}

/**
 * Apply the lookups of features (see getFeaturesLookups) to a list of tokens like HarfBuzz: in lookup list order, each
 * one once and at every glyph (see applyLookupToTokens), with the tag and the value of its first feature (see
 * getLookupFeatureValue), so that a lookup sees the glyphs the previous ones substituted, and not feature by feature
 * @param {FeatureQuery} query
 * @param {FeatureLookup[]} featureLookups
 * @param {Token[]} tokens
 */
function applyFeatureLookupsToTokens(query, featureLookups, tokens) {
    for (const featureLookup of featureLookups) {
        const featureValue = getLookupFeatureValue(query, featureLookup);
        applyLookupToTokens(
            query, featureLookup.lookupTable, featureLookup.tag, tokens, () => featureValue, featureLookup.joinerFlags,
            featureLookup.firstGlyphFilter
        );
    }
}

/**
 * The stage whose lookups the lookups of the required feature of a language system join, like HarfBuzz
 * (hb_ot_map_builder_t::compile): the stage of its tag when a stage has its tag, otherwise the first stage
 * @param {string[][]} stages the enabled feature tags of each stage, in the order of the stages
 * @param {{tag: string}|null} requiredFeature see FeatureQuery.getRequiredFeature
 * @returns {number} the index of the stage, -1 without a required feature
 */
function getRequiredFeatureStage(stages, requiredFeature) {
    if (!requiredFeature) {
        return -1;
    }
    return Math.max(stages.findIndex(stageTags => stageTags.includes(requiredFeature.tag)), 0);
}

// the feature whose lookups HarfBuzz applies before the lookups of all the other features, in a stage of its own
// (hb_ot_shape_collect_features): the required variation alternates
const REQUIRED_VARIATION_ALTERNATES_TAG = 'rvrn';

/**
 * A stage of the GSUB features of a script run, like a stage of the map of HarfBuzz: its lookups apply after the ones
 * of the stages before it (see applyFeatureLookupsToTokens)
 * @typedef FeatureStage
 * @type Object
 * @property {FeatureLookup[]} lookups the lookups of the features of the stage (see getFeaturesLookups)
 * @property {string} [formTag] the arabic form of the stage, whose lookups start at the letters of the form (see
 * arabicPresentationForms in arab/arabicPresentationForms.mjs), none for the other stages
 */

/**
 * The stages of features of the shapers of HarfBuzz that add no stage of their own (the default shaper, the Thai
 * shaper): the lookups of rvrn first, then the lookups of the other features together, the lookups of the required
 * feature of the language system in its stage (see getRequiredFeatureStage)
 * @param {FeatureQuery} query its shaper is the one of the run (see FeatureQuery.startScriptRun)
 * @param {string[]} tags feature tags
 * @param {string} script script tag
 * @param {string|undefined} language language tag, the default language system of the script if undefined
 * @returns {FeatureStage[]}
 */
function getDefaultShaperFeatureStages(query, tags, script, language) {
    const stages = [
        tags.filter(tag => tag === REQUIRED_VARIATION_ALTERNATES_TAG),
        tags.filter(tag => tag !== REQUIRED_VARIATION_ALTERNATES_TAG)
    ];
    const requiredFeatureStage = getRequiredFeatureStage(stages, query.getRequiredFeature(script, language));
    return stages.map((stageTags, stageIndex) => ({
        lookups: getFeaturesLookups(query, stageTags, script, language, stageIndex === requiredFeatureStage)
    }));
}

export default applySubstitution;
export {
    getTokenGlyphIndexes,
    getTokenLigatureProperties,
    getTokenLigatedGlyphs,
    getTokenDefaultIgnorableType,
    getGlyphSequence,
    applyLookupToTokens,
    getFeaturesLookups,
    getLookupFeatureValue,
    applyFeatureLookupsToTokens,
    getRequiredFeatureStage,
    getDefaultShaperFeatureStages,
    REQUIRED_VARIATION_ALTERNATES_TAG
};
