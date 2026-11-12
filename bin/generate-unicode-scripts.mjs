#!/usr/bin/env node
// Generate src/unicode-scripts.mjs, the Unicode Script and Script_Extensions properties of every code point, from the
// Unicode Character Database: Scripts.txt, the sc values of PropertyValueAliases.txt and ScriptExtensions.txt, of the
// same version.
//
//     curl -O https://www.unicode.org/Public/16.0.0/ucd/Scripts.txt
//     curl -O https://www.unicode.org/Public/16.0.0/ucd/PropertyValueAliases.txt
//     curl -O https://www.unicode.org/Public/16.0.0/ucd/ScriptExtensions.txt
//     node bin/generate-unicode-scripts.mjs Scripts.txt PropertyValueAliases.txt ScriptExtensions.txt > src/unicode-scripts.mjs
//
// src/unicode-scripts.mjs comes from the files of Unicode 16.0.0, the version of HarfBuzz 11.3.2:
//     sha256 9e88f0a677df47311106340be8ede2ecdacd9c1c931831218d2be6d5508e0039  Scripts.txt
//     sha256 440fd3e5460b9bfe31da67b6f923992e1989d31fe2ed91e091c4b8f8e2620bf9  PropertyValueAliases.txt
//     sha256 049117ce26b9769fe2749b06eef51a50a89faef4a97764dd2d81daa715980700  ScriptExtensions.txt

import { readFileSync } from 'fs';
import process from 'process';

const UNKNOWN_SCRIPT = 'Zzzz';
const LAST_CODE_POINT = 0x10FFFF;

/**
 * The data lines of a file of the Unicode Character Database, without their comment, split into their fields
 * @param {string} path
 * @returns {string[][]}
 */
