"use client";

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, CornerDownRight, GripVertical, MoreHorizontal, Trash2 } from "lucide-react";
import type { TaskNode } from "@/lib/types";
import type { TaskActions } from "@/lib/data/useTaskActions";
import { TREE_INDENT, childProgress } from "@/lib/data/tree";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { StatusControl } from "@/components/ui/StatusControl";
import { DueDateChip } from "@/components/ui/DueDateChip";
import { SubtaskProgress } from "@/components/ui/SubtaskProgress";
import { TagChip } from "@/components/ui/TagChip";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { AssigneePicker, DuePicker, PrioritySelect } from "./Pickers";
import { cn, taskAssignees } from "@/lib/utils";

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
}) {
  const { tasks } = useWorkspace();
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

  return (
    <div
      ref={draggable ? sortable.setNodeRef : undefined}
      style={{
        paddingLeft: 8 + depth * TREE_INDENT,
        // The dragged row itself stays put and only previews its landing
        // indent; the overlay is what follows the cursor. Other rows still
        // translate to open the gap.
        transform: draggable && !dragging ? CSS.Translate.toString(sortable.transform) : undefined,
        transition: draggable && !dragging ? sortable.transition : undefined,
      }}
      className={cn(
        "group flex items-center gap-1.5 rounded-md pr-2 transition-colors",
        selected ? "bg-accent/[0.07] ring-1 ring-inset ring-accent/25" : "hover:bg-surface-2",
        dragging && "bg-accent/[0.06] opacity-60 ring-1 ring-inset ring-accent/30"
      )}
    >
      {/* drag grip */}
      {draggable && (
        <button
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`Reorder ${node.title}`}
          title="Drag to reorder. Drag sideways to nest."
          className="grid h-5 w-4 shrink-0 cursor-grab touch-none place-items-center rounded text-text-faint opacity-0 transition-opacity hover:text-text focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}

      {/* caret */}
      <button
        onClick={onToggleCollapse}
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded text-text-faint transition-all hover:bg-surface-3 hover:text-text",
          !hasChildren && "invisible"
        )}
        tabIndex={-1}
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", !collapsed && "rotate-90")} />
      </button>

      <div className="py-1.5">
        <StatusControl status={node.status} onChange={(s) => actions.setStatus(node.id, s)} />
      </div>

      {/* title */}
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
          "min-w-0 flex-1 truncate bg-transparent py-1.5 text-[13.5px] outline-none",
          node.status === "done" ? "text-text-faint line-through" : "text-text"
        )}
      />

      {/* meta (compact, right-aligned) */}
      <div className="flex shrink-0 items-center gap-1.5">
        {node.tags.slice(0, 2).map((t) => (
          <TagChip key={t} tag={t} />
        ))}
        {total > 0 && <SubtaskProgress done={done} total={total} className="hidden md:inline-flex" />}
        {node.dueDate && <DueDateChip date={node.dueDate} time={node.dueTime} status={node.status} />}
        <PrioritySelect value={node.priority} onChange={(p) => actions.setPriority(node.id, p)} />
        <AssigneePicker
          value={taskAssignees(node)}
          onChange={(a) => actions.setAssignees(node.id, a)}
          size={20}
        />

        {/* hover actions */}
        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
          {onAddSubtask && (
            <button
              onClick={onAddSubtask}
              title="Add subtask"
              className="grid h-6 w-6 place-items-center rounded-md text-text-faint hover:bg-surface-3 hover:text-text"
            >
              <CornerDownRight className="h-3.5 w-3.5" />
            </button>
          )}
          <Dropdown
            align="right"
            width={168}
            trigger={() => (
              <span className="grid h-6 w-6 place-items-center rounded-md text-text-faint hover:bg-surface-3 hover:text-text">
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
                <div className="my-1 h-px bg-border" />
                <MenuItem
                  danger
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => {
                    actions.remove(node.id);
                    close();
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
            className="grid h-6 w-6 place-items-center rounded-md text-text-faint hover:bg-surface-3 hover:text-text"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function QuickAdd({
  depth = 0,
  placeholder = "Add task",
  onAdd,
  autoFocus,
  onCancel,
  inputRef,
  hint,
}: {
  depth?: number;
  placeholder?: string;
  onAdd: (title: string) => void;
  autoFocus?: boolean;
  onCancel?: () => void;
  /** Lets a parent focus this composer, e.g. from a keyboard shortcut. */
  inputRef?: React.RefObject<HTMLInputElement>;
  /** Key cap shown at rest, e.g. "N". Only pass one that is actually bound. */
  hint?: string;
}) {
  const [value, setValue] = useState("");
  // The live value is mirrored in a ref so `onBlur` never reads a stale render
  // closure. Enter used to submit and clear state, then the blur that followed
  // still saw the old value and submitted the same task a second time.
  const valueRef = useRef("");

  const update = (v: string) => {
    valueRef.current = v;
    setValue(v);
  };

  /** Submit once. Clearing the ref first makes a following blur a no-op. */
  const submit = () => {
    const title = valueRef.current.trim();
    if (!title) return;
    update("");
    onAdd(title);
  };

  return (
    <div className="flex items-center gap-1.5 rounded-md hover:bg-surface-2" style={{ paddingLeft: 8 + depth * 20 }}>
      <span className="grid h-5 w-5 place-items-center text-text-faint">
        <CornerDownRight className={cn("h-3.5 w-3.5", depth === 0 && "opacity-0")} />
      </span>
      <span className="grid h-4 w-4 place-items-center rounded-full border-[1.5px] border-dashed border-border-strong" />
      <input
        ref={inputRef}
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
            update("");
            onCancel?.();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          submit();
          onCancel?.();
        }}
        className="flex-1 bg-transparent py-1.5 text-[13.5px] text-text outline-none placeholder:text-text-faint"
      />
      {hint && !value && (
        <kbd className="mono mr-1 hidden shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-2xs text-text-faint sm:block">
          {hint}
        </kbd>
      )}
    </div>
  );
}
