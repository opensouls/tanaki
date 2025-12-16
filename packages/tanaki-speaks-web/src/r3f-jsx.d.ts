declare global {
  namespace JSX {
    // Minimal shim: some TS programs in this monorepo don't pick up R3F's JSX
    // intrinsic element augmentation, so `<primitive />` can fail type-checking.
    // We keep this intentionally narrow to avoid affecting other JSX tags.
    interface IntrinsicElements {
      primitive: any;
    }
  }
}

export {};


