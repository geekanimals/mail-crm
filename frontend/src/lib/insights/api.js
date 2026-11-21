// All Insights calls to the CRM backend (/api/insights), sent with the CRM login token
import { API_URL, getToken, setRole, setToken } from "@/lib/api";

const BASE = API_URL + "/api/insights";

async function request(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let res;
  try {
    res = await fetch(BASE + path, { ...options, headers, cache: "no-store" });
  } catch {
    throw new Error(`Can't reach the server (${API_URL}). Make sure the backend is running.`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // login expired or removed → back to the login page
    setToken(null);
    setRole(null);
    window.location.replace("/login");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  entries: () => request("/entries").then((d) => d.entries),
  saveEntry: (row) => request("/entries", json("POST", row)),
  saveRows: (rows) => request("/entries/bulk", json("POST", { rows })),
  deleteEntry: (id) => request(`/entries/${id}`, { method: "DELETE" }),

  accounts: () => request("/accounts").then((d) => d.accounts),
  addAccount: (name) => request("/accounts", json("POST", { name })),

  // files + { account, platform, week, end } → numbers to review (nothing is saved)
  preview: (files, fields) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    Object.entries(fields).forEach(([k, v]) => v && form.append(k, v));
    return request("/uploads/preview", { method: "POST", body: form });
  },
};
