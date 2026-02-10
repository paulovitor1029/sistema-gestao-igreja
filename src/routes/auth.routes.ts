import { PoolClient } from "pg";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../common/async-handler";
import { AppError } from "../common/errors";
import { pool } from "../db/pool";
import { signAccessToken } from "../lib/jwt";
import { hashPassword, verifyPassword } from "../lib/password";
import { requireAuth } from "../middlewares/auth.middleware";
import { TenantRole } from "../types/auth";

const registerSchema = z.object({
  churchName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(72)
});

const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(72)
});

const updateMeSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    password: z.string().min(8).max(72).optional()
  })
  .refine((data) => data.name || data.password, {
    message: "Informe ao menos um campo para atualizar."
  });

type MemberRole =
  | "owner"
  | "admin"
  | "leader"
  | "member"
  | "admin_geral"
  | "pastor_presidente"
  | "pastor_rede"
  | "lider_celula"
  | "secretaria";

type SessionRow = {
  user_id: string;
  full_name: string;
  email: string;
  tenant_id: string;
  tenant_name: string;
  role: MemberRole;
};

function normalizeRole(role: MemberRole): TenantRole {
  if (role === "owner" || role === "admin") {
    return "admin_geral";
  }
  if (role === "leader") {
    return "lider_celula";
  }
  return role;
}

function slugifyChurchName(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);

  return base || "igreja";
}

function buildSlugCandidate(base: string, attempt: number): string {
  if (attempt === 0) {
    return base;
  }

  const suffix = String(attempt + 1);
  const maxBaseLength = Math.max(1, 60 - suffix.length - 1);
  return `${base.slice(0, maxBaseLength)}-${suffix}`;
}

async function createTenantWithInternalSlug(
  client: PoolClient,
  churchName: string
): Promise<{ id: string; name: string }> {
  const base = slugifyChurchName(churchName);

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = buildSlugCandidate(base, attempt);
    try {
      const result = await client.query<{ id: string; name: string }>(
        `
          INSERT INTO tenants (name, slug)
          VALUES ($1, $2)
          RETURNING id, name;
        `,
        [churchName, candidate]
      );
      return result.rows[0];
    } catch (error) {
      const dbError = error as { code?: string; constraint?: string };
      if (dbError.code === "23505" && dbError.constraint === "tenants_slug_unique") {
        continue;
      }
      throw error;
    }
  }

  const fallback = `${base.slice(0, 50)}-${Date.now().toString(36)}`.slice(0, 60);
  const result = await client.query<{ id: string; name: string }>(
    `
      INSERT INTO tenants (name, slug)
      VALUES ($1, $2)
      RETURNING id, name;
    `,
    [churchName, fallback]
  );
  return result.rows[0];
}

async function seedInitialTenantData(
  client: PoolClient,
  tenantId: string,
  userId: string,
  userName: string,
  userEmail: string
): Promise<void> {
  const network = await client.query<{ id: string }>(
    `
      INSERT INTO church_networks (tenant_id, name, code)
      VALUES ($1, 'Rede Principal', 'RED-001')
      RETURNING id;
    `,
    [tenantId]
  );

  const cell = await client.query<{ id: string }>(
    `
      INSERT INTO cells (tenant_id, network_id, name, code, leader_user_id, email)
      VALUES ($1, $2, 'Celula Central', 'CEL-001', $3, $4)
      RETURNING id;
    `,
    [tenantId, network.rows[0].id, userId, userEmail]
  );

  await client.query(
    `
      INSERT INTO user_network_scopes (tenant_id, user_id, network_id)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING;
    `,
    [tenantId, userId, network.rows[0].id]
  );

  await client.query(
    `
      INSERT INTO user_cell_scopes (tenant_id, user_id, cell_id)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING;
    `,
    [tenantId, userId, cell.rows[0].id]
  );

  const participantNames = [
    `${userName} Visitante`,
    `${userName} Congregado`,
    `${userName} Membro`
  ];

  for (let index = 0; index < participantNames.length; index += 1) {
    const participant = await client.query<{ id: string }>(
      `
        INSERT INTO participants (tenant_id, full_name, phone_mobile)
        VALUES ($1, $2, $3)
        RETURNING id;
      `,
      [tenantId, participantNames[index], `11999990${index + 10}`]
    );

    const type = index === 0 ? "visitor" : index === 1 ? "congregated" : "member";
    await client.query(
      `
        INSERT INTO participant_cell_links (participant_id, cell_id, tenant_id, type)
        VALUES ($1, $2, $3, $4);
      `,
      [participant.rows[0].id, cell.rows[0].id, tenantId, type]
    );

    await client.query(
      `
        INSERT INTO participant_status_history (
          tenant_id,
          participant_id,
          from_type,
          to_type,
          changed_by_user_id,
          notes
        )
        VALUES ($1, $2, NULL, $3, $4, 'Registro inicial');
      `,
      [tenantId, participant.rows[0].id, type, userId]
    );
  }

  for (let week = 0; week < 4; week += 1) {
    await client.query(
      `
        INSERT INTO attendance_entries (tenant_id, cell_id, week_start, total_attendance)
        VALUES (
          $1,
          $2,
          (date_trunc('week', NOW())::date - ($3::int * 7)),
          (8 + $3::int * 2)
        )
        ON CONFLICT (tenant_id, cell_id, week_start) DO NOTHING;
      `,
      [tenantId, cell.rows[0].id, week]
    );
  }

  await client.query(
    `
      INSERT INTO finance_entries (tenant_id, entry_date, amount, direction, description)
      VALUES
        ($1, CURRENT_DATE, 550.00, 'in', 'Ofertas'),
        ($1, CURRENT_DATE, 210.00, 'out', 'Apoio social');
    `,
    [tenantId]
  );

  await client.query(
    `
      INSERT INTO gd_controls (
        tenant_id,
        network_id,
        cell_id,
        meeting_type,
        leader_name,
        meeting_date,
        meeting_time,
        created_by_user_id
      )
      VALUES ($1, $2, $3, 'gd', $4, CURRENT_DATE, '19:30', $5);
    `,
    [tenantId, network.rows[0].id, cell.rows[0].id, userName, userId]
  );
}

