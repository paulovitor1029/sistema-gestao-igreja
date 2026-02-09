const storageKey = "sgi_access_token";

const alertEl = document.getElementById("alert");
const tabs = Array.from(document.querySelectorAll(".tab"));
const tabsContainer = document.querySelector(".tabs");
const sections = {
  login: document.getElementById("login-form"),
  register: document.getElementById("register-form"),
  account: document.getElementById("account-panel")
};

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const updateForm = document.getElementById("update-form");
const refreshButton = document.getElementById("refresh-me");
const logoutButton = document.getElementById("logout");
const deleteButton = document.getElementById("delete-account");

const meUser = document.getElementById("me-user");
const meEmail = document.getElementById("me-email");
const meTenant = document.getElementById("me-tenant");
const meRole = document.getElementById("me-role");

function setAlert(type, message) {
  if (!message) {
    alertEl.textContent = "";
    alertEl.className = "alert hidden";
    return;
  }

  alertEl.textContent = message;
  alertEl.className = `alert ${type}`;
}

function setTab(tabName) {
  tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabName;
    tab.classList.toggle("active", isActive);
  });

  Object.entries(sections).forEach(([name, element]) => {
    element.classList.toggle("active", name === tabName);
  });

  if (tabsContainer) {
    tabsContainer.classList.toggle("hidden", tabName === "account");
  }
}

function saveToken(token) {
  if (!token) {
    localStorage.removeItem(storageKey);
    return;
  }
  localStorage.setItem(storageKey, token);
}

function getToken() {
  return localStorage.getItem(storageKey);
}

function toJson(formData) {
  return Object.fromEntries(formData.entries());
}

function normalizeLoginLikeBody(body) {
  if (typeof body.churchName === "string") {
    body.churchName = body.churchName.trim();
  }
  if (typeof body.name === "string") {
    body.name = body.name.trim();
  }
  if (typeof body.email === "string") {
    body.email = body.email.trim().toLowerCase();
  }
  return body;
}

function setButtonsDisabled(disabled) {
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = disabled;
  });
}

function fillMe(data) {
  meUser.textContent = data.user?.name || "-";
  meEmail.textContent = data.user?.email || "-";
  meTenant.textContent = data.tenant?.name || "-";
  meRole.textContent = data.membership?.role || "-";
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...options, headers });
  const maybeJson = response.status === 204 ? null : await response.json();

  if (!response.ok) {
    const message = maybeJson?.message || "Falha na requisicao.";
    throw new Error(message);
  }

  return maybeJson;
}

async function loadMe() {
  const data = await request("/auth/me", {
    method: "GET"
  });
  fillMe(data);
  setTab("account");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setButtonsDisabled(true);
  setAlert();

  try {
    const body = normalizeLoginLikeBody(toJson(new FormData(loginForm)));
    const data = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify(body)
    });

    saveToken(data.accessToken);
    fillMe(data);
    loginForm.reset();
    setAlert("success", data.message || "Login realizado.");
    setTab("account");
  } catch (error) {
    setAlert("error", error.message);
  } finally {
    setButtonsDisabled(false);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setButtonsDisabled(true);
  setAlert();

  try {
    const body = normalizeLoginLikeBody(toJson(new FormData(registerForm)));
    const data = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify(body)
    });

    saveToken(data.accessToken);
    fillMe(data);
    registerForm.reset();
    setAlert("success", data.message || "Cadastro realizado.");
    setTab("account");
  } catch (error) {
    setAlert("error", error.message);
  } finally {
    setButtonsDisabled(false);
  }
});

updateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setButtonsDisabled(true);
  setAlert();

  try {
    const body = toJson(new FormData(updateForm));
    const payload = {};
    if (body.name?.trim()) payload.name = body.name.trim();
    if (body.password?.trim()) payload.password = body.password;

    const data = await request("/auth/me", {
      method: "PUT",
      body: JSON.stringify(payload)
    });

    meUser.textContent = data.user?.name || meUser.textContent;
    updateForm.reset();
    setAlert("success", data.message || "Conta atualizada.");
  } catch (error) {
    setAlert("error", error.message);
  } finally {
    setButtonsDisabled(false);
  }
});

refreshButton.addEventListener("click", async () => {
  setButtonsDisabled(true);
  setAlert();
  try {
    await loadMe();
    setAlert("success", "Dados atualizados.");
  } catch (error) {
    saveToken("");
    fillMe({});
    setTab("login");
    setAlert("error", error.message);
  } finally {
    setButtonsDisabled(false);
  }
});

logoutButton.addEventListener("click", () => {
  saveToken("");
  fillMe({});
  setTab("login");
  setAlert("success", "Sessao encerrada.");
});

deleteButton.addEventListener("click", async () => {
  const ok = window.confirm(
    "Deseja realmente excluir sua conta desta igreja? Esta acao desativa seu acesso."
  );

  if (!ok) {
    return;
  }

  setButtonsDisabled(true);
  setAlert();
  try {
    await request("/auth/me", {
      method: "DELETE"
    });
    saveToken("");
    fillMe({});
    setTab("register");
    setAlert("success", "Conta excluida nesta igreja.");
  } catch (error) {
    setAlert("error", error.message);
  } finally {
    setButtonsDisabled(false);
  }
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setAlert();
    const tabName = tab.dataset.tab;
    if (tabName) {
      setTab(tabName);
    }
  });
});

async function bootstrap() {
  const token = getToken();
  if (!token) {
    setTab("login");
    return;
  }

  setButtonsDisabled(true);
  try {
    await loadMe();
    setAlert("success", "Sessao restaurada.");
  } catch (_error) {
    saveToken("");
    setTab("login");
  } finally {
    setButtonsDisabled(false);
  }
}

bootstrap();
