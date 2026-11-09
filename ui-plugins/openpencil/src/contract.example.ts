import { designRef, type DesignDocument, type DesignRef } from "#openpencil/contract.ts";
export const designExample: DesignDocument = {
  id: "d0123456789ab",
  path: "designs/landing.fig",
  name: "landing",
  format: "fig",
  revision: 1,
  byteLength: 1024,
  hash: "sha256:demo",
  owner: "file",
  dirty: false,
  externalChange: false,
};
export const designRefExample: DesignRef = designRef(designExample);
