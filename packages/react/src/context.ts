import type { KheopskitState } from "@kheopskit/core";
import { createContext } from "react";

export const KheopskitContext = createContext<{
  state: KheopskitState;
} | null>(null);
