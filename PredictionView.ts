import { TextFileView, WorkspaceLeaf, Setting } from 'obsidian';
import Chart from 'chart.js/auto';

export const VIEW_TYPE_PREDICTION = 'prediction-view';

interface Bet {
  timestamp: string;
  size: {
    mana: number;
    direction: 'YES' | 'NO';
  };
  comment?: string;
  sharesReceived: number;
  log2oddsBefore: number;
  log2oddsAfter: number;
}

interface MarketData {
  name: string;
  bets: Bet[];
  pool: {
    yesShares: number;
    noShares: number;
    k: number;
  };
  log2odds: number;
  userShares: number;
  resolution?: {
    outcome: 'YES' | 'NO';
  };
}


export class PredictionView extends TextFileView {
  private chart?: Chart;
  private market?: MarketData;
  
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }
  
  clear() {
    this.chart = undefined;
    this.market = undefined;
  }
  
  getViewData() {
    return this.market ? JSON.stringify(this.market) : '';
  }
  
  getViewType() {
    return VIEW_TYPE_PREDICTION;
  }
  
  getDisplayText() {
    return this.market?.name ?? 'Prediction Market';
  }
  
  setViewData(content: string, clear: boolean) {
    console.warn('setViewData', {it: this, content, clear});
    
    try {
      this.market = JSON.parse(content);
    } catch (e) {
      this.market = {
        name: 'Prediction Market',
        bets: [],
        pool: { yesShares: 512, noShares: 512, k: Math.log2(512) * Math.log2(512) },
        log2odds: 0,
        userShares: 0,
      };
    }
    
    if (clear)
      this.chart = undefined;
    
    if (!this.chart)
      this.drawMe();
  }
  
  async onOpen() {
    console.warn('onOpen', this);
  }
    
  drawMe() {
    const container = this.contentEl;
    container.empty();
    container.style.textAlign = 'center';
    
    if (this.market == undefined) return;
    const market = this.market;
    
    // # Prediction Market
    container.createEl('h1', { text: market.name });
    
    const canCon = container.createEl('div', 'market');
    const canvas = canCon.createEl('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const items = market.bets.map(bet => ({
      x: bet.log2oddsBefore - market.log2odds,
      y: +new Date(bet.timestamp),
    }));
    items.push({ x: 0.0, y: +Date.now() });
    
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Log2Odds Progression',
          data: items,
          borderColor: '#4bc0c0',
          tension: 0.1,
          fill: false,
          pointRadius: 3,
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        aspectRatio: 1.3,
        scales: {
          x: { type: 'linear', min: -4, max: 4, grid: { color: '#333' }, title: { display: true, text: 'Log2Odds Shifted' } },
          y: { type: 'linear', reverse: true, display: false },
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                const item = items[0];
                const date = new Date(item.parsed.y);
                return date.toLocaleString();
              },
              label: (item) => {
                const actual = item.parsed.x + market.log2odds;
                const prob = 100.0 / (1 + Math.pow(2, -actual));
                return `${actual.toFixed(2)} bits (${prob.toFixed(1)}%)`;
              }
            }
          }
        }
      }
    });
    
    const prob = 100.0 / (1 + Math.pow(2, -market.log2odds));
    const stateText = `Belief: ${market.log2odds.toFixed(2)} bits (${prob.toFixed(1)}%)`;
    container.createEl('h5', { text: stateText });
    
    const sharesText = (Math.abs(market.userShares) < 1e-7) ? 'No stake' : (
        (market.userShares < 0)
            ? `Payout ${(-market.userShares).toFixed(2)} upon NO`
            : `Payout ${market.userShares.toFixed(2)} upon YES`
    );
    container.createEl('h5', { text: sharesText });
    
    this.registerInterval(
      window.setInterval(() => {
        if (this.chart) this.chart.resize();
      }, 1000)
    );
  }
}

