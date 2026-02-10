const storageKey = "sgi_access_token";
const appState = {
  session: null,
  currentPage: "dashboard",
  transfer: {
    cells: [],
    originItems: [],
    selectedItems: []
  },
  moduleNames: []
};

function getToken() {
  return localStorage.getItem(storageKey);
}

function clearToken() {
  localStorage.removeItem(storageKey);
}

function toLogin() {
  window.location.href = "/";
}

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.style.borderLeftColor = isError ? "#a13232" : "#2b67bd";
  window.setTimeout(() => toast.classList.add("hidden"), 3000);
}

async function api(path, options = {}) {
  const token = getToken();
  if (!token) {
    toLogin();
    throw new Error("Sessao ausente.");
  }

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`
  };

  const response = await fetch(path, {
    ...options,
    headers
  });

  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      toLogin();
    }
    throw new Error(data?.message || "Falha ao carregar dados.");
  }
  return data;
}

function mapMenuByRole(role) {
  const base = [
    {
      title: "Dashboard",
      items: [{ label: "Visao geral", page: "dashboard" }]
    },
    {
      title: "Celulas",
      items: [
        { label: "Pastor presidente - Arvore", page: "president-tree" },
        { label: "Pastor presidente - Controle GD", page: "president-gd" },
        { label: "Pastor de rede", page: "network" },
        { label: "Lider de celula", page: "leader" }
      ]
    },
    {
      title: "Administracao de Celulas",
      items: [
        { label: "Transferencia entre celulas", page: "transfer" },
        { label: "Configuracao de celulas", page: "config" }
      ]
    },
    {
      title: "Discipulado",
      items: [{ label: "Componentes da celula", page: "leader" }]
    },
    {
      title: "Consolidacao",
      items: [{ label: "Cadastro de consolidacao", page: "consolidation" }]
    },
    {
      title: "Escola de lideres",
      items: [{ label: "Painel", page: "dashboard" }]
    }
  ];

  if (role === "pastor_presidente") {
    return base.map((group) =>
      group.title === "Celulas"
        ? {
            ...group,
            items: group.items.filter((item) => item.page.startsWith("president"))
          }
        : group
    );
  }

  if (role === "pastor_rede") {
    return base.map((group) =>
      group.title === "Celulas"
        ? {
            ...group,
            items: group.items.filter((item) => item.page === "network")
          }
        : group
    );
  }

  if (role === "lider_celula") {
    return base.map((group) =>
      group.title === "Celulas"
        ? {
            ...group,
            items: group.items.filter((item) => item.page === "leader")
          }
        : group
    );
  }

  return base;
}

function renderSidebar() {
  const menuEl = document.getElementById("sidebar-menu");
  const groups = mapMenuByRole(appState.session.role);

  menuEl.innerHTML = "";
  groups.forEach((group, idx) => {
    const details = document.createElement("details");
    details.open = idx < 2;
    const summary = document.createElement("summary");
    summary.textContent = group.title;

    const sub = document.createElement("div");
    sub.className = "submenu";

    group.items.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item.label;
      btn.dataset.page = item.page;
      btn.addEventListener("click", () => setPage(item.page));
      sub.appendChild(btn);
    });

    details.appendChild(summary);
    details.appendChild(sub);
    menuEl.appendChild(details);
  });
}

function highlightActiveMenu(page) {
  document.querySelectorAll("#sidebar-menu button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
}

function setPage(page) {
  appState.currentPage = page;
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active", section.dataset.page === page);
  });
  highlightActiveMenu(page);
  loadPage(page).catch((error) => showToast(error.message, true));
}

function renderKpis(kpis) {
  const wrap = document.getElementById("dashboard-kpis");
  const cards = [
    { label: "Quantidade de Celulas", value: kpis.cells ?? 0 },
    { label: "Quantidade de Participantes", value: kpis.participants ?? 0 },
    { label: "Quantidade de Visitantes", value: kpis.visitors ?? 0 },
    {
      label: "Entradas / Saidas",
      value: `${Number(kpis.financeIn ?? 0).toFixed(2)} / ${Number(kpis.financeOut ?? 0).toFixed(2)}`
    }
  ];

  wrap.innerHTML = cards
    .map(
      (card) => `
        <div class="kpi">
          <div class="label">${card.label}</div>
          <div class="value">${card.value}</div>
        </div>
      `
    )
    .join("");
}

async function loadDashboard() {
  const monthInput = document.getElementById("dash-month");
  if (!monthInput.value) {
    monthInput.value = new Date().toISOString().slice(0, 7);
  }
  const [year, month] = monthInput.value.split("-").map(Number);
  const data = await api(`/panel/dashboard?month=${month}&year=${year}`);
  renderKpis(data.kpis);

  const tbody = document.getElementById("dashboard-attendance");
  tbody.innerHTML =
    data.attendanceByWeek.length === 0
      ? `<tr><td colspan="2">Sem dados no periodo.</td></tr>`
      : data.attendanceByWeek
          .map(
            (row) => `
              <tr>
                <td>${row.weekStart}</td>
                <td>${row.total}</td>
              </tr>
            `
          )
          .join("");
}

function fillCellSelects() {
  const source = document.getElementById("transfer-source");
  const destination = document.getElementById("transfer-destination");
  const options = appState.transfer.cells
    .map((cell) => `<option value="${cell.id}">${cell.name} (${cell.code})</option>`)
    .join("");
  source.innerHTML = options;
  destination.innerHTML = options;
}

function renderTransferLists() {
  const origin = document.getElementById("transfer-origin-list");
  const dest = document.getElementById("transfer-dest-list");
  origin.innerHTML = appState.transfer.originItems
    .map((item) => `<option value="${item.id}">${item.name} - ${item.type}</option>`)
    .join("");
  dest.innerHTML = appState.transfer.selectedItems
    .map((item) => `<option value="${item.id}">${item.name} - ${item.type}</option>`)
    .join("");
}

async function loadTransferContext() {
  const source = document.getElementById("transfer-source");
  const sourceCellId = source.value;
  const data = await api(
    sourceCellId
      ? `/panel/transfers/context?sourceCellId=${sourceCellId}`
      : "/panel/transfers/context"
  );

  appState.transfer.cells = data.cells;
  fillCellSelects();

  if (!source.value && data.cells[0]) {
    source.value = data.cells[0].id;
  }
  appState.transfer.originItems = data.participants || [];
  appState.transfer.selectedItems = [];
  renderTransferLists();
}

function moveItems(fromName, toName, all = false) {
  const fromSelect =
    fromName === "origin"
      ? document.getElementById("transfer-origin-list")
      : document.getElementById("transfer-dest-list");
  const selectedIds = all
    ? fromSelect.options ? Array.from(fromSelect.options).map((opt) => opt.value) : []
    : Array.from(fromSelect.selectedOptions).map((opt) => opt.value);
  if (selectedIds.length === 0) {
    return;
  }

  if (fromName === "origin") {
    const moving = appState.transfer.originItems.filter((item) =>
      selectedIds.includes(item.id)
    );
    appState.transfer.originItems = appState.transfer.originItems.filter(
      (item) => !selectedIds.includes(item.id)
    );
    appState.transfer.selectedItems.push(...moving);
  } else {
    const moving = appState.transfer.selectedItems.filter((item) =>
      selectedIds.includes(item.id)
    );
    appState.transfer.selectedItems = appState.transfer.selectedItems.filter(
      (item) => !selectedIds.includes(item.id)
    );
    appState.transfer.originItems.push(...moving);
  }
  renderTransferLists();
}

async function saveTransfer() {
  const source = document.getElementById("transfer-source").value;
  const destination = document.getElementById("transfer-destination").value;
  const participantIds = appState.transfer.selectedItems.map((item) => item.id);
  if (!source || !destination || participantIds.length === 0) {
    throw new Error("Preencha origem, destino e selecione participantes.");
  }

  await api("/panel/transfers", {
    method: "POST",
    body: JSON.stringify({
      sourceCellId: source,
      destinationCellId: destination,
      participantIds
    })
  });
  showToast("Transferencia realizada.");
  await loadTransferContext();
}

function renderModuleNames(rows) {
  const body = document.getElementById("module-names-body");
  body.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td><input type="checkbox" data-code="${row.code}" data-kind="selected" ${row.selected ? "checked" : ""} /></td>
          <td>${row.code}</td>
          <td><input data-code="${row.code}" data-kind="label" value="${row.module}" /></td>
          <td>${row.default}</td>
        </tr>
      `
    )
    .join("");
}

