import React from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@arco-design/web-react';
import SendBox from '@/renderer/components/chat/SendBox';
import { getSendBoxDraftHook } from '@/renderer/hooks/chat/useSendBoxDraft';

const useDraft = getSendBoxDraftHook('acp', { _type: 'acp', content: '', atPath: [], uploadFile: [] });

function ComposerHarness() {
  const draft = useDraft('composer-browser-test');
  const value = draft.data?.content ?? '';
  return (
    <main style={{ width: 700, padding: 20 }}>
      <SendBox
        value={value}
        onChange={(content) => draft.mutate((previous) => ({ ...previous, content }))}
        onSend={async () => false}
      />
      <Button data-testid='outside-composer'>Move focus outside the composer</Button>
      <pre data-testid='draft'>{value}</pre>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ComposerHarness />);
