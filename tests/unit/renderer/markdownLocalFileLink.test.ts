/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  resolveLocalFileLinkPath,
  resolveLocalFileLinkReference,
  toLocalFileHref,
} from '@/renderer/components/Markdown/markdownUtils';

describe('resolveLocalFileLinkPath', () => {
  it('recognizes Windows absolute paths emitted as root-relative markdown links', () => {
    expect(resolveLocalFileLinkPath('/C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx')).toBe(
      'C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx'
    );
  });

  it('recognizes encoded file URLs', () => {
    expect(resolveLocalFileLinkPath('file:///C:/Users/Administrator/%E7%9C%8B%E6%9D%BF.xlsx')).toBe(
      'C:/Users/Administrator/看板.xlsx'
    );
  });

  it('recognizes common POSIX absolute paths', () => {
    expect(resolveLocalFileLinkPath('/Users/demo/outputs/report.xlsx')).toBe('/Users/demo/outputs/report.xlsx');
  });

  it('recognizes file-like POSIX absolute paths outside common home and temp roots', () => {
    expect(resolveLocalFileLinkPath('/opt/aionui/outputs/report.xlsx')).toBe('/opt/aionui/outputs/report.xlsx');
  });

  it('recognizes line suffixes without confusing Windows drive letters', () => {
    const reference = resolveLocalFileLinkReference('C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421');

    expect(reference).toEqual({
      filePath: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log',
      rawReference: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421',
      line: 1421,
    });
    expect(resolveLocalFileLinkPath('C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421')).toBe(
      'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log'
    );
  });

  it('recognizes line and column suffixes without including the line in the file path', () => {
    const reference = resolveLocalFileLinkReference(
      'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421:7'
    );

    expect(reference).toEqual({
      filePath: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log',
      rawReference: 'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421:7',
      line: 1421,
      column: 7,
    });
    expect(resolveLocalFileLinkPath('C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log:1421:7')).toBe(
      'C:/Users/Administrator/AppData/Roaming/AionUi/logs/app.log'
    );
  });

  it('recognizes POSIX hash line references', () => {
    expect(resolveLocalFileLinkReference('/Users/demo/file.ts#L10')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L10',
      line: 10,
    });

    expect(resolveLocalFileLinkReference('/Users/demo/file.ts#L10-L20')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L10-L20',
      line: 10,
      endLine: 20,
    });
  });

  it('recognizes file URL hash line references and normalizes raw references', () => {
    expect(resolveLocalFileLinkReference('file:///Users/demo/file.ts#L10')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L10',
      line: 10,
    });

    expect(resolveLocalFileLinkReference('file:///Users/demo/file.ts#L10-L20')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L10-L20',
      line: 10,
      endLine: 20,
    });

    expect(resolveLocalFileLinkReference('file:///Users/demo/My%20File.ts#L10')).toEqual({
      filePath: '/Users/demo/My File.ts',
      rawReference: '/Users/demo/My File.ts#L10',
      line: 10,
    });

    expect(resolveLocalFileLinkReference('file:///Users/demo/%E6%96%87%E4%BB%B6.ts#L10')).toEqual({
      filePath: '/Users/demo/文件.ts',
      rawReference: '/Users/demo/文件.ts#L10',
      line: 10,
    });
  });

  it('recognizes Windows file URL hash lines and ranges', () => {
    expect(resolveLocalFileLinkReference('file:///C:/Users/demo/file.ts#L10')).toEqual({
      filePath: 'C:/Users/demo/file.ts',
      rawReference: 'C:/Users/demo/file.ts#L10',
      line: 10,
    });

    expect(resolveLocalFileLinkReference('file:///C:/Users/demo/file.ts#L10-L20')).toEqual({
      filePath: 'C:/Users/demo/file.ts',
      rawReference: 'C:/Users/demo/file.ts#L10-L20',
      line: 10,
      endLine: 20,
    });
  });

  it('prioritizes hash line references over colon suffixes', () => {
    expect(resolveLocalFileLinkReference('/Users/demo/file.ts:10#L20')).toEqual({
      filePath: '/Users/demo/file.ts',
      rawReference: '/Users/demo/file.ts#L20',
      line: 20,
    });
  });

  it('rejects unsupported hash line formats and remote hash links', () => {
    expect(resolveLocalFileLinkReference('user.ts')).toBeNull();
    expect(resolveLocalFileLinkReference('./user.ts')).toBeNull();
    expect(resolveLocalFileLinkReference('../user.ts')).toBeNull();
    expect(resolveLocalFileLinkReference('/settings')).toBeNull();
    expect(resolveLocalFileLinkReference('https://aionui.com/docs#L10')).toBeNull();
    expect(resolveLocalFileLinkReference('https://github.com/org/repo/blob/main/file.ts#L10')).toBeNull();
    expect(resolveLocalFileLinkReference('/Users/demo/file.ts#l10')).toBeNull();
    expect(resolveLocalFileLinkReference('/Users/demo/file.ts#L10-l20')).toBeNull();
  });

  it('does not treat normal web links or app routes as local files', () => {
    expect(resolveLocalFileLinkPath('https://aionui.com/docs')).toBeNull();
    expect(resolveLocalFileLinkPath('/settings')).toBeNull();
  });

  it.each([
    ['bin/LumenRoom.exe', 'D:/课程/大作业/bin/LumenRoom.exe'],
    ['docs/design/gui-scene.png', 'D:/课程/大作业/docs/design/gui-scene.png'],
    ['docs/技术报告.pdf', 'D:/课程/大作业/docs/技术报告.pdf'],
    ['docs/report/acceptance/contact-sheet.png', 'D:/课程/大作业/docs/report/acceptance/contact-sheet.png'],
    ['submission/提交包.zip', 'D:/课程/大作业/submission/提交包.zip'],
    ['./docs/中文%20报告.pdf', 'D:/课程/大作业/docs/中文 报告.pdf'],
    ['docs/report%23final.pdf', 'D:/课程/大作业/docs/report#final.pdf'],
    ['docs/percent%2520name.pdf', 'D:/课程/大作业/docs/percent%20name.pdf'],
    ['../shared/README', 'D:/课程/shared/README'],
    ['docs\\report.pdf', 'D:/课程/大作业/docs/report.pdf'],
    ['docs/', 'D:/课程/大作业/docs'],
  ])('resolves the relative link %s within its conversation workspace', (href, expected) => {
    expect(resolveLocalFileLinkPath(href, undefined, 'D:\\课程\\大作业')).toBe(expected);
  });

  it('resolves relative line and column references before revealing the file', () => {
    expect(resolveLocalFileLinkReference('src/main.ts:12:3', undefined, 'D:/project')).toEqual({
      filePath: 'D:/project/src/main.ts',
      rawReference: 'D:/project/src/main.ts:12:3',
      line: 12,
      column: 3,
    });
  });

  it('resolves relative hash ranges and extensionless files', () => {
    expect(resolveLocalFileLinkReference('./README#L2-L4', undefined, '/opt/project')).toEqual({
      filePath: '/opt/project/README',
      rawReference: '/opt/project/README#L2-L4',
      line: 2,
      endLine: 4,
    });
  });

  it('keeps relative parent segments within the filesystem root', () => {
    expect(resolveLocalFileLinkPath('../../../report.pdf', undefined, 'D:/project')).toBe('D:/report.pdf');
    expect(resolveLocalFileLinkPath('../', undefined, 'D:/')).toBe('D:/');
    expect(resolveLocalFileLinkPath('../../report.pdf', undefined, '/project')).toBe('/report.pdf');
  });

  it.each([
    'https://example.com/report.pdf',
    '//example.com/report.pdf',
    'mailto:user@example.com',
    'javascript:alert(1)',
    'data:text/plain,example',
    'vscode://file/C:/project/app.ts',
    '#section',
    '?download=1',
    'docs/report.pdf?download=1',
    '/settings',
    'file://server/share/report.pdf',
    'file:///C:/report.pdf?download=1',
    'docs/%00report.pdf',
    'C:/report\u0000.pdf',
  ])('keeps %s outside local workspace resolution', (href) => {
    expect(resolveLocalFileLinkPath(href, undefined, 'D:/project')).toBeNull();
  });

  it('does not guess a relative file location without an absolute workspace', () => {
    expect(resolveLocalFileLinkPath('docs/report.pdf')).toBeNull();
    expect(resolveLocalFileLinkPath('docs/report.pdf', undefined, 'project')).toBeNull();
    expect(resolveLocalFileLinkPath('docs/report.pdf', undefined, 'https://example.com/project')).toBeNull();
  });

  it.each([
    ['file:///C:/docs/percent%2520name.pdf', 'C:/docs/percent%20name.pdf'],
    ['file:///C:/docs/chapter%23one.pdf', 'C:/docs/chapter#one.pdf'],
    ['C:/docs/chapter%23one.pdf', 'C:/docs/chapter#one.pdf'],
  ])('decodes filename escapes exactly once for %s', (href, expected) => {
    expect(resolveLocalFileLinkPath(href)).toBe(expected);
  });

  it('formats local file paths as file URLs for browser link copying', () => {
    expect(toLocalFileHref('C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx')).toBe(
      'file:///C:/Users/Administrator/AppData/Roaming/AionUi/report.xlsx'
    );
    expect(toLocalFileHref('/var/folders/demo/report.xlsx')).toBe('file:///var/folders/demo/report.xlsx');
  });
});
