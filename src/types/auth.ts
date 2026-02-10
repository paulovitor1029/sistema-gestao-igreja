export const tenantRoles = [
  "owner",
  "admin",
  "leader",
  "member",
  "admin_geral",
  "pastor_presidente",
  "pastor_rede",
  "lider_celula",
  "secretaria"
] as const;
export type TenantRole = (typeof tenantRoles)[number];

export type AuthPayload = {
  userId: string;
  tenantId: string;
  role: TenantRole;
};
