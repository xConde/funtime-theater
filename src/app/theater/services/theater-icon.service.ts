import { inject, Injectable } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { getTheaterIcon, TheaterIconName } from '../utils/icons';

/**
 * Renders the bespoke SVG icon set (utils/icons.ts) as sanitized, [innerHTML]-
 * ready markup. SafeHtml is cached per icon name so every caller — regardless
 * of how often its own change detection runs — gets back the SAME object
 * reference. A fresh SafeHtml instance on every CD pass forces Angular to
 * rewrite the bound element's DOM subtree each time, which can disrupt
 * in-flight clicks on the icon; keying the cache here means callers don't
 * each have to remember to memoize it themselves.
 */
@Injectable({
  providedIn: 'root',
})
export class TheaterIconService {
  private sanitizer = inject(DomSanitizer);
  private cache = new Map<TheaterIconName, SafeHtml>();

  getIconHtml(name: TheaterIconName): SafeHtml {
    let html = this.cache.get(name);
    if (!html) {
      html = this.sanitizer.bypassSecurityTrustHtml(getTheaterIcon(name));
      this.cache.set(name, html);
    }
    return html;
  }
}
