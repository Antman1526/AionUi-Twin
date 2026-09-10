/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Tag } from '@arco-design/web-react';
import { Lightning, Brain, Copy, Send, Close } from '@icon-park/react';
import { ipcBridge } from '@/common';
import { soundEffects } from '@/renderer/utils/audio/soundEffects';

export const QuickBarPage: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
          <button
            type='button'
            onClick={() => void ipcBridge.quickBar.hide.invoke()}
            className='p-4px rounded-full hover:bg-fill-2 text-t-secondary transition-colors cursor-pointer border-none bg-transparent'
          >
            <Close theme='outline' size='14' />
          </button>
        </div>

        <div className='relative flex items-center gap-8px px-12px py-10px rounded-10px bg-fill-2 border-1px border-solid border-[var(--color-border-2)]'>
          <input
            ref={inputRef}
            type='text'
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder='Ask anything, delegate to local model, or run a skill...'
            className='w-full bg-transparent border-none outline-none text-15px text-[var(--color-text-1)] placeholder-[var(--color-text-4)] font-normal'
          />
          <button
            type='button'
            onClick={() => void handleSubmit()}
            disabled={!prompt.trim()}
            className={`p-6px rounded-8px border-none transition-colors cursor-pointer ${
              prompt.trim()
                ? 'bg-primary-6 text-white hover:bg-primary-7'
                : 'bg-fill-3 text-[var(--color-text-4)] cursor-not-allowed'
            }`}
          >
            <Send theme='outline' size='14' />
          </button>
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
        <button
          type='button'
          onClick={() => void handlePasteClipboard()}
          className='flex items-center gap-4px px-8px py-4px rounded-6px bg-fill-2 hover:bg-fill-3 border-1px border-solid border-[var(--color-border-2)] text-11px text-t-secondary cursor-pointer transition-colors'
        >
          <Copy theme='outline' size='12' />
          <span>Paste Clipboard</span>
        </button>
        <button
          type='button'
          onClick={() => {
            setSelectedSkill('brandkit');
            soundEffects.playClick();
          }}
          className='flex items-center gap-4px px-8px py-4px rounded-6px bg-fill-2 hover:bg-fill-3 border-1px border-solid border-[var(--color-border-2)] text-11px text-t-secondary cursor-pointer transition-colors'
        >
          <Lightning theme='outline' size='12' />
          <span>Skill: Brandkit</span>
        </button>
        <button
          type='button'
          onClick={() => {
            setSelectedSkill('brutalist-ui');
            soundEffects.playClick();
          }}
          className='flex items-center gap-4px px-8px py-4px rounded-6px bg-fill-2 hover:bg-fill-3 border-1px border-solid border-[var(--color-border-2)] text-11px text-t-secondary cursor-pointer transition-colors'
        >
          <Lightning theme='outline' size='12' />
          <span>Skill: Brutalist UI</span>
        </button>
        <button
          type='button'
          onClick={() => {
            setPrompt((p) => (p ? `${p} (Use local GGUF)` : 'Run with local GGUF: '));
            soundEffects.playClick();
          }}
          className='flex items-center gap-4px px-8px py-4px rounded-6px bg-fill-2 hover:bg-fill-3 border-1px border-solid border-[var(--color-border-2)] text-11px text-t-secondary cursor-pointer transition-colors'
        >
          <Brain theme='outline' size='12' />
          <span>Route to Local Neural Engine</span>
        </button>
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
