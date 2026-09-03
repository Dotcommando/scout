import { DatePipe, Location, NgClass } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  AdminApiService,
  ADMIN_TAB,
  DISCOVERY_RUN_STATUS,
  IConfiguration,
  IDiscoveryLead,
  IDiscoveryRun,
  IPage,
  IQualificationLead,
  SORT_DIRECTION,
} from './admin-api.service';
import { ConfigurationDialogComponent } from './configuration-dialog.component';

const ACTIVE_TAB_STORAGE_KEY = 'scout.admin.active-tab';
const PAGE_SIZE = 50;

@Component({
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
    NgClass,
  ],
  selector: 'scout-root',
  standalone: true,
  styleUrl: './app.component.scss',
  templateUrl: './app.component.html',
})
export class AppComponent implements OnDestroy, OnInit {
  public readonly activeTab = signal(readStoredTab());
  public readonly commandPending = signal(false);
  public readonly configurations = computed(() => this.activeTab() === ADMIN_TAB.DISCOVERY
    ? this.discoveryConfigurations()
    : this.qualificationConfigurations());
  public readonly currentTotal = computed(() => this.activeTab() === ADMIN_TAB.DISCOVERY
    ? this.discoveryPage().total
    : this.qualificationPage().total);
  public readonly directions = SORT_DIRECTION;
  public readonly discoveryConfigurations = signal<readonly IConfiguration[]>([]);
  public readonly discoveryLeads = signal<readonly IDiscoveryLead[]>([]);
  public readonly discoveryPage = signal<IPage<IDiscoveryLead>>(emptyPage<IDiscoveryLead>());
  public readonly discoveryRun = signal<IDiscoveryRun | undefined>(undefined);
  public readonly discoveryRunError = signal('');
  public readonly discoveryRunRequestPending = signal(false);
  public readonly error = signal('');
  public readonly isDiscoveryRunPending = computed(() => this.discoveryRunRequestPending()
    || isPendingDiscoveryRun(this.discoveryRun()));
  public readonly loading = signal(false);
  public readonly offset = signal(0);
  public readonly pageIndex = computed(() => Math.floor(this.offset() / PAGE_SIZE));
  public readonly pageWindow = computed(() => getPageWindow(this.pageIndex(), this.currentTotal(), PAGE_SIZE));
  public readonly qualificationConfigurations = signal<readonly IConfiguration[]>([]);
  public readonly qualificationLeads = signal<readonly IQualificationLead[]>([]);
  public readonly qualificationPage = signal<IPage<IQualificationLead>>(emptyPage<IQualificationLead>());
  public readonly selectedCampaignId = signal('');
  public readonly sortDirection = signal(SORT_DIRECTION.DESC);
  public readonly sortOptions = computed(() => this.activeTab() === ADMIN_TAB.DISCOVERY
    ? discoverySortOptions()
    : qualificationSortOptions());
  public sortBy = 'createdAt';
  public readonly tabs = ADMIN_TAB;
  private discoveryRunPollingTimer: ReturnType<typeof setTimeout> | undefined;
  private discoveryRunObservationVersion = 0;

  public constructor(
    private readonly api: AdminApiService,
    private readonly dialog: MatDialog,
    private readonly location: Location,
  ) {}

  public async ngOnInit(): Promise<void> {
    this.offset.set(readPageOffset(this.location.path(true)));
    await this.loadConfigurations();
  }

  public ngOnDestroy(): void {
    this.clearDiscoveryRunObservation();
  }

  public async loadConfigurations(): Promise<void> {
    this.loading.set(true);
    this.error.set('');

    try {
      const [discovery, qualification] = await Promise.all([
        this.api.getConfigurations(ADMIN_TAB.DISCOVERY),
        this.api.getConfigurations(ADMIN_TAB.QUALIFICATION),
      ]);
      this.discoveryConfigurations.set(discovery.items);
      this.qualificationConfigurations.set(qualification.items);
      this.selectFirstAvailableCampaign();
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Configurations could not be loaded');
    } finally {
      this.loading.set(false);
    }
  }

  public selectTab(tab: ADMIN_TAB): void {
    if (tab !== this.activeTab()) {
      this.clearDiscoveryRunObservation();
    }
    this.activeTab.set(tab);
    saveStoredTab(tab);
    this.sortBy = 'createdAt';
    this.sortDirection.set(SORT_DIRECTION.DESC);
    this.offset.set(0);
    this.writePageIndex(0);
    this.selectFirstAvailableCampaign();
  }

