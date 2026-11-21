"use client";

// Insights area: only the admin and Insights logins get in (others go to their own page)
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, setRole } from "@/lib/api";
import AppShell from "@/components/insights/AppShell";
import { DataProvider } from "@/components/insights/DataProvider";
import { SessionProvider } from "@/components/insights/Session";

export default function InsightsLayout({ children }) {
  const router = useRouter();
  const [me, setMe] = useState(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api("/api/auth/me")
      .then((r) => {
        setRole(r.role);
        if (r.role === "admin" || r.role === "insights") setMe({ user: r.user, role: r.role });
        else router.replace("/portal");
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!me) {
    return (
      <div style={s.loading}>
        <style>{"@keyframes ins-spin { to { transform: rotate(360deg) } }"}</style>
        <span style={s.spinner} />
      </div>
    );
  }

  return (
    <div style={s.page}>
      <SessionProvider value={me}>
        <DataProvider>
          <AppShell>{children}</AppShell>
        </DataProvider>
      </SessionProvider>
    </div>
  );
}

const s = {
  page: { color: "#0e2a33", minHeight: "100vh" },
  loading: { minHeight: "100vh", display: "grid", placeItems: "center", background: "#f3fbfd" },
  spinner: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "3px solid rgba(50,193,223,0.14)",
    borderTopColor: "#32c1df",
    animation: "ins-spin .8s linear infinite",
  },
};
