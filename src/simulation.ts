/* Multilayer Simulation Engine for MultiRepast4py Playground
 * SIR (Susceptible-Infected-Recovered) model on multilayer networks.
 */

export type AgentState = 'S' | 'I' | 'R';
export type TopologyType = 'random' | 'smallworld' | 'scalefree';

export interface SimAgent {
  id: number;
  state: AgentState;
  /** Which layer index first infected this agent (null = initial seeder or not infected) */
  infectedByLayer: number | null;
  /** Per-layer count of agents this agent has infected */
  infectedCount: number[];
}

export interface SimEdge {
  source: number;
  target: number;
  /** Connection weight 0–1, visualized as arc thickness */
  weight: number;
}

export interface SimLayer {
  id: number;
  edges: SimEdge[];
  /** Edge density: probability of an edge between any pair (0.1–1.0) */
  connectivity: number;
  /** How many times this layer fires per simulation step (1–5) */
  frequency: number;
}

export interface SimNetwork {
  agents: SimAgent[];
  layers: SimLayer[];
}

export interface LayerConfig {
  connectivity: number;
  frequency: number;
  topology: TopologyType;
}

// ---------------------------------------------------------------------------
// Network construction
// ---------------------------------------------------------------------------

/** Build a random (Erdős–Rényi) layer. */
function buildRandomLayer(numAgents: number, connectivity: number): SimEdge[] {
  let edges: SimEdge[] = [];
  for (let i = 0; i < numAgents; i++) {
    for (let j = i + 1; j < numAgents; j++) {
      if (Math.random() < connectivity) {
        let weight = 0.3 + Math.random() * 0.7; // weight 0.3–1.0
        edges.push({ source: i, target: j, weight });
        edges.push({ source: j, target: i, weight });
      }
    }
  }
  return edges;
}

/** Build a Watts-Strogatz small-world layer. */
function buildSmallWorldLayer(numAgents: number, connectivity: number): SimEdge[] {
  let k = Math.max(2, Math.round(connectivity * numAgents * 0.5) * 2); // even k
  k = Math.min(k, numAgents - 1);
  let beta = 0.1; // rewiring probability
  let edges: SimEdge[] = [];

  // Create a ring lattice
  let adj: boolean[][] = [];
  for (let i = 0; i < numAgents; i++) {
    adj[i] = new Array(numAgents).fill(false);
  }
  for (let i = 0; i < numAgents; i++) {
    for (let m = 1; m <= k / 2; m++) {
      let j = (i + m) % numAgents;
      adj[i][j] = true;
      adj[j][i] = true;
    }
  }

  // Rewire
  for (let i = 0; i < numAgents; i++) {
    for (let m = 1; m <= k / 2; m++) {
      let j = (i + m) % numAgents;
      if (Math.random() < beta) {
        // Remove old edge
        adj[i][j] = false;
        adj[j][i] = false;
        // Pick random new target
        let newJ = Math.floor(Math.random() * numAgents);
        let attempts = 0;
        while ((newJ === i || adj[i][newJ]) && attempts < numAgents) {
          newJ = Math.floor(Math.random() * numAgents);
          attempts++;
        }
        if (newJ !== i && !adj[i][newJ]) {
          adj[i][newJ] = true;
          adj[newJ][i] = true;
        }
      }
    }
  }

  for (let i = 0; i < numAgents; i++) {
    for (let j = i + 1; j < numAgents; j++) {
      if (adj[i][j]) {
        let weight = 0.3 + Math.random() * 0.7;
        edges.push({ source: i, target: j, weight });
        edges.push({ source: j, target: i, weight });
      }
    }
  }
  return edges;
}

/** Build a Barabási–Albert scale-free layer. */
function buildScaleFreeLayer(numAgents: number, connectivity: number): SimEdge[] {
  let m = Math.max(1, Math.round(connectivity * 3)); // edges per new node
  let adj: boolean[][] = [];
  for (let i = 0; i < numAgents; i++) {
    adj[i] = new Array(numAgents).fill(false);
  }
  let degrees = new Array(numAgents).fill(0);

  // Start with a small clique
  let initNodes = Math.min(m + 1, numAgents);
  for (let i = 0; i < initNodes; i++) {
    for (let j = i + 1; j < initNodes; j++) {
      adj[i][j] = true;
      adj[j][i] = true;
      degrees[i]++;
      degrees[j]++;
    }
  }

  // Add remaining nodes with preferential attachment
  for (let i = initNodes; i < numAgents; i++) {
    let totalDeg = degrees.slice(0, i).reduce((a, b) => a + b, 0) || 1;
    let added = 0;
    let attempts = 0;
    while (added < m && attempts < i * 3) {
      attempts++;
      let rand = Math.random() * totalDeg;
      let cumDeg = 0;
      for (let j = 0; j < i; j++) {
        cumDeg += degrees[j];
        if (rand <= cumDeg && !adj[i][j]) {
          adj[i][j] = true;
          adj[j][i] = true;
          degrees[i]++;
          degrees[j]++;
          totalDeg += 2;
          added++;
          break;
        }
      }
    }
  }

  let edges: SimEdge[] = [];
  for (let i = 0; i < numAgents; i++) {
    for (let j = i + 1; j < numAgents; j++) {
      if (adj[i][j]) {
        let weight = 0.3 + Math.random() * 0.7;
        edges.push({ source: i, target: j, weight });
        edges.push({ source: j, target: i, weight });
      }
    }
  }
  return edges;
}