  public selectCampaign(campaignId: string): void {
    if (campaignId !== this.selectedCampaignId()) {
      this.clearDiscoveryRunObservation();
    }
    this.selectedCampaignId.set(campaignId);
    this.goToPage(0);
  }

  public resetAndLoad(): void {
    this.goToPage(0);
  }

  public toggleDirection(): void {
    this.sortDirection.update((direction) => direction === SORT_DIRECTION.ASC
      ? SORT_DIRECTION.DESC
      : SORT_DIRECTION.ASC);
    this.resetAndLoad();
  }

  public goToPage(pageIndex: number): void {
    const normalizedPageIndex = Math.max(0, pageIndex);

    if (normalizedPageIndex === this.pageIndex()) {
      return;
    }
    this.offset.set(normalizedPageIndex * PAGE_SIZE);
    this.writePageIndex(normalizedPageIndex);
    void this.loadResults();
  }

  public onPaginatorPage(event: PageEvent): void {
    this.goToPage(event.pageIndex);
  }

  @HostListener('window:popstate')
  public restorePageFromBrowserHistory(): void {
    const pageOffset = readPageOffset(this.location.path(true));

    if (pageOffset === this.offset()) {
      return;
    }
    this.offset.set(pageOffset);
    void this.loadResults();
  }

  public openCreateDialog(): void {
    this.dialog.open(ConfigurationDialogComponent, {
      data: { tab: this.activeTab() },
    }).afterClosed().subscribe((campaignId: string | undefined) => {
      if (campaignId !== undefined) {
        void this.loadConfigurations().then(() => this.selectCampaign(campaignId));
      }
    });
  }

  public async runDiscovery(): Promise<void> {
    const campaignId = this.selectedCampaignId();

    if (campaignId === '' || this.activeTab() !== ADMIN_TAB.DISCOVERY || this.isDiscoveryRunPending()) {
      return;
    }
    const observationVersion = this.beginDiscoveryRunObservation();

    try {
      const configuration = this.discoveryConfigurations().find(
        (item) => item.campaignId === campaignId,
      );
      const maximumProviderItems = configuration?.maximumProviderItemsPerRun;

      if (maximumProviderItems === undefined) {
        throw new Error('Selected Discovery configuration has no run limit');
      }
      const run = await this.api.runDiscovery(campaignId, maximumProviderItems);

      if (!this.isCurrentDiscoveryRunObservation(observationVersion, campaignId)) {
        return;
      }
      this.discoveryRun.set(run);
      await this.handleDiscoveryRunUpdate(run, observationVersion);
    } catch (error: unknown) {
      if (this.isCurrentDiscoveryRunObservation(observationVersion, campaignId)) {
        this.discoveryRunError.set(error instanceof Error ? error.message : 'Run could not be requested');
      }
    } finally {
      if (this.isCurrentDiscoveryRunObservation(observationVersion, campaignId)) {
        this.discoveryRunRequestPending.set(false);
      }
    }
  }

  public async requalify(leadId: string): Promise<void> {
    const campaignId = this.selectedCampaignId();

    if (campaignId === '') {
      return;
    }
    this.commandPending.set(true);

    try {
      await this.api.requalify(campaignId, leadId);
      await this.loadResults();
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Requalification could not be requested');
    } finally {
      this.commandPending.set(false);
    }
  }

  public pageLabel(): string {
    const total = this.currentTotal();

    return total === 0
      ? '0 results'
      : String(this.offset() + 1) + '-' + String(Math.min(this.offset() + PAGE_SIZE, total)) + ' of ' + String(total);
  }

  public scopeCode(scopeId: string): string {
    return /^[a-z]{2}$/i.test(scopeId)
      ? scopeId.toUpperCase()
      : '--';
  }

  public metricSummary(lead: IQualificationLead): string {
    if (lead.enrichment === null) {
      return 'Enrichment ' + lead.enrichmentState;
    }

    return lead.enrichment.metrics
      .filter((metric) => metric.value !== undefined)
      .map((metric) => metric.kind + ': ' + metric.value)
      .join(' · ');
  }