async function getActiveSessionRow(
  client: PoolClient,
  userId: string,
  tenantId: string
): Promise<SessionRow | null> {
  const result = await client.query<SessionRow>(
    `
      SELECT
        u.id AS user_id,
        u.full_name,
        u.email,
        t.id AS tenant_id,
        t.name AS tenant_name,
        tm.role
      FROM users u
      JOIN tenant_members tm
        ON tm.user_id = u.id
       AND tm.tenant_id = $2
       AND tm.is_active = TRUE
      JOIN tenants t
        ON t.id = tm.tenant_id
       AND t.is_active = TRUE
      WHERE u.id = $1
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
      LIMIT 1;
    `,
    [userId, tenantId]
  );

  if (!result.rowCount) {
    return null;
  }

  return result.rows[0];
}

export const authRoutes = Router();

authRoutes.post(
  "/register",
  asyncHandler(async (request, response) => {
    const payload = registerSchema.parse(request.body);

    const email = payload.email.toLowerCase();
    const passwordHash = await hashPassword(payload.password);

    const client = await pool.connect();
    try {
      await client.query("BEGIN;");

      const existingUser = await client.query(
        "SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1;",
        [email]
      );
      if (existingUser.rowCount) {
        throw new AppError("Este e-mail ja esta cadastrado.", 409);
      }

      const tenant = await createTenantWithInternalSlug(client, payload.churchName);

      const userResult = await client.query<{
        id: string;
        full_name: string;
        email: string;
      }>(
        `
          INSERT INTO users (full_name, email, password_hash)
          VALUES ($1, $2, $3)
          RETURNING id, full_name, email;
        `,
        [payload.name, email, passwordHash]
      );

      await client.query(
        `
          INSERT INTO tenant_members (tenant_id, user_id, role)
          VALUES ($1, $2, 'admin_geral');
        `,
        [tenant.id, userResult.rows[0].id]
      );

      await seedInitialTenantData(
        client,
        tenant.id,
        userResult.rows[0].id,
        userResult.rows[0].full_name,
        userResult.rows[0].email
      );

      await client.query("COMMIT;");

      const accessToken = signAccessToken({
        userId: userResult.rows[0].id,
        tenantId: tenant.id,
        role: "admin_geral"
      });

      response.status(201).json({
        message: "Cadastro realizado com sucesso.",
        accessToken,
        user: {
          id: userResult.rows[0].id,
          name: userResult.rows[0].full_name,
          email: userResult.rows[0].email
        },
        tenant: {
          id: tenant.id,
          name: tenant.name
        },
        membership: {
          role: "admin_geral"
        }
      });
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  })
);

authRoutes.post(
  "/login",
  asyncHandler(async (request, response) => {
    const payload = loginSchema.parse(request.body);
    const email = payload.email.toLowerCase();

    const result = await pool.query<
      SessionRow & {
        password_hash: string;
      }
    >(
      `
        SELECT
          u.id AS user_id,
          u.full_name,
          u.email,
          u.password_hash,
          t.id AS tenant_id,
          t.name AS tenant_name,
          tm.role
        FROM users u
        JOIN tenant_members tm
          ON tm.user_id = u.id
         AND tm.is_active = TRUE
        JOIN tenants t
          ON t.id = tm.tenant_id
         AND t.is_active = TRUE
        WHERE lower(u.email) = lower($1)
          AND u.is_active = TRUE
          AND u.deleted_at IS NULL
        ORDER BY tm.created_at ASC, t.name ASC
        LIMIT 1;
      `,
      [email]
    );

    if (!result.rowCount) {
      throw new AppError("Credenciais invalidas.", 401);
    }

    const row = result.rows[0];
    const isValidPassword = await verifyPassword(payload.password, row.password_hash);

    if (!isValidPassword) {
      throw new AppError("Credenciais invalidas.", 401);
    }

    const normalizedRole = normalizeRole(row.role);
    const accessToken = signAccessToken({
      userId: row.user_id,
      tenantId: row.tenant_id,
      role: normalizedRole
    });

    response.status(200).json({
      message: "Login realizado com sucesso.",
      accessToken,
      user: {
        id: row.user_id,
        name: row.full_name,
        email: row.email
      },
      tenant: {
        id: row.tenant_id,
        name: row.tenant_name
      },
      membership: {
        role: normalizedRole
      }
    });
  })
);

authRoutes.get(
  "/me",
  requireAuth,
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const client = await pool.connect();
    try {
      const row = await getActiveSessionRow(client, auth.userId, auth.tenantId);
      if (!row) {
        throw new AppError("Conta nao encontrada para a igreja informada.", 404);
      }

      response.json({
        user: {
          id: row.user_id,
          name: row.full_name,
          email: row.email
        },
        tenant: {
          id: row.tenant_id,
          name: row.tenant_name
        },
        membership: {
          role: normalizeRole(row.role)
        }
      });
    } finally {
      client.release();
    }
  })
);

