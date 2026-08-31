"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button, Card, Field, Input, Select } from "../ui";

export type SortKey = "newest" | "oldest" | "company" | "role";

/**
 * Filter and sort state lives in the URL so the server render does the work and
 * a filtered view can be shared or reloaded.
 */
export function JobFilters({ roleOptions }: { roleOptions: string[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const [role, setRole] = useState(params.get("role") ?? "");
  const [company, setCompany] = useState(params.get("company") ?? "");
  const [sort, setSort] = useState<SortKey>((params.get("sort") as SortKey) ?? "newest");

  function apply(next: { role?: string; company?: string; sort?: SortKey }) {
    const query = new URLSearchParams();
    const merged = { role, company, sort, ...next };
    if (merged.role) query.set("role", merged.role);
    if (merged.company) query.set("company", merged.company);
    if (merged.sort && merged.sort !== "newest") query.set("sort", merged.sort);
    router.push(`/candidate${query.toString() ? `?${query}` : ""}`);
  }

  function reset() {
    setRole("");
    setCompany("");
    setSort("newest");
    router.push("/candidate");
  }

  return (
    <Card className="mb-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply({});
        }}
        className="grid gap-4 sm:grid-cols-4"
      >
        <Field label="Role">
          <Select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">All roles</option>
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Company">
          <Input
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="Any company"
          />
        </Field>

        <Field label="Sort by">
          <Select
            value={sort}
            onChange={(event) => {
              const next = event.target.value as SortKey;
              setSort(next);
              apply({ sort: next });
            }}
          >
            <option value="newest">Date of upload, newest first</option>
            <option value="oldest">Date of upload, oldest first</option>
            <option value="company">Company name, A to Z</option>
            <option value="role">Role, A to Z</option>
          </Select>
        </Field>

        <div className="flex items-end gap-2">
          <Button type="submit">Apply</Button>
          <Button type="button" variant="ghost" onClick={reset}>
            Reset
          </Button>
        </div>
      </form>
    </Card>
  );
}