async function loadModuleNames() {
  const data = await api("/panel/config/module-names");
  appState.moduleNames = data.rows;
  renderModuleNames(data.rows);
}

function renderPresidentTree(groups) {
  const wrap = document.getElementById("president-tree");
  wrap.innerHTML = groups
    .map(
      (group) => `
        <div class="card">
          <h3>Rede => ${group.networkName}</h3>
          <p>Quant. de Cel. => ${group.cellsCount}</p>
          <table>
            <thead>
              <tr>
                <th>Celula</th>
                <th>Telefone</th>
                <th>E-mail</th>
                <th>Membros</th>
                <th>Ver</th>
                <th>Licao</th>
              </tr>
            </thead>
            <tbody>
              ${group.rows
                .map(
                  (row) => `
                    <tr>
                      <td>${row.cell}</td>
                      <td>${row.phone ?? "-"}</td>
                      <td>${row.email ?? "-"}</td>
                      <td>${row.members}</td>
                      <td>${row.viewAction}</td>
                      <td>${row.lessonAction}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
    )
    .join("");
}

async function loadPresidentTree() {
  const data = await api("/panel/president/tree");
  renderPresidentTree(data.groups);
}

async function loadPresidentGd() {
  const data = await api("/panel/president/gd");
  document.getElementById("president-gd-body").innerHTML = data.rows
    .map(
      (row) => `
        <tr>
          <td>${row.code}</td>
          <td>${row.meetingType}</td>
          <td>${row.leader}</td>
          <td>${row.date}</td>
        </tr>
      `
    )
    .join("");
}

