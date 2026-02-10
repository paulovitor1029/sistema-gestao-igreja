import { PoolClient } from "pg";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../common/async-handler";
import { AppError } from "../common/errors";
import { pool } from "../db/pool";
import { requireAuth } from "../middlewares/auth.middleware";
import {
  ActionKey,
  canAccess,
  getRolePermissions,
  getRoleScope,
  ModuleKey,
  normalizePanelRole,
  PanelRole,
  ScopeKind
} from "../panel/permissions";

type AccessContext = {
  userId: string;
  userName: string;
  userEmail: string;
  tenantId: string;
  tenantName: string;
  role: PanelRole;
  scope: ScopeKind;
  networkIds: string[];
  cellIds: string[];
};

type VisibleCell = {
  id: string;
  name: string;
  code: string;
  network_id: string;
  network_name: string;
  leader_name: string | null;
  email: string | null;
  phone: string | null;
};

const transferSchema = z.object({
  sourceCellId: z.string().uuid(),
  destinationCellId: z.string().uuid(),
  participantIds: z.array(z.string().uuid()).min(1)
});

const saveNamesSchema = z.object({
  items: z
    .array(
      z.object({
        code: z.string().min(1).max(60),
        label: z.string().trim().min(2).max(120),
        selected: z.boolean()
      })
    )
    .min(1)
});

const restoreNamesSchema = z.object({
  codes: z.array(z.string().min(1).max(60)).min(1)
});

const gdSchema = z.object({
  cellId: z.string().uuid().optional(),
  networkId: z.string().uuid().optional(),
  meetingType: z.enum(["gd", "cell", "worship"]).default("gd"),
  leaderName: z.string().trim().min(2).max(160),
  meetingDate: z.string().date(),
  meetingTime: z.string().regex(/^\d{2}:\d{2}$/).optional()
});

const emailSchema = z.object({
  targetGroup: z.string().trim().min(1).max(60),
  subject: z.string().trim().min(3).max(200),
  messageHtml: z.string().trim().min(3),
  attachmentName: z.string().trim().max(200).optional(),
  recipientsCount: z.number().int().positive().optional()
});

const promoteSchema = z.object({
  cellId: z.string().uuid()
});

const consolidationSchema = z.object({
  participantId: z.string().uuid().optional(),
  participantName: z.string().trim().min(2).max(160).optional(),
  congregationName: z.string().trim().max(160).optional(),
  requestText: z.string().trim().max(2000).optional(),
  knownBy: z.enum(["tv", "radio", "friends", "cell", "other"]).default("friends"),
  knownByOther: z.string().trim().max(120).optional(),
  historyNote: z.string().trim().max(1500).optional(),
  steps: z
    .object({
      acceptedInChurch: z.boolean().optional(),
      acceptedInChurchDate: z.string().date().optional(),
      fonoVisitDone: z.boolean().optional(),
      fonoVisitDoneDate: z.string().date().optional(),
      firstVisitDone: z.boolean().optional(),
      firstVisitDoneDate: z.string().date().optional(),
      preEncounterDone: z.boolean().optional(),
      preEncounterDoneDate: z.string().date().optional(),
      encounterDone: z.boolean().optional(),
      encounterDoneDate: z.string().date().optional(),
      postEncounterDone: z.boolean().optional(),
      postEncounterDoneDate: z.string().date().optional(),
      reencounterDone: z.boolean().optional(),
      reencounterDoneDate: z.string().date().optional(),
      consolidationDone: z.boolean().optional(),
      consolidationDoneDate: z.string().date().optional(),
      baptized: z.boolean().optional(),
      baptizedDate: z.string().date().optional()
    })
    .optional()
});

function assertPermission(
  ctx: AccessContext,
  module: ModuleKey,
  action: ActionKey
): void {
  if (!canAccess(ctx.role, module, action)) {
    throw new AppError("Voce nao possui permissao para esta acao.", 403);
  }
}

