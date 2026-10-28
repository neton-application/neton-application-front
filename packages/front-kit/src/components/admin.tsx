"use client";

import * as React from "react";
import { KitLink } from "./nav";
import { cn } from "../cn";
import { Alert } from "./alert";
import { Button } from "./button";
import { Portal } from "./portal";
import { useKitLabels } from "./labels";
import { useModalFocus } from "./modal-focus";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from "./select";
import { Table, TBody, TD, TH, THead, TR } from "./table";
import {
  AssignIcon,
  BanIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DeleteIcon,
  DownloadIcon,
  EditIcon,
  KeyIcon,
  ListIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PowerIcon,
  RefreshIcon,
  RetryIcon,
  SettingsIcon,
  UploadIcon,
  ViewIcon,
  type FrontIcon,
} from "../icons";

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: React.ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="front-surface relative flex flex-col gap-3 overflow-hidden rounded-xl px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
      <span className="absolute inset-y-4 left-0 w-[2px] rounded-r-full bg-[var(--foreground)]" />
      <div className="min-w-0">
        <div className="text-[10px] font-medium tracking-[0.17em] text-[var(--muted-foreground)]">{eyebrow}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold tracking-[-0.025em] text-[var(--foreground)]">{title}</h1>
          <p className="max-w-3xl text-[11px] leading-5 text-[var(--muted-foreground)]">{description}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
}

export function FilterPanel({ children, onSubmit }: { children: React.ReactNode; onSubmit: React.FormEventHandler }) {
  return (
    <form onSubmit={onSubmit} className="front-surface rounded-xl p-4 md:px-5 md:py-3.5">
      {children}
    </form>
  );
}

/** 表单项：[error] 是该字段的错误提示（已翻译），显示在输入控件下方。 */
export function Field({ children, label, error }: { children: React.ReactNode; label: string; error?: string | null }) {
  return <label className="flex min-w-0 flex-col gap-1.5"><span className="block text-[11px] font-medium text-[var(--muted-foreground)]">{label}</span>{children}{error && <span role="alert" className="block text-[11px] text-red-600">{error}</span>}</label>;
}

const EMPTY_SELECT_VALUE = "__neton_empty_select_value__";

export function Select({
  children,
  className,
  defaultValue,
  disabled,
  name,
  onChange,
  required,
  value,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const options = React.Children.toArray(children).filter(
    (child): child is React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>> =>
      React.isValidElement(child) && child.type === "option",
  );
  const encodeValue = (next: string | number | readonly string[] | undefined) => {
    const normalized = Array.isArray(next) ? String(next[0] ?? "") : String(next ?? "");
    return normalized === "" ? EMPTY_SELECT_VALUE : normalized;
  };
  const emitChange = (next: string) => {
    const normalized = next === EMPTY_SELECT_VALUE ? "" : next;
    onChange?.({
      target: { name: name ?? "", value: normalized },
      currentTarget: { name: name ?? "", value: normalized },
    } as React.ChangeEvent<HTMLSelectElement>);
  };
  return (
    <SelectRoot
      value={value === undefined ? undefined : encodeValue(value)}
      defaultValue={defaultValue === undefined ? undefined : encodeValue(defaultValue)}
      disabled={disabled}
      name={name}
      required={required}
      onValueChange={emitChange}
    >
      <SelectTrigger
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        className={className}
        id={props.id}
        title={props.title}
        size={className?.includes("h-8") ? "sm" : "default"}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option, index) => {
          const optionValue = encodeValue(option.props.value ?? index);
          return (
            <SelectItem key={option.key ?? optionValue} value={optionValue} disabled={option.props.disabled}>
              {option.props.children}
            </SelectItem>
          );
        })}
      </SelectContent>
    </SelectRoot>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full resize-y rounded-md border border-[var(--input)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--body-foreground)] shadow-[var(--shadow-xs)] outline-none placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--ring)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[var(--input)]/20",
        className,
      )}
      {...props}
    />
  );
}

