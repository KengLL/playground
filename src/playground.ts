/* MultiRepast4py Simulation Playground
 * Based on TensorFlow Playground (Apache License 2.0)
 */

import * as sim from "./simulation";
import { State, topologies, getKeyFromValue } from "./state";
import { AppendingLineChart } from "./linechart";
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_RADIUS = 10;
const BASE_CURVATURE = 70; // px: base arc height per layer group

/** Colors for each layer (up to 6 layers). */
const LAYER_COLORS = [
  '#f59322', // orange
  '#0877bd', // blue
  '#2ecc71', // green
  '#9b59b6', // purple
  '#e74c3c', // red
  '#1abc9c', // teal
];

const STATE_COLORS: { [k in sim.AgentState]: string } = {
  'S': '#aaaaaa',
  'I': '#e74c3c',
  'R': '#2ecc71',
};

// ---------------------------------------------------------------------------
// Player — setTimeout-based so each step is rendered before the next fires
// ---------------------------------------------------------------------------

class Player {
  private timerId: number = null;
  private isPlaying = false;
  private callback: (isPlaying: boolean) => void = null;
  /** Milliseconds between steps. Controlled by the speed slider. */
  stepDelay = 200;

  playOrPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.isPlaying = true;
      if (iter === 0) simulationStarted();
      this.play();
    }
  }

  onPlayPause(callback: (isPlaying: boolean) => void) {
    this.callback = callback;
  }

  play() {
    this.pause(); // clear any existing timer
    this.isPlaying = true;
    if (this.callback) this.callback(true);
    this.scheduleNext();
  }

  pause() {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.isPlaying = false;
    if (this.callback) this.callback(false);
  }

  private scheduleNext() {
    this.timerId = window.setTimeout(() => {
      if (!this.isPlaying) return;
      oneStep();
      this.scheduleNext();
    }, this.stepDelay);
  }
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

let state = State.deserializeState();
let iter = 0;
let simNetwork: sim.SimNetwork = null;
let player = new Player();
let lineChart = new AppendingLineChart(d3.select("#linechart"), ["#e74c3c", "#2ecc71"]);
let mainWidth: number;
// agentSpreadLog[step][agentId][layerIdx] = cumulative infections spread
let agentSpreadLog: number[][][] = [];
let selectedAgentId: number | null = null;

// ---------------------------------------------------------------------------
// Topology thumbnail rendering
// ---------------------------------------------------------------------------

function drawTopologyThumbnail(canvas: HTMLCanvasElement,
    topology: sim.TopologyType) {
  const w = canvas.width = 60;
  const h = canvas.height = 60;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  // Draw a tiny example graph
  const n = 8;
  const cx = w / 2, cy = h / 2, r = 20;
  // Node positions on a circle
  let pts: { x: number, y: number }[] = [];
  for (let i = 0; i < n; i++) {
    let angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }

  // Edges by topology type
  let edges: [number, number][] = [];
  if (topology === 'random') {
    // Random ~30% density
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.sin((i * 7 + j * 3 + 13)) > 0.4) edges.push([i, j]);
    }
  } else if (topology === 'smallworld') {
    // Ring + shortcuts
    for (let i = 0; i < n; i++) {
      edges.push([i, (i + 1) % n]);
      edges.push([i, (i + 2) % n]);
    }
    edges.push([0, 5]); edges.push([1, 6]);
  } else {
    // Scale-free: hub node
    for (let i = 1; i < n; i++) edges.push([0, i]);
    edges.push([1, 3]); edges.push([2, 4]);
  }

  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  for (let [a, b] of edges) {
    ctx.beginPath();
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
    ctx.stroke();
  }
  ctx.fillStyle = '#555';
  for (let pt of pts) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// GUI setup
// ---------------------------------------------------------------------------

