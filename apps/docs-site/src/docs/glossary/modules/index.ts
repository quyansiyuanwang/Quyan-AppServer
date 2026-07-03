import type { GlossaryModule } from "@/docs/glossary/types";
import core from "./core";
import apiAuth from "./api-auth";
import relayOps from "./relay-ops";
import billing from "./billing";
import security from "./security";
import systemMonitoring from "./system-monitoring";
import oj from "./oj";

export const glossaryModules: GlossaryModule[] = [
  core,
  apiAuth,
  relayOps,
  billing,
  security,
  systemMonitoring,
  oj,
];
