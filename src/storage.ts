export interface BestEntry {
  time: number;
  coins: number;
  totalCoins: number;
  deaths: number;
}

export interface CustomLevel {
  name: string;
  level: unknown;
}

const KEY_BEST = "graviball.best.v1";
const KEY_CUSTOM = "graviball.customLevels.v1";
const KEY_NOTES = "graviball.notes.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — ignore */
  }
}

export const storage = {
  getBest(): Record<string, BestEntry> {
    return read(KEY_BEST, {});
  },
  recordBest(levelId: string, entry: BestEntry) {
    const all = this.getBest();
    const prev = all[levelId];
    all[levelId] = {
      time: prev ? Math.min(prev.time, entry.time) : entry.time,
      coins: prev ? Math.max(prev.coins, entry.coins) : entry.coins,
      totalCoins: entry.totalCoins,
      deaths: prev ? Math.min(prev.deaths, entry.deaths) : entry.deaths,
    };
    write(KEY_BEST, all);
  },
  resetBest() {
    write(KEY_BEST, {});
  },

  getCustomLevels(): CustomLevel[] {
    return read<CustomLevel[]>(KEY_CUSTOM, []);
  },
  saveCustomLevel(entry: CustomLevel) {
    const list = this.getCustomLevels().filter(
      (c) => c.name !== entry.name,
    );
    list.push(entry);
    write(KEY_CUSTOM, list);
  },
  deleteCustomLevel(name: string) {
    write(
      KEY_CUSTOM,
      this.getCustomLevels().filter((c) => c.name !== name),
    );
  },

  getCollectedNotes(): string[] {
    return read<string[]>(KEY_NOTES, []);
  },
  collectNote(id: string) {
    const notes = this.getCollectedNotes();
    if (!notes.includes(id)) {
      notes.push(id);
      write(KEY_NOTES, notes);
    }
  },
};
