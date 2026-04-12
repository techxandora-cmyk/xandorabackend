/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock(
  '@react-native-async-storage/async-storage',
  () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-bluetooth-classic', () => {
  const subscription = { remove: jest.fn() };

  return {
    __esModule: true,
    default: {
      isBluetoothAvailable: jest.fn().mockResolvedValue(true),
      isBluetoothEnabled: jest.fn().mockResolvedValue(false),
      requestBluetoothEnabled: jest.fn().mockResolvedValue(false),
      getBondedDevices: jest.fn().mockResolvedValue([]),
      getConnectedDevices: jest.fn().mockResolvedValue([]),
      connectToDevice: jest.fn(),
      startDiscovery: jest.fn().mockResolvedValue([]),
      openBluetoothSettings: jest.fn(),
      onStateChanged: jest.fn(() => subscription),
      onDeviceDisconnected: jest.fn(() => subscription),
      onDeviceConnected: jest.fn(() => subscription),
    },
  };
});

jest.mock('../src/navigation/AppNavigator', () => {
  const MockReact = require('react');
  const { Text } = require('react-native');

  return function MockAppNavigator() {
    return MockReact.createElement(Text, null, 'Mock Navigator');
  };
});

jest.mock('../src/components/ScannerDeviceSheet', () => {
  const MockReact = require('react');
  return function MockScannerDeviceSheet() {
    return MockReact.createElement(MockReact.Fragment, null);
  };
});

jest.mock('../src/context/ScannerContext', () => {
  const MockReact = require('react');

  return {
    ScannerProvider: ({ children }: { children: React.ReactNode }) =>
      MockReact.createElement(MockReact.Fragment, null, children),
    useScanner: () => ({
      scannerConnected: false,
      scannerConnecting: false,
      scannerDiscovering: false,
      scannerAvailable: true,
      bluetoothEnabled: false,
      scannerError: '',
      connectedDevice: null,
      pairedDevices: [],
      discoveredDevices: [],
      scannerPickerVisible: false,
      connectScanner: jest.fn(),
      disconnectScanner: jest.fn(),
      refreshScannerDevices: jest.fn(),
      discoverScannerDevices: jest.fn(),
      requestBluetoothReady: jest.fn().mockResolvedValue(false),
      openScannerPicker: jest.fn(),
      closeScannerPicker: jest.fn(),
      openBluetoothSettings: jest.fn(),
      addScanListener: jest.fn(() => jest.fn()),
    }),
    useScannerInput: jest.fn(),
  };
});

import App from '../App';

test('renders correctly', () => {
  ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
