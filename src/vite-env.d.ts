/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** ICP filing number text (e.g. `蜀ICP备2026001166号-1`). Empty → not rendered. */
  readonly VITE_BEIAN_ICP_TEXT?: string;
  /** Optional override for the ICP link target. Defaults to the MIIT portal. */
  readonly VITE_BEIAN_ICP_URL?: string;
  /** 公安备案 number text (e.g. `川公网安备51070402110341号`). Empty → not rendered. */
  readonly VITE_BEIAN_MPS_TEXT?: string;
  /** Full beian.mps.gov.cn query URL for the MPS record. Required when MPS_TEXT is set. */
  readonly VITE_BEIAN_MPS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
