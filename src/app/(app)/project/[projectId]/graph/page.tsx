"use client";

import { use, useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Search,
  ShieldCheck,
  FileText,
  Layers,
  Lightbulb,
  X,
  ExternalLink,
  Filter,
  Plus,
  Pencil,
  Trash2,
  Link2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getProjectDocuments } from "@/lib/firebase/firestore";
import { useProjectGraphStore } from "@/store/projectGraph";

const ease = [0.22, 0.61, 0.36, 1] as const;

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

type NodeType = "paper" | "topic" | "concept";

interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  // Paper-specific
  authors?: string[];
  doi?: string;
  journal?: string;
  year?: number;
  verified?: boolean;
  citationCount?: number;
  abstract?: string;
  // Simulation state
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pinned: boolean;
  // Animation
  spawnTime: number;
}

interface GraphEdge {
  source: string;
  target: string;
  strength: number; // 0-1
}

type FilterMode = "all" | "papers" | "topics" | "verified";

/* ═══════════════════════════════════════════════════════════════
   Color palette (matches CSS variables)
   ═══════════════════════════════════════════════════════════════ */

const COLORS = {
  paper: { light: "#06B6D4", dark: "#22D3EE" },
  topic: { light: "#F97316", dark: "#FB923C" },
  concept: { light: "#2563EB", dark: "#3B82F6" },
  verified: { light: "#10B981", dark: "#34D399" },
  edge: { light: "rgba(82,82,91,0.18)", dark: "rgba(161,161,170,0.15)" },
  bg: { light: "#F0EDE8", dark: "#09090B" },
  surface: { light: "#FFFFFF", dark: "#111113" },
  text: { light: "#0C0A14", dark: "#FAFAF9" },
  muted: { light: "#78716C", dark: "#52525B" },
  border: { light: "#D6D3CC", dark: "#1F1F23" },
};

function getNodeColor(type: NodeType, isDark: boolean): string {
  const mode = isDark ? "dark" : "light";
  return COLORS[type][mode];
}

/* ═══════════════════════════════════════════════════════════════
   Demo data
   ═══════════════════════════════════════════════════════════════ */

