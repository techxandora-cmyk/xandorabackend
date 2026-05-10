import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import ScannerDeviceSheet from './src/components/ScannerDeviceSheet';
import { ScannerProvider } from './src/context/ScannerContext';
import { ThemeProvider } from './src/context/ThemeContext';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ScannerProvider>
          <AppNavigator />
          <ScannerDeviceSheet />
        </ScannerProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
