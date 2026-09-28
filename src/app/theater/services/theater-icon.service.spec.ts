import { TestBed } from '@angular/core/testing';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TheaterIconService } from './theater-icon.service';

describe('TheaterIconService', () => {
  let service: TheaterIconService;
  let sanitizerSpy: jasmine.SpyObj<DomSanitizer>;

  beforeEach(() => {
    sanitizerSpy = jasmine.createSpyObj<DomSanitizer>('DomSanitizer', ['bypassSecurityTrustHtml']);
    sanitizerSpy.bypassSecurityTrustHtml.and.callFake((html: string): SafeHtml => ({ __html: html }));

    TestBed.configureTestingModule({
      providers: [TheaterIconService, { provide: DomSanitizer, useValue: sanitizerSpy }],
    });

    service = TestBed.inject(TheaterIconService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('returns the same SafeHtml reference across repeated calls for the same icon name', () => {
    // [innerHTML] bindings must receive a referentially stable SafeHtml — a
    // fresh instance on every change-detection pass forces Angular to
    // rewrite the bound DOM subtree each time. This is the behavior the
    // whole service exists to guarantee.
    const first = service.getIconHtml('star');
    const second = service.getIconHtml('star');
    const third = service.getIconHtml('star');

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('invokes the sanitizer exactly once per unique icon name, even across repeated calls', () => {
    service.getIconHtml('star');
    service.getIconHtml('star');
    service.getIconHtml('star');
    expect(sanitizerSpy.bypassSecurityTrustHtml).toHaveBeenCalledTimes(1);

    service.getIconHtml('ticket');
    expect(sanitizerSpy.bypassSecurityTrustHtml).toHaveBeenCalledTimes(2);

    service.getIconHtml('ticket');
    service.getIconHtml('star');
    expect(sanitizerSpy.bypassSecurityTrustHtml).toHaveBeenCalledTimes(2);
  });

  it('returns distinct SafeHtml values for different icon names', () => {
    const star = service.getIconHtml('star');
    const ticket = service.getIconHtml('ticket');
    expect(star).not.toBe(ticket);
  });

  it('passes the raw SVG markup for the requested icon to the sanitizer', () => {
    service.getIconHtml('ticket');
    const [rawHtml] = sanitizerSpy.bypassSecurityTrustHtml.calls.mostRecent().args;
    expect(rawHtml).toContain('<svg');
    expect(rawHtml).toContain('viewBox="0 0 256 256"');
  });
});
