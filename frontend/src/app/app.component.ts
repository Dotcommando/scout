import { DatePipe, NgClass } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';

import {
  AdminApiService,
  ADMIN_TAB,
  IConfiguration,
  IDiscoveryLead,
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
    MatProgressSpinnerModule,
    MatSelectModule,
    NgClass,
  ],
  selector: 'scout-root',
  standalone: true,
  styleUrl: './app.component.scss',
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
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
  public readonly error = signal('');
  public readonly loading = signal(false);
  public readonly offset = signal(0);
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

  public constructor(
    private readonly api: AdminApiService,
    private readonly dialog: MatDialog,
  ) {}

  public async ngOnInit(): Promise<void> {
    await this.loadConfigurations();
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
    this.activeTab.set(tab);
    saveStoredTab(tab);
    this.sortBy = 'createdAt';
    this.sortDirection.set(SORT_DIRECTION.DESC);
    this.offset.set(0);
    this.selectFirstAvailableCampaign();
  }

  public selectCampaign(campaignId: string): void {
    this.selectedCampaignId.set(campaignId);
    this.offset.set(0);
    void this.loadResults();
  }

  public resetAndLoad(): void {
    this.offset.set(0);
    void this.loadResults();
  }

  public toggleDirection(): void {
    this.sortDirection.update((direction) => direction === SORT_DIRECTION.ASC
      ? SORT_DIRECTION.DESC
      : SORT_DIRECTION.ASC);
    this.resetAndLoad();
  }

  public nextPage(): void {
    this.offset.update((offset) => offset + PAGE_SIZE);
    void this.loadResults();
  }

  public previousPage(): void {
    this.offset.update((offset) => Math.max(0, offset - PAGE_SIZE));
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

    if (campaignId === '') {
      return;
    }
    this.commandPending.set(true);

    try {
      const configuration = this.discoveryConfigurations().find(
        (item) => item.campaignId === campaignId,
      );
      const maximumProviderItems = configuration?.maximumProviderItemsPerRun;

      if (maximumProviderItems === undefined) {
        throw new Error('Selected Discovery configuration has no run limit');
      }
      await this.api.runDiscovery(campaignId, maximumProviderItems);
      await this.loadResults();
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Run could not be requested');
    } finally {
      this.commandPending.set(false);
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

    this.selectedCampaignId.set(campaignId);
    if (campaignId !== '') {
      void this.loadResults();
    }
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