function makeGUI() {
  // Play/pause
  d3.select("#reset-button").on("click", () => {
    reset();
    userHasInteracted();
  });

  d3.select("#play-pause-button").on("click", () => {
    userHasInteracted();
    player.playOrPause();
  });

  player.onPlayPause(isPlaying => {
    d3.select("#play-pause-button").classed("playing", isPlaying);
  });

  d3.select("#next-step-button").on("click", () => {
    player.pause();
    userHasInteracted();
    if (iter === 0) simulationStarted();
    oneStep();
  });

  d3.select("#data-regen-button").on("click", () => {
    state.seed = Math.random().toFixed(5);
    generateNetwork();
    reset(false, true); // keep params, just regenerate
  });

  // Topology thumbnails
  let topologyThumbnails = d3.selectAll("canvas[data-topology]");
  topologyThumbnails.on("click", function () {
    let newTopo = (this as any).dataset.topology as sim.TopologyType;
    if (newTopo === state.topology) return;
    state.topology = newTopo;
    topologyThumbnails.classed("selected", false);
    d3.select(this).classed("selected", true);
    generateNetwork();
    parametersChanged = true;
    reset();
  });
  // Select current topology
  d3.select(`canvas[data-topology=${state.topology}]`).classed("selected", true);

  // Draw topology thumbnails
  let topologyCanvases = document.querySelectorAll("canvas[data-topology]");
  for (let i = 0; i < topologyCanvases.length; i++) {
    let canvas = topologyCanvases[i] as HTMLCanvasElement;
    drawTopologyThumbnail(canvas, (canvas as any).dataset.topology as sim.TopologyType);
  }

  // Agents dropdown (numAgents)
  let agentsDropdown = d3.select("#numAgents").on("change", function () {
    state.numAgents = +(this as any).value;
    parametersChanged = true;
    reset();
  });
  (agentsDropdown.node() as HTMLSelectElement).value = String(state.numAgents);

  // Spread rate slider
  let spreadSlider = d3.select("#spreadRate").on("input", function () {
    state.spreadRate = +(this as any).value;
    d3.select("label[for='spreadRate'] .value").text((state.spreadRate).toFixed(2));
    state.serialize();
    userHasInteracted();
  });
  (spreadSlider.node() as HTMLInputElement).value = String(state.spreadRate);
  d3.select("label[for='spreadRate'] .value").text(state.spreadRate.toFixed(2));

  // Recovery rate slider
  let recoverySlider = d3.select("#recoveryRate").on("input", function () {
    state.recoveryRate = +(this as any).value;
    d3.select("label[for='recoveryRate'] .value").text((state.recoveryRate).toFixed(2));
    state.serialize();
    userHasInteracted();
  });
  (recoverySlider.node() as HTMLInputElement).value = String(state.recoveryRate);
  d3.select("label[for='recoveryRate'] .value").text(state.recoveryRate.toFixed(2));

  // Initial infected slider
  let initInfectedSlider = d3.select("#initialInfected").on("input", function () {
    state.initialInfected = +(this as any).value;
    d3.select("label[for='initialInfected'] .value").text(String(state.initialInfected));
    generateNetwork();
    parametersChanged = true;
    reset();
  });
  (initInfectedSlider.node() as HTMLInputElement).value = String(state.initialInfected);
  d3.select("label[for='initialInfected'] .value").text(String(state.initialInfected));

  // Step speed slider (ms between simulation steps)
  let speedSlider = d3.select("#stepSpeed").on("input", function () {
    let ms = +(this as any).value;
    player.stepDelay = ms;
    d3.select("label[for='stepSpeed'] .value").text(ms + "ms");
  });
  player.stepDelay = +(speedSlider.node() as HTMLInputElement).value;
  d3.select("label[for='stepSpeed'] .value")
    .text(player.stepDelay + "ms");

  // Add/remove layer buttons
  d3.select("#add-layers").on("click", () => {
    if (state.numLayers >= 6) return;
    state.layerConnectivity.push(0.3);
    state.layerFrequency.push(1);
    state.numLayers++;
    parametersChanged = true;
    reset();
  });

  d3.select("#remove-layers").on("click", () => {
    if (state.numLayers <= 1) return;
    state.numLayers--;
    state.layerConnectivity.splice(state.numLayers);
    state.layerFrequency.splice(state.numLayers);
    parametersChanged = true;
    reset();
  });

  // Resize handler
  window.addEventListener("resize", () => {
    let newWidth = (document.querySelector("#main-part") as HTMLElement).offsetWidth;
    if (newWidth !== mainWidth) {
      mainWidth = newWidth;
      drawSimulation(simNetwork);
    }
  });

  if (state.hideText) {
    d3.select("#article-text").style("display", "none");
    d3.select("div.more").style("display", "none");
    d3.select("header").style("display", "none");
  }
}

// ---------------------------------------------------------------------------
// Simulation drawing (arc diagram)
// ---------------------------------------------------------------------------

