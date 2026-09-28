import { DOCUMENT } from '@angular/common';
import { inject, Injectable, Renderer2, RendererFactory2 } from '@angular/core';

/** Keeps fullscreen play from scrolling the document behind overlays. */
@Injectable({ providedIn: 'root' })
export class ScrollLockService {
  static readonly LOCK_CLASS = 'app-scroll-locked';

  private readonly document = inject(DOCUMENT);
  private readonly renderer: Renderer2;
  private lockCount = 0;

  constructor(rendererFactory: RendererFactory2) {
    this.renderer = rendererFactory.createRenderer(null, null);
  }

  /** Acquire a lock. Idempotent across overlapping callers via ref-counting. */
  lock(): void {
    this.lockCount++;
    if (this.lockCount === 1 && this.document.body) {
      this.renderer.addClass(this.document.body, ScrollLockService.LOCK_CLASS);
    }
  }

  /** Release a lock. No-op if the count is already zero. */
  unlock(): void {
    if (this.lockCount === 0) return;
    this.lockCount--;
    if (this.lockCount === 0 && this.document.body) {
      this.renderer.removeClass(this.document.body, ScrollLockService.LOCK_CLASS);
    }
  }

  /** Test/diagnostic accessor. */
  isLocked(): boolean {
    return this.lockCount > 0;
  }
}