  public qualificationStatus(lead: IQualificationLead): string {
    return lead.decision?.decision.decision
      ?? (lead.processing ? 'processing' : 'pending');
  }

  public qualificationStatusIcon(lead: IQualificationLead): string {
    const status = this.qualificationStatus(lead);

    return status === 'qualified'
      ? '✓'
      : status === 'rejected'
        ? '✕'
        : '•';
  }

  public discoveryRunStatusText(): string {
    const run = this.discoveryRun();

    return run === undefined
      ? 'Requesting Discovery run'
      : 'Discovery run ' + run.runId + ' is ' + run.status;
  }

  public async copyText(value: string): Promise<void> {
    if (navigator.clipboard === undefined) {
      this.error.set('Copy is not supported by this browser');

      return;
    }

    try {
      await navigator.clipboard.writeText(value);
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Text could not be copied');
    }
  }

  public websiteName(websiteUrl: string): string {
    try {
      const hostname = new URL(websiteUrl).hostname;

      return hostname.startsWith('www.')
        ? hostname.slice(4)
        : hostname;
    } catch {
      return websiteUrl;
    }
  }

  public async loadResults(): Promise<void> {
    const campaignId = this.selectedCampaignId();

    if (campaignId === '') {
      return;
    }
    this.loading.set(true);
    this.error.set('');

    try {
      if (this.activeTab() === ADMIN_TAB.DISCOVERY) {
        const page = await this.api.getDiscoveryLeads(campaignId, this.offset(), this.sortBy, this.sortDirection());

        this.discoveryPage.set(page);
        this.discoveryLeads.set(page.items);
      } else {
        const page = await this.api.getQualificationLeads(campaignId, this.offset(), this.sortBy, this.sortDirection());

        this.qualificationPage.set(page);
        this.qualificationLeads.set(page.items);
      }
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Leads could not be loaded');
    } finally {
      this.loading.set(false);
    }
  }

  private selectFirstAvailableCampaign(): void {
    const configurations = this.configurations();
    const selected = this.selectedCampaignId();
    const stillExists = configurations.some((configuration) => configuration.campaignId === selected);
    const campaignId = stillExists
      ? selected
      : configurations[0]?.campaignId ?? '';

    if (campaignId !== selected) {
      this.clearDiscoveryRunObservation();
    }
    this.selectedCampaignId.set(campaignId);
    if (campaignId !== '') {
      void this.loadResults();
    }
  }

  private beginDiscoveryRunObservation(): number {
    this.clearDiscoveryRunObservation();
    this.discoveryRunRequestPending.set(true);
    this.discoveryRunError.set('');

    return this.discoveryRunObservationVersion;
  }

  private clearDiscoveryRunObservation(): void {
    this.discoveryRunObservationVersion += 1;
    if (this.discoveryRunPollingTimer !== undefined) {
      clearTimeout(this.discoveryRunPollingTimer);
      this.discoveryRunPollingTimer = undefined;
    }
    this.discoveryRun.set(undefined);
    this.discoveryRunError.set('');
    this.discoveryRunRequestPending.set(false);
  }

  private async handleDiscoveryRunUpdate(
    run: IDiscoveryRun,
    observationVersion: number,
  ): Promise<void> {
    if (run.status === DISCOVERY_RUN_STATUS.COMPLETED) {
      this.stopDiscoveryRunPolling();
      await this.loadResults();

      return;
    }
    if (run.status === DISCOVERY_RUN_STATUS.FAILED) {
      this.stopDiscoveryRunPolling();
      this.discoveryRunError.set('Discovery run ' + run.runId + ' failed'
        + (run.failureMessage === undefined ? '.' : ': ' + run.failureMessage));

      return;
    }
    this.scheduleDiscoveryRunPoll(run.runId, run.campaignId, observationVersion);
  }

  private scheduleDiscoveryRunPoll(
    runId: string,
    campaignId: string,
    observationVersion: number,
  ): void {
    this.stopDiscoveryRunPolling();
    this.discoveryRunPollingTimer = setTimeout(() => {
      void this.pollDiscoveryRun(runId, campaignId, observationVersion);
    }, 1000);
  }

