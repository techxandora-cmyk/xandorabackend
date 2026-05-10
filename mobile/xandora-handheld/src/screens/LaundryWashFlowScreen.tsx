import React from 'react';
import LaundryActionWorkspace from '../components/LaundryActionWorkspace';
import { brand } from '../theme/brand';

export default function LaundryWashFlowScreen({ navigation }: any) {
  return (
    <LaundryActionWorkspace
      navigation={navigation}
      title="Wash Flow"
      eyebrow="Wash cycle"
      helper="Two steps: load fabrics into the washer (Wash Start), then scan them back out when clean (Wash Complete) to increment the cycle count and return items to ready stock."
      options={[
        {
          key: 'wash_start',
          label: 'Wash Start',
          subtitle: 'Scan fabrics as they go into the washer. Status moves to In Wash.',
          buttonLabel: 'Start Wash',
          locationDefault: 'Laundry wash',
          accent: brand.colors.success,
        },
        {
          key: 'wash_complete',
          label: 'Wash Complete',
          subtitle: 'Scan clean fabrics coming out. Returns to stock and adds one wash cycle.',
          buttonLabel: 'Confirm Wash',
          locationDefault: 'Laundry wash',
          accent: brand.colors.blue,
        },
      ]}
    />
  );
}
