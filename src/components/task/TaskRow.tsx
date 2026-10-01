"use client";

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, CornerDownRight, GripVertical, MoreHorizontal, Trash2 } from "lucide-react";
import type { TaskNode } from "@/lib/types";
import type { TaskActions } from "@/lib/data/useTaskActions";
import { TREE_INDENT, childProgress } from "@/lib/data/tree";
import { useDeleteTask } from "@/lib/data/useDeleteTask";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { StatusControl } from "@/components/ui/StatusControl";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { SubtaskProgress } from "@/components/ui/SubtaskProgress";
import { TagChip } from "@/components/ui/TagChip";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { AssigneePicker, AssigneeStack, DuePicker, PrioritySelect } from "./Pickers";
import { cn, hasTextSelection, isInteractiveTarget, taskAssignees } from "@/lib/utils";

export function TaskRow({
  node,
  actions,
  collapsed,
  onToggleCollapse,
  onOpen,
  onAddSubtask,
  selected,
  draggable = false,
  dragging = false,
  dropDepth,
  picked = false,
  cursored = false,
  onPick,
}: {
  node: TaskNode;
  actions: TaskActions;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpen: () => void;
  /** Omitted in cross-project views (My Tasks) where there is no single target project. */
  onAddSubtask?: () => void;
  selected?: boolean;
  /** Registers the row as a sortable and shows its grip. Tree, manual order only. */
  draggable?: boolean;
  /** This row is the one being dragged. */
  dragging?: boolean;
  /** Live projected depth while dragging, so the indent previews where it lands. */
  dropDepth?: number;
  /** In the current multi-selection. */
  picked?: boolean;
  /** The keyboard cursor is on this row. Distinct from `picked`: moving the
   *  cursor does not select, which is what makes shift-extend work. */
  cursored?: boolean;
  /** Row click with modifiers, for multi-select. */
  onPick?: (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
}) {
  const { tasks } = useWorkspace();
  const confirmDelete = useDeleteTask(actions);
  const hasChildren = node.children.length > 0;
  const { done, total } = childProgress(tasks, node.id);
  const [title, setTitle] = useState(node.title);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setTitle(node.title);
  }, [node.title]);

  const commit = () => {
    editing.current = false;
    const t = title.trim();
    if (t && t !== node.title) actions.rename(node.id, t);
    else if (!t) setTitle(node.title);
  };

  // Registered unconditionally so hook order stays stable; the listeners are
  // only attached to the grip when `draggable` is on.
  const sortable = useSortable({ id: node.id, disabled: !draggable });
  const depth = dropDepth ?? node.depth;

  const assignees = taskAssignees(node);
  // Drives the phone-only second line: no metadata, no second line, so plain
  // tasks stay a single compact row.
  const hasMeta = Boolean(node.dueDate) || total > 0 || node.tags.length > 0 || assignees.length > 0;

  /**
   * The whole row opens the task, except the parts that do something else.
   *
   * Before, only the small chevron at the far right opened it, which meant
   * aiming at a 24px target on every single task. Controls and the title input
   * are excluded (see `isInteractiveTarget`), so renaming, the status dot and
   * the pickers behave exactly as they did. A modifier-click keeps meaning
   * "multi-select" rather than "open", so bulk selection is not lost.
   */
  const handleRowClick = (e: React.MouseEvent) => {
    if (isInteractiveTarget(e.target) || hasTextSelection()) return;
    if (onPick && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      onPick({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
      return;
    }
    onOpen();
  };

  return (
    <div
      ref={draggable ? sortable.setNodeRef : undefined}
      onClick={handleRowClick}
      data-task-row={node.id}
      style={{
        // Driven by --tree-indent so a phone gets a tighter step than a desktop.
        paddingLeft: `calc(8px + ${depth} * var(--tree-indent, ${TREE_INDENT}px))`,
        // The dragged row itself stays put and only previews its landing
        // indent; the overlay is what follows the cursor. Other rows still
        // translate to open the gap.
        transform: draggable && !dragging ? CSS.Translate.toString(sortable.transform) : undefined,
        transition: draggable && !dragging ? sortable.transition : undefined,
      }}
      className={cn(
        "group flex cursor-pointer items-start gap-1 rounded-md pr-1 transition-colors duration-150 sm:items-center sm:gap-1.5 sm:pr-2",
        selected ? "bg-accent/[0.09] ring-1 ring-inset ring-accent/30" : "hover:bg-hairline/[0.045]",
        picked && "bg-accent/[0.09]",
        cursored && !selected && "ring-1 ring-inset ring-hairline/15",
        dragging && "bg-accent/[0.06] opacity-60 ring-1 ring-inset ring-accent/30"
      )}
    >
      {/* Selection checkbox. Hidden until hover or selection so the row stays
          calm, but always present on touch where hover does not exist. */}
      {onPick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPick({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
          }}
          aria-label={picked ? `Deselect ${node.title}` : `Select ${node.title}`}
          aria-pressed={picked}
          className={cn(
            "grid h-8 w-6 shrink-0 place-items-center rounded transition-opacity sm:h-5 sm:w-5",
            picked ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          )}
        >
          <span
            className={cn(
              "grid h-3.5 w-3.5 place-items-center rounded-[3px] border transition-colors",
              picked ? "border-accent bg-accent text-accent-fg" : "border-hairline/25"
            )}
          >
            {picked && (
              <svg viewBox="0 0 10 8" className="h-2 w-2 fill-none stroke-current stroke-[2]">
                <path d="M1 4l2.5 2.5L9 1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </button>
      )}
      {/* drag grip */}
      {draggable && (
        <button
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`Reorder ${node.title}`}
          title="Drag to reorder. Drag sideways to nest."
          className="hidden h-6 w-5 shrink-0 cursor-grab touch-none place-items-center rounded text-text-faint transition-opacity hover:text-text active:cursor-grabbing sm:grid sm:h-5 sm:w-4 sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}

      {/* caret */}
      <button
        onClick={onToggleCollapse}
        className={cn(
          "grid h-8 w-6 shrink-0 place-items-center rounded text-text-faint transition-all hover:bg-hairline/[0.08] hover:text-text sm:h-5 sm:w-5",
          !hasChildren && "invisible"
        )}
        tabIndex={-1}
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", !collapsed && "rotate-90")} />
      </button>

      <div className="grid h-11 w-6 shrink-0 place-items-center sm:h-auto sm:w-auto sm:py-1.5">
        <StatusControl status={node.status} onChange={(s) => actions.setStatus(node.id, s)} />
      </div>

      {/* Title, plus the phone-only second line.

          On a phone the fixed metadata columns below would leave the title
          around 90px wide, which truncated almost every task to a few
          characters. Under `sm` the row becomes two lines instead: the title
          takes the full width, and whatever metadata actually exists drops
          underneath it. From `sm` up this is a plain flex row again, so the
          desktop layout is untouched. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center sm:flex-row sm:items-center">
        <input
          value={title}
          onFocus={() => (editing.current = true)}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setTitle(node.title);
              editing.current = false;
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={cn(
            "w-full min-w-0 truncate rounded bg-transparent px-1 py-[7px] text-sm outline-none transition-colors focus:bg-hairline/[0.06] sm:flex-1",
            node.status === "done" ? "text-text-faint line-through decoration-text-faint/50" : "text-text"
          )}
        />

        {hasMeta && (
          <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap px-1 pb-1.5 sm:hidden">
            {node.dueDate && (
              <DueDateChip date={node.dueDate} time={node.dueTime} status={node.status} />
            )}
            {total > 0 && <SubtaskProgress done={done} total={total} />}
            {node.tags.slice(0, 1).map((t) => (
              <TagChip key={t} tag={t} className="min-w-0 truncate" />
            ))}
            {assignees.length > 0 && (
              <span className="ml-auto shrink-0">
                <AssigneeStack assignees={assignees} size={17} max={2} />
              </span>
            )}
          </div>
        )}
      </div>

      {/* Metadata sits in fixed right-aligned columns so it lines up down the
          whole list rather than ragging against each title's length. */}
      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        <div className="hidden w-[130px] min-w-0 shrink-0 items-center justify-end gap-1.5 overflow-hidden whitespace-nowrap lg:flex">
          {node.tags.slice(0, 2).map((t) => (
            <TagChip key={t} tag={t} />
          ))}
        </div>
        <div className="hidden w-[62px] shrink-0 justify-end md:flex">
          {total > 0 && <SubtaskProgress done={done} total={total} />}
        </div>
        <div className="flex w-[88px] shrink-0 justify-end">
          {node.dueDate && <DueDateChip date={node.dueDate} time={node.dueTime} status={node.status} />}
        </div>
        <div className="flex w-[22px] justify-center">
          <PrioritySelect value={node.priority} onChange={(p) => actions.setPriority(node.id, p)} />
        </div>
        <div className="flex w-[26px] justify-center">
          <AssigneePicker
            value={taskAssignees(node)}
            onChange={(a) => actions.setAssignees(node.id, a)}
            size={20}
          />
        </div>

        {/* hover actions */}
        {/* Hover-only actions are unreachable on touch, so they stay visible
            below sm and reveal on hover from sm up. */}
        <div className="flex w-[78px] items-center justify-end opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          {onAddSubtask && (
            <button
              onClick={onAddSubtask}
              title="Add subtask"
              className="grid h-6 w-6 place-items-center rounded-md text-text-faint transition-colors hover:bg-hairline/[0.09] hover:text-text"
            >
              <CornerDownRight className="h-3.5 w-3.5" />
            </button>
          )}
          <Dropdown
            align="right"
            width={168}
            trigger={() => (
              <span className="grid h-6 w-6 place-items-center rounded-md text-text-faint transition-colors hover:bg-hairline/[0.09] hover:text-text">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </span>
            )}
          >
            {(close) => (
              <div>
                {onAddSubtask && (
                  <MenuItem
                    icon={<CornerDownRight className="h-4 w-4" />}
                    onClick={() => {
                      onAddSubtask();
                      close();
                    }}
                  >
                    Add subtask
                  </MenuItem>
                )}
                <MenuItem onClick={() => { onOpen(); close(); }}>Open details</MenuItem>
                <div className="my-1 h-px bg-hairline/[0.08]" />
                <MenuItem
                  danger
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => {
                    close();
                    void confirmDelete(node.id, node.title);
                  }}
                >
                  Delete{total > 0 ? ` + ${total} subtask${total === 1 ? "" : "s"}` : ""}
                </MenuItem>
              </div>
            )}
          </Dropdown>
          <button
            onClick={onOpen}
            title="Open"
            className="grid h-6 w-6 place-items-center rounded-md text-text-faint transition-colors hover:bg-hairline/[0.09] hover:text-text"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* On a phone the three hover actions became three always-visible buttons
          eating ~78px of a 390px row. They collapse to one 44px tap target
          here; opening the task is the row tap itself. */}
      <button
        onClick={onOpen}
        aria-label={`Open ${node.title}`}
        className="press -mr-1 grid h-11 w-9 shrink-0 place-items-center rounded-md text-text-faint active:bg-hairline/[0.08] sm:hidden"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Optional scheduling chosen in the composer, before the task exists. */
export interface QuickAddDue {
  dueDate?: string | null;
  /** HH:MM, 24h. */
  dueTime?: string | null;
  dueEndTime?: string | null;
}

export function QuickAdd({
  depth = 0,
  placeholder = "Add task",
  onAdd,
  autoFocus,
  onCancel,
  inputRef,
  hint,
  due = true,
}: {
  depth?: number;
  placeholder?: string;
  onAdd: (title: string, due: QuickAddDue) => void;
  autoFocus?: boolean;
  onCancel?: () => void;
  /** Lets a parent focus this composer, e.g. from a keyboard shortcut. */
  inputRef?: React.RefObject<HTMLInputElement>;
  /** Key cap shown at rest, e.g. "N". Only pass one that is actually bound. */
  hint?: string;
  /** Offer a date and time picker on the row. Off where the date is already
   *  decided by the surface (a calendar day), so it is not asked for twice. */
  due?: boolean;
}) {
  const [value, setValue] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // The live values are mirrored in refs so `onBlur` never reads a stale render
  // closure. Enter used to submit and clear state, then the blur that followed
  // still saw the old value and submitted the same task a second time.
  const valueRef = useRef("");
  const dueRef = useRef<QuickAddDue>({});
  dueRef.current = { dueDate: date, dueTime: time, dueEndTime: endTime };
  const localRef = useRef<HTMLInputElement | null>(null);
  // True while the date panel is open. Picking a day moves focus into the panel,
  // which blurs the input — and a blur is how this composer decides you are
  // done. Without this the first click on the calendar would submit an
  // unfinished task, or close the composer before you could choose a time.
  const pickerOpenRef = useRef(false);

  const update = (v: string) => {
    valueRef.current = v;
    setValue(v);
  };

  /** Submit once. Clearing the ref first makes a following blur a no-op. */
  const submit = () => {
    const title = valueRef.current.trim();
    if (!title) return;
    const chosen = dueRef.current;
    update("");
    // Reset the schedule with the title: carrying yesterday's 3pm into the next
    // task you type is a quiet way to schedule things you did not mean to.
    setDate(null);
    setTime(null);
    setEndTime(null);
    onAdd(title, chosen);
  };

  const setPickerState = (open: boolean) => {
    pickerOpenRef.current = open;
    setPickerOpen(open);
    // Closing the panel returns you to typing, which is where you were.
    if (!open) localRef.current?.focus();
  };

  return (
    <div
      className="group/qa flex items-center gap-1.5 rounded-md transition-colors hover:bg-hairline/[0.045]"
      style={{ paddingLeft: 8 + depth * 20 }}
    >
      <span className="grid h-5 w-5 place-items-center text-text-faint">
        <CornerDownRight className={cn("h-3.5 w-3.5", depth === 0 && "opacity-0")} />
      </span>
      <span className="grid h-4 w-4 place-items-center rounded-full border-[1.5px] border-dashed border-hairline/25" />
      <input
        ref={(el) => {
          localRef.current = el;
          if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
        }}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            // Escape with the panel open is the panel's to handle; the composer
            // closing underneath it would throw away what you were choosing.
            if (pickerOpenRef.current) return;
            update("");
            setDate(null);
            setTime(null);
            setEndTime(null);
            onCancel?.();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          if (pickerOpenRef.current) return;
          submit();
          onCancel?.();
        }}
        className="min-w-0 flex-1 bg-transparent px-1 py-[7px] text-sm text-text outline-none placeholder:text-text-faint"
      />
      {due && (
        // Mousedown is cancelled on the trigger so clicking it never pulls focus
        // off the input in the first place. The panel itself is in a portal, so
        // focus does move once you are inside it — that is what the open flag
        // above covers.
        <span
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) e.preventDefault();
          }}
          className={cn(
            "shrink-0 transition-opacity",
            // Quiet until you are here, but never hidden once it holds a value
            // or is open: a chosen date that vanishes reads as lost.
            date || pickerOpen
              ? "opacity-100"
              : "opacity-100 sm:opacity-0 sm:group-hover/qa:opacity-100 sm:group-focus-within/qa:opacity-100"
          )}
        >
          <DuePicker
            value={date}
            time={time}
            endTime={endTime}
            onChange={setDate}
            onTimeChange={setTime}
            onEndTimeChange={setEndTime}
            onOpenChange={setPickerState}
          />
        </span>
      )}
      {hint && !value && (
        <kbd className="mono mr-1 hidden shrink-0 rounded border border-hairline/[0.08] bg-hairline/[0.04] px-1.5 py-0.5 text-2xs text-text-faint sm:block">
          {hint}
        </kbd>
      )}
    </div>
  );
}
