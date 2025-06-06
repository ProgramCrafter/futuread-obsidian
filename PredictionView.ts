import { TextFileView, WorkspaceLeaf, Setting } from 'obsidian';
import Chart, { ActiveElement, ChartConfiguration, ChartEvent } from 'chart.js/auto';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import 'chartjs-adapter-date-fns'; // Import the date-fns adapter for time scales

// Define the view type for the Obsidian plugin
export const VIEW_TYPE_PREDICTION = 'prediction-market-view';

// Interface for a single bet
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

// Interface for market data
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

// Prediction Market logic class
class MarketLogic {
  private pool: [number, number]; // [YES pool, NO pool]
  private k: number; // Logarithmic invariant: log2(y) * log2(n)
  private bets: Map<number, Bet>; // Map of bet timestamps to bet details

  constructor() {
    this.pool = [512, 512];
    this.k = Math.log2(this.pool[0]) * Math.log2(this.pool[1]);
    this.bets = new Map<number, Bet>();
  }

  // Process a bet, adjusting the pool
  private poolBet(amount: number, flip: boolean = false): number {
    let [y, n] = this.pool;
    y += amount;
    n += amount;

    let newY: number, newN: number, shares: number;
    if (!flip) {
      const niy = this.k / Math.log2(n);
      newY = Math.pow(2, niy);
      shares = y - newY;
      newN = n;
    } else {
      const nin = this.k / Math.log2(y);
      newN = Math.pow(2, nin);
      shares = n - newN;
      newY = y;
    }
    this.pool = [newY, newN];
    return shares;
  }

  // Compute current log2odds and probability
  public computeState(): { log2odds: number; probability: number } {
    const [y, n] = this.pool;
    const logY = Math.log2(y);
    const logN = Math.log2(n);
    const probability = (n * logN) / (n * logN + y * logY);
    const log2odds = Math.log2(probability / (1 - probability));
    return { log2odds, probability };
  }

  // Replay bets and compute user shares
  public replay(): { yesShares: number; noShares: number; mana: number; bets: Bet[] } {
    this.pool = [512, 512];
    let sy = 0, sn = 0, mana = 0;
    const updatedBets: Bet[] = [];

    for (const [lt, bet] of Array.from(this.bets.entries()).sort(([a], [b]) => a - b)) {
      const { log2odds: oddsBefore } = this.computeState();
      const amount = bet.size.mana;
      const flip = bet.size.direction === 'NO';
      const shares = this.poolBet(Math.abs(amount), flip);
      const { log2odds: oddsAfter } = this.computeState();

      if (flip) {
        sn += shares;
        mana += amount;
      } else {
        sy += shares;
        mana -= amount;
      }

      updatedBets.push({
        ...bet,
        sharesReceived: shares,
        log2oddsBefore: oddsBefore,
        log2oddsAfter: oddsAfter,
      });
    }

    const redeemed = Math.min(sy, sn);
    return {
      yesShares: sy - redeemed,
      noShares: sn - redeemed,
      mana,
      bets: updatedBets,
    };
  }
  
  // Update an existing bet
  public updateBet(lt: number, amount: number, direction: 'YES' | 'NO', comment?: string): Bet {
    if (!this.bets.has(lt)) throw new Error('Bet not found');
    const bet = this.bets.get(lt)!;
    bet.size.mana = amount;
    bet.size.direction = direction;
    bet.comment = comment;
    return bet;
  }

  // Place a new bet
  public placeBet(amount: number, direction: 'YES' | 'NO', comment?: string, timestamp?: string): Bet {
    const lt = this.bets.size;
    const bet: Bet = {
      timestamp: timestamp ?? new Date().toISOString(),
      size: { mana: amount, direction },
      comment,
      sharesReceived: 0,
      log2oddsBefore: 0,
      log2oddsAfter: 0,
    };
    this.bets.set(lt, bet);
    return bet;
  }

  // Get current pool state
  public getPool(): [number, number] {
    return [...this.pool];
  }
}

