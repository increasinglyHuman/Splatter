/**
 * Undo/Redo stack — snapshot-based.
 * Stores full splatmap snapshots (compact for 512x512 = 1MB each, 50 deep = 50MB max).
 */

const MAX_HISTORY = 50;

export class UndoStack {
  private stack: Uint8ClampedArray[] = [];
  private pointer = -1;

  push(data: Uint8ClampedArray): void {
    // Discard any redo history beyond current pointer
    this.stack.length = this.pointer + 1;
    this.stack.push(new Uint8ClampedArray(data));
    if (this.stack.length > MAX_HISTORY) {
      this.stack.shift();
    } else {
      this.pointer++;
    }
  }

  undo(): Uint8ClampedArray | null {
    if (this.pointer <= 0) return null;
    this.pointer--;
    return new Uint8ClampedArray(this.stack[this.pointer]);
  }

  redo(): Uint8ClampedArray | null {
    if (this.pointer >= this.stack.length - 1) return null;
    this.pointer++;
    return new Uint8ClampedArray(this.stack[this.pointer]);
  }

  canUndo(): boolean {
    return this.pointer > 0;
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }

  clear(): void {
    this.stack.length = 0;
    this.pointer = -1;
  }

  get depth(): number {
    return this.stack.length;
  }
}
