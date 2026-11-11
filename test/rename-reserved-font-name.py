"""Rename a font whose license declares a Reserved Font Name.

A subset is a Modified Version under the SIL Open Font License, so it cannot keep the
Reserved Font Name of its source. This script rewrites these records, when the font has them,
and leaves the others as they are:

- name table: name IDs 1 and 16 get the family name, 3 '<postscript name>;modified for the
  opentype.js test suite', 4 the family name and the style of name ID 2, 6 the postscript name
  and 25 the postscript name without its hyphens; in every other name record but the notices
  (name IDs 0, 5 and 7 to 14: copyright, version, trademark, manufacturer, designer,
  description, vendor URL, designer URL, license, license URL), such as the fvar instance
  names, each reserved postscript prefix is replaced by the postscript name without its hyphens;
- CFF (version 1): the Name INDEX gets the postscript name, the Top DICT FamilyName the family
  name and FullName the family name and the style, and in the FontName of each Font DICT of a
  CID-keyed font each reserved postscript prefix is replaced like above.

Before saving, the script fails when one of these records, or any other name record but the
notices, still has a reserved word (e.g. Source): the font is not written.

fontTools recomputes on save the bounding boxes (head and the CFF FontBBox, that a subset keeps
from its source), head.modified (fixed by SOURCE_DATE_EPOCH) and head.checkSumAdjustment.

usage: rename-reserved-font-name.py <input> <output> <family name> <postscript name>
       <reserved postscript prefix>... --reserved <reserved word>...
"""
import argparse

from fontTools.ttLib import TTFont

# name IDs that are not font names: copyright, version, trademark, manufacturer, designer,
# description, vendor URL, designer URL, license, license URL
KEPT_NAME_IDS = {0, 5, 7, 8, 9, 10, 11, 12, 13, 14}


def rename_font(font, family_name, postscript_name, reserved_prefixes):
    name_table = font['name']
    style_name = name_table.getDebugName(2) or 'Regular'
    full_name = f'{family_name} {style_name}'
    compact_name = postscript_name.replace('-', '')
    replacements = {
        1: family_name,
        3: f'{postscript_name};modified for the opentype.js test suite',
        4: full_name,
        6: postscript_name,
        16: family_name,
        25: compact_name,
    }

    def replace_reserved_prefixes(text):
        for reserved_prefix in reserved_prefixes:
            text = text.replace(reserved_prefix, compact_name)
        return text

    for record in name_table.names:
        if record.nameID in replacements:
            record.string = replacements[record.nameID]
        elif record.nameID not in KEPT_NAME_IDS:
            record.string = replace_reserved_prefixes(record.toUnicode())
    if 'CFF ' in font:
        cff = font['CFF '].cff
        top_dict = cff.topDictIndex[0]
        cff.fontNames[0] = postscript_name
        for key, value in (('FullName', full_name), ('FamilyName', family_name)):
            if key in top_dict.rawDict:
                top_dict.rawDict[key] = value
                setattr(top_dict, key, value)
        for font_dict in getattr(top_dict, 'FDArray', []):
            if 'FontName' in font_dict.rawDict:
                font_dict.FontName = font_dict.rawDict['FontName'] = replace_reserved_prefixes(font_dict.FontName)


def get_font_names(font):
    """The font names of the font, as (record description, text): the name records but the notices, and the CFF names."""
    font_names = []
    for record in font['name'].names:
        if record.nameID not in KEPT_NAME_IDS:
            font_names.append((f'name ID {record.nameID} ({record.platformID}, {record.platEncID}, {record.langID:#x})', record.toUnicode()))
    if 'CFF ' in font:
        cff = font['CFF '].cff
        top_dict = cff.topDictIndex[0]
        font_names.extend((f'CFF Name INDEX {index}', font_name) for index, font_name in enumerate(cff.fontNames))
        for key in ('FullName', 'FamilyName'):
            if hasattr(top_dict, key):
                font_names.append((f'CFF Top DICT {key}', getattr(top_dict, key)))
        for index, font_dict in enumerate(getattr(top_dict, 'FDArray', [])):
            if hasattr(font_dict, 'FontName'):
                font_names.append((f'CFF Font DICT {index} FontName', font_dict.FontName))
    return font_names


def find_reserved_words(font, reserved_words):
    """The font names that still have a reserved word, written with or without its spaces."""
    found = []
    for description, text in get_font_names(font):
        for reserved_word in reserved_words:
            if reserved_word in text or reserved_word.replace(' ', '') in text:
                found.append(f'{description}: {text!r} has {reserved_word!r}')
    return found


def main():
    parser = argparse.ArgumentParser(description='Rename a font whose license declares a Reserved Font Name.')
    parser.add_argument('input_path', metavar='input', help='path of the font to rename')
    parser.add_argument('output_path', metavar='output', help='path of the renamed font')
    parser.add_argument('family_name', metavar='family-name', help="new family name, e.g. 'Test CFF CID Keyed'")
    parser.add_argument('postscript_name', metavar='postscript-name', help='new postscript name, e.g. TestCFF1-CIDKeyed')
    parser.add_argument(
        'reserved_prefixes',
        metavar='reserved-prefix',
        nargs='+',
        help='postscript prefix of the source to replace in the other font names, e.g. SourceHanSansKR-Regular',
    )
    parser.add_argument(
        '--reserved',
        metavar='word',
        dest='reserved_words',
        nargs='+',
        required=True,
        help='Reserved Font Name that no font name may keep, e.g. Source',
    )
    arguments = parser.parse_args()
    font = TTFont(arguments.input_path)
    rename_font(font, arguments.family_name, arguments.postscript_name, arguments.reserved_prefixes)
    found = find_reserved_words(font, arguments.reserved_words)
    if found:
        parser.exit(1, f'{parser.prog}: error: {arguments.output_path} not written, a reserved word is left:\n' + ''.join(f'    {line}\n' for line in found))
    font.save(arguments.output_path)


if __name__ == '__main__':
    main()