function drawSimulation(network: sim.SimNetwork): void {
  if (!network) return;

  let svg = d3.select("#svg");
  svg.select("g.core").remove();
  // Clear per-layer control cards (now below the SVG)
  d3.select("#layer-controls").html("");

  // SVG fills the features column
  let cf = d3.select(".column.features").node() as HTMLDivElement;
  let svgWidth = cf.offsetWidth;
  svg.attr("width", svgWidth);

  let { agents, layers } = network;
  let n = agents.length;
  if (n === 0) return;

  // Determine SVG height: track actual max curvature above and below separately.
  // Even-indexed layers arc above, odd below — so a 1-layer config needs no below space.
  let maxAboveCurv = 0, maxBelowCurv = 0;
  layers.forEach((_, layerIdx) => {
    let curvature = (Math.floor(layerIdx / 2) + 1) * BASE_CURVATURE;
    if (layerIdx % 2 === 0) maxAboveCurv = Math.max(maxAboveCurv, curvature);
    else                    maxBelowCurv = Math.max(maxBelowCurv, curvature);
  });
  const vPad = AGENT_RADIUS + 18;
  let agentY = maxAboveCurv + vPad;
  let svgHeight = agentY + Math.max(maxBelowCurv, 0) + vPad;

  svg.attr("height", svgHeight);

  let padding = 20;
  let agentSpacing = (svgWidth - 2 * padding) / Math.max(n - 1, 1);

  let container = svg.append("g")
    .classed("core", true)
    .attr("transform", "translate(0,0)");

  // ---------- Draw arcs per layer ----------
  layers.forEach((layer, layerIdx) => {
    let color = LAYER_COLORS[layerIdx % LAYER_COLORS.length];
    let above = layerIdx % 2 === 0;          // even layers go above
    let groupIdx = Math.floor(layerIdx / 2); // 0 = innermost
    let curvature = (groupIdx + 1) * BASE_CURVATURE;

    // Only draw undirected edges (source < target) to avoid double-drawing
    let drawnPairs = new Set<string>();
    for (let edge of layer.edges) {
      let u = Math.min(edge.source, edge.target);
      let v = Math.max(edge.source, edge.target);
      let key = `${u}-${v}`;
      if (drawnPairs.has(key)) continue;
      drawnPairs.add(key);

      let x1 = padding + u * agentSpacing;
      let x2 = padding + v * agentSpacing;
      let mx = (x1 + x2) / 2;
      let controlY = above ? agentY - curvature : agentY + curvature;

      // Quadratic Bézier path — opacity encodes weight (thin fixed line)
      let d = `M ${x1},${agentY} Q ${mx},${controlY} ${x2},${agentY}`;
      let baseOpacity = 0.15 + edge.weight * 0.65; // 0.15–0.80

      // Set transition:none initially so arcs don't flash-in on draw
      container.append("path")
        .attr("class", `layer-arc layer-arc-${layerIdx}`)
        .attr("d", d)
        .attr("data-base-opacity", baseOpacity)
        .style("transition", "none")
        .style("stroke", color)
        .style("stroke-width", 1.5)
        .style("fill", "none")
        .style("stroke-opacity", baseOpacity);

      // Invisible wider hit target for hover
      container.append("path")
        .attr("class", "layer-arc-hover")
        .attr("d", d)
        .style("stroke", color)
        .style("stroke-width", 12)
        .style("fill", "none")
        .style("stroke-opacity", 0)
        .on("mouseenter", function () {
          d3.select(this.previousSibling as Element)
            .style("stroke-opacity", 1.0)
            .style("stroke-width", 3);
          showArcTooltip(edge, layer, d3.mouse(svg.node() as SVGElement));
        })
        .on("mouseleave", function () {
          let arc = d3.select(this.previousSibling as Element);
          arc.style("stroke-opacity", +arc.attr("data-base-opacity"))
             .style("stroke-width", 1.5);
          hideArcTooltip();
        });
    }
  });

  // ---------- Draw agent circles ----------
  let agentGroups = container.selectAll("g.agent")
    .data(agents, (d: sim.SimAgent) => String(d.id));

  let entered = agentGroups.enter().append("g")
    .attr("class", "agent")
    .attr("transform", (d) => `translate(${padding + d.id * agentSpacing}, ${agentY})`);

  entered.append("circle")
    .attr("r", AGENT_RADIUS)
    .attr("class", "agent-circle");

  entered.append("text")
    .attr("text-anchor", "middle")
    .attr("class", "agent-label")
    .text((d) => d.id);

  // Update initial colors — use .select() on parent so datum flows through
  container.selectAll("g.agent")
    .select("circle.agent-circle")
    .style("fill", (d: sim.SimAgent) => STATE_COLORS[d.state]);

  // Hover + click interactions
  container.selectAll("g.agent")
    .on("mouseenter", function (d) {
      showAgentHoverCard(d, d3.mouse(svg.node() as SVGElement), layers.length);
    })
    .on("mouseleave", () => {
      hideAgentHoverCard();
    })
    .on("click", function (d: sim.SimAgent) {
      selectedAgentId = d.id;
      highlightSelectedAgent();
      d3.select("#agent-spread-label").text(`Agent ${d.id} — spread history`);
      renderAgentLayerConnections();
      renderAgentSpreadChart();
    });

  // Per-layer controls rendered into the layers column (not #network)
  layers.forEach((_layer, idx) => addLayerControl(idx));

  // Update layers label
  let suffix = state.numLayers !== 1 ? "s" : "";
  d3.select("#layers-label").text("Layer" + suffix);
  d3.select("#num-layers").text(state.numLayers);
}

