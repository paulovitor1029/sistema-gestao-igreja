const storageKey = "sgi_access_token";

const alertEl = document.getElementById("alert");
const tabs = Array.from(document.querySelectorAll(".tab"));
const sections = {
  login: document.getElementById("login-form"),
  register: document.getElementById("register-form")
};

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

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
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  Object.entries(sections).forEach(([name, element]) => {
    element.classList.toggle("active", name === tabName);
  });
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

function normalizePayload(body) {
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
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Falha na requisicao.");
  }
  return data;
}

function goToPanel() {
  window.location.href = "/panel.html";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setButtonsDisabled(true);
  setAlert();

  try {
    const body = normalizePayload(toJson(new FormData(loginForm)));
    const data = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify(body)
    });
    saveToken(data.accessToken);
    goToPanel();
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
    const body = normalizePayload(toJson(new FormData(registerForm)));
    const data = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify(body)
    });
    saveToken(data.accessToken);
    goToPanel();
  } catch (error) {
    setAlert("error", error.message);
  } finally {
    setButtonsDisabled(false);
  }
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setAlert();
    setTab(tab.dataset.tab);
  });
});

async function bootstrap() {
  const token = getToken();
  if (!token) {
    setTab("login");
    return;
  }

  try {
    await request("/auth/me", { method: "GET" });
    goToPanel();
  } catch (_error) {
    saveToken("");
    setTab("login");
  }
}

bootstrap();
