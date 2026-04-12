export type MobileProductKey = 'retail' | 'laundry' | 'stock_audit';

export type SoftwareOption = {
  value: MobileProductKey;
  label: string;
  shortLabel: string;
  kicker: string;
  summary: string;
  helper: string;
  heroSummary: string;
};

export const DEFAULT_PRODUCT_KEY: MobileProductKey = 'retail';

export const SOFTWARE_OPTIONS: SoftwareOption[] = [
  {
    value: 'retail',
    label: 'Xandora Retail',
    shortLabel: 'Retail',
    kicker: 'Operational floor',
    summary: 'POS validation, stock visibility, device visibility, and alerts.',
    helper: 'For retail store and operations teams.',
    heroSummary: 'Smart RFID assignment, store movement, and live retail operations.',
  },
  {
    value: 'laundry',
    label: 'Xandora Laundry',
    shortLabel: 'Laundry',
    kicker: 'Lifecycle tracking',
    summary: 'Fabric movements, wash cycles, returns, losses, and retirement.',
    helper: 'For fabric tracking and laundry lifecycle operations.',
    heroSummary: 'Laundry scanning, item movement, and workflow visibility on the floor.',
  },
  {
    value: 'stock_audit',
    label: 'Xandora Stock Audit',
    shortLabel: 'Stock Audit',
    kicker: 'Count assurance',
    summary: 'Cycle counts, scan verification, discrepancy review, and stocktake control.',
    helper: 'For audits, stock counts, and reconciliation workflows.',
    heroSummary: 'Verification, count assurance, and reconciliation workflows with RFID.',
  },
];

export function isMobileProductKey(value: unknown): value is MobileProductKey {
  return SOFTWARE_OPTIONS.some((option) => option.value === value);
}

export function getSoftwareOption(productKey?: string): SoftwareOption {
  return (
    SOFTWARE_OPTIONS.find((option) => option.value === productKey) ||
    SOFTWARE_OPTIONS.find((option) => option.value === DEFAULT_PRODUCT_KEY) ||
    SOFTWARE_OPTIONS[0]
  );
}
