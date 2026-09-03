import { TestBed } from '@angular/core/testing';

import { ADMIN_TAB } from './admin-api.service';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AppComponent],
    }).compileComponents();
  });

  it('defaults to the Discovery tab when storage has no value', () => {
    const fixture = TestBed.createComponent(AppComponent);

    expect(fixture.componentInstance.activeTab()).toBe(ADMIN_TAB.DISCOVERY);
  });
});