export interface DataColumn<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

export function DataTable<T>({
  columns,
  emptyDescription,
  emptyTitle,
  error,
  loading,
  minWidth = 900,
  rowKey,
  rows,
}: {
  columns: DataColumn<T>[];
  emptyDescription?: string;
  emptyTitle?: string;
  error?: string | null;
  loading: boolean;
  minWidth?: number;
  rowKey: (row: T) => React.Key;
  rows: T[];
}) {
  const labels = useKitLabels();
  emptyTitle ??= labels.emptyTitle;
  emptyDescription ??= labels.emptyDescription;
  return (
    <>
      {error && <div className="p-5"><Alert tone="error">{error}</Alert></div>}
      <div className="overflow-x-auto">
        <Table style={{ minWidth }}>
          <THead>
            <TR>{columns.map((column) => <TH key={column.key} className={column.headerClassName}>{column.header}</TH>)}</TR>
          </THead>
          <TBody>
            {loading ? Array.from({ length: 6 }, (_, rowIndex) => (
              <TR key={rowIndex}>
                {columns.map((column, columnIndex) => (
                  <TD key={column.key}><span className="block h-4 animate-pulse rounded bg-[var(--muted)]" style={{ width: `${58 + ((rowIndex + columnIndex) % 3) * 14}%` }} /></TD>
                ))}
              </TR>
            )) : rows.map((row) => (
              <TR key={rowKey(row)}>{columns.map((column) => <TD key={column.key} className={column.className}>{column.cell(row)}</TD>)}</TR>
            ))}
          </TBody>
        </Table>
      </div>
      {!loading && !error && rows.length === 0 && (
        <div className="py-16 text-center">
          <div className="text-sm font-semibold text-[var(--muted-foreground)]">{emptyTitle}</div>
          <div className="mt-1 text-xs text-[var(--muted-foreground)]">{emptyDescription}</div>
        </div>
      )}
    </>
  );
}

export function Pagination({
  loading,
  onPageChange,
  onPageSizeChange,
  page,
  pageSize,
  total,
}: {
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  page: number;
  pageSize: number;
  total: number;
}) {
  const labels = useKitLabels();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [jump, setJump] = React.useState(String(page));
  React.useEffect(() => setJump(String(page)), [page]);
  const candidates = new Set([1, totalPages, page - 1, page, page + 1].filter((value) => value >= 1 && value <= totalPages));
  const pages = [...candidates].sort((a, b) => a - b);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--card)] px-5 py-3.5">
      <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs text-[var(--muted-foreground)]">
        <span>{labels.total(labels.formatNumber(total))}</span>
        <Select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="h-8 w-auto text-xs">
          {[10, 20, 50].map((size) => <option key={size} value={size}>{labels.perPage(size)}</option>)}
        </Select>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button variant="outline" size="sm" onClick={() => !loading && page > 1 && onPageChange(page - 1)}><ChevronLeftIcon aria-hidden="true" className="h-3.5 w-3.5" />{labels.previous}</Button>
        {pages.map((value, index) => <React.Fragment key={value}>
          {index > 0 && value - pages[index - 1] > 1 && <span className="px-1 text-xs text-[var(--muted-foreground)]">…</span>}
          <Button variant={value === page ? "default" : "outline"} size="sm" className="min-w-8 px-2" onClick={() => !loading && onPageChange(value)}>{value}</Button>
        </React.Fragment>)}
        <Button variant="outline" size="sm" onClick={() => !loading && page < totalPages && onPageChange(page + 1)}>{labels.next}<ChevronRightIcon aria-hidden="true" className="h-3.5 w-3.5" /></Button>
        {totalPages > 5 && <form className="ml-1 flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--muted-foreground)]" onSubmit={(event) => { event.preventDefault(); if (loading) return; const value = Math.min(totalPages, Math.max(1, Number(jump) || 1)); setJump(String(value)); onPageChange(value); }}>
          <span>{labels.goTo}</span><input aria-label={labels.pageNumber} className="h-8 w-14 rounded-md border border-[var(--input)] bg-[var(--card)] px-2 text-center text-xs text-[var(--foreground)] shadow-[var(--shadow-xs)] outline-none focus-visible:border-[var(--ring)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/20 dark:bg-[var(--input)]/20" inputMode="numeric" value={jump} onChange={(event) => setJump(event.target.value.replace(/\D/g, ""))} /><span>{labels.pageSuffix}</span>
        </form>}
      </div>
    </div>
  );
}