// ---------------------------------------------------------------------------
// Update agent colors during simulation
// ---------------------------------------------------------------------------

function updateAgentColors(network: sim.SimNetwork): void {
  // Direct style — no transition needed since the player now waits between steps
  d3.select("#svg g.core").selectAll("g.agent")
    .select("circle.agent-circle")
    .style("fill", (d: sim.SimAgent) => STATE_COLORS[d.state]);
}

// ---------------------------------------------------------------------------
// Hover cards
// ---------------------------------------------------------------------------

function showAgentHoverCard(agent: sim.SimAgent, coords: [number, number],
    numLayers: number): void {
  let hovercard = d3.select("#hovercard");

  let stateLabel = agent.state === 'S' ? 'Susceptible'
      : agent.state === 'I' ? 'Infected'
      : 'Recovered';

  let infectedFromText = agent.state === 'S'
      ? 'Not yet infected'
      : agent.infectedByLayer === null
          ? 'Initial seeder'
          : `Infected via Layer ${agent.infectedByLayer + 1}`;

  let spreadLines = '';
  for (let li = 0; li < numLayers; li++) {
    let cnt = agent.infectedCount[li] || 0;
    let color = LAYER_COLORS[li % LAYER_COLORS.length];
    spreadLines += `<div style="color:${color}">Layer ${li + 1}: spread to ${cnt} agent${cnt !== 1 ? 's' : ''}</div>`;
  }

  hovercard.select(".hovercard-content").html(`
    <div><strong>Agent ${agent.id}</strong></div>
    <div>State: <span style="color:${STATE_COLORS[agent.state]}">${stateLabel}</span></div>
    <div>${infectedFromText}</div>
    ${spreadLines}
  `);

  hovercard.style({
    "left": `${coords[0] + 15}px`,
    "top": `${coords[1] - 10}px`,
    "display": "block"
  });
}

function hideAgentHoverCard(): void {
  d3.select("#hovercard").style("display", "none");
}

function showArcTooltip(edge: sim.SimEdge, layer: sim.SimLayer,
    coords: [number, number]): void {
  let color = LAYER_COLORS[layer.id % LAYER_COLORS.length];
  let hovercard = d3.select("#hovercard");
  hovercard.select(".hovercard-content").html(`
    <div style="color:${color}"><strong>Layer ${layer.id + 1}</strong></div>
    <div>Edge: Agent ${edge.source} ↔ Agent ${edge.target}</div>
    <div>Weight: ${edge.weight.toFixed(3)}</div>
  `);
  hovercard.style({
    "left": `${coords[0] + 15}px`,
    "top": `${coords[1] - 10}px`,
    "display": "block"
  });
}

function hideArcTooltip(): void {
  d3.select("#hovercard").style("display", "none");
}

// ---------------------------------------------------------------------------
// Layer arc pulse highlight (fix #6)
// ---------------------------------------------------------------------------

function pulseLayerArcs(activeLayers: Set<number>): void {
  activeLayers.forEach(layerIdx => {
    let arcs = d3.selectAll(`.layer-arc-${layerIdx}`);
    // Briefly highlight then restore each arc's weight-based opacity
    arcs.style("stroke-width", 3)
        .style("stroke-opacity", 1.0)
      .transition()
        .duration(350)
        .style("stroke-width", 1.5)
        .style("stroke-opacity", function () {
          return +d3.select(this).attr("data-base-opacity");
        });
  });
}

// ---------------------------------------------------------------------------
// Per-layer controls
// ---------------------------------------------------------------------------

