"use client";

// Loads entries and companies from the backend and shares them with every page.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/insights/api";
import { DEFAULT_ACCOUNTS, accountColors } from "@/lib/insights/constants";
import { normalize } from "@/lib/insights/calc";

const DataContext = createContext(null);

const fetchAll = () => Promise.all([api.entries(), api.accounts()]);

export function DataProvider({ children }) {
  const [rows, setRows] = useState([]);
  const [saved, setSaved] = useState(DEFAULT_ACCOUNTS);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");

  const apply = useCallback(([entries, accounts]) => {
    setRows(entries.map(normalize));
    setSaved(accounts.map((a) => a.name));
    setStatus("ready");
    setError("");
  }, []);

  const fail = useCallback((err) => {
    setStatus("error");
    setError(err.message);
  }, []);

  const reload = useCallback(() => fetchAll().then(apply, fail), [apply, fail]);

  // First load (state is set in the promise callback, after the request finishes)
  useEffect(() => {
    let active = true;
    fetchAll().then((d) => active && apply(d), (e) => active && fail(e));
    return () => {
      active = false;
    };
  }, [apply, fail]);

  // Company list = saved companies + any company that already has data
  const accounts = [...new Set([...saved, ...rows.map((r) => r.account)])];

  // Add or replace one entry (same company + platform + start date)
  const upsertRow = async (row) => {
    const res = await api.saveEntry(row);
    await reload();
    return res;
  };

  // Many weekly rows at once (summary sheets)
  const saveRows = async (list) => {
    const res = await api.saveRows(list);
    await reload();
    return res;
  };

  const removeRow = async (row) => {
    await api.deleteEntry(row.id);
    await reload();
  };

  // Returns the saved name (an existing company is reused, any letter case)
  const addAccount = async (name) => {
    const { account } = await api.addAccount(name);
    await reload();
    return account.name;
  };

  return (
    <DataContext.Provider
      value={{ rows, accounts, accountColors: accountColors(accounts), status, error, reload, upsertRow, saveRows, removeRow, addAccount }}
    >
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
