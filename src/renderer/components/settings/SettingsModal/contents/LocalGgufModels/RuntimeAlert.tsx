/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button } from '@arco-design/web-react';
import { Copy } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export type RuntimeAlertState = {
  title: string;
  /** One-line summary shown above the log. */
  detail?: string;
  /** Tail of the llama-server stderr, shown in the collapsible section. */
  log?: string;
};

/**
 * Persistent error panel for a local-model failure — a crash or a failed load.
 *
 * A toast disappears before the user can read a stack of llama.cpp errors, so the
 * stderr tail stays on screen behind a toggle and can be copied in one click.
 */
const RuntimeAlert: React.FC<{ state: RuntimeAlertState; onClose: () => void }> = ({ state, onClose }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyLog = (): void => {
    if (!state.log) return;
    void navigator.clipboard.writeText(state.log).then(() => setCopied(true));
  };

  return (
    <Alert
      type='error'
      closable
      onClose={onClose}
      className='mb-8px'
      title={state.title}
      content={
        <div className='flex flex-col gap-6px'>
          {state.detail ? <div className='text-12px'>{state.detail}</div> : null}
          {state.log ? (
            <>
              <div className='flex items-center gap-6px'>
                <Button size='mini' onClick={() => setExpanded((value) => !value)}>
                  {expanded ? t('settings.localGguf.hideLog') : t('settings.localGguf.showLog')}
                </Button>
                <Button size='mini' icon={<Copy theme='outline' size='14' />} onClick={copyLog}>
                  {copied ? t('settings.localGguf.logCopied') : t('settings.localGguf.copyLog')}
                </Button>
              </div>
              {expanded ? (
                <pre className='m-0 max-h-200px overflow-auto text-11px whitespace-pre-wrap break-all bg-fill-1 rounded-4px p-8px'>
                  {state.log}
                </pre>
              ) : null}
            </>
          ) : null}
        </div>
      }
    />
  );
};

export default RuntimeAlert;