function buildLayer(id: number, numAgents: number, config: LayerConfig): SimLayer {
  let edges: SimEdge[];
  switch (config.topology) {
    case 'smallworld':
      edges = buildSmallWorldLayer(numAgents, config.connectivity);
      break;
    case 'scalefree':
      edges = buildScaleFreeLayer(numAgents, config.connectivity);
      break;
    default: // random
      edges = buildRandomLayer(numAgents, config.connectivity);
  }
  return { id, edges, connectivity: config.connectivity, frequency: config.frequency };
}

/**
 * Build a complete multilayer network.
 * @param numAgents  Number of agents (nodes shared across all layers)
 * @param layerConfigs  Per-layer connectivity and frequency settings
 * @param topology  Graph generation algorithm
 */
export function buildNetwork(
    numAgents: number,
    layerConfigs: LayerConfig[]): SimNetwork {

  let agents: SimAgent[] = [];
  for (let i = 0; i < numAgents; i++) {
    agents.push({
      id: i,
      state: 'S',
      infectedByLayer: null,
      infectedCount: new Array(layerConfigs.length).fill(0),
    });
  }

  let layers = layerConfigs.map((cfg, idx) =>
    buildLayer(idx, numAgents, cfg)
  );

  return { agents, layers };
}

// ---------------------------------------------------------------------------
// Initial seeding
// ---------------------------------------------------------------------------

/**
 * Randomly mark `count` agents as Infected (initial seeds).
 * Resets all agents to S first.
 */
export function seedInfected(network: SimNetwork, count: number): void {
  // Reset everyone to S
  for (let agent of network.agents) {
    agent.state = 'S';
    agent.infectedByLayer = null;
    agent.infectedCount = new Array(network.layers.length).fill(0);
  }
  // Pick random seeds
  let n = network.agents.length;
  let chosen = new Set<number>();
  let safeCount = Math.min(count, n);
  while (chosen.size < safeCount) {
    chosen.add(Math.floor(Math.random() * n));
  }
  chosen.forEach(id => {
    network.agents[id].state = 'I';
    // infectedByLayer = null means "initial seeder"
  });
}

// ---------------------------------------------------------------------------
// Simulation step
// ---------------------------------------------------------------------------

/**
 * Run one tick of the SIR simulation across all layers.
 * @param iter  Current step number (1-based). Layer fires when (iter-1) % frequency === 0.
 * @returns Set of layer IDs that caused at least one new infection this step
 */
export function simulateStep(network: SimNetwork, spreadRate: number,
    recoveryRate: number, iter: number): Set<number> {
  let { agents, layers } = network;
  let activeLayers = new Set<number>();

  // Build adjacency lookup per layer: adj[agentId] → Map<neighborId, weight>
  let layerAdj: Array<Array<Map<number, number>>> = layers.map(layer => {
    let adj: Array<Map<number, number>> = agents.map(() => new Map<number, number>());
    for (let edge of layer.edges) {
      adj[edge.source].set(edge.target, edge.weight);
    }
    return adj;
  });

  for (let layer of layers) {
    // "Spread every N steps": layer fires on steps 1, 1+N, 1+2N, …
    if ((iter - 1) % layer.frequency !== 0) continue;

    let adj = layerAdj[layer.id];
    // Snapshot of currently infected so new infections don't spread immediately
    let currentlyInfected = agents.filter(a => a.state === 'I');
    for (let agent of currentlyInfected) {
      let neighbors = adj[agent.id];
      neighbors.forEach((weight: number, neighborId: number) => {
        let neighbor = agents[neighborId];
        if (neighbor.state === 'S') {
          let prob = spreadRate * weight;
          if (Math.random() < prob) {
            neighbor.state = 'I';
            if (neighbor.infectedByLayer === null) {
              neighbor.infectedByLayer = layer.id;
            }
            if (!agent.infectedCount[layer.id]) {
              agent.infectedCount[layer.id] = 0;
            }
            agent.infectedCount[layer.id]++;
            activeLayers.add(layer.id);
          }
        }
      });
    }
  }

  // Recovery phase (after all layers fire)
  for (let agent of agents) {
    if (agent.state === 'I' && Math.random() < recoveryRate) {
      agent.state = 'R';
    }
  }

  return activeLayers;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface SimStats {
  susceptible: number;
  infected: number;
  recovered: number;
}

export function getStats(network: SimNetwork): SimStats {
  let stats: SimStats = { susceptible: 0, infected: 0, recovered: 0 };
  for (let agent of network.agents) {
    if (agent.state === 'S') stats.susceptible++;
    else if (agent.state === 'I') stats.infected++;
    else stats.recovered++;
  }
  return stats;
}
