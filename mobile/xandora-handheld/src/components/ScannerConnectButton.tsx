import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useScanner } from '../context/ScannerContext';
import { useAppTheme } from '../context/ThemeContext';

type ScannerConnectButtonProps = {
  compact?: boolean;
  emojiOnly?: boolean;
  connectedLabel?: string;
  disconnectedLabel?: string;
  variant?: 'default' | 'status';
};

export default function ScannerConnectButton({
  compact = false,
  emojiOnly = false,
  connectedLabel = 'Scanner Online',
  disconnectedLabel = 'Scanner Offline',
  variant = 'default',
}: ScannerConnectButtonProps) {
  const {
    scannerConnected,
    scannerConnecting,
    connectedDevice,
    openScannerPicker,
  } = useScanner();
  const { theme } = useAppTheme();
  const isStatusVariant = variant === 'status';

  const handlePress = () => {
    openScannerPicker();
  };

  return (
    <TouchableOpacity
      style={[
        styles.button,
        emojiOnly && styles.emojiButton,
        compact && styles.compactButton,
        isStatusVariant && styles.statusButton,
        {
          backgroundColor: emojiOnly
            ? scannerConnected
              ? theme.accent
              : theme.surfaceRaised
            : isStatusVariant
            ? scannerConnected
              ? theme.accentSoft
              : theme.surfaceAlt
            : scannerConnected
              ? theme.accent
              : theme.primary,
          borderColor:
            !emojiOnly && isStatusVariant
              ? scannerConnected
                ? theme.accentStrong
                : theme.border
              : 'transparent',
        },
      ]}
      onPress={handlePress}
    >
      <Text
        style={[
          styles.text,
          compact && styles.compactText,
          emojiOnly && styles.emojiText,
          isStatusVariant && styles.statusText,
          emojiOnly && { color: scannerConnected ? theme.primary : theme.text },
          !emojiOnly &&
            isStatusVariant && {
              color: scannerConnected ? theme.accentStrong : theme.textMuted,
            },
          !emojiOnly && scannerConnected && { color: theme.primary },
        ]}
      >
        {emojiOnly
          ? scannerConnected
            ? '\u{1F4E1}'
            : '\u{1F4F6}'
          : scannerConnecting
          ? 'Connecting...'
          : scannerConnected
          ? compact && connectedDevice?.name
            ? connectedDevice.name
            : connectedLabel
          : disconnectedLabel}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  compactButton: {
    marginBottom: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emojiButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginBottom: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  statusButton: {
    borderRadius: 999,
    shadowOpacity: 0,
    elevation: 0,
  },
  compactText: {
    fontSize: 13,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  emojiText: {
    fontSize: 19,
    lineHeight: 22,
  },
});
