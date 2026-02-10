import { TenantRole } from "../types/auth";

export type PanelRole =
  | "admin_geral"
  | "pastor_presidente"
  | "pastor_rede"
  | "lider_celula"
  | "secretaria";

export type ModuleKey =
  | "dashboard"
  | "cells_admin"
  | "discipleship"
  | "consolidation"
  | "leadership_school"
  | "pastor_presidente"
  | "pastor_rede"
  | "lider_celula"
  | "email";

export type ActionKey = "view" | "create" | "edit" | "delete" | "export" | "print";

export type ScopeKind = "all" | "network" | "cell";

export type PermissionMatrix = Record<ModuleKey, ActionKey[]>;

type RolePermissions = {
  scope: ScopeKind;
  modules: PermissionMatrix;
};

const allActions: ActionKey[] = ["view", "create", "edit", "delete", "export", "print"];
const readActions: ActionKey[] = ["view", "export", "print"];
const editorActions: ActionKey[] = ["view", "create", "edit", "export", "print"];

const rolePermissions: Record<PanelRole, RolePermissions> = {
  admin_geral: {
    scope: "all",
    modules: {
      dashboard: allActions,
      cells_admin: allActions,
      discipleship: allActions,
      consolidation: allActions,
      leadership_school: allActions,
      pastor_presidente: allActions,
      pastor_rede: allActions,
      lider_celula: allActions,
      email: allActions
    }
  },
  pastor_presidente: {
    scope: "all",
    modules: {
      dashboard: readActions,
      cells_admin: editorActions,
      discipleship: readActions,
      consolidation: editorActions,
      leadership_school: readActions,
      pastor_presidente: editorActions,
      pastor_rede: readActions,
      lider_celula: readActions,
      email: editorActions
    }
  },
  pastor_rede: {
    scope: "network",
    modules: {
      dashboard: readActions,
      cells_admin: ["view"],
      discipleship: readActions,
      consolidation: editorActions,
      leadership_school: readActions,
      pastor_presidente: [],
      pastor_rede: editorActions,
      lider_celula: readActions,
      email: editorActions
    }
  },
  lider_celula: {
    scope: "cell",
    modules: {
      dashboard: readActions,
      cells_admin: ["view"],
      discipleship: editorActions,
      consolidation: editorActions,
      leadership_school: readActions,
      pastor_presidente: [],
      pastor_rede: [],
      lider_celula: editorActions,
      email: editorActions
    }
  },
  secretaria: {
    scope: "all",
    modules: {
      dashboard: readActions,
      cells_admin: editorActions,
      discipleship: editorActions,
      consolidation: editorActions,
      leadership_school: readActions,
      pastor_presidente: readActions,
      pastor_rede: readActions,
      lider_celula: readActions,
      email: editorActions
    }
  }
};

const roleAliases: Partial<Record<TenantRole, PanelRole>> = {
  owner: "admin_geral",
  admin: "admin_geral",
  leader: "lider_celula",
  member: "lider_celula"
};

export function normalizePanelRole(role: TenantRole): PanelRole {
  return roleAliases[role] ?? (role as PanelRole);
}

export function getRoleScope(role: PanelRole): ScopeKind {
  return rolePermissions[role].scope;
}

export function getRolePermissions(role: PanelRole): PermissionMatrix {
  return rolePermissions[role].modules;
}

export function canAccess(role: PanelRole, module: ModuleKey, action: ActionKey): boolean {
  return rolePermissions[role].modules[module].includes(action);
}
