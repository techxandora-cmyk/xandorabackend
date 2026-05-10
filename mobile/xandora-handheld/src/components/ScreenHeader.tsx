import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../context/ThemeContext';

type ScreenHeaderProps = {
  title: string;
  onBack?: () => void;
};

export default function ScreenHeader({ title, onBack }: ScreenHeaderProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isCompact = width < 390;

  return (
    <View
      style={[
        styles.header,
        isCompact && styles.headerCompact,
        { paddingTop: Math.max(insets.top + 6, 18) },
      ]}
    >
      <View style={styles.side}>
        {onBack ? (
          <TouchableOpacity
            style={[
              styles.backButton,
              {
                backgroundColor: theme.surfaceRaised,
                borderColor: theme.accentSoft,
                shadowColor: theme.shadow,
              },
            ]}
            onPress={onBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.88}
          >
            <Text style={[styles.backText, { color: theme.primary }]}>{'\u2039'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text
        style={[
          styles.title,
          isCompact && styles.titleCompact,
          { color: theme.text },
        ]}
        numberOfLines={1}
      >
        {title}
      </Text>

      <View style={[styles.side, styles.rightSide]} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  headerCompact: {
    marginBottom: 18,
  },
  side: {
    width: 48,
    alignItems: 'flex-start',
  },
  rightSide: {
    alignItems: 'flex-end',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  backText: {
    fontSize: 28,
    fontWeight: '700',
    marginTop: -2,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '700',
  },
  titleCompact: {
    fontSize: 21,
  },
});
