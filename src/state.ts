/* Simulation state for MultiRepast4py Playground */

import { TopologyType } from "./simulation";

/** Suffix added to the state when storing if a control is hidden or not. */
const HIDE_STATE_SUFFIX = "_hide";

export { TopologyType };

export let topologies: { [key: string]: TopologyType } = {
  "random": "random",
  "smallworld": "smallworld",
  "scalefree": "scalefree",
};

export function getKeyFromValue(obj: any, value: any): string {
  for (let key in obj) {
    if (obj[key] === value) {
      return key;
    }
  }
  return undefined;
}

function endsWith(s: string, suffix: string): boolean {
  return s.substr(-suffix.length) === suffix;
}

function getHideProps(obj: any): string[] {
  let result: string[] = [];
  for (let prop in obj) {
    if (endsWith(prop, HIDE_STATE_SUFFIX)) {
      result.push(prop);
    }
  }
  return result;
}

export enum Type {
  STRING,
  NUMBER,
  ARRAY_NUMBER,
  ARRAY_STRING,
  BOOLEAN,
  OBJECT
}

export interface Property {
  name: string;
  type: Type;
  keyMap?: { [key: string]: any };
}

export class State {

  private static PROPS: Property[] = [
    { name: "numAgents", type: Type.NUMBER },
    { name: "spreadRate", type: Type.NUMBER },
    { name: "recoveryRate", type: Type.NUMBER },
    { name: "topology", type: Type.OBJECT, keyMap: topologies },
    { name: "initialInfected", type: Type.NUMBER },
    { name: "layerConnectivity", type: Type.ARRAY_NUMBER },
    { name: "layerFrequency", type: Type.ARRAY_NUMBER },
    { name: "numLayers", type: Type.NUMBER },
    { name: "seed", type: Type.STRING },
    { name: "hideText", type: Type.BOOLEAN },
  ];

  [key: string]: any;

  numAgents = 20;
  spreadRate = 0.3;
  recoveryRate = 0.05;
  topology: TopologyType = "random";
  initialInfected = 3;
  layerConnectivity: number[] = [0.3];
  layerFrequency: number[] = [1];
  numLayers = 1;
  seed: string;
  hideText = false;

  static deserializeState(): State {
    let map: { [key: string]: string } = {};
    for (let keyvalue of window.location.hash.slice(1).split("&")) {
      let [name, value] = keyvalue.split("=");
      map[name] = value;
    }
    let state = new State();

    function hasKey(name: string): boolean {
      return name in map && map[name] != null && map[name].trim() !== "";
    }

    function parseArray(value: string): string[] {
      return value.trim() === "" ? [] : value.split(",");
    }

    State.PROPS.forEach(({ name, type, keyMap }) => {
      switch (type) {
        case Type.OBJECT:
          if (keyMap == null) {
            throw Error("A key-value map must be provided for Object state variables");
          }
          if (hasKey(name) && map[name] in keyMap) {
            state[name] = keyMap[map[name]];
          }
          break;
        case Type.NUMBER:
          if (hasKey(name)) {
            state[name] = +map[name];
          }
          break;
        case Type.STRING:
          if (hasKey(name)) {
            state[name] = map[name];
          }
          break;
        case Type.BOOLEAN:
          if (hasKey(name)) {
            state[name] = (map[name] === "false" ? false : true);
          }
          break;
        case Type.ARRAY_NUMBER:
          if (name in map) {
            state[name] = parseArray(map[name]).map(Number);
          }
          break;
        case Type.ARRAY_STRING:
          if (name in map) {
            state[name] = parseArray(map[name]);
          }
          break;
        default:
          throw Error("Unknown type for state variable");
      }
    });

    getHideProps(map).forEach(prop => {
      state[prop] = (map[prop] === "true") ? true : false;
    });

    state.numLayers = state.layerConnectivity.length;
    if (state.seed == null) {
      state.seed = Math.random().toFixed(5);
    }
    Math.seedrandom(state.seed);
    return state;
  }

  serialize() {
    let props: string[] = [];
    State.PROPS.forEach(({ name, type, keyMap }) => {
      let value = this[name];
      if (value == null) return;
      if (type === Type.OBJECT) {
        value = getKeyFromValue(keyMap, value);
      } else if (type === Type.ARRAY_NUMBER || type === Type.ARRAY_STRING) {
        value = value.join(",");
      }
      props.push(`${name}=${value}`);
    });
    getHideProps(this).forEach(prop => {
      props.push(`${prop}=${this[prop]}`);
    });
    window.location.hash = props.join("&");
  }

  getHiddenProps(): string[] {
    let result: string[] = [];
    for (let prop in this) {
      if (endsWith(prop, HIDE_STATE_SUFFIX) && String(this[prop]) === "true") {
        result.push(prop.replace(HIDE_STATE_SUFFIX, ""));
      }
    }
    return result;
  }

  setHideProperty(name: string, hidden: boolean) {
    this[name + HIDE_STATE_SUFFIX] = hidden;
  }
}
