"use client";

// Red bar on every Insights page when a Facebook / Instagram auto-fetch failed — links to Connections
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/insights/api";
import { theme } from "@/lib/insights/constants";

export default function MetaAlert() {
  const [failed, setFailed] = useState([]);

  useEffect(() => {
    let active = true;
    api.metaStatus().then(
      (d) => active && setFailed((d.connections || []).filter((c) => c.status === "error")),
      () => {} // no Meta set up / no access → nothing to show
    );
    return () => {
      active = false;
    };
  }, []);

  if (!failed.length) return null;
  return (
    <div style={s.bar}>
      <b>⚠ Auto-fetch failed:</b>{" "}
      {failed.map((c) => `${c.account} · ${c.platform} (${c.lastError})`).join(" · ")}
      <Link href="/insights/connections" style={s.link}>Open Connections →</Link>
    </div>
  );
}

const s = {
  bar: {
    background: theme.redSoft,
    border: "1px solid rgba(215,0,21,0.25)",
    color: "#9f1239",
    borderRadius: 14,
    padding: "10px 14px",
    fontSize: 13.5,
    marginBottom: 16,
    lineHeight: 1.5,
    backdropFilter: theme.blur,
    WebkitBackdropFilter: theme.blur,
  },
  link: { marginLeft: 10, fontWeight: 700, color: "#9f1239" },
};
