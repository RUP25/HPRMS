/// <reference types="vite/client" />

declare global {
  interface Window {
    HPRMS: {
      api: (
        path: string,
        opts?: RequestInit & { body?: unknown; skipGuestHeader?: boolean },
      ) => Promise<unknown>;
      fmtMoney: (n: number) => string;
      fmtTime: (iso: string) => string;
      toast: (msg: string) => void;
      connectSocket: (
        rooms: string[],
        opts?: {
          auth?: Record<string, unknown>;
          operatorToken?: string;
          guestTableId?: number;
          guestToken?: string;
        },
      ) => {
        on: (ev: string, fn: (...args: unknown[]) => void) => void;
      };
      setTableGuestAuth: (tableId: number, token: string) => void;
      setOperatorToken: (token: string | null) => void;
      clearOperatorToken: () => void;
      getOperatorToken: () => string | null;
    };
    HPRMSNotify?: {
      requestDesktop: () => void;
      chord: (kind: string) => void;
    };
    io: (opts?: unknown) => {
      on: (ev: string, fn: (...args: unknown[]) => void) => void;
      emit: (ev: string, ...args: unknown[]) => void;
      disconnect: () => void;
    };
  }
}

export {};
