"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import { Plus } from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { useTaskActions } from "@/lib/data/useTaskActions";
import { buildTree } from "@/lib/data/tree";
import { statusMeta } from "@/lib/constants";
import type { Task, TaskNode } from "@/lib/types";
import { PriorityDot } from "@/components/ui/PriorityIndicator";
import { Button } from "@/components/ui/Button";
import { Field, Modal, inputClass } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

/* Layout geometry — left-to-right layered tree. */
const NODE_W = 216;
const ROW_H = 60; // vertical slot per leaf
const COL_GAP = 96; // horizontal gap between depth columns

type MapNodeData = {
  kind: "project" | "task";
  label: string;
  color?: string;
  task?: Task;
  status?: Task["status"];
  priority?: Task["priority"];
  childCount?: number;
  onOpen?: (t: Task) => void;
  onAdd?: (parentId: string | null) => void;
};

/**
 * Assign an (x, y) to every node. x is the depth column; y is computed so each
 * parent sits at the vertical midpoint of its children (classic mind-map look).
 */
function layout(roots: TaskNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  let leafCursor = 0;

  const place = (node: TaskNode, depth: number): number => {
    const x = (depth + 1) * (NODE_W + COL_GAP);
    if (node.children.length === 0) {
      const y = leafCursor * ROW_H;
      leafCursor += 1;
      pos.set(node.id, { x, y });
      return y;
    }
    const ys = node.children.map((c) => place(c, depth + 1));
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    pos.set(node.id, { x, y });
    return y;
  };

  const rootYs = roots.map((r) => place(r, 0));
  // Project node sits at depth -1, centred against its top-level tasks.
  const projectY = rootYs.length ? (rootYs[0] + rootYs[rootYs.length - 1]) / 2 : 0;
  pos.set("__project__", { x: 0, y: projectY });
  return pos;
}

/** Custom node: the project root or a task card. */
function MapNode({ data }: NodeProps<MapNodeData>) {
  const isProject = data.kind === "project";
  const meta = data.status ? statusMeta(data.status) : null;
  return (
    <div className="group relative">
      {!isProject && <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-hairline/[0.08]-strong" />}
      <div
        onClick={() => data.task && data.onOpen?.(data.task)}
        className={cn(
          "flex items-center gap-2 rounded-xl border px-3 py-2.5 shadow-e1 transition-all",
          isProject
            ? "border-accent/40 bg-accent/10 text-text"
            : "cursor-pointer border-hairline/[0.08] bg-surface hover:border-hairline/20 hover:shadow-e3",
          data.status === "done" && "opacity-60"
        )}
        style={{ width: NODE_W }}
      >
        {isProject ? (
          <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: data.color }} />
        ) : (
          <>
            <span className={cn("h-2 w-2 shrink-0 rounded-full", meta?.dot)} />
            {data.priority && <PriorityDot priority={data.priority} />}
          </>
        )}
        <span
          className={cn(
            "flex-1 truncate text-sm",
            isProject ? "font-semibold" : "text-text",
            data.status === "done" && "line-through"
          )}
        >
          {data.label}
        </span>
        {isProject && data.childCount ? (
          <span className="mono text-2xs text-text-faint">{data.childCount}</span>
        ) : null}
      </div>

      {/* add-child affordance */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          data.onAdd?.(isProject ? null : data.task!.id);
        }}
        title={isProject ? "Add task" : "Add subtask"}
        className="absolute -right-2.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full border border-hairline/[0.08] bg-surface text-text-faint opacity-0 shadow-e1 transition-all hover:border-accent/40 hover:text-accent group-hover:opacity-100"
      >
        <Plus className="h-3 w-3" />
      </button>

      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-hairline/[0.08]-strong" />
    </div>
  );
}

const nodeTypes = { map: MapNode };

function MindMap({ onOpenTask }: { onOpenTask: (t: Task) => void }) {
  const { currentProject, tasks } = useWorkspace();
  const actions = useTaskActions();
  const [addingParent, setAddingParent] = useState<string | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const roots = useMemo(() => buildTree(tasks), [tasks]);

  // Rebuild the graph only when the structure/labels actually change, so
  // dragging a node isn't undone by unrelated re-renders.
  const signature = useMemo(
    () => tasks.map((t) => `${t.id}:${t.parentId}:${t.status}:${t.priority}:${t.title}`).join("|") + `#${currentProject?.name}`,
    [tasks, currentProject?.name]
  );

  const openTask = useCallback((t: Task) => onOpenTask(t), [onOpenTask]);
  const openAdd = useCallback((parentId: string | null) => {
    setAddingParent(parentId);
    setTitle("");
  }, []);

  const build = useCallback((): { nodes: Node<MapNodeData>[]; edges: Edge[] } => {
    if (!currentProject) return { nodes: [], edges: [] };
    const pos = layout(roots);
    const nodes: Node<MapNodeData>[] = [
      {
        id: "__project__",
        type: "map",
        position: pos.get("__project__") ?? { x: 0, y: 0 },
        data: {
          kind: "project",
          label: currentProject.name,
          color: currentProject.color,
          childCount: roots.length,
          onAdd: openAdd,
        },
        draggable: true,
      },
    ];
    const edges: Edge[] = [];
    const walk = (node: TaskNode) => {
      nodes.push({
        id: node.id,
        type: "map",
        position: pos.get(node.id) ?? { x: 0, y: 0 },
        data: {
          kind: "task",
          label: node.title,
          task: node,
          status: node.status,
          priority: node.priority,
          onOpen: openTask,
          onAdd: openAdd,
        },
        draggable: true,
      });
      edges.push({
        id: `${node.parentId ?? "__project__"}->${node.id}`,
        source: node.parentId ?? "__project__",
        target: node.id,
        type: "smoothstep",
        animated: node.status === "in_progress",
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "rgb(var(--border-strong))" },
        style: { stroke: "rgb(var(--border-strong))", strokeWidth: 1.5 },
      });
      node.children.forEach(walk);
    };
    roots.forEach(walk);
    return { nodes, edges };
  }, [currentProject, roots, openTask, openAdd]);

  const [nodes, setNodes, onNodesChange] = useNodesState<MapNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    const g = build();
    setNodes(g.nodes);
    setEdges(g.edges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const submitAdd = async () => {
    if (!title.trim() || addingParent === undefined) return;
    setBusy(true);
    try {
      await actions.add(title.trim(), { parentId: addingParent });
      setAddingParent(undefined);
      setTitle("");
    } finally {
      setBusy(false);
    }
  };

  if (!currentProject) return null;

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        className="mindmap"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(var(--border))" />
        <Controls showInteractive={false} className="!border-hairline/[0.08] !bg-surface !shadow-e1" />
      </ReactFlow>

      <Modal
        open={addingParent !== undefined}
        onClose={() => setAddingParent(undefined)}
        title={addingParent === null ? "Add task" : "Add subtask"}
      >
        <Field label="Title">
          <input
            className={inputClass}
            autoFocus
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitAdd()}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAddingParent(undefined)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submitAdd} disabled={!title.trim() || busy}>
            {busy ? "Adding…" : "Add"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function MindMapView({ onOpenTask }: { onOpenTask: (t: Task) => void }) {
  return (
    <ReactFlowProvider>
      <MindMap onOpenTask={onOpenTask} />
    </ReactFlowProvider>
  );
}
