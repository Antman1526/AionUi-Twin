/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Tag, Tooltip } from '@arco-design/web-react';
import { Robot, Code, CheckOne, Shield, Brain, Lightning, FullScreen, OffScreen } from '@icon-park/react';
import { soundEffects } from '@/renderer/utils/audio/soundEffects';

export interface SwarmAgent {
  id: string;
  name: string;
  role: string;
  status: 'idle' | 'thinking' | 'tool_calling' | 'completed';
  activeTool?: string;
  avatarIcon: 'lead' | 'coder' | 'reviewer' | 'security' | 'general';
  tokensProcessed: number;
}

const DEFAULT_AGENTS: SwarmAgent[] = [
  {
    id: 'agent-lead',
    name: 'Lead Orchestrator',
    role: 'Decomposes user objective & assigns tasks',
    status: 'completed',
    avatarIcon: 'lead',
    tokensProcessed: 1420,
  },
  {
    id: 'agent-coder',
    name: 'Neural Coder',
    role: 'Implements modules with local GGUF / MLX',
    status: 'thinking',
    activeTool: 'local_gguf_inference',
    avatarIcon: 'coder',
    tokensProcessed: 3840,
  },
  {
    id: 'agent-reviewer',
    name: 'Code Reviewer',
    role: 'Verifies edge cases & architecture bounds',
    status: 'idle',
    avatarIcon: 'reviewer',
    tokensProcessed: 960,
  },
  {
    id: 'agent-security',
    name: 'Security Guard',
    role: 'Audits air-gap isolation & token limits',
    status: 'idle',
    avatarIcon: 'security',
    tokensProcessed: 520,
  },
];

interface AgentWarRoomProps {
  agents?: SwarmAgent[];
  onClose?: () => void;
}