async function loadAccessContext(
  client: PoolClient,
  userId: string,
  tenantId: string
): Promise<AccessContext> {
  const membership = await client.query<{
    user_id: string;
    full_name: string;
    email: string;
    tenant_id: string;
    tenant_name: string;
    role: string;
  }>(
    `
      SELECT
        u.id AS user_id,
        u.full_name,
        u.email,
        t.id AS tenant_id,
        t.name AS tenant_name,
        tm.role::text AS role
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

  if (!membership.rowCount) {
    throw new AppError("Sessao invalida para a igreja selecionada.", 401);
  }

  const row = membership.rows[0];
  const role = normalizePanelRole(row.role as never);
  const scope = getRoleScope(role);

  const networkRows =
    scope === "network"
      ? await client.query<{ network_id: string }>(
          `
            SELECT network_id
              FROM user_network_scopes
             WHERE tenant_id = $1
               AND user_id = $2;
          `,
          [tenantId, userId]
        )
      : { rows: [] as { network_id: string }[] };

  const cellRows =
    scope === "cell"
      ? await client.query<{ cell_id: string }>(
          `
            SELECT cell_id
              FROM user_cell_scopes
             WHERE tenant_id = $1
               AND user_id = $2;
          `,
          [tenantId, userId]
        )
      : { rows: [] as { cell_id: string }[] };

  return {
    userId: row.user_id,
    userName: row.full_name,
    userEmail: row.email,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    role,
    scope,
    networkIds: networkRows.rows.map((item) => item.network_id),
    cellIds: cellRows.rows.map((item) => item.cell_id)
  };
}

async function getVisibleCells(client: PoolClient, ctx: AccessContext): Promise<VisibleCell[]> {
  if (ctx.scope === "network") {
    if (ctx.networkIds.length === 0) {
      return [];
    }

    const result = await client.query<VisibleCell>(
      `
        SELECT
          c.id,
          c.name,
          c.code,
          c.network_id,
          n.name AS network_name,
          u.full_name AS leader_name,
          c.email,
          c.phone
        FROM cells c
        JOIN church_networks n ON n.id = c.network_id
        LEFT JOIN users u ON u.id = c.leader_user_id
        WHERE c.tenant_id = $1
          AND c.is_active = TRUE
          AND c.network_id = ANY($2::uuid[])
        ORDER BY n.name, c.name;
      `,
      [ctx.tenantId, ctx.networkIds]
    );
    return result.rows;
  }

  if (ctx.scope === "cell") {
    if (ctx.cellIds.length === 0) {
      return [];
    }

    const result = await client.query<VisibleCell>(
      `
        SELECT
          c.id,
          c.name,
          c.code,
          c.network_id,
          n.name AS network_name,
          u.full_name AS leader_name,
          c.email,
          c.phone
        FROM cells c
        JOIN church_networks n ON n.id = c.network_id
        LEFT JOIN users u ON u.id = c.leader_user_id
        WHERE c.tenant_id = $1
          AND c.is_active = TRUE
          AND c.id = ANY($2::uuid[])
        ORDER BY n.name, c.name;
      `,
      [ctx.tenantId, ctx.cellIds]
    );
    return result.rows;
  }

  const result = await client.query<VisibleCell>(
    `
      SELECT
        c.id,
        c.name,
        c.code,
        c.network_id,
        n.name AS network_name,
        u.full_name AS leader_name,
        c.email,
        c.phone
      FROM cells c
      JOIN church_networks n ON n.id = c.network_id
      LEFT JOIN users u ON u.id = c.leader_user_id
      WHERE c.tenant_id = $1
        AND c.is_active = TRUE
      ORDER BY n.name, c.name;
    `,
    [ctx.tenantId]
  );
  return result.rows;
}

function toShortCode(value: string): string {
  return value.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function buildMenu(role: PanelRole) {
  const menu = [
    {
      key: "cells",
      label: "Celulas",
      icon: "grid",
      children: [
        { key: "pastor_presidente", label: "Pastor presidente" },
        { key: "pastor_rede", label: "Pastor de rede" },
        { key: "lider_celula", label: "Lider de celula" }
      ]
    },
    {
      key: "cells_admin",
      label: "Administracao de Celulas",
      icon: "shuffle",
      children: [
        { key: "transfer", label: "Transferencia entre celulas" },
        { key: "config", label: "Configuracao de celulas" }
      ]
    },
    { key: "discipleship", label: "Discipulado", icon: "users", children: [] },
    { key: "consolidation", label: "Consolidacao", icon: "clipboard", children: [] },
    {
      key: "leadership_school",
      label: "Escola de lideres",
      icon: "school",
      children: []
    }
  ];

  if (role === "pastor_presidente") {
    return menu.map((item) =>
      item.key === "cells"
        ? {
            ...item,
            children: item.children.filter((child) => child.key === "pastor_presidente")
          }
        : item
    );
  }

  if (role === "pastor_rede") {
    return menu.map((item) =>
      item.key === "cells"
        ? {
            ...item,
            children: item.children.filter((child) => child.key === "pastor_rede")
          }
        : item
    );
  }

  if (role === "lider_celula") {
    return menu.map((item) =>
      item.key === "cells"
        ? {
            ...item,
            children: item.children.filter((child) => child.key === "lider_celula")
          }
        : item
    );
  }

  return menu;
}

export const panelRoutes = Router();

panelRoutes.use(requireAuth);

panelRoutes.get(
  "/me",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      response.json({
        user: {
          id: ctx.userId,
          name: ctx.userName,
          email: ctx.userEmail
        },
        tenant: {
          id: ctx.tenantId,
          name: ctx.tenantName
        },
        role: ctx.role,
        scope: ctx.scope,
        permissions: getRolePermissions(ctx.role),
        menu: buildMenu(ctx.role)
      });
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/search",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const q = String(request.query.q ?? "").trim();
    if (q.length < 2) {
      response.json({ items: [] });
      return;
    }

    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      const visibleCells = await getVisibleCells(client, ctx);
      const cellIds = visibleCells.map((cell) => cell.id);
      if (cellIds.length === 0) {
        response.json({ items: [] });
        return;
      }

      const participants = await client.query<{ id: string; full_name: string }>(
        `
          SELECT DISTINCT p.id, p.full_name
            FROM participants p
            JOIN participant_cell_links pcl
              ON pcl.participant_id = p.id
             AND pcl.is_active = TRUE
           WHERE p.tenant_id = $1
             AND pcl.cell_id = ANY($2::uuid[])
             AND p.full_name ILIKE $3
           ORDER BY p.full_name
           LIMIT 10;
        `,
        [ctx.tenantId, cellIds, `%${q}%`]
      );

      const cells = visibleCells
        .filter(
          (cell) =>
            cell.name.toLowerCase().includes(q.toLowerCase()) ||
            cell.code.toLowerCase().includes(q.toLowerCase())
        )
        .slice(0, 10)
        .map((cell) => ({
          type: "cell",
          id: cell.id,
          title: cell.name,
          subtitle: `Codigo ${cell.code}`
        }));

      response.json({
        items: [
          ...cells,
          ...participants.rows.map((row) => ({
            type: "participant",
            id: row.id,
            title: row.full_name,
            subtitle: "Participante"
          }))
        ]
      });
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/dashboard",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const month = Number(request.query.month ?? new Date().getMonth() + 1);
    const year = Number(request.query.year ?? new Date().getFullYear());

    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "dashboard", "view");
      const visibleCells = await getVisibleCells(client, ctx);
      const cellIds = visibleCells.map((cell) => cell.id);

      if (cellIds.length === 0) {
        response.json({
          kpis: { cells: 0, participants: 0, visitors: 0, financeIn: 0, financeOut: 0 },
          attendanceByWeek: []
        });
        return;
      }

      const participants = await client.query<{ total: string }>(
        `
          SELECT COUNT(DISTINCT pcl.participant_id)::text AS total
            FROM participant_cell_links pcl
           WHERE pcl.tenant_id = $1
             AND pcl.cell_id = ANY($2::uuid[])
             AND pcl.is_active = TRUE;
        `,
        [ctx.tenantId, cellIds]
      );

      const visitors = await client.query<{ total: string }>(
        `
          SELECT COUNT(DISTINCT pcl.participant_id)::text AS total
            FROM participant_cell_links pcl
           WHERE pcl.tenant_id = $1
             AND pcl.cell_id = ANY($2::uuid[])
             AND pcl.is_active = TRUE
             AND pcl.type = 'visitor';
        `,
        [ctx.tenantId, cellIds]
      );

      const finance = await client.query<{ direction: "in" | "out"; total: string }>(
        `
          SELECT direction, COALESCE(SUM(amount), 0)::text AS total
            FROM finance_entries
           WHERE tenant_id = $1
             AND EXTRACT(MONTH FROM entry_date) = $2
             AND EXTRACT(YEAR FROM entry_date) = $3
           GROUP BY direction;
        `,
        [ctx.tenantId, month, year]
      );

      const attendance = await client.query<{ week_start: string; total: string }>(
        `
          SELECT week_start::text, SUM(total_attendance)::text AS total
            FROM attendance_entries
           WHERE tenant_id = $1
             AND cell_id = ANY($2::uuid[])
             AND EXTRACT(MONTH FROM week_start) = $3
             AND EXTRACT(YEAR FROM week_start) = $4
           GROUP BY week_start
           ORDER BY week_start;
        `,
        [ctx.tenantId, cellIds, month, year]
      );

      response.json({
        kpis: {
          cells: visibleCells.length,
          participants: Number(participants.rows[0]?.total ?? "0"),
          visitors: Number(visitors.rows[0]?.total ?? "0"),
          financeIn: Number(
            finance.rows.find((row) => row.direction === "in")?.total ?? "0"
          ),
          financeOut: Number(
            finance.rows.find((row) => row.direction === "out")?.total ?? "0"
          )
        },
        attendanceByWeek: attendance.rows.map((row) => ({
          weekStart: row.week_start,
          total: Number(row.total)
        }))
      });
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/cells",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "cells_admin", "view");
      const cells = await getVisibleCells(client, ctx);
      response.json({ cells });
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/transfers/context",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const sourceCellId = request.query.sourceCellId
      ? String(request.query.sourceCellId)
      : null;
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "cells_admin", "view");
      const cells = await getVisibleCells(client, ctx);
      const cellIds = new Set(cells.map((cell) => cell.id));

      if (!sourceCellId) {
        response.json({ cells, participants: [] });
        return;
      }

      if (!cellIds.has(sourceCellId)) {
        throw new AppError("Celula de origem fora do seu escopo.", 403);
      }

      const participants = await client.query<{
        id: string;
        full_name: string;
        type: string;
      }>(
        `
          SELECT p.id, p.full_name, pcl.type::text AS type
            FROM participants p
            JOIN participant_cell_links pcl
              ON pcl.participant_id = p.id
             AND pcl.is_active = TRUE
           WHERE p.tenant_id = $1
             AND pcl.cell_id = $2
           ORDER BY p.full_name;
        `,
        [ctx.tenantId, sourceCellId]
      );

      response.json({
        cells,
        participants: participants.rows.map((row) => ({
          id: row.id,
          name: row.full_name,
          type: row.type
        }))
      });
    } finally {
      client.release();
    }
  })
);

panelRoutes.post(
  "/transfers",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const payload = transferSchema.parse(request.body);
    if (payload.sourceCellId === payload.destinationCellId) {
      throw new AppError("Origem e destino nao podem ser iguais.", 400);
    }

    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "cells_admin", "create");
      const cells = await getVisibleCells(client, ctx);
      const cellIds = new Set(cells.map((cell) => cell.id));

      if (!cellIds.has(payload.sourceCellId) || !cellIds.has(payload.destinationCellId)) {
        throw new AppError("Transferencia fora do seu escopo.", 403);
      }

      await client.query("BEGIN;");
      const sourceRows = await client.query<{
        participant_id: string;
        type: "member" | "congregated" | "visitor";
      }>(
        `
          SELECT participant_id, type::text AS type
            FROM participant_cell_links
           WHERE tenant_id = $1
             AND cell_id = $2
             AND participant_id = ANY($3::uuid[])
             AND is_active = TRUE;
        `,
        [ctx.tenantId, payload.sourceCellId, payload.participantIds]
      );

      if (sourceRows.rowCount !== payload.participantIds.length) {
        throw new AppError("Participantes invalidos para a celula de origem.", 400);
      }

      const transferLog = await client.query<{ id: string }>(
        `
          INSERT INTO transfer_logs (
            tenant_id,
            source_cell_id,
            destination_cell_id,
            transferred_by_user_id
          )
          VALUES ($1, $2, $3, $4)
          RETURNING id;
        `,
        [ctx.tenantId, payload.sourceCellId, payload.destinationCellId, ctx.userId]
      );

      for (const row of sourceRows.rows) {
        await client.query(
          `
            UPDATE participant_cell_links
               SET is_active = FALSE, updated_at = NOW()
             WHERE participant_id = $1
               AND cell_id = $2
               AND tenant_id = $3
               AND is_active = TRUE;
          `,
          [row.participant_id, payload.sourceCellId, ctx.tenantId]
        );

        await client.query(
          `
            INSERT INTO participant_cell_links (
              participant_id,
              cell_id,
              tenant_id,
              type,
              is_active
            )
            VALUES ($1, $2, $3, $4, TRUE)
            ON CONFLICT (participant_id, cell_id)
            DO UPDATE SET
              type = EXCLUDED.type,
              is_active = TRUE,
              updated_at = NOW();
          `,
          [row.participant_id, payload.destinationCellId, ctx.tenantId, row.type]
        );

        await client.query(
          `
            INSERT INTO transfer_log_participants (transfer_log_id, participant_id)
            VALUES ($1, $2);
          `,
          [transferLog.rows[0].id, row.participant_id]
        );
      }

      await client.query("COMMIT;");
      response.status(201).json({
        message: "Transferencia realizada com sucesso.",
        transferId: transferLog.rows[0].id
      });
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/config/module-names",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "cells_admin", "view");
      const rows = await client.query<{
        code: string;
        default_label: string;
        custom_label: string | null;
      }>(
        `
          SELECT d.code, d.default_label, o.custom_label
            FROM module_name_defaults d
            LEFT JOIN module_name_overrides o
              ON o.code = d.code
             AND o.tenant_id = $1
           ORDER BY d.code;
        `,
        [ctx.tenantId]
      );

      response.json({
        rows: rows.rows.map((row) => ({
          code: row.code,
          module: row.custom_label ?? row.default_label,
          default: row.default_label,
          selected: Boolean(row.custom_label)
        }))
      });
    } finally {
      client.release();
    }
  })
);

panelRoutes.post(
  "/config/module-names/save-selected",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const payload = saveNamesSchema.parse(request.body);
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "cells_admin", "edit");
      await client.query("BEGIN;");
      for (const item of payload.items) {
        if (item.selected) {
          await client.query(
            `
              INSERT INTO module_name_overrides (
                tenant_id,
                code,
                custom_label,
                updated_by_user_id
              )
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (tenant_id, code)
              DO UPDATE SET
                custom_label = EXCLUDED.custom_label,
                updated_by_user_id = EXCLUDED.updated_by_user_id,
                updated_at = NOW();
            `,
            [ctx.tenantId, item.code, item.label, ctx.userId]
          );
        } else {
          await client.query(
            `
              DELETE FROM module_name_overrides
               WHERE tenant_id = $1
                 AND code = $2;
            `,
            [ctx.tenantId, item.code]
          );
        }
      }
      await client.query("COMMIT;");
      response.json({ message: "Nomenclaturas salvas." });
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  })
);

panelRoutes.post(
  "/config/module-names/restore-default",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const payload = restoreNamesSchema.parse(request.body);
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "cells_admin", "edit");
      await client.query(
        `
          DELETE FROM module_name_overrides
           WHERE tenant_id = $1
             AND code = ANY($2::text[]);
        `,
        [ctx.tenantId, payload.codes]
      );
      response.json({ message: "Padroes restaurados." });
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/president/tree",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "pastor_presidente", "view");
      const rows = await client.query<{
        network_id: string;
        network_name: string;
        cell_id: string;
        cell_name: string;
        phone: string | null;
        email: string | null;
        members: string;
      }>(
        `
          SELECT
            n.id AS network_id,
            n.name AS network_name,
            c.id AS cell_id,
            c.name AS cell_name,
            c.phone,
            c.email,
            COUNT(pcl.participant_id)::text AS members
          FROM church_networks n
          JOIN cells c
            ON c.network_id = n.id
           AND c.is_active = TRUE
          LEFT JOIN participant_cell_links pcl
            ON pcl.cell_id = c.id
           AND pcl.is_active = TRUE
           AND pcl.type = 'member'
          WHERE n.tenant_id = $1
            AND n.is_active = TRUE
          GROUP BY n.id, n.name, c.id, c.name, c.phone, c.email
          ORDER BY n.name, c.name;
        `,
        [ctx.tenantId]
      );

      const groups = new Map<
        string,
        {
          networkId: string;
          networkName: string;
          rows: Array<{
            cell: string;
            phone: string | null;
            email: string | null;
            members: number;
            viewAction: string;
            lessonAction: string;
          }>;
        }
      >();

      for (const row of rows.rows) {
        if (!groups.has(row.network_id)) {
          groups.set(row.network_id, {
            networkId: row.network_id,
            networkName: row.network_name,
            rows: []
          });
        }
        groups.get(row.network_id)!.rows.push({
          cell: row.cell_name,
          phone: row.phone,
          email: row.email,
          members: Number(row.members),
          viewAction: `ver-${toShortCode(row.cell_id)}`,
          lessonAction: `licao-${toShortCode(row.cell_id)}`
        });
      }

      response.json({
        groups: Array.from(groups.values()).map((group) => ({
          networkId: group.networkId,
          networkName: group.networkName,
          cellsCount: group.rows.length,
          rows: group.rows
        }))
      });
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/president/gd",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "pastor_presidente", "view");
      const rows = await client.query<{
        id: string;
        meeting_type: string;
        leader_name: string;
        meeting_date: string;
      }>(
        `
          SELECT id, meeting_type::text, leader_name, meeting_date::text
            FROM gd_controls
           WHERE tenant_id = $1
           ORDER BY meeting_date DESC, created_at DESC;
        `,
        [ctx.tenantId]
      );

      response.json({
        rows: rows.rows.map((row) => ({
          code: toShortCode(row.id),
          meetingType: row.meeting_type,
          leader: row.leader_name,
          date: row.meeting_date
        }))
      });
    } finally {
      client.release();
    }
  })
);

panelRoutes.post(
  "/president/gd",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const payload = gdSchema.parse(request.body);
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "pastor_presidente", "create");
      const created = await client.query<{ id: string }>(
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
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id;
        `,
        [
          ctx.tenantId,
          payload.networkId ?? null,
          payload.cellId ?? null,
          payload.meetingType,
          payload.leaderName,
          payload.meetingDate,
          payload.meetingTime ?? null,
          ctx.userId
        ]
      );
      response.status(201).json({ message: "Registro GD criado.", id: created.rows[0].id });
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/network/gd",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "pastor_rede", "view");

      const rows =
        ctx.scope === "network"
          ? await client.query<{
              leader_name: string;
              meeting_date: string;
              meeting_time: string | null;
            }>(
              `
                SELECT leader_name, meeting_date::text, meeting_time::text
                  FROM gd_controls
                 WHERE tenant_id = $1
                   AND network_id = ANY($2::uuid[])
                 ORDER BY meeting_date DESC;
              `,
              [ctx.tenantId, ctx.networkIds]
            )
          : await client.query<{
              leader_name: string;
              meeting_date: string;
              meeting_time: string | null;
            }>(
              `
                SELECT leader_name, meeting_date::text, meeting_time::text
                  FROM gd_controls
                 WHERE tenant_id = $1
                 ORDER BY meeting_date DESC;
              `,
              [ctx.tenantId]
            );

      response.json({
        rows: rows.rows.map((row) => ({
          leader: row.leader_name,
          date: row.meeting_date,
          time: row.meeting_time
        }))
      });
    } finally {
      client.release();
    }
  })
);