// Obsidian plugin view class
export class PredictionView extends TextFileView {
  private chart?: Chart;
  private market?: MarketData;
  private logic: MarketLogic;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.logic = new MarketLogic();
  }

  // Clear the view
  public clear(): void {
    this.chart = undefined;
    this.market = undefined;
    this.logic = new MarketLogic();
  }

  // Serialize market data for persistence
  public getViewData(): string {
    return this.market ? JSON.stringify(this.market) : '';
  }

  // Define the view type
  public getViewType(): string {
    return VIEW_TYPE_PREDICTION;
  }

  // Display text for the view
  public getDisplayText(): string {
    return this.market?.name ?? 'Prediction Market';
  }

  // Load market data from persisted string
  public setViewData(content: string, clear: boolean): void {
    try {
      this.market = JSON.parse(content);
      if (!this.market) throw new Error('parser fault');
      
      this.logic = new MarketLogic();
      // Reconstruct bets in logic
      this.market.bets.forEach((bet, lt) => {
        this.logic.placeBet(bet.size.mana, bet.size.direction, bet.comment, bet.timestamp);
      });
    } catch (e) {
      this.market = {
        name: 'Prediction Market',
        bets: [],
        pool: { yesShares: 512, noShares: 512, k: Math.log2(512) * Math.log2(512) },
        log2odds: 0,
        userShares: 0,
      };
      this.logic = new MarketLogic();
    }

    if (clear) {
      this.chart = undefined;
    }

    this.drawMe();
  }

  // Handle view opening
  public async onOpen(): Promise<void> {
    console.log('PredictionMarketView opened');
  }

  // Render the view
  private drawMe(): void {
    const container = this.contentEl;
    container.empty();
    container.style.textAlign = 'center';

    if (!this.market) return;

    // Update market state
    const { yesShares, noShares, mana, bets } = this.logic.replay();
    this.market.bets = bets;
    const { log2odds, probability } = this.logic.computeState();
    this.market.log2odds = log2odds;
    this.market.userShares = yesShares > noShares ? yesShares : -noShares;
    this.market.pool = {
      yesShares: this.logic.getPool()[0],
      noShares: this.logic.getPool()[1],
      k: this.market.pool.k,
    };

    // Title
    container.createEl('h1', { text: this.market.name });

    // Chart container
    const canCon = container.createEl('div', { cls: 'market' });
    canCon.style.position = 'relative';
    const canvas = canCon.createEl('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.createChart(ctx, container);

    // Display current state
    const prob = probability * 100;
    const stateText = `Belief: ${log2odds.toFixed(2)} bits (${prob.toFixed(1)}%)`;
    container.createEl('h5', { text: stateText });

    const sharesText = Math.abs(this.market.userShares) < 1e-7
      ? 'No stake'
      : this.market.userShares < 0
        ? `Payout ${(-this.market.userShares).toFixed(2)} upon NO`
        : `Payout ${this.market.userShares.toFixed(2)} upon YES`;
    container.createEl('h5', { text: sharesText });

    // Bet input form
    const form = container.createEl('div', { cls: 'bet-form' });
    const amountInput = form.createEl('input', { type: 'number', attr: { placeholder: 'Amount (Mana)', step: '1' } });
    const directionSelect = form.createEl('select');
    directionSelect.createEl('option', { text: 'YES', attr: { value: 'YES' } });
    directionSelect.createEl('option', { text: 'NO', attr: { value: 'NO' } });
    const commentInput = form.createEl('input', { type: 'text', attr: { placeholder: 'Comment (optional)' } });
    const betButton = form.createEl('button', { text: 'Place Bet' });

    betButton.addEventListener('click', () => {
      const amount = parseFloat(amountInput.value);
      const direction = directionSelect.value as 'YES' | 'NO';
      const comment = commentInput.value || undefined;
      if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount');
        return;
      }
      this.logic.placeBet(amount, direction, comment);
      this.drawMe();
    });

    // Periodic resize
    this.registerInterval(
      window.setInterval(() => {
        if (this.chart) this.chart.resize();
      }, 1000)
    );
  }

  // Create and configure the chart
  private createChart(ctx: CanvasRenderingContext2D, container: HTMLElement): void {
    const items = this.market!.bets.map(bet => ({
      x: bet.log2oddsAfter - this.market!.log2odds,
      y: +new Date(bet.timestamp),
      label: bet.comment ?? '',
    }));
    items.push({ x: 0.0, y: 5 + Date.now(), label: '<now>' });

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
          pointHitRadius: 10, // Increase hit area for clicking
        }],
      },
      options: {
        responsive: true,
        aspectRatio: 1.3,
        scales: {
          x: { 
            type: 'linear', 
            min: -4, 
            max: 4, 
            grid: { color: '#3333' }, 
            title: { display: true, text: 'Log2Odds Shifted' } 
          },
          y: { 
            type: 'time',
            time: {
              parser: 'yyyy-MM-dd\'T\'HH:mm:ss.SSSX', // ISO 8601 format for timestamps
              unit: 'hour',
              displayFormats: { hour: 'HH:mm' }
            },
            min: Math.min(...items.map(item => item.y)),
            max: Math.max(...items.map(item => item.y)),
            grid: { color: '#3333' },
            title: { display: true, text: 'Time' },
            ticks: {
              source: 'data',
              callback: (value: number) => {
                const date = new Date(value);
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              },
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items: any[]) => {
                const item = items[0];
                const date = new Date(item.parsed.y);
                return date.toLocaleString();
              },
              label: (item: any) => {
                const actual = item.parsed.x + this.market!.log2odds;
                const prob = 100.0 / (1 + Math.pow(2, -actual));
                const comment = (item.raw as any).comment || 'No comment';
                return `${actual.toFixed(2)} bits (${prob.toFixed(1)}%)\nComment: ${comment}`;
              },
            },
          },
          datalabels: {
            align: 'right',
            color: '#3098bb',
            font:  {size: 15, weight: 'bold'},
          },
        },
        onClick: (event: ChartEvent, elements: ActiveElement[]) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const bet = this.market!.bets[index];
            this.showEditForm(bet, index, event);
          }
        },
      },
      plugins: [ChartDataLabels],
    } as ChartConfiguration);
  }

  // Show a hovering form to edit a bet
  private showEditForm(bet: Bet, index: number, event: ChartEvent): void {
    const container = this.contentEl.querySelector('div.market')!;
    const form = container.createEl('div', { cls: 'edit-form', attr: { style: 'position: absolute; background: white; padding: 10px; border: 2px solid #ccc;' } });

    const amountInput = form.createEl('input', { type: 'number', value: bet.size.mana.toString(), attr: { step: '1' } });
    const directionSelect = form.createEl('select');
    directionSelect.createEl('option', { text: 'YES', attr: { value: 'YES', selected: bet.size.direction === 'YES' } });
    directionSelect.createEl('option', { text: 'NO', attr: { value: 'NO', selected: bet.size.direction === 'NO' } });
    const commentInput = form.createEl('input', { type: 'text', value: bet.comment || '', attr: { placeholder: 'Comment (optional)' } });
    const saveButton = form.createEl('button', { text: 'Save' });
    const cancelButton = form.createEl('button', { text: 'Cancel' });

    form.style.left = `${event.x! + 5}px`;
    form.style.top = `${event.y! - 20}px`;

    saveButton.addEventListener('click', () => {
      const amount = parseFloat(amountInput.value);
      const direction = directionSelect.value as 'YES' | 'NO';
      const comment = commentInput.value || undefined;
      if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount');
        return;
      }
      this.logic.updateBet(index, amount, direction, comment);
      form.remove();
      this.drawMe();
    });

    cancelButton.addEventListener('click', () => {
      form.remove();
    });

    // Close form on outside click
    container.addEventListener('click', (e) => {
      if (!form.contains(e.target as Node)) form.remove();
    }, { once: true });
  }
}