function addLayerControl(layerIdx: number): void {
  let color = LAYER_COLORS[layerIdx % LAYER_COLORS.length];

  // Append to #layer-controls (below the SVG) — one horizontal row per layer
  let div = d3.select("#layer-controls").append("div")
    .classed("plus-minus-layer", true)
    .attr("data-layer", layerIdx)
    .style("border-left", `4px solid ${color}`);

  div.append("span")
    .attr("class", "layer-title")
    .style("color", color)
    .text(`Layer ${layerIdx + 1}`);

  // Connectivity group: Conn [-] 0.3 [+]
  let connGroup = div.append("span").attr("class", "layer-control-group");
  connGroup.append("span").attr("class", "layer-row-label").text("Connectivity");
  connGroup.append("button")
    .attr("class", "mdl-button mdl-js-button mdl-button--icon")
    .on("click", () => {
      state.layerConnectivity[layerIdx] = Math.max(0.1,
          +(state.layerConnectivity[layerIdx] - 0.1).toFixed(1));
      parametersChanged = true;
      reset();
    })
    .append("i").attr("class", "material-icons").text("remove");
  connGroup.append("span")
    .attr("class", "layer-value")
    .text((state.layerConnectivity[layerIdx] || 0.3).toFixed(1));
  connGroup.append("button")
    .attr("class", "mdl-button mdl-js-button mdl-button--icon")
    .on("click", () => {
      state.layerConnectivity[layerIdx] = Math.min(1.0,
          +(state.layerConnectivity[layerIdx] + 0.1).toFixed(1));
      parametersChanged = true;
      reset();
    })
    .append("i").attr("class", "material-icons").text("add");

  // Frequency group: Every N [-] 1 [+]
  let freqGroup = div.append("span").attr("class", "layer-control-group");
  freqGroup.append("span").attr("class", "layer-row-label").text("Every N steps");
  freqGroup.append("button")
    .attr("class", "mdl-button mdl-js-button mdl-button--icon")
    .on("click", () => {
      state.layerFrequency[layerIdx] = Math.max(1, state.layerFrequency[layerIdx] - 1);
      parametersChanged = true;
      reset();
    })
    .append("i").attr("class", "material-icons").text("remove");
  freqGroup.append("span")
    .attr("class", "layer-value")
    .text(String(state.layerFrequency[layerIdx] || 1));
  freqGroup.append("button")
    .attr("class", "mdl-button mdl-js-button mdl-button--icon")
    .on("click", () => {
      state.layerFrequency[layerIdx] = Math.min(10, state.layerFrequency[layerIdx] + 1);
      parametersChanged = true;
      reset();
    })
    .append("i").attr("class", "material-icons").text("add");
}

// ---------------------------------------------------------------------------
// Spread rate bar chart (replaces heatmap)
// ---------------------------------------------------------------------------

function updateStatsBars(stats: sim.SimStats): void {
  let total = stats.susceptible + stats.infected + stats.recovered || 1;
  let barContainer = d3.select("#stats-bars");
  if (barContainer.empty()) return;

  let bars = [
    { label: 'S', count: stats.susceptible, color: STATE_COLORS.S },
    { label: 'I', count: stats.infected,    color: STATE_COLORS.I },
    { label: 'R', count: stats.recovered,   color: STATE_COLORS.R },
  ];

  let rects = barContainer.selectAll("div.stat-bar").data(bars);
  rects.enter().append("div").attr("class", "stat-bar");

  barContainer.selectAll("div.stat-bar")
    .style("background", (d: any) => d.color)
    .style("width", (d: any) => `${(d.count / total * 100).toFixed(1)}%`)
    .attr("title", (d: any) => `${d.label}: ${d.count}`);
}

// ---------------------------------------------------------------------------
// Layer Nodes charts (both shown simultaneously in output column)
// ---------------------------------------------------------------------------

interface BarDatum { label: string; value: number; color: string; agentId?: number; }
interface LayerConnectionDatum {
  label: string;
  value: number;
  scaledValue: number;
  frequency: number;
  color: string;
}

function updateLayerChart(): void {
  if (!simNetwork) return;

  let perLayerData: BarDatum[] = simNetwork.layers.map((_, li) => {
    let total = simNetwork.agents.reduce((sum, a) =>
      sum + (a.infectedCount[li] || 0), 0);
    return {
      label: "L" + (li + 1),
      value: total,
      color: LAYER_COLORS[li % LAYER_COLORS.length]
    };
  });

  let perAgentData: BarDatum[] = simNetwork.agents.map(agent => {
    let total = agent.infectedCount.reduce((sum, c) => sum + (c || 0), 0);
    return { label: String(agent.id), value: total, color: STATE_COLORS[agent.state],
             agentId: agent.id };
  }).sort((a, b) => b.value - a.value);

  renderBarChart("#layer-chart-svg", perLayerData, 80);
  renderBarChart("#agent-chart-svg", perAgentData, 80, '#e74c3c', (d: BarDatum) => {
    if (d.agentId !== undefined) {
      selectedAgentId = d.agentId;
      highlightSelectedAgent();
      d3.select("#agent-spread-label").text(`Agent ${d.agentId} — spread history`);
      renderAgentLayerConnections();
      renderAgentSpreadChart();
    }
  });
}