panelRoutes.post(
  "/email/send",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const payload = emailSchema.parse(request.body);
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "email", "create");
      const created = await client.query<{ id: string }>(
        `
          INSERT INTO email_logs (
            tenant_id,
            sent_by_user_id,
            target_group,
            recipients_count,
            subject,
            body_html,
            attachment_name,
            status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent')
          RETURNING id;
        `,
        [
          ctx.tenantId,
          ctx.userId,
          payload.targetGroup,
          payload.recipientsCount ?? 1,
          payload.subject,
          payload.messageHtml,
          payload.attachmentName ?? null
        ]
      );
      response.status(201).json({ message: "E-mail registrado.", id: created.rows[0].id });
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/email/logs",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "email", "view");
      const rows = await client.query<{
        id: string;
        subject: string;
        target_group: string;
        recipients_count: number;
        status: string;
        sent_at: string;
        sender_name: string;
      }>(
        `
          SELECT
            e.id,
            e.subject,
            e.target_group,
            e.recipients_count,
            e.status,
            e.sent_at::text,
            u.full_name AS sender_name
          FROM email_logs e
          JOIN users u ON u.id = e.sent_by_user_id
          WHERE e.tenant_id = $1
          ORDER BY e.sent_at DESC
          LIMIT 100;
        `,
        [ctx.tenantId]
      );

      response.json({ rows: rows.rows });
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/leader/components",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "lider_celula", "view");
      const cells = await getVisibleCells(client, ctx);
      const cellIds = cells.map((cell) => cell.id);
      if (cellIds.length === 0) {
        response.json({ cells: [] });
        return;
      }

      const participants = await client.query<{
        cell_id: string;
        participant_id: string;
        full_name: string;
        phone_home: string | null;
        phone_mobile: string | null;
        email: string | null;
        birth_date: string | null;
        type: "member" | "congregated" | "visitor";
      }>(
        `
          SELECT
            pcl.cell_id,
            p.id AS participant_id,
            p.full_name,
            p.phone_home,
            p.phone_mobile,
            p.email,
            p.birth_date::text,
            pcl.type::text AS type
          FROM participant_cell_links pcl
          JOIN participants p ON p.id = pcl.participant_id
          WHERE pcl.tenant_id = $1
            AND pcl.cell_id = ANY($2::uuid[])
            AND pcl.is_active = TRUE
          ORDER BY p.full_name;
        `,
        [ctx.tenantId, cellIds]
      );

      const grouped = cells.map((cell) => ({
        id: cell.id,
        name: cell.name,
        code: cell.code,
        members: [] as unknown[],
        congregated: [] as unknown[],
        visitors: [] as unknown[]
      }));

      const byCell = new Map(grouped.map((item) => [item.id, item]));
      for (const row of participants.rows) {
        const cell = byCell.get(row.cell_id);
        if (!cell) {
          continue;
        }
        const item = {
          id: row.participant_id,
          name: row.full_name,
          phoneHome: row.phone_home,
          phoneMobile: row.phone_mobile,
          email: row.email,
          birthDate: row.birth_date
        };
        if (row.type === "member") {
          cell.members.push(item);
        } else if (row.type === "congregated") {
          cell.congregated.push(item);
        } else {
          cell.visitors.push(item);
        }
      }

      response.json({ cells: grouped });
    } finally {
      client.release();
    }
  })
);