async function loadNetworkPage() {
  const gd = await api("/panel/network/gd");
  document.getElementById("network-gd-body").innerHTML = gd.rows
    .map(
      (row) => `
        <tr>
          <td>${row.leader}</td>
          <td>${row.date}</td>
          <td>${row.time ?? "-"}</td>
        </tr>
      `
    )
    .join("");

  const logs = await api("/panel/email/logs");
  document.getElementById("email-logs-body").innerHTML = logs.rows
    .map(
      (row) => `
        <tr>
          <td>${row.subject}</td>
          <td>${row.sender_name}</td>
          <td>${row.target_group} (${row.recipients_count})</td>
          <td>${row.sent_at}</td>
          <td>${row.status}</td>
        </tr>
      `
    )
    .join("");
}

function sectionTable(rows, cellId, title) {
  return `
    <h4 class="mini-header">${title}</h4>
    <table>
      <thead>
        <tr>
          <th>Editar</th>
          <th>Nome</th>
          <th>Tel. Residencial</th>
          <th>Celular</th>
          <th>E-mail</th>
          <th>Aniversario</th>
          <th>Promocao</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows.length === 0
            ? `<tr><td colspan="7">Sem registros.</td></tr>`
            : rows
                .map(
                  (item) => `
                    <tr>
                      <td>editar</td>
                      <td>${item.name}</td>
                      <td>${item.phoneHome ?? "-"}</td>
                      <td>${item.phoneMobile ?? "-"}</td>
                      <td>${item.email ?? "-"}</td>
                      <td>${item.birthDate ?? "-"}</td>
                      <td>
                        <button class="action-link" data-promote="${item.id}" data-cell="${cellId}">
                          promover
                        </button>
                      </td>
                    </tr>
                  `
                )
                .join("")
        }
      </tbody>
    </table>
  `;
}