function generateDemoData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const now = Date.now();

  const papers: GraphNode[] = [
    {
      id: "p1", type: "paper", label: "Sleep Deprivation and Judicial Decision-Making",
      authors: ["Cho, K.", "Barnes, C.M.", "Guanara, C.L."],
      doi: "10.1073/pnas.1018033108", journal: "PNAS", year: 2011, verified: true,
      citationCount: 347, abstract: "Examines how sleep deprivation affects the cognitive performance and decision quality of judges in criminal sentencing.",
      x: 0, y: 0, vx: 0, vy: 0, radius: 22, pinned: false, spawnTime: now,
    },
    {
      id: "p2", type: "paper", label: "Cognitive Load and Legal Reasoning Under Fatigue",
      authors: ["Danziger, S.", "Levav, J.", "Avnaim-Pesso, L."],
      doi: "10.1073/pnas.1018033108", journal: "PNAS", year: 2011, verified: true,
      citationCount: 892, abstract: "Demonstrates that judicial rulings are influenced by extraneous factors relating to cognitive depletion and food breaks.",
      x: 0, y: 0, vx: 0, vy: 0, radius: 26, pinned: false, spawnTime: now + 80,
    },
    {
      id: "p3", type: "paper", label: "Neural Correlates of Decision Fatigue in Prefrontal Cortex",
      authors: ["Blain, B.", "Hollard, G.", "Pessiglione, M."],
      doi: "10.1016/j.cub.2016.07.054", journal: "Current Biology", year: 2016, verified: true,
      citationCount: 213, abstract: "fMRI study showing glutamate accumulation in lateral prefrontal cortex during prolonged cognitive work.",
      x: 0, y: 0, vx: 0, vy: 0, radius: 20, pinned: false, spawnTime: now + 160,
    },
    {
      id: "p4", type: "paper", label: "Sentencing Disparity and Cognitive Bias: A Meta-Analysis",
      authors: ["Rachlinski, J.J.", "Johnson, S.L.", "Wistrich, A.J."],
      doi: "10.2139/ssrn.2474228", journal: "Cornell Law Review", year: 2015, verified: true,
      citationCount: 178, abstract: "Meta-analysis of 14 studies examining how implicit cognitive biases lead to inconsistent sentencing outcomes.",
      x: 0, y: 0, vx: 0, vy: 0, radius: 20, pinned: false, spawnTime: now + 240,
    },
    {
      id: "p5", type: "paper", label: "The Role of Sleep in Emotional Regulation and Judgment",
      authors: ["Walker, M.P.", "van der Helm, E."],
      doi: "10.1146/annurev-clinpsy-032210-104550", journal: "Annual Review of Clinical Psychology", year: 2012, verified: true,
      citationCount: 534, abstract: "Reviews how sleep loss impairs the amygdala-prefrontal connectivity necessary for balanced emotional judgment.",
      x: 0, y: 0, vx: 0, vy: 0, radius: 24, pinned: false, spawnTime: now + 320,
    },
    {
      id: "p6", type: "paper", label: "Ego Depletion and Self-Control in Judicial Contexts",
      authors: ["Baumeister, R.F.", "Vohs, K.D."],
      doi: "10.1016/j.tics.2007.07.003", journal: "Trends in Cognitive Sciences", year: 2007, verified: false,
      citationCount: 1205, abstract: "Foundational paper on ego depletion theory, later debated in replication studies, applied to judicial self-control.",
      x: 0, y: 0, vx: 0, vy: 0, radius: 28, pinned: false, spawnTime: now + 400,
    },
    {
      id: "p7", type: "paper", label: "Circadian Rhythm Effects on Professional Performance",
      authors: ["Valdez, P.", "Ramírez, C.", "García, A."],
      doi: "10.1080/07420528.2019.1624372", journal: "Chronobiology International", year: 2019, verified: true,
      citationCount: 67, abstract: "Studies how time-of-day variations in circadian alertness affect complex professional performance metrics.",
      x: 0, y: 0, vx: 0, vy: 0, radius: 18, pinned: false, spawnTime: now + 480,
    },
    {
      id: "p8", type: "paper", label: "Anchoring Effects in Criminal Sentencing Decisions",
      authors: ["Englich, B.", "Mussweiler, T.", "Strack, F."],
      doi: "10.1037/0022-3514.90.5.734", journal: "J. Personality & Social Psychology", year: 2006, verified: true,
      citationCount: 423, abstract: "Experimental evidence that even experienced judges are susceptible to irrelevant anchoring information in sentencing.",
      x: 0, y: 0, vx: 0, vy: 0, radius: 22, pinned: false, spawnTime: now + 560,
    },
    {
      id: "p9", type: "paper", label: "Debiasing Judicial Decision-Making: Training Interventions",
      authors: ["Guthrie, C.", "Rachlinski, J.J.", "Wistrich, A.J."],
      doi: "10.2307/3185393", journal: "Cornell Law Review", year: 2007, verified: false,
      citationCount: 298, abstract: "Evaluates training programs designed to reduce cognitive biases in judicial decision-making processes.",
      x: 0, y: 0, vx: 0, vy: 0, radius: 20, pinned: false, spawnTime: now + 640,
    },
  ];

  const topics: GraphNode[] = [
    { id: "t1", type: "topic", label: "Sleep Deprivation", x: 0, y: 0, vx: 0, vy: 0, radius: 30, pinned: false, spawnTime: now + 100 },
    { id: "t2", type: "topic", label: "Judicial Cognition", x: 0, y: 0, vx: 0, vy: 0, radius: 28, pinned: false, spawnTime: now + 200 },
    { id: "t3", type: "topic", label: "Neuroscience", x: 0, y: 0, vx: 0, vy: 0, radius: 26, pinned: false, spawnTime: now + 300 },
    { id: "t4", type: "topic", label: "Decision Making", x: 0, y: 0, vx: 0, vy: 0, radius: 28, pinned: false, spawnTime: now + 400 },
    { id: "t5", type: "topic", label: "Cognitive Psychology", x: 0, y: 0, vx: 0, vy: 0, radius: 24, pinned: false, spawnTime: now + 500 },
  ];

  const concepts: GraphNode[] = [
    { id: "c1", type: "concept", label: "Cognitive Load", x: 0, y: 0, vx: 0, vy: 0, radius: 20, pinned: false, spawnTime: now + 250 },
    { id: "c2", type: "concept", label: "Fatigue Effects", x: 0, y: 0, vx: 0, vy: 0, radius: 18, pinned: false, spawnTime: now + 350 },
    { id: "c3", type: "concept", label: "Sentencing Bias", x: 0, y: 0, vx: 0, vy: 0, radius: 20, pinned: false, spawnTime: now + 450 },
    { id: "c4", type: "concept", label: "Prefrontal Function", x: 0, y: 0, vx: 0, vy: 0, radius: 16, pinned: false, spawnTime: now + 550 },
  ];

  const nodes = [...papers, ...topics, ...concepts];

  const edges: GraphEdge[] = [
    // Papers to topics
    { source: "p1", target: "t1", strength: 0.9 },
    { source: "p1", target: "t2", strength: 0.85 },
    { source: "p2", target: "t2", strength: 0.95 },
    { source: "p2", target: "t4", strength: 0.7 },
    { source: "p3", target: "t3", strength: 0.9 },
    { source: "p3", target: "t4", strength: 0.6 },
    { source: "p4", target: "t2", strength: 0.8 },
    { source: "p4", target: "t5", strength: 0.65 },
    { source: "p5", target: "t1", strength: 0.85 },
    { source: "p5", target: "t3", strength: 0.7 },
    { source: "p6", target: "t4", strength: 0.75 },
    { source: "p6", target: "t5", strength: 0.8 },
    { source: "p7", target: "t1", strength: 0.6 },
    { source: "p7", target: "t3", strength: 0.5 },
    { source: "p8", target: "t2", strength: 0.85 },
    { source: "p8", target: "t4", strength: 0.7 },
    { source: "p9", target: "t2", strength: 0.8 },
    { source: "p9", target: "t5", strength: 0.75 },
    // Papers to concepts
    { source: "p2", target: "c1", strength: 0.9 },
    { source: "p3", target: "c4", strength: 0.85 },
    { source: "p1", target: "c2", strength: 0.8 },
    { source: "p4", target: "c3", strength: 0.9 },
    { source: "p5", target: "c2", strength: 0.75 },
    { source: "p6", target: "c1", strength: 0.7 },
    { source: "p8", target: "c3", strength: 0.85 },
    { source: "p9", target: "c3", strength: 0.7 },
    // Topics to concepts
    { source: "t1", target: "c2", strength: 0.8 },
    { source: "t2", target: "c3", strength: 0.85 },
    { source: "t3", target: "c4", strength: 0.75 },
    { source: "t4", target: "c1", strength: 0.8 },
    { source: "t5", target: "c1", strength: 0.7 },
    // Cross-paper links (citation network)
    { source: "p1", target: "p2", strength: 0.6 },
    { source: "p1", target: "p5", strength: 0.55 },
    { source: "p2", target: "p6", strength: 0.5 },
    { source: "p3", target: "p5", strength: 0.45 },
    { source: "p4", target: "p8", strength: 0.65 },
    { source: "p4", target: "p9", strength: 0.7 },
    { source: "p8", target: "p9", strength: 0.5 },
  ];

  return { nodes, edges };
}