panelRoutes.post(
  "/leader/components/:participantId/promote",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const participantId = request.params.participantId;
    const payload = promoteSchema.parse(request.body);
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "lider_celula", "edit");
      const cells = await getVisibleCells(client, ctx);
      const visible = new Set(cells.map((cell) => cell.id));

      if (!visible.has(payload.cellId)) {
        throw new AppError("Celula fora do seu escopo.", 403);
      }

      const current = await client.query<{ type: "member" | "congregated" | "visitor" }>(
        `
          SELECT type::text
            FROM participant_cell_links
           WHERE participant_id = $1
             AND cell_id = $2
             AND tenant_id = $3
             AND is_active = TRUE
           LIMIT 1;
        `,
        [participantId, payload.cellId, ctx.tenantId]
      );

      if (!current.rowCount) {
        throw new AppError("Participante nao localizado.", 404);
      }

      const fromType = current.rows[0].type;
      const toType =
        fromType === "visitor"
          ? "congregated"
          : fromType === "congregated"
            ? "member"
            : "member";

      if (fromType === toType) {
        response.json({ message: "Participante ja esta como membro.", type: toType });
        return;
      }

      await client.query("BEGIN;");
      await client.query(
        `
          UPDATE participant_cell_links
             SET type = $1,
                 updated_at = NOW()
           WHERE participant_id = $2
             AND cell_id = $3
             AND tenant_id = $4;
        `,
        [toType, participantId, payload.cellId, ctx.tenantId]
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
          VALUES ($1, $2, $3, $4, $5, 'Promocao de categoria');
        `,
        [ctx.tenantId, participantId, fromType, toType, ctx.userId]
      );
      await client.query("COMMIT;");

      response.json({ message: "Categoria atualizada.", fromType, toType });
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/consolidation",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const nameFilter = String(request.query.name ?? "").trim();
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "consolidation", "view");
      const cells = await getVisibleCells(client, ctx);
      const cellIds = cells.map((cell) => cell.id);
      if (cellIds.length === 0) {
        response.json({ groups: [] });
        return;
      }

      const rows = await client.query<{
        consolidation_id: string;
        participant_name: string;
        participant_type: string;
        phone_home: string | null;
        created_at: string;
        congregation_name: string | null;
      }>(
        `
          SELECT
            cr.id AS consolidation_id,
            p.full_name AS participant_name,
            pcl.type::text AS participant_type,
            p.phone_home,
            cr.created_at::text,
            cr.congregation_name
          FROM consolidation_records cr
          JOIN participants p ON p.id = cr.participant_id
          JOIN participant_cell_links pcl
            ON pcl.participant_id = p.id
           AND pcl.tenant_id = cr.tenant_id
           AND pcl.is_active = TRUE
          WHERE cr.tenant_id = $1
            AND pcl.cell_id = ANY($2::uuid[])
            AND ($3 = '' OR p.full_name ILIKE $4)
          ORDER BY cr.created_at DESC;
        `,
        [ctx.tenantId, cellIds, nameFilter, `%${nameFilter}%`]
      );

      const grouped = new Map<
        string,
        Array<{
          id: string;
          code: string;
          name: string;
          type: string;
          phoneHome: string | null;
          date: string;
        }>
      >();

      for (const row of rows.rows) {
        const key = row.congregation_name ?? "Sem congregacao";
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push({
          id: row.consolidation_id,
          code: toShortCode(row.consolidation_id),
          name: row.participant_name,
          type: row.participant_type,
          phoneHome: row.phone_home,
          date: row.created_at
        });
      }

      response.json({
        groups: Array.from(grouped.entries()).map(([congregationName, items]) => ({
          congregationName,
          items
        }))
      });
    } finally {
      client.release();
    }
  })
);

panelRoutes.get(
  "/consolidation/:id",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const consolidationId = request.params.id;
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "consolidation", "view");

      const record = await client.query<{
        id: string;
        participant_id: string;
        participant_name: string;
        congregation_name: string | null;
        request_text: string | null;
        known_by: string;
        known_by_other: string | null;
        created_at: string;
      }>(
        `
          SELECT
            cr.id,
            cr.participant_id,
            p.full_name AS participant_name,
            cr.congregation_name,
            cr.request_text,
            cr.known_by,
            cr.known_by_other,
            cr.created_at::text
          FROM consolidation_records cr
          JOIN participants p ON p.id = cr.participant_id
          WHERE cr.id = $1
            AND cr.tenant_id = $2
          LIMIT 1;
        `,
        [consolidationId, ctx.tenantId]
      );

      if (!record.rowCount) {
        throw new AppError("Registro nao encontrado.", 404);
      }

      const steps = await client.query(
        `
          SELECT
            accepted_in_church,
            accepted_in_church_date::text,
            fono_visit_done,
            fono_visit_done_date::text,
            first_visit_done,
            first_visit_done_date::text,
            pre_encounter_done,
            pre_encounter_done_date::text,
            encounter_done,
            encounter_done_date::text,
            post_encounter_done,
            post_encounter_done_date::text,
            reencounter_done,
            reencounter_done_date::text,
            consolidation_done,
            consolidation_done_date::text,
            baptized,
            baptized_date::text
          FROM consolidation_steps
          WHERE consolidation_id = $1;
        `,
        [consolidationId]
      );

      const history = await client.query<{
        id: string;
        note: string;
        created_at: string;
        author_name: string;
      }>(
        `
          SELECT
            h.id,
            h.note,
            h.created_at::text,
            u.full_name AS author_name
          FROM consolidation_history h
          JOIN users u ON u.id = h.created_by_user_id
          WHERE h.consolidation_id = $1
          ORDER BY h.created_at DESC;
        `,
        [consolidationId]
      );

      response.json({
        record: record.rows[0],
        steps: steps.rows[0] ?? null,
        history: history.rows
      });
    } finally {
      client.release();
    }
  })
);

panelRoutes.post(
  "/consolidation",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const payload = consolidationSchema.parse(request.body);
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "consolidation", "create");
      const cells = await getVisibleCells(client, ctx);
      const cellIds = cells.map((cell) => cell.id);
      if (cellIds.length === 0) {
        throw new AppError("Sem celulas disponiveis para consolidacao.", 400);
      }

      await client.query("BEGIN;");
      let participantId = payload.participantId ?? null;
      if (!participantId) {
        if (!payload.participantName) {
          throw new AppError("Informe o participante.", 400);
        }
        const createdParticipant = await client.query<{ id: string }>(
          `
            INSERT INTO participants (tenant_id, full_name)
            VALUES ($1, $2)
            RETURNING id;
          `,
          [ctx.tenantId, payload.participantName]
        );
        participantId = createdParticipant.rows[0].id;
        await client.query(
          `
            INSERT INTO participant_cell_links (
              participant_id,
              cell_id,
              tenant_id,
              type,
              is_active
            )
            VALUES ($1, $2, $3, 'visitor', TRUE)
            ON CONFLICT (participant_id, cell_id)
            DO UPDATE SET is_active = TRUE, updated_at = NOW();
          `,
          [participantId, cellIds[0], ctx.tenantId]
        );
      }

      const created = await client.query<{ id: string }>(
        `
          INSERT INTO consolidation_records (
            tenant_id,
            participant_id,
            congregation_name,
            request_text,
            known_by,
            known_by_other,
            created_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id;
        `,
        [
          ctx.tenantId,
          participantId,
          payload.congregationName ?? null,
          payload.requestText ?? null,
          payload.knownBy,
          payload.knownBy === "other" ? payload.knownByOther ?? null : null,
          ctx.userId
        ]
      );

      if (payload.steps) {
        await client.query(
          `
            INSERT INTO consolidation_steps (
              consolidation_id,
              accepted_in_church,
              accepted_in_church_date,
              fono_visit_done,
              fono_visit_done_date,
              first_visit_done,
              first_visit_done_date,
              pre_encounter_done,
              pre_encounter_done_date,
              encounter_done,
              encounter_done_date,
              post_encounter_done,
              post_encounter_done_date,
              reencounter_done,
              reencounter_done_date,
              consolidation_done,
              consolidation_done_date,
              baptized,
              baptized_date
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9,
              $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
            );
          `,
          [
            created.rows[0].id,
            payload.steps.acceptedInChurch ?? null,
            payload.steps.acceptedInChurchDate ?? null,
            payload.steps.fonoVisitDone ?? null,
            payload.steps.fonoVisitDoneDate ?? null,
            payload.steps.firstVisitDone ?? null,
            payload.steps.firstVisitDoneDate ?? null,
            payload.steps.preEncounterDone ?? null,
            payload.steps.preEncounterDoneDate ?? null,
            payload.steps.encounterDone ?? null,
            payload.steps.encounterDoneDate ?? null,
            payload.steps.postEncounterDone ?? null,
            payload.steps.postEncounterDoneDate ?? null,
            payload.steps.reencounterDone ?? null,
            payload.steps.reencounterDoneDate ?? null,
            payload.steps.consolidationDone ?? null,
            payload.steps.consolidationDoneDate ?? null,
            payload.steps.baptized ?? null,
            payload.steps.baptizedDate ?? null
          ]
        );
      }

      if (payload.historyNote) {
        await client.query(
          `
            INSERT INTO consolidation_history (
              consolidation_id,
              tenant_id,
              created_by_user_id,
              note
            )
            VALUES ($1, $2, $3, $4);
          `,
          [created.rows[0].id, ctx.tenantId, ctx.userId, payload.historyNote]
        );
      }

      await client.query("COMMIT;");
      response.status(201).json({ message: "Consolidacao cadastrada.", id: created.rows[0].id });
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  })
);

panelRoutes.put(
  "/consolidation/:id",
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const consolidationId = request.params.id;
    const payload = consolidationSchema.parse(request.body);
    const client = await pool.connect();
    try {
      const ctx = await loadAccessContext(client, auth.userId, auth.tenantId);
      assertPermission(ctx, "consolidation", "edit");
      const exists = await client.query(
        `
          SELECT 1
            FROM consolidation_records
           WHERE id = $1
             AND tenant_id = $2
           LIMIT 1;
        `,
        [consolidationId, ctx.tenantId]
      );
      if (!exists.rowCount) {
        throw new AppError("Registro nao encontrado.", 404);
      }

      await client.query("BEGIN;");
      await client.query(
        `
          UPDATE consolidation_records
             SET congregation_name = COALESCE($1, congregation_name),
                 request_text = COALESCE($2, request_text),
                 known_by = COALESCE($3, known_by),
                 known_by_other = $4,
                 updated_at = NOW()
           WHERE id = $5
             AND tenant_id = $6;
        `,
        [
          payload.congregationName ?? null,
          payload.requestText ?? null,
          payload.knownBy ?? null,
          payload.knownBy === "other" ? payload.knownByOther ?? null : null,
          consolidationId,
          ctx.tenantId
        ]
      );

      if (payload.steps) {
        await client.query(
          `
            INSERT INTO consolidation_steps (
              consolidation_id,
              accepted_in_church,
              accepted_in_church_date,
              fono_visit_done,
              fono_visit_done_date,
              first_visit_done,
              first_visit_done_date,
              pre_encounter_done,
              pre_encounter_done_date,
              encounter_done,
              encounter_done_date,
              post_encounter_done,
              post_encounter_done_date,
              reencounter_done,
              reencounter_done_date,
              consolidation_done,
              consolidation_done_date,
              baptized,
              baptized_date
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9,
              $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
            )
            ON CONFLICT (consolidation_id)
            DO UPDATE SET
              accepted_in_church = EXCLUDED.accepted_in_church,
              accepted_in_church_date = EXCLUDED.accepted_in_church_date,
              fono_visit_done = EXCLUDED.fono_visit_done,
              fono_visit_done_date = EXCLUDED.fono_visit_done_date,
              first_visit_done = EXCLUDED.first_visit_done,
              first_visit_done_date = EXCLUDED.first_visit_done_date,
              pre_encounter_done = EXCLUDED.pre_encounter_done,
              pre_encounter_done_date = EXCLUDED.pre_encounter_done_date,
              encounter_done = EXCLUDED.encounter_done,
              encounter_done_date = EXCLUDED.encounter_done_date,
              post_encounter_done = EXCLUDED.post_encounter_done,
              post_encounter_done_date = EXCLUDED.post_encounter_done_date,
              reencounter_done = EXCLUDED.reencounter_done,
              reencounter_done_date = EXCLUDED.reencounter_done_date,
              consolidation_done = EXCLUDED.consolidation_done,
              consolidation_done_date = EXCLUDED.consolidation_done_date,
              baptized = EXCLUDED.baptized,
              baptized_date = EXCLUDED.baptized_date,
              updated_at = NOW();
          `,
          [
            consolidationId,
            payload.steps.acceptedInChurch ?? null,
            payload.steps.acceptedInChurchDate ?? null,
            payload.steps.fonoVisitDone ?? null,
            payload.steps.fonoVisitDoneDate ?? null,
            payload.steps.firstVisitDone ?? null,
            payload.steps.firstVisitDoneDate ?? null,
            payload.steps.preEncounterDone ?? null,
            payload.steps.preEncounterDoneDate ?? null,
            payload.steps.encounterDone ?? null,
            payload.steps.encounterDoneDate ?? null,
            payload.steps.postEncounterDone ?? null,
            payload.steps.postEncounterDoneDate ?? null,
            payload.steps.reencounterDone ?? null,
            payload.steps.reencounterDoneDate ?? null,
            payload.steps.consolidationDone ?? null,
            payload.steps.consolidationDoneDate ?? null,
            payload.steps.baptized ?? null,
            payload.steps.baptizedDate ?? null
          ]
        );
      }

      if (payload.historyNote) {
        await client.query(
          `
            INSERT INTO consolidation_history (
              consolidation_id,
              tenant_id,
              created_by_user_id,
              note
            )
            VALUES ($1, $2, $3, $4);
          `,
          [consolidationId, ctx.tenantId, ctx.userId, payload.historyNote]
        );
      }

      await client.query("COMMIT;");
      response.json({ message: "Consolidacao atualizada." });
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }
  })
);

panelRoutes.get("/health", (_request, response) => {
  response.json({ status: "panel-ok" });
});