async function loadLeaderComponents() {
  const data = await api("/panel/leader/components");
  const wrap = document.getElementById("leader-components");
  wrap.innerHTML = data.cells
    .map(
      (cell) => `
        <div class="cell-block">
          <div class="cell-title">
            <strong>Celula ${cell.name}</strong>
            <span>${cell.code}</span>
          </div>
          <div class="cell-sections">
            ${sectionTable(cell.members, cell.id, "Membros")}
            ${sectionTable(cell.congregated, cell.id, "Congregados")}
            ${sectionTable(cell.visitors, cell.id, "Visitantes")}
          </div>
        </div>
      `
    )
    .join("");

  wrap.querySelectorAll("[data-promote]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/panel/leader/components/${button.dataset.promote}/promote`, {
          method: "POST",
          body: JSON.stringify({ cellId: button.dataset.cell })
        });
        showToast("Categoria atualizada.");
        await loadLeaderComponents();
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });
}

async function loadConsolidationList() {
  const name = document.getElementById("consolidation-filter").value || "";
  const data = await api(`/panel/consolidation?name=${encodeURIComponent(name)}`);
  const wrap = document.getElementById("consolidation-groups");
  wrap.innerHTML = data.groups
    .map(
      (group) => `
        <div class="card">
          <h3>Congregacao => ${group.congregationName}</h3>
          <table>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Fone Res.</th>
                <th>Data</th>
                <th>Editar</th>
              </tr>
            </thead>
            <tbody>
              ${group.items
                .map(
                  (item) => `
                    <tr>
                      <td>${item.code}</td>
                      <td>${item.name}</td>
                      <td>${item.type}</td>
                      <td>${item.phoneHome ?? "-"}</td>
                      <td>${item.date}</td>
                      <td><button class="action-link" data-open-consolidation="${item.id}">editar</button></td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
    )
    .join("");

  wrap.querySelectorAll("[data-open-consolidation]").forEach((button) => {
    button.addEventListener("click", async () => {
      const detail = await api(`/panel/consolidation/${button.dataset.openConsolidation}`);
      fillConsolidationForm(detail.record, detail.steps);
      document.getElementById("consolidation-form").dataset.editingId =
        button.dataset.openConsolidation;
      showToast("Registro carregado para edicao.");
    });
  });
}

function fillConsolidationForm(record, steps) {
  const form = document.getElementById("consolidation-form");
  form.participantName.value = record.participant_name || "";
  form.congregationName.value = record.congregation_name || "";
  form.requestText.value = record.request_text || "";
  form.knownBy.value = record.known_by || "friends";
  form.knownByOther.value = record.known_by_other || "";

  form.acceptedInChurchDate.value = steps?.accepted_in_church_date || "";
  form.fonoVisitDoneDate.value = steps?.fono_visit_done_date || "";
  form.firstVisitDoneDate.value = steps?.first_visit_done_date || "";
  form.preEncounterDoneDate.value = steps?.pre_encounter_done_date || "";
  form.encounterDoneDate.value = steps?.encounter_done_date || "";
  form.postEncounterDoneDate.value = steps?.post_encounter_done_date || "";
  form.reencounterDoneDate.value = steps?.reencounter_done_date || "";
  form.consolidationDoneDate.value = steps?.consolidation_done_date || "";
  form.baptizedDate.value = steps?.baptized_date || "";
}

function buildConsolidationPayload(form) {
  const get = (name) => form[name].value.trim();
  const stepDate = (name) => get(name) || undefined;
  return {
    participantName: get("participantName"),
    congregationName: get("congregationName") || undefined,
    requestText: get("requestText") || undefined,
    knownBy: get("knownBy") || "friends",
    knownByOther: get("knownByOther") || undefined,
    historyNote: get("historyNote") || undefined,
    steps: {
      acceptedInChurch: Boolean(stepDate("acceptedInChurchDate")),
      acceptedInChurchDate: stepDate("acceptedInChurchDate"),
      fonoVisitDone: Boolean(stepDate("fonoVisitDoneDate")),
      fonoVisitDoneDate: stepDate("fonoVisitDoneDate"),
      firstVisitDone: Boolean(stepDate("firstVisitDoneDate")),
      firstVisitDoneDate: stepDate("firstVisitDoneDate"),
      preEncounterDone: Boolean(stepDate("preEncounterDoneDate")),
      preEncounterDoneDate: stepDate("preEncounterDoneDate"),
      encounterDone: Boolean(stepDate("encounterDoneDate")),
      encounterDoneDate: stepDate("encounterDoneDate"),
      postEncounterDone: Boolean(stepDate("postEncounterDoneDate")),
      postEncounterDoneDate: stepDate("postEncounterDoneDate"),
      reencounterDone: Boolean(stepDate("reencounterDoneDate")),
      reencounterDoneDate: stepDate("reencounterDoneDate"),
      consolidationDone: Boolean(stepDate("consolidationDoneDate")),
      consolidationDoneDate: stepDate("consolidationDoneDate"),
      baptized: Boolean(stepDate("baptizedDate")),
      baptizedDate: stepDate("baptizedDate")
    }
  };
}

