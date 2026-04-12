import React from 'react';
import LaundryActionWorkspace from '../components/LaundryActionWorkspace';
import { brand } from '../theme/brand';

export default function LaundryInboundScreen({ navigation }: any) {
  return (
    <LaundryActionWorkspace
      navigation={navigation}
      title="Receive & Deliver"
      eyebrow="Customer flow"
      helper="Choose Receive Back or Deliver, pick the store, set the batch size, then scan until the count matches."
      requireExpectedCount
      options={[
        {
          key: 'receive',
          label: 'Receive',
          subtitle: 'Receive returned fabrics back into tracked stock.',
          buttonLabel: 'Complete Receive',
          locationDefault: 'Customer return',
          accent: brand.colors.blue,
        },
        {
          key: 'dispatch',
          label: 'Deliver',
          subtitle: 'Hand cleaned fabrics over to the customer location.',
          buttonLabel: 'Complete Delivery',
          locationDefault: 'Customer delivery',
          accent: brand.colors.blue,
        },
      ]}
    />
  );
}
