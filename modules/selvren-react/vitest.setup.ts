declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// happy-dom does not set this; React `act()` requires it.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export {};