async function loadPage(page) {
  if (page === "dashboard") {
    await loadDashboard();
  } else if (page === "transfer") {
    await loadTransferContext();
  } else if (page === "config") {
    await loadModuleNames();
  } else if (page === "president-tree") {
    await loadPresidentTree();
  } else if (page === "president-gd") {
    await loadPresidentGd();
  } else if (page === "network") {
    await loadNetworkPage();
  } else if (page === "leader") {
    await loadLeaderComponents();
  } else if (page === "consolidation") {
    await loadConsolidationList();
  }
}

function setupTransferActions() {
  document.getElementById("load-transfer").addEventListener("click", () => {
    loadTransferContext().catch((error) => showToast(error.message, true));
  });
  document.getElementById("transfer-source").addEventListener("change", () => {
    loadTransferContext().catch((error) => showToast(error.message, true));
  });
  document.getElementById("move-one").addEventListener("click", () => moveItems("origin"));
  document.getElementById("move-all").addEventListener("click", () => moveItems("origin", "dest", true));
  document.getElementById("back-one").addEventListener("click", () => moveItems("dest"));
  document.getElementById("back-all").addEventListener("click", () => moveItems("dest", "origin", true));
  document.getElementById("transfer-submit").addEventListener("click", async () => {
    try {
      await saveTransfer();
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function setupConfigActions() {
  document.getElementById("save-module-names").addEventListener("click", async () => {
    try {
      const rows = Array.from(document.querySelectorAll("#module-names-body tr")).map((row) => {
        const checkbox = row.querySelector('[data-kind="selected"]');
        const input = row.querySelector('[data-kind="label"]');
        return {
          code: checkbox.dataset.code,
          selected: checkbox.checked,
          label: input.value
        };
      });
      await api("/panel/config/module-names/save-selected", {
        method: "POST",
        body: JSON.stringify({ items: rows })
      });
      showToast("Nomenclaturas atualizadas.");
      await loadModuleNames();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById("restore-module-names").addEventListener("click", async () => {
    try {
      const codes = Array.from(document.querySelectorAll('[data-kind="selected"]:checked')).map(
        (item) => item.dataset.code
      );
      if (codes.length === 0) {
        showToast("Selecione ao menos um modulo.", true);
        return;
      }
      await api("/panel/config/module-names/restore-default", {
        method: "POST",
        body: JSON.stringify({ codes })
      });
      showToast("Padroes restaurados.");
      await loadModuleNames();
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function setupGdActions() {
  document.getElementById("reload-president-gd").addEventListener("click", () => {
    loadPresidentGd().catch((error) => showToast(error.message, true));
  });

  document.getElementById("gd-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/panel/president/gd", {
        method: "POST",
        body: JSON.stringify({
          leaderName: form.leaderName.value.trim(),
          meetingDate: form.meetingDate.value,
          meetingTime: form.meetingTime.value || undefined
        })
      });
      showToast("Registro GD criado.");
      form.reset();
      await loadPresidentGd();
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function setupEmailForms() {
  document.getElementById("network-email-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/panel/email/send", {
        method: "POST",
        body: JSON.stringify({
          targetGroup: "Rede",
          subject: form.subject.value.trim(),
          messageHtml: form.messageHtml.value.trim(),
          attachmentName: form.attachmentName.value.trim() || undefined
        })
      });
      showToast("E-mail registrado.");
      form.reset();
      await loadNetworkPage();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById("leader-email-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/panel/email/send", {
        method: "POST",
        body: JSON.stringify({
          targetGroup: form.targetGroup.value,
          subject: form.subject.value.trim(),
          messageHtml: form.messageHtml.value.trim(),
          attachmentName: form.attachmentName.value.trim() || undefined
        })
      });
      showToast("E-mail registrado.");
      form.reset();
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function setupConsolidationForm() {
  document.getElementById("search-consolidation").addEventListener("click", () => {
    loadConsolidationList().catch((error) => showToast(error.message, true));
  });

  document.getElementById("new-consolidation").addEventListener("click", () => {
    const form = document.getElementById("consolidation-form");
    form.reset();
    delete form.dataset.editingId;
  });

  document.getElementById("consolidation-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = buildConsolidationPayload(form);
    const id = form.dataset.editingId;
    try {
      if (id) {
        await api(`/panel/consolidation/${id}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        showToast("Consolidacao atualizada.");
      } else {
        await api("/panel/consolidation", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        showToast("Consolidacao cadastrada.");
      }
      form.reset();
      delete form.dataset.editingId;
      await loadConsolidationList();
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

function setupSearch() {
  const input = document.getElementById("global-search");
  const box = document.getElementById("search-results");
  let timer = null;

  input.addEventListener("input", () => {
    const value = input.value.trim();
    if (timer) {
      window.clearTimeout(timer);
    }
    if (value.length < 2) {
      box.classList.add("hidden");
      return;
    }
    timer = window.setTimeout(async () => {
      try {
        const data = await api(`/panel/search?q=${encodeURIComponent(value)}`);
        box.innerHTML =
          data.items.length === 0
            ? `<div class="search-row"><small>Nenhum resultado.</small></div>`
            : data.items
                .map(
                  (item) => `
                    <div class="search-row">
                      <strong>${item.title}</strong>
                      <small>${item.subtitle}</small>
                    </div>
                  `
                )
                .join("");
        box.classList.remove("hidden");
      } catch (error) {
        showToast(error.message, true);
      }
    }, 250);
  });
}

function setupGlobalActions() {
  document.getElementById("refresh-dashboard").addEventListener("click", () => {
    loadDashboard().catch((error) => showToast(error.message, true));
  });
  document.getElementById("reload-network-gd").addEventListener("click", () => {
    loadNetworkPage().catch((error) => showToast(error.message, true));
  });
  document.getElementById("reload-leader-components").addEventListener("click", () => {
    loadLeaderComponents().catch((error) => showToast(error.message, true));
  });

  document.getElementById("logout-action").addEventListener("click", () => {
    clearToken();
    toLogin();
  });

  document.getElementById("quick-action").addEventListener("click", () => {
    document.getElementById("shortcut-panel").classList.toggle("hidden");
  });

  document.getElementById("fab-shortcuts").addEventListener("click", () => {
    document.getElementById("shortcut-panel").classList.toggle("hidden");
  });

  document.querySelectorAll("[data-page-link]").forEach((button) => {
    button.addEventListener("click", () => {
      setPage(button.dataset.pageLink);
      document.getElementById("shortcut-panel").classList.add("hidden");
    });
  });

  document.getElementById("notif-action").addEventListener("click", () => {
    showToast("Sem notificacoes pendentes.");
  });
  document.getElementById("help-action").addEventListener("click", () => {
    showToast("Use o menu lateral para acessar os modulos.");
  });
  document.getElementById("profile-action").addEventListener("click", () => {
    showToast(`${appState.session.user.name} (${appState.session.role})`);
  });
}

async function bootstrap() {
  try {
    appState.session = await api("/panel/me");
  } catch (_error) {
    clearToken();
    toLogin();
    return;
  }

  document.getElementById("welcome-user").textContent = `Bem-vindo, ${appState.session.user.name}`;
  renderSidebar();

  setupTransferActions();
  setupConfigActions();
  setupGdActions();
  setupEmailForms();
  setupConsolidationForm();
  setupSearch();
  setupGlobalActions();

  setPage("dashboard");
}

bootstrap();
