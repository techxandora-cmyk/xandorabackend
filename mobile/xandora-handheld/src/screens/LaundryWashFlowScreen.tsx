import React from 'react';
import LaundryActionWorkspace from '../components/LaundryActionWorkspace';
import { brand } from '../theme/brand';

export default function LaundryWashFlowScreen({ navigation }: any) {
  return (
    <LaundryActionWorkspace
      navigation={navigation}
      title="Wash"
      eyebrow="Wash cycle"
      helper="Scan dropped-off fabrics after washing to return them to ready stock and record the cycle count."
      options={[
        {
          key: 'wash_complete',
          label: 'Wash',
          subtitle: 'Return washed fabrics to stock and add the next wash cycle.',
          buttonLabel: 'Confirm Wash',
          locationDefault: 'Laundry wash',
          accent: brand.colors.blue,
        },
      ]}
    />
  );
}