/* ═══════════════════════════════════════════════════════════════
   Force simulation helpers
   ═══════════════════════════════════════════════════════════════ */

function initializePositions(nodes: GraphNode[], w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const spread = Math.min(w, h) * 0.35;
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 + Math.random() * 0.5;
    const r = spread * (0.4 + Math.random() * 0.6);
    n.x = cx + Math.cos(angle) * r;
    n.y = cy + Math.sin(angle) * r;
    n.vx = 0;
    n.vy = 0;
  });
}

function simulationStep(
  nodes: GraphNode[],
  edges: GraphEdge[],
  w: number,
  h: number,
  alpha: number,
) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Repulsion between all node pairs (Coulomb)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const minDist = (a.radius + b.radius) * 2.5;
      const repulse = (300 * alpha) / (dist * dist + 50);
      const fx = (dx / dist) * repulse;
      const fy = (dy / dist) * repulse;

      if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
      if (!b.pinned) { b.vx += fx; b.vy += fy; }

      // Hard overlap prevention
      if (dist < minDist) {
        const overlap = (minDist - dist) * 0.5;
        const ox = (dx / dist) * overlap;
        const oy = (dy / dist) * overlap;
        if (!a.pinned) { a.x -= ox; a.y -= oy; }
        if (!b.pinned) { b.x += ox; b.y += oy; }
      }
    }
  }

  // Spring attraction along edges (Hooke)
  for (const e of edges) {
    const a = nodeMap.get(e.source);
    const b = nodeMap.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const idealLen = 140 + (1 - e.strength) * 80;
    const force = (dist - idealLen) * 0.005 * alpha * e.strength;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!a.pinned) { a.vx += fx; a.vy += fy; }
    if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
  }

  // Center gravity
  const cx = w / 2;
  const cy = h / 2;
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx += (cx - n.x) * 0.0008 * alpha;
    n.vy += (cy - n.y) * 0.0008 * alpha;
  }

  // Velocity integration + damping
  const damping = 0.85;
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx *= damping;
    n.vy *= damping;
    n.x += n.vx;
    n.y += n.vy;
    // Boundary containment
    const pad = n.radius + 10;
    n.x = Math.max(pad, Math.min(w - pad, n.x));
    n.y = Math.max(pad, Math.min(h - pad, n.y));
  }
}

/* ═══════════════════════════════════════════════════════════════
   Canvas drawing
   ═══════════════════════════════════════════════════════════════ */

