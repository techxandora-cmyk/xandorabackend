import React from 'react';
import LaundryActionWorkspace from '../components/LaundryActionWorkspace';
import { brand } from '../theme/brand';

export default function LaundryExceptionsScreen({ navigation }: any) {
  return (
    <LaundryActionWorkspace
      navigation={navigation}
      title="Exceptions"
      eyebrow="Issue handling"
      helper="Choose the issue type, select the store, scan the affected fabrics, then save the exception record."
      currentStepLabel="Selected issue"
      batchDetailsLabel="Issue details"
      latestScansLabel="Affected fabrics"
      emptyStateTitle="No fabrics added yet"
      emptyStateText="Scan the fabrics that need attention, then save the exception."
      errorTitle="Exception blocked"
      successTitle="Exception saved"
      resultsKicker="Updated fabrics"
      resultsTitle="Latest exception updates"
      options={[
        {
          key: 'mark_damaged',
          label: 'Damaged',
          subtitle: 'Flag scanned fabrics for damage review or replacement.',
          buttonLabel: 'Save Damage Report',
          locationDefault: 'Damage review',
          accent: brand.colors.blue,
        },
        {
          key: 'mark_lost',
          label: 'Missing',
          subtitle: 'Record fabrics that could not be recovered or located.',
          buttonLabel: 'Save Missing Report',
          locationDefault: 'Missing fabrics',
          accent: brand.colors.blue,
        },
        {
          key: 'retire',
          label: 'Retire',
          subtitle: 'Remove end-of-life fabrics from active circulation.',
          buttonLabel: 'Retire Selected Fabrics',
          locationDefault: 'Retired stock',
          accent: brand.colors.blue,
        },
      ]}
    />
  );
}
