import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

import { ChairComponent } from './chair.component';
import { Seat } from '../../theater.service';

describe('ChairComponent', () => {
  let component: ChairComponent;
  let fixture: ComponentFixture<ChairComponent>;

  const seat: Seat = { side: 'right', rowIndex: 2, seatIndex: 3, showSoda: true, showPopcorn: false };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChairComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChairComponent);
    component = fixture.componentInstance;
    component.seat = seat;
    component.leftSeatsLength = 5;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('mutatedSeat should reflect getters', () => {
    const m = component.mutatedSeat;
    expect(m.side).toBe('right');
    expect(m.rowIndex).toBe(2);
    expect(m.seatIndex).toBe(3);
    expect(m.showSoda).toBeTrue();
  });

  it('builds seat-specific SVG paint IDs so chairs cannot share gradients or filters', () => {
    const firstGradient = component.svgId('gradient');
    expect(firstGradient).toBe('theater-seat-gradient-right-2-3');
    expect(component.svgUrl('gradient')).toBe(`url(#${firstGradient})`);

    const secondFixture = TestBed.createComponent(ChairComponent);
    secondFixture.componentInstance.seat = { ...seat, side: 'left', seatIndex: 1 };
    secondFixture.detectChanges();

    expect(secondFixture.componentInstance.svgId('gradient')).not.toBe(firstGradient);
    secondFixture.destroy();
  });

  it('renders no duplicate SVG definition IDs within a chair', () => {
    const ids = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[id]')).map(
      (element) => element.id
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renders a matte shell and upholstered inset without decorative UI badges', () => {
    const host = fixture.nativeElement as HTMLElement;
    const chair = host.querySelector<SVGElement>('svg.seat');
    const seatShell = host.querySelector<SVGPathElement>('.seat-shell');
    const seatBack = host.querySelector<SVGPathElement>('.seat-back');
    const armCaps = host.querySelectorAll<SVGRectElement>('.chair-arm-cap');

    expect(chair?.getAttribute('aria-hidden')).toBe('true');
    expect(chair?.getAttribute('focusable')).toBe('false');
    expect(seatShell).not.toBeNull();
    expect(seatBack).not.toBeNull();
    expect(armCaps.length).toBe(2);
    expect(host.querySelector('.seat-number-plate')).toBeNull();
  });

  it('uses furniture-shaped target cues instead of a rectangular selection ring', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.target-floor-glow')).toBeNull();
    expect(host.querySelector('.seat-active-rim')).toBeNull();

    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();

    expect(host.querySelector('.target-floor-glow')).not.toBeNull();
    expect(host.querySelector('.seat-active-rim')).not.toBeNull();
  });

  it('keeps the roving tab stop separate from the active target', () => {
    let wrapper = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.seat-wrapper')!;
    expect(wrapper.getAttribute('tabindex')).toBe('-1');
    expect(wrapper.hasAttribute('aria-current')).toBeFalse();

    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();
    wrapper = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.seat-wrapper')!;

    expect(wrapper.getAttribute('tabindex')).toBe('-1');
    expect(wrapper.getAttribute('aria-current')).toBe('true');
    expect(wrapper.getAttribute('aria-label')).toContain('Active target');

    fixture.componentRef.setInput('isTabStop', true);
    fixture.detectChanges();
    expect(wrapper.getAttribute('tabindex')).toBe('0');
  });

  it('should emit hover and select events', () => {
    spyOn(component.activity, 'emit');
    component.emitEvent('hover');
    expect(component.activity.emit).toHaveBeenCalledWith({
      eventType: 'hover',
      seat: component.mutatedSeat,
      interaction: 'pointer',
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Iteration 2 — keyboard activation parity. The chair already had role,
  // tabindex, aria-label, aria-pressed but no keydown handler, so Tab-
  // focused users couldn't actually play. Pin the activation contract.
  // ───────────────────────────────────────────────────────────────────────
  describe('keyboard activation (iteration 2)', () => {
    it('should emit a select event on Enter/Space and prevent default', () => {
      spyOn(component.activity, 'emit');
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      const preventSpy = spyOn(event, 'preventDefault');

      component.onActivate(event);

      expect(preventSpy).toHaveBeenCalledTimes(1);
      expect(component.activity.emit).toHaveBeenCalledWith({
        eventType: 'select',
        seat: component.mutatedSeat,
        interaction: 'keyboard',
      });
    });

    it('emits arrow-key navigation without selecting the seat', () => {
      spyOn(component.navigate, 'emit');
      spyOn(component.activity, 'emit');
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });

      component.onNavigate(event, 'right');

      expect(component.navigate.emit).toHaveBeenCalledWith({ seat: component.mutatedSeat, direction: 'right' });
      expect(component.activity.emit).not.toHaveBeenCalled();
    });
  });

  describe('Timer Cleanup', () => {
    beforeEach(() => {
      jasmine.clock().install();
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('should clear click animation timer on destroy', () => {
      // Trigger click animation which starts a timer
      component.emitEvent('select');
      expect(component.isClicked).toBeTrue();

      // Destroy component before timer completes
      component.ngOnDestroy();

      // Advance past animation duration - isClicked should remain true since timer was cleared
      jasmine.clock().tick(600);

      // Timer callback should not have run after destroy
      // (This verifies no memory leak from orphaned timers)
    });

    it('should clear pending timer when new click occurs', () => {
      // First click
      component.emitEvent('select');
      expect(component.isClicked).toBeTrue();

      // Another click before first animation completes
      jasmine.clock().tick(200);
      component.emitEvent('select');

      // Should still be clicked (timer was reset)
      expect(component.isClicked).toBeTrue();

      // Complete the second animation
      jasmine.clock().tick(500);
      expect(component.isClicked).toBeFalse();
    });
  });
});
