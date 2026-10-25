"use client";

import * as React from "react";
import { apiFetch, apiWrite } from "@neton/application-front-runtime/client";
import { useMutation, usePermission, useQuery, useQueryClient } from "@neton/application-front-runtime/client-context";
import type { PageResponse } from "@neton/application-front-runtime/types";
import { formatDateTime, formatMoney } from "@neton/application-front-runtime/types";
import { useDescribeError, useDescribeFieldErrors } from "@neton/application-front-runtime/errors";
import { useT, type Translate } from "@neton/application-front-runtime/i18n";
import {
  Button, ConfirmDialog, DataTable, Drawer, Field, FilterPanel, Input, PageHeader,
  Pagination, RowActions, Select, StatusBadge, Textarea, type DataColumn, type RowAction,
} from "@neton/application-front-kit";

export type ResourceRecord = Record<string, unknown> & { id: number };
export type ResourceFieldType = "text" | "number" | "select" | "textarea";

export interface ResourceOption { label: string; value: string | number }
export interface ResourceField {
  key: string;
  label: string;
  type?: ResourceFieldType;
  placeholder?: string;
  required?: boolean;
  options?: ResourceOption[];
  defaultValue?: string | number;
  filter?: boolean;
  table?: boolean;
  /** 默认可编辑；date 格式和 id 默认只读。 */
  editable?: boolean;
  /** 只在新建表单里出现、校验和提交（如只能在创建时给出的初始密钥）；编辑时整项不出现。 */
  createOnly?: boolean;
  format?: "status" | "date" | "money" | "mono";
}

/** 表单里出现的字段：可编辑的非筛选字段；createOnly 字段只在新建（record 没有 id）时出现。 */
function formFields(fields: ResourceField[], record: Record<string, unknown>): ResourceField[] {
  return fields.filter((field) => !field.filter && field.editable !== false && field.format !== "date" && field.key !== "id"
    && !(field.createOnly && record.id));
}

export interface ResourcePageConfig {
  resourceKey: string;
  /** 模块 id：后端返回的机器码先查该模块语言包里的 `error.<CODE>`（见 runtime useDescribeError）。 */
  errorNamespace?: string;
  eyebrow: string;
  title: string;
  description: string;
  endpoint: string;
  /** 默认 page；也支持 list/list-all/page-all 等真实后端路径。 */
  listPath?: string;
  permissions: { page: string; query?: string; create?: string; update?: string; delete?: string };
  fields: ResourceField[];
  readOnly?: boolean;
  /** 详情抽屉字段；存在时列表提供“详情”操作并调用 get/{id}。 */
  detailFields?: ResourceField[];
  /** 默认 get/{id}；用于 get-detail?id=... 等非标准详情接口。 */
  detailPath?: (record: ResourceRecord) => string;
  pageSize?: number;
  initialFilters?: Record<string, string>;
  /** Always sent with list requests, without rendering another field in the local filter panel. */
  fixedFilters?: Record<string, string>;
  rowActions?: (record: ResourceRecord) => { primary?: RowAction[]; more?: RowAction[] };
  mapSave?: (record: ResourceRecord) => Record<string, unknown>;
  /** 模块专属的轻量页头动作，例如全部标记已读。 */
  headerActions?: React.ReactNode;
}

function valueOf(value: unknown): string | number {
  if (typeof value === "number" || typeof value === "string") return value;
  return "";
}

function makeEmpty(fields: ResourceField[]): ResourceRecord {
  return Object.fromEntries([["id", 0], ...fields.map((field) => [field.key, field.defaultValue ?? ""])]) as ResourceRecord;
}

function renderCell(field: ResourceField, row: ResourceRecord, t: Translate) {
  const value = row[field.key];
  if (field.format === "status") return <StatusBadge active={Number(value) === 1}>{Number(value) === 1 ? t("enabled") : t("disabled")}</StatusBadge>;
  if (field.format === "date") return formatDateTime(value as string | number | null);
  // 金额是最小货币单位（分）；记录上带了币种字段就用它，否则用部署默认币种。
  if (field.format === "money") return <span className="tabular-nums">{formatMoney(value as number, typeof row.currency === "string" ? row.currency : undefined)}</span>;
  if (field.format === "mono") return <code className="text-xs">{String(value ?? "-")}</code>;
  return value === null || value === undefined || value === "" ? <span className="text-[var(--muted-foreground)]">-</span> : String(value);
}

