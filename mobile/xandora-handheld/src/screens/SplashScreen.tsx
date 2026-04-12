import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import BrandMark from '../components/BrandMark';
import { useAppTheme } from '../context/ThemeContext';
import { getAuthSession } from '../services/session';
import { brand } from '../theme/brand';

export default function SplashScreen({ navigation }: any) {
  const { theme, mode } = useAppTheme();

  useEffect(() => {
    const checkLogin = async () => {
      const session = await getAuthSession();

      setTimeout(() => {
        if (session?.token) {
          navigation.replace('Home', { username: session.displayName });
        } else {
          navigation.replace('Login');
        }
      }, 1800);
    };

    checkLogin();
  }, [navigation]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.glowOne,
          { backgroundColor: brand.colors.violet, opacity: mode === 'dark' ? 0.24 : 0.16 },
        ]}
      />
      <View
        style={[
          styles.glowTwo,
          { backgroundColor: brand.colors.aqua, opacity: mode === 'dark' ? 0.2 : 0.16 },
        ]}
      />
      <View
        style={[
          styles.glowThree,
          { backgroundColor: brand.colors.blue, opacity: mode === 'dark' ? 0.16 : 0.12 },
        ]}
      />
      <BrandMark size="lg" light={mode === 'dark'} subtitle={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowOne: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    top: 140,
    left: 30,
  },
  glowTwo: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    bottom: 120,
    right: 20,
  },
  glowThree: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    bottom: 220,
    left: 80,
  },
});
