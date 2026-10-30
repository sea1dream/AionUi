/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { LocalFileLinkReference } from '@/renderer/components/Markdown/markdownUtils';
import { useLocalFilePreview } from '@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Message } from '@arco-design/web-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/** Reveal desktop chat links without executing them; keep previewing in WebUI. */
export const useLocalFileAction = (workspace?: string) => {
  const previewFile = useLocalFilePreview(workspace);
  const { t } = useTranslation();

  return useCallback(
    async (filePath: string, reference?: LocalFileLinkReference) => {
      if (!isElectronDesktop()) {
        await previewFile(filePath, reference);
        return;
      }
      try {
        await ipcBridge.shell.showItemInFolder.invoke(filePath);
      } catch {
        Message.error(t('preview.openLocationFailed'));
      }
    },
    [previewFile, t]
  );
};
