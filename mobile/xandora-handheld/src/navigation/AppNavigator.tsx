import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import AssignItemsScreen from '../screens/AssignItemsScreen';
import AssignStoreScreen from '../screens/AssignStoreScreen';
import AuditScreen from '../screens/AuditScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import PosValidateScreen from '../screens/PosValidateScreen';
import ReaderHealthScreen from '../screens/ReaderHealthScreen';
import ItemStatusScreen from '../screens/ItemStatusScreen';
import StockAuditSessionScreen from '../screens/StockAuditSessionScreen';
import StockAuditCountScreen from '../screens/StockAuditCountScreen';
import StockAuditFindingsScreen from '../screens/StockAuditFindingsScreen';
import StockAuditHistoryScreen from '../screens/StockAuditHistoryScreen';
import LaundryInboundScreen from '../screens/LaundryInboundScreen';
import LaundryAssignItemsScreen from '../screens/LaundryAssignItemsScreen';
import LaundryWashFlowScreen from '../screens/LaundryWashFlowScreen';
import LaundryStatusScreen from '../screens/LaundryStatusScreen';
import LaundryExceptionsScreen from '../screens/LaundryExceptionsScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="AssignItems" component={AssignItemsScreen} />
        <Stack.Screen name="AssignStore" component={AssignStoreScreen} />
        <Stack.Screen name="Audit" component={AuditScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="PosValidate" component={PosValidateScreen} />
        <Stack.Screen name="ItemStatus" component={ItemStatusScreen} />
        <Stack.Screen name="ReaderHealth" component={ReaderHealthScreen} />
        <Stack.Screen name="StockAuditSession" component={StockAuditSessionScreen} />
        <Stack.Screen name="StockAuditCount" component={StockAuditCountScreen} />
        <Stack.Screen name="StockAuditFindings" component={StockAuditFindingsScreen} />
        <Stack.Screen name="StockAuditHistory" component={StockAuditHistoryScreen} />
        <Stack.Screen name="LaundryInbound" component={LaundryInboundScreen} />
        <Stack.Screen name="LaundryAssignItems" component={LaundryAssignItemsScreen} />
        <Stack.Screen name="LaundryWashFlow" component={LaundryWashFlowScreen} />
        <Stack.Screen name="LaundryStatus" component={LaundryStatusScreen} />
        <Stack.Screen name="LaundryExceptions" component={LaundryExceptionsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
