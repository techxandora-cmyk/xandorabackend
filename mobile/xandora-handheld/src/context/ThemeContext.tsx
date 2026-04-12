import React, { createContext, useContext, useMemo, useState } from 'react';
import { brand } from '../theme/brand';

export type ThemeMode = 'light' | 'dark';

const palettes = {
  light: {
    mode: 'light' as ThemeMode,
    background: '#F2F9FF',
    backgroundAlt: '#F8FBFF',
    surface: 'rgba(255,255,255,0.92)',
    surfaceAlt: '#EEF5FC',
    surfaceStrong: '#E2EDF7',
    surfaceRaised: '#FFFFFF',
    text: brand.colors.navy,
    textMuted: brand.colors.slate,
    textOnBrand: '#FFFFFF',
    border: brand.colors.cloud,
    shadow: brand.colors.navy,
    primary: brand.colors.blue,
    secondary: brand.colors.navy,
    accent: brand.colors.aqua,
    accentStrong: brand.colors.aqua,
    accentSoft: 'rgba(22,249,243,0.12)',
    violetSoft: 'rgba(140,17,231,0.1)',
    blueSoft: 'rgba(65,142,218,0.12)',
    goldSoft: 'rgba(197,138,29,0.12)',
    success: brand.colors.success,
    danger: brand.colors.danger,
    drawer: 'rgba(248,251,255,0.98)',
    cardDark: '#11243A',
    cardDarkBorder: '#294666',
    overlay: 'rgba(0,0,0,0.35)',
    toggleTrack: '#D9E6F2',
    toggleThumb: brand.colors.violet,
    glowPrimary: 'rgba(65,142,218,0.16)',
    glowAccent: 'rgba(22,249,243,0.14)',
    glowViolet: 'rgba(140,17,231,0.15)',
  },
  dark: {
    mode: 'dark' as ThemeMode,
    background: '#091523',
    backgroundAlt: '#0E1A2A',
    surface: 'rgba(16,27,43,0.96)',
    surfaceAlt: '#132134',
    surfaceStrong: '#18283D',
    surfaceRaised: '#16263B',
    text: '#F2F9FF',
    textMuted: '#B6C3D1',
    textOnBrand: '#FFFFFF',
    border: '#243547',
    shadow: '#000000',
    primary: brand.colors.blue,
    secondary: brand.colors.blue,
    accent: brand.colors.aqua,
    accentStrong: brand.colors.aqua,
    accentSoft: 'rgba(22,249,243,0.14)',
    violetSoft: 'rgba(140,17,231,0.18)',
    blueSoft: 'rgba(65,142,218,0.18)',
    goldSoft: 'rgba(197,138,29,0.18)',
    success: '#19B8A2',
    danger: '#F46A73',
    drawer: 'rgba(11,24,39,0.98)',
    cardDark: '#132949',
    cardDarkBorder: '#2E4D75',
    overlay: 'rgba(0,0,0,0.45)',
    toggleTrack: '#21344F',
    toggleThumb: brand.colors.aqua,
    glowPrimary: 'rgba(65,142,218,0.22)',
    glowAccent: 'rgba(22,249,243,0.16)',
    glowViolet: 'rgba(140,17,231,0.24)',
  },
};

type ThemeContextValue = {
  mode: ThemeMode;
  theme: (typeof palettes)['light'];
  toggleMode: () => void;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [mode, setMode] = useState<ThemeMode>('light');

  const value = useMemo(
    () => ({
      mode,
      theme: palettes[mode],
      toggleMode: () =>
        setMode(currentMode => (currentMode === 'light' ? 'dark' : 'light')),
      setMode,
    }),
    [mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useAppTheme = () => {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useAppTheme must be used inside ThemeProvider');
  }

  return context;
};
