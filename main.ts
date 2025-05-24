import { Plugin } from 'obsidian';
import { PredictionView, VIEW_TYPE_PREDICTION } from './PredictionView';

export default class PredictionPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE_PREDICTION, (leaf) => new PredictionView(leaf));
    this.registerExtensions(['frd'], VIEW_TYPE_PREDICTION);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PREDICTION);
  }
}