function renderBarChart(selector: string, data: BarDatum[], height: number,
    fixedColor?: string, onBarClick?: (d: BarDatum) => void): void {
  let svg = d3.select(selector);
  if (svg.empty()) return;

  let svgEl = svg.node() as SVGElement;
  let parentEl = svgEl.parentElement;
  let width = parentEl ? parentEl.offsetWidth - 4 : 260;
  svg.attr("width", width);
  svg.selectAll("*").remove();

  const yAxisW = 28;
  const chartW = width - yAxisW;
  let n = data.length;
  let barW = n > 0 ? chartW / n : chartW;
  // Use rotated labels when bars are too narrow for horizontal text
  const rotateLabels = barW < 10;
  const labelH = rotateLabels ? 28 : 14;
  const chartH = height - labelH;
  let maxVal = data.reduce((m, d) => Math.max(m, d.value), 1);
  let pad = 1;

  // Y-axis line
  svg.append("line")
    .attr("x1", yAxisW).attr("y1", 0)
    .attr("x2", yAxisW).attr("y2", chartH)
    .style("stroke", "#ccc").style("stroke-width", 1);

  // Y-axis ticks: 0, mid, max
  [0, Math.ceil(maxVal / 2), maxVal].forEach(t => {
    let ty = chartH - (t / maxVal) * chartH;
    svg.append("line")
      .attr("x1", yAxisW - 3).attr("y1", ty)
      .attr("x2", yAxisW).attr("y2", ty)
      .style("stroke", "#ccc").style("stroke-width", 1);
    svg.append("text")
      .attr("x", yAxisW - 5).attr("y", ty)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .style("font-size", "8px").style("fill", "#999")
      .text(String(t));
  });

  // Bars + x-axis labels
  data.forEach((d, i) => {
    let barH = (d.value / maxVal) * chartH;
    let x = yAxisW + i * barW;
    let y = chartH - barH;
    let cx = x + barW / 2;

    let rect = svg.append("rect")
      .attr("x", x + pad)
      .attr("y", y)
      .attr("width", Math.max(0, barW - pad * 2))
      .attr("height", barH)
      .style("fill", fixedColor || d.color)
      .style("opacity", 0.85);

    if (onBarClick) {
      rect.style("cursor", "pointer").on("click", () => onBarClick(d));
    }

    if (rotateLabels) {
      svg.append("text")
        .attr("transform", `rotate(-90, ${cx}, ${chartH + 2})`)
        .attr("x", cx)
        .attr("y", chartH + 2)
        .attr("text-anchor", "start")
        .style("font-size", "7px").style("fill", "#666")
        .text(d.label);
    } else if (barW >= 10) {
      svg.append("text")
        .attr("x", cx)
        .attr("y", height - 2)
        .attr("text-anchor", "middle")
        .style("font-size", "8px").style("fill", "#666")
        .text(d.label);
    }
  });
}

function renderAgentLayerConnections(): void {
  let svg = d3.select("#agent-layer-svg");
  if (svg.empty()) return;

  svg.selectAll("*").remove();
  if (selectedAgentId === null || !simNetwork) return;

  let layerData: LayerConnectionDatum[] = simNetwork.layers.map((layer, li) => {
    let connectionCount = layer.edges.reduce((count, edge) =>
      count + (edge.source === selectedAgentId ? 1 : 0), 0);
    let frequency = Math.max(1, layer.frequency || 1);
    return {
      label: `L${li + 1}`,
      value: connectionCount,
      scaledValue: connectionCount / frequency,
      frequency,
      color: LAYER_COLORS[li % LAYER_COLORS.length]
    };
  });

  let svgEl = svg.node() as SVGElement;
  let width = svgEl.parentElement ? svgEl.parentElement.offsetWidth - 4 : 260;
  const rowH = 6;
  const innerGap = 2;
  const layerGap = 4;
  const top = 16;
  const bottom = 4;
  const rows = Math.max(1, layerData.length);
  const height = Math.max(80, top + bottom + rows * (rowH * 2 + innerGap) +
      Math.max(0, rows - 1) * layerGap);
  svg.attr("width", width).attr("height", height);

  const left = 24;
  const right = 86;
  const chartW = Math.max(1, width - left - right);
  const maxVal = layerData.reduce((m, d) =>
    Math.max(m, d.value, d.scaledValue), 1);

  svg.append("text")
    .attr("x", left)
    .attr("y", 9)
    .style("font-size", "8px")
    .style("fill", "#666")
    .text("Raw connections");

  svg.append("text")
    .attr("x", left + 70)
    .attr("y", 9)
    .style("font-size", "8px")
    .style("fill", "#666")
    .text("Scaled by frequency (1/N)");

  layerData.forEach((d, i) => {
    let baseY = top + i * (rowH * 2 + innerGap + layerGap);
    let rawY = baseY;
    let scaledY = baseY + rowH + innerGap;
    let rawW = (d.value / maxVal) * chartW;
    let scaledW = (d.scaledValue / maxVal) * chartW;
    let scaledText = d.scaledValue % 1 === 0
      ? String(d.scaledValue)
      : d.scaledValue.toFixed(2);

    svg.append("text")
      .attr("x", left - 3)
      .attr("y", baseY + rowH + innerGap / 2)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .style("font-size", "8px")
      .style("fill", "#666")
      .text(d.label);

    svg.append("rect")
      .attr("x", left)
      .attr("y", rawY)
      .attr("width", rawW)
      .attr("height", rowH)
      .style("fill", d.color)
      .style("opacity", 0.9);

    svg.append("rect")
      .attr("x", left)
      .attr("y", scaledY)
      .attr("width", scaledW)
      .attr("height", rowH)
      .style("fill", d.color)
      .style("opacity", 0.45);

    svg.append("text")
      .attr("x", left + chartW + 4)
      .attr("y", rawY + rowH / 2)
      .attr("text-anchor", "start")
      .attr("dominant-baseline", "middle")
      .style("font-size", "8px")
      .style("fill", "#666")
      .text(`${d.value}`);

    svg.append("text")
      .attr("x", left + chartW + 4)
      .attr("y", scaledY + rowH / 2)
      .attr("text-anchor", "start")
      .attr("dominant-baseline", "middle")
      .style("font-size", "8px")
      .style("fill", "#666")
      .text(`${scaledText} (1/${d.frequency})`);
  });
}

