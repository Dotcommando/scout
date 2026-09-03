import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';

import {
  ADMIN_TAB,
  AdminApiService,
  DISCOVERY_RUN_STATUS,
  IConfiguration,
  IDiscoveryLead,
  IDiscoveryRun,
  IPage,
  IQualificationLead,
  SORT_DIRECTION,
} from './admin-api.service';
import { AppComponent, getPageWindow } from './app.component';

describe('AppComponent', () => {
  let api: AdminApiServiceStub;
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;

  beforeEach(async () => {
    localStorage.clear();
    api = new AdminApiServiceStub();
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [{ provide: AdminApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
  });

  it('defaults to the Discovery tab when storage has no value', () => {
    expect(component.activeTab()).toBe(ADMIN_TAB.DISCOVERY);
  });

  it('shows a hostname instead of a generic website label', () => {
    expect(component.websiteName('https://www.example.com/path?query=value')).toBe('example.com');
  });

  it('copies a value through the browser clipboard', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = jasmine.createSpy('writeText').and.resolveTo();

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      await component.copyText('copied value');

      expect(writeText).toHaveBeenCalledOnceWith('copied value');
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(navigator, 'clipboard');
      } else {
        Object.defineProperty(navigator, 'clipboard', descriptor);
      }
    }
  });

  it('keeps up to two preceding and following pages in the page window', () => {
    expect(getPageWindow(4, 500, 50)).toEqual([2, 3, 4, 5, 6]);
    expect(getPageWindow(0, 500, 50)).toEqual([0, 1, 2]);
    expect(getPageWindow(9, 500, 50)).toEqual([7, 8, 9]);
  });

  it('writes the selected page to the URL before loading it', async () => {
    prepareDiscoveryCampaign(component);
    component.discoveryPage.set({ items: [], limit: 50, offset: 0, total: 500 });

    component.goToPage(2);
    await settlePromises();

    expect(TestBed.inject(Location).path(true)).toContain('page=3');
    expect(component.offset()).toBe(100);
  });

  it('blocks duplicate Run clicks and polls until completion', async () => {
    jasmine.clock().install();
    prepareDiscoveryCampaign(component);
    api.polledRuns = [runningRun(), completedRun()];

    try {
      await component.runDiscovery();
      await component.runDiscovery();

      expect(api.runRequests).toBe(1);
      expect(component.isDiscoveryRunPending()).toBeTrue();

      jasmine.clock().tick(1000);
      await settlePromises();
      expect(component.discoveryRun()?.status).toBe(DISCOVERY_RUN_STATUS.RUNNING);

      jasmine.clock().tick(1000);
      await settlePromises();
      expect(component.discoveryRun()?.status).toBe(DISCOVERY_RUN_STATUS.COMPLETED);
      expect(component.isDiscoveryRunPending()).toBeFalse();
      expect(api.discoveryLeadRequests).toBe(1);
    } finally {
      component.ngOnDestroy();
      jasmine.clock().uninstall();
    }
  });

  it('shows a safe failure message and restores Run availability', async () => {
    prepareDiscoveryCampaign(component);
    api.runResult = failedRun();

    await component.runDiscovery();

    expect(component.isDiscoveryRunPending()).toBeFalse();
    expect(component.discoveryRunError()).toContain('Provider quota reached');
  });

  it('renders a central progress state and disables Run while observing a run', async () => {
    jasmine.clock().install();

    try {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      prepareDiscoveryCampaign(component);
      await component.runDiscovery();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Discovery run run-a is accepted');
    } finally {
      component.ngOnDestroy();
      jasmine.clock().uninstall();
    }
  });

  it('stops scheduled polling when the selected campaign changes', async () => {
    jasmine.clock().install();
    prepareDiscoveryCampaign(component);

    try {
      await component.runDiscovery();
      component.selectCampaign('campaign-b');
      jasmine.clock().tick(1000);
      await settlePromises();

      expect(api.discoveryRunRequests).toBe(0);
    } finally {
      component.ngOnDestroy();
      jasmine.clock().uninstall();
    }
  });

  it('restores Run availability when polling fails', async () => {
    jasmine.clock().install();
    prepareDiscoveryCampaign(component);
    api.pollingError = new Error('Discovery service is unavailable');

    try {
      await component.runDiscovery();
      jasmine.clock().tick(1000);
      await settlePromises();

      expect(component.isDiscoveryRunPending()).toBeFalse();
      expect(component.discoveryRunError()).toContain('Discovery service is unavailable');
    } finally {
      component.ngOnDestroy();
      jasmine.clock().uninstall();
    }
  });
});

class AdminApiServiceStub {
  public discoveryLeadRequests = 0;
  public discoveryRunRequests = 0;
  public polledRuns: IDiscoveryRun[] = [];
  public pollingError: Error | undefined;
  public runRequests = 0;
  public runResult: IDiscoveryRun = acceptedRun();

  public async createConfiguration(): Promise<void> {}

  public async getConfigurations(): Promise<IPage<IConfiguration>> {
    return emptyPage<IConfiguration>();
  }

  public async getDiscoveryLeads(
    campaignId: string,
    offset: number,
    sortBy: string,
    sortDirection: SORT_DIRECTION,
  ): Promise<IPage<IDiscoveryLead>> {
    this.discoveryLeadRequests += 1;
    void campaignId;
    void offset;
    void sortBy;
    void sortDirection;

    return emptyPage<IDiscoveryLead>();
  }

  public async getDiscoveryRun(runId: string): Promise<IDiscoveryRun> {
    this.discoveryRunRequests += 1;
    void runId;

    if (this.pollingError !== undefined) {
      throw this.pollingError;
    }

    return this.polledRuns.shift() ?? completedRun();
  }

  public async getQualificationLeads(): Promise<IPage<IQualificationLead>> {
    return emptyPage<IQualificationLead>();
  }

  public async requalify(): Promise<void> {}

  public async runDiscovery(campaignId: string, maximumProviderItems: number): Promise<IDiscoveryRun> {
    this.runRequests += 1;
    void campaignId;
    void maximumProviderItems;

    return this.runResult;
  }
}

function acceptedRun(): IDiscoveryRun {
  return {
    campaignId: 'campaign-a',
    runId: 'run-a',
    status: DISCOVERY_RUN_STATUS.ACCEPTED,
  };
}

function completedRun(): IDiscoveryRun {
  return { ...acceptedRun(), status: DISCOVERY_RUN_STATUS.COMPLETED };
}

function failedRun(): IDiscoveryRun {
  return {
    ...acceptedRun(),
    failureMessage: 'Provider quota reached',
    status: DISCOVERY_RUN_STATUS.FAILED,
  };
}

function runningRun(): IDiscoveryRun {
  return { ...acceptedRun(), status: DISCOVERY_RUN_STATUS.RUNNING };
}

function emptyPage<TItem>(): IPage<TItem> {
  return { items: [], limit: 50, offset: 0, total: 0 };
}

function prepareDiscoveryCampaign(component: AppComponent): void {
  component.discoveryConfigurations.set([{
    campaignId: 'campaign-a',
    createdAt: '2026-09-03T00:00:00.000Z',
    maximumProviderItemsPerRun: 10,
    scopes: [],
    version: 1,
  }]);
  component.selectedCampaignId.set('campaign-a');
}

async function settlePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