export const AgentWarRoom: React.FC<AgentWarRoomProps> = ({ agents = DEFAULT_AGENTS, onClose }) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(agents[0]?.id || 'agent-lead');
  const [isFullView, setIsFullView] = useState(false);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  const getAgentIcon = (type: SwarmAgent['avatarIcon']) => {
    switch (type) {
      case 'lead':
        return <Brain theme='filled' size='18' className='text-amber-500' />;
      case 'coder':
        return <Code theme='outline' size='18' className='text-cyan-500' />;
      case 'reviewer':
        return <CheckOne theme='outline' size='18' className='text-emerald-500' />;
      case 'security':
        return <Shield theme='outline' size='18' className='text-indigo-500' />;
      default:
        return <Robot theme='outline' size='18' className='text-blue-500' />;
    }
  };

  return (
    <div
      className={`relative w-full rounded-12px overflow-hidden border-1px border-solid border-[var(--color-border-2)] bg-gradient-to-br from-slate-900 via-slate-950 to-black text-white p-16px select-none transition-all ${
        isFullView ? 'fixed inset-24px z-1000 shadow-2xl' : 'min-h-360px my-12px'
      }`}
    >
      {/* Tactical Grid Background Overlay */}
      <div className='absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-40 pointer-events-none' />

      {/* Header Bar */}
      <div className='relative z-10 flex items-center justify-between pb-12px border-b-1px border-solid border-slate-800/80 mb-16px'>
        <div className='flex items-center gap-8px'>
          <span className='relative flex h-8px w-8px'>
            <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75' />
            <span className='relative inline-flex rounded-full h-8px w-8px bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]' />
          </span>
          <span className='font-bold text-13px tracking-wider uppercase text-cyan-400'>WE Swarm War Room</span>
          <Tag size='small' color='arcoblue'>
            Live Tactical Canvas
          </Tag>
        </div>

        <div className='flex items-center gap-6px'>
          <Button
            size='mini'
            type='text'
            shape='circle'
            icon={isFullView ? <OffScreen theme='outline' size='14' /> : <FullScreen theme='outline' size='14' />}
            onClick={() => {
              setIsFullView(!isFullView);
              soundEffects.playClick();
            }}
            className='text-slate-400 hover:text-white'
          />
          {onClose && (
            <Button size='mini' onClick={onClose} className='bg-slate-800 hover:bg-slate-700 text-slate-300'>
              Exit Canvas
            </Button>
          )}
        </div>
      </div>

      {/* Main Canvas & Agent Inspector */}
      <div className='relative z-10 grid grid-cols-1 md:grid-cols-3 gap-16px items-center'>
        {/* Swarm Graph Visualization Canvas */}
        <div className='col-span-2 relative min-h-260px flex items-center justify-center p-20px rounded-10px border-1px border-solid border-slate-800/60 bg-slate-950/50'>
          {/* Animated SVG Delegation Flow Vectors */}
          <svg className='absolute inset-0 w-full h-full pointer-events-none' xmlns='http://www.w3.org/2000/svg'>
            <line
              x1='50%'
              y1='50%'
              x2='25%'
              y2='25%'
              stroke='rgba(6,182,212,0.3)'
              strokeWidth='2'
              strokeDasharray='4 4'
            />
            <line
              x1='50%'
              y1='50%'
              x2='75%'
              y2='25%'
              stroke='rgba(16,185,129,0.3)'
              strokeWidth='2'
              strokeDasharray='4 4'
            />
            <line
              x1='50%'
              y1='50%'
              x2='50%'
              y2='80%'
              stroke='rgba(99,102,241,0.3)'
              strokeWidth='2'
              strokeDasharray='4 4'
            />
          </svg>

          {/* Dynamic Nodes Grid */}
          <div className='relative w-full h-full flex flex-wrap items-center justify-around gap-20px z-10'>
            {agents.map((agent) => {
              const isSelected = agent.id === selectedAgentId;
              const isThinking = agent.status === 'thinking';
              return (
                <div
                  key={agent.id}
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                    soundEffects.playClick();
                  }}
                  className={`relative flex flex-col items-center p-12px rounded-12px border-1px border-solid cursor-pointer transition-all duration-200 backdrop-blur-md min-w-130px ${
                    isSelected
                      ? 'bg-slate-800/90 border-cyan-400/80 shadow-[0_0_16px_rgba(6,182,212,0.3)] scale-105'
                      : 'bg-slate-900/60 border-slate-700/60 hover:border-slate-500'
                  }`}
                >
                  {isThinking && (
                    <span className='animate-ping absolute -top-4px -right-4px inline-flex h-12px w-12px rounded-full bg-cyan-400 opacity-75' />
                  )}

                  <div className='p-8px rounded-full bg-slate-800/80 mb-6px border-1px border-solid border-slate-700'>
                    {getAgentIcon(agent.avatarIcon)}
                  </div>

                  <span className='font-semibold text-12px text-center mb-2px text-slate-100 truncate w-full'>
                    {agent.name}
                  </span>

                  <Tag
                    size='small'
                    color={agent.status === 'thinking' ? 'cyan' : agent.status === 'completed' ? 'green' : 'gray'}
                    className='capitalize text-10px'
                  >
                    {agent.status}
                  </Tag>

                  {agent.activeTool && (
                    <div className='mt-6px flex items-center gap-3px px-6px py-2px rounded-4px bg-cyan-950/80 border-1px border-solid border-cyan-800 text-9px text-cyan-300 font-mono'>
                      <Lightning theme='outline' size='10' />
                      <span className='truncate'>{agent.activeTool}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Agent Inspector Panel */}
        <div className='p-12px rounded-10px border-1px border-solid border-slate-800/80 bg-slate-900/80 flex flex-col justify-between min-h-260px'>
          <div>
            <div className='flex items-center gap-8px mb-8px pb-6px border-b-1px border-solid border-slate-800'>
              {getAgentIcon(selectedAgent.avatarIcon)}
              <div>
                <div className='font-bold text-13px text-white'>{selectedAgent.name}</div>
                <div className='text-10px text-slate-400'>{selectedAgent.id}</div>
              </div>
            </div>

            <div className='text-11px text-slate-300 mb-12px leading-relaxed'>{selectedAgent.role}</div>

            <div className='flex flex-col gap-6px text-11px text-slate-400'>
              <div className='flex justify-between py-2px border-b-1px border-solid border-slate-800/40'>
                <span>State:</span>
                <span className='font-semibold text-cyan-400 capitalize'>{selectedAgent.status}</span>
              </div>
              <div className='flex justify-between py-2px border-b-1px border-solid border-slate-800/40'>
                <span>Active Tool:</span>
                <span className='font-mono text-slate-200'>{selectedAgent.activeTool || 'None (Idle)'}</span>
              </div>
              <div className='flex justify-between py-2px'>
                <span>Tokens Consumed:</span>
                <span className='font-mono text-emerald-400'>{selectedAgent.tokensProcessed.toLocaleString()} tok</span>
              </div>
            </div>
          </div>

          <div className='pt-8px border-t-1px border-solid border-slate-800 text-10px text-slate-500 italic'>
            Real-time agent stream wired to WE ACP orchestrator.
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentWarRoom;
