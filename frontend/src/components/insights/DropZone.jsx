"use client";

import { useRef, useState } from "react";
import { theme } from "@/lib/insights/constants";

// Drag & drop or click to choose files
export default function DropZone({ onFiles, compact }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const handle = (list) => list && list.length && onFiles([...list]);

  return (
    <div
      onClick={() => input.current.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
      style={{ ...s.zone, ...(compact ? s.compact : {}), ...(over ? s.over : {}) }}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept=".csv,.xls,.xlsx,.txt"
        style={{ display: "none" }}
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = "";
        }}
      />
      <div style={s.icon}>⇪</div>
      <div style={s.title}>Drop files here or <span style={s.link}>browse</span></div>
      <div style={s.sub}>All export files for one platform at once · CSV / Excel</div>
    </div>
  );
}

const s = {
  zone: {
    borderWidth: 2, borderStyle: "dashed", borderColor: "#c9cdf8",
    borderRadius: 18,
    padding: "34px 20px",
    textAlign: "center",
    cursor: "pointer",
    background: "linear-gradient(180deg, #fafaff, #f5f6ff)",
    transition: "all .15s",
  },
  compact: { padding: "20px 16px" },
  over: { background: theme.primarySoft, borderColor: theme.primary, transform: "scale(1.01)" },
  icon: {
    width: 52,
    height: 52,
    margin: "0 auto 12px",
    borderRadius: 16,
    background: theme.gradient,
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontSize: 22,
    boxShadow: "0 10px 24px -10px rgba(50,193,223,0.8)",
  },
  title: { fontWeight: 650, color: theme.text, fontSize: 15 },
  link: { color: theme.primary, textDecoration: "underline" },
  sub: { color: theme.muted, fontSize: 12.5, marginTop: 4 },
};
