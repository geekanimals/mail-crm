"use client";

import Select from "./Select";
import { useData } from "@/components/insights/DataProvider";
import { PLATFORMS } from "@/lib/insights/constants";

// Account + Platform filter used on every dashboard page
export default function FilterBar({ filters, setFilters }) {
  const { accounts } = useData();
  const set = (k) => (v) => setFilters({ ...filters, [k]: v });

  return (
    <>
      <Select label="Account" value={filters.account} onChange={set("account")} options={["All", ...accounts]} />
      <Select label="Platform" value={filters.platform} onChange={set("platform")} options={["All", ...PLATFORMS]} />
    </>
  );
}
