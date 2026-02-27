/**
 * "How to read visualization" — interactive step-through animation.
 * Extracted from playground.ts for modularity.
 */

import * as d3 from 'd3';

/** Colors for each layer (must match playground constants). */
const LAYER_COLORS = [
  '#f59322', // orange
  '#0877bd', // blue
];

const NODE_R = 14;

const TOTAL_STEPS = 6;

const DESCRIPTIONS = [
  "Layer 1 has its own set of nodes and edges (a traditional network graph).",
  "Layer 2 has a different set of nodes and edges, some nodes overlap with Layer 1.",
  "Match overlapping nodes across layers.",
  "Take the union of all nodes from both layers and arrange them on a single axis.",
  "Embed Layer 1 edges as arcs above the node axis (orange).",
  "Embed Layer 2 edges as arcs below the node axis (blue). Voilà!",
];

// Example data — two layers with partially overlapping nodes
const layer1Nodes = [0, 1, 2, 3];
const layer2Nodes = [1, 2, 3, 4];
const unionNodes  = [0, 1, 2, 3, 4];
const layer1Edges: [number, number][] = [[0,1],[0,2],[1,3],[2,3]];
const layer2Edges: [number, number][] = [[1,2],[2,4],[3,4],[1,4]];

const L1_COLOR = LAYER_COLORS[0];
const L2_COLOR = LAYER_COLORS[1];

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function circleLayout(nodes: number[], cx: number, cy: number, r: number) {
  let pos: { [id: number]: { x: number; y: number } } = {};
  let n = nodes.length;
  nodes.forEach((id, i) => {
    let angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    pos[id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return pos;
}

function drawGraph(g: any, nodes: number[], edges: [number, number][],
    pos: { [id: number]: { x: number; y: number } },
    color: string, label: string, labelX: number, labelY: number) {
  edges.forEach(([a, b]) => {
    g.append("line")
      .attr("class", "viz-edge")
      .attr("x1", pos[a].x).attr("y1", pos[a].y)
      .attr("x2", pos[b].x).attr("y2", pos[b].y)
      .style("stroke", color)
      .style("stroke-width", 2)
      .style("stroke-opacity", 0.5);
  });
  nodes.forEach(id => {
    let p = pos[id];
    g.append("circle")
      .attr("class", "viz-node")
      .attr("cx", p.x).attr("cy", p.y).attr("r", NODE_R)
      .style("fill", color).style("fill-opacity", 0.18)
      .style("stroke", color).style("stroke-width", 2);
    g.append("text")
      .attr("x", p.x).attr("y", p.y)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .style("font-size", "11px").style("fill", "#333").style("font-weight", "500")
      .text(id);
  });
  g.append("text")
    .attr("class", "viz-label")
    .attr("x", labelX).attr("y", labelY)
    .attr("text-anchor", "middle")
    .style("fill", color)
    .text(label);
}

function unionLayout(nodes: number[], y: number, svgW: number) {
  let pos: { [id: number]: { x: number; y: number } } = {};
  let pad = 60;
  let spacing = (svgW - 2 * pad) / Math.max(nodes.length - 1, 1);
  nodes.forEach((id, i) => {
    pos[id] = { x: pad + i * spacing, y: y };
  });
  return pos;
}

function drawUnionNodes(g: any, nodes: number[],
    pos: { [id: number]: { x: number; y: number } },
    highlightL1: boolean, highlightL2: boolean) {
  nodes.forEach(id => {
    let p = pos[id];
    let inL1 = layer1Nodes.indexOf(id) !== -1;
    let inL2 = layer2Nodes.indexOf(id) !== -1;
    let fill = '#ccc';
    if (highlightL1 && highlightL2) {
      if (inL1 && inL2) fill = '#666';
      else if (inL1) fill = L1_COLOR;
      else if (inL2) fill = L2_COLOR;
    } else if (highlightL1 && inL1) fill = L1_COLOR;
    else if (highlightL2 && inL2) fill = L2_COLOR;

    g.append("circle")
      .attr("class", "viz-node")
      .attr("cx", p.x).attr("cy", p.y).attr("r", NODE_R)
      .style("fill", fill).style("fill-opacity", 0.22)
      .style("stroke", fill).style("stroke-width", 2);
    g.append("text")
      .attr("x", p.x).attr("y", p.y)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .style("font-size", "11px").style("fill", "#333").style("font-weight", "500")
      .text(id);

    let dots: string[] = [];
    if (inL1) dots.push(L1_COLOR);
    if (inL2) dots.push(L2_COLOR);
    let dotR = 3;
    let totalW = dots.length * dotR * 2 + (dots.length - 1) * 3;
    dots.forEach((c, di) => {
      let dx = p.x - totalW / 2 + dotR + di * (dotR * 2 + 3);
      g.append("circle")
        .attr("cx", dx).attr("cy", p.y + NODE_R + 10)
        .attr("r", dotR)
        .style("fill", c);
    });
  });
}

function drawArcs(g: any, edges: [number, number][],
    pos: { [id: number]: { x: number; y: number } },
    color: string, above: boolean, curvature: number) {
  edges.forEach(([a, b]) => {
    let x1 = pos[a].x, x2 = pos[b].x;
    let baseY = pos[a].y;
    let mx = (x1 + x2) / 2;
    let controlY = above ? baseY - curvature : baseY + curvature;
    let d = `M ${x1},${baseY} Q ${mx},${controlY} ${x2},${baseY}`;
    g.append("path")
      .attr("class", "viz-edge")
      .attr("d", d)
      .style("stroke", color)
      .style("stroke-width", 2)
      .style("stroke-opacity", 0.6);
  });
  let labelY = above
    ? pos[edges[0][0]].y - curvature - 12
    : pos[edges[0][0]].y + curvature + 16;
  let labelX = 275;
  g.append("text")
    .attr("class", "viz-label")
    .attr("x", labelX).attr("y", labelY)
    .attr("text-anchor", "middle")
    .style("fill", color)
    .text(above ? "Layer 1" : "Layer 2");
}

// ---------------------------------------------------------------------------
// Step rendering
// ---------------------------------------------------------------------------

function renderStep(svgSel: any, step: number): void {
  svgSel.selectAll("*").remove();

  let svgW = 550;
  let svgH = 260;
  svgSel.attr("width", svgW).attr("height", svgH);
  let g = svgSel.append("g");

  let AXIS_Y = 130;
  let ARC_CURV = 70;

  switch (step) {
    case 1: {
      let pos1 = circleLayout(layer1Nodes, svgW / 2, svgH / 2, 70);
      drawGraph(g, layer1Nodes, layer1Edges, pos1, L1_COLOR, "Layer 1",
        svgW / 2, svgH / 2 + 110);
      break;
    }
    case 2: {
      let pos1 = circleLayout(layer1Nodes, svgW * 0.25, svgH / 2, 65);
      let pos2 = circleLayout(layer2Nodes, svgW * 0.75, svgH / 2, 65);
      drawGraph(g, layer1Nodes, layer1Edges, pos1, L1_COLOR, "Layer 1",
        svgW * 0.25, svgH / 2 + 100);
      drawGraph(g, layer2Nodes, layer2Edges, pos2, L2_COLOR, "Layer 2",
        svgW * 0.75, svgH / 2 + 100);
      g.append("line")
        .attr("x1", svgW / 2).attr("y1", 20)
        .attr("x2", svgW / 2).attr("y2", svgH - 20)
        .style("stroke", "#ccc").style("stroke-width", 1)
        .style("stroke-dasharray", "4 3");
      break;
    }
    case 3: {
      let ROW1_Y = 80;
      let ROW2_Y = 180;
      let flatPad = 80;

      let l1Spacing = (svgW - 2 * flatPad) / Math.max(layer1Nodes.length - 1, 1);
      let pos1: { [id: number]: { x: number; y: number } } = {};
      layer1Nodes.forEach((id, i) => {
        pos1[id] = { x: flatPad + i * l1Spacing, y: ROW1_Y };
      });

      let l2Spacing = (svgW - 2 * flatPad) / Math.max(layer2Nodes.length - 1, 1);
      let pos2: { [id: number]: { x: number; y: number } } = {};
      layer2Nodes.forEach((id, i) => {
        pos2[id] = { x: flatPad + i * l2Spacing, y: ROW2_Y };
      });

      // Axis lines
      g.append("line")
        .attr("x1", flatPad - 20).attr("y1", ROW1_Y)
        .attr("x2", svgW - flatPad + 20).attr("y2", ROW1_Y)
        .style("stroke", "#e0e0e0").style("stroke-width", 1);
      g.append("line")
        .attr("x1", flatPad - 20).attr("y1", ROW2_Y)
        .attr("x2", svgW - flatPad + 20).attr("y2", ROW2_Y)
        .style("stroke", "#e0e0e0").style("stroke-width", 1);

      // Layer 1 edges (arcs above)
      let FLAT_CURV = 40;
      layer1Edges.forEach(([a, b]) => {
        let x1 = pos1[a].x, x2 = pos1[b].x;
        let mx = (x1 + x2) / 2;
        let cy = ROW1_Y - FLAT_CURV * (Math.abs(b - a) / Math.max(layer1Nodes.length - 1, 1));
        g.append("path")
          .attr("class", "viz-edge")
          .attr("d", `M ${x1},${ROW1_Y} Q ${mx},${cy} ${x2},${ROW1_Y}`)
          .style("stroke", L1_COLOR).style("stroke-width", 2)
          .style("stroke-opacity", 0.45).style("fill", "none");
      });
      // Layer 1 nodes
      layer1Nodes.forEach(id => {
        g.append("circle").attr("class", "viz-node")
          .attr("cx", pos1[id].x).attr("cy", pos1[id].y).attr("r", NODE_R)
          .style("fill", L1_COLOR).style("fill-opacity", 0.18)
          .style("stroke", L1_COLOR).style("stroke-width", 2);
        g.append("text")
          .attr("x", pos1[id].x).attr("y", pos1[id].y)
          .attr("text-anchor", "middle").attr("dominant-baseline", "central")
          .style("font-size", "11px").style("fill", "#333").style("font-weight", "500")
          .text(id);
      });

      // Layer 2 edges (arcs below)
      layer2Edges.forEach(([a, b]) => {
        let x1 = pos2[a].x, x2 = pos2[b].x;
        let mx = (x1 + x2) / 2;
        let cy = ROW2_Y + FLAT_CURV * (Math.abs(b - a) / Math.max(layer2Nodes.length - 1, 1));
        g.append("path")
          .attr("class", "viz-edge")
          .attr("d", `M ${x1},${ROW2_Y} Q ${mx},${cy} ${x2},${ROW2_Y}`)
          .style("stroke", L2_COLOR).style("stroke-width", 2)
          .style("stroke-opacity", 0.45).style("fill", "none");
      });
      // Layer 2 nodes
      layer2Nodes.forEach(id => {
        g.append("circle").attr("class", "viz-node")
          .attr("cx", pos2[id].x).attr("cy", pos2[id].y).attr("r", NODE_R)
          .style("fill", L2_COLOR).style("fill-opacity", 0.18)
          .style("stroke", L2_COLOR).style("stroke-width", 2);
        g.append("text")
          .attr("x", pos2[id].x).attr("y", pos2[id].y)
          .attr("text-anchor", "middle").attr("dominant-baseline", "central")
          .style("font-size", "11px").style("fill", "#333").style("font-weight", "500")
          .text(id);
      });

      // Labels
      g.append("text").attr("class", "viz-label")
        .attr("x", flatPad - 20).attr("y", ROW1_Y - 30)
        .style("fill", L1_COLOR).text("Layer 1");
      g.append("text").attr("class", "viz-label")
        .attr("x", flatPad - 20).attr("y", ROW2_Y - 30)
        .style("fill", L2_COLOR).text("Layer 2");

      // Shared-node connectors
      let sharedNodes = layer1Nodes.filter(id => layer2Nodes.indexOf(id) !== -1);
      sharedNodes.forEach(id => {
        g.append("line")
          .attr("x1", pos1[id].x).attr("y1", pos1[id].y + NODE_R + 2)
          .attr("x2", pos2[id].x).attr("y2", pos2[id].y - NODE_R - 2)
          .style("stroke", "#999").style("stroke-width", 1)
          .style("stroke-dasharray", "3 3");
      });
      break;
    }
    case 4: {
      let uPos = unionLayout(unionNodes, AXIS_Y, svgW);
      g.append("line")
        .attr("x1", 40).attr("y1", AXIS_Y)
        .attr("x2", svgW - 40).attr("y2", AXIS_Y)
        .style("stroke", "#e0e0e0").style("stroke-width", 1);
      drawUnionNodes(g, unionNodes, uPos, true, true);
      let ly = AXIS_Y + 50;
      g.append("circle").attr("cx", svgW / 2 - 100).attr("cy", ly).attr("r", 5)
        .style("fill", L1_COLOR);
      g.append("text").attr("x", svgW / 2 - 90).attr("y", ly)
        .attr("dominant-baseline", "central")
        .style("font-size", "11px").style("fill", "#666").text("In Layer 1");
      g.append("circle").attr("cx", svgW / 2 + 10).attr("cy", ly).attr("r", 5)
        .style("fill", L2_COLOR);
      g.append("text").attr("x", svgW / 2 + 20).attr("y", ly)
        .attr("dominant-baseline", "central")
        .style("font-size", "11px").style("fill", "#666").text("In Layer 2");
      break;
    }
    case 5: {
      let uPos = unionLayout(unionNodes, AXIS_Y, svgW);
      g.append("line")
        .attr("x1", 40).attr("y1", AXIS_Y)
        .attr("x2", svgW - 40).attr("y2", AXIS_Y)
        .style("stroke", "#e0e0e0").style("stroke-width", 1);
      drawArcs(g, layer1Edges, uPos, L1_COLOR, true, ARC_CURV);
      drawUnionNodes(g, unionNodes, uPos, true, false);
      break;
    }
    case 6: {
      let uPos = unionLayout(unionNodes, AXIS_Y, svgW);
      g.append("line")
        .attr("x1", 40).attr("y1", AXIS_Y)
        .attr("x2", svgW - 40).attr("y2", AXIS_Y)
        .style("stroke", "#e0e0e0").style("stroke-width", 1);
      drawArcs(g, layer1Edges, uPos, L1_COLOR, true, ARC_CURV);
      drawArcs(g, layer2Edges, uPos, L2_COLOR, false, ARC_CURV);
      drawUnionNodes(g, unionNodes, uPos, true, true);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Public init
// ---------------------------------------------------------------------------

export function initVizExplainer(): void {
  const svgSel = d3.select("#viz-explainer-svg");
  if (svgSel.empty()) return;

  let currentStep = 1;

  const btnPrev = d3.select("#viz-prev");
  const btnNext = d3.select("#viz-next");
  const stepLabel = d3.select("#viz-step-label");
  const stepDesc  = d3.select("#viz-step-description");

  function update() {
    stepLabel.text(`Step ${currentStep} / ${TOTAL_STEPS}`);
    stepDesc.text(DESCRIPTIONS[currentStep - 1]);
    (btnPrev.node() as HTMLButtonElement).disabled = currentStep <= 1;
    (btnNext.node() as HTMLButtonElement).disabled = currentStep >= TOTAL_STEPS;
    renderStep(svgSel, currentStep);
  }

  btnPrev.on("click", () => { if (currentStep > 1) { currentStep--; update(); } });
  btnNext.on("click", () => { if (currentStep < TOTAL_STEPS) { currentStep++; update(); } });

  update();
}