// ---------------------------------------------------------------------------
// Agent spread history
// ---------------------------------------------------------------------------

function recordAgentSpread(): void {
  if (!simNetwork) return;
  agentSpreadLog.push(simNetwork.agents.map(a => a.infectedCount.slice()));
}

function highlightSelectedAgent(): void {
  d3.selectAll("g.agent").classed("agent-selected",
    (d: sim.SimAgent) => d.id === selectedAgentId);
}

function renderAgentSpreadChart(): void {
  let svg = d3.select("#agent-spread-svg");
  if (svg.empty()) return;

  svg.selectAll("*").remove();
  d3.select("#agent-spread-legend").html("");

  if (selectedAgentId === null || agentSpreadLog.length === 0 || !simNetwork) return;

  let svgEl = svg.node() as SVGElement;
  let width = svgEl.parentElement ? svgEl.parentElement.offsetWidth - 4 : 260;
  const height = 100;
  svg.attr("width", width).attr("height", height);

  const yAxisW = 28;
  const xAxisH = 14;
  const chartW = width - yAxisW;
  const chartH = height - xAxisH;
  let numSteps = agentSpreadLog.length;
  let numLayers = simNetwork.layers.length;

  // Build series: one per layer + one total
  let layerSeries: number[][] = [];
  for (let li = 0; li < numLayers; li++) layerSeries.push([]);
  let totalSeries: number[] = [];

  agentSpreadLog.forEach(snapshot => {
    let counts = snapshot[selectedAgentId] || [];
    let total = 0;
    for (let li = 0; li < numLayers; li++) {
      let v = counts[li] || 0;
      layerSeries[li].push(v);
      total += v;
    }
    totalSeries.push(total);
  });

  let maxVal = Math.max(1, totalSeries.reduce((m, v) => Math.max(m, v), 0));

  let xScale = (i: number) =>
    yAxisW + (numSteps > 1 ? i / (numSteps - 1) : 0) * chartW;
  let yScale = (v: number) => chartH - (v / maxVal) * chartH;

  let lineGen: any = (d3 as any).svg.line()
    .x((_d: any, i: number) => xScale(i))
    .y((d: any) => yScale(d));

  // Y-axis
  svg.append("line")
    .attr("x1", yAxisW).attr("y1", 0)
    .attr("x2", yAxisW).attr("y2", chartH)
    .style("stroke", "#ccc").style("stroke-width", 1);

  [0, maxVal].forEach(t => {
    let ty = yScale(t);
    svg.append("line")
      .attr("x1", yAxisW - 3).attr("y1", ty)
      .attr("x2", yAxisW).attr("y2", ty)
      .style("stroke", "#ccc").style("stroke-width", 1);
    svg.append("text")
      .attr("x", yAxisW - 5).attr("y", ty)
      .attr("text-anchor", "end").attr("dominant-baseline", "middle")
      .style("font-size", "8px").style("fill", "#999")
      .text(String(t));
  });

  // X-axis ticks: 0 and last step
  [0, numSteps - 1].forEach(i => {
    let tx = xScale(i);
    svg.append("line")
      .attr("x1", tx).attr("y1", chartH)
      .attr("x2", tx).attr("y2", chartH + 3)
      .style("stroke", "#ccc").style("stroke-width", 1);
    svg.append("text")
      .attr("x", tx).attr("y", height - 2)
      .attr("text-anchor", "middle")
      .style("font-size", "8px").style("fill", "#999")
      .text(String(i));
  });

  // Per-layer lines
  layerSeries.forEach((series, li) => {
    if (series.every(v => v === 0)) return;
    let color = LAYER_COLORS[li % LAYER_COLORS.length];
    svg.append("path")
      .datum(series)
      .attr("d", lineGen)
      .style("stroke", color).style("stroke-width", 1.5)
      .style("fill", "none").style("opacity", 0.85);
    // Legend entry
    let item = d3.select("#agent-spread-legend").append("div")
      .attr("class", "spread-legend-item");
    item.append("div")
      .attr("class", "spread-legend-line")
      .style("background", color);
    item.append("span").text(`Layer ${li + 1}`);
  });

  // Total line (dark, on top)
  svg.append("path")
    .datum(totalSeries)
    .attr("d", lineGen)
    .style("stroke", "#333").style("stroke-width", 2)
    .style("fill", "none");
  // Total legend entry
  let totalItem = d3.select("#agent-spread-legend").append("div")
    .attr("class", "spread-legend-item");
  totalItem.append("div")
    .attr("class", "spread-legend-line")
    .style("background", "#333").style("height", "2px");
  totalItem.append("span").text("Total");
}

