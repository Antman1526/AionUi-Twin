/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Tag } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { Lightning, Brain, Copy, Send, Close } from '@icon-park/react';
import { ipcBridge } from '@/common';
import { soundEffects } from '@/renderer/utils/audio/soundEffects';

export const QuickBarPage: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const inputRef = useRef<RefInputType>(null);

  useEffect(() => {
    inputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void ipcBridge.quickBar.hide.invoke();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    soundEffects.playClick();
    await ipcBridge.quickBar.submitPrompt.invoke({
      prompt: prompt.trim(),
      skillId: selectedSkill || undefined,
    });
    setPrompt('');
    setSelectedSkill(null);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setPrompt((prev) => (prev ? `${prev}\n\n${text}` : text));
        soundEffects.playClick();
      }
    } catch {
      /* clipboard read restricted */
    }
  };

  return (
    <div className='w-screen h-screen flex flex-col justify-between p-16px bg-white/70 dark:bg-black/75 backdrop-blur-xl border-1px border-solid border-white/20 dark:border-white/10 rounded-16px shadow-2xl text-[var(--color-text-1)] select-none'>
      {/* Top Bar / Search Input */}
      <div>
        <div className='flex items-center justify-between mb-12px'>
          <div className='flex items-center gap-6px'>
            <div className='w-7px h-7px rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]' />
            <span className='font-semibold text-13px tracking-wide'>WE Spotlight</span>
          </div>
          <Button
            size='mini'
            type='text'
            shape='circle'
            icon={<Close theme='outline' size='14' />}
            onClick={() => void ipcBridge.quickBar.hide.invoke()}
          />
        </div>

        <div className='flex items-center gap-8px'>
          <Input
            ref={inputRef}
            size='large'
            value={prompt}
            onChange={(val) => setPrompt(val)}
            onPressEnter={() => void handleSubmit()}
            placeholder='Ask anything, delegate to local model, or run a skill...'
            className='flex-1 rounded-10px'
            suffix={
              <Button
                size='mini'
                type='primary'
                shape='round'
                icon={<Send theme='outline' size='13' />}
                disabled={!prompt.trim()}
                onClick={() => void handleSubmit()}
              />
            }
          />
        </div>

        {/* Selected Skill Badge */}
        {selectedSkill && (
          <div className='mt-8px flex items-center gap-6px'>
            <Tag size='small' color='arcoblue' closable onClose={() => setSelectedSkill(null)}>
              Skill: {selectedSkill}
            </Tag>
          </div>
        )}
      </div>

      {/* Action Chips */}
      <div className='flex flex-wrap items-center gap-6px my-10px'>
        <Button
          size='mini'
          className='flex items-center gap-4px rounded-6px'
          icon={<Copy theme='outline' size='12' />}
          onClick={() => void handlePasteClipboard()}
        >
          Paste Clipboard
        </Button>
        <Button
          size='mini'
          className='flex items-center gap-4px rounded-6px'
          icon={<Lightning theme='outline' size='12' />}
          onClick={() => {
            setSelectedSkill('plan-ceo-review');
            soundEffects.playClick();
          }}
        >
          CEO Review
        </Button>
        <Button
          size='mini'
          className='flex items-center gap-4px rounded-6px'
          icon={<Lightning theme='outline' size='12' />}
          onClick={() => {
            setSelectedSkill('cso');
            soundEffects.playClick();
          }}
        >
          CSO Security
        </Button>
        <Button
          size='mini'
          className='flex items-center gap-4px rounded-6px'
          icon={<Lightning theme='outline' size='12' />}
          onClick={() => {
            setSelectedSkill('diagnosing-bugs');
            soundEffects.playClick();
          }}
        >
          Diagnose Bug
        </Button>
        <Button
          size='mini'
          className='flex items-center gap-4px rounded-6px'
          icon={<Lightning theme='outline' size='12' />}
          onClick={() => {
            setSelectedSkill('brandkit');
            soundEffects.playClick();
          }}
        >
          Brandkit
        </Button>
        <Button
          size='mini'
          className='flex items-center gap-4px rounded-6px'
          icon={<Brain theme='outline' size='12' />}
          onClick={() => {
            setPrompt((p) => (p ? `${p} (Use local model)` : 'Run with local model: '));
            soundEffects.playClick();
          }}
        >
          Local Neural Engine
        </Button>
      </div>

      {/* Footer Instructions */}
      <div className='flex items-center justify-between text-10px text-t-secondary pt-8px border-t-1px border-solid border-[var(--color-border-2)]'>
        <span>Cmd + Shift + Space to summon anywhere</span>
        <span>Esc to dismiss · ↵ to run</span>
      </div>
    </div>
  );
};

export default QuickBarPage;