export interface RowAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: FrontIcon;
  kind?: "view" | "edit" | "create" | "delete" | "enable" | "disable" | "retry" | "refresh" | "assign" | "settings" | "copy" | "download" | "upload" | "list" | "key";
  danger?: boolean;
  disabled?: boolean;
  tone?: "neutral" | "primary" | "positive";
}

function inferActionIcon(action: RowAction): FrontIcon | undefined {
  if (action.icon) return action.icon;
  const byKind: Record<NonNullable<RowAction["kind"]>, FrontIcon> = {
    assign: AssignIcon,
    copy: CopyIcon,
    create: PlusIcon,
    delete: DeleteIcon,
    disable: BanIcon,
    download: DownloadIcon,
    edit: EditIcon,
    enable: PowerIcon,
    key: KeyIcon,
    list: ListIcon,
    refresh: RefreshIcon,
    retry: RetryIcon,
    settings: SettingsIcon,
    upload: UploadIcon,
    view: ViewIcon,
  };
  if (action.kind) return byKind[action.kind];

  // Transitional fallback keeps existing modules visually consistent while
  // callers migrate to explicit semantic kinds.
  const label = action.label;
  // 中英文关键字都认：按钮文案翻译后图标不能消失。
  if (/删除|移除|delete|remove/i.test(label)) return DeleteIcon;
  if (/编辑|修改|edit|modify/i.test(label)) return EditIcon;
  if (/新增|创建|添加|add|create|new/i.test(label)) return PlusIcon;
  if (/查看|详情|view|detail/i.test(label)) return ViewIcon;
  if (/记录|列表|成员|设备|好友|群组|records?|list|members?|devices?|friends?|groups?/i.test(label)) return ListIcon;
  if (/重置密码|密钥|密码|password|secret|key/i.test(label)) return KeyIcon;
  if (/分配|授权|角色|assign|grant|roles?/i.test(label)) return AssignIcon;
  if (/配置|设置|config|settings?/i.test(label)) return SettingsIcon;
  if (/重试|retry/i.test(label)) return RetryIcon;
  if (/刷新|refresh/i.test(label)) return RefreshIcon;
  if (/复制|copy/i.test(label)) return CopyIcon;
  if (/导出|下载|export|download/i.test(label)) return DownloadIcon;
  if (/导入|上传|import|upload/i.test(label)) return UploadIcon;
  if (/启用|上线|enable|activate/i.test(label)) return PowerIcon;
  if (/停用|禁用|封禁|下线|disable|ban|deactivate/i.test(label)) return BanIcon;
  return undefined;
}

