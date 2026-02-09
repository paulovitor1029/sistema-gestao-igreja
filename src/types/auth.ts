export const tenantRoles = ["owner", "admin", "leader", "member"] as const;
export type TenantRole = (typeof tenantRoles)[number];

export type AuthPayload = {
  userId: string;
  tenantId: string;
  role: TenantRole;
};