export function ResourcePage({ config }: { config: ResourcePageConfig }) {
  const t = useT("resource");
  const describeError = useDescribeError(config.errorNamespace);
  const describeFieldErrors = useDescribeFieldErrors(config.errorNamespace);
  const queryClient = useQueryClient();
  const canCreate = usePermission(config.permissions.create);
  const canUpdate = usePermission(config.permissions.update);
  const canDelete = usePermission(config.permissions.delete);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(config.pageSize ?? 20);
  const filterFields = config.fields.filter((field) => field.filter);
  const [draft, setDraft] = React.useState<Record<string, string>>(() => Object.fromEntries(filterFields.map((field) => [field.key, config.initialFilters?.[field.key] ?? ""])));
  const [filters, setFilters] = React.useState(draft);
  const [form, setForm] = React.useState<ResourceRecord | null>(null);
  const [deleting, setDeleting] = React.useState<ResourceRecord | null>(null);
  const [viewing, setViewing] = React.useState<ResourceRecord | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const openForm = (record: ResourceRecord) => { setError(null); setFieldErrors({}); setForm(record); };
  const editField = (key: string, value: unknown) => {
    if (!form) return;
    setForm({ ...form, [key]: value });
    if (fieldErrors[key]) setFieldErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const params = new URLSearchParams({ pageNo: String(page), pageSize: String(pageSize) });
  Object.entries(config.fixedFilters ?? {}).forEach(([key, value]) => value !== "" && params.set(key, value));
  Object.entries(filters).forEach(([key, value]) => value !== "" && params.set(key, value));
  const query = useQuery({
    queryKey: [config.resourceKey, page, pageSize, config.fixedFilters, filters],
    queryFn: async () => {
      const data = await apiFetch<PageResponse<ResourceRecord> | ResourceRecord[]>(`/admin${config.endpoint}/${config.listPath ?? "page"}?${params}`);
      return Array.isArray(data) ? { list: data, total: data.length, page: 1, size: data.length, totalPages: 1 } : data;
    },
  });

  const save = useMutation({
    mutationFn: (record: ResourceRecord) => {
      const editable = formFields(config.fields, record);
      const safeRecord = Object.fromEntries([
        ...(record.id ? [["id", record.id]] : []),
        ...editable.map((field) => [field.key, record[field.key]]),
      ]) as ResourceRecord;
      const body = config.mapSave ? config.mapSave(safeRecord) : safeRecord;
      return apiWrite<void>(`/admin${config.endpoint}/${record.id ? "update" : "create"}`, record.id ? "PUT" : "POST", body);
    },
    onSuccess: async () => { setForm(null); await queryClient.invalidateQueries({ queryKey: [config.resourceKey] }); },
    onError: (cause: Error) => { setError(describeError(cause)); setFieldErrors(describeFieldErrors(cause)); },
  });
  const remove = useMutation({
    mutationFn: (record: ResourceRecord) => apiWrite<void>(`/admin${config.endpoint}/delete/${record.id}`, "DELETE"),
    onSuccess: async () => { setDeleting(null); await queryClient.invalidateQueries({ queryKey: [config.resourceKey] }); },
  });

  const tableFields = config.fields.filter((field) => field.table !== false && !field.filter);
  const columns: DataColumn<ResourceRecord>[] = [
    ...tableFields.map((field): DataColumn<ResourceRecord> => ({ key: field.key, header: field.label, cell: (row) => renderCell(field, row, t) })),
    ...((Boolean(config.detailFields) || Boolean(config.rowActions) || (!config.readOnly && (canUpdate || canDelete))) ? [{
      key: "actions", header: t("actions"), headerClassName: "text-right", className: "text-right",
      cell: (row: ResourceRecord) => <RowActions primary={[
        ...(config.rowActions?.(row).primary ?? []),
        ...(config.detailFields ? [{ label: t("view"), kind: "view" as const, onClick: async () => { setDetailLoading(true); setError(null); try { setViewing(await apiFetch<ResourceRecord>(`/admin${config.endpoint}/${config.detailPath?.(row) ?? `get/${row.id}`}`)); } catch (cause) { setError(describeError(cause)); setViewing(row); } finally { setDetailLoading(false); } } }] : []),
        ...(!config.readOnly && canUpdate ? [{ label: t("edit"), kind: "edit" as const, tone: "primary" as const, onClick: () => openForm({ ...row }) }] : []),
      ]} more={[...(config.rowActions?.(row).more ?? []), ...(!config.readOnly && canDelete ? [{ label: t("delete"), kind: "delete" as const, danger: true, onClick: () => setDeleting(row) }] : [])]} />,
    } satisfies DataColumn<ResourceRecord>] : []),
  ];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    const missing = formFields(config.fields, form).find((field) => field.required && String(form[field.key] ?? "").trim() === "");
    if (missing) { setError(t("required", { field: missing.label })); setFieldErrors({ [missing.key]: t("required", { field: missing.label }) }); return; }
    setError(null);
    setFieldErrors({});
    save.mutate(form);
  }

  return <div className="space-y-4">
    <PageHeader eyebrow={config.eyebrow} title={config.title} description={config.description} actions={<>
      {config.headerActions}
      {!config.readOnly && canCreate && <Button onClick={() => openForm(makeEmpty(config.fields))}>{t("create")}</Button>}
      <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>{t("refresh")}</Button>
    </>} />
    {filterFields.length > 0 && <FilterPanel onSubmit={(event) => { event.preventDefault(); setPage(1); setFilters({ ...draft }); }}>
      <div className="flex flex-wrap items-end gap-3">
        {filterFields.map((field) => <div key={field.key} className="min-w-48 flex-1"><Field label={field.label}>
          {field.type === "select" ? <Select value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}><option value="">{t("all")}</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select> : <Input value={draft[field.key]} placeholder={field.placeholder} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />}
        </Field></div>)}
        <Button type="button" variant="ghost" onClick={() => { const next = Object.fromEntries(filterFields.map((field) => [field.key, ""])); setDraft(next); setFilters(next); setPage(1); }}>{t("reset")}</Button>
        <Button type="submit">{t("search")}</Button>
      </div>
    </FilterPanel>}
    <section className="front-surface overflow-hidden rounded-xl">
      <DataTable columns={columns} rows={query.data?.list ?? []} rowKey={(row) => row.id} loading={query.isPending} error={query.error ? describeError(query.error) : null} />
      <Pagination page={page} pageSize={pageSize} total={query.data?.total ?? 0} loading={query.isFetching} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
    </section>
    <Drawer open={Boolean(form)} onClose={() => setForm(null)} title={t(form?.id ? "editTitle" : "createTitle", { title: config.title })} footer={<><Button variant="ghost" onClick={() => setForm(null)}>{t("cancel")}</Button><Button type="submit" form={`${config.resourceKey}-form`} disabled={save.isPending}>{t("save")}</Button></>}>
      {form && <form id={`${config.resourceKey}-form`} className="space-y-4" onSubmit={submit}>
        {error && <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        {formFields(config.fields, form).map((field) => <Field key={field.key} label={field.label} error={fieldErrors[field.key]}>
          {field.type === "select" ? <Select value={valueOf(form[field.key])} onChange={(event) => editField(field.key, Number.isNaN(Number(event.target.value)) ? event.target.value : Number(event.target.value))}>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
            : field.type === "textarea" ? <Textarea value={String(form[field.key] ?? "")} placeholder={field.placeholder} onChange={(event) => editField(field.key, event.target.value)} />
            : <Input type={field.type === "number" ? "number" : "text"} value={valueOf(form[field.key])} placeholder={field.placeholder} onChange={(event) => editField(field.key, field.type === "number" ? Number(event.target.value) : event.target.value)} />}
        </Field>)}
      </form>}
    </Drawer>
    <Drawer open={Boolean(viewing)} onClose={() => setViewing(null)} title={t("detailTitle", { title: config.title })} description={detailLoading ? t("loadingDetail") : t("recordId", { id: viewing?.id ?? "" })} widthClassName="max-w-2xl">
      {viewing && <dl className="overflow-hidden rounded-xl border border-[var(--border)]">{(config.detailFields ?? []).map((field) => <div key={field.key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-4 border-b border-[var(--border)] p-3 last:border-0"><dt className="text-xs font-semibold text-[var(--muted-foreground)]">{field.label}</dt><dd className="break-all text-sm text-[var(--foreground)]">{renderCell(field, viewing, t)}</dd></div>)}</dl>}
    </Drawer>
    <ConfirmDialog open={Boolean(deleting)} title={t("deleteTitle", { title: config.title })} description={t("deleteDescription")} confirmLabel={t("deleteConfirm")} pending={remove.isPending} onCancel={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting)} />
  </div>;
}