function readDataLines(path) {
    return readFileSync(path, 'utf8').split('\n')
        .map(line => line.replace(/#.*/, '').trim())
        .filter(line => line.length)
        .map(line => line.split(';').map(field => field.trim()));
}

/**
 * The ISO 15924 code of each Script value name, from the sc lines of PropertyValueAliases.txt
 * @param {string} path
 * @returns {Map<string, string>}
 */
function readScriptCodes(path) {
    const scriptCodes = new Map();
    for (const [property, code, name] of readDataLines(path)) {
        if (property === 'sc') {
            scriptCodes.set(name, code);
        }
    }
    return scriptCodes;
}

/**
 * The first and the last code point of a range of code points of the Unicode Character Database (e.g. 0640 or 064B..0655)
 * @param {string} codePoints
 * @returns {{start: number, end: number}}
 */
function parseCodePointRange(codePoints) {
    const [start, end] = codePoints.split('..').map(codePoint => parseInt(codePoint, 16));
    return { start, end: end === undefined ? start : end };
}

/**
 * The ranges of code points of Scripts.txt, sorted, with the ISO 15924 code of their script
 * @param {string} path
 * @param {Map<string, string>} scriptCodes
 * @returns {Array<{start: number, end: number, script: string}>}
 */
function readScriptRanges(path, scriptCodes) {
    const ranges = readDataLines(path).map(([codePoints, name]) => {
        if (!scriptCodes.has(name)) {
            throw new Error(`no ISO 15924 code for the script ${name}`);
        }
        return { ...parseCodePointRange(codePoints), script: scriptCodes.get(name) };
    });
    return ranges.sort((rangeA, rangeB) => rangeA.start - rangeB.start);
}

/**
 * The ranges of code points of ScriptExtensions.txt, sorted, with the ISO 15924 codes of their scripts
 * @param {string} path
 * @returns {Array<{start: number, end: number, scripts: string[]}>}
 */
function readScriptExtensionRanges(path) {
    const ranges = readDataLines(path).map(([codePoints, scripts]) => ({
        ...parseCodePointRange(codePoints),
        scripts: scripts.split(/\s+/)
    }));
    return ranges.sort((rangeA, rangeB) => rangeA.start - rangeB.start);
}

/**
 * The ranges of code points of the Script_Extensions, each one as the distance in code points from the start of the
 * range before it, its number of code points minus one, then the indexes of its scripts, in base 36
 * @param {Array<{start: number, end: number, scripts: string[]}>} ranges
 * @param {string[]} scripts - the ISO 15924 codes of the scripts of SCRIPT_CODES
 * @returns {string}
 */
function encodeScriptExtensionRanges(ranges, scripts) {
    let previousStart = 0;
    return ranges.map(({ start, end, scripts: rangeScripts }) => {
        const scriptIndexes = rangeScripts.map(script => {
            if (!scripts.includes(script)) {
                throw new Error(`unknown script ${script} in the Script_Extensions of U+${start.toString(16)}`);
            }
            return scripts.indexOf(script).toString(36);
        });
        const encodedRange = [(start - previousStart).toString(36), (end - start).toString(36)].concat(scriptIndexes).join(':');
        previousStart = start;
        return encodedRange;
    }).join(',');
}

/**
 * The code points where the script changes, from 0 to U+10FFFF: the code points Scripts.txt does not list are Unknown
 * @param {Array<{start: number, end: number, script: string}>} ranges
 * @returns {Array<{start: number, script: string}>}
 */
function getScriptChanges(ranges) {
    const changes = [];
    const addRange = (start, script) => {
        if (!changes.length || changes[changes.length - 1].script !== script) {
            changes.push({ start, script });
        }
    };
    let nextCodePoint = 0;
    for (const range of ranges) {
        if (range.start < nextCodePoint) {
            throw new Error(`overlapping range at U+${range.start.toString(16)}`);
        }
        if (range.start > nextCodePoint) {
            addRange(nextCodePoint, UNKNOWN_SCRIPT);
        }
        addRange(range.start, range.script);
        nextCodePoint = range.end + 1;
    }
    if (nextCodePoint <= LAST_CODE_POINT) {
        addRange(nextCodePoint, UNKNOWN_SCRIPT);
    }
    return changes;
}

function main() {
    const [scriptsPath, aliasesPath, extensionsPath] = process.argv.slice(2);
    const versionLine = readFileSync(scriptsPath, 'utf8').split('\n')[0].replace(/^#\s*/, '');
    const extensionsVersionLine = readFileSync(extensionsPath, 'utf8').split('\n')[0].replace(/^#\s*/, '');
    const changes = getScriptChanges(readScriptRanges(scriptsPath, readScriptCodes(aliasesPath)));
    const scripts = Array.from(new Set(changes.map(change => change.script))).sort();
    const encodedChanges = [];
    let previousStart = 0;
    for (const { start, script } of changes) {
        encodedChanges.push((start - previousStart).toString(36) + ':' + scripts.indexOf(script).toString(36));
        previousStart = start;
    }
    process.stdout.write([
        `// The Unicode Script and Script_Extensions properties of every code point, from ${versionLine} and`,
        `// ${extensionsVersionLine} (Unicode Character Database).`,
        '// Generated by bin/generate-unicode-scripts.mjs, do not edit.',
        '',
        '// the ISO 15924 codes of the scripts',
        `export const SCRIPT_CODES = [${scripts.map(script => `'${script}'`).join(', ')}];`,
        '',
        '// the ranges of code points of one script, from U+0000 to U+10FFFF, each one as the distance in code points',
        '// from the start of the range before it, then the index of its script in SCRIPT_CODES, both in base 36',
        `export const SCRIPT_RANGES = '${encodedChanges.join(',')}';`,
        '',
        '// the ranges of code points whose Script_Extensions are not their script alone, each one as the distance in code',
        '// points from the start of the range before it, its number of code points minus one, then the indexes of its',
        '// scripts in SCRIPT_CODES, all in base 36',
        `export const SCRIPT_EXTENSION_RANGES = '${encodeScriptExtensionRanges(readScriptExtensionRanges(extensionsPath), scripts)}';`,
        ''
    ].join('\n'));
}

main();