  private async pollDiscoveryRun(
    runId: string,
    campaignId: string,
    observationVersion: number,
  ): Promise<void> {
    if (!this.isCurrentDiscoveryRunObservation(observationVersion, campaignId)) {
      return;
    }

    try {
      const run = await this.api.getDiscoveryRun(runId);

      if (!this.isCurrentDiscoveryRunObservation(observationVersion, campaignId)) {
        return;
      }
      this.discoveryRun.set(run);
      await this.handleDiscoveryRunUpdate(run, observationVersion);
    } catch (error: unknown) {
      if (this.isCurrentDiscoveryRunObservation(observationVersion, campaignId)) {
        this.clearDiscoveryRunObservation();
        this.discoveryRunError.set(error instanceof Error ? error.message : 'Discovery run status could not be loaded');
      }
    }
  }

  private isCurrentDiscoveryRunObservation(observationVersion: number, campaignId: string): boolean {
    return observationVersion === this.discoveryRunObservationVersion
      && campaignId === this.selectedCampaignId()
      && this.activeTab() === ADMIN_TAB.DISCOVERY;
  }

  private stopDiscoveryRunPolling(): void {
    if (this.discoveryRunPollingTimer !== undefined) {
      clearTimeout(this.discoveryRunPollingTimer);
      this.discoveryRunPollingTimer = undefined;
    }
  }

  private writePageIndex(pageIndex: number): void {
    const currentPath = this.location.path(true);
    const questionMarkIndex = currentPath.indexOf('?');
    const path = questionMarkIndex === -1
      ? currentPath
      : currentPath.slice(0, questionMarkIndex);
    const parameters = new URLSearchParams(questionMarkIndex === -1 ? '' : currentPath.slice(questionMarkIndex + 1));

    parameters.set('page', String(pageIndex + 1));
    this.location.go(path === '' ? '/' : path, parameters.toString());
  }
}

function discoverySortOptions(): readonly { readonly label: string; readonly value: string }[] {
  return [
    { label: 'Date added', value: 'createdAt' },
    { label: 'Name', value: 'name' },
  ];
}

function qualificationSortOptions(): readonly { readonly label: string; readonly value: string }[] {
  return [
    { label: 'Date added', value: 'createdAt' },
    { label: 'Name', value: 'name' },
    { label: 'Public ADR', value: 'publicAdr' },
    { label: 'Review volume', value: 'reviewVolume' },
    { label: 'Market price position', value: 'marketPricePosition' },
    { label: 'Monetisable asset count', value: 'monetisableAssetCount' },
    { label: 'Full-service signal', value: 'fullServiceHotelSignal' },
    { label: 'Market value proxy', value: 'marketValueProxy' },
  ];
}

function emptyPage<TItem>(): IPage<TItem> {
  return { items: [], limit: PAGE_SIZE, offset: 0, total: 0 };
}

function isPendingDiscoveryRun(run: IDiscoveryRun | undefined): boolean {
  return run?.status === DISCOVERY_RUN_STATUS.ACCEPTED
    || run?.status === DISCOVERY_RUN_STATUS.RUNNING;
}

export function getPageWindow(
  pageIndex: number,
  total: number,
  pageSize: number,
): readonly number[] {
  const pageCount = Math.ceil(total / pageSize);
  const firstPageIndex = Math.max(0, pageIndex - 2);
  const lastPageIndex = Math.min(pageCount - 1, pageIndex + 2);

  return Array.from(
    { length: Math.max(0, lastPageIndex - firstPageIndex + 1) },
    (_, index) => firstPageIndex + index,
  );
}

function readPageOffset(path: string): number {
  const questionMarkIndex = path.indexOf('?');

  if (questionMarkIndex === -1) {
    return 0;
  }
  const pageValue = new URLSearchParams(path.slice(questionMarkIndex + 1)).get('page');
  const pageNumber = pageValue === null ? 1 : Number(pageValue);

  return Number.isSafeInteger(pageNumber) && pageNumber > 0
    ? (pageNumber - 1) * PAGE_SIZE
    : 0;
}

function readStoredTab(): ADMIN_TAB {
  try {
    const value = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);

    return value === ADMIN_TAB.QUALIFICATION
      ? ADMIN_TAB.QUALIFICATION
      : ADMIN_TAB.DISCOVERY;
  } catch {
    return ADMIN_TAB.DISCOVERY;
  }
}

function saveStoredTab(tab: ADMIN_TAB): void {
  try {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    return;
  }
}