function drawGraph(
  ctx: CanvasRenderingContext2D,
  nodes: GraphNode[],
  edges: GraphEdge[],
  w: number,
  h: number,
  isDark: boolean,
  hoveredId: string | null,
  selectedId: string | null,
  camera: { x: number; y: number; zoom: number },
  now: number,
) {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Apply camera transform
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Draw edges
  for (const e of edges) {
    const a = nodeMap.get(e.source);
    const b = nodeMap.get(e.target);
    if (!a || !b) continue;

    const alphaA = Math.min(1, Math.max(0, (now - a.spawnTime) / 600));
    const alphaB = Math.min(1, Math.max(0, (now - b.spawnTime) / 600));
    const spawnAlpha = Math.min(alphaA, alphaB);
    if (spawnAlpha <= 0) continue;

    const isHighlighted = hoveredId === e.source || hoveredId === e.target ||
      selectedId === e.source || selectedId === e.target;

    const baseAlpha = e.strength * 0.4 * spawnAlpha;
    const alpha = isHighlighted ? Math.min(1, baseAlpha * 3) : baseAlpha;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = isDark
      ? `rgba(161,161,170,${alpha})`
      : `rgba(82,82,91,${alpha})`;
    ctx.lineWidth = isHighlighted ? 2 : 1;
    ctx.stroke();
  }

  // Draw nodes
  for (const n of nodes) {
    const spawnProgress = Math.min(1, Math.max(0, (now - n.spawnTime) / 500));
    if (spawnProgress <= 0) continue;

    const scale = easeOutBack(spawnProgress);
    const r = n.radius * scale;
    const color = getNodeColor(n.type, isDark);
    const isHovered = hoveredId === n.id;
    const isSelected = selectedId === n.id;

    // Glow for hovered/selected
    if (isHovered || isSelected) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 8, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r + 8);
      grad.addColorStop(0, color + "40");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isDark
      ? color + "20"
      : color + "15";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = isHovered || isSelected ? 2.5 : 1.5;
    ctx.stroke();

    // Inner dot
    ctx.beginPath();
    ctx.arc(n.x, n.y, 3 * scale, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Verified badge
    if (n.type === "paper" && n.verified) {
      const badgeX = n.x + r * 0.65;
      const badgeY = n.y - r * 0.65;
      const badgeR = 6 * scale;
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? COLORS.verified.dark : COLORS.verified.light;
      ctx.fill();
      // Checkmark
      ctx.beginPath();
      ctx.moveTo(badgeX - 3 * scale, badgeY);
      ctx.lineTo(badgeX - 1 * scale, badgeY + 2.5 * scale);
      ctx.lineTo(badgeX + 3 * scale, badgeY - 2 * scale);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Label
    const fontSize = n.type === "topic" ? 11 : n.type === "concept" ? 10 : 9;
    ctx.font = `500 ${fontSize}px 'DM Sans', system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = isDark ? "#E0E1EC" : "#0C0A14";
    ctx.globalAlpha = spawnProgress;

    // Truncate long labels
    let label = n.label;
    if (label.length > 28) label = label.slice(0, 26) + "...";
    ctx.fillText(label, n.x, n.y + r + 6);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/* ═══════════════════════════════════════════════════════════════
   Hit testing
   ═══════════════════════════════════════════════════════════════ */

function hitTest(
  nodes: GraphNode[],
  mx: number,
  my: number,
  camera: { x: number; y: number; zoom: number },
): GraphNode | null {
  // Transform mouse coords to world coords
  const wx = (mx - camera.x) / camera.zoom;
  const wy = (my - camera.y) / camera.zoom;

  // Iterate in reverse (top nodes first)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const dx = n.x - wx;
    const dy = n.y - wy;
    if (dx * dx + dy * dy <= (n.radius + 6) * (n.radius + 6)) {
      return n;
    }
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   Detail Panel component
   ═══════════════════════════════════════════════════════════════ */

function DetailPanel({
  node,
  onClose,
}: {
  node: GraphNode;
  onClose: () => void;
}) {
  const color = node.type === "paper" ? "cyan" : node.type === "topic" ? "warm" : "violet";
  const typeLabel = node.type === "paper" ? "Paper" : node.type === "topic" ? "Topic Cluster" : "Concept";

  return (
    <motion.div
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ duration: 0.35, ease }}
      className="absolute top-0 right-0 bottom-0 w-[380px] max-w-[90vw] bg-surface border-l border-border z-30 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 bg-${color}`} />
          <span className="text-xs font-display font-semibold tracking-wide uppercase text-muted">
            {typeLabel}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-muted hover:text-black transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <h2 className="font-display font-bold text-lg text-black leading-snug">
          {node.label}
        </h2>

        {node.type === "paper" && (
          <>
            {node.authors && (
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Authors</p>
                <p className="text-sm text-black">{node.authors.join(", ")}</p>
              </div>
            )}

            <div className="flex gap-4">
              {node.journal && (
                <div className="flex-1">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Journal</p>
                  <p className="text-sm text-black">{node.journal}</p>
                </div>
              )}
              {node.year && (
                <div>
                  <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Year</p>
                  <p className="text-sm text-black">{node.year}</p>
                </div>
              )}
            </div>

            {node.doi && (
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">DOI</p>
                <a
                  href={`https://doi.org/${node.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-violet flex items-center gap-1 hover:underline"
                >
                  {node.doi}
                  <ExternalLink size={12} />
                </a>
              </div>
            )}

            <div className="flex items-center gap-3">
              {node.verified && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green">
                  <ShieldCheck size={14} />
                  DOI Verified
                </span>
              )}
              {node.citationCount !== undefined && (
                <span className="text-xs text-muted">
                  {node.citationCount.toLocaleString()} citations
                </span>
              )}
            </div>

            {node.abstract && (
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Abstract</p>
                <p className="text-sm text-gray leading-relaxed">{node.abstract}</p>
              </div>
            )}
          </>
        )}

        {node.type === "topic" && (
          <p className="text-sm text-gray leading-relaxed">
            Topic cluster extracted from research queries. Papers connected to this
            node share this thematic focus area.
          </p>
        )}

        {node.type === "concept" && (
          <p className="text-sm text-gray leading-relaxed">
            Concept node representing a key idea that bridges multiple papers and
            topic clusters in the knowledge graph.
          </p>
        )}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main page component
   ═══════════════════════════════════════════════════════════════ */

export default function KnowledgeGraphPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const animFrameRef = useRef<number>(0);
  const alphaRef = useRef(1);
  const draggingRef = useRef<{ node: GraphNode; offsetX: number; offsetY: number } | null>(null);
  const panningRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

  const [filter, setFilter] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const [isDark, setIsDark] = useState(false);
  const [dataSource, setDataSource] = useState<"demo" | "live">("demo");
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  // Subscribe to project graph store
  const projectGraph = useProjectGraphStore((s) => s.graphs[projectId]);
  const addStoredNode = useProjectGraphStore((s) => s.addNode);
  const updateStoredNode = useProjectGraphStore((s) => s.updateNode);
  const deleteStoredNode = useProjectGraphStore((s) => s.deleteNode);
  const addStoredEdge = useProjectGraphStore((s) => s.addEdge);

  // Detect dark mode
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Sync from project graph store → simulation refs.
  // Keeps existing node positions & velocities for nodes that still exist.
  useEffect(() => {
    const storedNodes = projectGraph?.nodes ?? [];
    const storedEdges = projectGraph?.edges ?? [];

    if (storedNodes.length === 0) {
      // No real graph yet — fall back to demo
      const { nodes, edges } = generateDemoData();
      initializePositions(nodes, canvasSize.w || 800, canvasSize.h || 600);
      nodesRef.current = nodes;
      edgesRef.current = edges;
      alphaRef.current = 1;
      setDataSource("demo");

      // Merge Firestore documents as paper nodes (legacy behavior)
      getProjectDocuments(projectId)
        .then((docs) => {
          if (docs && docs.length > 0) {
            docs.forEach((d, i) => {
              const exists = nodesRef.current.find(
                (n) => n.type === "paper" && n.label === d.title,
              );
              if (!exists) {
                nodesRef.current.push({
                  id: `fs-${d.id}`,
                  type: "paper",
                  label: d.title || "Untitled Document",
                  citationCount: d.citationCount,
                  verified: d.verifiedCount > 0,
                  x: 0, y: 0, vx: 0, vy: 0,
                  radius: 20,
                  pinned: false,
                  spawnTime: Date.now() + 700 + i * 100,
                });
              }
            });
            alphaRef.current = Math.max(alphaRef.current, 0.6);
          }
        })
        .catch(() => {});
      return;
    }

    // Build live nodes from store, preserving existing simulation state
    setDataSource("live");
    const prevMap = new Map(nodesRef.current.map((n) => [n.id, n]));
    const now = Date.now();
    const nextNodes: GraphNode[] = storedNodes.map((sn) => {
      const prev = prevMap.get(sn.id);
      const radius =
        sn.type === "topic" ? 28 : sn.type === "concept" ? 20 : 22;
      if (prev) {
        return {
          ...prev,
          type: sn.type,
          label: sn.label,
          authors: sn.authors,
          doi: sn.doi,
          journal: sn.journal,
          year: sn.year,
          verified: sn.verified,
          citationCount: sn.citationCount,
          abstract: sn.abstract,
          radius,
        };
      }
      return {
        id: sn.id,
        type: sn.type,
        label: sn.label,
        authors: sn.authors,
        doi: sn.doi,
        journal: sn.journal,
        year: sn.year,
        verified: sn.verified,
        citationCount: sn.citationCount,
        abstract: sn.abstract,
        x: 0, y: 0, vx: 0, vy: 0,
        radius,
        pinned: false,
        spawnTime: now,
      };
    });

    // Seed fresh positions for new nodes only
    const unseeded = nextNodes.filter((n) => !prevMap.has(n.id));
    if (unseeded.length > 0) {
      const w = canvasSize.w || 800;
      const h = canvasSize.h || 600;
      unseeded.forEach((n, i) => {
        const angle = (i / Math.max(1, unseeded.length)) * Math.PI * 2;
        const r = Math.min(w, h) * 0.3 * (0.5 + Math.random() * 0.5);
        n.x = w / 2 + Math.cos(angle) * r;
        n.y = h / 2 + Math.sin(angle) * r;
      });
    }

    nodesRef.current = nextNodes;
    edgesRef.current = storedEdges.map((e) => ({
      source: e.source,
      target: e.target,
      strength: e.strength,
    }));
    alphaRef.current = Math.max(alphaRef.current, 0.6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectGraph, projectId]);

  // Resize handler
  useEffect(() => {
    const onResize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setCanvasSize({ w: rect.width, h: rect.height });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Update canvas dimensions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    canvas.style.width = `${canvasSize.w}px`;
    canvas.style.height = `${canvasSize.h}px`;
  }, [canvasSize]);

  // Get visible nodes based on filter/search
  const getVisibleNodes = useCallback(() => {
    let nodes = nodesRef.current;
    if (filter === "papers") nodes = nodes.filter((n) => n.type === "paper");
    else if (filter === "topics") nodes = nodes.filter((n) => n.type === "topic");
    else if (filter === "verified") nodes = nodes.filter((n) => n.type === "paper" && n.verified);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      nodes = nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.authors?.some((a) => a.toLowerCase().includes(q)) ||
          n.journal?.toLowerCase().includes(q),
      );
    }
    return nodes;
  }, [filter, searchQuery]);

  // Get visible edges
  const getVisibleEdges = useCallback(
    (visibleIds: Set<string>) => {
      return edgesRef.current.filter(
        (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
      );
    },
    [],
  );

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    const loop = () => {
      if (!running) return;

      const visibleNodes = getVisibleNodes();
      const visibleIds = new Set(visibleNodes.map((n) => n.id));
      const visibleEdges = getVisibleEdges(visibleIds);

      // Run simulation
      if (alphaRef.current > 0.001) {
        simulationStep(visibleNodes, visibleEdges, canvasSize.w, canvasSize.h, alphaRef.current);
        alphaRef.current *= 0.997;
      }

      drawGraph(
        ctx,
        visibleNodes,
        visibleEdges,
        canvasSize.w,
        canvasSize.h,
        isDark,
        hoveredId,
        selectedNode?.id ?? null,
        cameraRef.current,
        Date.now(),
      );

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [canvasSize, isDark, hoveredId, selectedNode, getVisibleNodes, getVisibleEdges]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const visibleNodes = getVisibleNodes();
      const hit = hitTest(visibleNodes, mx, my, cameraRef.current);

      if (hit) {
        draggingRef.current = {
          node: hit,
          offsetX: (mx - cameraRef.current.x) / cameraRef.current.zoom - hit.x,
          offsetY: (my - cameraRef.current.y) / cameraRef.current.zoom - hit.y,
        };
        hit.pinned = true;
      } else {
        panningRef.current = {
          startX: mx,
          startY: my,
          camX: cameraRef.current.x,
          camY: cameraRef.current.y,
        };
      }
    },
    [getVisibleNodes],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (draggingRef.current) {
        const { node, offsetX, offsetY } = draggingRef.current;
        node.x = (mx - cameraRef.current.x) / cameraRef.current.zoom - offsetX;
        node.y = (my - cameraRef.current.y) / cameraRef.current.zoom - offsetY;
        alphaRef.current = Math.max(alphaRef.current, 0.3);
        return;
      }

      if (panningRef.current) {
        const { startX, startY, camX, camY } = panningRef.current;
        cameraRef.current.x = camX + (mx - startX);
        cameraRef.current.y = camY + (my - startY);
        return;
      }

      // Hover detection
      const visibleNodes = getVisibleNodes();
      const hit = hitTest(visibleNodes, mx, my, cameraRef.current);
      setHoveredId(hit?.id ?? null);

      if (canvasRef.current) {
        canvasRef.current.style.cursor = hit ? "pointer" : "grab";
      }
    },
    [getVisibleNodes],
  );

  const handleMouseUp = useCallback(() => {
    if (draggingRef.current) {
      draggingRef.current.node.pinned = false;
      draggingRef.current = null;
    }
    panningRef.current = null;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const visibleNodes = getVisibleNodes();
      const hit = hitTest(visibleNodes, mx, my, cameraRef.current);

      // Link-creation mode: second click creates edge
      if (linkSourceId && hit && hit.id !== linkSourceId) {
        addStoredEdge(projectId, linkSourceId, hit.id, 0.7);
        setLinkSourceId(null);
        return;
      }
      if (linkSourceId && !hit) {
        setLinkSourceId(null);
        return;
      }

      setSelectedNode(hit);
      setContextMenu(null);
    },
    [getVisibleNodes, linkSourceId, addStoredEdge, projectId],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = hitTest(getVisibleNodes(), mx, my, cameraRef.current);
      if (hit) {
        setContextMenu({ x: mx, y: my, nodeId: hit.id });
      } else {
        setContextMenu(null);
      }
    },
    [getVisibleNodes],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = hitTest(getVisibleNodes(), mx, my, cameraRef.current);
      if (hit) {
        setEditingNodeId(hit.id);
        setEditingLabel(hit.label);
      }
    },
    [getVisibleNodes],
  );

  const commitEditLabel = useCallback(() => {
    if (editingNodeId && editingLabel.trim()) {
      const hasStored = projectGraph?.nodes.some((n) => n.id === editingNodeId);
      if (hasStored) {
        updateStoredNode(projectId, editingNodeId, { label: editingLabel.trim() });
      } else {
        // Demo-only node — update in-place
        const n = nodesRef.current.find((x) => x.id === editingNodeId);
        if (n) n.label = editingLabel.trim();
        rerender();
      }
    }
    setEditingNodeId(null);
    setEditingLabel("");
  }, [editingNodeId, editingLabel, projectGraph, updateStoredNode, projectId, rerender]);

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const hasStored = projectGraph?.nodes.some((n) => n.id === nodeId);
      if (hasStored) {
        deleteStoredNode(projectId, nodeId);
      } else {
        nodesRef.current = nodesRef.current.filter((n) => n.id !== nodeId);
        edgesRef.current = edgesRef.current.filter(
          (e) => e.source !== nodeId && e.target !== nodeId,
        );
        rerender();
      }
      setContextMenu(null);
      if (selectedNode?.id === nodeId) setSelectedNode(null);
    },
    [projectGraph, deleteStoredNode, projectId, rerender, selectedNode],
  );

  const handleAddNode = useCallback(
    (type: NodeType, label: string) => {
      if (!label.trim()) return;
      addStoredNode(projectId, { type, label: label.trim() });
      setAddMenuOpen(false);
      alphaRef.current = 0.8;
    },
    [addStoredNode, projectId],
  );

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cam = cameraRef.current;
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    const newZoom = Math.max(0.2, Math.min(4, cam.zoom * factor));

    // Zoom toward cursor
    cam.x = mx - ((mx - cam.x) / cam.zoom) * newZoom;
    cam.y = my - ((my - cam.y) / cam.zoom) * newZoom;
    cam.zoom = newZoom;
  }, []);

  // Reheat simulation when filter changes
  useEffect(() => {
    alphaRef.current = 0.8;
  }, [filter, searchQuery]);

  const filterButtons: { key: FilterMode; label: string; icon: typeof FileText }[] = [
    { key: "all", label: "All", icon: Layers },
    { key: "papers", label: "Papers", icon: FileText },
    { key: "topics", label: "Topics", icon: Filter },
    { key: "verified", label: "Verified", icon: ShieldCheck },
  ];

  const nodeStats = {
    papers: nodesRef.current.filter((n) => n.type === "paper").length,
    topics: nodesRef.current.filter((n) => n.type === "topic").length,
    concepts: nodesRef.current.filter((n) => n.type === "concept").length,
  };

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Top bar ── */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease }}
        className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface z-20"
      >
        <div className="flex items-center gap-4">
          <Link
            href={`/project/${projectId}`}
            className="flex items-center gap-1.5 text-muted hover:text-black transition-colors text-sm"
          >
            <ArrowLeft size={16} />
            Back
          </Link>
          <div className="w-px h-5 bg-border" />
          <h1 className="font-display font-bold text-base text-black tracking-tight">
            Knowledge Map
          </h1>
          {dataSource === "live" && (
            <span className="text-[10px] font-semibold text-green bg-green/10 px-2 py-0.5 uppercase tracking-wider">
              Live
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search nodes..."
              className="h-8 pl-8 pr-3 w-48 text-xs bg-background border border-border text-black placeholder:text-muted focus:outline-none focus:border-violet transition-colors"
            />
          </div>

          {/* Filter buttons */}
          <div className="flex items-center border border-border divide-x divide-border">
            {filterButtons.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === key
                    ? "bg-black text-white"
                    : "bg-surface text-muted hover:text-black"
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Canvas area ── */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
          className={`absolute inset-0 ${linkSourceId ? "cursor-crosshair" : "cursor-grab"}`}
        />

        {/* ── Link mode banner ── */}
        {linkSourceId && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-violet text-white text-[11px] font-semibold px-4 py-2 shadow-lg">
            <Link2 size={12} />
            Click a node to link — or anywhere to cancel
            <button
              onClick={() => setLinkSourceId(null)}
              className="ml-2 opacity-60 hover:opacity-100"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {/* ── Add-node FAB + menu ── */}
        <div className="absolute top-4 right-4 z-30">
          <button
            onClick={() => setAddMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 bg-violet text-white text-xs font-semibold px-3 py-2 shadow-lg hover:bg-violet/90 transition-colors"
          >
            <Plus size={13} />
            Add Node
          </button>
          <AnimatePresence>
            {addMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 mt-2 w-72 bg-surface border border-border shadow-xl p-3"
              >
                <AddNodeForm onSubmit={handleAddNode} onCancel={() => setAddMenuOpen(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Node label editor ── */}
        <AnimatePresence>
          {editingNodeId &&
            (() => {
              const node = nodesRef.current.find((n) => n.id === editingNodeId);
              if (!node) return null;
              const cam = cameraRef.current;
              const sx = node.x * cam.zoom + cam.x;
              const sy = node.y * cam.zoom + cam.y + node.radius * cam.zoom + 8;
              return (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.12 }}
                  className="absolute z-40"
                  style={{ left: sx, top: sy, transform: "translateX(-50%)" }}
                >
                  <input
                    autoFocus
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    onBlur={commitEditLabel}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEditLabel();
                      if (e.key === "Escape") {
                        setEditingNodeId(null);
                        setEditingLabel("");
                      }
                    }}
                    className="px-2.5 py-1.5 text-xs bg-surface border border-violet text-black dark:text-foreground shadow-lg w-64 focus:outline-none focus:ring-2 focus:ring-violet/30"
                  />
                </motion.div>
              );
            })()}
        </AnimatePresence>

        {/* ── Right-click context menu ── */}
        <AnimatePresence>
          {contextMenu && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.12 }}
              className="absolute z-40 bg-surface border border-border shadow-xl min-w-[150px] py-1"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                onClick={() => {
                  const n = nodesRef.current.find((x) => x.id === contextMenu.nodeId);
                  if (n) {
                    setEditingNodeId(n.id);
                    setEditingLabel(n.label);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-black dark:text-foreground hover:bg-violet/10 transition-colors text-left"
              >
                <Pencil size={11} /> Edit label
              </button>
              <button
                onClick={() => {
                  setLinkSourceId(contextMenu.nodeId);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-black dark:text-foreground hover:bg-cyan/10 transition-colors text-left"
              >
                <Link2 size={11} /> Link to…
              </button>
              <div className="h-px bg-border my-0.5" />
              <button
                onClick={() => handleDeleteNode(contextMenu.nodeId)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose hover:bg-rose/10 transition-colors text-left"
              >
                <Trash2 size={11} /> Delete node
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedNode && (
            <DetailPanel
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
            />
          )}
        </AnimatePresence>

        {/* ── Bottom legend ── */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, ease, delay: 0.2 }}
          className="absolute bottom-4 left-4 flex items-center gap-5 bg-surface/90 backdrop-blur-sm border border-border px-4 py-2.5 z-10"
        >
          <LegendItem color="cyan" label={`Papers (${nodeStats.papers})`} />
          <LegendItem color="warm" label={`Topics (${nodeStats.topics})`} />
          <LegendItem color="violet" label={`Concepts (${nodeStats.concepts})`} />
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 bg-green" />
            <span className="text-[10px] text-muted font-medium">DOI Verified</span>
          </div>
        </motion.div>

        {/* ── Zoom controls ── */}
        <motion.div
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.4, ease, delay: 0.3 }}
          className="absolute bottom-4 right-4 flex flex-col border border-border bg-surface/90 backdrop-blur-sm z-10"
        >
          <button
            onClick={() => {
              const cam = cameraRef.current;
              const cx = canvasSize.w / 2;
              const cy = canvasSize.h / 2;
              const newZoom = Math.min(4, cam.zoom * 1.25);
              cam.x = cx - ((cx - cam.x) / cam.zoom) * newZoom;
              cam.y = cy - ((cy - cam.y) / cam.zoom) * newZoom;
              cam.zoom = newZoom;
            }}
            className="px-3 py-2 text-sm text-muted hover:text-black transition-colors border-b border-border"
          >
            +
          </button>
          <button
            onClick={() => {
              const cam = cameraRef.current;
              const cx = canvasSize.w / 2;
              const cy = canvasSize.h / 2;
              const newZoom = Math.max(0.2, cam.zoom / 1.25);
              cam.x = cx - ((cx - cam.x) / cam.zoom) * newZoom;
              cam.y = cy - ((cy - cam.y) / cam.zoom) * newZoom;
              cam.zoom = newZoom;
            }}
            className="px-3 py-2 text-sm text-muted hover:text-black transition-colors border-b border-border"
          >
            -
          </button>
          <button
            onClick={() => {
              cameraRef.current = { x: 0, y: 0, zoom: 1 };
              alphaRef.current = 0.5;
              initializePositions(getVisibleNodes(), canvasSize.w, canvasSize.h);
            }}
            className="px-3 py-2 text-[10px] font-semibold text-muted hover:text-black transition-colors uppercase tracking-wider"
          >
            Fit
          </button>
        </motion.div>

        {/* ── Empty state hint ── */}
        {nodesRef.current.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-2">
              <Lightbulb size={32} className="mx-auto text-muted" />
              <p className="font-display font-semibold text-black text-sm">No knowledge nodes yet</p>
              <p className="text-xs text-muted">Run research queries to build your knowledge map</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Legend item
   ═══════════════════════════════════════════════════════════════ */

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2.5 h-2.5 border-2 border-${color} bg-${color}/20`} />
      <span className="text-[10px] text-muted font-medium">{label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Add-node form
   ═══════════════════════════════════════════════════════════════ */

function AddNodeForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (type: NodeType, label: string) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<NodeType>("topic");
  const [label, setLabel] = useState("");

  const typeConfig: { key: NodeType; label: string; color: string }[] = [
    { key: "topic", label: "Topic", color: "warm" },
    { key: "paper", label: "Paper", color: "cyan" },
    { key: "concept", label: "Concept", color: "violet" },
  ];

  return (
    <div>
      <p className="text-[9px] text-muted uppercase tracking-widest font-semibold mb-2">
        New node
      </p>
      <div className="flex gap-1 mb-2">
        {typeConfig.map((t) => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            className={`flex-1 text-[10px] font-semibold px-2 py-1.5 transition-colors ${
              type === t.key
                ? `bg-${t.color}/15 text-${t.color} border border-${t.color}/40`
                : "bg-background text-muted border border-border hover:text-black dark:hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && label.trim()) onSubmit(type, label);
          if (e.key === "Escape") onCancel();
        }}
        placeholder={`${type === "paper" ? "Paper title" : type === "topic" ? "Topic cluster" : "Concept"}…`}
        className="w-full px-2.5 py-1.5 text-xs bg-background border border-border text-black dark:text-foreground focus:outline-none focus:border-violet transition-colors"
      />
      <div className="flex justify-end gap-1.5 mt-2">
        <button
          onClick={onCancel}
          className="text-[10px] text-muted hover:text-black dark:hover:text-foreground px-2 py-1"
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit(type, label)}
          disabled={!label.trim()}
          className="text-[10px] font-semibold bg-violet text-white px-3 py-1 hover:bg-violet/90 transition-colors disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </div>
  );
}