authRoutes.put(
  "/me",
  requireAuth,
  asyncHandler(async (request, response) => {
    const payload = updateMeSchema.parse(request.body);
    const auth = request.auth!;

    const passwordHash = payload.password
      ? await hashPassword(payload.password)
      : null;

    const result = await pool.query<{
      id: string;
      full_name: string;
      email: string;
    }>(
      `
        UPDATE users u
           SET full_name = COALESCE($1, u.full_name),
               password_hash = COALESCE($2, u.password_hash),
               updated_at = NOW()
         WHERE u.id = $3
           AND u.deleted_at IS NULL
           AND EXISTS (
             SELECT 1
               FROM tenant_members tm
               JOIN tenants t
                 ON t.id = tm.tenant_id
              WHERE tm.user_id = u.id
                AND tm.tenant_id = $4
                AND tm.is_active = TRUE
                AND t.is_active = TRUE
           )
         RETURNING id, full_name, email;
      `,
      [payload.name ?? null, passwordHash, auth.userId, auth.tenantId]
    );

    if (!result.rowCount) {
      throw new AppError("Conta nao encontrada.", 404);
    }

    const row = result.rows[0];
    response.json({
      message: "Conta atualizada com sucesso.",
      user: {
        id: row.id,
        name: row.full_name,
        email: row.email
      }
    });
  })
);

authRoutes.delete(
  "/me",
  requireAuth,
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const client = await pool.connect();

    try {
      await client.query("BEGIN;");

      const membershipUpdate = await client.query(
        `
          UPDATE tenant_members tm
             SET is_active = FALSE,
                 updated_at = NOW()
            FROM tenants t
           WHERE tm.tenant_id = t.id
             AND tm.tenant_id = $1
             AND tm.user_id = $2
             AND tm.is_active = TRUE
             AND t.is_active = TRUE
         RETURNING tm.tenant_id;
        `,
        [auth.tenantId, auth.userId]
      );

      if (!membershipUpdate.rowCount) {
        throw new AppError("Vinculo de conta ja esta inativo.", 404);
      }

      const activeMemberships = await client.query<{ total: string }>(
        `
          SELECT COUNT(*)::text AS total
            FROM tenant_members
           WHERE user_id = $1
             AND is_active = TRUE;
        `,
        [auth.userId]
      );

      const total = Number(activeMemberships.rows[0]?.total ?? "0");
      if (total === 0) {
        await client.query(
          `
            UPDATE users
               SET is_active = FALSE,
                   deleted_at = NOW(),
                   updated_at = NOW()
             WHERE id = $1
               AND deleted_at IS NULL;
          `,
          [auth.userId]
        );
      }

      await client.query("COMMIT;");
      response.status(204).send();
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  })
);