/** 行内最多直接摆两个主操作；多出来的排到「更多」菜单最前面，不丢。 */
export function RowActions({ primary: allPrimary, more: extra = [] }: { primary: RowAction[]; more?: RowAction[] }) {
  const primary = allPrimary.slice(0, 2);
  const more = [...allPrimary.slice(2), ...extra];
  const labels = useKitLabels();
  function actionNode(action: RowAction, compact = false) {
    const tone = action.danger ? "danger" : action.tone ?? "neutral";
    const Icon = inferActionIcon(action);
    // 行内按钮按 shadcn 表格的惯例用 ghost 风格：平时无边框无底色、悬停才出底色，一行里不出现实心大按钮；
    // tone 只体现在文字颜色上（primary 更醒目、danger 红、positive 绿）。不折行。
    const className = cn(
      compact
        ? "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium outline-none transition-colors hover:bg-[var(--muted)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/30"
        : "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium transition hover:bg-[var(--muted)]",
      tone === "danger" && "text-red-600 dark:text-red-400",
      tone === "primary" && "text-[var(--foreground)]",
      tone === "positive" && "text-emerald-700 dark:text-emerald-400",
      tone === "neutral" && (compact ? "text-[var(--muted-foreground)] hover:text-[var(--foreground)]" : "text-[var(--body-foreground)]"),
      action.disabled && "pointer-events-none opacity-50",
    );
    const invoke = () => action.onClick?.();
    const content = <>{Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />}<span>{action.label}</span></>;
    return action.href ? <KitLink key={action.label} href={action.href} className={className}>{content}</KitLink> : <button key={action.label} type="button" className={className} disabled={action.disabled} onClick={invoke}>{content}</button>;
  }
  return <div className="flex items-center justify-end gap-0.5 whitespace-nowrap">
    {primary.map((action) => actionNode(action, true))}
    {more.length > 0 && <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={labels.moreActions} title={labels.moreActions} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] outline-none transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring)]/30 data-[state=open]:bg-[var(--muted)] data-[state=open]:text-[var(--foreground)]">
          <MoreHorizontalIcon aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {more.map((action) => {
          const Icon = inferActionIcon(action);
          const content = <>{Icon && <Icon aria-hidden="true" />}<span>{action.label}</span></>;
          return action.href ? (
            <DropdownMenuItem key={action.label} asChild disabled={action.disabled} destructive={action.danger}>
              <KitLink href={action.href}>{content}</KitLink>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={action.label} disabled={action.disabled} destructive={action.danger} onSelect={action.onClick}>
              {content}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>;
}

export function StatusBadge({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className={cn(
      // shadcn Badge 的比例：rounded-md、px-2 py-0.5、text-xs font-medium，且永不折行
      "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
      active ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]",
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-[var(--muted-foreground)]")} />
      {children}
    </span>
  );
}

export function Drawer({
  children,
  description,
  footer,
  onClose,
  open,
  title,
  widthClassName = "max-w-lg",
}: {
  children: React.ReactNode;
  description?: string;
  footer?: React.ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
  widthClassName?: string;
}) {
  const labels = useKitLabels();
  const panelRef = React.useRef<HTMLElement>(null);
  const titleId = React.useId();
  useModalFocus(panelRef, open, onClose);

  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex justify-end bg-[#09090b]/30 backdrop-blur-sm" onMouseDown={onClose}>
        <aside
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onMouseDown={(event) => event.stopPropagation()}
          className={cn("flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-[-24px_0_70px_rgba(0,0,0,0.2)]", widthClassName)}
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-5 py-4">
            <div><h2 id={titleId} className="text-lg font-bold text-[var(--foreground)]">{title}</h2>{description && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{description}</p>}</div>
            <button type="button" onClick={onClose} aria-label={labels.close(title)} className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-lg text-[var(--muted-foreground)] transition hover:bg-[var(--muted)]">×</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--card)] px-5 py-4">{footer}</div>}
        </aside>
      </div>
    </Portal>
  );
}

export function ConfirmDialog({
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  open,
  pending = false,
  title,
}: {
  confirmLabel?: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  pending?: boolean;
  title: string;
}) {
  const labels = useKitLabels();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  // 破坏性确认：初始焦点放在「取消」上，回车不会误触执行。
  useModalFocus(dialogRef, open, () => { if (!pending) onCancel(); });
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#09090b]/35 px-4 backdrop-blur-sm" onMouseDown={onCancel}>
        <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_24px_80px_rgba(20,45,37,0.22)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--foreground)]">{title}</h2>
          <p id={descriptionId} className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{description}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={pending} data-autofocus>{labels.cancel}</Button>
            <Button variant="destructive" onClick={onConfirm} disabled={pending}>{pending ? labels.processing : confirmLabel ?? labels.confirm}</Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