// ---------------------------------------------------------------------------
// Network generation
// ---------------------------------------------------------------------------

function generateNetwork(firstTime = false): void {
  if (!firstTime) {
    state.serialize();
    userHasInteracted();
  }
  Math.seedrandom(state.seed);

  let layerConfigs = [];
  for (let i = 0; i < state.numLayers; i++) {
    layerConfigs.push({
      connectivity: state.layerConnectivity[i] || 0.3,
      frequency: state.layerFrequency[i] || 1,
      topology: state.topology,
    });
  }

  simNetwork = sim.buildNetwork(state.numAgents, layerConfigs);
  sim.seedInfected(simNetwork, state.initialInfected);
}

// ---------------------------------------------------------------------------
// Simulation step
// ---------------------------------------------------------------------------

function oneStep(): void {
  iter++;
  let activeLayers = sim.simulateStep(simNetwork, state.spreadRate, state.recoveryRate, iter);
  updateUI(activeLayers);
}

// ---------------------------------------------------------------------------
// UI update
// ---------------------------------------------------------------------------

function updateUI(activeLayers?: Set<number>): void {
  updateAgentColors(simNetwork);
  if (activeLayers && activeLayers.size > 0) {
    pulseLayerArcs(activeLayers);
  }

  let stats = sim.getStats(simNetwork);
  updateStatsBars(stats);
  updateLayerChart();
  recordAgentSpread();
  renderAgentLayerConnections();
  renderAgentSpreadChart();

  d3.select("#loss-train").text(stats.infected);
  d3.select("#loss-test").text(stats.recovered);
  d3.select("#iter-number").text(addCommas(zeroPad(iter)));

  lineChart.addDataPoint([stats.infected, stats.recovered]);
}

function zeroPad(n: number): string {
  let pad = "000000";
  return (pad + n).slice(-pad.length);
}

function addCommas(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function reset(onStartup = false, keepNetwork = false): void {
  lineChart.reset();
  agentSpreadLog = [];
  selectedAgentId = null;
  d3.select("#agent-spread-label").text("Click an agent or bar to view spread history");
  d3.select("#agent-layer-svg").selectAll("*").remove();
  d3.select("#agent-spread-svg").selectAll("*").remove();
  d3.select("#agent-spread-legend").html("");
  state.serialize();
  if (!onStartup) userHasInteracted();
  player.pause();

  let suffix = state.numLayers !== 1 ? "s" : "";
  d3.select("#layers-label").text("Layer" + suffix);
  d3.select("#num-layers").text(state.numLayers);

  iter = 0;
  if (!keepNetwork || simNetwork === null) {
    generateNetwork(onStartup);
  } else {
    // Re-seed infection only
    sim.seedInfected(simNetwork, state.initialInfected);
  }

  drawSimulation(simNetwork);
  updateUI();
}

// ---------------------------------------------------------------------------
// Analytics stubs
// ---------------------------------------------------------------------------

let firstInteraction = true;
let parametersChanged = false;

function userHasInteracted(): void {
  if (!firstInteraction) return;
  firstInteraction = false;
  try {
    ga('set', 'page', 'index');
    ga('send', 'pageview', { sessionControl: 'start' });
  } catch (e) {}
}

function simulationStarted(): void {
  try {
    ga('send', {
      hitType: 'event',
      eventCategory: 'Starting Simulation',
      eventAction: parametersChanged ? 'changed' : 'unchanged',
    });
  } catch (e) {}
  parametersChanged = false;
}

// ---------------------------------------------------------------------------
// Scroll handler (keep from original)
// ---------------------------------------------------------------------------

d3.select(".more button").on("click", function () {
  let position = 800;
  d3.transition()
    .duration(1000)
    .tween("scroll", () => {
      let i = d3.interpolateNumber(
        window.pageYOffset || document.documentElement.scrollTop, position);
      return (t: number) => { scrollTo(0, i(t)); };
    });
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

makeGUI();
generateNetwork(true);
reset(true);
