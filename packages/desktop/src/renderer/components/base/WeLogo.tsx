/**
 * @license
 * Copyright 2026 WE (we.app)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface WeLogoProps {
  size?: number | string;
  className?: string;
  withGlow?: boolean;
  withTile?: boolean;
  withWordmark?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export const WeLogo: React.FC<WeLogoProps> = ({
  size = 24,
  className = '',
  withGlow = true,
  withTile = false,
  withWordmark = false,
  onClick,
}) => {
  const dimension = typeof size === 'number' ? `${size}px` : size;

  return (
    <div
      className={`inline-flex items-center gap-8px select-none ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      <svg
        width={dimension}
        height={dimension}
        viewBox='0 0 100 100'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        className='shrink-0 transition-transform duration-200 hover:scale-105'
      >
        <defs>
          <linearGradient id='weBrandGradComponent' x1='0%' y1='0%' x2='100%' y2='100%'>
            <stop offset='0%' stopColor='#06B6D4' />
            <stop offset='60%' stopColor='#10B981' />
            <stop offset='100%' stopColor='#34D399' />
          </linearGradient>
          {withGlow && (
            <filter id='weGlowFilterComponent' x='-20%' y='-20%' width='140%' height='140%'>
              <feDropShadow dx='0' dy='2' stdDeviation='2.5' floodColor='#10B981' floodOpacity='0.4' />
            </filter>
          )}
        </defs>

        {withTile && (
          <rect
            x='4'
            y='4'
            width='92'
            height='92'
            rx='24'
            fill='#0D1117'
            stroke='rgba(255,255,255,0.1)'
            strokeWidth='2'
          />
        )}

        {/* 'W' Ribbon Geometry */}
        <path
          d='M16 32 L28 68 L42 38 L54 68 L63 42'
          stroke='url(#weBrandGradComponent)'
          strokeWidth='7.5'
          strokeLinecap='round'
          strokeLinejoin='round'
          filter={withGlow ? 'url(#weGlowFilterComponent)' : undefined}
        />

        {/* 'E' Ribbon Geometry */}
        <path
          d='M66 32 L86 32 M66 32 L66 68 M66 50 L82 50 M66 68 L86 68'
          stroke='url(#weBrandGradComponent)'
          strokeWidth='7.5'
          strokeLinecap='round'
          strokeLinejoin='round'
          filter={withGlow ? 'url(#weGlowFilterComponent)' : undefined}
        />

        {/* Neural Core Dot */}
        <circle cx='42' cy='38' r='3' fill='#FFFFFF' />
      </svg>

      {withWordmark && (
        <span className='font-bold text-16px tracking-wider uppercase bg-gradient-to-r from-cyan-400 via-emerald-400 to-teal-300 bg-clip-text text-transparent'>
          WE
        </span>
      )}
    </div>
  );
};

export default WeLogo;
